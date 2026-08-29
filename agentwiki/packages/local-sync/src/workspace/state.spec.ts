import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { workspacePaths, ensureWorkspace, initManifest, readManifest, writeCheckpoint, readCheckpoint, listCheckpoints, writeDraft, readDraft, listDrafts, writeBase, readBase, appendProvenance, readProvenance, writeWikiPage, readWikiPage, listWikiPages, writeWikiMemory, readWikiMemory, writeWikiRelations, readWikiRelations } from './index.js';
import {
  applyFolderTreeTransactionV2,
  readFolderIdentityStateV2,
  recoverFolderTreeTransactionV2,
  writeFolderIdentityStateV2,
} from './state.js';
import { assertLocalManifest, type FolderIdentityStateV2 } from './manifest.js';
import { JobStateSchema } from '../protocol/job.js';
import { contentHash as treePageContentHash, treeRevisionContentHashV2, type TreeRevisionContentManifestV2 } from '@neomei/agentwiki-sync-protocol';

describe('workspace state persistence', () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'agentwiki-local-sync-'));
  });

  afterEach(async () => {
    expect(base.startsWith(join(tmpdir(), 'agentwiki-local-sync-'))).toBe(true);
    await rm(base, { recursive: true, force: true });
  });

  const timestamp = '2026-08-29T00:00:00.000Z';
  const emptyTree = (): TreeRevisionContentManifestV2 => ({
    protocolVersion: '2', spaceId: 'space-1', folders: [], pages: [],
  });
  const folderState = (revision = 'rev-0'): FolderIdentityStateV2 => ({
    schemaVersion: 2, spaceId: 'space-1', revision, folders: {},
  });
  const interruptCompletedPageMove = async (paths: ReturnType<typeof workspacePaths>) => {
    const body = 'stable body';
    const initial: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1', folders: [],
      pages: [{
        pageId: 'p1', folderId: null, path: 'pages/Before.md', title: 'Before', body,
        contentHash: await treePageContentHash(body), updatedAt: timestamp,
      }],
    };
    await applyFolderTreeTransactionV2(paths, emptyTree(), initial, folderState(), { revision: 'rev-1' });
    const target: TreeRevisionContentManifestV2 = {
      ...initial,
      pages: [{ ...initial.pages[0]!, path: 'pages/After.md', title: 'After' }],
    };
    await expect(applyFolderTreeTransactionV2(
      paths, initial, target, (await readFolderIdentityStateV2(paths))!, {
        revision: 'rev-2',
        onCheckpoint: async (checkpoint) => {
          if (checkpoint === 'operation:5:committed') throw new Error('interrupt completed Page move');
        },
      },
    )).rejects.toThrow('interrupt completed Page move');
    return { initial, target, body };
  };

  it('creates all workspace directories', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const manifest = await readManifest(paths);
    expect(manifest).toBeNull();
  });

  it('initializes and reads a manifest', async () => {
    const paths = workspacePaths(base, 'space-1');
    const created = await initManifest(paths, 'space-1', '2024-01-01T00:00:00Z');
    expect(created.spaceId).toBe('space-1');

    const read = await readManifest(paths);
    expect(read?.schemaVersion).toBe('1.0');
    expect(read?.baseRevision).toBeNull();
  });

  it('rejects a malformed manifest file', async () => {
    const paths = workspacePaths(base, 'space-1');
    await initManifest(paths, 'space-1', '2024-01-01T00:00:00Z');
    expect(() =>
      assertLocalManifest({ schemaVersion: '1.0', spaceId: 'space-1', createdAt: 'bad', updatedAt: 'bad', baseRevision: null, pendingRevision: null, sources: [], checkpoints: [] }),
    ).toThrow();
  });

  it('writes and reads checkpoints', async () => {
    const paths = workspacePaths(base, 'space-1');
    const state: import('../protocol/job.js').JobState = {
      jobId: 'job-1',
      spaceId: 'space-1',
      recipeId: 'recipe-1',
      recipeVersion: '1.0',
      phase: 'discover',
      baseRevision: '0',
      adapterIds: ['a'],
      sourcePaths: ['/tmp'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      workItems: [],
    };
    const id = await writeCheckpoint(paths, JobStateSchema.parse(state));
    expect(id).toContain('job-1:discover');

    const ids = await listCheckpoints(paths);
    expect(ids).toContain(id);

    const loaded = await readCheckpoint(paths, id);
    expect(loaded?.jobId).toBe('job-1');
  });

  it('writes and reads drafts', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await writeDraft(paths, 'd1', { title: 'Draft' });
    const loaded = await readDraft(paths, 'd1');
    expect(loaded).toEqual({ title: 'Draft' });
    expect(await listDrafts(paths)).toContain('d1');
  });

  it('writes and reads base revisions', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await writeBase(paths, 'rev-1', { revision: 1 });
    expect(await readBase(paths, 'rev-1')).toEqual({ revision: 1 });
    expect(await readBase(paths, 'rev-2')).toBeNull();
  });

  it('appends provenance', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await appendProvenance(paths, [{ action: 'a' }]);
    await appendProvenance(paths, [{ action: 'b' }]);
    const all = await readProvenance(paths);
    expect(all).toHaveLength(2);
    expect(all[1]).toEqual({ action: 'b' });
  });

  it('writes and reads wiki pages', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await writeWikiPage(paths, 'p1', '# Hello');
    expect(await readWikiPage(paths, 'p1')).toBe('# Hello');
    expect(await listWikiPages(paths)).toContain('p1');
  });

  it('writes and reads wiki memories', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await writeWikiMemory(paths, 'm1', { content: 'x' });
    expect(await readWikiMemory(paths, 'm1')).toEqual({ content: 'x' });
  });

  it('writes and reads wiki relations', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await writeWikiRelations(paths, [{ a: 1 }]);
    expect(await readWikiRelations(paths)).toEqual([{ a: 1 }]);
  });

  it('persists Folder identity only under the private control root', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const state: FolderIdentityStateV2 = {
      schemaVersion: 2, spaceId: 'space-1', revision: 'rev-1',
      folders: {
        'folder-1': { path: 'pages/Project', pathKey: 'pages/project', updatedAt: timestamp },
      },
    };

    await writeFolderIdentityStateV2(paths, state);

    expect(await readFolderIdentityStateV2(paths)).toEqual(state);
    expect((await readdir(paths.pagesDir)).some((name) => name.startsWith('.agentwiki'))).toBe(false);
    expect(paths.folderIdentityFile.startsWith(paths.stateRoot)).toBe(true);
  });

  it('materializes nested empty Folders and permits a Page with the same basename', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const target: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1',
      folders: [
        { folderId: 'f1', parentFolderId: null, name: 'Project', path: 'pages/Project', sortOrder: 0, updatedAt: timestamp },
        { folderId: 'f2', parentFolderId: 'f1', name: 'Empty', path: 'pages/Project/Empty', sortOrder: 0, updatedAt: timestamp },
      ],
      pages: [{
        pageId: 'p1', folderId: null, path: 'pages/Project.md', title: 'Project', body: '# Project\n',
        contentHash: 'aef277fb6a70a89681a85e1b6d23f44ee2a6cc58490f9f5c95fc99db6d2d3542', updatedAt: timestamp,
      }],
    };

    await applyFolderTreeTransactionV2(paths, emptyTree(), target, folderState(), { revision: 'rev-1' });

    expect((await lstat(join(paths.pagesDir, 'Project', 'Empty'))).isDirectory()).toBe(true);
    expect(await readFile(join(paths.pagesDir, 'Project.md'), 'utf8')).toBe('# Project\n');
    expect((await readFolderIdentityStateV2(paths))?.revision).toBe('rev-1');
  });

  it('rejects path traversal, a symlink ancestor, and a symlink destination', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const traversal = structuredClone(emptyTree());
    traversal.folders.push({
      folderId: 'f1', parentFolderId: null, name: '..', path: 'pages/../escape', sortOrder: 0, updatedAt: timestamp,
    });
    await expect(applyFolderTreeTransactionV2(paths, emptyTree(), traversal, folderState(), { revision: 'rev-1' }))
      .rejects.toThrow(/portable|path|managed/i);

    await symlink(base, join(paths.pagesDir, 'linked'));
    const linked = structuredClone(emptyTree());
    linked.folders.push(
      { folderId: 'f0', parentFolderId: null, name: 'linked', path: 'pages/linked', sortOrder: 0, updatedAt: timestamp },
      { folderId: 'f1', parentFolderId: 'f0', name: 'child', path: 'pages/linked/child', sortOrder: 0, updatedAt: timestamp },
    );
    await expect(applyFolderTreeTransactionV2(paths, emptyTree(), linked, folderState(), { revision: 'rev-1' }))
      .rejects.toThrow(/symbolic|symlink/i);
    await recoverFolderTreeTransactionV2(paths, 'rollback');

    const outside = join(base, 'outside.md');
    await writeFile(outside, 'outside');
    await symlink(outside, join(paths.pagesDir, 'Target.md'));
    const destination = structuredClone(emptyTree());
    destination.pages.push({
      pageId: 'p1', folderId: null, path: 'pages/Target.md', title: 'Target', body: 'safe',
      contentHash: '8b3369944dd2a3fab39e32d1aeb1f763946a458ae3e6368a46432adc8f3a0860', updatedAt: timestamp,
    });
    await expect(applyFolderTreeTransactionV2(paths, emptyTree(), destination, folderState(), { revision: 'rev-1' }))
      .rejects.toThrow(/symbolic|symlink/i);
    expect(await readFile(outside, 'utf8')).toBe('outside');
  });

  it('replays an interrupted parent-first transaction and fsyncs checkpoints', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const target: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1',
      folders: [
        { folderId: 'f1', parentFolderId: null, name: 'Parent', path: 'pages/Parent', sortOrder: 0, updatedAt: timestamp },
        { folderId: 'f2', parentFolderId: 'f1', name: 'Child', path: 'pages/Parent/Child', sortOrder: 0, updatedAt: timestamp },
      ], pages: [],
    };
    const checkpoints: string[] = [];
    await expect(applyFolderTreeTransactionV2(paths, emptyTree(), target, folderState(), {
      revision: 'rev-1',
      onCheckpoint: async (checkpoint) => {
        checkpoints.push(checkpoint);
        if (checkpoint === 'operation:1:committed') throw new Error('injected interruption');
      },
    })).rejects.toThrow('injected interruption');

    await recoverFolderTreeTransactionV2(paths, 'replay');

    expect((await lstat(join(paths.pagesDir, 'Parent', 'Child'))).isDirectory()).toBe(true);
    expect((await readFolderIdentityStateV2(paths))?.revision).toBe('rev-1');
    expect(checkpoints).toContain('operation:0:fsync');
  });

  it.each([
    'journal:committed',
    'operation:0:prepared',
    'operation:0:fsync',
    'operation:0:applied',
    'operation:0:committed',
    'state:committed',
  ])('replays safely after the durable %s crash phase', async (crashCheckpoint) => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const target: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1', pages: [],
      folders: [{ folderId: 'f1', parentFolderId: null, name: 'Recovered', path: 'pages/Recovered', sortOrder: 0, updatedAt: timestamp }],
    };

    await expect(applyFolderTreeTransactionV2(paths, emptyTree(), target, folderState(), {
      revision: 'rev-1',
      onCheckpoint: async (checkpoint) => {
        if (checkpoint === crashCheckpoint) throw new Error(`crash at ${checkpoint}`);
      },
    })).rejects.toThrow(`crash at ${crashCheckpoint}`);

    await recoverFolderTreeTransactionV2(paths, 'replay');

    expect((await lstat(join(paths.pagesDir, 'Recovered'))).isDirectory()).toBe(true);
    expect(await readFolderIdentityStateV2(paths)).toMatchObject({ revision: 'rev-1', folders: { f1: { path: 'pages/Recovered' } } });
    await expect(lstat(paths.folderTransactionJournalFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['control:prepared', 'control:base', 'control:identity', 'control:manifest', 'control:committed'])(
    'recovers one durable filesystem, base, identity, and manifest commit after %s interruption',
    async (crashCheckpoint) => {
      const paths = workspacePaths(base, 'space-1');
      await ensureWorkspace(paths);
      await initManifest(paths, 'space-1', timestamp);
      const body = '# Durable\n';
      const target: TreeRevisionContentManifestV2 = {
        protocolVersion: '2', spaceId: 'space-1',
        folders: [{ folderId: 'f1', parentFolderId: null, name: 'Durable', path: 'pages/Durable', sortOrder: 0, updatedAt: timestamp }],
        pages: [{ pageId: 'p1', folderId: 'f1', path: 'pages/Durable/Page.md', title: 'Page', body, contentHash: await treePageContentHash(body), updatedAt: timestamp }],
      };
      const revisionContentHash = await treeRevisionContentHashV2(target);

      await expect(applyFolderTreeTransactionV2(paths, emptyTree(), target, folderState(), {
        revision: 'rev-1',
        controlBase: target,
        revisionContentHash,
        pulledAt: timestamp,
        onCheckpoint: async (checkpoint) => {
          if (checkpoint === crashCheckpoint) throw new Error(`crash at ${checkpoint}`);
        },
      })).rejects.toThrow(`crash at ${crashCheckpoint}`);

      await recoverFolderTreeTransactionV2(paths, 'replay');

      expect(await readBase(paths, 'rev-1')).toEqual(target);
      expect(await readFolderIdentityStateV2(paths)).toMatchObject({ revision: 'rev-1', folders: { f1: { path: 'pages/Durable' } } });
      expect(await readManifest(paths)).toMatchObject({
        baseRevision: { revision: 'rev-1', contentHash: revisionContentHash, pulledAt: timestamp },
      });
      expect(await readFile(join(paths.pagesDir, 'Durable', 'Page.md'), 'utf8')).toBe(body);
      await expect(lstat(paths.folderTransactionJournalFile)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('rolls back an operation interrupted after mutation but before its journal cursor advances', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const target: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1', pages: [],
      folders: [{ folderId: 'f1', parentFolderId: null, name: 'Created', path: 'pages/Created', sortOrder: 0, updatedAt: timestamp }],
    };
    await expect(applyFolderTreeTransactionV2(paths, emptyTree(), target, folderState(), {
      revision: 'rev-1',
      onCheckpoint: async (checkpoint) => {
        if (checkpoint === 'operation:0:fsync') throw new Error('power loss');
      },
    })).rejects.toThrow('power loss');

    await recoverFolderTreeTransactionV2(paths, 'rollback');

    await expect(lstat(join(paths.pagesDir, 'Created'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFolderIdentityStateV2(paths)).toBeNull();
  });

  it('preserves an ambiguous journal after a crash immediately after the filesystem syscall', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const target: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1', pages: [],
      folders: [{ folderId: 'f1', parentFolderId: null, name: 'Created', path: 'pages/Created', sortOrder: 0, updatedAt: timestamp }],
    };

    await expect(applyFolderTreeTransactionV2(paths, emptyTree(), target, folderState(), {
      revision: 'rev-1',
      onCheckpoint: async (checkpoint) => {
        if (checkpoint === 'operation:1:syscall') throw new Error('power loss after syscall');
      },
    })).rejects.toThrow('power loss after syscall');

    expect((await lstat(join(paths.pagesDir, 'Created'))).isDirectory()).toBe(true);
    await expect(recoverFolderTreeTransactionV2(paths, 'rollback')).rejects.toThrow(/ambiguous|journal/i);
    expect(await lstat(paths.folderTransactionJournalFile)).toBeDefined();
    expect(await readFolderIdentityStateV2(paths)).toBeNull();
  });

  it('rolls back an exactly identified applied operation after a crash before its cursor advances', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const target: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1', pages: [],
      folders: [{ folderId: 'f1', parentFolderId: null, name: 'Created', path: 'pages/Created', sortOrder: 0, updatedAt: timestamp }],
    };

    await expect(applyFolderTreeTransactionV2(paths, emptyTree(), target, folderState(), {
      revision: 'rev-1',
      onCheckpoint: async (checkpoint) => {
        if (checkpoint === 'operation:0:applied') throw new Error('power loss after applied state');
      },
    })).rejects.toThrow('power loss after applied state');

    await recoverFolderTreeTransactionV2(paths, 'rollback');

    await expect(lstat(join(paths.pagesDir, 'Created'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(paths.folderTransactionJournalFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back a dependent Page link/unlink move using only identities generated by earlier reverses', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const { body } = await interruptCompletedPageMove(paths);

    await recoverFolderTreeTransactionV2(paths, 'rollback');

    expect(await readFile(join(paths.pagesDir, 'Before.md'), 'utf8')).toBe(body);
    await expect(lstat(join(paths.pagesDir, 'After.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readFolderIdentityStateV2(paths))?.revision).toBe('rev-1');
    expect((await readdir(paths.pagesDir)).some((name) => name.startsWith('AgentWiki Rename '))).toBe(false);
    await expect(lstat(paths.folderTransactionJournalFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    'rollback:prepared',
    'rollback:5:prepared',
    'rollback:5:applied',
    'rollback:5:committed',
    'rollback:4:applied',
    'rollback:complete',
  ])('replays a rolling-back multi-operation journal after %s', async (crashCheckpoint) => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const { body } = await interruptCompletedPageMove(paths);

    await expect(recoverFolderTreeTransactionV2(paths, 'rollback', {
      onCheckpoint: async (checkpoint) => {
        if (checkpoint === crashCheckpoint) throw new Error(`rollback crash at ${checkpoint}`);
      },
    })).rejects.toThrow(`rollback crash at ${crashCheckpoint}`);

    await recoverFolderTreeTransactionV2(paths, 'replay');

    expect(await readFile(join(paths.pagesDir, 'Before.md'), 'utf8')).toBe(body);
    await expect(lstat(join(paths.pagesDir, 'After.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readFolderIdentityStateV2(paths))?.revision).toBe('rev-1');
    expect((await readdir(paths.pagesDir)).some((name) => name.startsWith('AgentWiki Rename '))).toBe(false);
    await expect(lstat(paths.folderTransactionJournalFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['directory', 'rollback:5:artifact-prepared'],
    ['directory', 'rollback:5:before-syscall'],
    ['directory', 'rollback:5:after-syscall'],
    ['directory', 'rollback:5:applied'],
    ['file', 'rollback:4:artifact-prepared'],
    ['file', 'rollback:4:before-syscall'],
    ['file', 'rollback:4:after-syscall'],
    ['file', 'rollback:4:applied'],
  ])('replays a pre-identified %s rollback artifact after %s', async (_kind, crashCheckpoint) => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const { body } = await interruptCompletedPageMove(paths);

    await expect(recoverFolderTreeTransactionV2(paths, 'rollback', {
      onCheckpoint: async (checkpoint) => {
        if (checkpoint === crashCheckpoint) throw new Error(`rollback crash at ${checkpoint}`);
      },
    })).rejects.toThrow(`rollback crash at ${crashCheckpoint}`);

    await recoverFolderTreeTransactionV2(paths, 'replay');

    expect(await readFile(join(paths.pagesDir, 'Before.md'), 'utf8')).toBe(body);
    await expect(lstat(join(paths.pagesDir, 'After.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(paths.runtimeDir)).some((name) => name.startsWith('folder-tree-rollback-'))).toBe(false);
    await expect(lstat(paths.folderTransactionJournalFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed when an external directory replaces a materialized rollback artifact', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await interruptCompletedPageMove(paths);

    await expect(recoverFolderTreeTransactionV2(paths, 'rollback', {
      onCheckpoint: async (checkpoint) => {
        if (checkpoint === 'rollback:5:after-syscall') throw new Error('pause after directory materialization');
      },
    })).rejects.toThrow('pause after directory materialization');

    const journal = JSON.parse(await readFile(paths.folderTransactionJournalFile, 'utf8')) as {
      operations: Array<{ kind: string; path?: string }>;
      operationStates: Array<{ rollbackArtifact?: { target: string } }>;
    };
    const target = journal.operationStates[5]?.rollbackArtifact?.target ?? journal.operations[5]?.path;
    expect(target).toBeDefined();
    const targetPath = join(paths.pagesDir, target!);
    const transactionOriginal = `${targetPath}.transaction-original`;
    await rename(targetPath, transactionOriginal);
    await mkdir(targetPath);
    const outside = join(base, 'outside-sentinel.md');
    await writeFile(outside, 'outside', 'utf8');

    await expect(recoverFolderTreeTransactionV2(paths, 'replay')).rejects.toThrow(/replaced|identity|ambiguous/i);
    expect((await lstat(targetPath)).isDirectory()).toBe(true);
    expect((await lstat(transactionOriginal)).isDirectory()).toBe(true);
    expect(await readFile(outside, 'utf8')).toBe('outside');
    expect(await lstat(paths.folderTransactionJournalFile)).toBeDefined();
  });

  it('does not clean an externally replaced private rollback artifact', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await interruptCompletedPageMove(paths);

    await expect(recoverFolderTreeTransactionV2(paths, 'rollback', {
      onCheckpoint: async (checkpoint) => {
        if (checkpoint === 'rollback:5:artifact-prepared') throw new Error('pause after private artifact fsync');
      },
    })).rejects.toThrow('pause after private artifact fsync');

    const journal = JSON.parse(await readFile(paths.folderTransactionJournalFile, 'utf8')) as {
      operationStates: Array<{ rollbackArtifact?: { source: string } }>;
    };
    const source = journal.operationStates[5]?.rollbackArtifact?.source;
    expect(source).toBeDefined();
    const sourcePath = join(paths.runtimeDir, source!);
    const transactionOriginal = `${sourcePath}.transaction-original`;
    await rename(sourcePath, transactionOriginal);
    await mkdir(sourcePath);

    await expect(recoverFolderTreeTransactionV2(paths, 'replay')).rejects.toThrow(/artifact|replaced|identity/i);
    expect((await lstat(sourcePath)).isDirectory()).toBe(true);
    expect((await lstat(transactionOriginal)).isDirectory()).toBe(true);
    expect(await lstat(paths.folderTransactionJournalFile)).toBeDefined();
  });

  it('never replaces an unknown Folder that appears at the rollback materialization boundary', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await interruptCompletedPageMove(paths);
    const outside = join(base, 'outside-sentinel.md');
    await writeFile(outside, 'outside', 'utf8');
    let replacementPath: string | undefined;

    await expect(recoverFolderTreeTransactionV2(paths, 'rollback', {
      afterPathCheck: async (checked) => {
        if (!replacementPath && checked.startsWith(paths.pagesDir) && basename(checked).startsWith('AgentWiki Rename ')) {
          replacementPath = checked;
          await mkdir(checked);
        }
      },
    })).rejects.toThrow(/appeared|changed|identity/i);

    expect(replacementPath).toBeDefined();
    expect((await lstat(replacementPath!)).isDirectory()).toBe(true);
    expect(await readFile(outside, 'utf8')).toBe('outside');
    await expect(recoverFolderTreeTransactionV2(paths, 'replay')).rejects.toThrow(/replaced|identity|ambiguous/i);
    expect(await lstat(paths.folderTransactionJournalFile)).toBeDefined();
  });

  it('rejects an external replacement of an exact file identity generated during rollback', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const { body } = await interruptCompletedPageMove(paths);

    await expect(recoverFolderTreeTransactionV2(paths, 'rollback', {
      onCheckpoint: async (checkpoint) => {
        if (checkpoint === 'rollback:4:applied') throw new Error('pause after exact rollback identity');
      },
    })).rejects.toThrow('pause after exact rollback identity');

    const staging = (await readdir(paths.pagesDir)).find((name) => name.startsWith('AgentWiki Rename '));
    expect(staging).toBeDefined();
    const stagedPage = (await readdir(join(paths.pagesDir, staging!))).find((name) => name.endsWith('.md'));
    expect(stagedPage).toBeDefined();
    const stagedPath = join(paths.pagesDir, staging!, stagedPage!);
    await rename(stagedPath, `${stagedPath}.external-original`);
    await writeFile(stagedPath, body, 'utf8');

    await expect(recoverFolderTreeTransactionV2(paths, 'replay')).rejects.toThrow(/replaced|identity|journal/i);
    expect(await lstat(paths.folderTransactionJournalFile)).toBeDefined();
  });

  it('rejects a malicious persisted journal before replaying any operation', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const outside = join(paths.wikiRoot, 'outside.md');
    await writeFile(outside, 'sentinel', 'utf8');
    await writeFile(paths.folderTransactionJournalFile, JSON.stringify({
      schemaVersion: 2, spaceId: 'space-1', revision: 'rev-1', nextOperation: 0,
      operations: [
        { kind: 'mkdir', path: 'Safe' },
        { kind: 'write', path: '../outside.md', before: 'sentinel', after: 'overwritten' },
      ],
      finalState: folderState('rev-1'),
    }), 'utf8');

    await expect(recoverFolderTreeTransactionV2(paths, 'replay')).rejects.toThrow(/journal|managed|path/i);

    expect(await readFile(outside, 'utf8')).toBe('sentinel');
    await expect(lstat(join(paths.pagesDir, 'Safe'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a structurally torn operation state before committing or clearing the journal', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const root = await lstat(paths.pagesDir, { bigint: true });
    await writeFile(paths.folderTransactionJournalFile, JSON.stringify({
      schemaVersion: 2, spaceId: 'space-1', revision: 'rev-1', phase: 'applying', nextOperation: 1,
      rootIdentity: { dev: root.dev.toString(), ino: root.ino.toString() },
      operations: [{ kind: 'mkdir', path: 'Safe' }],
      operationStates: [{ status: 'applied', before: [], after: [] }],
      finalState: folderState('rev-1'),
    }), 'utf8');

    await expect(recoverFolderTreeTransactionV2(paths, 'replay')).rejects.toThrow(/journal|state|identity/i);

    expect(await lstat(paths.folderTransactionJournalFile)).toBeDefined();
    expect(await readFolderIdentityStateV2(paths)).toBeNull();
    await expect(lstat(join(paths.pagesDir, 'Safe'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not roll back operation zero when the durable cursor says nothing ran', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const root = await lstat(paths.pagesDir, { bigint: true });
    const target = join(paths.pagesDir, 'Local.md');
    await writeFile(target, 'outside transaction', 'utf8');
    await writeFile(paths.folderTransactionJournalFile, JSON.stringify({
      schemaVersion: 2, spaceId: 'space-1', revision: 'rev-1', phase: 'applying', nextOperation: 0,
      rootIdentity: { dev: root.dev.toString(), ino: root.ino.toString() },
      operations: [{ kind: 'write', path: 'Local.md', before: null, after: 'remote' }],
      operationStates: [{ status: 'prepared', before: [] }],
      finalState: folderState('rev-1'),
    }), 'utf8');

    await recoverFolderTreeTransactionV2(paths, 'rollback');

    expect(await readFile(target, 'utf8')).toBe('outside transaction');
  });

  it('fails closed instead of following a replaced ancestor while rolling back', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const root = await lstat(paths.pagesDir, { bigint: true });
    const outsideDirectory = join(base, 'outside-directory');
    await mkdir(outsideDirectory);
    const outsideFile = join(outsideDirectory, 'Outside.md');
    await writeFile(outsideFile, 'outside transaction', 'utf8');
    await symlink(outsideDirectory, join(paths.pagesDir, 'Sub'));
    await writeFile(paths.folderTransactionJournalFile, JSON.stringify({
      schemaVersion: 2, spaceId: 'space-1', revision: 'rev-1', phase: 'applying', nextOperation: 1,
      rootIdentity: { dev: root.dev.toString(), ino: root.ino.toString() },
      operations: [
        { kind: 'mkdir', path: 'Sub' },
        { kind: 'write', path: 'Sub/Outside.md', before: null, after: 'remote' },
      ],
      operationStates: [
        {
          status: 'applied',
          before: [{ path: 'Sub', kind: 'missing' }],
          after: [{ path: 'Sub', kind: 'directory', dev: root.dev.toString(), ino: root.ino.toString() }],
        },
        { status: 'prepared', before: [] },
      ],
      finalState: folderState('rev-1'),
    }), 'utf8');

    await expect(recoverFolderTreeTransactionV2(paths, 'rollback')).rejects.toThrow(/symbolic|journal|unsafe|directory/i);
    expect(await readFile(outsideFile, 'utf8')).toBe('outside transaction');
    expect(await lstat(paths.folderTransactionJournalFile)).toBeDefined();
  });

  it('rolls back an interrupted child-first removal without advancing identity state', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const initial: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1',
      folders: [
        { folderId: 'f1', parentFolderId: null, name: 'Parent', path: 'pages/Parent', sortOrder: 0, updatedAt: timestamp },
        { folderId: 'f2', parentFolderId: 'f1', name: 'Child', path: 'pages/Parent/Child', sortOrder: 0, updatedAt: timestamp },
      ], pages: [],
    };
    await applyFolderTreeTransactionV2(paths, emptyTree(), initial, folderState(), { revision: 'rev-1' });
    const state = (await readFolderIdentityStateV2(paths))!;
    await expect(applyFolderTreeTransactionV2(paths, initial, emptyTree(), state, {
      revision: 'rev-2',
      onCheckpoint: async (checkpoint) => {
        if (checkpoint === 'operation:0:committed') throw new Error('stop after child removal');
      },
    })).rejects.toThrow('stop after child removal');

    await recoverFolderTreeTransactionV2(paths, 'rollback');

    expect((await lstat(join(paths.pagesDir, 'Parent', 'Child'))).isDirectory()).toBe(true);
    expect((await readFolderIdentityStateV2(paths))?.revision).toBe('rev-1');
  });

  it('uses a safe intermediate path for a case-only Folder rename', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const initial: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1', pages: [],
      folders: [{ folderId: 'f1', parentFolderId: null, name: 'Project', path: 'pages/Project', sortOrder: 0, updatedAt: timestamp }],
    };
    await applyFolderTreeTransactionV2(paths, emptyTree(), initial, folderState(), { revision: 'rev-1' });
    const target = structuredClone(initial);
    target.folders[0] = { ...target.folders[0]!, name: 'project', path: 'pages/project' };
    let observedIntermediate = false;

    await applyFolderTreeTransactionV2(paths, initial, target, (await readFolderIdentityStateV2(paths))!, {
      revision: 'rev-2',
      onCheckpoint: async (checkpoint) => {
        if (checkpoint === 'operation:0:fsync') {
          observedIntermediate = (await readdir(paths.pagesDir)).some((name) => name.startsWith('AgentWiki Rename '));
        }
      },
    });

    expect(observedIntermediate).toBe(true);
    expect((await lstat(join(paths.pagesDir, 'project'))).isDirectory()).toBe(true);
    expect((await readdir(paths.pagesDir)).some((name) => name.startsWith('AgentWiki Rename '))).toBe(false);
  });

  it('moves a Folder before creating a new child at its destination', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const initial: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1', pages: [],
      folders: [{ folderId: 'f1', parentFolderId: null, name: 'Old', path: 'pages/Old', sortOrder: 0, updatedAt: timestamp }],
    };
    await applyFolderTreeTransactionV2(paths, emptyTree(), initial, folderState(), { revision: 'rev-1' });
    const target: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1', pages: [],
      folders: [
        { ...initial.folders[0]!, name: 'New', path: 'pages/New' },
        { folderId: 'f2', parentFolderId: 'f1', name: 'Child', path: 'pages/New/Child', sortOrder: 0, updatedAt: timestamp },
      ],
    };

    await applyFolderTreeTransactionV2(paths, initial, target, (await readFolderIdentityStateV2(paths))!, { revision: 'rev-2' });

    expect((await lstat(join(paths.pagesDir, 'New', 'Child'))).isDirectory()).toBe(true);
    await expect(lstat(join(paths.pagesDir, 'Old'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('orders a multi-level Folder move child-first then recreates the destination parent-first', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const body = 'nested';
    const initial: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1',
      folders: [
        { folderId: 'root', parentFolderId: null, name: 'Old', path: 'pages/Old', sortOrder: 0, updatedAt: timestamp },
        { folderId: 'child', parentFolderId: 'root', name: 'Child', path: 'pages/Old/Child', sortOrder: 0, updatedAt: timestamp },
        { folderId: 'leaf', parentFolderId: 'child', name: 'Leaf', path: 'pages/Old/Child/Leaf', sortOrder: 0, updatedAt: timestamp },
      ],
      pages: [{ pageId: 'p1', folderId: 'leaf', path: 'pages/Old/Child/Leaf/Page.md', title: 'Page', body, contentHash: await treePageContentHash(body), updatedAt: timestamp }],
    };
    await applyFolderTreeTransactionV2(paths, emptyTree(), initial, folderState(), { revision: 'rev-1' });
    const target: TreeRevisionContentManifestV2 = {
      ...initial,
      folders: [
        { ...initial.folders[0]!, name: 'New', path: 'pages/New' },
        { ...initial.folders[1]!, name: 'Renamed Child', path: 'pages/New/Renamed Child' },
        { ...initial.folders[2]!, path: 'pages/New/Renamed Child/Leaf' },
        { folderId: 'new-child', parentFolderId: 'leaf', name: 'New Empty', path: 'pages/New/Renamed Child/Leaf/New Empty', sortOrder: 0, updatedAt: timestamp },
      ],
      pages: [{ ...initial.pages[0]!, path: 'pages/New/Renamed Child/Leaf/Page.md' }],
    };

    await applyFolderTreeTransactionV2(paths, initial, target, (await readFolderIdentityStateV2(paths))!, { revision: 'rev-2' });

    expect(await readFile(join(paths.pagesDir, 'New', 'Renamed Child', 'Leaf', 'Page.md'), 'utf8')).toBe(body);
    expect((await lstat(join(paths.pagesDir, 'New', 'Renamed Child', 'Leaf', 'New Empty'))).isDirectory()).toBe(true);
    await expect(lstat(join(paths.pagesDir, 'Old'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('swaps two Folder paths without replacing either directory', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const initial: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1',
      folders: [
        { folderId: 'fa', parentFolderId: null, name: 'A', path: 'pages/A', sortOrder: 0, updatedAt: timestamp },
        { folderId: 'fb', parentFolderId: null, name: 'B', path: 'pages/B', sortOrder: 1, updatedAt: timestamp },
      ],
      pages: [
        { pageId: 'pa', folderId: 'fa', path: 'pages/A/A.md', title: 'A', body: 'from A', contentHash: await treePageContentHash('from A'), updatedAt: timestamp },
        { pageId: 'pb', folderId: 'fb', path: 'pages/B/B.md', title: 'B', body: 'from B', contentHash: await treePageContentHash('from B'), updatedAt: timestamp },
      ],
    };
    await applyFolderTreeTransactionV2(paths, emptyTree(), initial, folderState(), { revision: 'rev-1' });
    const target = structuredClone(initial);
    target.folders = [
      { ...initial.folders[0]!, name: 'B', path: 'pages/B' },
      { ...initial.folders[1]!, name: 'A', path: 'pages/A' },
    ];
    target.pages = [
      { ...initial.pages[0]!, path: 'pages/B/A.md' },
      { ...initial.pages[1]!, path: 'pages/A/B.md' },
    ];

    await applyFolderTreeTransactionV2(paths, initial, target, (await readFolderIdentityStateV2(paths))!, { revision: 'rev-2' });

    expect(await readFile(join(paths.pagesDir, 'B', 'A.md'), 'utf8')).toBe('from A');
    expect(await readFile(join(paths.pagesDir, 'A', 'B.md'), 'utf8')).toBe('from B');
  });

  it('revalidates every checked path component by device and inode before mutation', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const originalBody = 'original';
    const changedBody = 'changed';
    const folderOnly: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1',
      folders: [{ folderId: 'f1', parentFolderId: null, name: 'Project', path: 'pages/Project', sortOrder: 0, updatedAt: timestamp }],
      pages: [],
    };
    await applyFolderTreeTransactionV2(paths, emptyTree(), folderOnly, folderState(), { revision: 'rev-1' });
    const initial: TreeRevisionContentManifestV2 = {
      ...folderOnly,
      pages: [{
        pageId: 'p1', folderId: 'f1', path: 'pages/Project/Doc.md', title: 'Doc', body: originalBody,
        contentHash: await treePageContentHash(originalBody), updatedAt: timestamp,
      }],
    };
    await applyFolderTreeTransactionV2(paths, folderOnly, initial, (await readFolderIdentityStateV2(paths))!, { revision: 'rev-2' });
    const target = structuredClone(initial);
    target.pages[0] = { ...target.pages[0]!, body: changedBody, contentHash: await treePageContentHash(changedBody) };
    let swapped = false;

    await expect(applyFolderTreeTransactionV2(paths, initial, target, (await readFolderIdentityStateV2(paths))!, {
      revision: 'rev-3',
      afterPathCheck: async (checked) => {
        if (!swapped && checked.endsWith(join('Project', 'Doc.md'))) {
          swapped = true;
          await rename(join(paths.pagesDir, 'Project'), join(paths.pagesDir, 'Project-original'));
          await mkdir(join(paths.pagesDir, 'Project'));
        }
      },
    })).rejects.toThrow(/device.*inode|identity/i);

    expect(await readFile(join(paths.pagesDir, 'Project-original', 'Doc.md'), 'utf8')).toBe(originalBody);
    expect((await readFolderIdentityStateV2(paths))?.revision).toBe('rev-2');
  });

  it('revalidates a missing Page destination at the final syscall boundary', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const body = 'remote';
    const target: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1', folders: [],
      pages: [{ pageId: 'p1', folderId: null, path: 'pages/Target.md', title: 'Target', body, contentHash: await treePageContentHash(body), updatedAt: timestamp }],
    };
    let checks = 0;

    await expect(applyFolderTreeTransactionV2(paths, emptyTree(), target, folderState(), {
      revision: 'rev-1',
      afterPathCheck: async (checked) => {
        if (checked.endsWith('Target.md') && ++checks === 2) {
          await writeFile(join(paths.pagesDir, 'Target.md'), 'intruder', { encoding: 'utf8', flag: 'wx' });
        }
      },
    })).rejects.toThrow(/changed|identity|destination|exist/i);

    expect(await readFile(join(paths.pagesDir, 'Target.md'), 'utf8')).toBe('intruder');
    expect(await readFolderIdentityStateV2(paths)).toBeNull();
  });

  it('never replaces a Folder destination that appears at the final mkdir boundary', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const target: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1', pages: [],
      folders: [{ folderId: 'f1', parentFolderId: null, name: 'Target', path: 'pages/Target', sortOrder: 0, updatedAt: timestamp }],
    };
    let checks = 0;

    await expect(applyFolderTreeTransactionV2(paths, emptyTree(), target, folderState(), {
      revision: 'rev-1',
      afterPathCheck: async (checked) => {
        if (checked.endsWith('Target') && ++checks === 2) {
          await mkdir(join(paths.pagesDir, 'Target'));
          await writeFile(join(paths.pagesDir, 'Target', 'sentinel.md'), 'intruder', 'utf8');
        }
      },
    })).rejects.toThrow(/changed|identity|destination|exist/i);

    expect(await readFile(join(paths.pagesDir, 'Target', 'sentinel.md'), 'utf8')).toBe('intruder');
    expect(await readFolderIdentityStateV2(paths)).toBeNull();
    expect(await lstat(paths.folderTransactionJournalFile)).toBeDefined();
  });

  it('creates a Page inside a new Folder in one parent-first transaction', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const body = '# New\n';
    const target: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1',
      folders: [{ folderId: 'f1', parentFolderId: null, name: 'New', path: 'pages/New', sortOrder: 0, updatedAt: timestamp }],
      pages: [{ pageId: 'p1', folderId: 'f1', path: 'pages/New/Page.md', title: 'Page', body, contentHash: await treePageContentHash(body), updatedAt: timestamp }],
    };

    await applyFolderTreeTransactionV2(paths, emptyTree(), target, folderState(), { revision: 'rev-1' });

    expect(await readFile(join(paths.pagesDir, 'New', 'Page.md'), 'utf8')).toBe(body);
  });

  it('moves and modifies a Page by stable Page ID in one transaction', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const originalBody = 'before';
    const changedBody = 'after';
    const initial: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1', folders: [],
      pages: [{ pageId: 'p1', folderId: null, path: 'pages/Before.md', title: 'Before', body: originalBody, contentHash: await treePageContentHash(originalBody), updatedAt: timestamp }],
    };
    await applyFolderTreeTransactionV2(paths, emptyTree(), initial, folderState(), { revision: 'rev-1' });
    const target = structuredClone(initial);
    target.pages[0] = { ...target.pages[0]!, path: 'pages/After.md', title: 'After', body: changedBody, contentHash: await treePageContentHash(changedBody) };

    await applyFolderTreeTransactionV2(paths, initial, target, (await readFolderIdentityStateV2(paths))!, { revision: 'rev-2' });

    expect(await readFile(join(paths.pagesDir, 'After.md'), 'utf8')).toBe(changedBody);
    await expect(lstat(join(paths.pagesDir, 'Before.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses a safe intermediate path for a case-only Page rename', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const body = 'body';
    const initial: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1', folders: [],
      pages: [{ pageId: 'p1', folderId: null, path: 'pages/Readme.md', title: 'Readme', body, contentHash: await treePageContentHash(body), updatedAt: timestamp }],
    };
    await applyFolderTreeTransactionV2(paths, emptyTree(), initial, folderState(), { revision: 'rev-1' });
    const target = structuredClone(initial);
    target.pages[0] = { ...target.pages[0]!, path: 'pages/README.md', title: 'README' };
    let observedIntermediate = false;

    await applyFolderTreeTransactionV2(paths, initial, target, (await readFolderIdentityStateV2(paths))!, {
      revision: 'rev-2',
      onCheckpoint: async (checkpoint) => {
        if (checkpoint === 'operation:0:fsync') {
          observedIntermediate = (await readdir(paths.pagesDir)).some((name) => name.startsWith('AgentWiki Rename '));
        }
      },
    });

    expect(observedIntermediate).toBe(true);
    expect(await readFile(join(paths.pagesDir, 'README.md'), 'utf8')).toBe(body);
  });

  it('refuses to adopt an unknown Folder or overwrite an unknown Page', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await mkdir(join(paths.pagesDir, 'Unknown'));
    await writeFile(join(paths.pagesDir, 'Unknown.md'), 'local-only', 'utf8');
    const folderTarget: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1', pages: [],
      folders: [{ folderId: 'f1', parentFolderId: null, name: 'Unknown', path: 'pages/Unknown', sortOrder: 0, updatedAt: timestamp }],
    };
    await expect(applyFolderTreeTransactionV2(paths, emptyTree(), folderTarget, folderState(), { revision: 'rev-1' }))
      .rejects.toThrow(/unknown|identity|destination/i);
    await recoverFolderTreeTransactionV2(paths, 'rollback');

    const pageBody = 'remote';
    const pageTarget: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1', folders: [],
      pages: [{ pageId: 'p1', folderId: null, path: 'pages/Unknown.md', title: 'Unknown', body: pageBody, contentHash: await treePageContentHash(pageBody), updatedAt: timestamp }],
    };
    await expect(applyFolderTreeTransactionV2(paths, emptyTree(), pageTarget, folderState(), { revision: 'rev-1' }))
      .rejects.toThrow(/unknown|identity|destination/i);
    expect(await readFile(join(paths.pagesDir, 'Unknown.md'), 'utf8')).toBe('local-only');
  });
});
