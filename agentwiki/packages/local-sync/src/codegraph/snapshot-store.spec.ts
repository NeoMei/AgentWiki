import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashCodeSnapshot, normalizeCodeGraphFiles } from './normalizer.js';
import { CodeSnapshotStore, sameSnapshotIdentityForTest } from './snapshot-store.js';

const directories: string[] = [];
async function temporaryDirectory() { const directory = await mkdtemp(join(tmpdir(), 'agentwiki-snapshot-')); directories.push(directory); return directory; }
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

function snapshot(path: string) {
  return normalizeCodeGraphFiles([{ path, language: 'typescript', nodeCount: 1, sizeBytes: 1 }], {
    sourceKey: 'a'.repeat(64), sourceRoot: '/private/project', indexedAt: '2026-08-18T00:00:00.000Z', maxFiles: 10, maxGeneratedBytes: 10_000,
    scanner: { provider: 'codegraph', detectedVersion: '1.5.0', capabilities: { required: { 'index.status': true, 'index.sync': true, 'files.list': true }, optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false } } },
  });
}

describe('Code snapshot store', () => {
  it('fails a first-write cleanup ancestor swap after keeping the complete committed current', async () => {
    const home = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const sentinel = join(outside, 'sentinel.txt');
    await writeFile(sentinel, 'external bytes\n');
    const sourceKey = 'a'.repeat(64);
    const root = join(home, '.agentwiki', 'workspaces', sourceKey, 'codegraph');
    const hostile = new CodeSnapshotStore({ home, beforeMutation: async (stage) => {
      if (stage !== 'before-cleanup') return;
      await rename(root, `${root}.held-first-commit`);
      await symlink(outside, root);
    } });

    await expect(hostile.write(snapshot('src/main.ts'))).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
    await expect(readFile(join(`${root}.held-first-commit`, 'current', 'files.ndjson'), 'utf8')).resolves.toContain('src/main.ts');
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('external bytes\n');
  });

  it('compares snapshot filesystem identities without losing bigint precision', () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 17n;
    expect(sameSnapshotIdentityForTest({ dev: huge, ino: huge + 1n }, { dev: huge, ino: huge + 1n })).toBe(true);
    expect(sameSnapshotIdentityForTest({ dev: huge, ino: huge + 1n }, { dev: huge + 1n, ino: huge + 1n })).toBe(false);
  });

  it.each(['.agentwiki', 'workspaces', 'a'.repeat(64), 'codegraph'])('fails closed on a real private-root symlink at %s without changing the external sentinel', async (part) => {
    const home = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const sentinel = join(outside, 'sentinel.txt');
    await writeFile(sentinel, 'do not touch\n');
    const segments = ['.agentwiki', 'workspaces', 'a'.repeat(64), 'codegraph'];
    const index = segments.indexOf(part);
    const parent = join(home, ...segments.slice(0, index));
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await symlink(outside, join(parent, part));

    await expect(new CodeSnapshotStore({ home }).write(snapshot('src/main.ts'))).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('do not touch\n');
  });

  it.each([
    { O_NOFOLLOW: undefined, O_DIRECTORY: 1 },
    { O_NOFOLLOW: 0, O_DIRECTORY: 1 },
    { O_NOFOLLOW: 1, O_DIRECTORY: undefined },
    { O_NOFOLLOW: 1, O_DIRECTORY: 0 },
  ])('fails closed when the platform lacks a required secure-open flag', async (platform) => {
    const home = await temporaryDirectory();
    expect(() => new CodeSnapshotStore({ home, platform })).toThrow(/secure-open/u);
  });

  it('rejects a codegraph ancestor swap before staging creation and leaves an external sentinel unchanged', async () => {
    const home = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const sentinel = join(outside, 'sentinel.txt');
    await writeFile(sentinel, 'do not touch\n');
    const sourceKey = 'a'.repeat(64);
    const first = new CodeSnapshotStore({ home });
    await first.write(snapshot('src/old.ts'));
    const codegraph = join(home, '.agentwiki', 'workspaces', sourceKey, 'codegraph');
    const moved = join(home, '.agentwiki', 'workspaces', sourceKey, 'codegraph-held');
    const hostile = new CodeSnapshotStore({
      home,
      beforeMutation: async (stage) => {
        if (stage !== 'before-staging-create') return;
        await rename(codegraph, moved);
        await symlink(outside, codegraph);
      },
    });

    await expect(hostile.write(snapshot('src/new.ts'))).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('do not touch\n');
    await expect(first.read(sourceKey)).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
  });

  it.each(['before-staging-write', 'before-current-to-backup', 'before-staging-to-current'] as const)('fails closed through a real codegraph ancestor swap at %s', async (stage) => {
    const home = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const sentinel = join(outside, 'sentinel.txt');
    await writeFile(sentinel, 'outside bytes\n');
    const sourceKey = 'a'.repeat(64);
    const first = new CodeSnapshotStore({ home });
    await first.write(snapshot('src/old.ts'));
    const codegraph = join(home, '.agentwiki', 'workspaces', sourceKey, 'codegraph');
    const hostile = new CodeSnapshotStore({ home, beforeMutation: async (actual) => {
      if (actual !== stage) return;
      await rename(codegraph, `${codegraph}.held-${stage}`);
      await symlink(outside, codegraph);
    } });

    await expect(hostile.write(snapshot('src/new.ts'))).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('outside bytes\n');
  });

  it('fails closed during backup recovery and cleanup when an ancestor is swapped', async () => {
    const home = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const sentinel = join(outside, 'sentinel.txt');
    await writeFile(sentinel, 'outside bytes\n');
    const sourceKey = 'a'.repeat(64);
    const first = new CodeSnapshotStore({ home });
    await first.write(snapshot('src/old.ts'));
    const root = join(home, '.agentwiki', 'workspaces', sourceKey, 'codegraph');
    await rename(join(root, 'current'), join(root, 'backup'));
    const recovery = new CodeSnapshotStore({ home, beforeMutation: async (stage) => {
      if (stage !== 'before-backup-recovery') return;
      await rename(root, `${root}.held-recovery`);
      await symlink(outside, root);
    } });
    await expect(recovery.write(snapshot('src/new.ts'))).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('outside bytes\n');

    const cleanupHome = await temporaryDirectory();
    const cleanupOutside = await temporaryDirectory();
    const cleanupSentinel = join(cleanupOutside, 'sentinel.txt');
    await writeFile(cleanupSentinel, 'outside cleanup bytes\n');
    const cleanFirst = new CodeSnapshotStore({ home: cleanupHome });
    await cleanFirst.write(snapshot('src/old.ts'));
    await cleanFirst.write(snapshot('src/new.ts'));
    const cleanupRoot = join(cleanupHome, '.agentwiki', 'workspaces', sourceKey, 'codegraph');
    const cleanup = new CodeSnapshotStore({ home: cleanupHome, beforeMutation: async (stage) => {
      if (stage !== 'before-cleanup') return;
      await rename(cleanupRoot, `${cleanupRoot}.held-cleanup`);
      await symlink(cleanupOutside, cleanupRoot);
    } });
    await expect(cleanup.write(snapshot('src/final.ts'))).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
    await expect(readFile(cleanupSentinel, 'utf8')).resolves.toBe('outside cleanup bytes\n');
  });

  it('fails closed during a descriptor read ancestor swap and leaves foreign staging and backup lookalikes untouched', async () => {
    const home = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const sentinel = join(outside, 'sentinel.txt');
    await writeFile(sentinel, 'outside bytes\n');
    const sourceKey = 'a'.repeat(64);
    const first = new CodeSnapshotStore({ home });
    await first.write(snapshot('src/main.ts'));
    const root = join(home, '.agentwiki', 'workspaces', sourceKey, 'codegraph');
    await symlink(outside, join(root, '.staging-foreign'));
    const reader = new CodeSnapshotStore({ home, afterPathCheck: async ({ path, kind }) => {
      if (kind !== 'file' || !path.endsWith('snapshot.json')) return;
      await rename(root, `${root}.held-read`);
      await symlink(outside, root);
    } });
    await expect(reader.read(sourceKey)).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
    await expect(readFile(sentinel, 'utf8')).resolves.toBe('outside bytes\n');

    const backupHome = await temporaryDirectory();
    const backupOutside = await temporaryDirectory();
    const backupSentinel = join(backupOutside, 'sentinel.txt');
    await writeFile(backupSentinel, 'foreign backup\n');
    const backupRoot = join(backupHome, '.agentwiki', 'workspaces', sourceKey, 'codegraph');
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    await symlink(backupOutside, join(backupRoot, 'backup'));
    await expect(new CodeSnapshotStore({ home: backupHome }).write(snapshot('src/main.ts'))).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
    await expect(readFile(backupSentinel, 'utf8')).resolves.toBe('foreign backup\n');
  });

  it('uses a lease only while its exact source lock is held and direct reads wait for direct writes', async () => {
    const home = await temporaryDirectory();
    const store = new CodeSnapshotStore({ home });
    const sourceKey = 'a'.repeat(64);
    let release!: () => void;
    let staged!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { staged = resolve; });
    const writer = new CodeSnapshotStore({
      home,
      afterStageWrite: async () => { staged(); await gate; },
    }).write(snapshot('src/main.ts'));
    await ready;
    let readDone = false;
    const reader = store.read(sourceKey).then((value) => { readDone = true; return value; });
    await new Promise<void>((resolve) => setTimeout(resolve, 15));
    expect(readDone).toBe(false);
    release();
    await writer;
    await expect(reader).resolves.toMatchObject({ files: [{ path: 'src/main.ts' }] });

    let stale!: unknown;
    await store.withLock(sourceKey, async (lease) => {
      stale = lease;
      await expect(store.readWithLease(sourceKey, lease)).resolves.toMatchObject({ files: [{ path: 'src/main.ts' }] });
    });
    await expect(store.readWithLease(sourceKey, stale as never)).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
  });

  it('retains the previous current snapshot when a replacement fails', async () => {
    const home = await temporaryDirectory();
    const store = new CodeSnapshotStore({ home });
    await store.write(snapshot('src/old.ts'));
    const failing = new CodeSnapshotStore({ home, beforePromote: () => { throw new Error('interrupted'); } });
    await expect(failing.write(snapshot('src/new.ts'))).rejects.toThrow('interrupted');
    await expect(store.read('a'.repeat(64))).resolves.toMatchObject({ files: [{ path: 'src/old.ts' }] });
  });

  it('does not accept a hash-mismatched snapshot as current', async () => {
    const home = await temporaryDirectory();
    const candidate = snapshot('src/main.ts');
    candidate.manifest.datasets.files = 'b'.repeat(64);
    await expect(new CodeSnapshotStore({ home }).write(candidate)).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
    await expect(new CodeSnapshotStore({ home }).read('a'.repeat(64))).resolves.toBeNull();
  });

  it('rejects a staging payload that no longer validates when read back from disk', async () => {
    const home = await temporaryDirectory();
    const store = new CodeSnapshotStore({ home, afterStageWrite: async (staging) => { await writeFile(join(staging, 'files.ndjson'), '{bad json\n'); } });
    await expect(store.write(snapshot('src/main.ts'))).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
    await expect(store.read('a'.repeat(64))).resolves.toBeNull();
  });

  it('rejects unsorted files even when hashes are internally consistent', async () => {
    const home = await temporaryDirectory();
    const candidate = normalizeCodeGraphFiles([
      { path: 'src/a.ts', language: 'typescript', nodeCount: 1, sizeBytes: 1 },
      { path: 'src/z.ts', language: 'typescript', nodeCount: 1, sizeBytes: 1 },
    ], {
      sourceKey: 'a'.repeat(64), sourceRoot: '/private/project', indexedAt: '2026-08-18T00:00:00.000Z', maxFiles: 10, maxGeneratedBytes: 10_000,
      scanner: { provider: 'codegraph', detectedVersion: '1.5.0', capabilities: { required: { 'index.status': true, 'index.sync': true, 'files.list': true }, optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false } } },
    });
    const lines = candidate.filesNdjson.trim().split('\n').reverse();
    candidate.filesNdjson = `${lines.join('\n')}\n`;
    candidate.manifest.datasets.files = (await import('../utils/hash.js')).contentHash(candidate.filesNdjson);
    candidate.manifest.snapshotHash = hashCodeSnapshot(candidate.manifest);
    await expect(new CodeSnapshotStore({ home }).write(candidate)).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
  });

  it('restores backup and retains the old current snapshot when promotion rename fails', async () => {
    const home = await temporaryDirectory();
    const first = new CodeSnapshotStore({ home });
    await first.write(snapshot('src/old.ts'));
    const failing = new CodeSnapshotStore({
      home,
      renameDirectory: async (from, to) => {
        if (from.includes('.staging-') && to.endsWith('/current')) throw new Error('promotion failed');
        await rename(from, to);
      },
    });
    await expect(failing.write(snapshot('src/new.ts'))).rejects.toThrow('promotion failed');
    await expect(first.read('a'.repeat(64))).resolves.toMatchObject({ files: [{ path: 'src/old.ts' }] });
  });

  it('restores a missing current directory from backup before a failed new write', async () => {
    const home = await temporaryDirectory();
    const first = new CodeSnapshotStore({ home });
    const sourceKey = 'a'.repeat(64);
    await first.write(snapshot('src/old.ts'));
    const root = join(home, '.agentwiki', 'workspaces', sourceKey, 'codegraph');
    await rename(join(root, 'current'), join(root, 'backup'));
    const failing = new CodeSnapshotStore({ home, beforePromote: () => { throw new Error('stop after recovery'); } });
    await expect(failing.write(snapshot('src/new.ts'))).rejects.toThrow('stop after recovery');
    await expect(first.read(sourceKey)).resolves.toMatchObject({ files: [{ path: 'src/old.ts' }] });
  });

  it.each(['after-current-to-backup', 'after-staging-to-current'] as const)('restores old current when fsync fails %s', async (checkpoint) => {
    const home = await temporaryDirectory();
    const first = new CodeSnapshotStore({ home });
    await first.write(snapshot('src/old.ts'));
    let failed = false;
    const failing = new CodeSnapshotStore({
      home,
      fsyncDirectory: async (path, actualCheckpoint) => {
        if (!failed && actualCheckpoint === checkpoint) { failed = true; throw new Error(`fsync ${checkpoint} failed`); }
        const handle = await (await import('node:fs/promises')).open(path, 'r');
        try { await handle.sync(); } finally { await handle.close(); }
      },
    });
    await expect(failing.write(snapshot('src/new.ts'))).rejects.toThrow(`fsync ${checkpoint} failed`);
    await expect(first.read('a'.repeat(64))).resolves.toMatchObject({ files: [{ path: 'src/old.ts' }] });
  });
});
