/**
 * Secure local session persistence for onboarding.
 *
 * Non-secret state lives at ~/.agentwiki/onboarding/<sessionId>.json.
 * The short-lived onboarding token lives beside it in
 * <sessionId>.secret.json and is deleted immediately after bootstrap.
 *
 * Both files are 0600; the directory is 0700. No Agent API key is ever
 * persisted in either file.
 */
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentAccessRoleSchema } from '@neomei/agentwiki-sync-protocol';
import { hashServerPlan, type ServerPlan } from './plan-hash.js';
import { hashOnboardingPlan } from './local-plan-hash.js';
import { PublicRelativeDisplayPathSchema } from '../codegraph/contracts.js';

export type OnboardingState =
  | 'collecting_input'
  | 'waiting_for_web_auth'
  | 'preflight'
  | 'waiting_for_confirmation'
  | 'bootstrapping'
  | 'installing_gateway'
  | 'verifying_gateway'
  | 'scanning'
  | 'waiting_for_sync_confirmation'
  | 'syncing'
  | 'completed'
  | 'failed_recoverable'
  | 'failed_terminal'
  | 'cancelled';

const TERMINAL_STATES: ReadonlySet<OnboardingState> = new Set([
  'completed',
  'failed_recoverable',
  'failed_terminal',
  'cancelled',
]);

export function isTerminalState(state: OnboardingState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Legal forward transitions; everything else is rejected to prevent skips. */

const TRANSITIONS: Record<OnboardingState, OnboardingState[]> = {
  collecting_input: ['waiting_for_web_auth', 'cancelled', 'failed_recoverable', 'failed_terminal'],
  waiting_for_web_auth: ['preflight', 'waiting_for_web_auth', 'cancelled', 'failed_recoverable', 'failed_terminal'],
  preflight: ['waiting_for_confirmation', 'cancelled', 'failed_recoverable', 'failed_terminal'],
  waiting_for_confirmation: ['bootstrapping', 'scanning', 'waiting_for_confirmation', 'cancelled', 'failed_recoverable', 'failed_terminal'],
  bootstrapping: ['installing_gateway', 'failed_recoverable', 'failed_terminal'],
  installing_gateway: ['verifying_gateway', 'failed_recoverable', 'failed_terminal'],
  verifying_gateway: ['scanning', 'completed', 'failed_recoverable', 'failed_terminal'],
  scanning: ['waiting_for_confirmation', 'waiting_for_sync_confirmation', 'completed', 'failed_recoverable', 'failed_terminal'],
  waiting_for_sync_confirmation: ['syncing', 'waiting_for_sync_confirmation', 'cancelled', 'failed_recoverable', 'failed_terminal'],
  syncing: ['completed', 'failed_recoverable', 'failed_terminal'],
  completed: [],
  failed_recoverable: ['collecting_input', 'waiting_for_web_auth', 'preflight', 'waiting_for_confirmation', 'bootstrapping', 'installing_gateway', 'verifying_gateway', 'scanning', 'waiting_for_sync_confirmation', 'syncing', 'cancelled', 'failed_terminal'],
  failed_terminal: [],
  cancelled: [],
};

export function canTransition(from: OnboardingState, to: OnboardingState): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Fields that may legitimately appear in the persisted checkpoint. */
export interface OnboardingCheckpoint {
  sessionId: string;
  state: OnboardingState;
  protocolVersion: number;
  serverUrl: string;
  clientType: 'codex' | 'claude' | 'opencode';
  createdAt: string;
  updatedAt: string;
  /** Input values collected from the user (space, agent, sources). */
  inputs?: Record<string, unknown>;
  /** Device-flow identifiers needed to resume polling. */
  deviceCode?: string;
  userCode?: string;
  verificationUri?: string;
  /** Hex digest of the confirmed server plan. */
  serverPlanHash?: string;
  /** Hex digest of the confirmed local CodeGraph plan, when code is present. */
  localScanPlanHash?: string;
  /** Composite hash confirmed by the user; binds server and local child hashes. */
  onboardingPlanHash?: string;
  /** Redacted local plan preview; never contains executable, canonical, or index paths. */
  localScanPlan?: Record<string, unknown>;
  serverPlan?: Record<string, unknown>;
  /** Bootstrap-issued resource IDs. */
  bootstrapResult?: Record<string, unknown>;
  /** Scan job identifiers for resume after sync confirmation. */
  jobId?: string;
  previewHash?: string;
  /** Error code from the last failure (recoverable only). */
  lastErrorCode?: string;
  /** Human-readable resume hint. */
  resumeHint?: string;
  /** Last non-terminal state used to continue a recoverable session. */
  resumeState?: Exclude<OnboardingState, 'failed_recoverable' | 'failed_terminal' | 'cancelled' | 'completed'>;
}

export interface SessionStore {
  save(checkpoint: OnboardingCheckpoint): Promise<void>;
  load(): Promise<OnboardingCheckpoint | null>;
  saveSecret(token: string): Promise<void>;
  loadSecret(): Promise<string | null>;
  deleteSecret(): Promise<void>;
  delete(): Promise<void>;
}

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);

