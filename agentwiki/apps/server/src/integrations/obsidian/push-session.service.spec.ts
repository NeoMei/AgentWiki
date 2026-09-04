import { PushSessionService } from './push-session.service';
import {
  canonicalBytes,
  confirmationHash,
  contentHash,
  treeBatchHashV2,
  treeConfirmationHashV2,
} from '@neomei/agentwiki-sync-protocol';
import { ContentTreeError, type ContentTreeErrorCode } from '../../content-tree/content-tree.types';

describe('PushSessionService graph lifecycle', () => {
  it('indexes finalized page changes before enqueueing a graph refresh', async () => {
    const prisma = {
      changeItem: { findMany: jest.fn().mockResolvedValue([
        { type: 'create_page', publishedResourceId: 'created' },
        { type: 'update_page', publishedResourceId: 'updated' },
        { type: 'archive_page', publishedResourceId: 'archived' },
      ]) },
    };
    const search = {
      indexPage: jest.fn().mockResolvedValue(undefined),
      deletePageIndex: jest.fn().mockResolvedValue(undefined),
    };
    const graph = { enqueue: jest.fn() };
    const Service = PushSessionService as any;
    const service = new Service(prisma, {}, {}, search, undefined, graph);

    await expect((service as any).refreshGraphAfterFinalize('space-1', 'change-set-1'))
      .resolves.toBeUndefined();

    expect(search.indexPage).toHaveBeenCalledWith('created');
    expect(search.indexPage).toHaveBeenCalledWith('updated');
    expect(search.deletePageIndex).toHaveBeenCalledWith('archived');
    expect(graph.enqueue).toHaveBeenCalledWith('space-1');
    expect(Math.max(
      ...search.indexPage.mock.invocationCallOrder,
      ...search.deletePageIndex.mock.invocationCallOrder,
    )).toBeLessThan(graph.enqueue.mock.invocationCallOrder[0]);
  });

  it('does not turn a committed finalize into an error when post-commit indexing lookup fails', async () => {
    const prisma = {
      changeItem: { findMany: jest.fn().mockRejectedValue(new Error('database offline')) },
    };
    const graph = { enqueue: jest.fn() };
    const Service = PushSessionService as any;
    const service = new Service(
      prisma,
      {},
      {},
      { indexPage: jest.fn(), deletePageIndex: jest.fn() },
      undefined,
      graph,
    );

    await expect((service as any).refreshGraphAfterFinalize('space-1', 'change-set-1'))
      .resolves.toBeUndefined();

    expect(graph.enqueue).toHaveBeenCalledWith('space-1');
  });

  it('bounds post-finalize indexing concurrency for large pushes', async () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      type: 'update_page', publishedResourceId: `page-${index}`,
    }));
    let active = 0;
    let maximum = 0;
    const indexPage = jest.fn().mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
    });
    const Service = PushSessionService as any;
    const service = new Service(
      { changeItem: { findMany: jest.fn().mockResolvedValue(items) } },
      {},
      {},
      { indexPage, deletePageIndex: jest.fn() },
      undefined,
      { enqueue: jest.fn() },
    );

    await (service as any).refreshGraphAfterFinalize('space-1', 'change-set-1');

    expect(indexPage).toHaveBeenCalledTimes(20);
    expect(maximum).toBeLessThanOrEqual(8);
  });

  it.each([
    ['archive', { operation: 'archive', pageId: 'knowledge-1', previousPath: 'pages/Current.md' }, null],
    ['restore', { operation: 'upsert', pageId: 'knowledge-1', path: 'pages/Restored.md', title: 'Restored', body: 'Body' }, new Date('2026-08-20T00:00:00.000Z')],
    ['update', { operation: 'upsert', pageId: 'knowledge-1', path: 'pages/Updated.md', title: 'Updated', body: 'Body' }, null],
  ])('records folderId in the PageVersion created by a %s push', async (_name, change, deletedAt) => {
    const current = {
      id: 'page-1', knowledgeKey: 'knowledge-1', spaceId: 'space-1',
      title: 'Current', content: 'Current body', authorId: 'author-1',
      slug: 'current', format: 'markdown', parentId: null, folderId: 'folder-1',
      syncPath: 'pages/Current.md', syncPathKey: 'pages/current.md', deletedAt,
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
      updatedAt: new Date('2026-08-20T00:00:00.000Z'),
    };
    const tx = {
      page: {
        findUnique: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const contentTree = {
      prepareExactPageMutation: jest.fn().mockResolvedValue({
        folderId: 'folder-1',
        syncPath: change.operation === 'upsert' ? (change as any).path : current.syncPath,
        syncPathKey: change.operation === 'upsert'
          ? String((change as any).path).toLowerCase()
          : current.syncPathKey,
      }),
    };
    const Service = PushSessionService as any;
    const service = new Service({}, {}, contentTree, {}, undefined, undefined);

    await (service as any).applyPageChanges(tx, 'space-1', 'user-1', [change]);

    expect(tx.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ folderId: 'folder-1' }),
    }));
  });

  it('binds a newly created Page to the Obsidian ChangeSet as both source and latest change', async () => {
    const tx = {
      page: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'page-1' }),
      },
    };
    const contentTree = {
      prepareExactPageMutation: jest.fn().mockResolvedValue({
        folderId: 'folder-1',
        syncPath: 'pages/Team/New.md',
        syncPathKey: 'pages/team/new.md',
      }),
    };
    const service: any = new (PushSessionService as any)(
      {}, {}, contentTree, {}, undefined, undefined,
    );

    await service.applyPageChanges(tx, 'space-1', 'user-1', [{
      operation: 'upsert', pageId: 'knowledge-1',
      path: 'pages/Team/New.md', title: 'New', body: '# New',
    }], 'change-set-1');

    expect(tx.page.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceChangeSetId: 'change-set-1',
        lastChangeSetId: 'change-set-1',
      }),
    }));
  });

  it('captures a reversible update snapshot including slug without replacing the original source', async () => {
    const current = {
      id: 'page-1', knowledgeKey: 'knowledge-1', spaceId: 'space-1',
      title: 'Before', slug: 'before-slug', content: '# Before', format: 'markdown',
      authorId: 'author-1', parentId: null, folderId: 'folder-old',
      syncPath: 'pages/Old/Before.md', syncPathKey: 'pages/old/before.md',
      sourceChangeSetId: 'original-change-set', lastChangeSetId: 'previous-change-set',
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
      updatedAt: new Date('2026-08-20T00:00:00.000Z'), deletedAt: null,
      lastModifiedAt: new Date('2026-08-20T00:00:00.000Z'),
    };
    const tx = {
      page: {
        findUnique: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
    };
    const contentTree = {
      prepareExactPageMutation: jest.fn().mockResolvedValue({
        folderId: 'folder-new',
        syncPath: 'pages/New/After.md',
        syncPathKey: 'pages/new/after.md',
      }),
    };
    const service: any = new (PushSessionService as any)(
      {}, {}, contentTree, {}, undefined, undefined,
    );

    const result = await service.applyPageChanges(tx, 'space-1', 'user-1', [{
      operation: 'upsert', pageId: 'knowledge-1',
      path: 'pages/New/After.md', title: 'After', body: '# After',
    }], 'change-set-1');

    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastChangeSetId: 'change-set-1' }),
    }));
    expect(tx.page.updateMany.mock.calls[0][0].data).not.toHaveProperty('sourceChangeSetId');
    expect(result.applied[0].payload.before).toEqual(expect.objectContaining({
      slug: 'before-slug',
      folderId: 'folder-old',
      syncPath: 'pages/Old/Before.md',
      deletedAt: null,
      sourceChangeSetId: 'original-change-set',
      lastChangeSetId: 'previous-change-set',
    }));
  });

  it('classifies an archived Page restore as an update and preserves a self-contained archived snapshot', async () => {
    const archivedAt = new Date('2026-08-20T00:00:00.000Z');
    const current = {
      id: 'page-1', knowledgeKey: 'knowledge-1', spaceId: 'space-1',
      title: 'Archived', slug: 'archived-slug', content: '# Archived', format: 'markdown',
      authorId: 'author-1', parentId: null, folderId: 'folder-old',
      syncPath: 'pages/Old/Archived.md', syncPathKey: 'pages/old/archived.md',
      sourceChangeSetId: 'original-change-set', lastChangeSetId: 'previous-change-set',
      createdByAgentId: 'agent-original', deletionBatchId: null,
      createdAt: archivedAt, updatedAt: archivedAt, deletedAt: archivedAt,
      lastModifiedAt: archivedAt, lastModifiedByUserId: null,
      lastModifiedByAgentId: 'agent-original', sourceId: 'source-1',
      sourceVersionId: 'source-version-1', sourcePath: 'docs/archived.md',
    };
    const tx = {
      page: {
        findUnique: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
    };
    const contentTree = {
      prepareExactPageMutation: jest.fn().mockResolvedValue({
        folderId: 'folder-new',
        syncPath: 'pages/New/Restored.md',
        syncPathKey: 'pages/new/restored.md',
      }),
    };
    const service: any = new (PushSessionService as any)(
      {}, {}, contentTree, {}, undefined, undefined,
    );

    const result = await service.applyPageChanges(tx, 'space-1', 'user-1', [{
      operation: 'upsert', pageId: 'knowledge-1',
      path: 'pages/New/Restored.md', title: 'Restored', body: '# Restored',
    }], 'change-set-restore');

    expect(result.applied).toEqual([expect.objectContaining({
      type: 'update_page',
      payload: expect.objectContaining({
        before: expect.objectContaining({
          restoredFromArchive: true,
          slug: 'archived-slug',
          folderId: 'folder-old',
          syncPath: 'pages/Old/Archived.md',
          syncPathKey: 'pages/old/archived.md',
          deletedAt: archivedAt.toISOString(),
          deletionBatchId: null,
          sourceChangeSetId: 'original-change-set',
          lastChangeSetId: 'previous-change-set',
        }),
      }),
    })]);
    expect(tx.page.updateMany.mock.calls[0][0].data).not.toHaveProperty('sourceChangeSetId');
  });

  it('rejects an Obsidian upsert of a Folder-deletion-batch Page before placement or Page writes', async () => {
    const archivedAt = new Date('2026-08-20T00:00:00.000Z');
    const current = {
      id: 'page-1', knowledgeKey: 'knowledge-1', spaceId: 'space-1',
      title: 'Batch archived', slug: 'batch-archived', content: '# Archived', format: 'markdown',
      authorId: 'author-1', parentId: null, folderId: 'folder-deleted',
      syncPath: 'pages/Deleted/Archived.md', syncPathKey: 'pages/deleted/archived.md',
      sourceChangeSetId: 'original-change-set', lastChangeSetId: 'delete-change-set',
      deletionBatchId: 'batch-1', createdAt: archivedAt, updatedAt: archivedAt,
      deletedAt: archivedAt, lastModifiedAt: archivedAt,
    };
    const tx = {
      page: {
        findUnique: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pageVersion: { create: jest.fn() },
    };
    const contentTree = {
      prepareExactPageMutation: jest.fn().mockResolvedValue({
        folderId: null,
        syncPath: 'pages/Restored.md',
        syncPathKey: 'pages/restored.md',
      }),
    };
    const service: any = new (PushSessionService as any)(
      {}, {}, contentTree, {}, undefined, undefined,
    );

    await expect(service.applyPageChanges(tx, 'space-1', 'user-1', [{
      operation: 'upsert', pageId: 'knowledge-1',
      path: 'pages/Restored.md', title: 'Restored', body: '# Restored',
    }], 'change-set-restore')).rejects.toMatchObject({ syncCode: 'PAGE_ID_CONFLICT' });

    expect(contentTree.prepareExactPageMutation).not.toHaveBeenCalled();
    expect(tx.pageVersion.create).not.toHaveBeenCalled();
    expect(tx.page.updateMany).not.toHaveBeenCalled();
  });

  it('binds an archived Page to the Obsidian ChangeSet without replacing its source', async () => {
    const current = {
      id: 'page-1', knowledgeKey: 'knowledge-1', spaceId: 'space-1',
      title: 'Before', slug: 'before-slug', content: '# Before', format: 'markdown',
      authorId: 'author-1', parentId: null, folderId: 'folder-1',
      syncPath: 'pages/Team/Before.md', syncPathKey: 'pages/team/before.md',
      sourceChangeSetId: 'original-change-set', lastChangeSetId: 'previous-change-set',
      deletionBatchId: null, createdByAgentId: 'agent-original',
      lastModifiedByUserId: 'user-before', lastModifiedByAgentId: null,
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
      updatedAt: new Date('2026-08-20T00:00:00.000Z'), deletedAt: null,
      lastModifiedAt: new Date('2026-08-20T00:00:00.000Z'),
    };
    const tx = {
      page: {
        findUnique: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const contentTree = {
      prepareExactPageMutation: jest.fn().mockResolvedValue({
        folderId: 'folder-1',
        syncPath: current.syncPath,
        syncPathKey: current.syncPathKey,
      }),
    };
    const service: any = new (PushSessionService as any)(
      {}, {}, contentTree, {}, undefined, undefined,
    );

    const result = await service.applyPageChanges(tx, 'space-1', 'user-1', [{
      operation: 'archive', pageId: 'knowledge-1', previousPath: current.syncPath,
    }], 'change-set-1');

    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastChangeSetId: 'change-set-1' }),
    }));
    expect(tx.page.updateMany.mock.calls[0][0].data).not.toHaveProperty('sourceChangeSetId');
    expect(result.applied[0].payload.before).toEqual(expect.objectContaining({
      title: 'Before', slug: 'before-slug', content: '# Before', format: 'markdown',
      folderId: 'folder-1', syncPath: 'pages/Team/Before.md',
      syncPathKey: 'pages/team/before.md', deletedAt: null, deletionBatchId: null,
      sourceChangeSetId: 'original-change-set', lastChangeSetId: 'previous-change-set',
      createdByAgentId: 'agent-original', lastModifiedByUserId: 'user-before',
    }));
  });

  it('delegates exact incoming path placement and aliasing to ContentTree for a structural update', async () => {
    const current = {
      id: 'page-1', knowledgeKey: 'knowledge-1', spaceId: 'space-1',
      title: 'Current', content: 'Current body', authorId: 'author-1',
      slug: 'current', format: 'markdown', parentId: null, folderId: null,
      syncPath: 'pages/Current.md', syncPathKey: 'pages/current.md',
      sortOrder: 0, createdAt: new Date('2026-08-20T00:00:00.000Z'),
      updatedAt: new Date('2026-08-20T00:00:00.000Z'), deletedAt: null,
    };
    const tx = {
      page: {
        findUnique: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
    };
    const contentTree = {
      prepareExactPageMutation: jest.fn().mockResolvedValue({
        folderId: 'folder-1',
        syncPath: 'pages/Team/Renamed.md',
        syncPathKey: 'pages/team/renamed.md',
      }),
    };
    const Service = PushSessionService as any;
    const service = new Service({}, {}, {}, {}, undefined, undefined);
    (service as any).contentTree = contentTree;

    const result = await (service as any).applyPageChanges(tx, 'space-1', 'user-1', [{
      operation: 'upsert', pageId: 'knowledge-1',
      path: 'pages/Team/Renamed.md', title: 'Renamed', body: '# Renamed',
    }]);

    expect(contentTree.prepareExactPageMutation).toHaveBeenCalledWith(tx, expect.objectContaining({
      spaceId: 'space-1', pageId: 'page-1', syncPath: 'pages/Team/Renamed.md',
      current: expect.objectContaining({ folderId: null, syncPath: 'pages/Current.md' }),
    }));
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        parentId: null, folderId: 'folder-1', syncPath: 'pages/Team/Renamed.md',
      }),
    }));
    expect(result).toEqual(expect.objectContaining({
      structural: true,
      revisionChanges: [expect.objectContaining({
        operation: 'upsert', pageId: 'knowledge-1', folderId: 'folder-1',
      })],
    }));
  });

  it('finalizes under the ContentTree lock and advances exactly one tree/sync revision from the protocol base CAS', async () => {
    const staged = {
      operation: 'upsert', pageId: 'knowledge-1', path: 'pages/Team/Renamed.md',
      title: 'Renamed', body: '# Renamed',
    };
    const manifest = {
      protocolVersion: '1' as const,
      spaceId: 'space-1',
      baseRevision: 'sync-1',
      changes: [{
        operation: 'upsert' as const,
        pageId: staged.pageId,
        path: staged.path,
        title: staged.title,
        contentHash: await contentHash(staged.body),
      }],
    };
    const confirmation = await confirmationHash(manifest);
    const session: any = {
      id: 'session-1', protocolVersion: '1', spaceId: 'space-1', credentialId: 'credential-1',
      status: 'ready_to_finalize', result: null, baseRevisionId: 'sync-1',
      confirmationHash: confirmation,
      confirmationByteLength: canonicalBytes(manifest).byteLength,
      receivedBatchCount: 1, changeCount: 1,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const revision = {
      id: 'sync-2', sequence: 2, createdAt: new Date('2026-08-28T00:00:00.000Z'),
      revisionContentHash: 'hash-2', pageCount: 1n,
      revisionManifestByteLength: 100n, revisionBodyBytes: 20n,
    };
    const tx: any = {
      $executeRaw: jest.fn(),
      space: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) },
      pushSession: {
        findUnique: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockResolvedValue({}),
      },
      pushSessionBatch: { findMany: jest.fn().mockResolvedValue([{ batchIndex: 0 }]) },
      pushSessionChange: { findMany: jest.fn().mockResolvedValue([staged]) },
      spaceKnowledgeRevision: {
        findFirst: jest.fn().mockResolvedValue({ ...revision, id: 'sync-1', sequence: 1 }),
        findUnique: jest.fn().mockResolvedValue(revision),
      },
      page: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue({
          spaceId: 'space-1', deletedAt: null, deletionBatchId: null,
        }),
      },
      folder: { count: jest.fn().mockResolvedValue(0) },
      changeSet: {
        create: jest.fn().mockResolvedValue({ id: 'change-set-1' }),
        update: jest.fn().mockResolvedValue({ id: 'change-set-1' }),
      },
      changeItem: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      ...tx,
      $transaction: jest.fn((callback: any) => callback(tx)),
      changeItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const writer = {
      lockSpace: jest.fn().mockImplementation(async (value: any) => value),
      advance: jest.fn().mockResolvedValue({
        revisionId: revision.id, ...revision,
      }),
    };
    const contentTree = {
      lockSyncMutationSpace: jest.fn().mockImplementation(async (value: any) =>
        Object.assign(value, { contentTreeRevision: 7n })),
      advancePageMutation: jest.fn().mockResolvedValue({
        treeRevision: 8n, syncRevisionId: revision.id,
      }),
    };
    const service: any = new (PushSessionService as any)(
      prisma, {}, writer, {}, undefined, undefined,
    );
    service.contentTree = contentTree;
    service.redis = undefined;
    service.search = { indexPage: jest.fn(), deletePageIndex: jest.fn() };
    service.graphMaintenance = { enqueue: jest.fn() };
    service.isNoop = jest.fn().mockResolvedValue(false);
    service.assertNoPathCollisions = jest.fn().mockResolvedValue(undefined);
    service.applyPageChanges = jest.fn().mockResolvedValue({
      applied: [{ type: 'update_page', payload: {}, publishedResourceId: 'page-1' }],
      structural: true,
      revisionChanges: [{
        operation: 'upsert', pageId: staged.pageId, folderId: 'folder-1',
        path: staged.path, title: staged.title, body: staged.body,
      }],
    });
    const principal = {
      userId: 'user-1', platformRole: 'super_admin', credentialId: 'credential-1',
      credentialFamilyId: 'family-1',
    };

    await expect(service.finalize(
      principal, 'space-1', 'session-1', confirmation,
    )).resolves.toMatchObject({ status: 'published', revision: 'sync-2' });

    expect(contentTree.lockSyncMutationSpace).toHaveBeenCalledWith(tx, 'space-1');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(tx.$executeRaw.mock.calls[0]))
      .toContain('agentwiki:sync-page-content-store:v1');
    expect(JSON.stringify(tx.$executeRaw.mock.calls[1]))
      .not.toContain('agentwiki:sync-page-content-store:v1');
    expect(tx.changeSet.create.mock.invocationCallOrder[0])
      .toBeLessThan(service.applyPageChanges.mock.invocationCallOrder[0]);
    expect(service.applyPageChanges).toHaveBeenCalledWith(
      tx, 'space-1', 'user-1', expect.any(Array), 'change-set-1',
    );
    expect(tx.changeSet.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'change-set-1' },
      data: expect.objectContaining({ status: 'published', publishedAt: expect.any(Date) }),
    }));
    expect(contentTree.advancePageMutation).toHaveBeenCalledTimes(1);
    expect(contentTree.advancePageMutation).toHaveBeenCalledWith(tx, expect.objectContaining({
      spaceId: 'space-1', expectedTreeRevision: 7n, structural: true,
      revisionOrigin: expect.objectContaining({ origin: 'obsidian_sync' }),
    }));
    expect(writer.lockSpace).not.toHaveBeenCalled();
    expect(writer.advance).not.toHaveBeenCalled();
  });
});

