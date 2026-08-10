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
import { hashServerPlan as computeServerPlanHash } from './plan-hash.js';
import { ProtocolEncoder, parseReply, isConfirmationReply, type ProtocolSource, type OnboardingEvent } from './protocol.js';
import type { OnboardingClient, ClientType, ServerPlan, StartResult } from './client.js';
import type { SessionStore, OnboardingCheckpoint, OnboardingState } from './session.js';
import { assertTransition } from './session.js';
import { OnboardingError, type OnboardingFailure } from './errors.js';

/** Injected preflight: analyse client config and archive legacy state. */
export interface PreflightFn {
  (client: ClientType, home: string): Promise<{
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
  }>;
}

/** Injected first-scan knowledge workflow. */
export interface KnowledgeWorkflowFn {
  prepare(input: { spaceId: string; sourcePaths: string[]; sourceType?: string }): Promise<{ jobId: string; previewHash: string; summary: Record<string, unknown> }>;
  confirmAndSync(input: { jobId: string; previewHash: string; confirmed: boolean }): Promise<{ revisionId: string }>;
}

export interface CoordinatorDeps {
  client: OnboardingClient;
  store: SessionStore;
  encoder: ProtocolEncoder;
  source: ProtocolSource;
  serverBaseUrl: string;
  packageVersion: string;
  home: string;
  preflight: PreflightFn;
  bootstrapInstall: BootstrapInstallFn;
  knowledge: KnowledgeWorkflowFn;
  /** Sleep injection for test speed. */
  sleep?: (ms: number) => Promise<void>;
}

export interface OnboardingInputs {
  spaceMode: 'create' | 'existing';
  spaceName?: string;
  spaceId?: string;
  agentName: string;
  permissionPreset: 'editor' | 'full';
  approvalMode: 'always-review' | 'scoped-auto-publish';
  clientType: ClientType;
  sourcePaths: string[];
  sourceType?: 'auto' | 'code' | 'documents';
}

const SUPPORTED_PROTOCOL_VERSION = 1;

export class OnboardingCoordinator {
  private readonly sessionId: string;

  constructor(private readonly deps: CoordinatorDeps) {
    this.sessionId = randomUUID();
  }