const textSchema = z.string().min(1).refine((value) => ![...value].some((character) => { const codePoint = character.codePointAt(0)!; return codePoint <= 0x1f || codePoint === 0x7f; }), 'Text must not contain control characters');
const opaqueIdSchema = textSchema.refine((value) => !/[\\/]/u.test(value), 'Identifier must not contain path separators');
const canonicalSourcePathSchema = textSchema.superRefine((value, context) => {
  if (!isAbsolute(value) || value.includes('\\') || normalize(value) !== value) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Source path must be a canonical absolute path' });
  }
});
const inputOptionsShape = {
  agentName: textSchema,
  role: AgentAccessRoleSchema,
  clientType: z.enum(['codex', 'claude', 'opencode']),
  sourcePaths: z.array(canonicalSourcePathSchema).min(1),
  sourceType: z.enum(['auto', 'code', 'documents']),
  analysisMode: z.enum(['standard', 'deep']),
  configHash: hashSchema.optional(),
  oldEntries: z.array(opaqueIdSchema).optional(),
  reloadRequired: z.boolean().optional(),
  connectionId: z.string().uuid().optional(),
  manifestHash: hashSchema.optional(),
};

/**
 * The complete non-secret input/checkpoint surface.  This deliberately covers
 * both user values and coordinator-owned preflight/setup metadata, so a
 * persisted checkpoint cannot smuggle arbitrary nested configuration through
 * the resume path.
 */
export const OnboardingInputsSchema = z.discriminatedUnion('spaceMode', [
  z.object({
    ...inputOptionsShape,
    spaceMode: z.literal('create'),
    spaceName: textSchema,
  }).strict(),
  z.object({
    ...inputOptionsShape,
    spaceMode: z.literal('existing'),
    spaceId: opaqueIdSchema,
  }).strict(),
]);
export type OnboardingInputs = z.infer<typeof OnboardingInputsSchema>;
const localPlanPreviewSchema = z.object({
  schemaVersion: z.literal('agentwiki-local-scan-plan@1'),
  provider: z.literal('codegraph'),
  detectedVersion: z.string().min(1),
  capabilities: z.object({
    required: z.object({ 'index.status': z.boolean(), 'index.sync': z.boolean(), 'files.list': z.boolean() }).strict(),
    optional: z.object({ 'symbols.list': z.boolean(), 'relations.read': z.boolean(), 'semantic.explore': z.boolean(), 'impact.read': z.boolean(), 'routes.read': z.boolean() }).strict(),
  }).strict(),
  analysisMode: z.enum(['standard', 'deep']),
  limits: z.object({ maxFiles: z.number().int().positive(), maxGeneratedBytes: z.number().int().positive() }).strict(),
  localScanPlanHash: hashSchema,
  sources: z.array(z.object({
    sourceKey: hashSchema, displayPath: PublicRelativeDisplayPathSchema, action: z.enum(['none', 'init', 'sync', 'rebuild']),
    indexState: z.enum(['missing', 'ready', 'stale', 'incomplete', 'failed']), estimatedFiles: z.number().int().nonnegative(),
  }).strict()).min(1),
}).strict();

