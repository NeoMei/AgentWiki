import { createHash } from 'node:crypto';
import type { Principal } from '../core/authorization/authorization.service';
import { PageResultService } from './page-result.service';
import {
  supersedePendingPagePublicationsLocked,
  supersedeRunPagePublicationsLocked,
} from './page-publication-invalidation';
import { ReviewService } from './review.service';

const principal: Principal = { userId: 'reviewer-1' };
const page = {
  id: 'page-1', spaceId: 'space-1', title: 'Human edit', content: '# Human current',
  authorId: 'reviewer-1', slug: 'human-edit', format: 'markdown', parentId: null,
  folderId: null, syncPath: 'pages/Human edit.md', syncPathKey: 'pages/human edit.md',
  updatedAt: new Date('2026-09-05T12:00:00.000Z'),
};
const hash = (value: string) => createHash('sha256').update(value.replace(/\r\n?/gu, '\n')).digest('hex');
const snapshot = {
  nodes: [
    { kind: 'agent_task', id: 'write', todos: [{ id: 'write', name: 'Write', required: true }] },
    { kind: 'human_review', id: 'review', artifactTaskId: 'write', revisionTaskId: 'write' },
  ],
  dependencies: [{ from: 'write', to: 'review', mode: 'all' }],
  terminalNodeIds: ['review'],
};
const run = {
  id: 'run-1', spaceId: 'space-1', status: 'waiting_review', startedById: 'reviewer-1',
  pauseReason: null, templateSnapshot: snapshot,
};
const task = {
  id: 'task-1', runId: 'run-1', nodeId: 'write', generation: 1, status: 'submitted',
  targetPageId: 'page-1', targetSpaceId: 'space-1', outputContract: { kind: 'markdown' },
};
const review = {
  id: 'review-1', runId: 'run-1', nodeId: 'review', status: 'pending', generation: 1,
  sourceTaskId: 'task-1', revisionTaskId: 'task-1', artifactId: 'artifact-old',
  minimumRole: 'editor', reviewerUserIds: [], allowTerminate: true,
};
const link = {
  artifact: { attempt: { agent: { id: 'agent-1', ownerId: 'owner-1' } } },
  changeSetId: 'change-set-1', artifactId: 'artifact-old', runId: 'run-1', taskId: 'task-1',
  spaceId: 'space-1', pageId: 'page-1',
};

