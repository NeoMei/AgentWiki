import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

const AGENTWIKI_DIRECTORY = '.agentwiki';
const PREVIEWS_DIRECTORY = 'previews';
const PREVIEW_TTL_MS = 30 * 60 * 1_000;
const LOCK_MAX_RETRIES = 100;
const LOCK_RETRY_DELAY_MS = 100;

export interface LocalSyncConnection {
  id: string;
  serverUrl: string;
  agentId: string;
  credentialId: string;
  pluginVersion: string;
  client: 'codex' | 'claude' | 'opencode';
  mcpName: string;
}

export interface LocalSyncConfig {
  version: 1;
  defaultConnectionId?: string;
  connections: Record<string, LocalSyncConnection>;
}

export interface CredentialFile {
  version: 1;
  credentials: Record<string, { apiKey: string }>;
}

export interface PreviewFile {
  id: string;
  expiresAt: string;
  envelopePath: string;
  envelopeHash: string;
}

type SourceKeyState = Record<string, string>;

function agentwikiPath(home: string, ...segments: string[]): string {
  return join(home, AGENTWIKI_DIRECTORY, ...segments);
}

function configPath(home: string): string {
  return agentwikiPath(home, 'local-sync.json');
}

function credentialsPath(home: string): string {
  return agentwikiPath(home, 'credentials.json');
}

function syncStatePath(home: string): string {
  return agentwikiPath(home, 'sync-state.json');
}

function previewPath(home: string, previewId: string, suffix: '.json' | '.inflight'): string {
  assertPreviewId(previewId);
  return agentwikiPath(home, PREVIEWS_DIRECTORY, `${previewId}${suffix}`);
}

function assertPreviewId(previewId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(previewId)) {
    throw new Error('Preview ID must contain only letters, numbers, underscores, or hyphens');
  }
}

function defaultConfig(): LocalSyncConfig {
  return { version: 1, connections: {} };
}

function defaultCredentials(): CredentialFile {
  return { version: 1, credentials: {} };
}

async function loadJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const directory = join(path, '..');
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
  const contents = `${JSON.stringify(value, null, 2)}\n`;

  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // ESRCH = process doesn't exist. EPERM = exists but no permission (treat as alive).
    return err?.code === 'EPERM';
  }
}

async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const lockDir = dirname(lockPath);
  await mkdir(lockDir, { recursive: true, mode: 0o700 });

  let acquired = false;
  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(String(process.pid), 'utf8');
      await handle.close();
      acquired = true;
      break;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      // Lock exists — check if holder is alive
      try {
        const content = await readFile(lockPath, 'utf8');
        const lockPid = parseInt(content.trim(), 10);
        if (!Number.isNaN(lockPid) && isProcessAlive(lockPid)) {
          await sleep(LOCK_RETRY_DELAY_MS);
          continue;
        }
        // PID is dead — safe to reclaim
        await unlink(lockPath);
      } catch (err: any) {
        if (err?.code === 'ENOENT') continue; // someone else cleaned it up
        throw err;
      }
    }
  }

  if (!acquired) {
    throw new Error(`Timed out waiting for lock ${lockPath}`);
  }

  try {
    return await fn();
  } finally {
    // We are alive (we're executing this code). process.kill(ourPid, 0)
    // succeeds for any concurrent checker, so no one reclaimed our lock.
    // Safe to unlink — this can never delete another live holder's lock.
    try { await unlink(lockPath); } catch {}
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isExpired(preview: PreviewFile): boolean {
  const expiresAt = Date.parse(preview.expiresAt);
  return Number.isNaN(expiresAt) || expiresAt <= Date.now();
}

export async function loadConfig(home: string): Promise<LocalSyncConfig> {
  return loadJson(configPath(home), defaultConfig());
}

export async function saveConfig(home: string, config: LocalSyncConfig): Promise<void> {
  await writeJsonAtomically(configPath(home), config);
}

export async function loadCredentials(home: string): Promise<CredentialFile> {
  return loadJson(credentialsPath(home), defaultCredentials());
}

export async function saveCredentials(home: string, credentials: CredentialFile): Promise<void> {
  await writeJsonAtomically(credentialsPath(home), credentials);
}

export async function getOrCreateSourceKey(home: string, sourcePath: string): Promise<string> {
  if (!isAbsolute(sourcePath)) {
    throw new Error('Source path must be absolute');
  }

  const statePath = syncStatePath(home);
  return withLock(`${statePath}.lock`, async () => {
    const state = await loadJson<SourceKeyState>(statePath, {});
    const existing = state[sourcePath];
    if (existing) {
      return existing;
    }

    const sourceKey = randomUUID();
    state[sourcePath] = sourceKey;
    await writeJsonAtomically(statePath, state);
    return sourceKey;
  });
}

export async function savePreview(home: string, preview: PreviewFile): Promise<void> {
  if (isExpired(preview) || Date.parse(preview.expiresAt) > Date.now() + PREVIEW_TTL_MS) {
    throw new Error('Preview expiry must be within 30 minutes');
  }

  await writeJsonAtomically(previewPath(home, preview.id, '.json'), preview);
}

export async function claimPreview(home: string, previewId: string): Promise<PreviewFile> {
  const availablePath = previewPath(home, previewId, '.json');
  const inflightPath = previewPath(home, previewId, '.inflight');

  try {
    await rename(availablePath, inflightPath);
  } catch (error: unknown) {
    if (!isNotFound(error)) {
      throw error;
    }

    let inflight: PreviewFile;
    try {
      inflight = JSON.parse(await readFile(inflightPath, 'utf8')) as PreviewFile;
    } catch (inflightError: unknown) {
      if (!isNotFound(inflightError)) {
        throw inflightError;
      }
      throw new Error(`Preview ${previewId} was not found or expired`, { cause: inflightError });
    }

    if (isExpired(inflight)) {
      await rm(inflightPath, { force: true });
      throw new Error(`Preview ${previewId} was not found or expired`, { cause: error });
    }

    throw new Error(`Preview ${previewId} is already in progress`, { cause: error });
  }

  const preview = JSON.parse(await readFile(inflightPath, 'utf8')) as PreviewFile;
  if (isExpired(preview)) {
    await rm(inflightPath, { force: true });
    throw new Error(`Preview ${previewId} was not found or expired`);
  }

  return preview;
}

export async function releasePreview(home: string, previewId: string): Promise<void> {
  try {
    await rename(previewPath(home, previewId, '.inflight'), previewPath(home, previewId, '.json'));
  } catch (error: unknown) {
    if (isNotFound(error)) {
      throw new Error(`Preview ${previewId} is not in progress`, { cause: error });
    }
    throw error;
  }
}

export async function completePreview(home: string, previewId: string): Promise<void> {
  await rm(previewPath(home, previewId, '.inflight'), { force: true });
}
