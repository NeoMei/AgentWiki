import { PushSessionService } from './push-session.service';

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
    };
    const tx = {
      page: {
        findUnique: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...current, ...data })),
        create: jest.fn(),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const Service = PushSessionService as any;
    const service = new Service({}, {}, {}, {}, undefined, undefined);

    await (service as any).applyPageChanges(tx, 'space-1', 'user-1', [change]);

    expect(tx.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ folderId: 'folder-1' }),
    }));
  });
});
