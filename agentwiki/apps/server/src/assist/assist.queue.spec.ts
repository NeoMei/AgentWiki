import { AssistQueue } from './assist.queue';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { EMPTY_USAGE, OpencodeRoutingError } from './opencode.types';
import { Prisma } from '@prisma/client';
import { AssistSessionService } from './assist-session.service';

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

  it('serializes sanitized phase and answer writes, deduplicates phases, and replaces them with the final answer', async () => {
    const sessions = { executionContext: async () => ({ history: [] }) };
    const queue = new AssistQueue(prisma, config, runner, gateway, new AuthorizationService(prisma), new SpaceRevisionWriterService(prisma, {} as any), sessions as any);
    runner.run.mockImplementation(async (input: any) => {
      input.onProgress?.({ phase: 'preparing' });
      input.onProgress?.({ phase: 'generating', attempt: 1, raw: 'SECRET reasoning' });
      input.onProgress?.({ phase: 'generating', attempt: 1 });
      input.onAnswerText('Valid answer');
      input.onProgress?.({ phase: 'arbitrary SECRET message', attempt: 1 });
      input.onProgress?.({ phase: 'waiting', attempt: 101 });
      input.onProgress?.({ phase: 'waiting', attempt: 2 });
      return { summary: 'Final answer' };
    });
    await (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', sessionId: 's1', pageId: 'page-1', mode: 'question', intent: 'why', pageSnapshot: {} });
    const writes = prisma.assistTask.updateMany.mock.calls.map((call: any[]) => call[0]);
    expect(writes.map((write: any) => write.data.result || write.data.progressText)).toEqual([
      { progress: { phase: 'preparing' } }, { progress: { phase: 'generating', attempt: 1 } },
      'Valid answer', { progress: { phase: 'waiting', attempt: 2 } }, { summary: 'Final answer' },
    ]);
    for (const write of writes) expect(write.where).toMatchObject({ status: 'running', leaseOwner: (queue as any).workerId, leaseExpiresAt: { gt: expect.any(Date) } });
    expect(JSON.stringify(writes)).not.toContain('SECRET');
    expect(gateway.emitAssistStream).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'stale lease'])('cannot write queued phases after %s takes ownership', async reason => {
    const sessions = { executionContext: async () => ({ history: [] }) };
    const queue = new AssistQueue(prisma, config, runner, gateway, new AuthorizationService(prisma), new SpaceRevisionWriterService(prisma, {} as any), sessions as any);
    const row: any = { status: 'running', leaseOwner: (queue as any).workerId, result: null };
    prisma.assistTask.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (row.status !== where.status || row.leaseOwner !== where.leaseOwner) return { count: 0 };
      Object.assign(row, data); return { count: 1 };
    });
    runner.run.mockImplementation(async (input: any) => {
      if (reason === 'cancelled') row.status = 'cancelled'; else row.leaseOwner = 'new-worker';
      row.result = { terminal: 'preserved' };
      input.onProgress?.({ phase: 'generating', attempt: 1 });
      input.onAnswerText('late answer');
      return { summary: 'late answer' };
    });
    await (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', sessionId: 's1', pageId: 'page-1', mode: 'question', intent: 'why', pageSnapshot: {} });
    expect(row.result).toEqual({ terminal: 'preserved' });
    expect(row.progressText).toBeUndefined();
    expect(row.status).toBe(reason === 'cancelled' ? 'cancelled' : 'running');
  });

  it('stops an in-flight progress transaction before marking a runtime failure terminal', async () => {
    let progressEntered!: () => void;
    const entered = new Promise<void>(resolve => { progressEntered = resolve; });
    let releaseProgress!: () => void;
    const blocked = new Promise<void>(resolve => { releaseProgress = resolve; });
    let blockProgress = false;
    const sessions = { executionContext: async () => {
      if (blockProgress) { progressEntered(); await blocked; }
      return { history: [] };
    } };
    const queue = new AssistQueue(prisma, config, runner, gateway, new AuthorizationService(prisma), new SpaceRevisionWriterService(prisma, {} as any), sessions as any);
    runner.run.mockImplementation(async (input: any) => {
      blockProgress = true;
      input.onProgress({ phase: 'generating' });
      await entered;
      input.signal.addEventListener('abort', releaseProgress, { once: true });
      throw new Error('SECRET provider failure');
    });
    await (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', sessionId: 's1', pageId: 'page-1', mode: 'question', intent: 'why', pageSnapshot: {} });
    const writes = prisma.assistTask.updateMany.mock.calls.map((call: any[]) => call[0].data);
    expect(writes).toHaveLength(2);
    expect(writes[0].result).toEqual({ progress: { phase: 'preparing' } });
    expect(writes[1]).toMatchObject({ status: 'failed', progressText: '', result: Prisma.DbNull });
    expect(JSON.stringify(writes)).not.toContain('SECRET');
  });

  it('revalidates authorization before every progress write', async () => {
    let allowed = true;
    const sessions = { executionContext: async () => {
      if (!allowed) throw new Error('permission lost');
      return { history: [] };
    } };
    const queue = new AssistQueue(prisma, config, runner, gateway, new AuthorizationService(prisma), new SpaceRevisionWriterService(prisma, {} as any), sessions as any);
    runner.run.mockImplementation(async (input: any) => {
      allowed = false;
      input.onProgress({ phase: 'generating' });
      return { summary: 'late answer' };
    });
    await (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', sessionId: 's1', pageId: 'page-1', mode: 'question', intent: 'why', pageSnapshot: {} });
    const writes = prisma.assistTask.updateMany.mock.calls.map((call: any[]) => call[0].data);
    expect(writes.map((data: any) => data.result?.progress?.phase).filter(Boolean)).toEqual(['preparing']);
    expect(writes.some((data: any) => data.status === 'done')).toBe(false);
  });

  it('actively aborts a running session after cancellation and never publishes its late answer', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    runner.run.mockImplementation(async (input: any) => {
      signal = input.signal;
      await waiting;
      return { summary: 'late answer' };
    });
    const queue = createQueue();
    const done = (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', pageId: 'page-1', intent: 'why', pageSnapshot: null });
    for (let i = 0; i < 15; i++) await Promise.resolve();
    prisma.assistTask.count.mockResolvedValue(0);
    await jest.advanceTimersByTimeAsync(1000);
    release();
    await done;
    jest.useRealTimers();
    expect(signal?.aborted).toBe(true);
    const doneWriteAfterCancel = prisma.assistTask.updateMany.mock.calls.filter((call: any[]) => call[0].data.status === 'done');
    expect(doneWriteAfterCancel).toHaveLength(0);
    expect(gateway.emitAssistComplete).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('persists answer-only session progress and completion behind the live lease fence without socket events', async () => {
    const sessions = { executionContext: jest.fn().mockResolvedValue({ context: { pageId: 'page-1', references: [], noteIds: [] }, history: [{ intent: 'before', answer: 'previous answer' }] }) };
    const queue = new AssistQueue(prisma, config, runner, gateway, new AuthorizationService(prisma), new SpaceRevisionWriterService(prisma, {} as any), sessions as any);
    runner.run.mockImplementation(async (input: any) => {
      expect(input.history[0].answer).toBe('previous answer');
      expect(input.onStreamChunk).toBeUndefined();
      input.onAnswerText('Only the answer');
      return { summary: 'Only the answer', changes: '', raw: 'private reasoning', model: 'internal-model' };
    });
    await (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', sessionId: 's1', pageId: 'page-1', mode: 'question', intent: 'why', pageSnapshot: {} });
    const progress = prisma.assistTask.updateMany.mock.calls.find((call: any[]) => call[0].data.progressText && !call[0].data.status)[0];
    expect(progress).toMatchObject({ where: { status: 'running', leaseOwner: (queue as any).workerId, leaseExpiresAt: { gt: expect.any(Date) } }, data: { progressText: 'Only the answer', progressVersion: { increment: 1 } } });
    const done = prisma.assistTask.updateMany.mock.calls.find((call: any[]) => call[0].data.status === 'done')[0];
    expect(done.data.result).toEqual({ summary: 'Only the answer' });
    expect(gateway.emitAssistStream).not.toHaveBeenCalled();
    expect(gateway.emitAssistComplete).not.toHaveBeenCalled();
  });

  it.each(['permission', 'reference'])('aborts active session execution on live %s loss and prevents late publication', async () => {
    jest.useFakeTimers();
    let allowed = true;
    let started!: () => void;
    let release!: () => void;
    const running = new Promise<void>(resolve => { started = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const sessions = { executionContext: async () => { if (!allowed) throw new Error('source access lost'); return { history: [] }; } };
    const queue = new AssistQueue(prisma, config, runner, gateway, new AuthorizationService(prisma), new SpaceRevisionWriterService(prisma, {} as any), sessions as any);
    let signal!: AbortSignal;
    runner.run.mockImplementation(async (input: any) => { signal = input.signal; started(); await waiting; return { summary: 'late' }; });
    const pending = (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', sessionId: 's1', pageId: 'page-1', mode: 'question', intent: 'why', pageSnapshot: {} });
    await running;
    allowed = false;
    await jest.advanceTimersByTimeAsync(500);
    const abortedDuringRun = signal.aborted;
    release(); await pending; jest.useRealTimers();
    expect(abortedDuringRun).toBe(true);
    expect(prisma.assistTask.updateMany.mock.calls.some((call: any[]) => call[0].data.status === 'done')).toBe(false);
  });

  it.each([
    { summary: 'answer', changes: 'unexpected edit' },
    { summary: 'x'.repeat(50_001) },
  ])('rejects malformed or oversized session question output before done persistence', async result => {
    const sessions = { executionContext: async () => ({ history: [] }) };
    const queue = new AssistQueue(prisma, config, runner, gateway, new AuthorizationService(prisma), new SpaceRevisionWriterService(prisma, {} as any), sessions as any);
    runner.run.mockResolvedValue(result);
    await (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', sessionId: 's1', pageId: 'page-1', mode: 'question', intent: 'why', pageSnapshot: {} });
    expect(prisma.assistTask.updateMany.mock.calls.map((call: any[]) => call[0].data.status).filter(Boolean)).toEqual(['failed']);
    expect(gateway.emitAssistError).not.toHaveBeenCalled();
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
    expect(claim.data).not.toHaveProperty('result'); // Legacy tasks retain their result semantics.
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

  it.each([
    ['budget_exhausted', 'timeout'], ['timeout', 'timeout'], ['invalid_output', 'invalid_output'],
    ['auth_failed', 'service_unavailable'], ['no_models', 'service_unavailable'],
    ['configuration_error', 'service_unavailable'], ['rate_limited', 'rate_limited'], ['output_limit', 'output_limit'],
  ])('retains a safe session failure category for %s without provider details', async (code, expected) => {
    const sessions = { executionContext: async () => ({ history: [] }) };
    const queue = new AssistQueue(prisma, config, runner, gateway, new AuthorizationService(prisma), new SpaceRevisionWriterService(prisma, {} as any), sessions as any);
    runner.run.mockRejectedValue(new OpencodeRoutingError(`OpenCode routing failed: ${code}`, {
      summary: 'SECRET provider response', raw: 'SECRET body', model: 'SECRET model',
      attempts: [{ model: 'SECRET model', tier: 'paid', durationMs: 300_000, status: 'failed', errorCode: 'timeout', usage: EMPTY_USAGE, cost: 0 }],
    }));
    await (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', sessionId: 's1', pageId: 'page-1', mode: 'auto', intent: 'update', pageSnapshot: {} });
    const failed = prisma.assistTask.updateMany.mock.calls.map((call: any[]) => call[0].data).find((data: any) => data.status === 'failed');
    expect(failed.result).toEqual({ failure: { code: expected } });
    expect(JSON.stringify({ error: failed.error, result: failed.result })).not.toContain('SECRET');
  });

  it('reports the final timeout even when an earlier model hit its output limit', async () => {
    const sessions = { executionContext: async () => ({ history: [] }) };
    const queue = new AssistQueue(prisma, config, runner, gateway, new AuthorizationService(prisma), new SpaceRevisionWriterService(prisma, {} as any), sessions as any);
    runner.run.mockRejectedValue(new OpencodeRoutingError('OpenCode routing failed: budget_exhausted', {
      summary: 'Failed', attempts: [{ model: 'primary', tier: 'paid', durationMs: 1, status: 'failed', errorCode: 'output_limit', usage: EMPTY_USAGE, cost: 0 }],
    }));
    await (queue as any).processOne({ id: 't1', spaceId: 'space-1', requestedByUserId: 'user-1', sessionId: 's1', pageId: 'page-1', mode: 'auto', intent: 'update', pageSnapshot: {} });
    const failed = prisma.assistTask.updateMany.mock.calls.map((call: any[]) => call[0].data).find((data: any) => data.status === 'failed');
    expect(failed.result).toEqual({ failure: { code: 'timeout' } });
    expect(failed.error).toContain('timed out');
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
      where: { id: { in: ['t1'] }, status: 'running', leaseExpiresAt: { lte: expect.any(Date) } },
      data: expect.objectContaining({ status: 'queued', leaseOwner: null, attempts: { increment: 1 } }),
    }));
  });

  it('clears recovered session phases atomically on claim before startup authorization completes', async () => {
    jest.useFakeTimers();
    const version = new Date('2026-01-01T00:00:00.000Z');
    const row: any = { id: 't1', sessionId: 's1', spaceId: 'space-1', requestedByUserId: 'user-1', pageId: 'page-1',
      mode: 'question', intent: 'why', status: 'running', createdAt: version, attempts: 1, maxAttempts: 3,
      leaseOwner: 'expired-worker', leaseExpiresAt: new Date(Date.now() - 1),
      pageSnapshot: { content: 'source', updatedAt: version.toISOString() }, context: { pageId: 'page-1', references: [], noteIds: [] },
      result: { progress: { phase: 'finalizing', attempt: 2 } } };
    const matches = (where: any) => Object.entries(where).every(([key, value]: any) => {
      if (key === 'space') return true;
      if (key === 'OR') return value.some((condition: any) => matches(condition));
      if (value?.in) return value.in.includes(row[key]);
      if (value?.lte) return row[key] !== null && row[key] <= value.lte;
      if (value?.gt) return row[key] !== null && row[key] > value.gt;
      return row[key] === value;
    });
    let startupEntered!: () => void;
    const startup = new Promise<void>(resolve => { startupEntered = resolve; });
    let releaseStartup!: () => void;
    const startupBlocked = new Promise<void>(resolve => { releaseStartup = resolve; });
    let freshWritten!: () => void;
    const fresh = new Promise<void>(resolve => { freshWritten = resolve; });
    let releaseRuntime!: () => void;
    const runtimeBlocked = new Promise<void>(resolve => { releaseRuntime = resolve; });
    const db: any = { ...prisma,
      $queryRaw: async (query: any) => query.sql?.includes('jsonb_array_elements') ? [{ ...row }] : [{ id: 'user-1' }],
      $transaction: async (callback: any) => callback(db),
      page: { ...prisma.page, count: async () => 1 },
      assistSession: { findFirst: async () => ({ id: 's1', spaceId: 'space-1', requestedByUserId: 'user-1', title: 'Chat', createdAt: version, updatedAt: version }) },
      assistTask: {
        findMany: async ({ where }: any) => matches(where) ? [{ ...row }] : [],
        findFirst: async ({ where }: any) => matches(where) ? { ...row } : null,
        count: async ({ where }: any) => { startupEntered(); await startupBlocked; return matches(where) ? 1 : 0; },
        updateMany: async ({ where, data }: any) => {
          if (!matches(where)) return { count: 0 };
          for (const [key, value] of Object.entries(data) as [string, any][]) row[key] = value === Prisma.DbNull ? null : value?.increment ? (row[key] || 0) + value.increment : value;
          if (row.result?.progress?.phase === 'waiting') freshWritten();
          return { count: 1 };
        },
      },
    };
    const authorization = new AuthorizationService(db);
    const writer = new SpaceRevisionWriterService(db, {} as any);
    const sessions = new AssistSessionService(db, authorization, writer, config);
    const queue = new AssistQueue(db, config, runner, gateway, authorization, writer, sessions);
    let processing: Promise<void> | undefined;
    const processOne = (queue as any).processOne.bind(queue);
    jest.spyOn(queue as any, 'processOne').mockImplementation((task: any) => { processing = processOne(task); return processing; });
    runner.run.mockImplementation(async (input: any) => { input.onProgress({ phase: 'waiting', attempt: 1 }); await runtimeBlocked; return { summary: 'fresh answer' }; });
    try {
      await (queue as any).recoverExpiredLeases();
      expect(row.status).toBe('queued');
      expect((await sessions.get('s1', 'user-1')).turns[0]).not.toHaveProperty('progress');
      jest.setSystemTime(Date.now() + 15_001);
      await (queue as any).tick();
      await startup;
      const claimed = (await sessions.get('s1', 'user-1')).turns[0];
      expect(claimed.status).toBe('running');
      expect(claimed).not.toHaveProperty('progress');
      expect(runner.run).not.toHaveBeenCalled();
      releaseStartup();
      await fresh;
      expect((await sessions.get('s1', 'user-1')).turns[0].progress).toEqual({ phase: 'waiting', attempt: 1 });
    } finally {
      await queue.onModuleDestroy();
      releaseStartup(); releaseRuntime();
      await processing;
      jest.useRealTimers();
    }
  });

  it('fails tasks that exhausted their retry budget instead of requeueing forever', async () => {
    prisma.assistTask.findMany.mockResolvedValue([
      { id: 't1', attempts: 3, maxAttempts: 3 },
    ]);
    const queue = createQueue();
    await (queue as any).recoverExpiredLeases();
    expect(prisma.assistTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['t1'] }, status: 'running', leaseExpiresAt: { lte: expect.any(Date) } },
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

describe('AssistQueue automatic document publication', () => {
  let db: any; let runner: any; let sessions: any; let writer: any; let queue: AssistQueue; let active: boolean;
  const task: any = { id: 't1', pageId: 'p1', pageSnapshot: { title: 'Page', content: 'old', updatedAt: '2026-01-01T00:00:00.000Z' }, spaceId: 's1', requestedByUserId: 'u1', sessionId: 'chat1', mode: 'auto', intent: 'Save this change' };
  const receipt = { operation: 'updated', pageId: 'p1', title: 'Page', updatedAt: '2026-01-02T00:00:00.000Z', url: '/pages/p1' };
  beforeEach(() => {
    active = true;
    db = { $transaction: jest.fn(async (fn: any) => fn(db)), assistTask: { count: jest.fn(async () => active ? 1 : 0), updateMany: jest.fn(async () => ({ count: active ? 1 : 0 })), update: jest.fn() } };
    runner = { run: jest.fn().mockResolvedValue({ action: 'update', summary: 'Saved', changes: 'new' }) };
    sessions = { executionContext: jest.fn().mockResolvedValue({ context: { pageId: 'p1', references: [], noteIds: [], directory: { folderId: null, recursive: true, title: 'Root', documents: [] } }, actions: { update: true, create: true } }) };
    writer = { write: jest.fn().mockResolvedValue(receipt), afterCommit: jest.fn() };
    queue = new AssistQueue(db, { get: () => undefined } as any, runner, {} as any, { lockLiveHumanPrincipal: jest.fn() } as any, { lockSpace: async () => db } as any, sessions, writer);
  });
  it('leaves pages untouched for automatic answers', async () => {
    runner.run.mockResolvedValue({ action: 'answer', summary: 'Here is the summary' });
    await (queue as any).processOne(task);
    expect(writer.write).not.toHaveBeenCalled();
    expect(db.assistTask.updateMany.mock.calls.find(([input]: any[]) => input.data.status === 'done')[0].data.result).toEqual({ action: 'answer', summary: 'Here is the summary' });
  });
  it('claims the terminal task fence before writing and stores the real receipt in the same transaction', async () => {
    let fenced = false;
    db.assistTask.updateMany.mockImplementation(async ({ data }: any) => { if (data.status === 'done') fenced = true; return { count: 1 }; });
    writer.write.mockImplementation(async (tx: any) => { expect(tx).toBe(db); expect(fenced).toBe(true); return receipt; });
    await (queue as any).processOne(task);
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(db.assistTask.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { result: { action: 'update', summary: 'Saved', changes: 'new', document: receipt } } });
    expect(writer.afterCommit).toHaveBeenCalledWith('s1', receipt);
  });
  it.each(['cancelled', 'expired lease'])('does not write when %s wins the terminal fence', async () => {
    runner.run.mockImplementation(async () => { active = false; return { action: 'update', summary: 'Saved', changes: 'new' }; });
    await (queue as any).processOne(task);
    expect(writer.write).not.toHaveBeenCalled(); expect(writer.afterCommit).not.toHaveBeenCalled();
  });
  it('rejects write results when initial live capabilities were read-only', async () => {
    sessions.executionContext.mockResolvedValue({ context: { pageId: 'p1' }, actions: { update: false, create: false } });
    await (queue as any).processOne(task);
    expect(writer.write).not.toHaveBeenCalled();
    expect(db.assistTask.updateMany.mock.calls.some(([input]: any[]) => input.data.status === 'failed')).toBe(true);
  });
  it('rolls back the completion transaction if live write authorization or page CAS fails', async () => {
    let rolledBack = false;
    writer.write.mockRejectedValue(new Error('revoked or changed'));
    db.$transaction.mockImplementation(async (fn: any) => { try { return await fn(db); } catch (error) { rolledBack = true; throw error; } });
    await (queue as any).processOne(task);
    expect(rolledBack).toBe(true); expect(db.assistTask.update).not.toHaveBeenCalled(); expect(writer.afterCommit).not.toHaveBeenCalled();
  });
  it.each([
    { action: 'answer', summary: 'Read', changes: 'write' }, { action: 'update', summary: 'Saved', changes: 'new', pageId: 'foreign' },
    { action: 'create', summary: 'Saved', title: 'New', changes: 'new', folderId: 'foreign' }, { action: 'delete', summary: 'Deleted' },
  ])('rejects malformed or target-bearing result %j', async result => {
    runner.run.mockResolvedValue(result);
    await (queue as any).processOne(task);
    expect(writer.write).not.toHaveBeenCalled();
    expect(db.assistTask.updateMany.mock.calls.some(([input]: any[]) => input.data.status === 'failed')).toBe(true);
  });
  it('rolls back a write if the lease expires during the document transaction', async () => {
    jest.useFakeTimers();
    let release!: () => void; let started!: () => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let rolledBack = false;
    writer.write.mockImplementation(async () => { started(); await waiting; return receipt; });
    db.$transaction.mockImplementation(async (fn: any) => { try { return await fn(db); } catch (error) { rolledBack = true; throw error; } });
    const pending = (queue as any).processOne({ ...task, leaseExpiresAtMs: Date.now() + 1000 });
    await writing;
    await jest.advanceTimersByTimeAsync(1100);
    release(); await pending;
    expect(rolledBack).toBe(true); expect(db.assistTask.update).not.toHaveBeenCalled(); expect(writer.afterCommit).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
  it('rolls back if the final receipt write finishes after the lease expires', async () => {
    jest.useFakeTimers();
    let release!: () => void; let started!: () => void;
    const writing = new Promise<void>(resolve => { started = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let rolledBack = false;
    db.assistTask.update.mockImplementation(async () => { started(); await waiting; });
    db.$transaction.mockImplementation(async (fn: any) => { try { return await fn(db); } catch (error) { rolledBack = true; throw error; } });
    const pending = (queue as any).processOne({ ...task, leaseExpiresAtMs: Date.now() + 1000 });
    await writing;
    await jest.advanceTimersByTimeAsync(1100);
    release(); await pending;
    expect(rolledBack).toBe(true); expect(writer.afterCommit).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
  it('does not repeat publication for an already completed task on worker retry', async () => {
    await (queue as any).processOne(task);
    active = false;
    await (queue as any).processOne(task);
    expect(writer.write).toHaveBeenCalledTimes(1); expect(runner.run).toHaveBeenCalledTimes(1);
  });
});