describe('Page result conflict recovery', () => {
  const tx = {
    $queryRaw: jest.fn(),
    agentCredential: { findFirst: jest.fn().mockResolvedValue({ id: 'credential-1', authorizationId: 'grant-1' }) },
    collaborationRun: { findUnique: jest.fn(), update: jest.fn() },
    collaborationReview: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    collaborationTaskArtifact: { findFirst: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
    collaborationRunTask: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    collaborationTaskAttempt: { updateMany: jest.fn() },
    collaborationTaskTodo: { createMany: jest.fn() },
    collaborationArtifactChangeSetLink: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    changeSet: { updateMany: jest.fn() },
    changeItem: { updateMany: jest.fn() },
    page: { findFirst: jest.fn() },
    pageVersion: { findFirst: jest.fn(), create: jest.fn() },
    spaceMember: { count: jest.fn() },
  } as any;
  const prisma = { ...tx, $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)) } as any;
  const authorization = {
    lockLiveAgentWriteAccessAcrossSpaceBoundary: jest.fn(async (_tx, _principal, _spaceId, _scopes, lock) => lock()),
    lockLiveHumanPrincipal: jest.fn(),
    assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'editor', userId: 'reviewer-1', spaceId: 'space-1' }),
  } as any;
  const events = { findReplay: jest.fn(), executeIdempotent: jest.fn(async (_tx: any, _scope: any, mutation: () => unknown) => mutation()) } as any;
  const progression = { advanceRun: jest.fn() } as any;
  const notifications = { publishCurrentRun: jest.fn() } as any;
  const publication = {
    lockChangeSetSpace: jest.fn(async (value: any) => Object.assign(value, { contentTreeRevision: 3n })),
    publishLocked: jest.fn(),
    supersedeLocked: jest.fn(),
    runPostCommitEffects: jest.fn(),
  } as any;
  let service: ReviewService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.collaborationRun.findUnique.mockResolvedValue(run);
    tx.collaborationReview.findFirst.mockResolvedValue(review);
    tx.collaborationReview.findMany.mockResolvedValue([{ ...review, status: 'approved' }]);
    tx.collaborationRunTask.findMany.mockResolvedValue([task]);
    tx.collaborationRunTask.findFirst.mockResolvedValue(task);
    tx.collaborationTaskArtifact.findFirst.mockResolvedValue({
      id: 'artifact-old', status: 'pending', version: 1, attemptId: 'attempt-1', kind: 'markdown',
    });
    tx.collaborationArtifactChangeSetLink.findUnique.mockResolvedValue(link);
    tx.collaborationReview.updateMany.mockResolvedValue({ count: 1 });
    tx.collaborationTaskArtifact.updateMany.mockResolvedValue({ count: 1 });
    tx.page.findFirst.mockResolvedValue(page);
    tx.pageVersion.findFirst.mockResolvedValue(null);
    tx.pageVersion.create.mockResolvedValue({ id: 'version-current' });
    tx.collaborationTaskArtifact.create.mockResolvedValue({ id: 'artifact-adopted', version: 2 });
    tx.collaborationRunTask.findUnique.mockResolvedValue({ ...task, generation: 2 });
    tx.collaborationRunTask.updateMany.mockResolvedValue({ count: 1 });
    tx.collaborationArtifactChangeSetLink.findFirst.mockResolvedValue(link);
    tx.collaborationArtifactChangeSetLink.findMany.mockResolvedValue([
      { artifactId: 'artifact-old', changeSetId: 'change-set-1' },
      { artifactId: 'artifact-downstream', changeSetId: 'change-set-downstream' },
    ]);
    tx.changeSet.updateMany.mockResolvedValue({ count: 1 });
    tx.changeItem.updateMany.mockResolvedValue({ count: 1 });
    service = new ReviewService(
      prisma, authorization, events, progression, notifications, publication, new PageResultService(),
    );
  });

  it('commits a readable pause while leaving the Review pending, then maps the result to PAGE_VERSION_CONFLICT', async () => {
    publication.publishLocked.mockResolvedValue({
      kind: 'conflict', pageId: 'page-1', expectedPageVersionId: null,
      expectedContentHash: 'a'.repeat(64), currentContentHash: hash(page.content),
    });

    const error = await service.decide('space-1', 'run-1', 'review-1', {
      kind: 'approve', reason: 'approve', idempotencyKey: 'approve-conflict-1',
    }, principal).then(() => null, (caught) => caught);
    expect(error).toMatchObject({ businessCode: 'PAGE_VERSION_CONFLICT' });
    expect(error.getStatus()).toBe(409);

    expect(tx.collaborationReview.updateMany).not.toHaveBeenCalled();
    expect(tx.collaborationRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' }, data: { status: 'paused', pauseReason: 'page_version_conflict' },
    });
    expect(notifications.publishCurrentRun).toHaveBeenCalledWith('run-1');
  });

  it('still maps a committed conflict to PAGE_VERSION_CONFLICT when post-commit notification fails', async () => {
    publication.publishLocked.mockResolvedValue({
      kind: 'conflict', pageId: 'page-1', expectedPageVersionId: null,
      expectedContentHash: 'a'.repeat(64), currentContentHash: hash(page.content),
    });
    notifications.publishCurrentRun.mockRejectedValueOnce(new Error('redis unavailable'));
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    await expect(service.decide('space-1', 'run-1', 'review-1', {
      kind: 'approve', reason: 'approve', idempotencyKey: 'approve-conflict-notify-1',
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_VERSION_CONFLICT' });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      code: 'COLLABORATION_PAGE_CONFLICT_NOTIFICATION_FAILED', runId: 'run-1',
    }));
  });

  it('regenerates through the established review generation reset and supersedes the publication candidate', async () => {
    tx.collaborationRun.findUnique.mockResolvedValue({ ...run, status: 'paused', pauseReason: 'page_version_conflict' });
    await expect(service.resolvePageConflict('space-1', 'run-1', 'task-1', {
      kind: 'regenerate', expectedPageVersionId: null, expectedContentHash: hash(page.content),
      idempotencyKey: 'regenerate-page-1',
    }, principal)).resolves.toEqual({ kind: 'regenerate', taskId: 'task-1', generation: 2 });

    expect(publication.supersedeLocked).toHaveBeenCalledWith(expect.anything(), 'change-set-1', 'page_conflict_regenerate');
    expect(tx.collaborationTaskAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'invalidated' }),
    }));
    expect(tx.collaborationRunTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-1' }, data: expect.objectContaining({ generation: 2 }),
    }));
    expect(tx.collaborationArtifactChangeSetLink.findMany).toHaveBeenCalledWith({
      where: {
        runId: 'run-1', taskId: { in: ['task-1'] },
        changeSet: {
          origin: 'collaboration', status: { in: ['draft', 'pending_review', 'approved'] },
        },
      },
      select: { artifactId: true, changeSetId: true },
    });
  });

  it('adopts an exact immutable snapshot of current human content and never accepts the old Agent text', async () => {
    tx.collaborationRun.findUnique.mockResolvedValue({ ...run, status: 'paused', pauseReason: 'page_version_conflict' });
    await expect(service.resolvePageConflict('space-1', 'run-1', 'task-1', {
      kind: 'adopt_current', expectedPageVersionId: null, expectedContentHash: hash(page.content),
      idempotencyKey: 'adopt-current-1',
    }, principal)).resolves.toEqual({
      kind: 'adopt_current', taskId: 'task-1', generation: 1,
      artifactId: 'artifact-adopted', pageVersionId: 'version-current',
    });

    expect(tx.pageVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      pageId: 'page-1', title: 'Human edit', content: '# Human current',
    }) });
    expect(tx.collaborationTaskArtifact.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      status: 'accepted', kind: 'markdown', payload: expect.objectContaining({
        markdown: '# Human current', adoptedCurrentPage: expect.objectContaining({
          pageId: 'page-1', pageVersionId: 'version-current', adoptedByUserId: 'reviewer-1',
        }),
      }),
    }) });
    expect(tx.collaborationTaskArtifact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'artifact-old' }), data: { status: 'superseded' },
    }));
    expect(tx.collaborationReview.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'approved', artifactId: 'artifact-adopted' }),
    }));
    expect(publication.supersedeLocked).toHaveBeenCalledWith(expect.anything(), 'change-set-1', 'page_conflict_adopt_current');
  });
});

