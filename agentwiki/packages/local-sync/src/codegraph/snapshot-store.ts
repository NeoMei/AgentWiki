import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { OnboardingError } from '../onboarding/errors.js';
import { contentHash } from '../utils/hash.js';
import { StandardCodeFileSchema, type StandardCodeFile } from './contracts.js';
import { CodeSnapshotManifestSchema, hashCodeSnapshot, type CodeSnapshotManifest, type NormalizedCodeSnapshot } from './normalizer.js';
import { SourceLock, type SourceLockLease } from './source-lock.js';

export interface StoredCodeSnapshot { manifest: CodeSnapshotManifest; files: StandardCodeFile[]; filesNdjson: string; modulesNdjson: string; symbolsNdjson: string; relationsNdjson: string; }
type DirectoryIdentity = Readonly<{ path: string; dev: bigint; ino: bigint }>;
type MutationStage = 'before-staging-create' | 'before-staging-write' | 'before-current-to-backup' | 'before-staging-to-current' | 'before-backup-recovery' | 'before-cleanup';
const DATASETS = ['snapshot.json', 'files.ndjson', 'modules.ndjson', 'symbols.ndjson', 'relations.ndjson'] as const;
const DEFAULT_MAX_BYTES = 1_000_000;

export interface CodeSnapshotStoreOptions {
  home: string; maxSnapshotBytes?: number; beforePromote?: () => void | Promise<void>; afterStageWrite?: (staging: string) => void | Promise<void>;
  renameDirectory?: (from: string, to: string) => Promise<void>; fsyncDirectory?: (path: string, checkpoint: string) => Promise<void>;
  /** Internal filesystem-race test seam. */ beforeMutation?: (stage: MutationStage) => void | Promise<void>;
  /** Internal filesystem-race test seam. */ afterPathCheck?: (subject: { path: string; kind: 'file' | 'directory' }) => void | Promise<void>;
  /** POSIX requires both secure-open flags; Windows relies on identity rechecks and O_EXCL. */ platform?: { name?: NodeJS.Platform; O_NOFOLLOW: number | undefined; O_DIRECTORY: number | undefined };
}

function invalidSnapshot(message: string, diagnostic: string): OnboardingError { const error = new OnboardingError({ code: 'CODE_SNAPSHOT_INVALID', message: `Code snapshot is invalid: ${message}`, retryable: false }); Object.assign(error, { diagnostic }); return error; }
const missing = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
export const sameSnapshotIdentityForTest = (left: Pick<DirectoryIdentity, 'dev' | 'ino'>, right: Pick<DirectoryIdentity, 'dev' | 'ino'>) => left.dev === right.dev && left.ino === right.ino;
const sameDirectory = sameSnapshotIdentityForTest;
function parseNdjson(text: string): unknown[] { if (text === '') return []; if (!text.endsWith('\n')) throw invalidSnapshot('dataset is not valid NDJSON', 'NDJSON dataset did not end with a newline'); return text.slice(0, -1).split('\n').map((line) => JSON.parse(line)); }
function expectedFileId(sourceKey: string, path: string): string { return contentHash(`${sourceKey}:${path}`); }
function validateSnapshot(snapshot: StoredCodeSnapshot): StoredCodeSnapshot {
  let manifest: CodeSnapshotManifest;
  try { manifest = CodeSnapshotManifestSchema.parse(snapshot.manifest); } catch (error) { throw invalidSnapshot('manifest schema validation failed', error instanceof Error ? error.message : 'Invalid manifest'); }
  const datasets = { files: snapshot.filesNdjson, modules: snapshot.modulesNdjson, symbols: snapshot.symbolsNdjson, relations: snapshot.relationsNdjson };
  for (const [name, content] of Object.entries(datasets)) if (contentHash(content) !== manifest.datasets[name as keyof typeof manifest.datasets]) throw invalidSnapshot('dataset hash mismatch', `Dataset hash mismatch: ${name}`);
  if (hashCodeSnapshot(manifest) !== manifest.snapshotHash) throw invalidSnapshot('snapshot hash mismatch', 'Snapshot manifest hash did not match normalized scanner facts');
  const parsedFiles = parseNdjson(snapshot.filesNdjson).map((entry) => StandardCodeFileSchema.parse(entry));
  if (parsedFiles.length !== manifest.counts.files) throw invalidSnapshot('file count mismatch', 'Manifest file count did not match files dataset');
  let previousPath: string | null = null;
  for (const file of parsedFiles) { if ((previousPath !== null && previousPath >= file.path) || file.fileId !== expectedFileId(manifest.sourceKey, file.path)) throw invalidSnapshot('file dataset ordering or identity mismatch', 'Files dataset was not strictly code-unit sorted or used non-AgentWiki file IDs'); previousPath = file.path; }
  if (snapshot.modulesNdjson !== '' || snapshot.symbolsNdjson !== '' || snapshot.relationsNdjson !== '') throw invalidSnapshot('standard snapshot contains deep datasets', 'Standard snapshot deep datasets must be empty');
  return { ...snapshot, manifest, files: parsedFiles };
}

