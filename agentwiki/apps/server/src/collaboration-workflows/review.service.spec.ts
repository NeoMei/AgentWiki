import type { Principal } from '../core/authorization/authorization.service';
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

describe('ReviewService', () => {
  const tasks = [
    { id: 'task-draft', runId: 'run-1', nodeId: 'draft', generation: 1, status: 'completed' },
    { id: 'task-polish', runId: 'run-1', nodeId: 'polish', generation: 1, status: 'submitted' },
    { id: 'task-publish', runId: 'run-1', nodeId: 'publish', generation: 1, status: 'blocked' },
  ];
  const tx = {
    collaborationRun: { findUnique: jest.fn(), update: jest.fn() },
    collaborationReview: { findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    collaborationTaskArtifact: { update: jest.fn(), updateMany: jest.fn() },
    collaborationRunTask: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    collaborationTaskAttempt: { updateMany: jest.fn() },
    collaborationTaskTodo: { createMany: jest.fn() },
  } as any;
  const prisma = { ...tx, $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)) } as any;
  const authorization = { assertSpaceAccess: jest.fn() } as any;
  const events = { executeIdempotent: jest.fn(async (_tx: any, _scope: any, mutation: () => unknown) => mutation()) } as any;
  const progression = { advanceRun: jest.fn() } as any;
  const notifications = { publishCurrentRun: jest.fn() } as any;
  let service: ReviewService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.collaborationRun.findUnique.mockResolvedValue(run);
    tx.collaborationReview.findFirst.mockResolvedValue(review);
    tx.collaborationReview.updateMany.mockResolvedValue({ count: 1 });
    tx.collaborationTaskArtifact.updateMany.mockResolvedValue({ count: 1 });
    tx.collaborationRunTask.findMany.mockResolvedValue(tasks);
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'editor' });
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

  it('approves the Artifact and source task then advances the run', async () => {
    await service.decide('space-1', 'run-1', 'review-1', {
      kind: 'approve', reason: 'accepted', idempotencyKey: 'approve-review-1',
    }, reviewer);
    expect(tx.collaborationTaskArtifact.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'accepted' }) }));
    expect(tx.collaborationRunTask.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }));
    expect(progression.advanceRun).toHaveBeenCalled();
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
