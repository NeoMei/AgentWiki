/**
 * Onboarding coordinator: drives the deterministic state machine that connects
 * device auth, preflight, bootstrap, gateway installation, verification, first
 * scan and sync.
 *
 * Every state transition persists a checkpoint so a crash can resume from the
 * last complete step without repeating side effects. The coordinator emits
 * NDJSON events through the injected protocol encoder and waits for structured
 * replies on the injected source.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { hashServerPlan as computeServerPlanHash } from './plan-hash.js';
import { hashOnboardingPlan } from './local-plan-hash.js';
import { ProtocolEncoder, parseReply, isConfirmationReply, type ProtocolSource, type OnboardingEvent } from './protocol.js';
import type { OnboardingClient, ClientType, ServerPlan, StartResult } from './client.js';
import { OnboardingInputsSchema, type SessionStore, type OnboardingCheckpoint, type OnboardingInputs, type OnboardingState } from './session.js';
import { assertTransition } from './session.js';
import { OnboardingError, type OnboardingFailure } from './errors.js';
import { PublicLocalScanPlanSchema, publicLocalScanPlan, type LocalScanPlan, type PublicLocalScanPlan } from '../codegraph/contracts.js';
import type { PlanCodeScanInput } from '../codegraph/provider.js';

/** Injected preflight: analyse client config and archive legacy state. */
export interface PreflightFn {
  (client: ClientType, home: string, serverBaseUrl?: string): Promise<{
    configHash: string;
    oldEntries: string[];
    hasConflict: boolean;
    archivePath: string | null;
    reloadRequired: boolean;
  }>;
}

/** Injected bootstrap-and-install: exchange token, write gateway config, verify. */
export interface BootstrapInstallFn {
  (input: {
    onboardingToken: string;
    serverBaseUrl: string;
    idempotencyKey: string;
    serverPlan: ServerPlan;
    serverPlanHash: string;
    client: ClientType;
    connectionId: string;
    home: string;
    expectedConfigHash: string;
  }): Promise<{
    bootstrap: {
      space: { id: string; name: string };
      agent: { id: string; name: string };
      grant: { role: string; scopes: string[] };
      installation: { code: string; installationId: string; expiresAt: string };
    };
    reloadRequired: boolean;
    configBackupPath?: string;
    manifestHash?: string;
    connectionId?: string;
  }>;
}

/** Injected first-scan knowledge workflow. */
export interface KnowledgeWorkflowFn {
  pull?(input: { spaceId: string }): Promise<{ revisionId: string }>;
  planLocalScan(input: PlanCodeScanInput): Promise<LocalScanPlan | null>;
  prepare(input: { spaceId: string; sourcePaths: string[]; sourceType?: string; analysisMode?: 'standard' | 'deep'; localScanPlanHash?: string; confirmedLocalScan?: boolean }): Promise<{ jobId: string; previewHash: string; summary: Record<string, unknown> }>;
  confirmAndSync(input: { jobId: string; previewHash: string; confirmed: boolean }): Promise<{
    revisionId: string;
    status?: string;
    submissionId?: string;
    changeSetId?: string | null;
  }>;
}

export interface CoordinatorDeps {
  client: OnboardingClient;
  store: SessionStore;
  encoder: ProtocolEncoder;
  source: ProtocolSource;
  serverBaseUrl: string;
  packageVersion: '0.6.0';
  home: string;
  preflight: PreflightFn;
  bootstrapInstall: BootstrapInstallFn;
  knowledge: KnowledgeWorkflowFn;
  sessionId?: string;
  /** Sleep injection for test speed. */
  sleep?: (ms: number) => Promise<void>;
}

const SUPPORTED_PROTOCOL_VERSION = 1;

export class OnboardingCoordinator {
  private readonly sessionId: string;

  constructor(private readonly deps: CoordinatorDeps) {
    this.sessionId = deps.sessionId ?? randomUUID();
  }

