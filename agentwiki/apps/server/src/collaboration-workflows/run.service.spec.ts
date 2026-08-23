import type { Principal } from '../core/authorization/authorization.service';
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
  const authorization = { assertSpaceAccess: jest.fn() } as any;
  const events = {
    executeIdempotent: jest.fn(async (_tx: any, _scope: any, mutation: () => unknown) => mutation()),
  } as any;
  const progression = { advanceRun: jest.fn() } as any;
  const notifications = { publishCurrentRun: jest.fn() } as any;
  let service: RunService;

  beforeEach(() => {
    jest.clearAllMocks();
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'editor' });
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
  });

  it('persists step-one input as an incomplete draft before Agent mapping', async () => {
    const result = await service.createDraft('space-1', {
      templateId: 'template-1', name: 'Release 1', inputs: { objective: 'Ship feature' }, roleBindings: [],
    }, humanPrincipal);
    expect(result).toMatchObject({ status: 'draft', version: 1 });
    expect(tx.collaborationRoleBinding.createMany).not.toHaveBeenCalled();
  });

  it('validates fresh grants then freezes and expands the ready run on start', async () => {
    tx.collaborationRun.findFirst.mockResolvedValueOnce(ready);
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

  it('reassigns an executable Agent, invalidates the old lease, and keeps Role Bindings immutable', async () => {
    const running = { ...ready, status: 'running', startedById: 'starter-1' };
    prisma.collaborationRun.findUnique.mockResolvedValue(running);
    tx.collaborationRun.findUnique.mockResolvedValue({ ...running, tasks: [], dependencies: [], reviews: [], events: [], roleBindings: bindings });
    tx.collaborationRunTask.findFirst.mockResolvedValue({ id: 'task-1', runId: 'run-1', assigneeAgentId: 'agent-old', status: 'ready' });
    tx.agentGrant.findMany.mockResolvedValue([grant('agent-new')]);
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'owner' });
    await service.reassignTask('run-1', 'task-1', {
      agentId: 'agent-new', reason: 'handoff', idempotencyKey: 'reassign-0001',
    }, starterPrincipal);
    expect(tx.collaborationTaskAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ taskId: 'task-1', status: { in: ['claimed', 'running'] } }),
      data: expect.objectContaining({ status: 'invalidated' }),
    }));
    expect(tx.collaborationRunTask.update).toHaveBeenCalledWith(expect.objectContaining({ data: { assigneeAgentId: 'agent-new' } }));
    expect(tx.collaborationRoleBinding.updateMany).not.toHaveBeenCalled();
  });

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
