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
});