  /** Run the full onboarding state machine to completion. */
  async run(): Promise<{ sessionId: string; report: Record<string, unknown> }> {
    let checkpoint = await this.deps.store.load();
    if (checkpoint === null) {
      checkpoint = {
        sessionId: this.sessionId,
        state: 'collecting_input',
        protocolVersion: SUPPORTED_PROTOCOL_VERSION,
        serverUrl: this.deps.serverBaseUrl,
        clientType: 'codex',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.deps.store.save(checkpoint);
    }

    try {
      // A process can stop after the post-install checkpoint is durable but
      // before the single-use token is removed. Clean that narrow crash window
      // on resume; earlier states still need the token to replay installation.
      if (hasDurableBootstrapCheckpoint(checkpoint)) {
        await this.deps.store.deleteSecret();
      }
      while (true) {
        switch (checkpoint.state) {
          case 'collecting_input':
            checkpoint = await this.collectInput(checkpoint);
            break;
          case 'waiting_for_web_auth':
            checkpoint = await this.authorize(checkpoint);
            break;
          case 'preflight':
            checkpoint = await this.preflight(checkpoint);
            break;
          case 'waiting_for_confirmation':
            checkpoint = await this.confirmPlan(checkpoint);
            break;
          case 'bootstrapping':
          case 'installing_gateway':
          case 'verifying_gateway':
            checkpoint = await this.bootstrapAndInstall(checkpoint);
            break;
          case 'scanning':
            checkpoint = await this.firstScan(checkpoint);
            break;
          case 'waiting_for_sync_confirmation':
            checkpoint = await this.sync(checkpoint);
            break;
          case 'syncing':
            checkpoint = await this.transition(checkpoint, 'completed');
            break;
          case 'failed_recoverable': {
            const resumeState = checkpoint.resumeState ?? 'collecting_input';
            checkpoint = await this.transition(checkpoint, resumeState);
            break;
          }
          case 'completed': {
            const report = this.buildReport(checkpoint);
            this.emit({ type: 'completed', report });
            return { sessionId: this.sessionId, report };
          }
          case 'failed_terminal':
          case 'cancelled':
            throw this.fail('SYNC_FAILED', `onboarding session is ${checkpoint.state}`, false);
        }
      }
    } catch (error) {
      const latest = await this.deps.store.load();
      await this.handleFailure(latest ?? checkpoint, error);
      throw error;
    }
  }

  /* ---- individual states ---- */

  private async collectInput(prev: OnboardingCheckpoint): Promise<OnboardingCheckpoint> {
    const rawInputs = await this.requestInput([
      { name: 'spaceMode', label: 'Space', type: 'choice', choices: ['create', 'existing'], required: true },
      { name: 'spaceName', label: 'Space name', type: 'string', required: false },
      { name: 'spaceId', label: 'Existing Space ID', type: 'string', required: false },
      { name: 'agentName', label: 'Agent name', type: 'string', required: true },
      { name: 'role', label: 'Access role', type: 'choice', choices: ['reader', 'editor', 'publisher'], required: true },
      { name: 'clientType', label: 'Agent client', type: 'choice', choices: ['codex', 'claude', 'opencode'], required: true },
      { name: 'sourcePaths', label: 'Source paths', type: 'paths', required: true },
      { name: 'sourceType', label: 'Source type', type: 'choice', choices: ['auto', 'code', 'documents'], required: false, defaultValue: 'auto' },
      { name: 'analysisMode', label: 'Analysis mode', type: 'choice', choices: ['standard', 'deep'], required: false, defaultValue: 'standard' },
    ]);
    const inputs = this.validateInputs(rawInputs);
    const next = { ...prev, inputs: { ...inputs }, clientType: inputs.clientType };
    return this.transition(next, 'waiting_for_web_auth');
  }

  private async authorize(prev: OnboardingCheckpoint): Promise<OnboardingCheckpoint> {
    const clientType: ClientType = prev.clientType ?? 'codex';
    const started: StartResult = prev.deviceCode && prev.userCode && prev.verificationUri
      ? {
          deviceCode: prev.deviceCode,
          userCode: prev.userCode,
          verificationUri: prev.verificationUri,
          verificationUriComplete: prev.verificationUri,
          expiresIn: 600,
          interval: 5,
        }
      : await this.deps.client.start({
          serverBaseUrl: this.deps.serverBaseUrl,
          packageVersion: this.deps.packageVersion,
          clientType,
        });
    if (!prev.deviceCode) {
      prev = await this.transition({
        ...prev,
        deviceCode: started.deviceCode,
        userCode: started.userCode,
        verificationUri: started.verificationUriComplete,
      }, 'waiting_for_web_auth');
    }
    this.emit({
      type: 'authorization_required',
      requestId: 'auth',
      url: started.verificationUriComplete,
      userCode: started.userCode,
      expiresInSeconds: started.expiresIn,
    });

    const result = await this.deps.client.pollUntilSettled(
      this.deps.serverBaseUrl,
      started.deviceCode,
      () => this.emit({ type: 'heartbeat', step: 'authorization' }),
      { sleepFn: this.deps.sleep, intervalMs: started.interval * 1_000 },
    );

    if (result.status === 'denied') throw this.fail('AUTH_DENIED', 'user denied the device authorization', false);
    if (result.status === 'expired') throw this.fail('AUTH_EXPIRED', 'device authorization expired', true);

    await this.deps.store.saveSecret(result.onboardingToken);
    return this.transition(prev, 'preflight');
  }

  private async preflight(prev: OnboardingCheckpoint): Promise<OnboardingCheckpoint> {
    this.emit({ type: 'progress', step: 'preflight', status: 'running' });
    const result = await this.deps.preflight(
      prev.clientType ?? 'codex',
      this.deps.home,
      this.deps.serverBaseUrl,
    );
    if (result.hasConflict) {
      throw this.fail('CONFIG_CONFLICT', 'an unknown entry already occupies the agentwiki MCP name', false);
    }
    const next: OnboardingCheckpoint = {
      ...prev,
      serverPlanHash: undefined,
      localScanPlanHash: undefined,
      onboardingPlanHash: undefined,
      localScanPlan: undefined,
      inputs: {
        ...prev.inputs,
        configHash: result.configHash,
        oldEntries: result.oldEntries,
        reloadRequired: result.reloadRequired,
      },
    };
    return this.transition(next, 'waiting_for_confirmation');
  }

  private async confirmPlan(prev: OnboardingCheckpoint): Promise<OnboardingCheckpoint> {
    const inputs = prev.inputs!;
    const serverPlan = this.buildServerPlan(inputs);
    const serverPlanHash = this.hashServerPlan(serverPlan);
    const localScanPlan = await this.planLocalScan(inputs);
    const publicPlan = localScanPlan ? redactLocalScanPlan(localScanPlan) : null;
    const localScanPlanHash = publicPlan?.localScanPlanHash;
    const onboardingPlanHash = hashOnboardingPlan({ serverPlanHash, ...(localScanPlanHash ? { localScanPlanHash } : {}) });
    this.emit({
      type: 'preview',
      plan: {
        serverPlan,
        ...(publicPlan ? { localScanPlan: publicPlan } : {}),
        configHash: inputs.configHash,
        oldEntries: inputs.oldEntries ?? [],
        reloadRequired: inputs.reloadRequired ?? false,
      },
    });

    const reply = await this.requestConfirmation('plan', onboardingPlanHash);
    if (!reply.confirmed) throw this.fail('AUTH_DENIED', 'user cancelled the onboarding plan', false);

    return this.transition({
      ...prev, serverPlanHash, onboardingPlanHash, ...(localScanPlanHash ? { localScanPlanHash } : {}),
      ...(publicPlan ? { localScanPlan: publicPlan } : {}),
      serverPlan: serverPlan as unknown as Record<string, unknown>,
    }, prev.bootstrapResult ? 'scanning' : 'bootstrapping');
  }

  private async bootstrapAndInstall(prev: OnboardingCheckpoint): Promise<OnboardingCheckpoint> {
    const token = await this.deps.store.loadSecret();
    if (!token) throw this.fail('AUTH_EXPIRED', 'onboarding token missing', true);

    this.emit({ type: 'progress', step: 'bootstrap', status: 'running' });
    const connectionId = typeof prev.inputs?.connectionId === 'string'
      ? prev.inputs.connectionId
      : randomUUID();
    if (prev.inputs?.connectionId !== connectionId) {
      prev = await this.transition({
        ...prev,
        inputs: { ...prev.inputs, connectionId },
      }, prev.state);
    }
    const result = await this.deps.bootstrapInstall({
      onboardingToken: token,
      serverBaseUrl: this.deps.serverBaseUrl,
      idempotencyKey: `${this.sessionId}-${prev.serverPlanHash}`,
      serverPlan: this.buildServerPlan(prev.inputs!),
      serverPlanHash: prev.serverPlanHash!,
      client: prev.clientType ?? 'codex',
      connectionId,
      home: this.deps.home,
      expectedConfigHash: prev.inputs!.configHash as string,
    });

    let next: OnboardingCheckpoint = {
      ...prev,
      bootstrapResult: summarizeBootstrap(result.bootstrap),
      inputs: {
        ...prev.inputs,
        connectionId: result.connectionId ?? connectionId,
        reloadRequired: result.reloadRequired,
        manifestHash: result.manifestHash,
      },
    };
    // The injected bootstrapInstall encapsulates install + verify, but the
    // state machine still walks through each checkpoint for resume fidelity.
    if (next.state === 'bootstrapping') next = await this.transition(next, 'installing_gateway');
    if (next.state === 'installing_gateway') next = await this.transition(next, 'verifying_gateway');
    next = await this.transition(next, 'scanning');
    // Delete only after the durable checkpoint proves installation completed.
    await this.deps.store.deleteSecret();
    return next;
  }

  private async firstScan(prev: OnboardingCheckpoint): Promise<OnboardingCheckpoint> {
    this.emit({ type: 'progress', step: 'scan', status: 'running' });
    const spaceId = (prev.bootstrapResult as { space: { id: string } }).space.id;
    if (prev.inputs?.role === 'reader') {
      if (!this.deps.knowledge.pull) {
        throw this.fail('SYNC_FAILED', 'Reader onboarding requires pull support', false);
      }
      const pulled = await this.deps.knowledge.pull({ spaceId });
      return this.transition({
        ...prev,
        bootstrapResult: {
          ...prev.bootstrapResult,
          revisionId: pulled.revisionId,
          status: 'pulled',
        },
      }, 'completed');
    }
    const localScanPlan = await this.planLocalScan(prev.inputs!);
    const publicPlan = localScanPlan ? redactLocalScanPlan(localScanPlan) : null;
    if (prev.localScanPlanHash !== publicPlan?.localScanPlanHash) {
      const serverPlanHash = prev.serverPlanHash!;
      const localScanPlanHash = publicPlan?.localScanPlanHash;
      const next = await this.transition({
        ...prev,
        onboardingPlanHash: hashOnboardingPlan({ serverPlanHash, ...(localScanPlanHash ? { localScanPlanHash } : {}) }),
        ...(localScanPlanHash ? { localScanPlanHash } : { localScanPlanHash: undefined }),
        ...(publicPlan ? { localScanPlan: publicPlan } : { localScanPlan: undefined }),
      }, 'waiting_for_confirmation');
      this.emit({
        type: 'preview',
        plan: {
          serverPlan: this.buildServerPlan(next.inputs!),
          ...(publicPlan ? { localScanPlan: publicPlan } : {}),
          configHash: next.inputs!.configHash,
          oldEntries: next.inputs!.oldEntries ?? [],
          reloadRequired: next.inputs!.reloadRequired ?? false,
        },
      });
      throw this.fail('CODEGRAPH_SCAN_PLAN_CHANGED', 'the local CodeGraph scan plan changed; confirm the updated preview', true);
    }
    await this.deps.knowledge.pull?.({ spaceId });
    const preview = await this.deps.knowledge.prepare({
      spaceId,
      sourcePaths: prev.inputs!.sourcePaths as string[],
      sourceType: prev.inputs!.sourceType as 'auto' | 'code' | 'documents' | undefined,
      analysisMode: prev.inputs!.analysisMode as 'standard' | 'deep' | undefined,
      ...(prev.localScanPlanHash ? { localScanPlanHash: prev.localScanPlanHash, confirmedLocalScan: true } : {}),
    });
    this.emit({ type: 'preview', plan: { jobId: preview.jobId, summary: preview.summary } });
    return this.transition({ ...prev, jobId: preview.jobId, previewHash: preview.previewHash }, 'waiting_for_sync_confirmation');
  }

  private async sync(prev: OnboardingCheckpoint): Promise<OnboardingCheckpoint> {
    const reply = await this.requestConfirmation('sync', prev.previewHash!);
    if (!reply.confirmed) throw this.fail('AUTH_DENIED', 'user cancelled the sync preview', false);

    this.emit({ type: 'progress', step: 'sync', status: 'running' });
    const result = await this.deps.knowledge.confirmAndSync({
      jobId: prev.jobId!,
      previewHash: prev.previewHash!,
      confirmed: true,
    });
    return this.transition({
      ...prev,
      bootstrapResult: {
        ...prev.bootstrapResult,
        revisionId: result.revisionId,
        status: result.status,
        submissionId: result.submissionId,
        changeSetId: result.changeSetId,
      },
    }, 'syncing');
  }

  /* ---- helpers ---- */

  private buildServerPlan(inputs: Record<string, unknown>): ServerPlan {
    return {
      space: inputs.spaceMode === 'existing'
        ? { mode: 'existing', id: inputs.spaceId as string }
        : { mode: 'create', name: inputs.spaceName as string },
      agentName: inputs.agentName as string,
      role: inputs.role as 'reader' | 'editor' | 'publisher',
      packageVersion: '0.6.0',
    };
  }

  private validateInputs(raw: Record<string, unknown>): OnboardingInputs {
    const allowed = new Set([
      'spaceMode', 'spaceName', 'spaceId', 'agentName', 'role',
      'clientType', 'sourcePaths', 'sourceType', 'analysisMode',
    ]);
    const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
      throw this.fail('PROTOCOL_UNSUPPORTED', `unknown onboarding input: ${unknown.join(', ')}`, false);
    }
    const spaceMode = raw.spaceMode;
    const clientType = raw.clientType;
    const role = raw.role;
    const sourceType = raw.sourceType ?? 'auto';
    const analysisMode = raw.analysisMode ?? 'standard';
    const sourcePaths = raw.sourcePaths;
    if (spaceMode !== 'create' && spaceMode !== 'existing') {
      throw this.fail('PROTOCOL_UNSUPPORTED', 'spaceMode must be create or existing', false);
    }
    if (spaceMode === 'create' && !isNonEmptyString(raw.spaceName)) {
      throw this.fail('PROTOCOL_UNSUPPORTED', 'spaceName is required when creating a Space', false);
    }
    if (spaceMode === 'existing' && !isNonEmptyString(raw.spaceId)) {
      throw this.fail('PROTOCOL_UNSUPPORTED', 'spaceId is required when using an existing Space', false);
    }
    if (!isNonEmptyString(raw.agentName)) {
      throw this.fail('PROTOCOL_UNSUPPORTED', 'agentName is required', false);
    }
    if (role !== 'reader' && role !== 'editor' && role !== 'publisher') {
      throw this.fail('PROTOCOL_UNSUPPORTED', 'role must be reader, editor, or publisher', false);
    }
    if (clientType !== 'codex' && clientType !== 'claude' && clientType !== 'opencode') {
      throw this.fail('PROTOCOL_UNSUPPORTED', 'clientType is invalid', false);
    }
    if (!Array.isArray(sourcePaths) || sourcePaths.length === 0 || !sourcePaths.every(isNonEmptyString)) {
      throw this.fail('PROTOCOL_UNSUPPORTED', 'sourcePaths must contain at least one path', false);
    }
    if (sourceType !== 'auto' && sourceType !== 'code' && sourceType !== 'documents') {
      throw this.fail('PROTOCOL_UNSUPPORTED', 'sourceType is invalid', false);
    }
    if (analysisMode !== 'standard' && analysisMode !== 'deep') {
      throw this.fail('PROTOCOL_UNSUPPORTED', 'analysisMode is invalid', false);
    }
    try {
      return OnboardingInputsSchema.parse({
      spaceMode,
      ...(spaceMode === 'create' ? { spaceName: raw.spaceName as string } : { spaceId: raw.spaceId as string }),
      agentName: raw.agentName as string,
      role,
      clientType,
      sourcePaths: (sourcePaths as string[]).map(canonicalizeSourcePath),
      sourceType,
      analysisMode,
      });
    } catch {
      throw this.fail('PROTOCOL_UNSUPPORTED', 'onboarding input is invalid', false);
    }
  }

