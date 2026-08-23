import { RunEventStore, canonicalRequestHash } from './run-event.store';
import { RunService } from './run.service';

function projectSelected(value: any, select: Record<string, any>): any {
  return Object.fromEntries(Object.entries(select).map(([key, selection]) => {
    const child = value[key];
    if (selection === true || child == null) return [key, child];
    const childSelect = selection.select;
    if (Array.isArray(child)) return [key, child.map((item) => projectSelected(item, childSelect))];
    return [key, projectSelected(child, childSelect)];
  }));
}

describe('RunEventStore', () => {
  const events: any[] = [];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'run-1' }]),
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
    tx.$queryRaw.mockResolvedValue([{ id: 'run-1' }]);
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
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
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

  it('stores a compact receipt but reloads the current authoritative response on replay', async () => {
    const mutation = jest.fn().mockResolvedValue({ id: 'run-1', status: 'paused', events: [{ response: { nested: true } }] });
    const replayResponse = jest.fn().mockResolvedValue({ id: 'run-1', status: 'running', events: [] });
    const receiptScope = {
      ...scope,
      responseForStorage: () => ({ runId: 'run-1' }),
      replayResponse,
    };

    const first = await store.executeIdempotent(tx, receiptScope, mutation);
    const second = await store.executeIdempotent(tx, receiptScope, mutation);

    expect(first).toMatchObject({ status: 'paused' });
    expect(events[0].response).toEqual({ runId: 'run-1' });
    expect(second).toEqual({ id: 'run-1', status: 'running', events: [] });
    expect(replayResponse).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('rejects a cross-Space exact start replay before loading the authoritative run', async () => {
    const definition = {
      schemaVersion: 1,
      inputs: [{ key: 'objective', label: 'Objective', required: true, type: 'long_text' }],
      roleSlots: [{ id: 'planner', name: 'Planner', required: true, description: 'Plans' }],
      nodes: [{
        kind: 'agent_task', id: 'plan', name: 'Plan', roleSlotId: 'planner', objective: 'Plan',
        inputKeys: ['objective'], upstreamArtifacts: [], output: { key: 'plan', kind: 'markdown' },
        evidenceRequired: [], humanAcceptance: false, leaseSeconds: 300, maxExecutionSeconds: 3600,
        retryBudget: 1, repairBudget: 1, skippable: false,
        todos: [{ id: 'plan', name: 'Plan', required: true, evidenceKinds: [] }],
      }],
      dependencies: [],
      terminalNodeIds: ['plan'],
    };
    const binding = {
      id: 'binding-a', runId: 'run-a', roleSlotId: 'planner', roleSlotName: 'Planner', agentId: 'agent-a',
    };
    const authoritative: any = {
      id: 'run-a', spaceId: 'space-a', templateId: 'template-a', templateVersion: 1,
      templateSnapshot: {}, snapshotHash: '0'.repeat(64), name: 'Space A run', status: 'ready', version: 2,
      inputs: { objective: 'Keep A private' }, startedById: 'user-cross', pauseReason: null, eventSequence: 0,
      startedAt: null, finishedAt: null, createdAt: new Date(), updatedAt: new Date(),
      roleBindings: [binding], tasks: [], dependencies: [], reviews: [], events: [],
    };
    const storedEvents: any[] = [];
    const findAuthoritative = jest.fn(async ({ where, select }: any) => {
      if (where.id !== authoritative.id) return null;
      return select ? projectSelected(authoritative, select) : structuredClone(authoritative);
    });
    const runTable = {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id !== authoritative.id || where.spaceId !== authoritative.spaceId) return null;
        if (where.status && where.status !== authoritative.status) return null;
        if (where.version && where.version !== authoritative.version) return null;
        return structuredClone(authoritative);
      }),
      findUnique: findAuthoritative,
      update: jest.fn(async ({ data, select }: any) => {
        if (data.version?.increment) authoritative.version += data.version.increment;
        if (data.eventSequence?.increment) authoritative.eventSequence += data.eventSequence.increment;
        for (const [key, value] of Object.entries(data)) {
          if (!['version', 'eventSequence'].includes(key)) authoritative[key] = value;
        }
        return select ? projectSelected(authoritative, select) : structuredClone(authoritative);
      }),
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'run-a' }]),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'run-a' }]),
      collaborationRunEvent: {
        findFirst: jest.fn(async ({ where }: any) => storedEvents.find((event) =>
          event.runId === where.runId
          && event.actorKind === where.actorKind
          && event.actorId === where.actorId
          && event.idempotencyKey === where.idempotencyKey,
        ) ?? null),
        create: jest.fn(async ({ data }: any) => {
          storedEvents.push(data);
          authoritative.events.push(data);
          return data;
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      collaborationRun: runTable,
      collaborationTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'template-a', version: 1, system: false, spaceId: 'space-a', archivedAt: null, definition,
        }),
      },
      collaborationRoleBinding: { findMany: jest.fn().mockResolvedValue([binding]) },
      collaborationRunTask: { createMany: jest.fn() },
      collaborationTaskTodo: { createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      collaborationTaskAttempt: { findMany: jest.fn().mockResolvedValue([]) },
      collaborationArtifact: { findMany: jest.fn().mockResolvedValue([]) },
      collaborationReview: { findMany: jest.fn().mockResolvedValue([]) },
      collaborationTaskDependency: { createMany: jest.fn() },
      agentGrant: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'grant-a', agentId: 'agent-a', spaceId: 'space-a', role: 'editor',
          agent: { id: 'agent-a', status: 'active', revokedAt: null }, space: { deletedAt: null },
        }]),
      },
    } as any;
    const prisma = {
      ...transaction,
      $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(transaction)),
    } as any;
    let allowedSpace = 'space-a';
    const authorization = {
      assertSpaceAccess: jest.fn(async (_principal: unknown, spaceId: string) => {
        if (spaceId !== allowedSpace) throw new Error('unexpected unauthorized Space lookup');
        return { role: 'editor' };
      }),
      assertLiveHumanSpaceAccess: jest.fn(async (_tx: unknown, _principal: unknown, spaceId: string) => {
        if (spaceId !== allowedSpace) throw new Error('unexpected unauthorized Space lookup');
        return { role: 'editor', userId: 'user-cross', spaceId };
      }),
    } as any;
    const service = new RunService(
      prisma,
      authorization,
      new RunEventStore(),
      { advanceRun: jest.fn() } as any,
      { publishCurrentRun: jest.fn() } as any,
      { decode: jest.fn(), encode: jest.fn() } as any,
    );
    const principal = { userId: 'user-cross' };
    const input = { expectedVersion: 2, idempotencyKey: 'start-space-a-0001' };

    await service.startRun('space-a', 'run-a', input, principal);
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0].response).toEqual({ runId: 'run-a', status: 'running', version: 3 });

    allowedSpace = 'space-b';
    const authoritativeLoadsBeforeReplay = findAuthoritative.mock.calls.length;
    await expect(service.startRun('space-b', 'run-a', input, principal))
      .rejects.toMatchObject({ businessCode: 'RESOURCE_NOT_FOUND' });
    expect(findAuthoritative).toHaveBeenCalledTimes(authoritativeLoadsBeforeReplay);
  });
});
