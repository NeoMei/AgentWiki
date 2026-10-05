import { AssistQueue } from './assist.queue';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { EMPTY_USAGE, OpencodeRoutingError } from './opencode.types';

describe('AssistQueue task processing', () => {
  const prisma = {
    page: { findFirst: jest.fn() },
    $transaction: jest.fn(), $executeRaw: jest.fn(), $queryRaw: jest.fn(), user: { findUnique: jest.fn() },
    space: { findUnique: jest.fn() }, spaceMember: { findUnique: jest.fn() },
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
  const createQueue = () => new AssistQueue(prisma, config, runner, gateway, new AuthorizationService(prisma), new SpaceRevisionWriterService(prisma, {} as any));

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.$queryRaw.mockResolvedValue([{ id: 'user-1' }]);
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', type: 'human', platformRole: 'user', lockedAt: null, deletedAt: null });
    prisma.space.findUnique.mockResolvedValue({ id: 'space-1', deletedAt: null });
    prisma.spaceMember.findUnique.mockResolvedValue({ role: 'editor' });
    prisma.page.findFirst.mockResolvedValue({ id: 'page-1', updatedAt: new Date('2026-01-01T00:00:00.000Z') });
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
    await (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', intent: 'polish', pageSnapshot: { content: '# Hi' } });
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ intent: 'polish' }));
    expect(prisma.assistTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 't1', status: 'running', leaseOwner: (queue as any).workerId }),
      data: expect.objectContaining({ status: 'done' }),
    }));
  });

  it('marks the task failed when opencode errors', async () => {
    runner.run.mockRejectedValue(new Error('llm down'));
    const queue = createQueue();
    await (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', intent: 'x', pageSnapshot: null });
    expect(prisma.assistTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 't1', status: 'running', leaseOwner: (queue as any).workerId }),
      data: expect.objectContaining({ status: 'failed', error: 'Editing assistant failed' }),
    }));
  });

  it('passes the exact claimed lease deadline to the runner', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    prisma.assistTask.findFirst
      .mockResolvedValueOnce({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', intent: 'polish', pageSnapshot: { content: '# Hi' } })
      .mockResolvedValueOnce(null);
    runner.run.mockResolvedValue({ summary: 'done' });
    const queue = createQueue();

    await (queue as any).tick();

    const claim = prisma.assistTask.updateMany.mock.calls.find((call: any[]) => call[0].data.status === 'running')[0];
    expect(claim.data.leaseExpiresAt).toEqual(new Date(1_060_000));
    expect(prisma.assistTask.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ space: { deletedAt: null } }),
    }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ leaseExpiresAtMs: 1_060_000 }));
    now.mockRestore();
  });

  it('lets routing recheck the task lease and active space before every model attempt', async () => {
    runner.run.mockImplementation(async (input: any) => {
      await expect(input.isActive()).resolves.toBe(true);
      return { summary: 'done' };
    });
    const queue = createQueue();

    await (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', intent: 'x', pageSnapshot: null });

    expect(prisma.assistTask.count).toHaveBeenCalledWith({
      where: {
        id: 't1',
        status: 'running',
        leaseOwner: (queue as any).workerId,
        space: { deletedAt: null },
        leaseExpiresAt: { gt: expect.any(Date) },
        spaceId: 'space-1',
        requestedByUserId: 'user-1',
        pageId: null,
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

    await (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', intent: 'x', pageSnapshot: null, leaseExpiresAtMs: 10_000 });

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

    await (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', intent: 'x', pageSnapshot: null });

    expect(prisma.assistTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 't1', status: 'running', leaseOwner: (queue as any).workerId }),
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
  const scopedTask = () => ({
    id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', pageId: 'page-1', intent: 'polish',
    pageSnapshot: { content: 'pre OLD post', updatedAt: '2026-01-01T00:00:00.000Z', assistTarget: {
      kind: 'section', from: 4, to: 7, quote: 'OLD', prefix: 'pre ', suffix: ' post', baseUpdatedAt: '2026-01-01T00:00:00.000Z',
    } },
  });

  it.each(['prefix', 'suffix', 'overlapping'])('fails %s changes outside selected scope without persisting model output', async (side) => {
    runner.run.mockResolvedValue({ summary: 'changed', changes: side === 'prefix' ? 'bad NEW post' : side === 'suffix' ? 'pre NEW bad' : 'pre post' });
    await (createQueue() as any).processOne(scopedTask());
    const update = prisma.assistTask.updateMany.mock.calls[0][0].data;
    expect(update.status).toBe('failed');
    expect(update.result).toBeUndefined();
    expect(gateway.emitAssistComplete).not.toHaveBeenCalled();
  });

  it('stores full selected result with outside source preserved', async () => {
    runner.run.mockResolvedValue({ summary: 'changed', changes: 'pre NEW post' });
    await (createQueue() as any).processOne(scopedTask());
    expect(prisma.assistTask.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'done', result: { changes: 'pre NEW post' } });
  });

  it.each(['revoked', 'locked', 'foreign-page', 'stale-version', 'missing-requester'])('refuses %s task before calling any model', async (reason) => {
    const task = scopedTask();
    if (reason === 'revoked') prisma.spaceMember.findUnique.mockResolvedValue(null);
    if (reason === 'locked') prisma.user.findUnique.mockResolvedValue({ id: 'user-1', type: 'human', lockedAt: new Date() });
    if (reason === 'foreign-page') prisma.page.findFirst.mockResolvedValue(null);
    if (reason === 'stale-version') prisma.page.findFirst.mockResolvedValue({ id: 'page-1', updatedAt: new Date('2026-02-01') });
    if (reason === 'missing-requester') task.requestedByUserId = null as any;
    await (createQueue() as any).processOne(task);
    expect(runner.run).not.toHaveBeenCalled();
    expect(prisma.assistTask.updateMany.mock.calls[0][0].data.status).toBe('failed');
  });

  it('blocks a retry and completion when access is revoked during the first model attempt', async () => {
    runner.run.mockImplementation(async (input: any) => {
      prisma.spaceMember.findUnique.mockResolvedValue(null);
      expect(await input.isActive()).toBe(false);
      input.onStreamChunk?.('private draft');
      return { summary: 'changed', changes: 'pre NEW post' };
    });
    await (createQueue() as any).processOne(scopedTask());
    expect(prisma.assistTask.updateMany.mock.calls[0][0].data.status).toBe('failed');
    expect(gateway.emitAssistComplete).not.toHaveBeenCalled();
  });

  it('never starts a model after its lease expires', async () => {
    prisma.assistTask.count.mockResolvedValue(0);
    await (createQueue() as any).processOne(scopedTask());
    expect(runner.run).not.toHaveBeenCalled();
    expect(prisma.assistTask.updateMany.mock.calls[0][0].data.status).toBe('failed');
  });

  it('rejects a result when the saved page changes during execution', async () => {
    runner.run.mockImplementation(async () => {
      prisma.page.findFirst.mockResolvedValue({ id: 'page-1', updatedAt: new Date('2026-01-02') });
      return { summary: 'changed', changes: 'pre NEW post' };
    });
    await (createQueue() as any).processOne(scopedTask());
    expect(prisma.assistTask.updateMany.mock.calls[0][0].data.status).toBe('failed');
    expect(gateway.emitAssistComplete).not.toHaveBeenCalled();
  });

  it('validates malformed persisted targets before running a model', async () => {
    const task = scopedTask();
    task.pageSnapshot.assistTarget.quote = 'mismatch';
    await (createQueue() as any).processOne(task);
    expect(runner.run).not.toHaveBeenCalled();
    expect(prisma.assistTask.updateMany.mock.calls[0][0].data.status).toBe('failed');
  });

  function barrier() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
  }

  // Fake DB transaction advisory mutex: exercises the real writer SQL boundary,
  // real authorization and queue completion with controlled transaction ordering.
  function concurrentDb() {
    let tail = Promise.resolve();
    const events: string[] = [];
    let transactionId = 0;
    prisma.$transaction.mockImplementation(async (callback: any) => {
      const id = ++transactionId;
      let release: (() => void) | undefined;
      const tx = {
        ...prisma,
        $queryRaw: async (...args: any[]) => {
          events.push(`user:${id}`);
          return prisma.$queryRaw(...args);
        },
        $executeRaw: async (sql: TemplateStringsArray, spaceId: string) => {
          expect(sql.join('?')).toContain('pg_advisory_xact_lock(hashtext(');
          expect(spaceId).toBe('space-1');
          events.push(`space-wait:${id}`);
          const previous = tail;
          const held = barrier();
          tail = held.promise;
          await previous;
          release = held.resolve;
          events.push(`space-held:${id}`);
          return 0;
        },
      };
      try { return await callback(tx); }
      finally { events.push(`commit:${id}`); release?.(); }
    });
    return events;
  }

  it.each(['revocation', 'page-version'])('rechecks %s after the competing Space writer commits first', async (mutation) => {
    const events = concurrentDb();
    const mutationHasLock = barrier();
    const releaseMutation = barrier();
    const writer = new SpaceRevisionWriterService(prisma, {} as any);
    const authorization = new AuthorizationService(prisma);
    runner.run.mockImplementation(async () => {
      void prisma.$transaction(async (tx: any) => {
        await authorization.lockLiveHumanPrincipal(tx, { userId: 'admin-1' });
        await writer.lockSpace(tx, 'space-1');
        mutationHasLock.resolve();
        await releaseMutation.promise;
        if (mutation === 'revocation') prisma.spaceMember.findUnique.mockResolvedValue(null);
        else prisma.page.findFirst.mockResolvedValue({ id: 'page-1', updatedAt: new Date('2026-02-01') });
      });
      await mutationHasLock.promise;
      return { summary: 'changed', changes: 'pre NEW post' };
    });
    const finished = (createQueue() as any).processOne(scopedTask());
    await mutationHasLock.promise;
    await new Promise((resolve) => setImmediate(resolve));
    // Competing writer still owns the lock: completion cannot commit stale done.
    expect(prisma.assistTask.updateMany).not.toHaveBeenCalled();
    releaseMutation.resolve();
    await finished;
    expect(prisma.assistTask.updateMany.mock.calls[0][0].data.status).toBe('failed');
    expect(gateway.emitAssistComplete).not.toHaveBeenCalled();
    expect(events.indexOf('user:3')).toBeLessThan(events.indexOf('space-wait:3'));
    expect(events.indexOf('commit:2')).toBeLessThan(events.indexOf('space-held:3'));
  });

  it('holds the Space lock through done persistence so a later revocation cannot interleave after the check', async () => {
    const events = concurrentDb();
    const atDoneWrite = barrier();
    const allowDoneWrite = barrier();
    const writer = new SpaceRevisionWriterService(prisma, {} as any);
    const authorization = new AuthorizationService(prisma);
    let mutationCommitted = false;
    prisma.assistTask.updateMany.mockImplementation(async ({ data }: any) => {
      if (data.status === 'done') {
        atDoneWrite.resolve();
        await allowDoneWrite.promise;
        expect(mutationCommitted).toBe(false);
      }
      return { count: 1 };
    });
    runner.run.mockResolvedValue({ summary: 'changed', changes: 'pre NEW post' });
    const completion = (createQueue() as any).processOne(scopedTask());
    await atDoneWrite.promise;
    const mutation = prisma.$transaction(async (tx: any) => {
      await authorization.lockLiveHumanPrincipal(tx, { userId: 'admin-1' });
      await writer.lockSpace(tx, 'space-1');
      mutationCommitted = true;
      prisma.spaceMember.findUnique.mockResolvedValue(null);
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mutationCommitted).toBe(false);
    allowDoneWrite.resolve();
    await Promise.all([completion, mutation]);
    expect(mutationCommitted).toBe(true);
    expect(events.indexOf('commit:2')).toBeLessThan(events.indexOf('space-held:3'));
    expect(prisma.assistTask.updateMany.mock.calls[0][0].data.status).toBe('done');
  });

});
