import { RunEventStore, canonicalRequestHash } from './run-event.store';

describe('RunEventStore', () => {
  const events: any[] = [];
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'run-1' }]),
    collaborationRunEvent: {
      findFirst: jest.fn(async ({ where }: any) => events.find((event) =>
        event.runId === where.runId
        && event.actorKind === where.actorKind
        && event.actorId === where.actorId
        && event.idempotencyKey === where.idempotencyKey,
      ) ?? null),
      create: jest.fn(async ({ data }: any) => {
        events.push(data);
        return data;
      }),
    },
    collaborationRun: {
      update: jest.fn().mockResolvedValue({ id: 'run-1', eventSequence: 1 }),
    },
  } as any;
  const store = new RunEventStore();
  const scope = {
    runId: 'run-1', actorKind: 'human' as const, actorId: 'user-1', actorUserId: 'user-1',
    operation: 'pause', target: 'run-1', key: 'pause-0001', requestHash: canonicalRequestHash({ reason: 'maintenance' }),
  };

  beforeEach(() => {
    events.length = 0;
    jest.clearAllMocks();
    tx.$queryRawUnsafe.mockResolvedValue([{ id: 'run-1' }]);
    tx.collaborationRun.update.mockResolvedValue({ id: 'run-1', eventSequence: 1 });
  });

  it('runs and stores one mutation, then returns the exact replay', async () => {
    const mutation = jest.fn().mockResolvedValue({ status: 'paused' });
    const first = await store.executeIdempotent(tx, scope, mutation);
    const second = await store.executeIdempotent(tx, scope, mutation);
    expect(first).toEqual({ status: 'paused' });
    expect(second).toEqual(first);
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(tx.collaborationRunEvent.create).toHaveBeenCalledTimes(1);
  });

  it('rejects key reuse across a different operation, target, or body', async () => {
    await store.executeIdempotent(tx, scope, async () => ({ status: 'paused' }));
    await expect(store.executeIdempotent(tx, { ...scope, operation: 'resume' }, async () => ({})))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_IDEMPOTENCY_MISMATCH' });
    await expect(store.executeIdempotent(tx, { ...scope, target: 'task-1' }, async () => ({})))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_IDEMPOTENCY_MISMATCH' });
    await expect(store.executeIdempotent(tx, { ...scope, requestHash: canonicalRequestHash({ reason: 'other' }) }, async () => ({})))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_IDEMPOTENCY_MISMATCH' });
  });

  it('stores a caller-selected safe response without a lease token', async () => {
    const response = { action: 'execute_task', attemptId: 'attempt-1', leaseToken: 'secret-token' };
    await store.executeIdempotent(tx, {
      ...scope,
      responseForStorage: (value) => ({ action: value.action, attemptId: value.attemptId }),
    }, async () => response);
    expect(JSON.stringify(events)).not.toContain('secret-token');
  });
});