describe('PushSessionService Sync Protocol v2', () => {
  const principal = {
    userId: 'user-1', platformRole: 'super_admin' as const,
    credentialId: 'credential-1', credentialFamilyId: 'family-1',
  };

  it('uses SyncCapabilitiesService as the single v2 capability and hash source', async () => {
    const capabilitySource = {
      capabilities: jest.fn().mockReturnValue({ maxBatchItems: 1 }),
      hash: jest.fn().mockResolvedValue('v1-hash'),
      capabilitiesV2: jest.fn().mockReturnValue({ maxBatchBytes: 321 }),
      hashV2: jest.fn().mockResolvedValue('v2-hash'),
    };
    const service: any = new (PushSessionService as any)({}, {}, {}, {}, undefined, undefined, capabilitySource);

    expect(service.capabilitiesV2()).toEqual({ maxBatchBytes: 321 });
    await expect(service.capabilityHashV2()).resolves.toBe('v2-hash');
    expect(capabilitySource.capabilitiesV2).toHaveBeenCalledTimes(1);
    expect(capabilitySource.hashV2).toHaveBeenCalledTimes(1);
  });

  it('reports capability drift on an existing v2 session instead of hiding it as missing', async () => {
    const capabilitySource = {
      capabilitiesV2: jest.fn(),
      hashV2: jest.fn().mockResolvedValue('current-hash'),
    };
    const service: any = new (PushSessionService as any)({}, {}, {}, {}, undefined, undefined, capabilitySource);

    await expect(service.assertV2Session({ protocolVersion: '2', capabilitiesHash: 'old-hash' }))
      .rejects.toMatchObject({ syncCode: 'CAPABILITIES_CHANGED' });
  });

  it.each(['create', 'upload', 'finalize', 'get', 'abort'] as const)(
    'reports CAPABILITIES_CHANGED during the v2 %s phase before mutating the session',
    async (phase) => {
      const session: any = {
        id: '11111111-1111-4111-8111-111111111111', protocolVersion: '2',
        userId: 'user-1', spaceId: 'space-1', credentialId: 'credential-1', credentialFamilyId: 'family-1',
        baseRevisionId: 'rev-1', idempotencyKey: '22222222-2222-4222-8222-222222222222',
        capabilitiesHash: 'old-hash', confirmationHash: 'a'.repeat(64), confirmationByteLength: 1,
        changeCount: 0, totalBodyBytes: 0n, status: 'ready_to_finalize', result: null,
        expiresAt: new Date(Date.now() + 60_000), batches: [], receivedBatchCount: 0,
      };
      const tx: any = {
        $executeRaw: jest.fn(),
        space: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) },
        pushSession: { findUnique: jest.fn().mockResolvedValue(session), update: jest.fn() },
        pushSessionBatch: { findUnique: jest.fn(), deleteMany: jest.fn() },
        pushSessionChange: { deleteMany: jest.fn() },
      };
      const prisma: any = phase === 'create' || phase === 'get'
        ? { pushSession: { findUnique: jest.fn().mockResolvedValue(session) } }
        : phase === 'finalize'
          ? {
              pushSession: { findUnique: jest.fn().mockResolvedValue({ id: session.id, spaceId: 'space-1', protocolVersion: '2' }) },
              $transaction: jest.fn((callback: any) => callback(tx)),
            }
          : { $transaction: jest.fn((callback: any) => callback(tx)) };
      const capabilitySource = {
        capabilitiesV2: jest.fn().mockReturnValue({ maxChangeCount: 100, maxConfirmationBytes: 4_194_304 }),
        hashV2: jest.fn().mockResolvedValue('current-hash'),
      };
      const contentTree = { lockSyncMutationSpace: jest.fn(async () => tx) };
      const service: any = new (PushSessionService as any)(
        prisma, {}, contentTree, {}, undefined, undefined, capabilitySource,
      );
      let action: Promise<unknown>;
      if (phase === 'create') {
        action = service.createV2(principal, 'space-1', {
          protocolVersion: '2', baseRevision: 'rev-1', idempotencyKey: session.idempotencyKey,
          capabilitiesHash: 'old-hash', confirmationHash: session.confirmationHash,
          confirmationByteLength: 1, changeCount: 0, totalBodyBytes: 0,
        });
      } else if (phase === 'upload') {
        action = service.uploadV2(principal, 'space-1', session.id, {
          protocolVersion: '2', batchIndex: 0, batchHash: 'a'.repeat(64), changes: [],
        });
      } else if (phase === 'finalize') {
        action = service.finalizeV2(principal, 'space-1', session.id, {
          protocolVersion: '2', confirmationHash: session.confirmationHash, userConfirmed: true,
        });
      } else if (phase === 'get') {
        action = service.getV2(principal, 'space-1', session.id);
      } else {
        action = service.abortV2(principal, 'space-1', session.id);
      }

      await expect(action).rejects.toMatchObject({ syncCode: 'CAPABILITIES_CHANGED' });
      expect(tx.pushSession.update).not.toHaveBeenCalled();
      expect(tx.pushSessionChange.deleteMany).not.toHaveBeenCalled();
      expect(tx.pushSessionBatch.deleteMany).not.toHaveBeenCalled();
    },
  );

  it('persists an explicit protocol version for both v1 and v2 sessions', async () => {
    const created: any[] = [];
    const prisma: any = {
      pushSession: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: any) => {
          created.push(data);
          return { ...data, expiresAt: data.expiresAt, result: null };
        }),
      },
      space: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) },
      folder: { count: jest.fn().mockResolvedValue(0) },
      page: { count: jest.fn().mockResolvedValue(0) },
      spaceKnowledgeRevision: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    prisma.$transaction = jest.fn((callback: any) => callback(prisma));
    const contentTree = {
      lockSyncMutationSpace: jest.fn(async (value: any) => Object.assign(value, { contentTreeRevision: 0n })),
    };
    const service: any = new (PushSessionService as any)(prisma, {}, contentTree, {}, undefined, undefined);
    const v1Hash = await service.capabilityHash();
    const v2Hash = await service.capabilityHashV2();

    await service.create(principal, 'space-1', {
      baseRevision: '0', idempotencyKey: '11111111-1111-4111-8111-111111111111',
      capabilitiesHash: v1Hash, confirmationHash: 'a'.repeat(64),
      confirmationByteLength: 1, changeCount: 0, totalBodyBytes: 0,
    });
    await service.createV2(principal, 'space-1', {
      protocolVersion: '2', baseRevision: '0',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      capabilitiesHash: v2Hash, confirmationHash: 'b'.repeat(64),
      confirmationByteLength: 1, changeCount: 0, totalBodyBytes: 0,
    });

    expect(created.map((row) => row.protocolVersion)).toEqual(['1', '2']);
  });

  it('checks the v1 Folder gate under the Space lock before session creation', async () => {
    const tx: any = {
      space: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) },
      folder: { count: jest.fn().mockResolvedValue(1) },
      page: { count: jest.fn().mockResolvedValue(0) },
      pushSession: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({
        id: 'session-created', protocolVersion: '1', status: 'ready_to_finalize', result: null,
        expiresAt: new Date(Date.now() + 60_000),
      }) },
      spaceKnowledgeRevision: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const contentTree = {
      lockSyncMutationSpace: jest.fn(async (value: any) => Object.assign(value, { contentTreeRevision: 0n })),
    };
    const prisma: any = {
      ...tx,
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const service: any = new (PushSessionService as any)(prisma, {}, contentTree, {}, undefined, undefined);

    await expect(service.create(principal, 'space-1', {
      baseRevision: '0', idempotencyKey: '33333333-3333-4333-8333-333333333333',
      capabilitiesHash: await service.capabilityHash(), confirmationHash: 'a'.repeat(64),
      confirmationByteLength: 1, changeCount: 0, totalBodyBytes: 0,
    })).rejects.toMatchObject({ syncCode: 'SYNC_PROTOCOL_UPGRADE_REQUIRED' });

    expect(contentTree.lockSyncMutationSpace).toHaveBeenCalledWith(tx, 'space-1');
    expect(tx.pushSession.create).not.toHaveBeenCalled();
  });

  it.each(['1', '2'] as const)(
    'rejects legacy protocol %s session creation under the Space lock once the Space is native v3',
    async (protocolVersion) => {
      const tx: any = {
        space: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) },
        folder: { count: jest.fn().mockResolvedValue(0) },
        page: { count: jest.fn().mockResolvedValue(0) },
        pushSession: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
        spaceKnowledgeRevision: { findFirst: jest.fn().mockResolvedValue({ id: 'rev-v3' }) },
      };
      const prisma: any = { ...tx, $transaction: jest.fn((callback: any) => callback(tx)) };
      const contentTree = { lockSyncMutationSpace: jest.fn(async () => tx) };
      const v3Writer = {
        inspectCurrentLocked: jest.fn().mockResolvedValue({ mode: 'native_v3' }),
      };
      const service: any = new (PushSessionService as any)(
        prisma, {}, contentTree, {}, undefined, undefined, undefined, v3Writer,
      );
      const common = {
        baseRevision: 'rev-v3',
        idempotencyKey: `${protocolVersion.repeat(8)}-${protocolVersion.repeat(4)}-4${protocolVersion.repeat(3)}-8${protocolVersion.repeat(3)}-${protocolVersion.repeat(12)}`,
        confirmationHash: 'a'.repeat(64), confirmationByteLength: 1,
        changeCount: 0, totalBodyBytes: 0,
      };
      const action = protocolVersion === '1'
        ? service.create(principal, 'space-1', {
          ...common, capabilitiesHash: await service.capabilityHash(),
        })
        : service.createV2(principal, 'space-1', {
          ...common, protocolVersion: '2', capabilitiesHash: await service.capabilityHashV2(),
        });

      await expect(action).rejects.toMatchObject({
        syncCode: 'SYNC_PROTOCOL_UPGRADE_REQUIRED',
        response: expect.objectContaining({ protocolVersion }),
      });
      expect(contentTree.lockSyncMutationSpace).toHaveBeenCalledWith(tx, 'space-1');
      expect(tx.pushSession.create).not.toHaveBeenCalled();
    },
  );

  it('revalidates every v1 idempotency binding after a create uniqueness race', async () => {
    const raced = {
      id: 'session-raced', protocolVersion: '1', userId: 'user-1', spaceId: 'space-1',
      credentialId: 'credential-1', credentialFamilyId: 'family-1', baseRevisionId: '0',
      idempotencyKey: '77777777-7777-4777-8777-777777777777',
      capabilitiesHash: 'wrong-capabilities', confirmationHash: 'a'.repeat(64),
      confirmationByteLength: 1, changeCount: 0, totalBodyBytes: 0n,
      status: 'ready_to_finalize', result: null, expiresAt: new Date(Date.now() + 60_000),
    };
    const tx: any = {
      pushSession: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
      },
      spaceKnowledgeRevision: { findFirst: jest.fn().mockResolvedValue(null) },
      folder: { count: jest.fn().mockResolvedValue(0) },
      page: { count: jest.fn().mockResolvedValue(0) },
      space: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) },
    };
    const prisma: any = {
      pushSession: { findUnique: jest.fn().mockResolvedValue(raced) },
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const contentTree = {
      lockSyncMutationSpace: jest.fn(async () => Object.assign(tx, { contentTreeRevision: 0n })),
    };
    const service: any = new (PushSessionService as any)(prisma, {}, contentTree, {}, undefined, undefined);

    await expect(service.create(principal, 'space-1', {
      baseRevision: '0', idempotencyKey: raced.idempotencyKey,
      capabilitiesHash: await service.capabilityHash(), confirmationHash: raced.confirmationHash,
      confirmationByteLength: 1, changeCount: 0, totalBodyBytes: 0,
    })).rejects.toMatchObject({ syncCode: 'IDEMPOTENCY_MISMATCH' });
  });

  it('maps a missing v1 create Space to the non-enumerating Sync error envelope', async () => {
    const prisma: any = {
      $transaction: jest.fn((callback: any) => callback({})),
    };
    const contentTree = {
      lockSyncMutationSpace: jest.fn().mockRejectedValue(new ContentTreeError(
        'SPACE_NOT_FOUND',
        'secret-space-id belongs to another Space',
      )),
    };
    const service: any = new (PushSessionService as any)(prisma, {}, contentTree, {}, undefined, undefined);

    const failure = await service.create(principal, 'secret-space-id', {
      baseRevision: '0', idempotencyKey: '88888888-8888-4888-8888-888888888888',
      capabilitiesHash: await service.capabilityHash(), confirmationHash: 'a'.repeat(64),
      confirmationByteLength: 1, changeCount: 0, totalBodyBytes: 0,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ syncCode: 'SPACE_FORBIDDEN' });
    expect(failure.getStatus()).toBe(403);
    expect(JSON.stringify(failure.getResponse())).not.toContain('secret-space-id');
    expect(JSON.stringify(failure.getResponse())).not.toContain('another Space');
  });

  it.each([
    ['v1 get rejects v2', 'get', '2', '1'],
    ['v2 get rejects v1', 'getV2', '1', '2'],
    ['v1 abort rejects v2', 'abort', '2', '1'],
    ['v2 abort rejects v1', 'abortV2', '1', '2'],
  ])('%s', async (_label, method, storedProtocol, responseProtocol) => {
    const session: any = {
      id: '11111111-1111-4111-8111-111111111111', protocolVersion: storedProtocol,
      spaceId: 'space-1', credentialId: 'credential-1', credentialFamilyId: 'family-1',
      status: 'uploading', result: null, batches: [],
      expiresAt: new Date(Date.now() + 60_000),
    };
    const tx: any = {
      $executeRaw: jest.fn(),
      pushSession: { findUnique: jest.fn().mockResolvedValue(session), update: jest.fn() },
      pushSessionChange: { deleteMany: jest.fn() },
      pushSessionBatch: { deleteMany: jest.fn() },
    };
    const prisma: any = {
      pushSession: { findUnique: jest.fn().mockResolvedValue(session) },
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const service: any = new (PushSessionService as any)(prisma, {}, {}, {}, undefined, undefined);
    session.capabilitiesHash = await service.capabilityHashV2();

    await expect(service[method](principal, 'space-1', session.id)).rejects.toMatchObject({
      syncCode: 'PUSH_SESSION_NOT_FOUND',
      response: expect.objectContaining({ protocolVersion: responseProtocol }),
    });
    expect(tx.pushSession.update).not.toHaveBeenCalled();
  });

  it.each([
    ['v1 upload rejects v2', 'upload', '2', '1'],
    ['v2 upload rejects v1', 'uploadV2', '1', '2'],
  ])('%s', async (_label, method, storedProtocol, responseProtocol) => {
    const session: any = {
      id: '11111111-1111-4111-8111-111111111111', protocolVersion: storedProtocol,
      spaceId: 'space-1', credentialId: 'credential-1', status: 'uploading',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const tx: any = {
      $executeRaw: jest.fn(),
      pushSession: { findUnique: jest.fn().mockResolvedValue(session), update: jest.fn() },
      pushSessionBatch: { findUnique: jest.fn() },
      pushSessionChange: { findMany: jest.fn(), createMany: jest.fn() },
    };
    const service: any = new (PushSessionService as any)(
      { $transaction: (callback: any) => callback(tx) }, {}, {}, {}, undefined, undefined,
    );
    session.capabilitiesHash = await service.capabilityHashV2();

    await expect(service[method](principal, 'space-1', session.id, {
      protocolVersion: responseProtocol, batchIndex: 0, batchHash: 'a'.repeat(64), changes: [],
    })).rejects.toMatchObject({
      syncCode: 'PUSH_SESSION_NOT_FOUND',
      response: expect.objectContaining({ protocolVersion: responseProtocol }),
    });
    expect(tx.pushSessionBatch.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['v1 finalize rejects v2', 'finalize', '2', '1'],
    ['v2 finalize rejects v1', 'finalizeV2', '1', '2'],
  ])('%s', async (_label, method, storedProtocol, responseProtocol) => {
    const prisma: any = {
      pushSession: { findUnique: jest.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111', spaceId: 'space-1',
        protocolVersion: storedProtocol,
      }) },
      $transaction: jest.fn(),
    };
    const service: any = new (PushSessionService as any)(prisma, {}, {}, {}, undefined, undefined);
    const input = method === 'finalizeV2'
      ? { protocolVersion: '2', confirmationHash: 'a'.repeat(64), userConfirmed: true }
      : 'a'.repeat(64);

    await expect(service[method](principal, 'space-1', '11111111-1111-4111-8111-111111111111', input))
      .rejects.toMatchObject({
        syncCode: 'PUSH_SESSION_NOT_FOUND',
        response: expect.objectContaining({ protocolVersion: responseProtocol }),
      });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a Space Admin before creating a Folder-aware push session', async () => {
    const prisma: any = {
      pushSession: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      space: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) },
      spaceMember: { findUnique: jest.fn().mockResolvedValue({ role: 'admin' }) },
      spaceKnowledgeRevision: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    const contentTree = {
      lockSyncMutationSpace: jest.fn(async (tx: unknown) => tx),
    };
    const service: any = new (PushSessionService as any)(
      prisma, {}, contentTree, {}, undefined, undefined,
    );
    const admin = { ...principal, platformRole: 'user' as const };

    await expect(service.createV2(admin, 'space-1', {
      protocolVersion: '2', baseRevision: '0',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      capabilitiesHash: await service.capabilityHashV2(),
      confirmationHash: 'a'.repeat(64), confirmationByteLength: 1,
      changeCount: 0, totalBodyBytes: 0,
    })).rejects.toMatchObject({
      syncCode: 'SPACE_READ_ONLY',
      response: expect.objectContaining({ protocolVersion: '2' }),
    });
    expect(prisma.pushSession.create).not.toHaveBeenCalled();
  });

  it('stores a strict v2 mixed batch without conflating Folder and Page identities', async () => {
    const changes = [
      {
        operation: 'upsert_folder' as const,
        folder: {
          folderId: 'same-id', parentFolderId: null, name: 'Folder', path: 'pages/Folder',
          sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z',
        },
      },
      {
        operation: 'upsert_page' as const,
        page: {
          pageId: 'same-id', folderId: 'same-id', title: 'Page', path: 'pages/Folder/Page.md',
          body: '# Page\n', contentHash: await contentHash('# Page\n'),
          updatedAt: '2026-08-29T00:00:01.000Z',
        },
      },
    ];
    const withoutHash = { protocolVersion: '2' as const, batchIndex: 0, changes };
    const batch = { ...withoutHash, batchHash: await treeBatchHashV2(withoutHash) };
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const session = {
      id: '11111111-1111-4111-8111-111111111111', protocolVersion: '2', spaceId: 'space-1',
      credentialId: 'credential-1', status: 'uploading', expiresAt: new Date(Date.now() + 60_000),
      receivedBatchCount: 0, receivedChangeCount: 0, receivedBodyBytes: 0n,
      changeCount: 2, totalBodyBytes: 7n,
    };
    const tx: any = {
      $executeRaw: jest.fn(),
      pushSession: { findUnique: jest.fn().mockResolvedValue(session), update: jest.fn() },
      pushSessionBatch: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'batch-1' }),
      },
      pushSessionChange: { findMany: jest.fn().mockResolvedValue([]), createMany },
    };
    const prisma: any = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const service: any = new (PushSessionService as any)(prisma, {
      batchReceipt: () => 'receipt-1',
    }, {}, {}, undefined, undefined);
    (session as any).capabilitiesHash = await service.capabilityHashV2();

    await expect(service.uploadV2(principal, 'space-1', session.id, batch))
      .resolves.toEqual(expect.objectContaining({ protocolVersion: '2', batchIndex: 0 }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(tx.$executeRaw.mock.calls[0]))
      .toContain('agentwiki:sync-page-content-store:v1');
    expect(JSON.stringify(tx.$executeRaw.mock.calls[1]))
      .not.toContain('agentwiki:sync-page-content-store:v1');
    const rows = createMany.mock.calls[0][0].data;
    expect(rows.map((row: any) => row.pageId)).toEqual(['folder:same-id', 'page:same-id']);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'upsert_folder', title: 'Folder', path: 'pages/Folder' }),
      expect.objectContaining({ operation: 'upsert_page', body: '# Page\n', path: 'pages/Folder/Page.md' }),
    ]));
  });

  it('verifies the v2 confirmation and delegates the whole mixed batch to one ContentTree boundary', async () => {
    const changes = [{
      operation: 'upsert_folder' as const,
      folder: {
        folderId: 'folder-1', parentFolderId: null, name: 'Folder', path: 'pages/Folder',
        sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z',
      },
    }];
    const manifest = { protocolVersion: '2' as const, spaceId: 'space-1', baseRevision: 'rev-1', changes };
    const confirmation = await treeConfirmationHashV2(manifest);
    const published = {
      protocolVersion: '2', status: 'published', revision: 'rev-2', sequence: 2,
      publishedAt: '2026-08-29T00:00:02.000Z', revisionContentHash: 'c'.repeat(64),
      folderCount: '1', pageCount: '0', revisionManifestByteLength: '200',
      revisionBodyBytes: '0', changeSetId: 'change-set-1',
    };
    const session = {
      id: '11111111-1111-4111-8111-111111111111', protocolVersion: '2', spaceId: 'space-1',
      credentialId: 'credential-1', status: 'ready_to_finalize', result: null,
      baseRevisionId: 'rev-1', confirmationHash: confirmation,
      confirmationByteLength: canonicalBytes(manifest).byteLength,
      receivedBatchCount: 1, receivedChangeCount: 1, changeCount: 1,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const tx: any = {
      $executeRaw: jest.fn(),
      space: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null, contentTreeRevision: 7n }) },
      pushSession: { findUnique: jest.fn().mockResolvedValue(session), update: jest.fn() },
      pushSessionBatch: { findMany: jest.fn().mockResolvedValue([{ batchIndex: 0 }]) },
      pushSessionChange: { findMany: jest.fn().mockResolvedValue([{
        operation: 'upsert_folder', pageId: 'folder:folder-1', path: 'pages/Folder',
        title: 'Folder', body: JSON.stringify({ parentFolderId: null, sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z' }),
      }]) },
      spaceKnowledgeRevision: { findFirst: jest.fn().mockResolvedValue({ id: 'rev-1', sequence: 1 }) },
    };
    const contentTree = {
      lockSyncMutationSpace: jest.fn(async (value: any) => Object.assign(value, { contentTreeRevision: 7n })),
      publishSyncV2BatchLocked: jest.fn().mockResolvedValue(published),
      publishSyncV2Batch: jest.fn(),
    };
    const prisma: any = {
      pushSession: { findUnique: jest.fn().mockResolvedValue({
        id: session.id, spaceId: 'space-1', protocolVersion: '2',
      }) },
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const service: any = new (PushSessionService as any)(prisma, {}, contentTree, {}, undefined, undefined);
    (session as any).capabilitiesHash = await service.capabilityHashV2();

    await expect(service.finalizeV2(principal, 'space-1', session.id, {
      protocolVersion: '2', confirmationHash: confirmation, userConfirmed: true,
    })).resolves.toEqual(published);

    expect(prisma.pushSession.findUnique).toHaveBeenCalledWith({
      where: { id: session.id }, select: { spaceId: true, protocolVersion: true },
    });
    expect(contentTree.lockSyncMutationSpace).toHaveBeenCalledWith(tx, 'space-1');
    expect(contentTree.lockSyncMutationSpace.mock.invocationCallOrder[0])
      .toBeLessThan(tx.$executeRaw.mock.invocationCallOrder[0]);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(tx.$executeRaw.mock.calls[0]))
      .toContain('agentwiki:sync-page-content-store:v1');
    expect(JSON.stringify(tx.$executeRaw.mock.calls[1]))
      .not.toContain('agentwiki:sync-page-content-store:v1');
    expect(contentTree.publishSyncV2BatchLocked).toHaveBeenCalledTimes(1);
    expect(contentTree.publishSyncV2BatchLocked).toHaveBeenCalledWith(tx, expect.objectContaining({
      spaceId: 'space-1', baseRevision: 'rev-1', changes,
      actor: { userId: 'user-1' },
    }));
    expect(contentTree.publishSyncV2Batch).not.toHaveBeenCalled();
    expect(tx.pushSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: session.id }, data: expect.objectContaining({ status: 'published', result: published }),
    }));
  });

  it.each<[ContentTreeErrorCode | 'UNKNOWN', string, number, string]>([
    ['SPACE_NOT_FOUND', 'SPACE_FORBIDDEN', 403, 'Space is not accessible'],
    ['FOLDER_NOT_FOUND', 'PAYLOAD_INVALID', 400, 'Document tree resource is unavailable'],
    ['FOLDER_NAME_CONFLICT', 'PATH_COLLISION', 409, 'Document tree path conflicts'],
    ['FOLDER_INVALID_NAME', 'PAYLOAD_INVALID', 400, 'Document tree payload is invalid'],
    ['FOLDER_CYCLE', 'PAYLOAD_INVALID', 400, 'Document tree payload is invalid'],
    ['FOLDER_DEPTH_LIMIT', 'PAYLOAD_INVALID', 400, 'Document tree payload is invalid'],
    ['FOLDER_COUNT_LIMIT', 'SPACE_TOO_LARGE', 409, 'Document tree limit is exceeded'],
    ['FOLDER_MUTATION_LIMIT', 'BATCH_TOO_LARGE', 413, 'Document tree mutation limit is exceeded'],
    ['FOLDER_PATH_TOO_LONG', 'PAYLOAD_INVALID', 400, 'Document tree payload is invalid'],
    ['FOLDER_DELETE_IMPACT_CHANGED', 'BASE_STALE', 409, 'Document tree base is stale'],
    ['FOLDER_RESTORE_CONFLICT', 'PAGE_ID_CONFLICT', 409, 'Document tree resource is unavailable'],
    ['MARKDOWN_REFERENCE_AMBIGUOUS', 'PAYLOAD_INVALID', 400, 'Document tree payload is invalid'],
    ['CONTENT_TREE_CONFLICT', 'BASE_STALE', 409, 'Document tree base is stale'],
    ['CONTENT_TREE_REVISION_GONE' as ContentTreeErrorCode, 'REVISION_GONE', 410, 'Revision is not available'],
    ['CONTENT_TREE_CURSOR_INVALID', 'PAYLOAD_INVALID', 400, 'Document tree payload is invalid'],
    ['CONTENT_TREE_PAGE_NOT_FOUND', 'PAGE_ID_CONFLICT', 409, 'Document tree resource is unavailable'],
    ['CONTENT_TREE_INVALID_ACTOR', 'INTERNAL_ERROR', 500, 'Sync finalize failed'],
    ['CONTENT_TREE_SPACE_FORBIDDEN', 'SPACE_FORBIDDEN', 403, 'Space is not accessible'],
    ['CONTENT_TREE_SPACE_READ_ONLY', 'SPACE_READ_ONLY', 403, 'Space role does not permit publishing'],
    ['CONTENT_TREE_PAYLOAD_INVALID', 'PAYLOAD_INVALID', 400, 'Document tree payload is invalid'],
    ['CONTENT_TREE_PATH_COLLISION', 'PATH_COLLISION', 409, 'Document tree path conflicts'],
    ['CONTENT_TREE_ID_CONFLICT', 'PAGE_ID_CONFLICT', 409, 'Document tree resource is unavailable'],
    ['CONTENT_TREE_TAKE_INVALID', 'PAYLOAD_INVALID', 400, 'Document tree payload is invalid'],
    ['PAGE_PARENT_DEPRECATED', 'PAYLOAD_INVALID', 400, 'Document tree payload is invalid'],
    ['UNKNOWN', 'INTERNAL_ERROR', 500, 'Sync finalize failed'],
  ])('maps ContentTree %s to stable v2 %s/%i without leaking identifiers', async (
    contentTreeCode, syncCode, status, message,
  ) => {
    const changes = [{
      operation: 'upsert_folder' as const,
      folder: {
        folderId: 'folder-1', parentFolderId: null, name: 'Folder', path: 'pages/Folder',
        sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z',
      },
    }];
    const manifest = { protocolVersion: '2' as const, spaceId: 'space-1', baseRevision: 'rev-1', changes };
    const hash = await treeConfirmationHashV2(manifest);
    const session: any = {
      id: '11111111-1111-4111-8111-111111111111', protocolVersion: '2',
      spaceId: 'space-1', credentialId: 'credential-1', status: 'ready_to_finalize',
      result: null, baseRevisionId: 'rev-1', confirmationHash: hash,
      confirmationByteLength: canonicalBytes(manifest).byteLength,
      receivedBatchCount: 1, receivedChangeCount: 1, changeCount: 1,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const tx: any = {
      $executeRaw: jest.fn(),
      space: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) },
      pushSession: { findUnique: jest.fn().mockResolvedValue(session) },
      pushSessionBatch: { findMany: jest.fn().mockResolvedValue([{ batchIndex: 0 }]) },
      pushSessionChange: { findMany: jest.fn().mockResolvedValue([{
        operation: 'upsert_folder', pageId: 'folder:folder-1', path: 'pages/Folder', title: 'Folder',
        body: JSON.stringify({ parentFolderId: null, sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z' }),
      }]) },
    };
    const treeError = new ContentTreeError(
      contentTreeCode === 'UNKNOWN' ? 'CONTENT_TREE_INVALID_ACTOR' : contentTreeCode,
      'secret-id belongs to another Space',
    );
    if (contentTreeCode === 'UNKNOWN') Object.defineProperty(treeError, 'code', { value: 'UNKNOWN' });
    const contentTree = {
      lockSyncMutationSpace: jest.fn(async (value: any) => Object.assign(value, { contentTreeRevision: 0n })),
      publishSyncV2BatchLocked: jest.fn().mockRejectedValue(treeError),
    };
    const prisma: any = {
      pushSession: { findUnique: jest.fn().mockResolvedValue({
        id: session.id, spaceId: 'space-1', protocolVersion: '2',
      }) },
      $transaction: (callback: any) => callback(tx),
    };
    const service: any = new (PushSessionService as any)(prisma, {}, contentTree, {}, undefined, undefined);
    session.capabilitiesHash = await service.capabilityHashV2();

    const failure = await service.finalizeV2(principal, 'space-1', session.id, {
      protocolVersion: '2', confirmationHash: hash, userConfirmed: true,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      syncCode,
      response: { protocolVersion: '2', error: expect.objectContaining({ code: syncCode, message }) },
    });
    expect(failure.getStatus()).toBe(status);
    expect(JSON.stringify(failure.getResponse())).not.toContain('secret-id');
    expect(JSON.stringify(failure.getResponse())).not.toContain('another Space');
  });

  it.each([
    ['SPACE_NOT_FOUND', 'SPACE_FORBIDDEN', 403],
    ['FOLDER_NOT_FOUND', 'PAYLOAD_INVALID', 400],
    ['CONTENT_TREE_CONFLICT', 'PATH_COLLISION', 409],
    ['CONTENT_TREE_INVALID_ACTOR', 'INTERNAL_ERROR', 500],
  ] as const)('maps v1 ContentTree %s to a stable non-enumerating error', (
    contentTreeCode, syncCode, status,
  ) => {
    const service: any = new (PushSessionService as any)({}, {}, {}, {}, undefined, undefined);
    const failure = service.mapContentTreeErrorV1(new ContentTreeError(
      contentTreeCode,
      'secret-id belongs to another Space',
    ));
    expect(failure).toMatchObject({
      syncCode,
      response: { protocolVersion: '1', error: expect.objectContaining({ code: syncCode }) },
    });
    expect(failure.getStatus()).toBe(status);
    expect(JSON.stringify(failure.getResponse())).not.toContain('secret-id');
    expect(JSON.stringify(failure.getResponse())).not.toContain('another Space');
  });

  it('returns an already published v2 result idempotently without replaying ContentTree', async () => {
    const result = { protocolVersion: '2', status: 'published', revision: 'rev-2' };
    const tx: any = {
      $executeRaw: jest.fn(),
      space: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null, contentTreeRevision: 8n }) },
      pushSession: { findUnique: jest.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111', protocolVersion: '2', spaceId: 'space-1',
        credentialId: 'credential-1', status: 'published', result,
      }) },
    };
    const contentTree = {
      lockSyncMutationSpace: jest.fn(async (value: any) => Object.assign(value, { contentTreeRevision: 8n })),
      publishSyncV2Batch: jest.fn(), publishSyncV2BatchLocked: jest.fn(),
    };
    const service: any = new (PushSessionService as any)(
      {
        pushSession: { findUnique: jest.fn().mockResolvedValue({
          id: '11111111-1111-4111-8111-111111111111', spaceId: 'space-1', protocolVersion: '2',
        }) },
        $transaction: (callback: any) => callback(tx),
      }, {}, contentTree, {}, undefined, undefined,
    );
    const publishedSession = await tx.pushSession.findUnique();
    publishedSession.capabilitiesHash = await service.capabilityHashV2();

    await expect(service.finalizeV2(principal, 'space-1', publishedSession.id, {
      protocolVersion: '2', confirmationHash: 'a'.repeat(64), userConfirmed: true,
    })).resolves.toEqual(result);
    expect(contentTree.publishSyncV2BatchLocked).not.toHaveBeenCalled();
  });

  it('rolls back a mixed invalid batch without publishing the v2 session', async () => {
    const update = jest.fn();
    const tx: any = {
      $executeRaw: jest.fn(),
      space: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null, contentTreeRevision: 7n }) },
      pushSession: { findUnique: jest.fn().mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111', protocolVersion: '2', spaceId: 'space-1',
        credentialId: 'credential-1', status: 'ready_to_finalize', result: null,
        baseRevisionId: 'rev-1', confirmationHash: 'a'.repeat(64), confirmationByteLength: 1,
        receivedBatchCount: 1, receivedChangeCount: 1, changeCount: 1,
        expiresAt: new Date(Date.now() + 60_000),
      }), update },
      pushSessionBatch: { findMany: jest.fn().mockResolvedValue([{ batchIndex: 0 }]) },
      pushSessionChange: { findMany: jest.fn().mockResolvedValue([]) },
      spaceKnowledgeRevision: { findFirst: jest.fn().mockResolvedValue({ id: 'rev-1' }) },
    };
    const contentTree = {
      lockSyncMutationSpace: jest.fn(async (value: any) => Object.assign(value, { contentTreeRevision: 7n })),
      publishSyncV2BatchLocked: jest.fn(),
    };
    const service: any = new (PushSessionService as any)(
      {
        pushSession: { findUnique: jest.fn().mockResolvedValue({
          id: '11111111-1111-4111-8111-111111111111', spaceId: 'space-1', protocolVersion: '2',
        }) },
        $transaction: (callback: any) => callback(tx),
      }, {}, contentTree, {}, undefined, undefined,
    );
    const invalidSession = await tx.pushSession.findUnique();
    invalidSession.capabilitiesHash = await service.capabilityHashV2();

    await expect(service.finalizeV2(principal, 'space-1', invalidSession.id, {
      protocolVersion: '2', confirmationHash: 'a'.repeat(64), userConfirmed: true,
    })).rejects.toMatchObject({ syncCode: 'PUSH_SESSION_INCOMPLETE' });
    expect(update).not.toHaveBeenCalled();
  });
});
