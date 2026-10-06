import { AssistService } from './assist.service';
import { AuthorizationService } from '../core/authorization/authorization.service';

describe('AssistService', () => {
  const prisma = {
    assistTask: { create: jest.fn(), count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    page: { findFirst: jest.fn() },
    $queryRaw: jest.fn(), user: { findUnique: jest.fn() },
    space: { findUnique: jest.fn() }, spaceMember: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const config = { get: jest.fn() } as any;
  const service = new AssistService(prisma, config, new AuthorizationService(prisma));

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    prisma.page.findFirst.mockResolvedValue({ id: 'page-1', updatedAt: new Date('2026-01-01T00:00:00.000Z') });
    prisma.$queryRaw.mockResolvedValue([{ id: 'user-1' }]);
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', type: 'human', platformRole: 'user', lockedAt: null, deletedAt: null });
    prisma.space.findUnique.mockResolvedValue({ id: 'space-1', deletedAt: null });
    prisma.spaceMember.findUnique.mockResolvedValue({ role: 'editor' });
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
    const result = await service.listForPage('page-1', 'user-1', 'space-1');
    expect(prisma.assistTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { pageId: 'page-1', requestedByUserId: 'user-1', spaceId: 'space-1', sessionId: null },
      orderBy: { createdAt: 'desc' },
    }));
    expect(result).toHaveLength(1);
  });
  const version = '2026-01-01T00:00:00.000Z';
  const source = '前😀old尾'; // UTF-16: target starts at 3, ends at 6.
  const target = { kind: 'selection', from: 3, to: 6, quote: 'old', prefix: '前😀', suffix: '尾', baseUpdatedAt: version };
  const scopedInput = (patch: Record<string, unknown> = {}) => ({
    spaceId: 'space-1', pageId: 'page-1', userId: 'user-1', intent: 'edit',
    snapshot: { content: source, updatedAt: version, assistTarget: { ...target, ...patch } },
  });

  it.each([
    { kind: 'other' }, { from: NaN }, { from: 3.5 }, { from: -1 }, { to: 99 },
    { from: 6, to: 3 }, { from: 3, to: 3, quote: '' }, { quote: 'wrong' },
    { prefix: 'wrong' }, { suffix: 'wrong' }, { prefix: 'x'.repeat(257) },
    { baseUpdatedAt: '2025-01-01' }, { kind: 'document' },
  ])('rejects malformed or mismatched scoped target %j', async (patch) => {
    await expect(service.createTask(scopedInput(patch))).rejects.toThrow();
    expect(prisma.assistTask.create).not.toHaveBeenCalled();
  });

  it('accepts a selected unsaved draft with exact UTF-16 quote and page version', async () => {
    prisma.assistTask.create.mockResolvedValue({ id: 'targeted' });
    await expect(service.createTask(scopedInput())).resolves.toEqual({ id: 'targeted' });
    expect(prisma.assistTask.create.mock.calls[0][0].data.pageSnapshot.content).toBe('前😀old尾');
  });

  it('rejects a scoped task based on an older saved page version', async () => {
    prisma.page.findFirst.mockResolvedValue({ id: 'page-1', updatedAt: new Date('2026-01-02') });
    await expect(service.createTask(scopedInput())).rejects.toThrow();
    expect(prisma.assistTask.create).not.toHaveBeenCalled();
  });

  it('requires page and requester for a scoped target', async () => {
    await expect(service.createTask({ ...scopedInput(), pageId: undefined })).rejects.toThrow();
    await expect(service.createTask({ ...scopedInput(), userId: undefined })).rejects.toThrow();
    expect(prisma.assistTask.create).not.toHaveBeenCalled();
  });

  it.each(['viewer', null])('rejects current revoked or insufficient membership %s', async (role) => {
    prisma.spaceMember.findUnique.mockResolvedValue(role ? { role } : null);
    await expect(service.createTask(scopedInput())).rejects.toThrow();
    expect(prisma.assistTask.create).not.toHaveBeenCalled();
  });

  it.each(['lockedAt', 'deletedAt'])('rejects a requester with %s set', async (field) => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', type: 'human', [field]: new Date() });
    await expect(service.createTask(scopedInput())).rejects.toThrow();
    expect(prisma.assistTask.create).not.toHaveBeenCalled();
  });

  it('accepts an empty full-document target', async () => {
    prisma.assistTask.create.mockResolvedValue({ id: 'empty' });
    await expect(service.createTask({ ...scopedInput(), snapshot: {
      content: '', updatedAt: version, assistTarget: { kind: 'document', from: 0, to: 0, quote: '', prefix: '', suffix: '', baseUpdatedAt: version },
    } })).resolves.toEqual({ id: 'empty' });
  });

  it('does not load another requester task snapshot', async () => {
    prisma.assistTask.findFirst.mockResolvedValue(null);
    await expect(service.get('private-task', 'user-2')).resolves.toBeNull();
    expect(prisma.assistTask.findFirst).toHaveBeenCalledWith({ where: { id: 'private-task', requestedByUserId: 'user-2', sessionId: null } });
    expect(prisma.assistTask.findUnique).not.toHaveBeenCalled();
  });

  it('whitelists legacy result fields and excludes raw or future provider details', async () => {
    prisma.assistTask.findFirst.mockResolvedValue({ id: 't1', result: { summary: 'answer', changes: '# source', raw: 'provider-private', futureInternal: 'secret', attemptCount: 1,
      attempts: [{ model: 'hidden', durationMs: 42, status: 'failed', errorCode: 'timeout', raw: 'secret', cost: 8 }] } });
    const task = await service.get('t1', 'user-1');
    expect(task?.result).toEqual({ summary: 'answer', changes: '# source', attemptCount: 1,
      attempts: [{ durationMs: 42, status: 'failed', errorCode: 'timeout' }] });
  });

  it('rejects null target instead of treating it as whole-document legacy work', async () => {
    await expect(service.createTask({ ...scopedInput(), snapshot: { content: source, updatedAt: version, assistTarget: null } })).rejects.toThrow();
  });

  it('fails closed if a service read is missing the caller scope', async () => {
    await expect(service.get('private-task', undefined as any)).rejects.toThrow('requester');
    await expect(service.listForPage('page-1', undefined as any, 'space-1')).rejects.toThrow('requester');
    await expect(service.listForPage('page-1', 'user-1', undefined as any)).rejects.toThrow('Space');
    expect(prisma.assistTask.findFirst).not.toHaveBeenCalled();
    expect(prisma.assistTask.findMany).not.toHaveBeenCalled();
  });

});
