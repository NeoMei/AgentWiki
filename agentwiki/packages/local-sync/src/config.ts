import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const AGENTWIKI_DIRECTORY = '.agentwiki';
const PREVIEWS_DIRECTORY = 'previews';
const SOURCE_KEYS_DIRECTORY = 'source-keys';
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
  version: 2;
  credentials: Record<string, { apiKey: string; syncDeviceCredential?: string }>;
}

export interface LegacyCredentialFileV1 {
  version: 1;
  credentials: Record<string, { apiKey: string }>;
}

export interface PreviewFile {
  id: string;
  expiresAt: string;
  envelopePath: string;
  envelopeHash: string;
}

function agentwikiPath(home: string, ...segments: string[]): string {
  return join(home, AGENTWIKI_DIRECTORY, ...segments);
}

function configPath(home: string): string {
  return agentwikiPath(home, 'local-sync.json');
}

function credentialsPath(home: string): string {
  return agentwikiPath(home, 'credentials.json');
}

function previewPath(home: string, previewId: string, suffix: '.json' | '.inflight'): string {
  assertPreviewId(previewId);
  return agentwikiPath(home, PREVIEWS_DIRECTORY, `${previewId}${suffix}`);
}

export function assertPreviewId(previewId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(previewId)) {
    throw new Error('Preview ID must be a UUID');
  }
}

function defaultConfig(): LocalSyncConfig {
  return { version: 1, connections: {} };
}

function defaultCredentials(): CredentialFile {
  return { version: 2, credentials: {} };
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
  const raw = await loadJson<unknown>(credentialsPath(home), defaultCredentials());
  const credentials = parseCredentials(raw);
  if ((raw as { version?: unknown }).version === 1) {
    await writeJsonAtomically(credentialsPath(home), credentials);
  }
  return credentials;
}

export async function saveCredentials(home: string, credentials: CredentialFile | LegacyCredentialFileV1): Promise<void> {
  await writeJsonAtomically(credentialsPath(home), parseCredentials(credentials));
}

function parseCredentials(value: unknown): CredentialFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Credential file must be an object');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.version === 'number' && record.version > 2) {
    throw new TypeError('Credential file uses a future version');
  }
  if (record.version !== 1 && record.version !== 2) {
    throw new TypeError('Credential file version is unsupported');
  }
  if (Object.keys(record).some((key) => key !== 'version' && key !== 'credentials')) {
    throw new TypeError('Credential file contains unknown fields');
  }
  if (!record.credentials || typeof record.credentials !== 'object' || Array.isArray(record.credentials)) {
    throw new TypeError('Credential file credentials must be an object');
  }
  const credentials: CredentialFile['credentials'] = {};
  for (const [credentialId, rawCredential] of Object.entries(record.credentials as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(credentialId)
      || !rawCredential || typeof rawCredential !== 'object' || Array.isArray(rawCredential)) {
      throw new TypeError('Credential file contains an invalid credential entry');
    }
    const credential = rawCredential as Record<string, unknown>;
    const allowed = record.version === 1 ? ['apiKey'] : ['apiKey', 'syncDeviceCredential'];
    if (Object.keys(credential).some((key) => !allowed.includes(key))
      || typeof credential.apiKey !== 'string' || credential.apiKey.length === 0
      || (credential.syncDeviceCredential !== undefined
        && (typeof credential.syncDeviceCredential !== 'string' || credential.syncDeviceCredential.length === 0))) {
      throw new TypeError('Credential file contains an invalid credential secret');
    }
    credentials[credentialId] = {
      apiKey: credential.apiKey,
      ...(typeof credential.syncDeviceCredential === 'string'
        ? { syncDeviceCredential: credential.syncDeviceCredential }
        : {}),
    };
  }
  return { version: 2, credentials };
}

export async function getOrCreateSourceKey(home: string, sourcePath: string): Promise<string> {
  if (!isAbsolute(sourcePath)) {
    throw new Error('Source path must be absolute');
  }

  const pathHash = createHash('sha256').update(sourcePath).digest('hex');
  const keyDirectory = agentwikiPath(home, SOURCE_KEYS_DIRECTORY);
  const keyPath = join(keyDirectory, pathHash);
  await mkdir(keyDirectory, { recursive: true, mode: 0o700 });

  try {
    const key = (await readFile(keyPath, 'utf8')).trim();
    if (key) return key;
  } catch (error: unknown) {
    if (!isNotFound(error)) throw error;
  }

  const sourceKey = randomUUID();
  const temporaryPath = join(keyDirectory, `.${pathHash}.${randomUUID()}.tmp`);
  await writeFile(temporaryPath, `${sourceKey}\n`, { encoding: 'utf8', mode: 0o600 });

  try {
    await link(temporaryPath, keyPath);
    return sourceKey;
  } catch (error: unknown) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')) {
      throw error;
    }

    const key = (await readFile(keyPath, 'utf8')).trim();
    if (key) return key;
      throw new Error('Source key file exists but is empty', { cause: error });
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
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
