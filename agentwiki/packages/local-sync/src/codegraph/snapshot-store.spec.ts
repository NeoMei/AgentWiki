import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashCodeSnapshot, normalizeCodeGraphFiles } from './normalizer.js';
import { CodeSnapshotStore } from './snapshot-store.js';

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
});
