import { PushSessionService } from './push-session.service';
import { canonicalBytes, confirmationHash, contentHash } from '@neomei/agentwiki-sync-protocol';

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
    const session = {
      id: 'session-1', spaceId: 'space-1', credentialId: 'credential-1',
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
      changeSet: { create: jest.fn().mockResolvedValue({ id: 'change-set-1' }) },
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
      lockPageMutationSpace: jest.fn().mockImplementation(async (value: any) =>
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

    expect(contentTree.lockPageMutationSpace).toHaveBeenCalledWith(tx, 'space-1');
    expect(contentTree.advancePageMutation).toHaveBeenCalledTimes(1);
    expect(contentTree.advancePageMutation).toHaveBeenCalledWith(tx, expect.objectContaining({
      spaceId: 'space-1', expectedTreeRevision: 7n, structural: true,
      revisionOrigin: expect.objectContaining({ origin: 'obsidian_sync' }),
    }));
    expect(writer.lockSpace).not.toHaveBeenCalled();
    expect(writer.advance).not.toHaveBeenCalled();
  });
});