describe('pending Page publication lifecycle invalidation', () => {
  it('supersedes only linked ChangeSets without locking or rewriting Runs and Artifacts', async () => {
    const tx = {
      collaborationArtifactChangeSetLink: { findMany: jest.fn().mockResolvedValue([
        { changeSetId: 'change-set-1' }, { changeSetId: 'current-archive' },
      ]) },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      collaborationRun: { updateMany: jest.fn() },
      collaborationTaskArtifact: { updateMany: jest.fn() },
    } as any;

    await expect(supersedePendingPagePublicationsLocked(tx, {
      spaceId: 'space-1', pageIds: ['page-1'], excludeChangeSetId: 'current-archive',
    })).resolves.toBe(1);

    expect(tx.changeSet.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['change-set-1'] }, origin: 'collaboration',
        status: { in: ['draft', 'pending_review', 'approved'] },
      },
      data: { status: 'superseded' },
    });
    expect(tx.collaborationRun.updateMany).not.toHaveBeenCalled();
    expect(tx.collaborationTaskArtifact.updateMany).not.toHaveBeenCalled();
  });

  it('derives Artifact and Review invalidation only from still-pending publication candidates', async () => {
    const allLinks = [
      { artifactId: 'artifact-published', changeSetId: 'change-set-published' },
      { artifactId: 'artifact-pending', changeSetId: 'change-set-pending' },
    ];
    const findMany = jest.fn(async ({ where }: any) => (
      where.changeSet ? [allLinks[1]] : allLinks
    ));
    const tx = {
      collaborationArtifactChangeSetLink: { findMany },
      collaborationReview: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      collaborationTaskArtifact: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeSet: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      changeItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    } as any;

    await supersedeRunPagePublicationsLocked(tx, { runId: 'run-1' });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        runId: 'run-1',
        changeSet: {
          origin: 'collaboration', status: { in: ['draft', 'pending_review', 'approved'] },
        },
      },
      select: { artifactId: true, changeSetId: true },
    });
    expect(tx.collaborationTaskArtifact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['artifact-pending'] } }),
    }));
    expect(tx.collaborationReview.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ artifactId: { in: ['artifact-pending'] } }),
    }));
  });
});
