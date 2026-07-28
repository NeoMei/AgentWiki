import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const AGENTWIKI_DIRECTORY = '.agentwiki';
const PREVIEWS_DIRECTORY = 'previews';
const PREVIEW_TTL_MS = 30 * 60 * 1_000;

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

  const state = await loadJson<SourceKeyState>(syncStatePath(home), {});
  const existing = state[sourcePath];
  if (existing) {
    return existing;
  }

  const sourceKey = randomUUID();
  state[sourcePath] = sourceKey;
  await writeJsonAtomically(syncStatePath(home), state);
  return sourceKey;
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

    try {
      await readFile(inflightPath);
    } catch (inflightError: unknown) {
      if (!isNotFound(inflightError)) {
        throw inflightError;
      }
      throw new Error(`Preview ${previewId} was not found or expired`, { cause: inflightError });
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