const serverPlanSchema = z.object({
  space: z.union([z.object({ mode: z.literal('create'), name: z.string().min(1) }).strict(), z.object({ mode: z.literal('existing'), id: z.string().min(1) }).strict()]),
  agentName: z.string().min(1), role: AgentAccessRoleSchema, packageVersion: z.literal('0.7.0'),
}).strict();
const bootstrapSummarySchema = z.object({
  space: z.object({ id: z.string().min(1), name: z.string().min(1) }).strict(),
  agent: z.object({ id: z.string().min(1), name: z.string().min(1) }).strict().optional(),
  revisionId: z.string().min(1).optional(), status: z.string().min(1).optional(), submissionId: z.string().min(1).optional(), changeSetId: z.string().min(1).nullable().optional(),
}).strict();

const checkpointSchema = z.object({
  sessionId: opaqueIdSchema, state: z.enum(['collecting_input', 'waiting_for_web_auth', 'preflight', 'waiting_for_confirmation', 'bootstrapping', 'installing_gateway', 'verifying_gateway', 'scanning', 'waiting_for_sync_confirmation', 'syncing', 'completed', 'failed_recoverable', 'failed_terminal', 'cancelled']),
  protocolVersion: z.number().int().positive(), serverUrl: z.string().url(), clientType: z.enum(['codex', 'claude', 'opencode']),
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
  inputs: OnboardingInputsSchema.optional(), deviceCode: textSchema.optional(), userCode: textSchema.optional(), verificationUri: z.string().url().optional(),
  serverPlanHash: hashSchema.optional(), localScanPlanHash: hashSchema.optional(), onboardingPlanHash: hashSchema.optional(),
  serverPlan: serverPlanSchema.optional(), localScanPlan: localPlanPreviewSchema.optional(), bootstrapResult: bootstrapSummarySchema.optional(),
  jobId: z.string().min(1).optional(), previewHash: z.string().min(1).optional(), lastErrorCode: z.string().min(1).optional(), resumeHint: z.string().min(1).optional(),
  resumeState: z.enum(['collecting_input', 'waiting_for_web_auth', 'preflight', 'waiting_for_confirmation', 'bootstrapping', 'installing_gateway', 'verifying_gateway', 'scanning', 'waiting_for_sync_confirmation', 'syncing']).optional(),
}).strict().superRefine((checkpoint, context) => {
  const postConfirmation = new Set<OnboardingState>([
    'bootstrapping', 'installing_gateway', 'verifying_gateway', 'scanning',
    'waiting_for_sync_confirmation', 'syncing', 'completed',
  ]).has(checkpoint.state);
  const bootstrapRequired = new Set<OnboardingState>([
    'installing_gateway', 'verifying_gateway', 'scanning',
    'waiting_for_sync_confirmation', 'syncing', 'completed',
  ]).has(checkpoint.state);
  const localPresent = checkpoint.localScanPlanHash !== undefined;
  if (localPresent !== (checkpoint.localScanPlan !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'local scan plan and hash must be present together' });
  if (checkpoint.localScanPlan && checkpoint.localScanPlanHash !== checkpoint.localScanPlan.localScanPlanHash) context.addIssue({ code: z.ZodIssueCode.custom, message: 'local scan plan hash mismatch', path: ['localScanPlanHash'] });
  if (checkpoint.serverPlan && checkpoint.serverPlanHash && hashServerPlan(checkpoint.serverPlan as ServerPlan) !== checkpoint.serverPlanHash) context.addIssue({ code: z.ZodIssueCode.custom, message: 'server plan hash mismatch', path: ['serverPlanHash'] });
  if (checkpoint.onboardingPlanHash !== undefined) {
    if (!checkpoint.serverPlanHash || checkpoint.onboardingPlanHash !== hashOnboardingPlan({ serverPlanHash: checkpoint.serverPlanHash, ...(checkpoint.localScanPlanHash ? { localScanPlanHash: checkpoint.localScanPlanHash } : {}) })) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'onboarding plan hash mismatch', path: ['onboardingPlanHash'] });
    }
  }
  if (!postConfirmation) return;

  if (!checkpoint.inputs || !checkpoint.serverPlan || !checkpoint.serverPlanHash || !checkpoint.onboardingPlanHash) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'post-confirmation checkpoint is missing plan evidence' });
  }
  if (checkpoint.inputs?.role !== 'reader' && checkpoint.inputs?.sourceType === 'code' && (!checkpoint.localScanPlan || !checkpoint.localScanPlanHash)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'code checkpoint is missing local scan consent' });
  }
  if (checkpoint.inputs?.sourceType === 'documents' && (checkpoint.localScanPlan || checkpoint.localScanPlanHash)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'document checkpoint must not carry local scan consent' });
  }
  if (bootstrapRequired && !checkpoint.bootstrapResult) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'post-bootstrap checkpoint is missing bootstrap summary' });
  }
});