  /** Run the full onboarding state machine to completion. */
  async run(): Promise<{ sessionId: string; report: Record<string, unknown> }> {
    let checkpoint: OnboardingCheckpoint = {
      sessionId: this.sessionId,
      state: 'collecting_input',
      protocolVersion: SUPPORTED_PROTOCOL_VERSION,
      serverUrl: this.deps.serverBaseUrl,
      clientType: 'codex',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.deps.store.save(checkpoint);

    try {
      // 1. Collect input fields from the Agent.
      checkpoint = await this.collectInput(checkpoint);

      // 2. Device authorization.
      checkpoint = await this.authorize(checkpoint);

      // 3. Preflight.
      checkpoint = await this.preflight(checkpoint);

      // 4. Plan confirmation.
      checkpoint = await this.confirmPlan(checkpoint);

      // 5. Bootstrap + install.
      checkpoint = await this.bootstrapAndInstall(checkpoint);

      // 6. First scan.
      checkpoint = await this.firstScan(checkpoint);

      // 7. Sync confirmation + push.
      checkpoint = await this.sync(checkpoint);

      // 8. Completed.
      checkpoint = await this.transition(checkpoint, 'completed');
      const report = this.buildReport(checkpoint);
      this.emit({ type: 'completed', report });
      return { sessionId: this.sessionId, report };
    } catch (error) {
      await this.handleFailure(checkpoint, error);
      throw error;
    }
  }

  /* ---- individual states ---- */

  private async collectInput(prev: OnboardingCheckpoint): Promise<OnboardingCheckpoint> {
    const inputs = await this.requestInput([
      { name: 'spaceMode', label: 'Space', type: 'choice', choices: ['create', 'existing'], required: true },
      { name: 'spaceName', label: 'Space name', type: 'string', required: false },
      { name: 'agentName', label: 'Agent name', type: 'string', required: true },
      { name: 'permissionPreset', label: 'Permission', type: 'choice', choices: ['editor', 'full'], required: true },
      { name: 'sourcePaths', label: 'Source paths', type: 'paths', required: true },
    ]);
    const next = { ...prev, inputs, clientType: (inputs.clientType as ClientType) ?? 'codex' };
    return this.transition(next, 'waiting_for_web_auth');
  }

  private async authorize(prev: OnboardingCheckpoint): Promise<OnboardingCheckpoint> {
    const clientType: ClientType = prev.clientType ?? 'codex';
    const started: StartResult = await this.deps.client.start({
      serverBaseUrl: this.deps.serverBaseUrl,
      packageVersion: this.deps.packageVersion,
      clientType,
    });
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
    const result = await this.deps.preflight(prev.clientType ?? 'codex', this.deps.home);
    if (result.hasConflict) {
      throw this.fail('CONFIG_CONFLICT', 'an unknown entry already occupies the agentwiki MCP name', false);
    }
    const next: OnboardingCheckpoint = {
      ...prev,
      serverPlanHash: undefined,
      inputs: { ...prev.inputs, configHash: result.configHash, reloadRequired: result.reloadRequired },
    };
    return this.transition(next, 'waiting_for_confirmation');
  }

  private async confirmPlan(prev: OnboardingCheckpoint): Promise<OnboardingCheckpoint> {
    const inputs = prev.inputs!;
    const serverPlan = this.buildServerPlan(inputs);
    const serverPlanHash = this.hashServerPlan(serverPlan);
    this.emit({ type: 'preview', plan: { serverPlan, configHash: inputs.configHash, oldEntries: [] } });

    const reply = await this.requestConfirmation('plan', serverPlanHash);
    if (!reply.confirmed) throw this.fail('AUTH_DENIED', 'user cancelled the onboarding plan', false);

    return this.transition({ ...prev, serverPlanHash, serverPlan: serverPlan as unknown as Record<string, unknown> }, 'bootstrapping');
  }

  private async bootstrapAndInstall(prev: OnboardingCheckpoint): Promise<OnboardingCheckpoint> {
    const token = await this.deps.store.loadSecret();
    if (!token) throw this.fail('AUTH_EXPIRED', 'onboarding token missing', true);

    this.emit({ type: 'progress', step: 'bootstrap', status: 'running' });
    const connectionId = randomUUID();
    const result = await this.deps.bootstrapInstall({
      onboardingToken: token,
      idempotencyKey: `${this.sessionId}-${prev.serverPlanHash}`,
      serverPlan: this.buildServerPlan(prev.inputs!),
      serverPlanHash: prev.serverPlanHash!,
      client: prev.clientType ?? 'codex',
      connectionId,
      home: this.deps.home,
      expectedConfigHash: prev.inputs!.configHash as string,
    });

    // Token is single-use; delete it after a successful bootstrap.
    await this.deps.store.deleteSecret();

    let next: OnboardingCheckpoint = {
      ...prev,
      bootstrapResult: result.bootstrap,
      inputs: { ...prev.inputs, connectionId, reloadRequired: result.reloadRequired },
    };
    // The injected bootstrapInstall encapsulates install + verify, but the
    // state machine still walks through each checkpoint for resume fidelity.
    next = await this.transition(next, 'installing_gateway');
    next = await this.transition(next, 'verifying_gateway');
    return this.transition(next, 'scanning');
  }

  private async firstScan(prev: OnboardingCheckpoint): Promise<OnboardingCheckpoint> {
    this.emit({ type: 'progress', step: 'scan', status: 'running' });
    const spaceId = (prev.bootstrapResult as { space: { id: string } }).space.id;
    const preview = await this.deps.knowledge.prepare({
      spaceId,
      sourcePaths: prev.inputs!.sourcePaths as string[],
      sourceType: prev.inputs!.sourceType as 'auto' | 'code' | 'documents' | undefined,
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
    return this.transition({ ...prev, bootstrapResult: { ...prev.bootstrapResult, revisionId: result.revisionId } }, 'syncing');
  }

  /* ---- helpers ---- */

  private buildServerPlan(inputs: Record<string, unknown>): ServerPlan {
    return {
      space: inputs.spaceMode === 'existing'
        ? { mode: 'existing', id: inputs.spaceId as string }
        : { mode: 'create', name: inputs.spaceName as string },
      agentName: inputs.agentName as string,
      permissionPreset: inputs.permissionPreset as 'editor' | 'full',
      approvalMode: inputs.approvalMode as 'always-review' | 'scoped-auto-publish',
      packageVersion: this.deps.packageVersion,
    };
  }

  private hashServerPlan(plan: ServerPlan): string {
    return computeServerPlanHash(plan);
  }

  private buildReport(checkpoint: OnboardingCheckpoint): Record<string, unknown> {
    return {
      sessionId: this.sessionId,
      space: (checkpoint.bootstrapResult as { space?: { id: string; name: string } })?.space,
      agent: (checkpoint.bootstrapResult as { agent?: { id: string; name: string } })?.agent,
      revisionId: (checkpoint.bootstrapResult as { revisionId?: string })?.revisionId,
      agentReload: checkpoint.inputs?.reloadRequired ?? false,
    };
  }

  private async requestInput(fields: unknown[]): Promise<Record<string, unknown>> {
    const reply = await this.ask('input', { requestId: 'input', fields: fields as never });
    return reply.values ?? {};
  }

  private async requestConfirmation(name: string, planHash: string): Promise<{ confirmed: boolean }> {
    const reply = await this.ask(name, { requestId: name, planHash });
    return { confirmed: reply.confirmed ?? false };
  }

  private async ask(tag: string, event: Record<string, unknown>): Promise<{ values?: Record<string, unknown>; confirmed?: boolean }> {
    const eventType = tag === 'input' ? 'input_required' : 'confirmation_required';
    this.emit({ type: eventType, ...event } as Parameters<ProtocolEncoder['emit']>[0]);
    const line = await this.deps.source.read();
    if (line === null) throw this.fail('AUTH_DENIED', `connection closed during ${tag}`, false);
    const reply = parseReply(line);
    if (isConfirmationReply(reply)) return { confirmed: reply.confirmed };
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
      await this.transition(checkpoint, retryable ? 'failed_recoverable' : 'failed_terminal');
    } catch {
      // already terminal
    }
    this.deps.encoder.emitFailure({ code, message, retryable, resumeSessionId: this.sessionId });
  }
}
