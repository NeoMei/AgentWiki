import { AssistQueue } from './assist.queue';

describe('AssistQueue task processing', () => {
  const prisma = {
    assistTask: { findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  } as any;
  const config = { get: jest.fn((key: string, def?: any) => ({
    PROCESS_ROLE: 'worker', ASSIST_CONCURRENCY: 2, ASSIST_LEASE_MS: 60000, ASSIST_QUEUE_POLL_MS: 1000,
  } as any)[key] ?? def) } as any;
  const runner = { run: jest.fn() } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.assistTask.updateMany.mockResolvedValue({ count: 1 });
  });

  it('claims a queued task, runs opencode, and marks it done with the result', async () => {
    prisma.assistTask.findFirst.mockResolvedValue({ id: 't1', intent: 'polish', pageSnapshot: { content: '# Hi' } });
    runner.run.mockResolvedValue({ summary: 'polished version', changes: '# Hi — polished' });
    const queue = new AssistQueue(prisma, config, runner);
    await (queue as any).processOne({ id: 't1', intent: 'polish', pageSnapshot: { content: '# Hi' } });
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ intent: 'polish' }));
    expect(prisma.assistTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1', status: 'running', leaseOwner: (queue as any).workerId },
      data: expect.objectContaining({ status: 'done' }),
    }));
  });

  it('marks the task failed when opencode errors', async () => {
    runner.run.mockRejectedValue(new Error('llm down'));
    const queue = new AssistQueue(prisma, config, runner);
    await (queue as any).processOne({ id: 't1', intent: 'x', pageSnapshot: null });
    expect(prisma.assistTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1', status: 'running', leaseOwner: (queue as any).workerId },
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });

  it('does not complete a task after its lease has been taken over', async () => {
    prisma.assistTask.updateMany.mockResolvedValue({ count: 0 });
    runner.run.mockResolvedValue({ summary: 'stale result' });
    const queue = new AssistQueue(prisma, config, runner);

    await (queue as any).processOne({ id: 't1', intent: 'x', pageSnapshot: null });

    expect(prisma.assistTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1', status: 'running', leaseOwner: (queue as any).workerId },
    }));
    expect(prisma.assistTask.update).not.toHaveBeenCalled();
  });

  it('absorbs and logs tick failures', async () => {
    const queue = new AssistQueue(prisma, config, runner);
    jest.spyOn(queue as any, 'tick').mockRejectedValue(new Error('database unavailable'));
    const log = jest.spyOn((queue as any).logger, 'error').mockImplementation();

    await expect((queue as any).safeTick()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('Assist queue tick failed', expect.any(String));
  });

  it('re-queues running tasks whose lease expired', async () => {
    const queue = new AssistQueue(prisma, config, runner);
    await (queue as any).recoverExpiredLeases();
    expect(prisma.assistTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'running', leaseExpiresAt: { lte: expect.any(Date) } },
      data: expect.objectContaining({ status: 'queued', leaseOwner: null }),
    }));
  });
});
