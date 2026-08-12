import { AssistQueue } from './assist.queue';
import { EMPTY_USAGE, OpencodeRoutingError } from './opencode.types';

describe('AssistQueue task processing', () => {
  const prisma = {
    assistTask: { count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  } as any;
  const config = { get: jest.fn((key: string, def?: any) => ({
    PROCESS_ROLE: 'worker', ASSIST_CONCURRENCY: 2, ASSIST_LEASE_MS: 60000, ASSIST_QUEUE_POLL_MS: 1000,
  } as any)[key] ?? def) } as any;
  const runner = { run: jest.fn() } as any;
  const gateway = {
    emitAssistStream: jest.fn(),
    emitAssistComplete: jest.fn(),
    emitAssistError: jest.fn(),
  } as any;
  const createQueue = () => new AssistQueue(prisma, config, runner, gateway);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.assistTask.findFirst.mockReset();
    prisma.assistTask.findMany.mockReset();
    prisma.assistTask.updateMany.mockReset();
    prisma.assistTask.findMany.mockResolvedValue([]);
    runner.run.mockReset();
    prisma.assistTask.count.mockResolvedValue(1);
    prisma.assistTask.updateMany.mockResolvedValue({ count: 1 });
  });

  it('claims a queued task, runs opencode, and marks it done with the result', async () => {
    runner.run.mockResolvedValue({ summary: 'polished version', changes: '# Hi — polished' });
    const queue = createQueue();
    await (queue as any).processOne({ id: 't1', intent: 'polish', pageSnapshot: { content: '# Hi' } });
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ intent: 'polish' }));
    expect(prisma.assistTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1', status: 'running', leaseOwner: (queue as any).workerId },
      data: expect.objectContaining({ status: 'done' }),
    }));
  });

  it('marks the task failed when opencode errors', async () => {
    runner.run.mockRejectedValue(new Error('llm down'));
    const queue = createQueue();
    await (queue as any).processOne({ id: 't1', intent: 'x', pageSnapshot: null });
    expect(prisma.assistTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1', status: 'running', leaseOwner: (queue as any).workerId },
      data: expect.objectContaining({ status: 'failed', error: 'Editing assistant failed' }),
    }));
  });

  it('passes the exact claimed lease deadline to the runner', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    prisma.assistTask.findFirst
      .mockResolvedValueOnce({ id: 't1', intent: 'polish', pageSnapshot: { content: '# Hi' } })
      .mockResolvedValueOnce(null);
    runner.run.mockResolvedValue({ summary: 'done' });
    const queue = createQueue();

    await (queue as any).tick();

    const claim = prisma.assistTask.updateMany.mock.calls.find((call: any[]) => call[0].data.status === 'running')[0];
    expect(claim.data.leaseExpiresAt).toEqual(new Date(1_060_000));
    expect(prisma.assistTask.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ space: { deletedAt: null } }),
    }));
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ leaseExpiresAtMs: 1_060_000 }));
    now.mockRestore();
  });

  it('lets routing recheck the task lease and active space before every model attempt', async () => {
    runner.run.mockImplementation(async (input: any) => {
      await expect(input.isActive()).resolves.toBe(true);
      return { summary: 'done' };
    });
    const queue = createQueue();

    await (queue as any).processOne({ id: 't1', intent: 'x', pageSnapshot: null });

    expect(prisma.assistTask.count).toHaveBeenCalledWith({
      where: {
        id: 't1',
        status: 'running',
        leaseOwner: (queue as any).workerId,
        space: { deletedAt: null },
      },
    });
  });

  it('persists sanitized routing metadata when every candidate fails', async () => {
    const secret = 'OPENAI_API_KEY=sk-fake provider stderr fixture';
    const result = {
      summary: 'Editing assistant failed',
      model: 'paid/cheap',
      modelTier: 'paid' as const,
      attemptCount: 2,
      usage: { ...EMPTY_USAGE, input: 7, total: 7 },
      cost: 0.004,
      attempts: [
        { model: 'free/one', tier: 'free' as const, durationMs: 10, status: 'failed' as const, errorCode: 'rate_limited' as const, usage: EMPTY_USAGE, cost: 0 },
        { model: 'paid/cheap', tier: 'paid' as const, durationMs: 20, status: 'failed' as const, errorCode: 'invalid_output' as const, usage: { ...EMPTY_USAGE, input: 7, total: 7 }, cost: 0.004 },
      ],
    };
    const error = new OpencodeRoutingError('OpenCode routing failed: invalid_output', result);
    (error as any).stderr = secret;
    runner.run.mockRejectedValue(error);
    const queue = createQueue();

    await (queue as any).processOne({ id: 't1', intent: 'x', pageSnapshot: null, leaseExpiresAtMs: 10_000 });

    const failed = prisma.assistTask.updateMany.mock.calls[0][0].data;
    expect(failed).toMatchObject({
      status: 'failed',
      error: 'OpenCode routing failed: invalid_output',
      result: {
        attemptCount: 2,
        attempts: [{ errorCode: 'rate_limited' }, { errorCode: 'invalid_output' }],
        usage: { total: 7 },
        cost: 0.004,
      },
    });
    expect(JSON.stringify({ result: failed.result, error: failed.error })).not.toContain(secret);
  });

  it('does not complete a task after its lease has been taken over', async () => {
    prisma.assistTask.updateMany.mockResolvedValue({ count: 0 });
    runner.run.mockResolvedValue({ summary: 'stale result' });
    const queue = createQueue();

    await (queue as any).processOne({ id: 't1', intent: 'x', pageSnapshot: null });

    expect(prisma.assistTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1', status: 'running', leaseOwner: (queue as any).workerId },
    }));
    expect(prisma.assistTask.update).not.toHaveBeenCalled();
  });

  it('absorbs and logs tick failures', async () => {
    const queue = createQueue();
    jest.spyOn(queue as any, 'tick').mockRejectedValue(new Error('database unavailable'));
    const log = jest.spyOn((queue as any).logger, 'error').mockImplementation();

    await expect((queue as any).safeTick()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('Assist queue tick failed', expect.any(String));
  });

  it('re-queues running tasks whose lease expired, below the retry limit', async () => {
    prisma.assistTask.findMany.mockResolvedValue([
      { id: 't1', attempts: 1, maxAttempts: 3 },
    ]);
    const queue = createQueue();
    await (queue as any).recoverExpiredLeases();
    expect(prisma.assistTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['t1'] } },
      data: expect.objectContaining({ status: 'queued', leaseOwner: null, attempts: { increment: 1 } }),
    }));
  });

  it('fails tasks that exhausted their retry budget instead of requeueing forever', async () => {
    prisma.assistTask.findMany.mockResolvedValue([
      { id: 't1', attempts: 3, maxAttempts: 3 },
    ]);
    const queue = createQueue();
    await (queue as any).recoverExpiredLeases();
    expect(prisma.assistTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['t1'] } },
      data: expect.objectContaining({ status: 'failed', error: 'Assistant retry budget exhausted' }),
    }));
  });
});
