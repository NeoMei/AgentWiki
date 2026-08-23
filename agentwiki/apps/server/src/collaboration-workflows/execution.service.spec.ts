import { createHash } from 'node:crypto';
import type { Principal } from '../core/authorization/authorization.service';
import { ExecutionService } from './execution.service';

const agent: Principal = {
  userId: 'agent-user-a', agentId: 'agent-a', authorizationId: 'grant-a',
  credentialId: 'credential-a',
  authorizationSpaceId: 'space-1', agentRole: 'editor', scopes: ['collaboration:read', 'collaboration:execute'],
};
const run = {
  id: 'run-1', spaceId: 'space-1', status: 'running', inputs: { objective: 'Ship' },
  templateSnapshot: { roleSlots: [{ id: 'builder', name: 'Builder' }], nodes: [], dependencies: [] },
};
const task = {
  id: 'task-1', runId: 'run-1', nodeId: 'build', ordinal: 0, name: 'Build', objective: 'Build it',
  assigneeAgentId: 'agent-a', status: 'ready', generation: 1, leaseSeconds: 300, maxExecutionSeconds: 3600,
  retryBudget: 1, repairBudget: 1, requiredEvidence: [], outputContract: { key: 'result', kind: 'markdown' },
};

describe('ExecutionService', () => {
  const tx = {
    collaborationRun: { findUnique: jest.fn(), update: jest.fn() },
    collaborationRoleBinding: { findFirst: jest.fn(), findMany: jest.fn() },
    collaborationRunTask: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    collaborationTaskAttempt: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    collaborationTaskTodo: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    collaborationTaskArtifact: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    collaborationReview: { create: jest.fn(), findFirst: jest.fn() },
    agentGrant: { findUnique: jest.fn() },
  } as any;
  const prisma = { ...tx, $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)) } as any;
  const authorization = { assertSpaceAccess: jest.fn(), assertLiveAgentWriteAccess: jest.fn() } as any;
  const config = { get: jest.fn().mockReturnValue('execution-test-secret') } as any;
  const eventResponses = new Map<string, unknown>();
  const events = {
    findReplay: jest.fn(),
    executeIdempotent: jest.fn(async (_tx: any, scope: any, mutation: () => unknown) => {
      const cacheKey = `${scope.runId}:${scope.actorId}:${scope.operation}:${scope.key}`;
      if (eventResponses.has(cacheKey)) return eventResponses.get(cacheKey);
      const response = await mutation();
      eventResponses.set(cacheKey, response);
      return response;
    }),
  } as any;
  const artifacts = { validate: jest.fn() } as any;
  const progression = { advanceRun: jest.fn() } as any;
  const notifications = { publishCurrentRun: jest.fn() } as any;
  let service: ExecutionService;

  beforeEach(() => {
    jest.clearAllMocks();
    eventResponses.clear();
    tx.collaborationRun.findUnique.mockResolvedValue(run);
    tx.collaborationRoleBinding.findFirst.mockResolvedValue({ roleSlotId: 'builder', roleSlotName: 'Builder', agentId: 'agent-a' });
    tx.collaborationRoleBinding.findMany.mockResolvedValue([{ roleSlotId: 'builder', roleSlotName: 'Builder', agentId: 'agent-a' }]);
    tx.collaborationRunTask.findFirst.mockResolvedValue(task);
    tx.collaborationRunTask.findMany.mockResolvedValue([task]);
    tx.collaborationRunTask.updateMany.mockResolvedValue({ count: 1 });
    tx.collaborationTaskAttempt.findFirst.mockResolvedValue(null);
    tx.collaborationTaskAttempt.create.mockImplementation(async ({ data }: any) => ({ ...data }));
    tx.collaborationTaskTodo.findMany.mockResolvedValue([
      { id: 'todo-1', taskId: 'task-1', generation: 1, ordinal: 0, name: 'First', required: true, status: 'pending' },
      { id: 'todo-2', taskId: 'task-1', generation: 1, ordinal: 1, name: 'Second', required: true, status: 'pending' },
    ]);
    tx.collaborationTaskTodo.update.mockImplementation(async ({ where, data }: any) => ({
      id: where.id, ordinal: where.id === 'todo-1' ? 0 : 1, name: where.id === 'todo-1' ? 'First' : 'Second',
      required: true, status: data.status,
    }));
    tx.collaborationTaskArtifact.findMany.mockResolvedValue([]);
    events.findReplay.mockResolvedValue(undefined);
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'editor' });
    authorization.assertLiveAgentWriteAccess.mockResolvedValue(undefined);
    tx.agentGrant.findUnique.mockResolvedValue({
      id: 'grant-a', agentId: 'agent-a', spaceId: 'space-1', role: 'editor',
      agent: { status: 'active', revokedAt: null }, space: { deletedAt: null },
    });
    artifacts.validate.mockReturnValue({ valid: true, normalizedArtifact: { kind: 'markdown', markdown: 'done', evidence: [] }, issues: [] });
    service = new ExecutionService(prisma, authorization, config, events, artifacts, progression, notifications);
  });

  it('joins a bound Agent and rejects an unbound Agent', async () => {
    await expect(service.joinRun('run-1', agent)).resolves.toMatchObject({
      runId: 'run-1', roleSlots: [{ id: 'builder', name: 'Builder' }], protocol: expect.any(Object),
    });
    tx.collaborationRoleBinding.findFirst.mockResolvedValue(null);
    tx.collaborationRunTask.findFirst.mockResolvedValue(null);
    await expect(service.joinRun('run-1', { ...agent, agentId: 'agent-x' }))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_AGENT_NOT_BOUND' });
  });

  it('rejects a fresh reader Grant even if an earlier authorization result was executable', async () => {
    tx.agentGrant.findUnique.mockResolvedValue({
      id: 'grant-a', agentId: 'agent-a', spaceId: 'space-1', role: 'reader',
      agent: { status: 'active', revokedAt: null }, space: { deletedAt: null },
    });
    await expect(service.joinRun('run-1', agent))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_AGENT_CANNOT_EXECUTE' });
  });

  it('rechecks the exact live Credential inside the execution transaction', async () => {
    await service.nextAction({ runId: 'run-1', idempotencyKey: 'next-live-credential-1' }, agent);
    expect(authorization.assertLiveAgentWriteAccess).toHaveBeenCalledWith(
      tx, agent, 'space-1', ['collaboration:execute'],
    );
  });

  it('does not accept a completed reassignment as ongoing participation', async () => {
    tx.collaborationRoleBinding.findFirst.mockResolvedValue(null);
    tx.collaborationRunTask.findFirst.mockImplementation(async ({ where }: any) => {
      const completedAssignment = { ...task, status: 'completed' };
      return where.status?.notIn?.includes(completedAssignment.status) ? null : completedAssignment;
    });

    await expect(service.joinRun('run-1', agent))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_AGENT_NOT_BOUND' });
  });

  it('allows a bound reader to inspect safe run state but not join the execution loop', async () => {
    const reader = { ...agent, agentRole: 'reader' as const, scopes: ['collaboration:read'] };
    tx.agentGrant.findUnique.mockResolvedValue({
      id: 'grant-a', agentId: 'agent-a', spaceId: 'space-1', role: 'reader',
      agent: { status: 'active', revokedAt: null }, space: { deletedAt: null },
    });
    await expect(service.getAgentRun({ runId: 'run-1' }, reader)).resolves.toMatchObject({ runId: 'run-1' });
    await expect(service.joinRun('run-1', reader))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_AGENT_CANNOT_EXECUTE' });
  });

  it('claims one task, persists only the token hash, and never stores plaintext in the event response', async () => {
    const result = await service.nextAction({ runId: 'run-1', idempotencyKey: 'next-agent-a-1' }, agent);
    expect(result).toMatchObject({ action: 'execute_task', leaseToken: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(tx.collaborationTaskAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaseTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u), claimIdempotencyKey: 'next-agent-a-1' }),
    }));
    const scope = events.executeIdempotent.mock.calls[0][1];
    expect(scope.responseForStorage(result)).not.toHaveProperty('leaseToken');
  });

  it('converts repeated conditional-claim conflicts into a bounded recovery error', async () => {
    tx.collaborationRunTask.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.nextAction({ runId: 'run-1', idempotencyKey: 'next-agent-a-1' }, agent))
      .rejects.toMatchObject({ businessCode: 'COLLABORATION_PROGRESS_INVARIANT' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('rejects skipping a required earlier Todo and rejects an expired lease', async () => {
    const leaseToken = 'x'.repeat(64);
    const attempt = {
      id: 'attempt-1', runId: 'run-1', taskId: 'task-1', generation: 1, agentId: 'agent-a', status: 'running',
      claimIdempotencyKey: 'next-agent-a-1', leaseTokenHash: hashLease(leaseToken), leaseExpiresAt: new Date(Date.now() + 60_000),
      maxExecutionAt: new Date(Date.now() + 60_000), task: task,
    };
    tx.collaborationTaskAttempt.findUnique.mockResolvedValue(attempt);
    await expect(service.updateTodo({
      runId: 'run-1', attemptId: 'attempt-1', todoId: 'todo-2', leaseToken,
      status: 'done', evidence: [], idempotencyKey: 'todo-agent-a-01',
    }, agent)).rejects.toMatchObject({ businessCode: 'COLLABORATION_TODO_OUT_OF_ORDER' });
    tx.collaborationTaskAttempt.findUnique.mockResolvedValue({ ...attempt, leaseExpiresAt: new Date(Date.now() - 1) });
    await expect(service.heartbeat({
      runId: 'run-1', attemptId: 'attempt-1', leaseToken, idempotencyKey: 'heartbeat-agent-1',
    }, agent)).rejects.toMatchObject({ businessCode: 'COLLABORATION_LEASE_EXPIRED' });
  });

  it.each([
    ['heartbeat', async (leaseToken: string) => service.heartbeat({
      runId: 'run-1', attemptId: 'attempt-1', leaseToken, idempotencyKey: 'expired-heartbeat-replay-1',
    }, agent)],
    ['Todo', async (leaseToken: string) => service.updateTodo({
      runId: 'run-1', attemptId: 'attempt-1', todoId: 'todo-1', leaseToken,
      status: 'done', evidence: [], idempotencyKey: 'expired-todo-replay-1',
    }, agent)],
  ] as const)('rejects an exact %s replay after the active lease expires', async (_label, invoke) => {
    const leaseToken = 'b'.repeat(64);
    events.findReplay.mockResolvedValueOnce({ replayed: true });
    tx.collaborationTaskAttempt.findUnique.mockResolvedValue({
      id: 'attempt-1', runId: 'run-1', taskId: 'task-1', generation: 1, agentId: 'agent-a', status: 'running',
      claimIdempotencyKey: 'claim-1', leaseTokenHash: hashLease(leaseToken),
      leaseExpiresAt: new Date(Date.now() - 1), maxExecutionAt: new Date(Date.now() + 60_000), runTask: task,
    });

    await expect(invoke(leaseToken)).rejects.toMatchObject({ businessCode: 'COLLABORATION_LEASE_EXPIRED' });
  });

  it('returns the idempotent submission result and creates one Artifact version', async () => {
    const leaseToken = 'a'.repeat(64);
    const attempt = {
      id: 'attempt-1', runId: 'run-1', taskId: 'task-1', generation: 1, agentId: 'agent-a', status: 'running',
      claimIdempotencyKey: 'next-agent-a-1', leaseTokenHash: hashLease(leaseToken),
      leaseExpiresAt: new Date(Date.now() + 60_000), maxExecutionAt: new Date(Date.now() + 120_000), task,
    };
    tx.collaborationTaskAttempt.findUnique.mockResolvedValue(attempt);
    tx.collaborationTaskTodo.findMany.mockResolvedValue([
      { id: 'todo-1', taskId: 'task-1', generation: 1, ordinal: 0, name: 'First', required: true, status: 'done' },
    ]);
    tx.collaborationTaskArtifact.findFirst.mockResolvedValue(null);
    tx.collaborationTaskArtifact.create.mockResolvedValue({ id: 'artifact-1', version: 1, status: 'accepted' });
    tx.collaborationRunTask.update.mockResolvedValue({ ...task, status: 'completed' });
    const input = {
      runId: 'run-1', attemptId: 'attempt-1', leaseToken,
      artifact: { kind: 'markdown' as const, markdown: 'done', evidence: [] }, idempotencyKey: 'submit-agent-a1',
    };
    const first = await service.submitResult(input, agent);
    const second = await service.submitResult(input, agent);
    expect(second).toEqual(first);
    expect(tx.collaborationTaskArtifact.create).toHaveBeenCalledTimes(1);
    expect(events.executeIdempotent).toHaveBeenCalled();
  });

  it('returns a completed submission replay after run completion without reopening the Attempt', async () => {
    const leaseToken = 'c'.repeat(64);
    const receipt = {
      action: 'submitted', artifactId: 'artifact-1', version: 1,
      artifactStatus: 'accepted', taskStatus: 'completed', runStatus: 'completed', replayed: false,
    };
    tx.collaborationRun.findUnique.mockResolvedValue({ ...run, status: 'completed' });
    tx.collaborationTaskAttempt.findUnique.mockResolvedValue({
      id: 'attempt-1', runId: 'run-1', taskId: 'task-1', generation: 1, agentId: 'agent-a', status: 'completed',
      claimIdempotencyKey: 'claim-1', leaseTokenHash: hashLease(leaseToken),
      leaseExpiresAt: new Date(Date.now() - 1), maxExecutionAt: new Date(Date.now() - 1), runTask: { ...task, status: 'completed' },
    });
    events.findReplay.mockResolvedValue(receipt);

    await expect(service.submitResult({
      runId: 'run-1', attemptId: 'attempt-1', leaseToken,
      artifact: { kind: 'markdown', markdown: 'done', evidence: [] }, idempotencyKey: 'submit-completed-replay-1',
    }, agent)).resolves.toEqual(receipt);
    expect(tx.collaborationTaskAttempt.updateMany).not.toHaveBeenCalled();
    expect(tx.collaborationTaskArtifact.create).not.toHaveBeenCalled();
  });

  it('records one repair failure and does not consume the repair budget twice on replay', async () => {
    const leaseToken = 'a'.repeat(64);
    const attempt = {
      id: 'attempt-1', runId: 'run-1', taskId: 'task-1', generation: 1, agentId: 'agent-a', status: 'running',
      attemptNumber: 1, repairCount: 0, claimIdempotencyKey: 'next-agent-a-1', leaseTokenHash: hashLease(leaseToken),
      leaseExpiresAt: new Date(Date.now() + 60_000), maxExecutionAt: new Date(Date.now() + 120_000), task,
    };
    tx.collaborationTaskAttempt.findUnique.mockResolvedValue(attempt);
    tx.collaborationTaskTodo.findMany.mockResolvedValue([
      { id: 'todo-1', taskId: 'task-1', generation: 1, ordinal: 0, name: 'First', required: true, status: 'done' },
    ]);
    artifacts.validate.mockReturnValue({
      valid: false, issues: [{ code: 'ARTIFACT_KIND_MISMATCH', path: 'artifact.kind', message: 'wrong kind' }],
    });
    const input = {
      runId: 'run-1', attemptId: 'attempt-1', leaseToken,
      artifact: { kind: 'markdown' as const, markdown: 'bad', evidence: [] }, idempotencyKey: 'repair-agent-a1',
    };
    const first = await service.submitResult(input, agent);
    const second = await service.submitResult(input, agent);
    expect(first).toMatchObject({ action: 'repair_result', repairsRemaining: 0 });
    expect(second).toEqual(first);
    expect(tx.collaborationTaskAttempt.update).toHaveBeenCalledTimes(1);
    expect(tx.collaborationTaskArtifact.create).not.toHaveBeenCalled();
  });

  it('ends the live Attempt and moves an infrastructure failure into retry_wait', async () => {
    const leaseToken = 'a'.repeat(64);
    tx.collaborationTaskAttempt.findUnique.mockResolvedValue({
      id: 'attempt-1', runId: 'run-1', taskId: 'task-1', generation: 1, agentId: 'agent-a', status: 'running',
      attemptNumber: 1, repairCount: 0, claimIdempotencyKey: 'next-agent-a-1', leaseTokenHash: hashLease(leaseToken),
      leaseExpiresAt: new Date(Date.now() + 60_000), maxExecutionAt: new Date(Date.now() + 120_000), task,
    });
    await expect(service.updateTodo({
      runId: 'run-1', attemptId: 'attempt-1', todoId: 'todo-1', leaseToken,
      status: 'failed', summary: 'runner crashed', evidence: [], idempotencyKey: 'todo-failed-a01',
    }, agent)).resolves.toMatchObject({ taskStatus: 'retry_wait' });
    expect(tx.collaborationTaskAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', failureCode: 'todo_failed' }),
    }));
    expect(tx.collaborationRunTask.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'retry_wait', nextAttemptAt: expect.any(Date) }),
    }));
  });
});

function hashLease(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
