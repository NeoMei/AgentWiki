import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { OnboardingError } from '../onboarding/errors.js';
import { contentHash } from '../utils/hash.js';
import { SourceLock } from './source-lock.js';
import { GeneratedKnowledgeRecordSchema, type GeneratedKnowledgeRecord } from './contracts.js';
import type { GeneratedKnowledgeDocument } from './base-analyzer.js';

const HASH = /^[a-f0-9]{64}$/u;
const DEFAULT_LIMIT = 1_000_000;
const MANIFEST_MAX_BYTES = 256 * 1024;
type Identity = { path: string; dev: bigint; ino: bigint; size: bigint };
type GeneratedSlot = 'base' | 'publish' | '.publish-backup';
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
export const sameGeneratedIdentityForTest = (left: Pick<Identity, 'dev' | 'ino' | 'size'>, right: Pick<Identity, 'dev' | 'ino' | 'size'>) => left.dev === right.dev && left.ino === right.ino && left.size === right.size;
const same = sameGeneratedIdentityForTest;
const missing = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
function fail(message: string, diagnostic?: string): OnboardingError { const error = new OnboardingError({ code: 'CODE_ANALYSIS_FAILED', message: `CODE_ANALYSIS_FAILED: ${message}`, retryable: false }); Object.assign(error, { diagnostic }); return error; }
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value !== null && typeof value === 'object') return Object.keys(value as Record<string, unknown>).sort(compare).reduce<Record<string, unknown>>((out, key) => { out[key] = canonical((value as Record<string, unknown>)[key]); return out; }, {}); return value; }

const ManifestRawSchema = z.object({ schemaVersion: z.literal('agentwiki-generated-code-knowledge-manifest@1'), sourceKey: z.string().regex(HASH), snapshotHash: z.string().regex(HASH), records: z.array(GeneratedKnowledgeRecordSchema).min(1) }).strict();
const ManifestBodySchema = ManifestRawSchema.superRefine((value, context) => {
  let previous: string | undefined; const paths = new Set<string>();
  value.records.forEach((record, index) => {
    if (record.sourceKey !== value.sourceKey || record.snapshotHash !== value.snapshotHash) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Record identity did not match manifest', path: ['records', index] });
    if (previous !== undefined && previous >= record.logicalKey) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Manifest records were not canonical', path: ['records', index] });
    if (paths.has(record.relativePath)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Manifest paths were not unique', path: ['records', index] });
    previous = record.logicalKey; paths.add(record.relativePath);
  });
});
export type GeneratedPublishManifestBody = z.infer<typeof ManifestBodySchema>;
export const GeneratedPublishManifestSchema = ManifestRawSchema.extend({ manifestHash: z.string().regex(HASH) }).strict().superRefine((value, context) => { const { manifestHash, ...body } = value; const checkedBody = ManifestBodySchema.safeParse(body); if (!checkedBody.success) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Manifest body was invalid' }); if (contentHash(JSON.stringify(canonical(body))) !== manifestHash) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Manifest hash did not match canonical body', path: ['manifestHash'] }); });
export type GeneratedPublishManifest = z.infer<typeof GeneratedPublishManifestSchema>;
export interface GeneratedPublishSet { manifest: GeneratedPublishManifest; documents: GeneratedKnowledgeDocument[]; }
export type ValidatedGeneratedPublishSet = Readonly<GeneratedPublishSet>;
export interface GeneratedStoreFileOps {
  renameDirectory?: (from: string, to: string) => Promise<void>;
  fsyncDirectory?: (path: string, checkpoint: string) => Promise<void>;
}
export interface GeneratedKnowledgeStoreCoreOptions {
  /** Internal runtime/test home; production facade supplies its fixed homedir. */
  home?: string;
  maxGeneratedBytes?: number; maxDocumentBytes?: number;
  beforePromote?: () => void | Promise<void>;
  afterBaseValidated?: () => void | Promise<void>;
  renameDirectory?: (from: string, to: string) => Promise<void>;
  fsyncDirectory?: (path: string, checkpoint: string) => Promise<void>;
  fileOps?: GeneratedStoreFileOps;
  /** POSIX requires both secure-open flags; Windows relies on identity rechecks and O_EXCL. */
  platform?: { name?: NodeJS.Platform; O_NOFOLLOW: number | undefined; O_DIRECTORY: number | undefined };
  /** Test seam: runs after an inode check, before secure open/revalidation. */
  afterPathCheck?: (subject: { path: string; kind: 'file' | 'directory' }) => void | Promise<void>;
  /** Internal seam for backup-cleanup identity-race tests. */
  beforeBackupCleanup?: () => void | Promise<void>;
  /** @internal Test seam for post-commit batch backup cleanup. */
  beforeBatchBackupCleanup?: (sourceKey: string) => void | Promise<void>;
  /** @internal test seam for mutation-boundary race tests. */
  beforeMutation?: (stage: 'before-staging-create' | 'before-staging-write' | 'before-current-to-backup' | 'before-staging-to-current') => void | Promise<void>;
}
/**
 * Node does not expose openat here. This store instead requires 0700 private
 * roots, snapshots directory inodes before/after reads, and opens files with
 * O_NOFOLLOW before validating FileHandle and pathname identities. This is not
 * openat-equivalent against a malicious same-UID actor that can swap paths and
 * swap them back between observations; AgentWiki trusts its own same-UID writer.
 * Different-UID writes are bounded by private permissions, nofollow, and inode checks.
 */
