import { RecoveryWorker } from './recovery.worker';

const expired = {
  id: 'attempt-1', runId: 'run-1', taskId: 'task-1', generation: 1, agentId: 'agent-1',
  attemptNumber: 1, status: 'running', leaseExpiresAt: new Date(Date.now() - 1),
  runTask: {
    id: 'task-1', runId: 'run-1', generation: 1, status: 'running', assigneeAgentId: 'agent-1', retryBudget: 2,
    run: { id: 'run-1', spaceId: 'space-1', status: 'running' },
  },
};

describe('RecoveryWorker', () => {
  const tx = {
    collaborationTaskAttempt: { findUnique: jest.fn(), updateMany: jest.fn() },
    collaborationRunTask: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    collaborationRun: { update: jest.fn(), findUnique: jest.fn() },
    agentGrant: { findUnique: jest.fn() },
  } as any;
  const prisma = {
    ...tx,
    collaborationTaskAttempt: { ...tx.collaborationTaskAttempt, findMany: jest.fn() },
    $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)),
  } as any;
  const config = { get: jest.fn() } as any;
  const events = { executeIdempotent: jest.fn(async (_tx: any, _scope: any, mutation: () => unknown) => mutation()) } as any;
  const notifications = { publishRunChanged: jest.fn() } as any;
  let worker: RecoveryWorker;

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockImplementation((key: string) => key === 'PROCESS_ROLE' ? 'worker' : undefined);
    prisma.collaborationTaskAttempt.findMany.mockResolvedValue([expired]);
    tx.collaborationTaskAttempt.findUnique.mockResolvedValue(expired);
    tx.collaborationTaskAttempt.updateMany.mockResolvedValue({ count: 1 });
    tx.collaborationRunTask.findMany.mockResolvedValue([]);
    tx.agentGrant.findUnique.mockResolvedValue({
      id: 'grant-1', role: 'editor', agent: { status: 'active', revokedAt: null }, space: { deletedAt: null },
    });
    tx.collaborationRun.findUnique.mockResolvedValue({ eventSequence: 7 });
    prisma.collaborationRun.findUnique.mockResolvedValue({ spaceId: 'space-1', eventSequence: 8 });
    worker = new RecoveryWorker(prisma, config, events, notifications);
  });

  afterEach(() => worker.onModuleDestroy());

  it('enables polling only for worker/all process roles', async () => {
    config.get.mockImplementation((key: string) => key === 'PROCESS_ROLE' ? 'api' : undefined);
    await worker.onModuleInit();
    expect((worker as any).timer).toBeUndefined();
    expect(prisma.collaborationTaskAttempt.findMany).not.toHaveBeenCalled();
  });

  it('expires one live Attempt and schedules an infrastructure retry', async () => {
    await worker.tick();
    expect(tx.collaborationTaskAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'attempt-1', status: { in: ['claimed', 'running'] } }),
      data: expect.objectContaining({ status: 'expired' }),
    }));
    expect(tx.collaborationRunTask.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'retry_wait', nextAttemptAt: expect.any(Date) }),
    }));
    expect(notifications.publishRunChanged).toHaveBeenCalledWith('space-1', 'run-1', 8);
  });

  it('pauses after retry exhaustion and never marks the run failed automatically', async () => {
    tx.collaborationTaskAttempt.findUnique.mockResolvedValue({
      ...expired, attemptNumber: 3, runTask: { ...expired.runTask, retryBudget: 2 },
    });
    await worker.tick();
    expect(tx.collaborationRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'paused', pauseReason: 'retry_exhausted' }),
    }));
    expect(JSON.stringify(tx.collaborationRun.update.mock.calls)).not.toContain('"failed"');
  });

  it('pauses instead of releasing work after Agent authorization changes', async () => {
    tx.agentGrant.findUnique.mockResolvedValue({
      id: 'grant-1', role: 'reader', agent: { status: 'active', revokedAt: null }, space: { deletedAt: null },
    });
    await worker.tick();
    expect(tx.collaborationRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'paused', pauseReason: 'agent_authorization_changed' }),
    }));
    expect(tx.collaborationRunTask.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'retry_wait' }),
    }));
  });
});
