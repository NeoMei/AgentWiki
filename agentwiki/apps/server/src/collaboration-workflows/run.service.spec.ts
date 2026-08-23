import type { Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { RunService } from './run.service';

const humanPrincipal: Principal = { userId: 'user-1' };
const starterPrincipal: Principal = { userId: 'starter-1' };
const definition = {
  schemaVersion: 1,
  inputs: [{ key: 'objective', label: 'Objective', required: true, type: 'long_text' }],
  roleSlots: [
    { id: 'planner', name: 'Planner', required: true, description: 'Plans' },
    { id: 'builder', name: 'Builder', required: true, description: 'Builds' },
  ],
  nodes: [
    {
      kind: 'agent_task', id: 'plan', name: 'Plan', roleSlotId: 'planner', objective: 'Plan',
      inputKeys: ['objective'], upstreamArtifacts: [], output: { key: 'plan', kind: 'markdown' },
      evidenceRequired: [], humanAcceptance: false, leaseSeconds: 300, maxExecutionSeconds: 3600,
      retryBudget: 1, repairBudget: 1, skippable: false,
      todos: [{ id: 'plan', name: 'Plan', required: true, evidenceKinds: [] }],
    },
    {
      kind: 'agent_task', id: 'build', name: 'Build', roleSlotId: 'builder', objective: 'Build',
      inputKeys: [], upstreamArtifacts: [{ key: 'plan', required: true }], output: { key: 'build', kind: 'markdown' },
      evidenceRequired: [], humanAcceptance: false, leaseSeconds: 300, maxExecutionSeconds: 3600,
      retryBudget: 1, repairBudget: 1, skippable: true,
      todos: [{ id: 'build', name: 'Build', required: true, evidenceKinds: [] }],
    },
  ],
  dependencies: [{ from: 'plan', to: 'build', mode: 'all' }],
  terminalNodeIds: ['build'],
};
const template = { id: 'template-1', version: 4, system: false, spaceId: 'space-1', archivedAt: null, definition };
const bindings = [
  { id: 'binding-1', runId: 'run-1', roleSlotId: 'planner', roleSlotName: 'Planner', agentId: 'agent-a' },
  { id: 'binding-2', runId: 'run-1', roleSlotId: 'builder', roleSlotName: 'Builder', agentId: 'agent-b' },
];
const draft = {
  id: 'run-1', spaceId: 'space-1', templateId: 'template-1', templateVersion: 4,
  templateSnapshot: {}, snapshotHash: '0'.repeat(64), name: 'Release 1', status: 'draft', version: 1,
  inputs: { objective: 'Ship feature' }, startedById: 'user-1', roleBindings: bindings,
};
const ready = { ...draft, status: 'ready', version: 2 };
const grant = (agentId: string, role: 'reader' | 'editor' | 'publisher' = 'editor', status = 'active') => ({
  id: `grant-${agentId}`, agentId, spaceId: 'space-1', role,
  agent: { id: agentId, status, revokedAt: null }, space: { deletedAt: null },
});

function projectSelect(value: any, select: Record<string, any>): any {
  return Object.fromEntries(Object.entries(select).map(([key, selection]) => {
    const child = value[key];
    if (selection === true || child == null) return [key, child];
    const childSelect = selection.select;
    if (Array.isArray(child)) return [key, child.map((item) => projectSelect(item, childSelect))];
    return [key, projectSelect(child, childSelect)];
  }));
}

describe('RunService', () => {
  const tx = {
    collaborationTemplate: { findFirst: jest.fn() },
    collaborationRun: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
    collaborationRoleBinding: { createMany: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    collaborationRunTask: { createMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    collaborationTaskTodo: { createMany: jest.fn() },
    collaborationTaskDependency: { createMany: jest.fn() },
    collaborationTaskAttempt: { updateMany: jest.fn() },
    collaborationTaskArtifact: { updateMany: jest.fn() },
    agentGrant: { findMany: jest.fn(), findUnique: jest.fn() },
  } as any;
  const prisma = { ...tx, $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)) } as any;
  const authorization = { assertSpaceAccess: jest.fn(), assertLiveHumanSpaceAccess: jest.fn() } as any;
  const events = {
    executeIdempotent: jest.fn(async (_tx: any, _scope: any, mutation: () => unknown) => mutation()),
  } as any;
  const progression = { advanceRun: jest.fn() } as any;
  const notifications = { publishCurrentRun: jest.fn() } as any;
  let service: RunService;

  beforeEach(() => {
    jest.clearAllMocks();
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'editor' });
    authorization.assertLiveHumanSpaceAccess.mockResolvedValue({ role: 'editor', userId: 'user-1', spaceId: 'space-1' });
    tx.collaborationTemplate.findFirst.mockResolvedValue(template);
    tx.collaborationRun.create.mockResolvedValue(draft);
    tx.collaborationRun.findUnique.mockResolvedValue({ ...ready, tasks: [], dependencies: [], reviews: [], events: [], roleBindings: bindings });
    tx.collaborationRun.update.mockResolvedValue({ ...ready, status: 'running', version: 3 });
    tx.collaborationRun.updateMany.mockResolvedValue({ count: 1 });
    tx.collaborationRoleBinding.findMany.mockResolvedValue(bindings);
    tx.agentGrant.findMany.mockResolvedValue([grant('agent-a'), grant('agent-b')]);
    tx.collaborationRunTask.updateMany.mockResolvedValue({ count: 1 });
    tx.collaborationTaskAttempt.updateMany.mockResolvedValue({ count: 1 });
    service = new RunService(prisma, authorization, events, progression, notifications);
  });

  it('persists an optimistic draft', async () => {
    const result = await service.createDraft('space-1', {
      templateId: 'template-1', name: 'Release 1', inputs: { objective: 'Ship feature' },
      roleBindings: [{ roleSlotId: 'planner', agentId: 'agent-a' }, { roleSlotId: 'builder', agentId: 'agent-b' }],
    }, humanPrincipal);
    expect(result).toMatchObject({ status: 'draft', version: 1 });
    expect(tx.collaborationRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'draft', version: 1, startedById: 'user-1' }),
    }));
    expect(tx.collaborationRoleBinding.createMany).toHaveBeenCalled();
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledWith(
      tx, humanPrincipal, 'space-1', ['owner', 'admin', 'editor'],
    );
  });

  it('persists step-one input as an incomplete draft before Agent mapping', async () => {
    const result = await service.createDraft('space-1', {
      templateId: 'template-1', name: 'Release 1', inputs: { objective: 'Ship feature' }, roleBindings: [],
    }, humanPrincipal);
    expect(result).toMatchObject({ status: 'draft', version: 1 });
    expect(tx.collaborationRoleBinding.createMany).not.toHaveBeenCalled();
  });

  it('reopens a ready draft for editing without creating a second run', async () => {
    tx.collaborationRun.findFirst.mockResolvedValue(ready);
    tx.collaborationRun.findUnique.mockResolvedValue({ ...ready, status: 'draft', version: 3 });

    await service.updateDraft('space-1', 'run-1', {
      expectedVersion: 2, name: 'Revised release', inputs: { objective: 'Ship safely' },
    }, humanPrincipal);

    expect(tx.collaborationRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'run-1', status: { in: ['draft', 'ready'] }, version: 2 }),
      data: expect.objectContaining({ status: 'draft', name: 'Revised release', version: { increment: 1 } }),
    }));
  });

  it('validates fresh grants then freezes and expands the ready run on start', async () => {
    tx.collaborationRun.findFirst.mockResolvedValueOnce({ id: 'run-1' }).mockResolvedValueOnce(ready);
    const result = await service.startRun('space-1', 'run-1', {
      expectedVersion: 2, idempotencyKey: 'start-run-0001',
    }, humanPrincipal);
    expect(result).toMatchObject({ id: 'run-1' });
    expect(tx.collaborationRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        templateVersion: 4, snapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/u), status: 'running',
      }),
    }));
    expect(tx.collaborationRunTask.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ nodeId: 'plan', status: 'ready', generation: 1 }),
        expect.objectContaining({ nodeId: 'build', status: 'blocked', generation: 1 }),
      ]),
    }));
    expect(tx.collaborationTaskTodo.createMany).toHaveBeenCalled();
    expect(tx.collaborationTaskDependency.createMany).toHaveBeenCalled();
  });

  it.each([
    ['inactive Agent', [grant('agent-a', 'editor', 'inactive'), grant('agent-b')], 'COLLABORATION_AGENT_INACTIVE'],
    ['reader Agent', [grant('agent-a', 'reader'), grant('agent-b')], 'COLLABORATION_AGENT_CANNOT_EXECUTE'],
  ] as const)('rejects %s during fresh validation', async (_label, grants, code) => {
    tx.collaborationRun.findFirst.mockResolvedValue(draft);
    tx.agentGrant.findMany.mockResolvedValue(grants);
    await expect(service.validateDraft('space-1', 'run-1', { expectedVersion: 1 }, humanPrincipal))
      .rejects.toMatchObject({ businessCode: code });
  });

  it('allows the starter to pause but only Owner/Admin to skip, fail, or cancel', async () => {
    const running = { ...ready, status: 'running', startedById: 'starter-1' };
    prisma.collaborationRun.findUnique.mockResolvedValue(running);
    tx.collaborationRun.findUnique.mockResolvedValue({ ...running, tasks: [], dependencies: [], reviews: [], events: [], roleBindings: bindings });
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'editor' });
    await expect(service.pauseRun('run-1', { reason: 'maintenance', idempotencyKey: 'pause-run-1' }, starterPrincipal)).resolves.toBeDefined();
    await expect(service.skipTask('run-1', 'task-1', { reason: 'not needed', idempotencyKey: 'skip-task-1' }, starterPrincipal))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_HUMAN_PERMISSION_DENIED' });
  });

  it('rejects a control replay when the starter was downgraded before the serializable transaction', async () => {
    const running = { ...ready, status: 'running', startedById: 'starter-1' };
    tx.collaborationRun.findUnique.mockResolvedValue(running);
    authorization.assertLiveHumanSpaceAccess.mockResolvedValue({ role: 'viewer', userId: 'starter-1', spaceId: 'space-1' });

    await expect(service.failRun(
      'run-1',
      { reason: 'force stop', idempotencyKey: 'fail-after-downgrade-1' },
      starterPrincipal,
    )).rejects.toMatchObject({ businessCode: 'COLLABORATION_HUMAN_PERMISSION_DENIED' });
    expect(events.executeIdempotent).not.toHaveBeenCalled();
  });

  it('revalidates the live human before a start idempotency replay', async () => {
    authorization.assertLiveHumanSpaceAccess.mockRejectedValueOnce(new BusinessException('SPACE_ACCESS_DENIED'));

    await expect(service.startRun('space-1', 'run-1', {
      expectedVersion: 2,
      idempotencyKey: 'start-revoked-human-1',
    }, humanPrincipal)).rejects.toMatchObject({ businessCode: 'COLLABORATION_HUMAN_PERMISSION_DENIED' });
    expect(events.executeIdempotent).not.toHaveBeenCalled();
  });

  it('makes active current-generation tasks reclaimable when pausing without replacing their Todo history', async () => {
    const running = { ...ready, status: 'running', startedById: 'starter-1' };
    prisma.collaborationRun.findUnique.mockResolvedValue(running);
    tx.collaborationRun.findUnique.mockResolvedValue({
      ...running, tasks: [], dependencies: [], reviews: [], events: [], roleBindings: bindings,
    });
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'editor' });

    await service.pauseRun(
      'run-1',
      { reason: 'maintenance', idempotencyKey: 'pause-active-run-1' },
      starterPrincipal,
    );

    expect(tx.collaborationTaskAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ runId: 'run-1', status: { in: ['claimed', 'running'] } }),
      data: expect.objectContaining({ status: 'invalidated' }),
    }));
    expect(tx.collaborationRunTask.updateMany).toHaveBeenCalledWith({
      where: { runId: 'run-1', status: { in: ['claimed', 'running'] } },
      data: { status: 'ready', nextAttemptAt: null },
    });
    expect(tx.collaborationTaskTodo.createMany).not.toHaveBeenCalled();
  });

  it('reassigns an executable Agent, invalidates the old lease, and keeps Role Bindings immutable', async () => {
    const running = { ...ready, status: 'running', startedById: 'starter-1' };
    prisma.collaborationRun.findUnique.mockResolvedValue(running);
    tx.collaborationRun.findUnique.mockResolvedValue({ ...running, tasks: [], dependencies: [], reviews: [], events: [], roleBindings: bindings });
    tx.collaborationRunTask.findFirst.mockResolvedValue({ id: 'task-1', runId: 'run-1', assigneeAgentId: 'agent-old', status: 'running' });
    tx.agentGrant.findMany.mockResolvedValue([grant('agent-new')]);
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'owner' });
    await service.reassignTask('run-1', 'task-1', {
      agentId: 'agent-new', reason: 'handoff', idempotencyKey: 'reassign-0001',
    }, starterPrincipal);
    expect(tx.collaborationTaskAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ taskId: 'task-1', status: { in: ['claimed', 'running'] } }),
      data: expect.objectContaining({ status: 'invalidated' }),
    }));
    expect(tx.collaborationRunTask.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { assigneeAgentId: 'agent-new', status: 'ready', nextAttemptAt: null },
    }));
    expect(tx.collaborationRoleBinding.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['ready', null],
    ['retry_wait', new Date('2026-08-24T08:00:00.000Z')],
    ['failed', new Date('2026-08-24T09:00:00.000Z')],
  ] as const)('reassigns a %s task without changing its recovery state or schedule', async (status, nextAttemptAt) => {
    const running = { ...ready, status: 'running', startedById: 'starter-1' };
    prisma.collaborationRun.findUnique.mockResolvedValue(running);
    tx.collaborationRun.findUnique.mockResolvedValue({
      ...running, tasks: [], dependencies: [], reviews: [], events: [], roleBindings: bindings,
    });
    tx.collaborationRunTask.findFirst.mockResolvedValue({
      id: 'task-1', runId: 'run-1', assigneeAgentId: 'agent-old', status, nextAttemptAt,
    });
    tx.agentGrant.findMany.mockResolvedValue([grant('agent-new')]);
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'owner' });

    await service.reassignTask('run-1', 'task-1', {
      agentId: 'agent-new', reason: 'handoff', idempotencyKey: `reassign-${status}`,
    }, starterPrincipal);

    expect(tx.collaborationRunTask.update).toHaveBeenCalledWith({
      where: { id: 'task-1' }, data: { assigneeAgentId: 'agent-new' },
    });
  });

  it.each(['submitted', 'completed', 'skipped'] as const)(
    'rejects reassignment after a task reaches %s',
    async (status) => {
      const running = { ...ready, status: 'waiting_review', startedById: 'starter-1' };
      prisma.collaborationRun.findUnique.mockResolvedValue(running);
      tx.collaborationRun.findUnique.mockResolvedValue({ ...running, templateSnapshot: definition });
      tx.collaborationRunTask.findFirst.mockResolvedValue({
        id: 'task-1', runId: 'run-1', assigneeAgentId: 'agent-old', status,
      });
      authorization.assertSpaceAccess.mockResolvedValue({ role: 'owner' });

      await expect(service.reassignTask('run-1', 'task-1', {
        agentId: 'agent-new', reason: 'too late', idempotencyKey: 'reassign-0002',
      }, starterPrincipal)).rejects.toMatchObject({ businessCode: 'COLLABORATION_PROGRESS_INVARIANT' });
      expect(tx.collaborationRunTask.update).not.toHaveBeenCalled();
    },
  );

  it.each(['submitted', 'completed', 'skipped'] as const)(
    'rejects skipping a %s task because terminal task state is authoritative',
    async (status) => {
      const waiting = { ...ready, status: 'waiting_review', startedById: 'starter-1' };
      prisma.collaborationRun.findUnique.mockResolvedValue(waiting);
      tx.collaborationRun.findUnique.mockResolvedValue({ ...waiting, templateSnapshot: definition });
      tx.collaborationRunTask.findFirst.mockResolvedValue({
        id: 'task-1', runId: 'run-1', status, skippable: true,
      });
      authorization.assertSpaceAccess.mockResolvedValue({ role: 'owner' });
      authorization.assertLiveHumanSpaceAccess.mockResolvedValue({ role: 'owner', userId: 'starter-1', spaceId: 'space-1' });

      await expect(service.skipTask('run-1', 'task-1', {
        reason: 'too late', idempotencyKey: 'skip-task-0002',
      }, starterPrincipal)).rejects.toMatchObject({ businessCode: 'COLLABORATION_PROGRESS_INVARIANT' });
      expect(tx.collaborationRunTask.update).not.toHaveBeenCalled();
    },
  );

  it('rejects a run that does not belong to the route Space', async () => {
    prisma.collaborationRun.findUnique.mockResolvedValue({ ...ready, status: 'running', startedById: 'starter-1' });
    await expect(service.pauseRun(
      'run-1',
      { reason: 'maintenance', idempotencyKey: 'pause-run-1' },
      starterPrincipal,
      'space-other',
    )).rejects.toMatchObject({ businessCode: 'RESOURCE_NOT_FOUND' });
    expect(authorization.assertSpaceAccess).not.toHaveBeenCalled();
  });

  it('merges duplicate Agent bindings into one join instruction', async () => {
    tx.collaborationRun.findFirst.mockResolvedValue(ready);
    tx.collaborationRun.findUnique.mockResolvedValue({
      ...ready,
      roleBindings: [bindings[0], { ...bindings[1], agentId: 'agent-a' }],
      tasks: [{ id: 'task-1', assigneeAgentId: 'agent-a' }],
      dependencies: [], reviews: [], events: [],
    });
    const result = await service.getHumanRun('space-1', 'run-1', humanPrincipal);
    expect(result.joinInstructions).toEqual([{
      agentId: 'agent-a', roleSlotIds: ['planner', 'builder'], taskIds: ['task-1'],
    }]);
  });

  it('loads an explicit human DTO without event response or Attempt lease internals', async () => {
    const unsafeRun = {
      ...ready,
      roleBindings: bindings,
      tasks: [{
        id: 'task-1', assigneeAgentId: 'agent-a', ordinal: 0,
        todos: [], artifacts: [],
        attempts: [{
          id: 'attempt-1', runId: 'run-1', taskId: 'task-1', generation: 1,
          agentId: 'agent-a', attemptNumber: 1, status: 'running',
          claimIdempotencyKey: 'claim-secret', leaseTokenHash: 'lease-hash-secret',
        }],
      }],
      dependencies: [], reviews: [],
      events: [{
        id: 'event-1', runId: 'run-1', sequence: 1, type: 'collaboration.pause_run',
        actorKind: 'human', actorId: 'starter-1', actorUserId: 'starter-1', actorAgentId: null,
        operation: 'pause_run', target: 'run-1', metadata: {}, createdAt: new Date(),
        idempotencyKey: 'pause-secret', requestHash: 'request-hash-secret',
        response: { events: [{ response: { nested: true } }] },
      }],
    };
    tx.collaborationRun.findFirst.mockResolvedValue(ready);
    tx.collaborationRun.findUnique.mockImplementationOnce(async (args: any) =>
      args.select ? projectSelect(unsafeRun, args.select) : structuredClone(unsafeRun));

    const result = await service.getHumanRun('space-1', 'run-1', humanPrincipal);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('response');
    expect(serialized).not.toContain('requestHash');
    expect(serialized).not.toContain('idempotencyKey');
    expect(serialized).not.toContain('leaseTokenHash');
    expect(serialized).not.toContain('claimIdempotencyKey');
    expect(result.tasks[0].attempts[0]).toMatchObject({ id: 'attempt-1', status: 'running' });
  });

  it('stores bounded human control receipts and reloads the authoritative safe run on replay', async () => {
    const authoritative: any = {
      ...ready, status: 'running', startedById: 'starter-1', eventSequence: 0,
      roleBindings: bindings, tasks: [], dependencies: [], reviews: [], events: [],
    };
    const stored = new Map<string, unknown>();
    const receiptEvents = {
      executeIdempotent: jest.fn(async (_tx: any, scope: any, mutation: () => Promise<unknown>) => {
        if (stored.has(scope.key)) {
          return scope.replayResponse ? scope.replayResponse() : structuredClone(stored.get(scope.key));
        }
        const response = await mutation();
        const storedResponse = scope.responseForStorage ? scope.responseForStorage(response) : structuredClone(response);
        stored.set(scope.key, storedResponse);
        authoritative.events.push({
          id: `event-${authoritative.events.length + 1}`,
          runId: 'run-1', sequence: authoritative.events.length + 1, type: `collaboration.${scope.operation}`,
          actorKind: scope.actorKind, actorId: scope.actorId, operation: scope.operation, target: scope.target,
          actorUserId: scope.actorUserId, actorAgentId: null, metadata: scope.metadata ?? {},
          idempotencyKey: scope.key, requestHash: scope.requestHash, response: structuredClone(storedResponse),
          createdAt: new Date(),
        });
        return response;
      }),
    } as any;
    const projectingFindUnique = jest.fn(async (args: any) =>
      args.select ? projectSelect(authoritative, args.select) : structuredClone(authoritative));
    const receiptTx = {
      ...tx,
      collaborationRun: {
        ...tx.collaborationRun,
        findUnique: projectingFindUnique,
        update: jest.fn(async ({ data }: any) => {
          Object.assign(authoritative, data);
          return structuredClone(authoritative);
        }),
      },
    } as any;
    const receiptPrisma = {
      ...receiptTx,
      $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(receiptTx)),
    } as any;
    const receiptService = new RunService(receiptPrisma, authorization, receiptEvents, progression, notifications);
    const input = { reason: 'maintenance', idempotencyKey: 'pause-bounded-1' };

    const first = await receiptService.pauseRun('run-1', input, starterPrincipal);
    await receiptService.resumeRun('run-1', { reason: 'continue', idempotencyKey: 'resume-bounded-1' }, starterPrincipal);
    await receiptService.pauseRun('run-1', { reason: 'maintenance again', idempotencyKey: 'pause-bounded-2' }, starterPrincipal);
    authoritative.eventSequence = 7;
    const replay = await receiptService.pauseRun('run-1', input, starterPrincipal);

    expect(first.status).toBe('paused');
    expect([...stored.values()]).toEqual([
      { runId: 'run-1' },
      { runId: 'run-1' },
      { runId: 'run-1' },
    ]);
    expect(JSON.stringify([...stored.values()])).not.toContain('events');
    expect(replay.eventSequence).toBe(7);
  });

  it('retries into a fresh generation with new Todo rows and superseded current Artifacts', async () => {
    const paused = {
      ...ready, status: 'paused', startedById: 'starter-1', pauseReason: 'task_failed',
      templateSnapshot: definition, roleBindings: bindings, tasks: [], dependencies: [], reviews: [], events: [],
    };
    prisma.collaborationRun.findUnique.mockResolvedValue(paused);
    tx.collaborationRun.findUnique.mockResolvedValue(paused);
    tx.collaborationRunTask.findFirst.mockResolvedValue({
      id: 'task-1', runId: 'run-1', nodeId: 'build', status: 'failed', generation: 1,
    });
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'editor' });
    await service.retryTask('run-1', 'task-1', {
      reason: 'fixed the runner', idempotencyKey: 'retry-task-001',
    }, starterPrincipal);
    expect(tx.collaborationRunTask.update).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { status: 'ready', generation: 2, nextAttemptAt: null, completedAt: null },
    });
    expect(tx.collaborationTaskTodo.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ taskId: 'task-1', generation: 2, templateId: 'build' })],
    }));
    expect(tx.collaborationTaskArtifact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'superseded' },
    }));
  });
});
