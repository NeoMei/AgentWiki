import { AssistService } from './assist.service';

describe('AssistService', () => {
  const prisma = {
    assistTask: { create: jest.fn(), count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    page: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const config = { get: jest.fn() } as any;
  const service = new AssistService(prisma, config);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    prisma.page.findFirst.mockResolvedValue({ id: 'page-1' });
    prisma.assistTask.count.mockResolvedValue(0);
    config.get.mockReturnValue(undefined);
  });

  it('creates a queued assist task with a page snapshot', async () => {
    prisma.assistTask.create.mockResolvedValue({ id: 't1', status: 'queued' });
    const result = await service.createTask({
      spaceId: 'space-1', pageId: 'page-1', intent: 'polish intro',
      snapshot: { title: 'T', content: '# Hi', updatedAt: '2026-01-01' }, userId: 'user-1',
    });
    expect(prisma.assistTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        spaceId: 'space-1', pageId: 'page-1', intent: 'polish intro',
        status: 'queued', requestedByUserId: 'user-1',
      }),
    }));
    expect(result.id).toBe('t1');
  });

  it('rejects a task whose page belongs to another Space', async () => {
    prisma.page.findFirst.mockResolvedValue(null);
    await expect(service.createTask({
      spaceId: 'space-1', pageId: 'page-foreign', intent: 'edit', userId: 'user-1',
    })).rejects.toThrow('Assist page must belong to the selected Space');
    expect(prisma.assistTask.create).not.toHaveBeenCalled();
  });

  it('caps outstanding assist work per user and Space', async () => {
    prisma.assistTask.count.mockResolvedValue(10);
    await expect(service.createTask({
      spaceId: 'space-1', intent: 'edit', userId: 'user-1',
    })).rejects.toMatchObject({ status: 429 });
    expect(prisma.assistTask.create).not.toHaveBeenCalled();
  });

  it('rejects an oversized page snapshot before persisting anything', async () => {
    await expect(service.createTask({
      spaceId: 'space-1', pageId: 'page-1', intent: 'edit',
      snapshot: { content: 'x'.repeat(60_000) }, userId: 'user-1',
    })).rejects.toThrow('Page snapshot is too large');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lists tasks for a page newest first', async () => {
    prisma.assistTask.findMany.mockResolvedValue([{ id: 't1' }]);
    const result = await service.listForPage('page-1');
    expect(prisma.assistTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { pageId: 'page-1' },
      orderBy: { createdAt: 'desc' },
    }));
    expect(result).toHaveLength(1);
  });
});