  private hashServerPlan(plan: ServerPlan): string {
    return computeServerPlanHash(plan);
  }

  private async planLocalScan(inputs: Record<string, unknown>): Promise<LocalScanPlan | null> {
    if (inputs.role === 'reader') return null;
    const sourceType = (inputs.sourceType ?? 'auto') as 'auto' | 'code' | 'documents';
    if (inputs.analysisMode === 'deep') {
      throw new OnboardingError({
        code: 'CODEGRAPH_CAPABILITY_UNSUPPORTED', message: 'deep CodeGraph analysis is not available in this stage',
        retryable: false, nextAction: 'deep analysis is not installed yet', resumeSessionId: this.sessionId,
      });
    }
    if (sourceType === 'documents') return null;
    const plan = await this.deps.knowledge.planLocalScan({
      sourcePaths: inputs.sourcePaths as string[], sourceType,
      analysisMode: (inputs.analysisMode ?? 'standard') as 'standard' | 'deep',
    });
    if (sourceType === 'code' && plan === null) {
      throw this.fail('CODEGRAPH_CAPABILITY_UNSUPPORTED', 'CodeGraph did not produce a scan plan for the requested code source', false);
    }
    return plan;
  }

  private buildReport(checkpoint: OnboardingCheckpoint): Record<string, unknown> {
    return {
      sessionId: this.sessionId,
      space: (checkpoint.bootstrapResult as { space?: { id: string; name: string } })?.space,
      agent: (checkpoint.bootstrapResult as { agent?: { id: string; name: string } })?.agent,
      revisionId: (checkpoint.bootstrapResult as { revisionId?: string })?.revisionId,
      status: (checkpoint.bootstrapResult as { status?: string })?.status,
      submissionId: (checkpoint.bootstrapResult as { submissionId?: string })?.submissionId,
      changeSetId: (checkpoint.bootstrapResult as { changeSetId?: string | null })?.changeSetId,
      connectionId: checkpoint.inputs?.connectionId,
      manifestHash: checkpoint.inputs?.manifestHash,
      configBackupPath: checkpoint.inputs?.configBackupPath,
      agentReload: checkpoint.inputs?.reloadRequired ?? false,
    };
  }

