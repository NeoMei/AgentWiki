/** Finite-process connection onboarding. No scan, adapter, or sync operation is executed. */
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { AgentAccessRoleSchema } from '@neomei/agentwiki-sync-protocol';
import { OnboardingClient, type ClientType, type ServerPlan } from './client.js';
import { preflight } from './preflight.js';
import { clientConfigPath } from '../installer/client-config.js';
import { hashServerPlan } from './plan-hash.js';
import { readStepReply, stepsDirectory, stepsFile, withStepLock, writeStepState } from './steps-store.js';
import { installStepConnection } from './steps-install.js';

const name = z.string().trim().min(1).max(200);
const space = z.object({ id: z.string().min(1), name: z.string() }).strict();
const planSchema = z
  .object({
    space: z.union([
      z.object({ mode: z.literal('create'), name }).strict(),
      z.object({ mode: z.literal('existing'), id: name }).strict(),
    ]),
    agentName: name,
    role: AgentAccessRoleSchema,
    packageVersion: z.literal('0.10.0'),
  })
  .strict();
const valuesSchema = z.discriminatedUnion('spaceMode', [
  z
    .object({ spaceMode: z.literal('create'), spaceName: name, agentName: name, role: AgentAccessRoleSchema })
    .strict(),
  z
    .object({ spaceMode: z.literal('existing'), spaceId: name, agentName: name, role: AgentAccessRoleSchema })
    .strict(),
]);
const bootstrapSchema = z.object({
  space,
  agent: space,
  grant: z.object({ role: AgentAccessRoleSchema, scopes: z.array(z.string()) }),
  installation: z.object({ code: z.string(), installationId: z.string(), expiresAt: z.string() }),
});
const exchangeSchema = z.object({
  apiKey: z.string(),
  agentId: z.string(),
  credentialId: z.string(),
  spaceId: z.string(),
  role: AgentAccessRoleSchema,
  serverUrl: z.string().url(),
  pluginVersion: z.literal('0.10.0'),
  scopes: z.array(z.string()),
});
const stateSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().uuid(),
    serverBaseUrl: z.string().url(),
    clientType: z.enum(['codex', 'claude', 'opencode']),
    stage: z.enum([
      'authorization',
      'input',
      'confirmation',
      'bootstrap',
      'install',
      'completed',
      'cancelled',
    ]),
    deviceCode: z.string(),
    authorizationUrl: z.string().url(),
    authorizationExpiresAt: z.number(),
    pollAfter: z.number(),
    pollInterval: z.number(),
    authRevision: z.number(),
    token: z.string().optional(),
    tokenExpiresAt: z.number().optional(),
    spaces: z.array(space).optional(),
    request: z
      .object({
        id: z.string().uuid(),
        kind: z.enum(['input', 'confirmation']),
        expiresAt: z.number(),
        planHash: z.string().optional(),
      })
      .strict()
      .optional(),
    plan: planSchema.optional(),
    configHash: z.string().optional(),
    confirmedHash: z.string().optional(),
    bootstrapAttempted: z.boolean().optional(),
    bootstrap: bootstrapSchema.optional(),
    exchange: exchangeSchema.optional(),
    archiveStarted: z.boolean().optional(),
    configured: z.boolean().optional(),
    configBackupPath: z.string().optional(),
    manifestHash: z.string().optional(),
    lastError: z.object({ code: z.string(), retryable: z.boolean() }).strict().optional(),
  })
  .strict();
export type StepState = z.infer<typeof stateSchema>;
export interface StepInput {
  action: 'start' | 'status' | 'continue';
  home: string;
  serverBaseUrl?: string;
  clientType?: ClientType;
  sessionId?: string;
  replyFile?: string;
}
export interface StepResult {
  protocolVersion: 1;
  sessionId: string;
  status: string;
  connectionStatus: 'not_connected' | 'configured' | 'connected';
  gatewayVerification: 'not_started' | 'failed' | 'passed';
  clientReloadRequired: boolean;
  knowledgeImport: 'not_started';
  [key: string]: unknown;
}
export interface StepDeps {
  client: OnboardingClient;
  install: typeof installStepConnection;
  now: () => number;
}

