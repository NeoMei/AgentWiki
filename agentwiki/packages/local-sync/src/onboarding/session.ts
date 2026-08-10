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
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

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
  waiting_for_confirmation: ['bootstrapping', 'waiting_for_confirmation', 'cancelled', 'failed_recoverable', 'failed_terminal'],
  bootstrapping: ['installing_gateway', 'failed_recoverable', 'failed_terminal'],
  installing_gateway: ['verifying_gateway', 'failed_recoverable', 'failed_terminal'],
  verifying_gateway: ['scanning', 'completed', 'failed_recoverable', 'failed_terminal'],
  scanning: ['waiting_for_sync_confirmation', 'failed_recoverable', 'failed_terminal'],
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
}

export interface SessionStore {
  save(checkpoint: OnboardingCheckpoint): Promise<void>;
  load(): Promise<OnboardingCheckpoint | null>;
  saveSecret(token: string): Promise<void>;
  loadSecret(): Promise<string | null>;
  deleteSecret(): Promise<void>;
  delete(): Promise<void>;
}

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
      await writeAtomically(path, JSON.stringify(stamped, null, 2), 0o600);
    },

    async load(): Promise<OnboardingCheckpoint | null> {
      try {
        const raw = await readFile(path, 'utf8');
        return JSON.parse(raw) as OnboardingCheckpoint;
      } catch {
        return null;
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
