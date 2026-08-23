import type { Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { HistoryCursorService } from './history-cursor.service';
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
    collaborationTaskTodo: { createMany: jest.fn(), findMany: jest.fn() },
    collaborationTaskDependency: { createMany: jest.fn() },
    collaborationTaskAttempt: { updateMany: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    collaborationTaskArtifact: { updateMany: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    collaborationReview: { findMany: jest.fn() },
    collaborationRunEvent: { findMany: jest.fn() },
    agentGrant: { findMany: jest.fn(), findUnique: jest.fn() },
  } as any;
  const prisma = { ...tx, $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)) } as any;
  const authorization = { assertSpaceAccess: jest.fn(), assertLiveHumanSpaceAccess: jest.fn() } as any;
  const events = {
    executeIdempotent: jest.fn(async (_tx: any, _scope: any, mutation: () => unknown) => mutation()),
  } as any;
  const progression = { advanceRun: jest.fn() } as any;
  const notifications = { publishCurrentRun: jest.fn() } as any;
  const historyCursors = new HistoryCursorService({ get: jest.fn().mockReturnValue('run-service-history-test-pepper') } as any);
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
    tx.collaborationTaskTodo.findMany.mockResolvedValue([]);
    tx.collaborationTaskAttempt.findFirst.mockResolvedValue(null);
    tx.collaborationTaskArtifact.findFirst.mockResolvedValue(null);
    tx.collaborationReview.findMany.mockResolvedValue([]);
    tx.collaborationRunEvent.findMany.mockResolvedValue([]);
    service = new RunService(prisma, authorization, events, progression, notifications, historyCursors);
  });

  it('persists an optimistic draft', async () => {
    tx.collaborationRun.findUnique.mockResolvedValueOnce({
      ...draft, tasks: [], dependencies: [], roleBindings: bindings,
    });
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
    tx.collaborationRun.findUnique.mockResolvedValueOnce({
      ...draft, roleBindings: [], tasks: [], dependencies: [],
    });
    const result = await service.createDraft('space-1', {
      templateId: 'template-1', name: 'Release 1', inputs: { objective: 'Ship feature' }, roleBindings: [],
    }, humanPrincipal);
    expect(result).toMatchObject({ status: 'draft', version: 1 });
    expect(tx.collaborationRoleBinding.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown key', { objective: 'Ship feature', extra: 'not allowed' }],
    ['wrong type', { objective: 42 }],
    ['oversized UTF-8 value', { objective: '汉'.repeat(400_000) }],
  ])('rejects %s before creating a draft', async (_label, inputs) => {
    await expect(service.createDraft('space-1', {
      templateId: 'template-1', name: 'Release 1', inputs, roleBindings: [],
    }, humanPrincipal)).rejects.toMatchObject({ businessCode: 'COLLABORATION_TEMPLATE_INVALID' });
    expect(tx.collaborationRun.create).not.toHaveBeenCalled();
  });

  it('rejects invalid updated inputs before mutating the draft', async () => {
    tx.collaborationRun.findFirst.mockResolvedValue(ready);
    await expect(service.updateDraft('space-1', 'run-1', {
      expectedVersion: 2, inputs: { objective: false },
    }, humanPrincipal)).rejects.toMatchObject({ businessCode: 'COLLABORATION_TEMPLATE_INVALID' });
    expect(tx.collaborationRun.updateMany).not.toHaveBeenCalled();
  });

  it('reopens a ready draft for editing without creating a second run', async () => {
    tx.collaborationRun.findFirst.mockResolvedValue(ready);
    tx.collaborationRun.findUnique.mockResolvedValue({
      ...ready, status: 'draft', version: 3, tasks: [], dependencies: [], roleBindings: bindings,
    });

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

  it('keeps RoleBinding Agents but excludes terminal task-only assignees from join instructions', async () => {
    tx.collaborationRun.findFirst.mockResolvedValue(ready);
    tx.collaborationRun.findUnique.mockResolvedValue({
      ...ready,
      roleBindings: [bindings[0]],
      tasks: [
        { id: 'task-role-terminal', assigneeAgentId: 'agent-a', status: 'completed' },
        { id: 'task-alternate-terminal', assigneeAgentId: 'agent-alternate', status: 'skipped' },
        { id: 'task-active', assigneeAgentId: 'agent-active', status: 'ready' },
      ],
      dependencies: [], reviews: [], events: [],
    });

    const result = await service.getHumanRun('space-1', 'run-1', humanPrincipal);

    expect(result.joinInstructions).toEqual([
      { agentId: 'agent-a', roleSlotIds: ['planner'], taskIds: ['task-role-terminal'] },
      { agentId: 'agent-active', roleSlotIds: [], taskIds: ['task-active'] },
    ]);
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
    tx.collaborationTaskAttempt.findFirst.mockImplementation(async (args: any) =>
      projectSelect(unsafeRun.tasks[0].attempts[0], args.select));
    tx.collaborationRunEvent.findMany.mockResolvedValue([projectSelect(unsafeRun.events[0], {
      id: true, runId: true, sequence: true, type: true, actorKind: true, actorId: true,
      operation: true, target: true, actorUserId: true, actorAgentId: true, metadata: true, createdAt: true,
    })]);

    const result = await service.getHumanRun('space-1', 'run-1', humanPrincipal);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('response');
    expect(serialized).not.toContain('requestHash');
    expect(serialized).not.toContain('idempotencyKey');
    expect(serialized).not.toContain('leaseTokenHash');
    expect(serialized).not.toContain('claimIdempotencyKey');
    expect(result.tasks[0].attempts[0]).toMatchObject({ id: 'attempt-1', status: 'running' });
  });

  it('bounds the main human DTO to current-generation latest task records and newest events', async () => {
    const unsafeRun = {
      ...ready,
      roleBindings: bindings,
      tasks: [{
        id: 'task-1', assigneeAgentId: 'agent-a', ordinal: 0, generation: 2,
        todos: [
          { id: 'todo-old', taskId: 'task-1', generation: 1, ordinal: 0 },
          { id: 'todo-current', taskId: 'task-1', generation: 2, ordinal: 0, status: 'done', summary: 'private Todo summary', evidence: [{ secret: 'todo evidence' }] },
        ],
        attempts: [
          { id: 'attempt-old', generation: 1, attemptNumber: 9 },
          { id: 'attempt-current-old', generation: 2, attemptNumber: 1 },
          { id: 'attempt-current-latest', generation: 2, attemptNumber: 2 },
        ],
        artifacts: [
          { id: 'artifact-old', generation: 1, version: 9, payload: { markdown: 'old' } },
          { id: 'artifact-current-old', generation: 2, version: 1, payload: { markdown: 'v1' } },
          { id: 'artifact-current-latest', taskId: 'task-1', generation: 2, version: 2, kind: 'markdown', status: 'pending', payload: { markdown: 'private Artifact payload' }, evidence: [{ secret: 'artifact evidence' }], createdAt: new Date() },
        ],
      }],
      dependencies: [],
      reviews: [
        { id: 'review-old', nodeId: 'review', sourceTaskId: 'task-1', generation: 1, revision: 1 },
        { id: 'review-current', nodeId: 'review', sourceTaskId: 'task-1', generation: 2, revision: 2 },
      ],
      events: [{ id: 'event-1' }],
    };
    tx.collaborationRun.findFirst.mockResolvedValue(ready);
    tx.collaborationRun.findUnique.mockImplementationOnce(async (args: any) =>
      args.select ? projectSelect(unsafeRun, args.select) : structuredClone(unsafeRun));
    tx.collaborationTaskTodo.findMany.mockResolvedValue([unsafeRun.tasks[0].todos[1]]);
    tx.collaborationTaskAttempt.findFirst.mockResolvedValue(unsafeRun.tasks[0].attempts[2]);
    tx.collaborationTaskArtifact.findFirst.mockResolvedValue(unsafeRun.tasks[0].artifacts[2]);
    tx.collaborationReview.findMany.mockResolvedValue([unsafeRun.reviews[1]]);
    tx.collaborationRunEvent.findMany.mockResolvedValue(unsafeRun.events);

    const result = await service.getHumanRun('space-1', 'run-1', humanPrincipal);

    expect(result.events.map((item: any) => item.id)).toEqual(['event-1']);
    expect(result.tasks[0].todos.map((item: any) => item.id)).toEqual(['todo-current']);
    expect(result.tasks[0].todoCounts).toEqual({ total: 1, pending: 0, doing: 0, done: 1, failed: 0 });
    expect(result.tasks[0].attempts.map((item: any) => item.id)).toEqual(['attempt-current-latest']);
    expect(result.tasks[0].artifacts.map((item: any) => item.id)).toEqual(['artifact-current-latest']);
    expect(result.tasks[0].artifacts[0]).toMatchObject({ preview: 'markdown v2' });
    expect(result.reviews.map((item: any) => item.id)).toEqual(['review-current']);
    expect(JSON.stringify(result)).not.toContain('private Todo summary');
    expect(JSON.stringify(result)).not.toContain('todo evidence');
    expect(JSON.stringify(result)).not.toContain('private Artifact payload');
    expect(JSON.stringify(result)).not.toContain('artifact evidence');
  });

  it('keeps the maximum legal task/Todo shape within the aggregate main DTO byte budget', async () => {
    const tasks = Array.from({ length: 100 }, (_, taskIndex) => ({
      id: `task-${taskIndex}`, runId: 'run-1', nodeId: `node-${taskIndex}`, ordinal: taskIndex,
      name: `Task ${taskIndex}`, objective: '目'.repeat(16_000), roleSlotId: 'planner', assigneeAgentId: 'agent-a',
      status: 'running', generation: 1, dependencyMode: 'all', outputContract: { secret: 'contract' },
      requiredEvidence: ['test-log'], humanAcceptance: false, skippable: false, leaseSeconds: 300,
      maxExecutionSeconds: 3600, retryBudget: 1, repairBudget: 1, nextAttemptAt: null,
      completedAt: null, createdAt: new Date(), updatedAt: new Date(),
    }));
    const todos = tasks.flatMap((task) => Array.from({ length: 50 }, (_, ordinal) => ({
      id: `${task.id}-todo-${ordinal}`, runId: 'run-1', taskId: task.id, generation: 1, templateId: `todo-${ordinal}`,
      ordinal, name: `Todo ${ordinal} ${'事'.repeat(220)}`, required: true, status: 'pending',
      summary: '私'.repeat(1_000), evidence: [{ secret: '证'.repeat(100) }], updatedAt: new Date(),
    })));
    const hugeRun = { ...ready, roleBindings: bindings, tasks, dependencies: [] };
    tx.collaborationRun.findFirst.mockResolvedValue(ready);
    tx.collaborationRun.findUnique.mockImplementationOnce(async (args: any) => projectSelect(hugeRun, args.select));
    tx.collaborationTaskTodo.findMany.mockResolvedValue(todos);
    tx.collaborationTaskArtifact.findFirst.mockImplementation(async ({ where, select }: any) => projectSelect({
      id: `${where.taskId}-artifact`, runId: 'run-1', taskId: where.taskId, attemptId: 'attempt-1', generation: 1,
      version: 1, kind: 'markdown', status: 'pending', payload: { markdown: '密'.repeat(10_000) },
      evidence: [{ secret: '证'.repeat(1_000) }], acceptedAt: null, createdAt: new Date(),
    }, select));

    const result = await service.getHumanRun('space-1', 'run-1', humanPrincipal);
    const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');

    expect(bytes).toBeLessThanOrEqual(512_000);
    expect(result.tasks).toHaveLength(100);
    expect(result.tasks.every((task: any) => task.todos.length <= 3)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('私私私');
    expect(JSON.stringify(result)).not.toContain('密密密');
  });

  it('serves bounded editable draft details outside the main Run summary', async () => {
    tx.collaborationRun.findFirst.mockResolvedValue({
      id: 'run-1', name: 'Release 1', status: 'draft', version: 2,
      inputs: { objective: 'Ship safely' }, roleBindings: bindings, updatedAt: new Date(),
    });

    const result = await service.getHumanRunDraftDetails('space-1', 'run-1', humanPrincipal);

    expect(result).toMatchObject({ inputs: { objective: 'Ship safely' }, roleBindings: bindings });
    expect(tx.collaborationRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'run-1', spaceId: 'space-1', status: { in: ['draft', 'ready'] } },
      select: expect.not.objectContaining({ templateSnapshot: true, tasks: true, events: true }),
    }));
  });

  it('paginates historical detail with stable timestamp/id keysets and safe Attempt fields', async () => {
    tx.collaborationRun.findFirst.mockResolvedValue(ready);
    const tiedAt = new Date('2026-08-24T00:00:00.000Z');
    tx.collaborationTaskAttempt.findMany.mockResolvedValue([
      { id: 'attempt-c', status: 'completed', attemptNumber: 3, createdAt: tiedAt },
      { id: 'attempt-b', status: 'completed', attemptNumber: 2, createdAt: tiedAt },
      { id: 'attempt-a', status: 'completed', attemptNumber: 1, createdAt: tiedAt },
    ]);

    const page = await service.getHumanRunHistory(
      'space-1', 'run-1', 'attempts', undefined, '2', humanPrincipal,
    );

    expect(tx.collaborationTaskAttempt.findMany).toHaveBeenCalledWith({
      where: { runId: 'run-1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
      select: expect.not.objectContaining({ leaseTokenHash: true, claimIdempotencyKey: true }),
    });
    expect(page.items.map((item: any) => item.id)).toEqual(['attempt-c', 'attempt-b']);
    expect(page.nextCursor).toEqual(expect.any(String));

    tx.collaborationTaskAttempt.findMany.mockResolvedValue([]);
    await service.getHumanRunHistory('space-1', 'run-1', 'attempts', page.nextCursor!, '2', humanPrincipal);
    expect(tx.collaborationTaskAttempt.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: {
        runId: 'run-1',
        OR: [{ createdAt: { lt: tiedAt } }, { createdAt: tiedAt, id: { lt: 'attempt-b' } }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
    await expect(service.getHumanRunHistory(
      'space-1', 'run-1', 'events', undefined, '101', humanPrincipal,
    )).rejects.toMatchObject({ businessCode: 'COLLABORATION_HISTORY_QUERY_INVALID' });
  });

  it('reads old-generation Todo details and continues events beyond sequence 10,100', async () => {
    tx.collaborationRun.findFirst.mockResolvedValue(ready);
    const updatedAt = new Date('2026-08-23T23:00:00.000Z');
    tx.collaborationTaskTodo.findMany.mockResolvedValue([{
      id: 'todo-generation-1', runId: 'run-1', taskId: 'task-1', generation: 1, ordinal: 0,
      name: 'Old Todo', status: 'done', summary: 'complete historical summary', evidence: [{ kind: 'test-log' }], updatedAt,
    }]);
    const todoPage = await service.getHumanRunHistory('space-1', 'run-1', 'todos', undefined, '50', humanPrincipal);
    expect(todoPage.items[0]).toMatchObject({
      id: 'todo-generation-1', generation: 1, summary: 'complete historical summary', evidence: [{ kind: 'test-log' }],
    });
    expect(tx.collaborationTaskTodo.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { runId: 'run-1' }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 51,
    }));

    const eventCursor = historyCursors.encode({ kind: 'events', runId: 'run-1', position: { sequence: 10_100 } });
    tx.collaborationRunEvent.findMany.mockResolvedValue([]);
    await service.getHumanRunHistory('space-1', 'run-1', 'events', eventCursor, '100', humanPrincipal);
    expect(tx.collaborationRunEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { runId: 'run-1', sequence: { lt: 10_100 } }, orderBy: { sequence: 'desc' }, take: 101,
      select: expect.not.objectContaining({ idempotencyKey: true, requestHash: true }),
    }));

    await expect(service.getHumanRunHistory('space-1', 'run-1', 'reviews', eventCursor, '10', humanPrincipal))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_HISTORY_QUERY_INVALID' });
  });

  it('keeps an event traversal stable when newer events are inserted between pages', async () => {
    tx.collaborationRun.findFirst.mockResolvedValue(ready);
    const events = [105, 104, 103, 102].map((sequence) => ({
      id: `event-${sequence}`, runId: 'run-1', sequence, type: 'test', actorKind: 'system', actorId: 'system',
      operation: 'advance_run', target: 'run-1', actorUserId: null, actorAgentId: null,
      metadata: {}, response: null, createdAt: new Date(),
    }));
    tx.collaborationRunEvent.findMany.mockImplementation(async ({ where, take }: any) => events
      .filter((event) => where.sequence?.lt === undefined || event.sequence < where.sequence.lt)
      .sort((left, right) => right.sequence - left.sequence)
      .slice(0, take));

    const first = await service.getHumanRunHistory('space-1', 'run-1', 'events', undefined, '2', humanPrincipal);
    events.push({ ...events[0], id: 'event-106', sequence: 106 });
    const second = await service.getHumanRunHistory('space-1', 'run-1', 'events', first.nextCursor!, '2', humanPrincipal);

    expect([...first.items, ...second.items].map((event: any) => event.sequence)).toEqual([105, 104, 103, 102]);
  });

  it('authorizes every history page before reading rows', async () => {
    authorization.assertSpaceAccess.mockRejectedValueOnce(
      new BusinessException('SPACE_ACCESS_DENIED'),
    );

    await expect(service.getHumanRunHistory(
      'space-1', 'run-1', 'todos', undefined, '50', humanPrincipal,
    )).rejects.toMatchObject({ businessCode: 'COLLABORATION_HUMAN_PERMISSION_DENIED' });
    expect(tx.collaborationRun.findFirst).not.toHaveBeenCalled();
    expect(tx.collaborationTaskTodo.findMany).not.toHaveBeenCalled();
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
    const receiptService = new RunService(receiptPrisma, authorization, receiptEvents, progression, notifications, historyCursors);
    const input = { reason: 'maintenance', idempotencyKey: 'pause-bounded-1' };

    const first = await receiptService.pauseRun('run-1', input, starterPrincipal);
    await receiptService.resumeRun('run-1', { reason: 'continue', idempotencyKey: 'resume-bounded-1' }, starterPrincipal);
    await receiptService.pauseRun('run-1', { reason: 'maintenance again', idempotencyKey: 'pause-bounded-2' }, starterPrincipal);
    authoritative.eventSequence = 7;
    const replay = await receiptService.pauseRun('run-1', input, starterPrincipal);

    expect(first.status).toBe('paused');
    expect([...stored.values()]).toEqual([
      { runId: 'run-1', status: 'paused', version: 2 },
      { runId: 'run-1', status: 'running', version: 2 },
      { runId: 'run-1', status: 'paused', version: 2 },
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
