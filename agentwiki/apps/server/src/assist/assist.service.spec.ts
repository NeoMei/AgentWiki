import { AssistService } from './assist.service';

describe('AssistService', () => {
  const prisma = {
    assistTask: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  } as any;
  const service = new AssistService(prisma);

  beforeEach(() => jest.clearAllMocks());

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