export class GeneratedKnowledgeStoreCore {
  private readonly home: string; private readonly workspaceRoot: string; private readonly agentwikiRoot: string; private readonly maxBytes: number; private readonly maxDocumentBytes: number;
  private readonly lockRoot: string; private readonly lock: SourceLock;
  private readonly flags: { noFollow: number; directory: number }; private readonly isWindows: boolean;
  /** Cleanup is post-commit; retain bounded local diagnostics without exposing them to callers. */
  private readonly cleanupDiagnostics: string[] = [];
  constructor(private readonly options: GeneratedKnowledgeStoreCoreOptions = {}) {
    this.home = options.home ?? homedir(); this.agentwikiRoot = join(this.home, '.agentwiki'); this.workspaceRoot = join(this.agentwikiRoot, 'workspaces');
    this.maxBytes = options.maxGeneratedBytes ?? DEFAULT_LIMIT; this.maxDocumentBytes = options.maxDocumentBytes ?? this.maxBytes;
    if (!Number.isInteger(this.maxBytes) || !Number.isInteger(this.maxDocumentBytes) || this.maxBytes <= 0 || this.maxDocumentBytes <= 0) throw fail('generated output limits were invalid');
    const platform = options.platform ?? { name: process.platform, O_NOFOLLOW: constants.O_NOFOLLOW, O_DIRECTORY: constants.O_DIRECTORY };
    const noFollow = platform.O_NOFOLLOW; const directory = platform.O_DIRECTORY;
    this.isWindows = platform.name === 'win32';
    if (!this.isWindows && (typeof noFollow !== 'number' || !Number.isSafeInteger(noFollow) || noFollow <= 0 || typeof directory !== 'number' || !Number.isSafeInteger(directory) || directory <= 0)) throw fail('platform lacks required nofollow directory-open flags');
    this.flags = { noFollow: this.isWindows ? 0 : noFollow as number, directory: this.isWindows ? 0 : directory as number };
    this.lockRoot = join(this.workspaceRoot, '.generated-codegraph-locks'); this.lock = new SourceLock({ root: this.lockRoot, platform: this.isWindows ? 'win32' : platform.name });
  }
  private root(sourceKey: string) { if (!HASH.test(sourceKey)) throw fail('source key was invalid'); return join(this.workspaceRoot, sourceKey, 'generated', 'codegraph'); }
  private leaf(sourceKey: string, name: GeneratedSlot) { return join(this.root(sourceKey), name); }
  private assertInside(root: string, path: string) { const result = relative(resolve(root), resolve(path)); if (result === '' || (!isAbsolute(result) && result !== '..' && !result.startsWith(`..${sep}`))) return; throw fail('generated path escaped private workspace'); }
  private async directory(path: string): Promise<Identity> { let details; try { details = await lstat(path, { bigint: true }); } catch (error) { throw fail('private generated directory was missing', error instanceof Error ? error.message : 'Missing directory'); } if (!details.isDirectory() || details.isSymbolicLink() || (!this.isWindows && (details.mode & 0o077n) !== 0n)) throw fail('private generated directory was unsafe'); return { path, dev: details.dev, ino: details.ino, size: details.size }; }
  private async ensureDirectory(path: string): Promise<Identity> { await mkdir(path, { recursive: true, mode: 0o700 }); return this.directory(path); }
  private async assertDirectories(entries: Identity[]): Promise<void> { for (const entry of entries) { const current = await this.directory(entry.path); if (entry.dev !== current.dev || entry.ino !== current.ino) throw fail('private generated directory changed during operation'); } }
  private async directories(sourceKey: string, leaf?: GeneratedSlot, create = false): Promise<Identity[]> {
    const paths = [this.agentwikiRoot, this.workspaceRoot, join(this.workspaceRoot, sourceKey), join(this.workspaceRoot, sourceKey, 'generated'), this.root(sourceKey), ...(leaf ? [this.leaf(sourceKey, leaf)] : [])]; const result: Identity[] = [];
    for (const path of paths) { this.assertInside(this.home, path); result.push(create ? await this.ensureDirectory(path) : await this.directory(path)); }
    for (const entry of result) await this.options.afterPathCheck?.({ path: entry.path, kind: 'directory' });
    await this.assertDirectories(result); return result;
  }
  private async sync(path: string, checkpoint: string): Promise<void> { const fsyncDirectory = this.options.fileOps?.fsyncDirectory ?? this.options.fsyncDirectory; if (fsyncDirectory) return fsyncDirectory(path, checkpoint); if (this.isWindows) return; const handle = await open(path, constants.O_RDONLY | this.flags.directory | this.flags.noFollow); try { await handle.sync(); } finally { await handle.close(); } }
  private async readSecure(directories: Identity[], relativePath: string, maxBytes: number): Promise<string> {
    const root = directories.at(-1)!.path; const path = join(root, relativePath); this.assertInside(root, path);
    let before; try { before = await lstat(path, { bigint: true }); } catch (error) { throw fail('generated file was missing', error instanceof Error ? error.message : 'Missing file'); }
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maxBytes)) throw fail('generated file was unsafe or exceeded its pre-read cap'); const expected: Identity = { path, dev: before.dev, ino: before.ino, size: before.size };
    await this.options.afterPathCheck?.({ path, kind: 'file' }); await this.assertDirectories(directories);
    let handle; try { handle = await open(path, constants.O_RDONLY | this.flags.noFollow); } catch (error) { throw fail('generated file could not be opened safely', error instanceof Error ? error.message : 'Unsafe file'); }
    try { const opened = await handle.stat({ bigint: true }); if (!opened.isFile() || opened.size > BigInt(maxBytes) || opened.dev !== expected.dev || opened.ino !== expected.ino || opened.size !== expected.size) throw fail('generated file changed before secure read'); const content = await handle.readFile({ encoding: 'utf8' }); const after = await lstat(path, { bigint: true }); const actual: Identity = { path, dev: after.dev, ino: after.ino, size: after.size }; if (!after.isFile() || after.isSymbolicLink() || !same(expected, actual)) throw fail('generated file changed during secure read'); await this.assertDirectories(directories); return content; } finally { await handle.close(); }
  }
  private async writeSecure(staging: string, relativePath: string, content: string): Promise<void> {
    const path = join(staging, relativePath); this.assertInside(staging, path); const parent = join(path, '..'); await mkdir(parent, { recursive: true, mode: 0o700 }); const directories = [await this.directory(staging), await this.directory(parent)]; await this.assertDirectories(directories);
    let handle; try { handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | this.flags.noFollow, 0o600); } catch (error) { throw fail('generated staging file could not be created safely', error instanceof Error ? error.message : 'Unsafe staging file'); }
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); if (!(await handle.stat({ bigint: true })).isFile()) throw fail('generated staging file was not regular'); } finally { await handle.close(); } await this.assertDirectories(directories);
  }
  private manifest(sourceKey: string, snapshotHash: string, documents: GeneratedKnowledgeDocument[]): GeneratedPublishManifest { const body = ManifestBodySchema.parse({ schemaVersion: 'agentwiki-generated-code-knowledge-manifest@1', sourceKey, snapshotHash, records: documents.map((item) => item.record) }); return GeneratedPublishManifestSchema.parse({ ...body, manifestHash: contentHash(JSON.stringify(canonical(body))) }); }
  private documents(sourceKey: string, snapshotHash: string, items: GeneratedKnowledgeDocument[]): GeneratedKnowledgeDocument[] {
    if (!HASH.test(snapshotHash) || !Array.isArray(items) || items.length === 0) throw fail('generated document input was invalid'); let total = 0;
    const documents = items.map((item) => { if (!item || typeof item !== 'object' || typeof item.content !== 'string') throw fail('generated document content must be a string'); let record: GeneratedKnowledgeRecord; try { record = GeneratedKnowledgeRecordSchema.parse(item.record); } catch (error) { throw fail('generated document record was invalid', error instanceof Error ? error.message : 'Invalid record'); } if (record.sourceKey !== sourceKey || record.snapshotHash !== snapshotHash || contentHash(item.content) !== record.contentHash) throw fail('generated document identity or content hash did not match'); const bytes = Buffer.byteLength(item.content); if (bytes > this.maxDocumentBytes) throw fail('generated document exceeded its byte cap'); total += bytes; return { record, content: item.content }; }).sort((left, right) => compare(left.record.logicalKey, right.record.logicalKey));
    if (new Set(documents.map((item) => item.record.logicalKey)).size !== documents.length || new Set(documents.map((item) => item.record.relativePath)).size !== documents.length || total > this.maxBytes) throw fail('generated documents were duplicate or exceeded total byte cap'); return documents;
  }
  private async writeDirectory(staging: string, sourceKey: string, snapshotHash: string, documents: GeneratedKnowledgeDocument[]): Promise<void> { const manifest = this.manifest(sourceKey, snapshotHash, documents); for (const document of documents) await this.writeSecure(staging, document.record.relativePath, document.content); await this.writeSecure(staging, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`); await this.sync(staging, 'after-staging-write'); }
  private async validateDirectory(staging: string, sourceKey: string, snapshotHash: string): Promise<void> { const dirs = [await this.directory(staging)]; const raw = await this.readSecure(dirs, 'manifest.json', MANIFEST_MAX_BYTES); let manifest: GeneratedPublishManifest; try { manifest = GeneratedPublishManifestSchema.parse(JSON.parse(raw)); } catch (error) { throw fail('staged manifest was invalid', error instanceof Error ? error.message : 'Invalid manifest'); } if (manifest.sourceKey !== sourceKey || manifest.snapshotHash !== snapshotHash) throw fail('staged manifest identity did not match'); let total = 0; for (const record of manifest.records) { const content = await this.readSecure(dirs, record.relativePath, this.maxDocumentBytes); const bytes = Buffer.byteLength(content); total += bytes; if (bytes > this.maxDocumentBytes || total > this.maxBytes || contentHash(content) !== record.contentHash) throw fail('staged generated content was invalid'); } }
  private async readDirectory(sourceKey: string, name: GeneratedSlot, expectedSnapshotHash?: string): Promise<GeneratedPublishSet> { const dirs = await this.directories(sourceKey, name); const raw = await this.readSecure(dirs, 'manifest.json', MANIFEST_MAX_BYTES); let manifest: GeneratedPublishManifest; try { manifest = GeneratedPublishManifestSchema.parse(JSON.parse(raw)); } catch (error) { throw fail('generated manifest was invalid', error instanceof Error ? error.message : 'Invalid manifest'); } if (manifest.sourceKey !== sourceKey || (expectedSnapshotHash !== undefined && manifest.snapshotHash !== expectedSnapshotHash)) throw fail('generated manifest identity did not match'); const documents: GeneratedKnowledgeDocument[] = []; let total = 0; for (const record of manifest.records) { const content = await this.readSecure(dirs, record.relativePath, this.maxDocumentBytes); const bytes = Buffer.byteLength(content); total += bytes; if (bytes > this.maxDocumentBytes || total > this.maxBytes || contentHash(content) !== record.contentHash) throw fail('generated publish content was invalid'); documents.push({ record, content }); } await this.assertDirectories(dirs); return { manifest, documents }; }
  private async promote(root: string, chain: Identity[], staging: string, current: string, backup: string): Promise<void> { const replace = this.options.fileOps?.renameDirectory ?? this.options.renameDirectory ?? rename; let previousMoved = false; let promoted = false; try { await this.assertDirectories(chain); try { await this.options.beforeMutation?.('before-current-to-backup'); await this.assertDirectories(chain); await replace(current, backup); previousMoved = true; await this.assertDirectories(chain); await this.sync(root, 'after-current-to-backup'); await this.assertDirectories(chain); } catch (error) { if (!missing(error)) throw error; } await this.options.beforeMutation?.('before-staging-to-current'); await this.assertDirectories(chain); await replace(staging, current); promoted = true; await this.assertDirectories(chain); await this.sync(root, 'after-staging-to-current'); await this.assertDirectories(chain); await this.sync(root, 'after-promotion'); await this.assertDirectories(chain); } catch (error) { if (promoted) { const failed = join(root, `.failed-${randomUUID()}`); try { await this.assertDirectories(chain); await replace(current, failed); await this.sync(root, 'after-current-isolation'); await rm(failed, { recursive: true, force: true }); } catch { /* Never delete a path after an identity failure. */ } } if (previousMoved) { try { await this.assertDirectories(chain); await replace(backup, current); await this.sync(root, 'after-rollback-restore'); } catch { /* Preserve primary error. */ } } throw error; } }
  private async withLock<T>(sourceKey: string, work: () => Promise<T>): Promise<T> {
    const prefix = [await this.ensureDirectory(this.agentwikiRoot), await this.ensureDirectory(this.workspaceRoot)];
    await this.assertDirectories(prefix);
    const lockRoot = await this.ensureDirectory(this.lockRoot);
    await this.assertDirectories([...prefix, lockRoot]);
    return this.lock.withLock(sourceKey, work);
  }
  private async withLocks<T>(sourceKeys: string[], work: () => Promise<T>): Promise<T> {
    const [sourceKey, ...rest] = sourceKeys;
    if (!sourceKey) return work();
    return this.withLock(sourceKey, () => this.withLocks(rest, work));
  }
  private async removeDirectory(path: string, chain: Identity[], target: Identity, checkpoint: string): Promise<void> { await this.assertDirectories([...chain, target]); await rm(path, { recursive: true, force: true }); await this.assertDirectories(chain); await this.sync(chain.at(-1)!.path, checkpoint); }
  private async removeStaging(staging: string, chain: Identity[]): Promise<void> { try { await this.removeDirectory(staging, chain, await this.directory(staging), 'after-staging-cleanup'); } catch { /* An identity failure means the path may resolve outside the private root. */ } }
  private recordCleanupDiagnostic(error: unknown): void {
    const diagnostic = error instanceof Error ? error.message : String(error);
    this.cleanupDiagnostics.push(diagnostic);
    if (this.cleanupDiagnostics.length > 20) this.cleanupDiagnostics.shift();
  }
  async writeBase(sourceKey: string, snapshotHash: string, documents: GeneratedKnowledgeDocument[]): Promise<void> { return this.withLock(sourceKey, async () => { const validated = this.documents(sourceKey, snapshotHash, documents); const dirs = await this.directories(sourceKey, undefined, true); const root = dirs.at(-1)!.path; await this.options.beforeMutation?.('before-staging-create'); await this.assertDirectories(dirs); const staging = await mkdtemp(join(root, '.base-staging-')); try { await this.options.beforeMutation?.('before-staging-write'); await this.assertDirectories(dirs); await this.writeDirectory(staging, sourceKey, snapshotHash, validated); await this.assertDirectories(dirs); await this.validateDirectory(staging, sourceKey, snapshotHash); await this.options.afterBaseValidated?.(); await this.assertDirectories(dirs); await this.promote(root, dirs, staging, this.leaf(sourceKey, 'base'), join(root, '.base-backup')); } finally { await this.removeStaging(staging, dirs); } }); }
  async withPublishedBatch<T>(sourceKeys: string[], consume: (sets: ValidatedGeneratedPublishSet[]) => Promise<T>): Promise<T> {
    if (!Array.isArray(sourceKeys) || sourceKeys.length === 0 || sourceKeys.some((key) => !HASH.test(key))) throw fail('batch source keys were invalid');
    const keys = [...sourceKeys].sort(compare);
    if (new Set(keys).size !== keys.length) throw fail('batch source keys must be unique');
    return this.withLocks(keys, async () => {
      const prepared: Array<{ sourceKey: string; set: GeneratedPublishSet; dirs: Identity[]; root: string; staging: string; current: string; backup: string; hadCurrent: boolean; promoted: boolean }> = [];
      try {
        // Validate every immutable base and every staged publish before the
        // first current directory can change.
        for (const sourceKey of keys) {
          const base = await this.readDirectory(sourceKey, 'base');
          const dirs = await this.directories(sourceKey);
          const root = dirs.at(-1)!.path;
          await this.options.beforeMutation?.('before-staging-create');
          await this.assertDirectories(dirs);
          const staging = await mkdtemp(join(root, '.publish-staging-'));
          try {
            await this.options.beforeMutation?.('before-staging-write');
            await this.assertDirectories(dirs);
            await this.writeDirectory(staging, sourceKey, base.manifest.snapshotHash, base.documents);
            await this.assertDirectories(dirs);
            await this.validateDirectory(staging, sourceKey, base.manifest.snapshotHash);
            let hadCurrent = true;
            try { await lstat(this.leaf(sourceKey, 'publish')); } catch (error) { if (missing(error)) hadCurrent = false; else throw error; }
            prepared.push({ sourceKey, set: base, dirs, root, staging, current: this.leaf(sourceKey, 'publish'), backup: this.leaf(sourceKey, '.publish-backup'), hadCurrent, promoted: false });
          } catch (error) { await this.removeStaging(staging, dirs); throw error; }
        }
        await this.options.beforePromote?.();
        for (const item of prepared) {
          await this.promote(item.root, item.dirs, item.staging, item.current, item.backup);
          item.promoted = true;
        }
        const result = await consume(prepared.map((item) => item.set));
        for (const item of prepared) {
          try {
            await this.options.beforeBatchBackupCleanup?.(item.sourceKey);
            try { await lstat(item.backup); } catch (error) { if (missing(error)) continue; throw error; }
            const backup = await this.directory(item.backup);
            await this.removeDirectory(item.backup, item.dirs, backup, 'after-batch-backup-cleanup');
          } catch (error) {
            // A consumer success is the commit point. Cleanup may leave a
            // verified backup for readPublish() to remove later, but may not
            // turn a committed batch into a rollback.
            this.recordCleanupDiagnostic(error);
          }
        }
        return result;
      } catch (error) {
        const replace = this.options.fileOps?.renameDirectory ?? this.options.renameDirectory ?? rename;
        for (const item of [...prepared].reverse()) {
          if (!item.promoted) continue;
          try {
            if (item.hadCurrent) {
              const failed = join(item.root, `.batch-failed-${randomUUID()}`);
              await replace(item.current, failed);
              await replace(item.backup, item.current);
              await this.sync(item.root, 'after-batch-rollback-restore');
              await rm(failed, { recursive: true, force: true });
            } else {
              await rm(item.current, { recursive: true, force: true });
              await this.sync(item.root, 'after-batch-rollback-remove');
            }
          } catch { /* A retained backup is recovered by readPublish later. */ }
        }
        throw error;
      } finally {
        for (const item of prepared) await this.removeStaging(item.staging, item.dirs);
      }
    });
  }
  async publish(sourceKey: string, snapshotHash: string): Promise<GeneratedPublishManifest> { return this.withLock(sourceKey, async () => { const base = await this.readDirectory(sourceKey, 'base', snapshotHash); const dirs = await this.directories(sourceKey); const root = dirs.at(-1)!.path; await this.options.beforeMutation?.('before-staging-create'); await this.assertDirectories(dirs); const staging = await mkdtemp(join(root, '.publish-staging-')); try { await this.options.beforeMutation?.('before-staging-write'); await this.assertDirectories(dirs); await this.writeDirectory(staging, sourceKey, snapshotHash, base.documents); await this.assertDirectories(dirs); await this.validateDirectory(staging, sourceKey, snapshotHash); await this.options.beforePromote?.(); await this.assertDirectories(dirs); await this.promote(root, dirs, staging, this.leaf(sourceKey, 'publish'), join(root, '.publish-backup')); return base.manifest; } finally { await this.removeStaging(staging, dirs); } }); }
  async readBase(sourceKey: string): Promise<GeneratedPublishSet | null> { return this.withLock(sourceKey, async () => { try { await lstat(this.leaf(sourceKey, 'base')); } catch (error) { if (missing(error)) return null; throw error; } return this.readDirectory(sourceKey, 'base'); }); }
  async readPublish(sourceKey: string): Promise<GeneratedPublishSet | null> { return this.withLock(sourceKey, async () => {
    const current = this.leaf(sourceKey, 'publish'); const backup = this.leaf(sourceKey, '.publish-backup'); let currentExists = true;
    try { await lstat(current); } catch (error) { if (missing(error)) currentExists = false; else throw error; }
    if (!currentExists) {
      try { await lstat(backup); } catch (error) { if (missing(error)) return null; throw error; }
      await this.readDirectory(sourceKey, '.publish-backup');
      const dirs = await this.directories(sourceKey); await this.assertDirectories(dirs);
      await (this.options.fileOps?.renameDirectory ?? this.options.renameDirectory ?? rename)(backup, current); await this.assertDirectories(dirs); await this.sync(this.root(sourceKey), 'after-backup-recovery');
      return this.readDirectory(sourceKey, 'publish');
    }
    const published = await this.readDirectory(sourceKey, 'publish');
    try { await lstat(backup); } catch (error) { if (missing(error)) return published; throw error; }
    const chain = await this.directories(sourceKey); const backupIdentity = await this.directory(backup);
    await this.options.beforeBackupCleanup?.();
    await this.removeDirectory(backup, chain, backupIdentity, 'after-backup-cleanup');
    return published;
  }); }
}
