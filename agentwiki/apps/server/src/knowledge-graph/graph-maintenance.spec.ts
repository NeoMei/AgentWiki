import { GraphMaintenance } from './graph-maintenance';

describe('GraphMaintenance', () => {
  const build = (role = 'worker') => {
    const refresh = { refresh: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      space: { findMany: jest.fn().mockResolvedValue([]) },
      spaceGraphState: { findMany: jest.fn().mockResolvedValue([]) },
      page: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const config = { get: jest.fn((key: string) => (key === 'PROCESS_ROLE' ? role : undefined)) };
    const maintenance = new GraphMaintenance(prisma as any, config as any, refresh as any);
    return { maintenance, refresh, prisma };
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs debounced incremental refreshes on api processes', () => {
    jest.useFakeTimers();
    const { maintenance, refresh } = build('api');
    maintenance.onModuleInit();
    maintenance.enqueue('space-1');
    jest.advanceTimersByTime(30_000);
    expect(refresh.refresh).toHaveBeenCalledWith('space-1');
  });

  it('collapses repeated enqueue calls into one debounced refresh', () => {
    jest.useFakeTimers();
    const { maintenance, refresh } = build('worker');
    maintenance.onModuleInit();
    maintenance.enqueue('space-1');
    maintenance.enqueue('space-1');
    maintenance.enqueue('space-1');
    expect(refresh.refresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(30_000);
    expect(refresh.refresh).toHaveBeenCalledTimes(1);
    expect(refresh.refresh).toHaveBeenCalledWith('space-1');
  });

  it('skips spaces whose content hash is unchanged during sweep', async () => {
    const { maintenance, refresh, prisma } = build('api');
    const { createHash } = require('crypto');
    const hash = createHash('sha256').update('').digest('hex');
    prisma.space.findMany.mockResolvedValue([{
      id: 'space-1',
      graphState: { wikilinkEnabled: true, similarEnabled: false, llmEnabled: false, lastContentHash: hash },
    }]);
    await maintenance.sweep();
    expect(refresh.refresh).not.toHaveBeenCalled();
  });

  it('refreshes default-enabled spaces that do not have a graph state row yet', async () => {
    const { maintenance, refresh, prisma } = build('worker');
    prisma.space.findMany.mockResolvedValue([{ id: 'space-1', graphState: null }]);
    prisma.page.findMany.mockResolvedValue([{ id: 'p1', content: 'hello' }]);

    await maintenance.sweep();

    expect(refresh.refresh).toHaveBeenCalledWith('space-1');
  });

  it('uses a deterministic sweep hash regardless of page row order', async () => {
    const { maintenance, refresh, prisma } = build('worker');
    const pages = [
      { id: 'p2', updatedAt: new Date('2026-08-18T00:02:00.000Z') },
      { id: 'p1', updatedAt: new Date('2026-08-18T00:01:00.000Z') },
    ];
    const { createHash } = require('crypto');
    const expected = createHash('sha256')
      .update('p1').update('\0').update('2026-08-18T00:01:00.000Z').update('\0')
      .update('p2').update('\0').update('2026-08-18T00:02:00.000Z').update('\0')
      .digest('hex');
    prisma.space.findMany.mockResolvedValue([{
      id: 'space-1',
      graphState: { wikilinkEnabled: true, similarEnabled: false, llmEnabled: false, lastContentHash: expected },
    }]);
    prisma.page.findMany.mockResolvedValue(pages);

    await maintenance.sweep();

    expect(refresh.refresh).not.toHaveBeenCalled();
  });

  it('loads only the lightweight page version needed by the sweep hash', async () => {
    const { maintenance, prisma } = build('worker');
    prisma.space.findMany.mockResolvedValue([{
      id: 'space-1',
      graphState: { wikilinkEnabled: true, similarEnabled: true, llmEnabled: false, lastContentHash: 'stale' },
    }]);

    await maintenance.sweep();

    expect(prisma.page.findMany).toHaveBeenCalledWith({
      where: { spaceId: 'space-1', deletedAt: null },
      select: { id: true, updatedAt: true },
    });
  });

  it('contains periodic sweep failures instead of leaking an unhandled rejection', async () => {
    jest.useFakeTimers();
    const { maintenance, prisma } = build('worker');
    prisma.space.findMany.mockRejectedValue(new Error('database offline'));
    const error = jest.spyOn((maintenance as any).logger, 'error').mockImplementation();
    maintenance.onModuleInit();

    await jest.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);

    expect(error).toHaveBeenCalledWith('graph sweep failed: database offline');
    maintenance.onModuleDestroy();
  });
});