  private async requestInput(fields: unknown[]): Promise<Record<string, unknown>> {
    const reply = await this.ask('input', { requestId: 'input', fields: fields as never });
    return reply.values ?? {};
  }

  private async requestConfirmation(name: string, planHash: string): Promise<{ confirmed: boolean }> {
    const reply = await this.ask(name, { requestId: name, planHash });
    if (reply.planHash !== planHash) {
      throw this.fail('PREVIEW_CHANGED', 'confirmation hash does not match the current preview', true);
    }
    return { confirmed: reply.confirmed ?? false };
  }

  private async ask(tag: string, event: Record<string, unknown>): Promise<{
    values?: Record<string, unknown>;
    confirmed?: boolean;
    planHash?: string;
  }> {
    const eventType = tag === 'input' ? 'input_required' : 'confirmation_required';
    this.emit({ type: eventType, ...event } as Parameters<ProtocolEncoder['emit']>[0]);
    const line = await this.deps.source.read();
    if (line === null) throw this.fail('AUTH_DENIED', `connection closed during ${tag}`, false);
    const reply = parseReply(line);
    if (reply.requestId !== tag) {
      throw this.fail('PROTOCOL_UNSUPPORTED', `unexpected requestId during ${tag}`, false);
    }
    if (isConfirmationReply(reply)) return { confirmed: reply.confirmed, planHash: reply.planHash };
    return { values: reply.values };
  }