/** Node lacks openat here. Private 0700 roots, O_NOFOLLOW descriptor opens,
 * and inode rechecks fail closed for observed swaps, but are not an openat
 * guarantee against a malicious same-UID actor that swaps paths back between observations. */
export class CodeSnapshotStore {
  private readonly workspaceRoot: string; private readonly lockRoot: string; private readonly lock: SourceLock; private readonly flags: { noFollow: number; directory: number }; private readonly isWindows: boolean; private readonly maxBytes: number;
  constructor(private readonly options: CodeSnapshotStoreOptions) {
    this.workspaceRoot = join(options.home, '.agentwiki', 'workspaces'); this.lockRoot = join(this.workspaceRoot, '.codegraph-snapshot-locks');
    const platform = options.platform ?? { name: process.platform, O_NOFOLLOW: constants.O_NOFOLLOW, O_DIRECTORY: constants.O_DIRECTORY }; const noFollow = platform.O_NOFOLLOW; const directory = platform.O_DIRECTORY;
    this.isWindows = platform.name === 'win32';
    if (!this.isWindows && (!Number.isSafeInteger(noFollow) || !noFollow || !Number.isSafeInteger(directory) || !directory)) throw invalidSnapshot('platform lacks required secure-open flags', 'O_NOFOLLOW and O_DIRECTORY must be non-zero');
    this.flags = { noFollow: this.isWindows ? 0 : noFollow as number, directory: this.isWindows ? 0 : directory as number }; this.maxBytes = options.maxSnapshotBytes ?? DEFAULT_MAX_BYTES;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0) throw invalidSnapshot('snapshot byte limit was invalid', 'maxSnapshotBytes must be a positive integer');
    this.lock = new SourceLock({ root: this.lockRoot, platform: this.isWindows ? 'win32' : platform.name });
  }
  private root(sourceKey: string) { if (!/^[a-f0-9]{64}$/u.test(sourceKey)) throw invalidSnapshot('invalid source key', 'Source key did not match snapshot contract'); return join(this.workspaceRoot, sourceKey, 'codegraph'); }
  private current(sourceKey: string) { return join(this.root(sourceKey), 'current'); }
  private assertInside(root: string, target: string) { const value = relative(resolve(root), resolve(target)); if (value === '' || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`))) return; throw invalidSnapshot('private snapshot path escaped its root', 'Snapshot path traversal'); }
  private async directory(path: string): Promise<DirectoryIdentity> { let value; try { value = await lstat(path, { bigint: true }); } catch (error) { throw invalidSnapshot('private snapshot directory was missing', error instanceof Error ? error.message : 'Missing directory'); } if (!value.isDirectory() || value.isSymbolicLink() || (!this.isWindows && (value.mode & 0o077n) !== 0n)) throw invalidSnapshot('private snapshot directory was unsafe', 'Directory was not a private real directory'); return { path, dev: value.dev, ino: value.ino }; }
  private async ensureDirectory(path: string): Promise<DirectoryIdentity> { await mkdir(path, { recursive: true, mode: 0o700 }); return this.directory(path); }
  private async assertDirectories(entries: readonly DirectoryIdentity[]) { for (const expected of entries) { const current = await this.directory(expected.path); if (!sameDirectory(expected, current)) throw invalidSnapshot('private snapshot directory changed during operation', 'Directory device/inode identity mismatch'); } }
  private async present(path: string) { try { await lstat(path); return true; } catch (error) { if (missing(error)) return false; throw error; } }
  private async directories(sourceKey: string, leaf?: string, create = false): Promise<DirectoryIdentity[]> {
    const source = join(this.workspaceRoot, sourceKey); const root = this.root(sourceKey); const paths = [join(this.options.home, '.agentwiki'), this.workspaceRoot, source, root, ...(leaf ? [join(root, leaf)] : [])]; const result: DirectoryIdentity[] = [];
    for (const path of paths) { this.assertInside(this.options.home, path); result.push(create ? await this.ensureDirectory(path) : await this.directory(path)); }
    for (const entry of result) await this.options.afterPathCheck?.({ path: entry.path, kind: 'directory' }); await this.assertDirectories(result); return result;
  }
  private async prepareLockRoot() { const prefix = [await this.ensureDirectory(join(this.options.home, '.agentwiki')), await this.ensureDirectory(this.workspaceRoot)]; await this.assertDirectories(prefix); const lockRoot = await this.ensureDirectory(this.lockRoot); await this.assertDirectories([...prefix, lockRoot]); }
  private async sync(path: string, checkpoint: string) { if (this.options.fsyncDirectory) return this.options.fsyncDirectory(path, checkpoint); if (this.isWindows) return; const handle = await open(path, constants.O_RDONLY | this.flags.directory | this.flags.noFollow); try { await handle.sync(); } finally { await handle.close(); } }
  private async readSecure(directories: readonly DirectoryIdentity[], name: string): Promise<string> {
    const root = directories.at(-1)!.path; const path = join(root, name); this.assertInside(root, path); let before;
    try { before = await lstat(path, { bigint: true }); } catch (error) { throw invalidSnapshot('snapshot file was missing', error instanceof Error ? error.message : 'Missing file'); }
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(this.maxBytes)) throw invalidSnapshot('snapshot file was unsafe or exceeded its byte cap', 'Unsafe snapshot file');
    await this.options.afterPathCheck?.({ path, kind: 'file' }); await this.assertDirectories(directories); let handle;
    try { handle = await open(path, constants.O_RDONLY | this.flags.noFollow); } catch (error) { throw invalidSnapshot('snapshot file could not be opened safely', error instanceof Error ? error.message : 'Unsafe snapshot file'); }
    try { const opened = await handle.stat({ bigint: true }); if (!opened.isFile() || opened.size > BigInt(this.maxBytes) || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw invalidSnapshot('snapshot file changed before secure read', 'Handle identity mismatch'); const text = await handle.readFile({ encoding: 'utf8' }); const after = await lstat(path, { bigint: true }); if (!after.isFile() || after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) throw invalidSnapshot('snapshot file changed during secure read', 'Path identity mismatch'); await this.assertDirectories(directories); return text; } finally { await handle.close(); }
  }
  private async writeSecure(staging: string, identity: DirectoryIdentity, name: string, content: string) { if (Buffer.byteLength(content, 'utf8') > this.maxBytes) throw invalidSnapshot('snapshot file exceeded its byte cap', `Snapshot file exceeded ${this.maxBytes} bytes`); const path = join(staging, name); this.assertInside(staging, path); await this.assertDirectories([identity]); let handle; try { handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | this.flags.noFollow, 0o600); } catch (error) { throw invalidSnapshot('snapshot staging file could not be created safely', error instanceof Error ? error.message : 'Unsafe staging file'); } try { await handle.writeFile(content, 'utf8'); await handle.sync(); if (!(await handle.stat({ bigint: true })).isFile()) throw invalidSnapshot('snapshot staging file was not regular', 'Staging handle was not a regular file'); } finally { await handle.close(); } await this.assertDirectories([identity]); }
  private assertCaps(snapshot: StoredCodeSnapshot) { const values = [JSON.stringify(snapshot.manifest), snapshot.filesNdjson, snapshot.modulesNdjson, snapshot.symbolsNdjson, snapshot.relationsNdjson]; const total = values.reduce((sum, value) => sum + Buffer.byteLength(value, 'utf8'), 0); if (values.some((value) => Buffer.byteLength(value, 'utf8') > this.maxBytes) || total > this.maxBytes) throw invalidSnapshot('snapshot exceeded private storage byte limits', 'Per-file or total snapshot byte cap exceeded'); }
  private async readDirectory(sourceKey: string, leaf: string): Promise<StoredCodeSnapshot> { const dirs = await this.directories(sourceKey, leaf); const [manifestRaw, filesNdjson, modulesNdjson, symbolsNdjson, relationsNdjson] = await Promise.all(DATASETS.map((name) => this.readSecure(dirs, name))); let candidate: StoredCodeSnapshot; try { candidate = { manifest: JSON.parse(manifestRaw), files: [], filesNdjson, modulesNdjson, symbolsNdjson, relationsNdjson }; } catch (error) { throw invalidSnapshot('snapshot manifest was invalid', error instanceof Error ? error.message : 'Invalid JSON'); } this.assertCaps(candidate); return validateSnapshot(candidate); }
  private async removeOwned(path: string, chain: readonly DirectoryIdentity[], target: DirectoryIdentity, checkpoint: string) { await this.options.beforeMutation?.('before-cleanup'); await this.assertDirectories([...chain, target]); await rm(path, { recursive: true, force: true }); await this.assertDirectories(chain); await this.sync(chain.at(-1)!.path, checkpoint); }
  async withLock<T>(sourceKey: string, work: (lease: SourceLockLease) => Promise<T>): Promise<T> {
    this.root(sourceKey);
    try { await this.prepareLockRoot(); } catch (error) {
      if (error instanceof OnboardingError) throw error;
      throw invalidSnapshot('source lock could not be acquired safely', error instanceof Error ? error.message : 'Lock setup failure');
    }
    return this.lock.withLock(sourceKey, work);
  }
  async write(normalized: NormalizedCodeSnapshot): Promise<CodeSnapshotManifest> { return this.withLock(normalized.manifest.sourceKey, (lease) => this.writeWithLease(normalized, lease)); }
  async writeWithLease(normalized: NormalizedCodeSnapshot, lease: SourceLockLease): Promise<CodeSnapshotManifest> {
    let snapshot: StoredCodeSnapshot; try { snapshot = validateSnapshot(normalized); this.assertCaps(snapshot); this.lock.assertLease(snapshot.manifest.sourceKey, lease); } catch (error) { if (error instanceof OnboardingError) throw error; throw invalidSnapshot('snapshot lease was invalid', error instanceof Error ? error.message : 'Invalid lease'); }
    const sourceKey = snapshot.manifest.sourceKey; const chain = await this.directories(sourceKey, undefined, true); const root = chain.at(-1)!.path; const current = this.current(sourceKey); const backup = join(root, 'backup'); const replace = this.options.renameDirectory ?? rename;
    if (!(await this.present(current)) && await this.present(backup)) { await this.readDirectory(sourceKey, 'backup'); await this.options.beforeMutation?.('before-backup-recovery'); await this.assertDirectories(chain); await replace(backup, current); await this.assertDirectories(chain); await this.sync(root, 'after-backup-recovery'); }
    await this.options.beforeMutation?.('before-staging-create'); await this.assertDirectories(chain); const staging = await mkdtemp(join(root, '.staging-')); const stagingIdentity = await this.directory(staging); let promoted = false;
    let operationError: unknown; let result: CodeSnapshotManifest | undefined;
    try {
      await this.options.beforeMutation?.('before-staging-write'); await this.assertDirectories([...chain, stagingIdentity]); const files: Array<[string, string]> = [['snapshot.json', `${JSON.stringify(snapshot.manifest, null, 2)}\n`], ['files.ndjson', snapshot.filesNdjson], ['modules.ndjson', snapshot.modulesNdjson], ['symbols.ndjson', snapshot.symbolsNdjson], ['relations.ndjson', snapshot.relationsNdjson]]; for (const [name, content] of files) await this.writeSecure(staging, stagingIdentity, name, content);
      await this.sync(staging, 'after-staging-write'); await this.options.afterStageWrite?.(staging); await this.assertDirectories([...chain, stagingIdentity]); await this.readDirectory(sourceKey, staging.slice(root.length + 1)); await this.options.beforePromote?.(); await this.assertDirectories([...chain, stagingIdentity]);
      if (await this.present(backup)) { const oldBackup = await this.directory(backup); await this.readDirectory(sourceKey, 'backup'); await this.removeOwned(backup, chain, oldBackup, 'after-backup-cleanup'); }
      let previousMoved = false;
      try {
        if (await this.present(current)) { await this.options.beforeMutation?.('before-current-to-backup'); await this.assertDirectories([...chain, stagingIdentity]); await replace(current, backup); previousMoved = true; await this.assertDirectories([...chain, stagingIdentity]); await this.sync(root, 'after-current-to-backup'); }
        await this.options.beforeMutation?.('before-staging-to-current'); await this.assertDirectories([...chain, stagingIdentity]); await replace(staging, current); promoted = true; await this.assertDirectories(chain); await this.sync(root, 'after-staging-to-current'); await this.sync(root, 'after-promotion');
      } catch (error) {
        if (promoted) { const failed = join(root, `.failed-${randomUUID()}`); try { await this.assertDirectories(chain); await replace(current, failed); const failedIdentity = await this.directory(failed); await this.sync(root, 'after-new-current-isolation'); await this.removeOwned(failed, chain, failedIdentity, 'after-failed-cleanup'); } catch { /* Preserve primary error. */ } }
        if (previousMoved) try { await this.assertDirectories(chain); await replace(backup, current); await this.sync(root, 'after-rollback-restore'); } catch { /* Preserve primary error. */ }
        throw error;
      }
      // A post-commit cleanup boundary must still fail closed: current remains
      // complete, but callers cannot be told success after an observed swap.
      await this.options.beforeMutation?.('before-cleanup'); await this.assertDirectories(chain);
      result = snapshot.manifest;
    } catch (error) {
      operationError = error;
    }
    if (!promoted) {
      try { await this.removeOwned(staging, chain, stagingIdentity, 'after-staging-cleanup'); }
      catch (cleanupError) {
        // Preserve the causal mutation/recovery error, but never silently
        // discard a cleanup error on an otherwise successful operation.
        if (operationError !== undefined) Object.assign(operationError as object, { cleanupError });
        else operationError = cleanupError;
      }
    }
    if (operationError !== undefined) throw operationError;
    return result!;
  }
  async read(sourceKey: string): Promise<StoredCodeSnapshot | null> { return this.withLock(sourceKey, (lease) => this.readWithLease(sourceKey, lease)); }
  async readWithLease(sourceKey: string, lease: SourceLockLease): Promise<StoredCodeSnapshot | null> {
    try { this.lock.assertLease(sourceKey, lease); } catch (error) { throw invalidSnapshot('snapshot lease was invalid', error instanceof Error ? error.message : 'Invalid lease'); }
    // Validate every present ancestor before treating an absent source root as no snapshot.
    const agentwiki = join(this.options.home, '.agentwiki'); const source = join(this.workspaceRoot, sourceKey); const root = this.root(sourceKey);
    if (!(await this.present(agentwiki))) return null; await this.directory(agentwiki);
    if (!(await this.present(this.workspaceRoot))) return null; await this.directory(this.workspaceRoot);
    if (!(await this.present(source))) return null; await this.directory(source);
    if (!(await this.present(root))) return null;
    // Validate the full private root before treating a missing current leaf as absence.
    await this.directories(sourceKey);
    if (!(await this.present(this.current(sourceKey)))) return null;
    try { return await this.readDirectory(sourceKey, 'current'); } catch (error) { if (error instanceof OnboardingError) throw error; throw invalidSnapshot('stored snapshot could not be read', error instanceof Error ? error.message : 'Unknown local storage failure'); }
  }
}
