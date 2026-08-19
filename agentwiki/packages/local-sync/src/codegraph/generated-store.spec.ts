import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GeneratedKnowledgeStore as GeneratedKnowledgeStoreFacade } from './generated-store.js';
import { createInternalGeneratedKnowledgeStore, GeneratedKnowledgeStoreCore as GeneratedKnowledgeStore } from './generated-store.internal.js';
import { sameGeneratedIdentityForTest } from './generated-store-core.js';
import type { GeneratedKnowledgeDocument } from './base-analyzer.js';
import { contentHash } from '../utils/hash.js';
import { GeneratedKnowledgeRecordSchema } from './contracts.js';

const sourceKey = 'a'.repeat(64);
const otherSourceKey = 'c'.repeat(64);
const snapshotHash = 'b'.repeat(64);
const directories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'agentwiki-generated-'));
  directories.push(directory);
  return directory;
}

function codegraphRoot(home: string) { return join(home, '.agentwiki', 'workspaces', sourceKey, 'generated', 'codegraph'); }

function codegraphRootFor(home: string, key: string) { return join(home, '.agentwiki', 'workspaces', key, 'generated', 'codegraph'); }

async function replaceCodegraphRootWithSymlink(home: string, external: string) {
  const root = codegraphRoot(home); const retained = `${root}.retained`;
  await rename(root, retained);
  await symlink(external, root);
  return retained;
}

async function replaceCodegraphRootForWithSymlink(home: string, key: string, external: string) {
  const root = codegraphRootFor(home, key); const retained = `${root}.retained`;
  await rename(root, retained);
  await symlink(external, root);
  return retained;
}

async function externalTree(root: string, current = root): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) paths.push(...await externalTree(root, path));
    else paths.push(relative(root, path));
  }
  return paths.sort();
}

function document(relativePath = 'architecture/overview.md', content = '# Repository overview\n'): GeneratedKnowledgeDocument {
  const entryPoints = relativePath === 'architecture/entry-points.md';
  return {
    record: {
      schemaVersion: 'agentwiki-generated-code-knowledge@1',
      relativePath,
      logicalKey: `codegraph/${relativePath.replace(/\.md$/u, '')}`,
      title: entryPoints ? 'Repository entry points' : 'Repository overview',
      analysisLayer: 'base',
      sourceKey,
      snapshotHash,
      contentHash: contentHash(content),
      evidenceIds: [`snapshot:${relativePath}`],
    },
    content,
  };
}

afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('generated knowledge store', () => {
  it('rejects an injected home whose .agentwiki parent is a real symlink without changing the external tree', async () => {
    const home = await temporaryDirectory();
    const external = await temporaryDirectory();
    await writeFile(join(external, 'sentinel.txt'), 'external bytes\n');
    await symlink(external, join(home, '.agentwiki'));

    await expect(createInternalGeneratedKnowledgeStore(home).writeBase(sourceKey, snapshotHash, [document()])).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
    expect(await externalTree(external)).toEqual(['sentinel.txt']);
    await expect(readFile(join(external, 'sentinel.txt'), 'utf8')).resolves.toBe('external bytes\n');
  });

  it('compares generated filesystem identities without losing bigint precision', () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 17n;
    expect(sameGeneratedIdentityForTest({ dev: huge, ino: huge + 1n, size: huge + 2n }, { dev: huge, ino: huge + 1n, size: huge + 2n })).toBe(true);
    expect(sameGeneratedIdentityForTest({ dev: huge, ino: huge + 1n, size: huge + 2n }, { dev: huge, ino: huge + 2n, size: huge + 2n })).toBe(false);
  });

  it.each(['before-staging-create', 'before-staging-write', 'before-current-to-backup', 'before-staging-to-current'] as const)('fails closed without touching an external source-two ancestor when batch %s swaps it', async (stage) => {
    const home = await temporaryDirectory();
    const external = await temporaryDirectory();
    const secondSourceKey = 'c'.repeat(64);
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old first\n')]);
    await initial.publish(sourceKey, snapshotHash);
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# new first\n')]);
    const secondDocument = document('architecture/overview.md', '# new second\n');
    await initial.writeBase(secondSourceKey, snapshotHash, [{ ...secondDocument, record: { ...secondDocument.record, sourceKey: secondSourceKey } }]);
    let matchingCalls = 0;
    let hookEntered = false;
    let externalBefore: string[] = [];
    const attacked = new GeneratedKnowledgeStore({ home, beforeMutation: async (actual) => {
      if (actual !== stage || ++matchingCalls !== 2) return;
      hookEntered = true;
      await writeFile(join(external, 'sentinel'), 'external stays untouched');
      externalBefore = await externalTree(external);
      await replaceCodegraphRootForWithSymlink(home, secondSourceKey, external);
    } });

    await expect(attacked.withPublishedBatch([sourceKey, secondSourceKey], async () => undefined)).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
    expect(hookEntered).toBe(true);
    await expect(readFile(join(external, 'sentinel'), 'utf8')).resolves.toBe('external stays untouched');
    const externalAfter = await externalTree(external);
    expect(externalAfter).toEqual(externalBefore);
    expect(externalAfter).toEqual(['sentinel']);
    expect(externalAfter.some((path) => path.includes('.publish-staging-') || path.endsWith('.md'))).toBe(false);
    await expect(initial.readPublish(sourceKey)).resolves.toMatchObject({ documents: [{ content: '# old first\n' }] });
    await expect(initial.readPublish(secondSourceKey)).resolves.toBeNull();
  });

  it('reverse-rolls back the first source when the second source cannot promote staging to current', async () => {
    const home = await temporaryDirectory();
    const secondSourceKey = 'c'.repeat(64);
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old first\n')]);
    await initial.publish(sourceKey, snapshotHash);
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# new first\n')]);
    const secondDocument = document('architecture/overview.md', '# new second\n');
    await initial.writeBase(secondSourceKey, snapshotHash, [{ ...secondDocument, record: { ...secondDocument.record, sourceKey: secondSourceKey } }]);
    let stagingPromotions = 0;
    const failing = new GeneratedKnowledgeStore({ home, fileOps: { renameDirectory: async (from, to) => {
      if (basename(from).startsWith('.publish-staging-') && basename(to) === 'publish' && ++stagingPromotions === 2) {
        throw new Error('second source staging promotion failed');
      }
      await rename(from, to);
    } } });

    await expect(failing.withPublishedBatch([secondSourceKey, sourceKey], async () => undefined)).rejects.toThrow('second source staging promotion failed');
    await expect(initial.readPublish(sourceKey)).resolves.toMatchObject({ documents: [{ content: '# old first\n' }] });
    await expect(initial.readPublish(secondSourceKey)).resolves.toBeNull();
    for (const key of [sourceKey, secondSourceKey]) {
      expect((await readdir(codegraphRootFor(home, key))).filter((name) => name.startsWith('.publish-'))).toEqual([]);
    }
  });

  it('holds every source read behind a successful batch consumer and releases complete new publishes together', async () => {
    const home = await temporaryDirectory();
    const secondSourceKey = 'c'.repeat(64);
    const store = new GeneratedKnowledgeStore({ home });
    for (const [key, oldContent, newContent] of [[sourceKey, '# old first\n', '# new first\n'], [secondSourceKey, '# old second\n', '# new second\n']] as const) {
      const oldDocument = document('architecture/overview.md', oldContent);
      await store.writeBase(key, snapshotHash, [{ ...oldDocument, record: { ...oldDocument.record, sourceKey: key } }]);
      await store.publish(key, snapshotHash);
      const newDocument = document('architecture/overview.md', newContent);
      await store.writeBase(key, snapshotHash, [{ ...newDocument, record: { ...newDocument.record, sourceKey: key } }]);
    }
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const batch = store.withPublishedBatch([secondSourceKey, sourceKey], async () => { entered(); await gate; });
    await ready;
    let firstResolved = false;
    let secondResolved = false;
    const firstRead = store.readPublish(sourceKey).then((value) => { firstResolved = true; return value; });
    const secondRead = store.readPublish(secondSourceKey).then((value) => { secondResolved = true; return value; });
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
    expect(firstResolved).toBe(false);
    expect(secondResolved).toBe(false);
    release();
    await batch;
    await expect(firstRead).resolves.toMatchObject({ documents: [{ content: '# new first\n' }] });
    await expect(secondRead).resolves.toMatchObject({ documents: [{ content: '# new second\n' }] });
  });

  it('holds every source read behind a failing batch consumer then releases old or absent publishes', async () => {
    const home = await temporaryDirectory();
    const secondSourceKey = 'c'.repeat(64);
    const store = new GeneratedKnowledgeStore({ home });
    await store.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old first\n')]);
    await store.publish(sourceKey, snapshotHash);
    await store.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# new first\n')]);
    const secondDocument = document('architecture/overview.md', '# new second\n');
    await store.writeBase(secondSourceKey, snapshotHash, [{ ...secondDocument, record: { ...secondDocument.record, sourceKey: secondSourceKey } }]);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const batch = store.withPublishedBatch([sourceKey, secondSourceKey], async () => { entered(); await gate; throw new Error('consumer failed'); });
    await ready;
    let firstResolved = false;
    let secondResolved = false;
    const firstRead = store.readPublish(sourceKey).then((value) => { firstResolved = true; return value; });
    const secondRead = store.readPublish(secondSourceKey).then((value) => { secondResolved = true; return value; });
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
    expect(firstResolved).toBe(false);
    expect(secondResolved).toBe(false);
    release();
    await expect(batch).rejects.toThrow('consumer failed');
    await expect(firstRead).resolves.toMatchObject({ documents: [{ content: '# old first\n' }] });
    await expect(secondRead).resolves.toBeNull();
  });

  it('commits both new publishes when later backup cleanup fails and recovers the retained backup on a later read', async () => {
    const home = await temporaryDirectory();
    const secondSourceKey = 'c'.repeat(64);
    const initial = new GeneratedKnowledgeStore({ home });
    for (const [key, oldContent, newContent] of [[sourceKey, '# old first\n', '# new first\n'], [secondSourceKey, '# old second\n', '# new second\n']] as const) {
      const oldDocument = document('architecture/overview.md', oldContent);
      await initial.writeBase(key, snapshotHash, [{ ...oldDocument, record: { ...oldDocument.record, sourceKey: key } }]);
      await initial.publish(key, snapshotHash);
      const newDocument = document('architecture/overview.md', newContent);
      await initial.writeBase(key, snapshotHash, [{ ...newDocument, record: { ...newDocument.record, sourceKey: key } }]);
    }
    const cleanupFailsForSecond = new GeneratedKnowledgeStore({ home, ...({ beforeBatchBackupCleanup: async (key: string) => {
      if (key === secondSourceKey) throw new Error('second backup cleanup failed');
    } } as object) });

    await expect(cleanupFailsForSecond.withPublishedBatch([sourceKey, secondSourceKey], async () => 'committed')).resolves.toBe('committed');
    await expect(initial.readPublish(sourceKey)).resolves.toMatchObject({ documents: [{ content: '# new first\n' }] });
    await expect(readFile(join(codegraphRootFor(home, secondSourceKey), '.publish-backup', 'architecture', 'overview.md'), 'utf8')).resolves.toBe('# old second\n');
    await expect(initial.readPublish(secondSourceKey)).resolves.toMatchObject({ documents: [{ content: '# new second\n' }] });
    await expect(lstat(join(codegraphRootFor(home, secondSourceKey), '.publish-backup'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back every source when a batch consumer rejects', async () => {
    const home = await temporaryDirectory();
    const secondSourceKey = 'c'.repeat(64);
    const store = new GeneratedKnowledgeStore({ home });
    for (const key of [sourceKey, secondSourceKey]) {
      const item = document();
      await store.writeBase(key, snapshotHash, [{ ...item, record: { ...item.record, sourceKey: key } }]);
    }

    await expect(store.withPublishedBatch([sourceKey, secondSourceKey], async (sets) => {
      expect(sets.map((set) => set.manifest.sourceKey)).toEqual([sourceKey, secondSourceKey]);
      throw new Error('adapter rejected second source');
    })).rejects.toThrow('adapter rejected second source');
    await expect(store.readPublish(sourceKey)).resolves.toBeNull();
    await expect(store.readPublish(secondSourceKey)).resolves.toBeNull();
  });

  it('does not expose a caller-controlled home directory on the production facade', () => {
    expect(() => new GeneratedKnowledgeStoreFacade({ home: '/tmp/attacker-controlled-home' } as never)).toThrow(/CODE_ANALYSIS_FAILED/u);
  });

  it.each(['../escape.md', '/absolute.md', 'architecture/../escape.md'])('rejects an unsafe generated relative path: %s', async (relativePath) => {
    const store = new GeneratedKnowledgeStore({ home: await temporaryDirectory() });
    await expect(store.writeBase(sourceKey, snapshotHash, [document(relativePath)])).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
  });

  it('rejects a logical key with an empty path segment', async () => {
    const store = new GeneratedKnowledgeStore({ home: await temporaryDirectory() });
    const unsafe = document();
    unsafe.record.logicalKey = 'codegraph/architecture//overview';
    await expect(store.writeBase(sourceKey, snapshotHash, [unsafe])).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
  });

  it('rejects content-hash mismatches, oversized documents, and symlinked base files', async () => {
    const home = await temporaryDirectory();
    const store = new GeneratedKnowledgeStore({ home, maxGeneratedBytes: 20 });
    await expect(store.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', 'too much generated content\n')])).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
    await expect(store.writeBase(sourceKey, snapshotHash, [{ ...document(), record: { ...document().record, contentHash: 'c'.repeat(64) } }])).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);

    const unrestricted = new GeneratedKnowledgeStore({ home });
    await unrestricted.writeBase(sourceKey, snapshotHash, [document()]);
    const baseFile = join(home, '.agentwiki', 'workspaces', sourceKey, 'generated', 'codegraph', 'base', 'architecture', 'overview.md');
    await rm(baseFile);
    await symlink('/etc/hosts', baseFile);
    await expect(unrestricted.publish(sourceKey, snapshotHash)).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
  });

  it('keeps base immutable during publish assembly and retains the prior complete publish set after interruption', async () => {
    const home = await temporaryDirectory();
    const first = new GeneratedKnowledgeStore({ home });
    await first.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# Old overview\n')]);
    await first.publish(sourceKey, snapshotHash);
    const baseFile = join(home, '.agentwiki', 'workspaces', sourceKey, 'generated', 'codegraph', 'base', 'architecture', 'overview.md');
    const baseBefore = await readFile(baseFile, 'utf8');

    const interrupted = new GeneratedKnowledgeStore({ home, beforePromote: () => { throw new Error('interrupted publish'); } });
    await expect(interrupted.publish(sourceKey, snapshotHash)).rejects.toThrow('interrupted publish');
    expect(await readFile(baseFile, 'utf8')).toBe(baseBefore);
    await expect(first.readPublish(sourceKey)).resolves.toMatchObject({ documents: [{ content: '# Old overview\n' }] });
  });

  it('does not permit a malformed manifest to make outside files current', async () => {
    const home = await temporaryDirectory();
    const store = new GeneratedKnowledgeStore({ home });
    await store.writeBase(sourceKey, snapshotHash, [document()]);
    await store.publish(sourceKey, snapshotHash);
    const publish = join(home, '.agentwiki', 'workspaces', sourceKey, 'generated', 'codegraph', 'publish');
    await mkdir(join(home, 'outside'), { recursive: true });
    await writeFile(join(home, 'outside', 'private.md'), 'not publishable');
    const manifest = JSON.parse(await readFile(join(publish, 'manifest.json'), 'utf8')) as { records: Array<Record<string, unknown>> };
    manifest.records[0]!.relativePath = '../outside/private.md';
    await writeFile(join(publish, 'manifest.json'), JSON.stringify(manifest));
    await expect(store.readPublish(sourceKey)).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
  });

  it('fails closed for non-string content and non-canonical manifest record order', async () => {
    const home = await temporaryDirectory();
    const store = new GeneratedKnowledgeStore({ home });
    await expect(store.writeBase(sourceKey, snapshotHash, [{ ...document(), content: null as unknown as string }])).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);

    await store.writeBase(sourceKey, snapshotHash, [
      document('architecture/overview.md', '# Overview\n'),
      { ...document('architecture/entry-points.md', '# Entry points\n'), record: { ...document('architecture/entry-points.md', '# Entry points\n').record, logicalKey: 'codegraph/architecture/entry-points' } },
    ]);
    await store.publish(sourceKey, snapshotHash);
    const publish = join(home, '.agentwiki', 'workspaces', sourceKey, 'generated', 'codegraph', 'publish');
    const manifest = JSON.parse(await readFile(join(publish, 'manifest.json'), 'utf8')) as { records: Array<Record<string, unknown>> };
    manifest.records.reverse();
    await writeFile(join(publish, 'manifest.json'), JSON.stringify(manifest));
    await expect(store.readPublish(sourceKey)).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
  });

  it('rejects a symlinked private workspace root before writing outside it', async () => {
    const home = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await mkdir(join(home, '.agentwiki'), { recursive: true, mode: 0o700 });
    await symlink(outside, join(home, '.agentwiki', 'workspaces'));
    await expect(new GeneratedKnowledgeStore({ home }).writeBase(sourceKey, snapshotHash, [document()])).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
  });

  it('rejects a file replaced after its path check and produces no adapter-readable publish set', async () => {
    const home = await temporaryDirectory();
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document()]);
    const store = new GeneratedKnowledgeStore({
      home,
      ...({ afterPathCheck: async ({ path, kind }: { path: string; kind: string }) => {
        if (kind !== 'file' || !path.endsWith('overview.md')) return;
        await rm(path);
        await writeFile(path, '# replaced after check\n');
      } } as object),
    });
    await expect(store.publish(sourceKey, snapshotHash)).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
    await expect(store.readPublish(sourceKey)).resolves.toBeNull();
  });

  it('rejects a publish directory replaced after its path check', async () => {
    const home = await temporaryDirectory();
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old\n')]);
    await initial.publish(sourceKey, snapshotHash);
    let replaced = false;
    const store = new GeneratedKnowledgeStore({
      home,
      ...({ afterPathCheck: async ({ path, kind }: { path: string; kind: string }) => {
        if (replaced || kind !== 'directory' || !path.endsWith('/publish')) return;
        replaced = true;
        await rename(path, `${path}.attacker`);
        await mkdir(path, { recursive: true });
      } } as object),
    });
    await expect(store.readPublish(sourceKey)).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
  });

  it('does not clean an external staging lookalike after a real promotion rename swaps the generated ancestor', async () => {
    const home = await temporaryDirectory(); const external = await temporaryDirectory();
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old\n')]);
    await initial.publish(sourceKey, snapshotHash);
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# new\n')]);
    let externalStaging = '';
    const attacked = new GeneratedKnowledgeStore({ home, fileOps: { renameDirectory: async (from, to) => {
      await rename(from, to);
      if (basename(from).startsWith('.publish-staging-') && basename(to) === 'publish') {
        externalStaging = join(external, basename(from));
        await mkdir(externalStaging);
        await writeFile(join(externalStaging, 'sentinel'), 'external stays untouched');
        await replaceCodegraphRootWithSymlink(home, external);
      }
    } } });

    await expect(attacked.publish(sourceKey, snapshotHash)).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
    await expect(readFile(join(externalStaging, 'sentinel'), 'utf8')).resolves.toBe('external stays untouched');
  });

  it.each(['before-staging-create', 'before-staging-write'] as const)('aborts before %s when the generated ancestor is replaced by a real symlink', async (stage) => {
    const home = await temporaryDirectory(); const external = await temporaryDirectory();
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old base\n')]);
    let retained = '';
    const attacked = new GeneratedKnowledgeStore({ home, beforeMutation: async (actual) => {
      if (actual !== stage) return;
      await writeFile(join(external, 'sentinel'), 'external stays untouched');
      retained = await replaceCodegraphRootWithSymlink(home, external);
    } });

    await expect(attacked.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# new base\n')])).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
    await expect(readFile(join(external, 'sentinel'), 'utf8')).resolves.toBe('external stays untouched');
    await expect(readFile(join(retained, 'base', 'architecture', 'overview.md'), 'utf8')).resolves.toBe('# old base\n');
  });

  it.each(['current-to-backup', 'staging-to-current'] as const)('aborts after the real publish %s rename when the generated ancestor changes inode', async (seam) => {
    const home = await temporaryDirectory(); const external = await temporaryDirectory();
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old publish\n')]);
    await initial.publish(sourceKey, snapshotHash);
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# new publish\n')]);
    const calls: string[] = []; let retained = '';
    const attacked = new GeneratedKnowledgeStore({ home, fileOps: { renameDirectory: async (from, to) => {
      await rename(from, to);
      const call = `${basename(from)}>${basename(to)}`; calls.push(call);
      const matched = seam === 'current-to-backup'
        ? basename(from) === 'publish' && basename(to) === '.publish-backup'
        : basename(from).startsWith('.publish-staging-') && basename(to) === 'publish';
      if (matched) {
        await writeFile(join(external, 'sentinel'), 'external stays untouched');
        retained = await replaceCodegraphRootWithSymlink(home, external);
      }
    } } });

    await expect(attacked.publish(sourceKey, snapshotHash)).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
    expect(seam === 'current-to-backup' ? calls.includes('publish>.publish-backup') : calls.some((call) => /^\.publish-staging-.*>publish$/u.test(call))).toBe(true);
    await expect(readFile(join(external, 'sentinel'), 'utf8')).resolves.toBe('external stays untouched');
    await expect(readFile(join(retained, '.publish-backup', 'architecture', 'overview.md'), 'utf8')).resolves.toBe('# old publish\n');
  });

  it('requires a canonical manifest hash and enforces a per-document cap independently from the total cap', async () => {
    const home = await temporaryDirectory();
    const perDocumentCapped = new GeneratedKnowledgeStore({ home, maxGeneratedBytes: 1_000, ...({ maxDocumentBytes: 10 } as object) });
    await expect(perDocumentCapped.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# longer than ten bytes\n')])).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);

    const store = new GeneratedKnowledgeStore({ home });
    await store.writeBase(sourceKey, snapshotHash, [document()]);
    await store.publish(sourceKey, snapshotHash);
    const manifestPath = join(home, '.agentwiki', 'workspaces', sourceKey, 'generated', 'codegraph', 'publish', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    expect(manifest.manifestHash).toMatch(/^[a-f0-9]{64}$/u);
    delete manifest.manifestHash;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(store.readPublish(sourceKey)).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
  });

  it('enforces the cumulative cap even when every generated document fits its individual cap', async () => {
    const store = new GeneratedKnowledgeStore({ home: await temporaryDirectory(), maxGeneratedBytes: 20, maxDocumentBytes: 20 });
    await expect(store.writeBase(sourceKey, snapshotHash, [
      document('architecture/overview.md', '123456789012\n'),
      document('architecture/entry-points.md', '123456789012\n'),
    ])).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
  });

  it('rejects unsafe or unordered evidence identifiers in the public generated contract', () => {
    const record = document().record;
    expect(GeneratedKnowledgeRecordSchema.safeParse({ ...record, evidenceIds: ['snapshot:architecture/z.md', 'snapshot:architecture/a.md'] }).success).toBe(false);
    expect(GeneratedKnowledgeRecordSchema.safeParse({ ...record, evidenceIds: ['snapshot:architecture/overview.md?x=1'] }).success).toBe(false);
  });

  it.each([
    { relativePath: 'architecture/overview.md', logicalKey: 'codegraph/architecture/entry-points' },
    { relativePath: 'architecture/entry-points.md', title: 'Repository overview' },
    { relativePath: 'architecture/overview.md', evidenceIds: ['snapshot:architecture/entry-points.md'] },
    { relativePath: 'architecture/overview.md', evidenceIds: ['snapshot:architecture/overview.md', 'snapshot:architecture/entry-points.md'] },
  ])('rejects every cross-page record tuple mismatch', (override) => {
    expect(GeneratedKnowledgeRecordSchema.safeParse({ ...document().record, ...override }).success).toBe(false);
  });

  it.each(['after-current-to-backup', 'after-staging-to-current', 'after-promotion'] as const)('rolls back to the previous publish set when fsync fails at %s', async (checkpoint) => {
    const home = await temporaryDirectory();
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old\n')]);
    await initial.publish(sourceKey, snapshotHash);
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# new\n')]);
    const failing = new GeneratedKnowledgeStore({ home, fsyncDirectory: async (_path, actual) => { if (actual === checkpoint) throw new Error(`fsync ${checkpoint}`); } });
    await expect(failing.publish(sourceKey, snapshotHash)).rejects.toThrow(`fsync ${checkpoint}`);
    await expect(initial.readPublish(sourceKey)).resolves.toMatchObject({ documents: [{ content: '# old\n' }] });
  });

  it('uses real current, staging, and rollback renames before restoring the old publish set', async () => {
    const home = await temporaryDirectory(); const calls: string[] = [];
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old\n')]);
    await initial.publish(sourceKey, snapshotHash);
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# new\n')]);
    const failing = new GeneratedKnowledgeStore({ home, fileOps: {
      renameDirectory: async (from, to) => { calls.push(`${basename(from)}>${basename(to)}`); await rename(from, to); },
      fsyncDirectory: async (_path, checkpoint) => { if (checkpoint === 'after-staging-to-current') throw new Error('durability failure'); },
    } });

    await expect(failing.publish(sourceKey, snapshotHash)).rejects.toThrow('durability failure');
    expect(calls).toContain('publish>.publish-backup');
    expect(calls.some((call) => /^\.publish-staging-.*>publish$/u.test(call))).toBe(true);
    expect(calls.some((call) => /^publish>\.failed-/u.test(call))).toBe(true);
    expect(calls).toContain('.publish-backup>publish');
    await expect(initial.readPublish(sourceKey)).resolves.toMatchObject({ documents: [{ content: '# old\n' }] });
  });

  it('keeps the old current publish immediately readable when current-to-backup rename fails', async () => {
    const home = await temporaryDirectory(); const calls: string[] = [];
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old\n')]);
    await initial.publish(sourceKey, snapshotHash);
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# new\n')]);
    const failing = new GeneratedKnowledgeStore({ home, fileOps: { renameDirectory: async (from, to) => {
      calls.push(`${basename(from)}>${basename(to)}`);
      if (basename(from) === 'publish' && basename(to) === '.publish-backup') throw new Error('current backup rename failed');
      await rename(from, to);
    } } });

    await expect(failing.publish(sourceKey, snapshotHash)).rejects.toThrow('current backup rename failed');
    expect(calls).toContain('publish>.publish-backup');
    await expect(initial.readPublish(sourceKey)).resolves.toMatchObject({ documents: [{ content: '# old\n' }] });
  });

  it('restores the old current publish when staging-to-current rename fails', async () => {
    const home = await temporaryDirectory(); const calls: string[] = [];
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old\n')]);
    await initial.publish(sourceKey, snapshotHash);
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# new\n')]);
    const failing = new GeneratedKnowledgeStore({ home, fileOps: { renameDirectory: async (from, to) => {
      const call = `${basename(from)}>${basename(to)}`; calls.push(call);
      if (basename(from).startsWith('.publish-staging-') && basename(to) === 'publish') throw new Error('staging current rename failed');
      await rename(from, to);
    } } });

    await expect(failing.publish(sourceKey, snapshotHash)).rejects.toThrow('staging current rename failed');
    expect(calls).toContain('publish>.publish-backup');
    expect(calls.some((call) => /^\.publish-staging-.*>publish$/u.test(call))).toBe(true);
    expect(calls).toContain('.publish-backup>publish');
    await expect(initial.readPublish(sourceKey)).resolves.toMatchObject({ documents: [{ content: '# old\n' }] });
  });

  it('retains a verified backup when rollback restore fails, then a later reader recovers it', async () => {
    const home = await temporaryDirectory(); const calls: string[] = []; let staging = '';
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old\n')]);
    await initial.publish(sourceKey, snapshotHash);
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# new\n')]);
    const failing = new GeneratedKnowledgeStore({ home, fileOps: { renameDirectory: async (from, to) => {
      const call = `${basename(from)}>${basename(to)}`; calls.push(call);
      if (basename(from).startsWith('.publish-staging-')) { staging = from; throw new Error('staging current rename failed'); }
      if (basename(from) === '.publish-backup' && basename(to) === 'publish') throw new Error('rollback restore rename failed');
      await rename(from, to);
    } } });

    await expect(failing.publish(sourceKey, snapshotHash)).rejects.toThrow('staging current rename failed');
    expect(calls).toContain('publish>.publish-backup');
    expect(calls.some((call) => /^\.publish-staging-.*>publish$/u.test(call))).toBe(true);
    expect(calls).toContain('.publish-backup>publish');
    await expect(readFile(join(codegraphRoot(home), '.publish-backup', 'architecture', 'overview.md'), 'utf8')).resolves.toBe('# old\n');
    await expect(lstat(staging)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(initial.readPublish(sourceKey)).resolves.toMatchObject({ documents: [{ content: '# old\n' }] });
  });

  it('serializes a base replacement ahead of a concurrent publish for the same source key', async () => {
    const home = await temporaryDirectory();
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old\n')]);
    await initial.publish(sourceKey, snapshotHash);
    let entered = false;
    const writer = new GeneratedKnowledgeStore({ home, ...({ afterBaseValidated: () => { entered = true; } } as object) });
    await writer.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# new\n')]);
    expect(entered).toBe(true);
    await initial.publish(sourceKey, snapshotHash);
    await expect(initial.readPublish(sourceKey)).resolves.toMatchObject({ documents: [{ content: '# new\n' }] });
  });

  it('serializes two concurrent base writers for one source key', async () => {
    const home = await temporaryDirectory();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstEntered!: () => void;
    const firstReady = new Promise<void>((resolve) => { firstEntered = resolve; });
    let secondEntered = false;
    const first = new GeneratedKnowledgeStore({ home, afterBaseValidated: async () => { firstEntered(); await firstGate; } });
    const second = new GeneratedKnowledgeStore({ home, afterBaseValidated: () => { secondEntered = true; } });
    const firstWrite = first.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# first\n')]);
    await firstReady;
    const secondWrite = second.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# second\n')]);
    await Promise.resolve();
    expect(secondEntered).toBe(false);
    releaseFirst();
    await Promise.all([firstWrite, secondWrite]);
    await second.publish(sourceKey, snapshotHash);
    await expect(second.readPublish(sourceKey)).resolves.toMatchObject({ documents: [{ content: '# second\n' }] });
  });

  it('holds publish behind a validated base replacement for the same source key', async () => {
    const home = await temporaryDirectory();
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old\n')]);
    await initial.publish(sourceKey, snapshotHash);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const writer = new GeneratedKnowledgeStore({ home, afterBaseValidated: async () => { entered(); await gate; } });
    const replacement = writer.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# replacement\n')]);
    await ready;
    const publish = initial.publish(sourceKey, snapshotHash);
    release();
    await Promise.all([replacement, publish]);
    await expect(initial.readPublish(sourceKey)).resolves.toMatchObject({ documents: [{ content: '# replacement\n' }] });
  });

  it('allows a different source key to progress while a same-root writer is gated', async () => {
    const home = await temporaryDirectory();
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const first = new GeneratedKnowledgeStore({ home, afterBaseValidated: async () => { entered(); await gate; } });
    let otherEntered = false;
    const second = new GeneratedKnowledgeStore({ home, afterBaseValidated: () => { otherEntered = true; } });
    const firstWrite = first.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# first\n')]);
    await ready;
    await second.writeBase(otherSourceKey, snapshotHash, [{ ...document(), record: { ...document().record, sourceKey: otherSourceKey } }]);
    expect(otherEntered).toBe(true);
    release();
    await firstWrite;
  });

  it('keeps a reader pending across the real current-to-backup and staging-to-current rename window', async () => {
    const home = await temporaryDirectory();
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old\n')]);
    await initial.publish(sourceKey, snapshotHash);
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# new\n')]);
    let release!: () => void; let moved!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const movedCurrent = new Promise<void>((resolve) => { moved = resolve; });
    const calls: string[] = [];
    const writer = new GeneratedKnowledgeStore({ home, fileOps: { renameDirectory: async (from, to) => {
      calls.push(`${basename(from)}>${basename(to)}`);
      await rename(from, to);
      if (basename(from) === 'publish' && basename(to) === '.publish-backup') { moved(); await gate; }
    } } });
    const replacement = writer.publish(sourceKey, snapshotHash);
    await movedCurrent;
    let readerResolved = false;
    const reader = initial.readPublish(sourceKey).then((value) => { readerResolved = true; return value; });
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
    expect(readerResolved).toBe(false);
    release();
    await expect(replacement).resolves.toMatchObject({ snapshotHash });
    await expect(reader).resolves.toMatchObject({ documents: [{ content: '# new\n' }] });
    expect(calls).toContain('publish>.publish-backup');
    expect(calls.some((call) => /^\.publish-staging-.*>publish$/u.test(call))).toBe(true);
  });

  it('recovers a complete backup as current but fails closed for an invalid backup', async () => {
    const home = await temporaryDirectory();
    const store = new GeneratedKnowledgeStore({ home });
    await store.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old\n')]);
    await store.publish(sourceKey, snapshotHash);
    const root = join(home, '.agentwiki', 'workspaces', sourceKey, 'generated', 'codegraph');
    await rename(join(root, 'publish'), join(root, '.publish-backup'));
    await expect(store.readPublish(sourceKey)).resolves.toMatchObject({ documents: [{ content: '# old\n' }] });
    await rename(join(root, 'publish'), join(root, '.publish-backup'));
    await writeFile(join(root, '.publish-backup', 'manifest.json'), '{}');
    await expect(store.readPublish(sourceKey)).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
  });

  it('keeps a verified backup intact when its recovery rename fails, then recovers it with a later reader', async () => {
    const home = await temporaryDirectory();
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old\n')]);
    await initial.publish(sourceKey, snapshotHash);
    const root = codegraphRoot(home);
    await rename(join(root, 'publish'), join(root, '.publish-backup'));
    const failing = new GeneratedKnowledgeStore({ home, fileOps: { renameDirectory: async (from, to) => {
      if (basename(from) === '.publish-backup' && basename(to) === 'publish') throw new Error('backup recovery rename failed');
      await rename(from, to);
    } } });
    await expect(failing.readPublish(sourceKey)).rejects.toThrow('backup recovery rename failed');
    await expect(readFile(join(root, '.publish-backup', 'architecture', 'overview.md'), 'utf8')).resolves.toBe('# old\n');
    await expect(initial.readPublish(sourceKey)).resolves.toMatchObject({ documents: [{ content: '# old\n' }] });
  });

  it('never deletes a symlinked-ancestor backup lookalike after reading a valid current publish', async () => {
    const home = await temporaryDirectory(); const external = await temporaryDirectory();
    const initial = new GeneratedKnowledgeStore({ home });
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# old\n')]);
    await initial.publish(sourceKey, snapshotHash);
    await initial.writeBase(sourceKey, snapshotHash, [document('architecture/overview.md', '# new\n')]);
    await initial.publish(sourceKey, snapshotHash);
    let hookEntered = false;
    const attacked = new GeneratedKnowledgeStore({ home, ...({ beforeBackupCleanup: async () => {
      hookEntered = true;
      await mkdir(join(external, '.publish-backup'));
      await writeFile(join(external, '.publish-backup', 'sentinel'), 'external stays untouched');
      await replaceCodegraphRootWithSymlink(home, external);
    } } as object) });

    await expect(attacked.readPublish(sourceKey)).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
    expect(hookEntered).toBe(true);
    await expect(readFile(join(external, '.publish-backup', 'sentinel'), 'utf8')).resolves.toBe('external stays untouched');
  });

  it.each([
    { O_NOFOLLOW: undefined, O_DIRECTORY: 1 },
    { O_NOFOLLOW: 1, O_DIRECTORY: undefined },
    { O_NOFOLLOW: 0, O_DIRECTORY: 1 },
    { O_NOFOLLOW: 1, O_DIRECTORY: 0 },
  ])('fails closed when required platform flags are unavailable: %o', (platform) => {
    expect(() => new GeneratedKnowledgeStore({ home: '/tmp/never-used', platform })).toThrow(/CODE_ANALYSIS_FAILED/u);
  });

  it('fails closed when directory fsync is unsupported', async () => {
    const home = await temporaryDirectory();
    const store = new GeneratedKnowledgeStore({ home, fileOps: { fsyncDirectory: async () => { const error = new Error('directory fsync unsupported'); Object.assign(error, { code: 'ENOTSUP' }); throw error; } } });
    await expect(store.writeBase(sourceKey, snapshotHash, [document()])).rejects.toThrow('directory fsync unsupported');
    await expect(store.readBase(sourceKey)).resolves.toBeNull();
  });
});