  private emit(event: Parameters<ProtocolEncoder['emit']>[0]): OnboardingEvent {
    return this.deps.encoder.emit(event);
  }

  private async transition(prev: OnboardingCheckpoint, to: OnboardingState): Promise<OnboardingCheckpoint> {
    assertTransition(prev.state, to);
    const next = { ...prev, state: to };
    await this.deps.store.save(next);
    return next;
  }

  private fail(code: OnboardingFailure['code'], message: string, retryable: boolean): OnboardingError {
    return new OnboardingError({ code, message, retryable, resumeSessionId: this.sessionId });
  }

  private async handleFailure(checkpoint: OnboardingCheckpoint, error: unknown): Promise<void> {
    const retryable = error instanceof OnboardingError ? error.retryable : false;
    const code = error instanceof OnboardingError ? error.code : 'SYNC_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    try {
      await this.transition({
        ...checkpoint,
        ...(isResumableState(checkpoint.state) ? { resumeState: checkpoint.state } : {}),
        lastErrorCode: code,
      }, retryable ? 'failed_recoverable' : 'failed_terminal');
    } catch {
      // already terminal
    }
    this.deps.encoder.emitFailure({ code, message, retryable, resumeSessionId: this.sessionId });
  }
}

function redactLocalScanPlan(plan: LocalScanPlan): PublicLocalScanPlan {
  try {
    return PublicLocalScanPlanSchema.parse(publicLocalScanPlan(plan));
  } catch {
    throw new OnboardingError({
      code: 'SCAN_FAILED',
      message: 'local CodeGraph scan plan is invalid',
      retryable: true,
    });
  }
}

