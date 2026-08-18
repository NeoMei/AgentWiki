import { mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OnboardingError } from '../onboarding/errors.js';
import { contentHash } from '../utils/hash.js';
import { StandardCodeFileSchema, type StandardCodeFile } from './contracts.js';
import { CodeSnapshotManifestSchema, hashCodeSnapshot, type CodeSnapshotManifest, type NormalizedCodeSnapshot } from './normalizer.js';

export interface StoredCodeSnapshot {
  manifest: CodeSnapshotManifest;
  files: StandardCodeFile[];
  filesNdjson: string;
  modulesNdjson: string;
  symbolsNdjson: string;
  relationsNdjson: string;
}

export interface CodeSnapshotStoreOptions {
  home: string;
  /** Test seam placed after staging validation and before the irreversible swap. */
  beforePromote?: () => void | Promise<void>;
}

function invalidSnapshot(message: string, diagnostic: string): OnboardingError {
  const error = new OnboardingError({ code: 'CODE_SNAPSHOT_INVALID', message: `Code snapshot is invalid: ${message}`, retryable: false });
  Object.assign(error, { diagnostic });
  return error;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function fsyncFile(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

function parseNdjson(text: string): unknown[] {
  if (text === '') return [];
  if (!text.endsWith('\n')) throw invalidSnapshot('dataset is not valid NDJSON', 'NDJSON dataset did not end with a newline');
  return text.slice(0, -1).split('\n').map((line) => JSON.parse(line));
}

function expectedFileId(sourceKey: string, path: string): string {
  return contentHash(`${sourceKey}:${path}`);
}

function validateSnapshot(snapshot: StoredCodeSnapshot): StoredCodeSnapshot {
  let manifest: CodeSnapshotManifest;
  try { manifest = CodeSnapshotManifestSchema.parse(snapshot.manifest); } catch (error) {
    throw invalidSnapshot('manifest schema validation failed', error instanceof Error ? error.message : 'Invalid manifest');
  }
  const datasets = {
    files: snapshot.filesNdjson,
    modules: snapshot.modulesNdjson,
    symbols: snapshot.symbolsNdjson,
    relations: snapshot.relationsNdjson,
  };
  for (const [name, content] of Object.entries(datasets)) {
    if (contentHash(content) !== manifest.datasets[name as keyof typeof manifest.datasets]) {
      throw invalidSnapshot('dataset hash mismatch', `Dataset hash mismatch: ${name}`);
    }
  }
  if (hashCodeSnapshot(manifest) !== manifest.snapshotHash) throw invalidSnapshot('snapshot hash mismatch', 'Snapshot manifest hash did not match normalized scanner facts');
  const parsedFiles = parseNdjson(snapshot.filesNdjson).map((entry) => StandardCodeFileSchema.parse(entry));
  if (parsedFiles.length !== manifest.counts.files) throw invalidSnapshot('file count mismatch', 'Manifest file count did not match files dataset');
  const paths = new Set<string>();
  for (const file of parsedFiles) {
    if (paths.has(file.path) || file.fileId !== expectedFileId(manifest.sourceKey, file.path)) {
      throw invalidSnapshot('file identity mismatch', 'Files dataset contained duplicate paths or non-AgentWiki file IDs');
    }
    paths.add(file.path);
  }
  if (snapshot.modulesNdjson !== '' || snapshot.symbolsNdjson !== '' || snapshot.relationsNdjson !== '') {
    throw invalidSnapshot('standard snapshot contains deep datasets', 'Standard snapshot deep datasets must be empty');
  }
  return { ...snapshot, manifest, files: parsedFiles };
}

export class CodeSnapshotStore {
  constructor(private readonly options: CodeSnapshotStoreOptions) {}

  private root(sourceKey: string): string {
    if (!/^[a-f0-9]{64}$/u.test(sourceKey)) throw invalidSnapshot('invalid source key', 'Source key did not match snapshot contract');
    return join(this.options.home, '.agentwiki', 'workspaces', sourceKey, 'codegraph');
  }

  private current(sourceKey: string): string { return join(this.root(sourceKey), 'current'); }

  async write(normalized: NormalizedCodeSnapshot): Promise<CodeSnapshotManifest> {
    const snapshot = validateSnapshot(normalized);
    const root = this.root(snapshot.manifest.sourceKey);
    const current = this.current(snapshot.manifest.sourceKey);
    const backup = join(root, 'backup');
    await mkdir(root, { recursive: true, mode: 0o700 });
    // A prior process may have stopped between current -> backup and staging -> current.
    // Recover before beginning a new replacement; backups are never read as current output.
    try {
      await stat(current);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      try { await rename(backup, current); } catch (backupError) { if (!isNotFound(backupError)) throw backupError; }
    }
    const staging = await mkdtemp(join(root, '.staging-'));
    try {
      const files: Array<[string, string]> = [
        ['snapshot.json', `${JSON.stringify(snapshot.manifest, null, 2)}\n`],
        ['files.ndjson', snapshot.filesNdjson],
        ['modules.ndjson', snapshot.modulesNdjson],
        ['symbols.ndjson', snapshot.symbolsNdjson],
        ['relations.ndjson', snapshot.relationsNdjson],
      ];
      for (const [name, content] of files) {
        const path = join(staging, name);
        await writeFile(path, content, { encoding: 'utf8', mode: 0o600 });
        await fsyncFile(path);
      }
      await fsyncDirectory(staging);
      await this.options.beforePromote?.();

      await rm(backup, { recursive: true, force: true });
      try {
        await rename(current, backup);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      try {
        await rename(staging, current);
      } catch (error) {
        // Once the old current has moved, restore it before exposing any error.
        try { await rename(backup, current); } catch { /* the original error is more useful locally */ }
        throw error;
      }
      await fsyncDirectory(root);
      return snapshot.manifest;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async read(sourceKey: string): Promise<StoredCodeSnapshot | null> {
    const current = this.current(sourceKey);
    try {
      const [manifestRaw, filesNdjson, modulesNdjson, symbolsNdjson, relationsNdjson] = await Promise.all([
        readFile(join(current, 'snapshot.json'), 'utf8'),
        readFile(join(current, 'files.ndjson'), 'utf8'),
        readFile(join(current, 'modules.ndjson'), 'utf8'),
        readFile(join(current, 'symbols.ndjson'), 'utf8'),
        readFile(join(current, 'relations.ndjson'), 'utf8'),
      ]);
      return validateSnapshot({
        manifest: JSON.parse(manifestRaw),
        files: [],
        filesNdjson,
        modulesNdjson,
        symbolsNdjson,
        relationsNdjson,
      });
    } catch (error) {
      if (isNotFound(error)) return null;
      if (error instanceof OnboardingError) throw error;
      throw invalidSnapshot('stored snapshot could not be read', error instanceof Error ? error.message : 'Unknown local storage failure');
    }
  }
}