export function onboardingDir(home: string = homedir()): string {
  return join(home, '.agentwiki', 'onboarding');
}

export function sessionFilePath(sessionId: string, home: string = homedir()): string {
  return join(onboardingDir(home), `${sessionId}.json`);
}

export function secretFilePath(sessionId: string, home: string = homedir()): string {
  return join(onboardingDir(home), `${sessionId}.secret.json`);
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

async function writeAtomically(path: string, contents: string, mode: 0o600 | 0o700): Promise<void> {
  const dir = join(path, '..');
  await ensureDir(dir);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { encoding: 'utf8', mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

export function createSessionStore(
  sessionId: string,
  home: string = homedir(),
): SessionStore {
  const path = sessionFilePath(sessionId, home);
  const secretPath = secretFilePath(sessionId, home);

  return {
    async save(checkpoint: OnboardingCheckpoint): Promise<void> {
      const stamped: OnboardingCheckpoint = {
        ...checkpoint,
        sessionId,
        updatedAt: new Date().toISOString(),
      };
      const verified = checkpointSchema.parse(stamped);
      await writeAtomically(path, JSON.stringify(verified, null, 2), 0o600);
    },

    async load(): Promise<OnboardingCheckpoint | null> {
      try {
        const raw = await readFile(path, 'utf8');
        return checkpointSchema.parse(JSON.parse(raw)) as OnboardingCheckpoint;
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
        const stateError = new Error('stored onboarding state is invalid');
        Object.assign(stateError, { diagnostic: error instanceof Error ? error.message : String(error) });
        throw stateError;
      }
    },

    async saveSecret(token: string): Promise<void> {
      await writeAtomically(secretPath, JSON.stringify({ token }), 0o600);
    },

    async loadSecret(): Promise<string | null> {
      try {
        const raw = await readFile(secretPath, 'utf8');
        const parsed = JSON.parse(raw) as { token: string };
        return parsed.token ?? null;
      } catch {
        return null;
      }
    },

    async deleteSecret(): Promise<void> {
      try {
        await unlink(secretPath);
      } catch {
        // Already removed — idempotent.
      }
    },

    async delete(): Promise<void> {
      try {
        await unlink(path);
      } catch {
        // idempotent
      }
      try {
        await unlink(secretPath);
      } catch {
        // idempotent
      }
    },
  };
}

/** Validate a forward state transition or throw with a clear message. */
export function assertTransition(from: OnboardingState, to: OnboardingState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal onboarding transition: ${from} → ${to}`);
  }
}