function summarizeBootstrap(bootstrap: Awaited<ReturnType<BootstrapInstallFn>>['bootstrap']): Record<string, unknown> {
  return {
    space: { id: bootstrap.space.id, name: bootstrap.space.name },
    agent: { id: bootstrap.agent.id, name: bootstrap.agent.name },
  };
}

function isResumableState(state: OnboardingState): state is Exclude<
  OnboardingState,
  'failed_recoverable' | 'failed_terminal' | 'cancelled' | 'completed'
> {
  return !['failed_recoverable', 'failed_terminal', 'cancelled', 'completed'].includes(state);
}

function hasDurableBootstrapCheckpoint(checkpoint: OnboardingCheckpoint): boolean {
  if (!checkpoint.bootstrapResult) return false;
  if (['scanning', 'waiting_for_sync_confirmation', 'syncing', 'completed'].includes(checkpoint.state)) {
    return true;
  }
  return checkpoint.state === 'failed_recoverable'
    && checkpoint.resumeState !== undefined
    && ['scanning', 'waiting_for_sync_confirmation', 'syncing'].includes(checkpoint.resumeState);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function canonicalizeSourcePath(value: string): string {

  if ([...value].some((character) => { const codePoint = character.codePointAt(0)!; return codePoint <= 0x1f || codePoint === 0x7f; }) || value.includes('\\')) throw new Error('invalid source path');
  return resolve(value);
}
