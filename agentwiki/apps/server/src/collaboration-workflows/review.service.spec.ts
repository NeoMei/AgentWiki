import type { Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { ReviewService } from './review.service';

const reviewer: Principal = { userId: 'reviewer-1' };
const agent: Principal = { userId: 'agent-user', agentId: 'agent-1' };
const snapshot = {
  nodes: [
    { kind: 'agent_task', id: 'draft', todos: [{ id: 'write', name: 'Write', required: true }] },
    { kind: 'agent_task', id: 'polish', todos: [{ id: 'polish', name: 'Polish', required: true }] },
    { kind: 'human_review', id: 'review', artifactTaskId: 'polish', revisionTaskId: 'draft' },
    { kind: 'agent_task', id: 'publish', todos: [{ id: 'publish', name: 'Publish', required: true }] },
  ],
  dependencies: [
    { from: 'draft', to: 'polish', mode: 'all' },
    { from: 'polish', to: 'review', mode: 'all' },
    { from: 'review', to: 'publish', mode: 'all' },
  ],
  terminalNodeIds: ['publish'],
};
const run = { id: 'run-1', spaceId: 'space-1', status: 'waiting_review', startedById: 'starter', pauseReason: null, templateSnapshot: snapshot };
const review = {
  id: 'review-1', runId: 'run-1', nodeId: 'review', status: 'pending', generation: 1,
  sourceTaskId: 'task-polish', revisionTaskId: 'task-draft', artifactId: 'artifact-1',
  minimumRole: 'editor', reviewerUserIds: [], allowTerminate: true,
};
const siblingReview = {
  ...review, id: 'review-2', nodeId: 'review-security', status: 'pending',
};

describe('ReviewService', () => {
  const tasks = [
    { id: 'task-draft', runId: 'run-1', nodeId: 'draft', generation: 1, status: 'completed' },
    { id: 'task-polish', runId: 'run-1', nodeId: 'polish', generation: 1, status: 'submitted' },
    { id: 'task-publish', runId: 'run-1', nodeId: 'publish', generation: 1, status: 'blocked' },
  ];
  const tx = {
    collaborationRun: { findUnique: jest.fn(), update: jest.fn() },
    collaborationReview: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    collaborationTaskArtifact: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    collaborationRunTask: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    collaborationTaskAttempt: { updateMany: jest.fn() },
    collaborationTaskTodo: { createMany: jest.fn() },
    spaceMember: { count: jest.fn() },
  } as any;
  const prisma = { ...tx, $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)) } as any;
  const authorization = { assertSpaceAccess: jest.fn(), assertLiveHumanSpaceAccess: jest.fn() } as any;
  const events = { executeIdempotent: jest.fn(async (_tx: any, _scope: any, mutation: () => unknown) => mutation()) } as any;
  const progression = { advanceRun: jest.fn() } as any;
  const notifications = { publishCurrentRun: jest.fn() } as any;
  let service: ReviewService;

  beforeEach(() => {
    jest.clearAllMocks();
    events.executeIdempotent.mockImplementation(async (_tx: any, _scope: any, mutation: () => unknown) => mutation());
    tx.collaborationRun.findUnique.mockResolvedValue(run);
    tx.collaborationReview.findFirst.mockResolvedValue(review);
    tx.collaborationReview.findMany.mockResolvedValue([{ ...review, status: 'approved' }]);
    tx.collaborationReview.updateMany.mockResolvedValue({ count: 1 });
    tx.collaborationTaskArtifact.updateMany.mockResolvedValue({ count: 1 });
    tx.collaborationTaskArtifact.findFirst.mockResolvedValue({ status: 'pending' });
    tx.spaceMember.count.mockResolvedValue(1);
    tx.collaborationRunTask.findMany.mockResolvedValue(tasks);
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'editor' });
    authorization.assertLiveHumanSpaceAccess.mockResolvedValue({ role: 'editor', userId: 'reviewer-1', spaceId: 'space-1' });
    service = new ReviewService(prisma, authorization, events, progression, notifications);
  });

  it('refuses an Agent principal and a human outside reviewer constraints', async () => {
    await expect(service.decide('space-1', 'run-1', 'review-1', {
      kind: 'approve', reason: 'looks good', idempotencyKey: 'approve-review-1',
    }, agent)).rejects.toMatchObject({ businessCode: 'HUMAN_AUTH_REQUIRED' });
    tx.collaborationReview.findFirst.mockResolvedValue({ ...review, reviewerUserIds: ['other-user'] });
    await expect(service.decide('space-1', 'run-1', 'review-1', {
      kind: 'approve', reason: 'looks good', idempotencyKey: 'approve-review-1',
    }, reviewer)).rejects.toMatchObject({ businessCode: 'COLLABORATION_REVIEWER_DENIED' });
  });

  it('rejects a replay after reviewer membership revocation inside the transaction', async () => {
    authorization.assertLiveHumanSpaceAccess.mockRejectedValueOnce(new BusinessException('SPACE_ACCESS_DENIED'));

    await expect(service.decide('space-1', 'run-1', 'review-1', {
      kind: 'approve', reason: 'looks good', idempotencyKey: 'approve-revoked-reviewer-1',
    }, reviewer)).rejects.toMatchObject({ businessCode: 'COLLABORATION_REVIEWER_DENIED' });
    expect(events.executeIdempotent).not.toHaveBeenCalled();
  });

  it('allows an owner to recover a Review only when every designated reviewer has left the Space', async () => {
    tx.collaborationReview.findFirst.mockResolvedValue({ ...review, reviewerUserIds: ['former-reviewer'] });
    authorization.assertLiveHumanSpaceAccess.mockResolvedValue({ role: 'owner', userId: 'reviewer-1', spaceId: 'space-1' });
    tx.spaceMember.count.mockResolvedValue(0);

    await expect(service.decide('space-1', 'run-1', 'review-1', {
      kind: 'approve', reason: 'owner recovery', idempotencyKey: 'approve-owner-recovery-1',
    }, reviewer)).resolves.toBeDefined();
    expect(events.executeIdempotent).toHaveBeenCalledWith(tx, expect.objectContaining({
      metadata: expect.objectContaining({ reviewerOverride: true }),
    }), expect.any(Function));
  });

  it('allows an owner to recover when designated reviewers remain members below the minimum role', async () => {
    tx.collaborationReview.findFirst.mockResolvedValue({ ...review, reviewerUserIds: ['viewer-reviewer'] });
    authorization.assertLiveHumanSpaceAccess.mockResolvedValue({ role: 'owner', userId: 'reviewer-1', spaceId: 'space-1' });
    tx.spaceMember.count.mockImplementation(async ({ where }: any) => where.role ? 0 : 1);

    await expect(service.decide('space-1', 'run-1', 'review-1', {
      kind: 'approve', reason: 'owner role recovery', idempotencyKey: 'approve-owner-role-recovery-1',
    }, reviewer)).resolves.toBeDefined();
    expect(tx.spaceMember.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ role: { in: ['editor', 'admin', 'owner'] } }),
    });
  });

  it('re-reads current reviewer constraints before returning an idempotent replay', async () => {
    tx.collaborationReview.findFirst.mockResolvedValue({ ...review, reviewerUserIds: ['other-user'] });
    events.executeIdempotent.mockResolvedValue({ id: 'run-1', status: 'running' });

    await expect(service.decide('space-1', 'run-1', 'review-1', {
      kind: 'approve', reason: 'looks good', idempotencyKey: 'approve-review-replay-1',
    }, reviewer)).rejects.toMatchObject({ businessCode: 'COLLABORATION_REVIEWER_DENIED' });
    expect(events.executeIdempotent).not.toHaveBeenCalled();
  });

  it('approves the Artifact and source task then advances the run', async () => {
    await service.decide('space-1', 'run-1', 'review-1', {
      kind: 'approve', reason: 'accepted', idempotencyKey: 'approve-review-1',
    }, reviewer);
    expect(tx.collaborationTaskArtifact.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'accepted' }) }));
    expect(tx.collaborationRunTask.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }));
    expect(progression.advanceRun).toHaveBeenCalled();
  });

  it('retries a serialization conflict while deciding a Review', async () => {
    prisma.$transaction
      .mockRejectedValueOnce({ code: 'P2010', meta: { code: '40001' } })
      .mockImplementation(async (callback: (value: any) => unknown) => callback(tx));

    await expect(service.decide('space-1', 'run-1', 'review-1', {
      kind: 'approve', reason: 'accepted', idempotencyKey: 'approve-serialization-1',
    }, reviewer)).resolves.toBeDefined();

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('keeps a shared Artifact pending until every Review is approved', async () => {
    tx.collaborationRun.findUnique.mockResolvedValue({
      ...run,
      templateSnapshot: {
        ...snapshot,
        nodes: [...snapshot.nodes, {
          kind: 'human_review', id: 'review-security', artifactTaskId: 'polish', revisionTaskId: 'draft',
        }],
      },
    });
    tx.collaborationReview.findMany.mockResolvedValue([
      { ...review, status: 'approved' }, siblingReview,
    ]);

    await service.decide('space-1', 'run-1', 'review-1', {
      kind: 'approve', reason: 'first approval', idempotencyKey: 'approve-review-group-1',
    }, reviewer);

    expect(tx.collaborationTaskArtifact.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'accepted' }),
    }));
    expect(tx.collaborationRunTask.update).not.toHaveBeenCalled();
    expect(progression.advanceRun).toHaveBeenCalled();
  });

  it('accepts a shared source only when the final matching Review is approved', async () => {
    tx.collaborationRun.findUnique.mockResolvedValue({
      ...run,
      templateSnapshot: {
        ...snapshot,
        nodes: [...snapshot.nodes, {
          kind: 'human_review', id: 'review-security', artifactTaskId: 'polish', revisionTaskId: 'draft',
        }],
      },
    });
    tx.collaborationReview.findFirst.mockResolvedValue(siblingReview);
    tx.collaborationTaskArtifact.findFirst.mockResolvedValue({ status: 'pending' });
    tx.collaborationReview.findMany.mockResolvedValue([
      { ...review, status: 'approved' }, { ...siblingReview, status: 'approved' },
    ]);

    await service.decide('space-1', 'run-1', 'review-2', {
      kind: 'approve', reason: 'final approval', idempotencyKey: 'approve-review-group-2',
    }, reviewer);

    expect(tx.collaborationTaskArtifact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'accepted' }),
    }));
    expect(tx.collaborationRunTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-polish' }, data: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('rejects for revision by creating new generations without deleting history', async () => {
    await service.decide('space-1', 'run-1', 'review-1', {
      kind: 'reject_for_revision', reason: 'missing evidence', idempotencyKey: 'reject-review-1',
    }, reviewer);
    expect(tx.collaborationTaskAttempt.updateMany).toHaveBeenCalled();
    expect(tx.collaborationTaskArtifact.updateMany).toHaveBeenCalled();
    expect(tx.collaborationRunTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-draft' }, data: expect.objectContaining({ generation: 2, status: 'ready' }),
    }));
    expect(tx.collaborationTaskTodo.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({ taskId: 'task-draft', generation: 2 })]),
    }));
    expect((tx.collaborationTaskArtifact as any).deleteMany).toBeUndefined();
    expect(tx.collaborationReview.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        runId: 'run-1', sourceTaskId: 'task-polish', generation: 1, id: { not: 'review-1' }, status: 'pending',
      }),
      data: expect.objectContaining({ status: 'superseded' }),
    }));
  });

  it('invalidates task branches downstream of every sibling Review when a shared source is rejected', async () => {
    const branchTask = { id: 'task-branch', runId: 'run-1', nodeId: 'branch', generation: 1, status: 'completed' };
    tx.collaborationRun.findUnique.mockResolvedValue({
      ...run,
      templateSnapshot: {
        nodes: [
          ...snapshot.nodes,
          { kind: 'human_review', id: 'review-security', artifactTaskId: 'polish', revisionTaskId: 'draft' },
          { kind: 'agent_task', id: 'branch', todos: [{ id: 'branch', name: 'Branch', required: true }] },
        ],
        dependencies: [
          ...snapshot.dependencies,
          { from: 'polish', to: 'review-security', mode: 'all' },
          { from: 'review', to: 'branch', mode: 'all' },
        ],
        terminalNodeIds: ['branch', 'publish'],
      },
    });
    tx.collaborationReview.findFirst.mockResolvedValue(siblingReview);
    tx.collaborationRunTask.findMany.mockResolvedValue([...tasks, branchTask]);

    await service.decide('space-1', 'run-1', 'review-2', {
      kind: 'reject_for_revision', reason: 'shared source is stale', idempotencyKey: 'reject-shared-review-2',
    }, reviewer);

    expect(tx.collaborationRunTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-branch' }, data: expect.objectContaining({ generation: 2, status: 'blocked' }),
    }));
  });

  it('rejects a stale source generation before accepting its Artifact', async () => {
    tx.collaborationRunTask.findMany.mockResolvedValue([
      tasks[0], { ...tasks[1], generation: 2 }, tasks[2],
    ]);
    await expect(service.decide('space-1', 'run-1', 'review-1', {
      kind: 'approve', reason: 'accepted', idempotencyKey: 'approve-review-1',
    }, reviewer)).rejects.toMatchObject({ businessCode: 'COLLABORATION_PROGRESS_INVARIANT' });
    expect(tx.collaborationTaskArtifact.updateMany).not.toHaveBeenCalled();
  });

  it('refuses terminate when the template gate disallows it', async () => {
    tx.collaborationReview.findFirst.mockResolvedValue({ ...review, allowTerminate: false });
    await expect(service.decide('space-1', 'run-1', 'review-1', {
      kind: 'terminate', reason: 'stop', idempotencyKey: 'terminate-review-1',
    }, reviewer)).rejects.toMatchObject({ businessCode: 'COLLABORATION_REVIEW_TERMINATE_DENIED' });
  });
});