function needsBootstrap(state: StepState, now: number): boolean {
  return !state.bootstrap || (!state.exchange && Date.parse(state.bootstrap.installation.expiresAt) <= now);
}
function publicResult(state: StepState, home: string, now: number): StepResult {
  const expired =
    needsBootstrap(state, now) &&
    state.stage !== 'cancelled' &&
    state.stage !== 'completed' &&
    (state.token ? state.tokenExpiresAt! <= now : state.authorizationExpiresAt <= now);
  const status = expired
    ? 'authorization_expired'
    : (
        {
          authorization: 'authorization_required',
          input: 'input_required',
          confirmation: 'confirmation_required',
          bootstrap: 'configuration_pending',
          install: 'configuration_pending',
          completed: 'completed',
          cancelled: 'cancelled',
        } as const
      )[state.stage];
  return {
    protocolVersion: 1,
    sessionId: state.sessionId,
    status,
    stage: state.stage,
    connectionStatus:
      state.stage === 'completed' ? 'connected' : state.configured ? 'configured' : 'not_connected',
    gatewayVerification:
      state.stage === 'completed' ? 'passed' : state.configured && state.lastError ? 'failed' : 'not_started',
    clientReloadRequired: state.configured === true,
    knowledgeImport: 'not_started',
    hostVerification: 'not_started',
    ...(state.lastError ? { error: state.lastError } : {}),
    ...(status === 'authorization_required'
      ? {
          authorizationUrl: state.authorizationUrl,
          expiresAt: new Date(state.authorizationExpiresAt).toISOString(),
          retryAfterMs: Math.max(0, state.pollAfter - now),
        }
      : {}),
    ...(state.request && !expired
      ? {
          requestId: state.request.id,
          replyExpiresAt: new Date(state.request.expiresAt).toISOString(),
          ...(state.request.planHash ? { planHash: state.request.planHash } : {}),
        }
      : {}),
    ...(state.stage === 'input'
      ? {
          spaces: state.spaces ?? [],
          fields: ['spaceMode', 'spaceName or spaceId', 'agentName', 'role'],
          roles: ['reader', 'editor', 'publisher'],
        }
      : {}),
    ...(state.plan
      ? {
          plan: {
            ...state.plan,
            configuration: { clientType: state.clientType, path: clientConfigPath(state.clientType, home) },
            authorization: {
              server: state.serverBaseUrl,
              account: 'Account explicitly approved in the browser',
            },
          },
        }
      : {}),
    ...(state.bootstrap ? { space: state.bootstrap.space, agent: state.bootstrap.agent } : {}),
    ...(state.configBackupPath ? { configBackupPath: state.configBackupPath } : {}),
    ...(state.manifestHash ? { manifestHash: state.manifestHash } : {}),
    nextAction:
      state.stage === 'completed'
        ? 'Reload the client MCP configuration, then use an actual host tool call to read a known page. Optional knowledge_* import requires a separate preview and confirmation.'
        : expired
          ? 'Run continue without a reply to renew browser authorization for this same session.'
          : state.lastError?.retryable === false
            ? 'Stop and inspect the error or update the server/client. Preserve this session; do not create another Agent or Space.'
            : state.stage === 'cancelled'
              ? 'No further action.'
              : state.stage === 'authorization'
                ? 'Open authorizationUrl, approve in the browser, then run continue after retryAfterMs.'
                : state.request
                  ? 'Ask the user, write a private absolute JSON reply file, then continue with --reply-file.'
                  : 'Run continue without a reply to resume this session.',
  };
}
function confirmedPlanHash(state: StepState, home: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        sessionId: state.sessionId,
        authRevision: state.authRevision,
        serverBaseUrl: state.serverBaseUrl,
        serverPlanHash: hashServerPlan(state.plan as ServerPlan),
        configHash: state.configHash,
        configPath: clientConfigPath(state.clientType, home),
        clientType: state.clientType,
      }),
    )
    .digest('hex');
}
function request(state: StepState, kind: 'input' | 'confirmation', now: number, home: string): void {
  state.request = {
    id: randomUUID(),
    kind,
    // Local installation confirmation remains usable while its bootstrap receipt or
    // exchanged credential can advance without onboarding authorization.
    expiresAt: needsBootstrap(state, now)
      ? Math.min(now + 30 * 60_000, state.tokenExpiresAt!)
      : now + 30 * 60_000,
    ...(kind === 'confirmation' ? { planHash: confirmedPlanHash(state, home) } : {}),
  };
  state.stage = kind;
}
function safeServer(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('SERVER_INVALID: HTTPS or loopback HTTP required');
  return url.href.replace(/\/+$/, '');
}
function authorizedUrl(server: string, url: string): string {
  const result = new URL(url);
  if (result.origin !== new URL(server).origin || result.username || result.password)
    throw new Error('SERVER_INVALID: authorization URL must have the server origin');
  return result.href;
}
export async function runOnboardingSteps(
  input: StepInput,
  overrides: Partial<StepDeps> = {},
): Promise<StepResult> {
  const deps: StepDeps = {
    client: new OnboardingClient(),
    install: installStepConnection,
    now: Date.now,
    ...overrides,
  };
  const sessionId = input.action === 'start' ? randomUUID() : input.sessionId!;
  const path = stepsFile(input.home, sessionId);
  const load = async (): Promise<StepState> => {
    try {
      const state = stateSchema.parse(JSON.parse(await readFile(path, 'utf8')));
      if (state.sessionId !== sessionId) throw new Error();
      return state;
    } catch {
      throw new Error('SESSION_INVALID: session is missing or invalid');
    }
  };
  if (input.action === 'status') return publicResult(await load(), input.home, deps.now());
  return withStepLock(path, async () => {
    if (input.action === 'start') {
      if (!input.serverBaseUrl || !input.clientType)
        throw new Error('INVALID_COMMAND: server and client required');
      const serverBaseUrl = safeServer(input.serverBaseUrl);
      await preflight(input.clientType, input.home, serverBaseUrl);
      const auth = await deps.client.start({
        serverBaseUrl,
        clientType: input.clientType,
        packageVersion: '0.10.0',
        purpose: 'agent-connect',
      });
      const state: StepState = {
        version: 1,
        sessionId,
        serverBaseUrl,
        clientType: input.clientType,
        stage: 'authorization',
        deviceCode: auth.deviceCode,
        authorizationUrl: authorizedUrl(serverBaseUrl, auth.verificationUriComplete),
        authorizationExpiresAt: deps.now() + auth.expiresIn * 1000,
        pollAfter: deps.now() + auth.interval * 1000,
        pollInterval: auth.interval * 1000,
        authRevision: 1,
      };
      await writeStepState(path, stateSchema.parse(state));
      return publicResult(state, input.home, deps.now());
    }
    const state = await load();
    const save = async () => writeStepState(path, stateSchema.parse(state));
    const now = deps.now();
    if (input.replyFile) {
      const reply = await readStepReply(input.replyFile);
      const envelope = z.object({ requestId: z.string() }).passthrough().safeParse(reply);
      if (!envelope.success || !state.request || state.request.id !== envelope.data.requestId)
        throw new Error('REPLY_STALE: no matching current request');
      if (state.request.expiresAt <= now)
        throw new Error('REPLY_EXPIRED: renew this session without a reply');
      if (state.request.kind === 'input') {
        const parsed = z.object({ requestId: z.string(), values: valuesSchema }).strict().safeParse(reply);
        if (!parsed.success) throw new Error('REPLY_INVALID: connection values required');
        const values = parsed.data.values;
        if (values.spaceMode === 'existing' && !state.spaces?.some((space) => space.id === values.spaceId))
          throw new Error('REPLY_INVALID: choose an eligible space ID');
        state.plan = {
          space:
            values.spaceMode === 'create'
              ? { mode: 'create', name: values.spaceName }
              : { mode: 'existing', id: values.spaceId },
          agentName: values.agentName,
          role: values.role,
          packageVersion: '0.10.0',
        };
        state.configHash = (await preflight(state.clientType, input.home, state.serverBaseUrl)).configHash;
        request(state, 'confirmation', now, input.home);
        delete state.lastError;
        await save();
      } else {
        const parsed = z
          .object({ requestId: z.string(), confirmed: z.boolean(), planHash: z.string() })
          .strict()
          .safeParse(reply);
        if (
          !parsed.success ||
          parsed.data.planHash !== state.request.planHash ||
          parsed.data.planHash !== confirmedPlanHash(state, input.home)
        )
          throw new Error('REPLY_INVALID: confirmation hash mismatch');
        if (parsed.data.confirmed) {
          state.confirmedHash = parsed.data.planHash;
          state.stage = needsBootstrap(state, now) ? 'bootstrap' : 'install';
        } else {
          state.stage = 'cancelled';
          delete state.token;
          delete state.exchange;
        }
        delete state.request;
        delete state.lastError;
        await save();
      }
      return publicResult(state, input.home, deps.now());
    }
    if (state.stage === 'completed' || state.stage === 'cancelled')
      return publicResult(state, input.home, now);
    try {
      delete state.lastError;
      if (
        needsBootstrap(state, now) &&
        (state.token ? state.tokenExpiresAt! <= now : state.authorizationExpiresAt <= now)
      ) {
        const auth = await deps.client.renew(state.serverBaseUrl, state.deviceCode);
        if (auth.deviceCode !== state.deviceCode)
          throw new Error('AUTH_RECOVERY_REQUIRED: renewal changed server session');
        state.authorizationUrl = authorizedUrl(state.serverBaseUrl, auth.verificationUriComplete);
        state.authorizationExpiresAt = now + auth.expiresIn * 1000;
        state.pollInterval = auth.interval * 1000;
        state.pollAfter = now + state.pollInterval;
        state.authRevision++;
        state.stage = 'authorization';
        delete state.token;
        delete state.tokenExpiresAt;
        delete state.request;
        delete state.confirmedHash;
        await save();
        return publicResult(state, input.home, deps.now());
      }
      if (state.request && state.request.expiresAt <= now) {
        request(state, state.request.kind, now, input.home);
        await save();
        return publicResult(state, input.home, deps.now());
      }
      if (state.stage === 'authorization') {
        if (now < state.pollAfter) return publicResult(state, input.home, now);
        // Persist the next allowed poll before the network call, including uncertain replies.
        state.pollAfter = now + Math.max(0, state.pollInterval);
        await save();
        const auth = await deps.client.poll(state.serverBaseUrl, state.deviceCode);
        if (auth.status === 'authorized') {
          state.token = auth.onboardingToken;
          state.tokenExpiresAt = now + auth.expiresIn * 1000;
          state.stage = 'input';
          await save();
        } else if (auth.status === 'slow_down') {
          state.pollInterval = Math.max(2000, auth.interval * 1000);
          state.pollAfter = now + state.pollInterval;
          await save();
        } else if (
          auth.status === 'expired' ||
          auth.status === 'denied' ||
          auth.status === 'authorization_consumed'
        ) {
          state.authorizationExpiresAt = 0;
          state.lastError = {
            code: auth.status === 'denied' ? 'AUTH_DENIED' : 'AUTH_EXPIRED',
            retryable: true,
          };
          await save();
        }
        if (auth.status !== 'authorized') return publicResult(state, input.home, deps.now());
      }
      if (state.stage === 'input' && !state.request) {
        state.spaces = await deps.client.spaces(state.serverBaseUrl, state.token!);
        if (state.plan) {
          state.configHash = (await preflight(state.clientType, input.home, state.serverBaseUrl)).configHash;
          request(state, 'confirmation', now, input.home);
        } else request(state, 'input', now, input.home);
        await save();
      } else if (state.stage === 'bootstrap') {
        if (!state.confirmedHash || state.confirmedHash !== confirmedPlanHash(state, input.home))
          throw new Error('CONFIRMATION_REQUIRED: confirmed plan evidence missing');
        const current = await preflight(state.clientType, input.home, state.serverBaseUrl);
        if (current.configHash !== state.configHash) {
          state.configHash = current.configHash;
          request(state, 'confirmation', now, input.home);
          delete state.confirmedHash;
          await save();
          return publicResult(state, input.home, deps.now());
        }
        state.bootstrapAttempted = true;
        await save();
        state.bootstrap = await deps.client.bootstrap({
          serverBaseUrl: state.serverBaseUrl,
          onboardingToken: state.token!,
          idempotencyKey: sessionId,
          serverPlan: state.plan as ServerPlan,
          serverPlanHash: hashServerPlan(state.plan as ServerPlan),
        });
        state.stage = 'install';
        await save();
      } else if (state.stage === 'install') {
        if (!state.confirmedHash || state.confirmedHash !== confirmedPlanHash(state, input.home))
          throw new Error('CONFIRMATION_REQUIRED: confirmed plan evidence missing');
        if (needsBootstrap(state, now)) {
          state.stage = 'bootstrap';
          await save();
          return publicResult(state, input.home, deps.now());
        }
        await withStepLock(`${stepsDirectory(input.home)}/configuration`, async () =>
          deps.install(state, input.home, save),
        );
        state.stage = 'completed';
        delete state.token;
        delete state.exchange;
        state.bootstrap!.installation.code = '';
        await save();
      }
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : (/^([A-Z_]+):/.exec(error instanceof Error ? error.message : '')?.[1] ?? 'REMOTE_UNAVAILABLE');
      state.lastError = {
        code: /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : 'REMOTE_UNAVAILABLE',
        retryable:
          typeof error === 'object' &&
          error !== null &&
          'retryable' in error &&
          typeof error.retryable === 'boolean'
            ? error.retryable
            : !['PACKAGE_INTEGRITY_FAILED', 'TOOLSET_MISMATCH'].includes(code),
      };
      if (code === 'CONFIG_CONFLICT') {
        state.configHash = (await preflight(state.clientType, input.home, state.serverBaseUrl)).configHash;
        request(state, 'confirmation', now, input.home);
        delete state.confirmedHash;
      }
      if (code === 'AUTH_EXPIRED' && needsBootstrap(state, now)) {
        state.tokenExpiresAt = 0;
        state.authorizationExpiresAt = 0;
      }
      await save();
    }
    return publicResult(state, input.home, deps.now());
  });
}
