import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspacePaths, ensureWorkspace, initManifest, readManifest, writeCheckpoint, readCheckpoint, listCheckpoints, writeDraft, readDraft, listDrafts, writeBase, readBase, appendProvenance, readProvenance, writeWikiPage, readWikiPage, listWikiPages, writeWikiMemory, readWikiMemory, writeWikiRelations, readWikiRelations } from './index.js';
import {
  applyFolderTreeTransactionV2,
  readFolderIdentityStateV2,
  recoverFolderTreeTransactionV2,
  writeFolderIdentityStateV2,
} from './state.js';
import { assertLocalManifest, type FolderIdentityStateV2 } from './manifest.js';
import { JobStateSchema } from '../protocol/job.js';
import { contentHash as treePageContentHash, type TreeRevisionContentManifestV2 } from '@neomei/agentwiki-sync-protocol';

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
    linked.folders.push({ folderId: 'f1', parentFolderId: null, name: 'child', path: 'pages/linked/child', sortOrder: 0, updatedAt: timestamp });
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
