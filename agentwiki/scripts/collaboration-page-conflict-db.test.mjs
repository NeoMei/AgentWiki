import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { withPageTemplateTestDatabase } from './page-template-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { AuthorizationService } = requireFromServer('./dist/core/authorization/authorization.service.js');
const { ArtifactValidator } = requireFromServer('./dist/collaboration-workflows/artifact-validator.js');
const { CollaborationEventsService } = requireFromServer('./dist/collaboration-workflows/collaboration-events.service.js');
const { ExecutionService } = requireFromServer('./dist/collaboration-workflows/execution.service.js');
const { PageResultService } = requireFromServer('./dist/collaboration-workflows/page-result.service.js');
const { ProgressionService } = requireFromServer('./dist/collaboration-workflows/progression.service.js');
const { ReviewService } = requireFromServer('./dist/collaboration-workflows/review.service.js');
const { RunService } = requireFromServer('./dist/collaboration-workflows/run.service.js');
const { RunEventStore } = requireFromServer('./dist/collaboration-workflows/run-event.store.js');
const { HistoryCursorService } = requireFromServer('./dist/collaboration-workflows/history-cursor.service.js');
const { ContentTreeService } = requireFromServer('./dist/content-tree/content-tree.service.js');
const { ReadableSyncPathService } = requireFromServer('./dist/core/sync/readable-sync-path.service.js');
const { SpaceRevisionWriterService } = requireFromServer('./dist/core/sync/space-revision-writer.service.js');
const { PagePublicationService } = requireFromServer('./dist/review/page-publication.service.js');

const baseDatabaseUrl = process.env.PAGE_TEMPLATE_TEST_DATABASE_URL;
if (!baseDatabaseUrl) throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL is required');

const definition = {
  schemaVersion: 1,
  inputs: [],
  roleSlots: [{ id: 'writer', name: 'Writer', required: true, description: 'Writes' }],
  nodes: [
    {
      kind: 'agent_task', id: 'write-page', name: 'Write Page', roleSlotId: 'writer', objective: 'Write',
      inputKeys: [], upstreamArtifacts: [], output: { key: 'page-markdown', kind: 'markdown' },
      evidenceRequired: [], humanAcceptance: true, leaseSeconds: 300, maxExecutionSeconds: 3600,
      retryBudget: 1, repairBudget: 1, skippable: false,
      todos: [{ id: 'write', name: 'Write', required: true, evidenceKinds: [] }],
    },
    {
      kind: 'human_review', id: 'review-page', name: 'Review Page', artifactTaskId: 'write-page',
      revisionTaskId: 'write-page', minimumRole: 'editor', reviewerUserIds: [],
      approvalCriteria: ['Complete'], allowTerminate: true,
    },
  ],
  dependencies: [{ from: 'write-page', to: 'review-page', mode: 'all' }],
  terminalNodeIds: ['review-page'],
};

test('conflict pause commits and regenerate starts a generation with the current Page baseline', {
  timeout: 180_000,
}, async () => {
  await withPageTemplateTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    assert.match(schemaName, /^page_template_test_[a-z0-9_]+$/u);
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const services = createServices(prisma);
    try {
      const fixture = await createFixture(prisma);
      const run = await createRun(prisma, fixture);
      const submission = await claimAndSubmit(services, fixture, run, '# Agent candidate', 'conflict');
      const humanContent = '# Human edit after claim';
      await prisma.page.update({ where: { id: fixture.pageId }, data: { content: humanContent } });

      await assertBusinessCode(services.reviews.decide(
        fixture.spaceId, run.runId, submission.reviewId,
        { kind: 'approve', reason: 'approve stale text', idempotencyKey: 'approve-conflict-1' },
        fixture.humanPrincipals[0],
      ), 'PAGE_VERSION_CONFLICT');

      assert.deepEqual(
        await prisma.collaborationRun.findUniqueOrThrow({
          where: { id: run.runId }, select: { status: true, pauseReason: true },
        }),
        { status: 'paused', pauseReason: 'page_version_conflict' },
      );
      assert.equal(
        (await prisma.collaborationReview.findUniqueOrThrow({ where: { id: submission.reviewId } })).status,
        'pending',
      );
      assert.equal((await prisma.page.findUniqueOrThrow({ where: { id: fixture.pageId } })).content, humanContent);

      const resolution = await services.reviews.resolvePageConflict(
        fixture.spaceId, run.runId, run.taskId,
        {
          kind: 'regenerate', expectedPageVersionId: null, expectedContentHash: hash(humanContent),
          idempotencyKey: 'regenerate-conflict-1',
        },
        fixture.humanPrincipals[0],
      );
      assert.deepEqual(resolution, { kind: 'regenerate', taskId: run.taskId, generation: 2 });
      assert.equal(
        (await prisma.changeSet.findUniqueOrThrow({ where: { id: submission.changeSetId } })).status,
        'superseded',
      );
      assert.equal(
        (await prisma.collaborationTaskArtifact.findUniqueOrThrow({ where: { id: submission.artifactId } })).status,
        'rejected',
      );
      assert.equal(
        await prisma.collaborationArtifactChangeSetLink.count({ where: { changeSetId: submission.changeSetId } }),
        1,
      );

      const next = await services.execution.nextAction(
        { runId: run.runId, idempotencyKey: 'claim-generation-2' }, fixture.agentPrincipal,
      );
      const attempt = await prisma.collaborationTaskAttempt.findUniqueOrThrow({ where: { id: next.attemptId } });
      assert.equal(attempt.generation, 2);
      assert.equal(attempt.basePageVersionId, null);
      assert.equal(attempt.baseContentHash, hash(humanContent));
      assert.equal(attempt.basePageUpdatedAt?.toISOString(),
        (await prisma.page.findUniqueOrThrow({ where: { id: fixture.pageId } })).updatedAt.toISOString());

      for (const todo of next.task.todos) {
        await services.execution.updateTodo({
          runId: run.runId, attemptId: next.attemptId, todoId: todo.id,
          leaseToken: next.leaseToken, status: 'done', evidence: [],
          idempotencyKey: `archive-todo-${todo.id}`,
        }, fixture.agentPrincipal);
      }
      const archiveSubmission = await services.execution.submitResult({
        runId: run.runId, attemptId: next.attemptId, leaseToken: next.leaseToken,
        artifact: { kind: 'markdown', markdown: '# Candidate before archive', evidence: [] },
        idempotencyKey: 'submit-before-archive',
      }, fixture.agentPrincipal);
      const archiveLink = await prisma.collaborationArtifactChangeSetLink.findUniqueOrThrow({
        where: { artifactId: archiveSubmission.artifactId },
      });
      await prisma.$transaction(async (tx) => {
        const locked = await services.contentTree.lockPageMutationSpace(tx, fixture.spaceId);
        const current = await locked.page.findUniqueOrThrow({ where: { id: fixture.pageId } });
        await locked.page.update({ where: { id: current.id }, data: { deletedAt: new Date() } });
        await services.contentTree.advancePageMutation(locked, {
          spaceId: fixture.spaceId,
          expectedTreeRevision: locked.contentTreeRevision,
          structural: true,
          changes: [{ operation: 'archive', pageId: current.knowledgeKey, previousPath: current.syncPath }],
          actor: { userId: fixture.humanPrincipals[0].userId },
        });
      });
      assert.equal(
        (await prisma.changeSet.findUniqueOrThrow({ where: { id: archiveLink.changeSetId } })).status,
        'superseded',
      );
      assert.equal(await prisma.collaborationArtifactChangeSetLink.count({ where: { id: archiveLink.id } }), 1);
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('two database clients publish one same-Page Run and permit only one concurrent recovery decision', {
  timeout: 180_000,
}, async () => {
  await withPageTemplateTestDatabase(baseDatabaseUrl, async ({ databaseUrl }) => {
    const left = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const right = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const leftServices = createServices(left);
    const rightServices = createServices(right);
    try {
      const fixture = await createFixture(left);
      const runA = await createRun(left, fixture);
      const runB = await createRun(left, fixture);
      const submissionA = await claimAndSubmit(leftServices, fixture, runA, '# Candidate A', 'parallel-a');
      const submissionB = await claimAndSubmit(rightServices, fixture, runB, '# Candidate B', 'parallel-b');

      const decisions = await Promise.allSettled([
        leftServices.reviews.decide(
          fixture.spaceId, runA.runId, submissionA.reviewId,
          { kind: 'approve', reason: 'approve A', idempotencyKey: 'approve-parallel-a' },
          fixture.humanPrincipals[0],
        ),
        rightServices.reviews.decide(
          fixture.spaceId, runB.runId, submissionB.reviewId,
          { kind: 'approve', reason: 'approve B', idempotencyKey: 'approve-parallel-b' },
          fixture.humanPrincipals[1],
        ),
      ]);
      assert.equal(decisions.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(decisions.filter((result) => result.status === 'rejected'
        && result.reason?.businessCode === 'PAGE_VERSION_CONFLICT').length, 1);

      const winner = decisions[0].status === 'fulfilled'
        ? { run: runA, submission: submissionA, content: '# Candidate A' }
        : { run: runB, submission: submissionB, content: '# Candidate B' };
      const loser = decisions[0].status === 'fulfilled'
        ? { run: runB, submission: submissionB }
        : { run: runA, submission: submissionA };
      const currentPage = await left.page.findUniqueOrThrow({ where: { id: fixture.pageId } });
      assert.equal(currentPage.content, winner.content);
      assert.equal((await left.collaborationReview.findUniqueOrThrow({
        where: { id: winner.submission.reviewId },
      })).status, 'approved');
      assert.equal((await left.collaborationReview.findUniqueOrThrow({
        where: { id: loser.submission.reviewId },
      })).status, 'pending');
      assert.deepEqual(
        await left.collaborationRun.findUniqueOrThrow({
          where: { id: loser.run.runId }, select: { status: true, pauseReason: true },
        }),
        { status: 'paused', pauseReason: 'page_version_conflict' },
      );

      const currentVersion = await left.pageVersion.findFirstOrThrow({
        where: { pageId: fixture.pageId, title: currentPage.title, content: currentPage.content },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const recovery = {
        kind: 'adopt_current', expectedPageVersionId: currentVersion.id,
        expectedContentHash: hash(currentPage.content), idempotencyKey: 'adopt-parallel-human-1',
      };
      const concurrentRecovery = await Promise.allSettled([
        leftServices.reviews.resolvePageConflict(
          fixture.spaceId, loser.run.runId, loser.run.taskId, recovery, fixture.humanPrincipals[0],
        ),
        rightServices.reviews.decide(
          fixture.spaceId, loser.run.runId, loser.submission.reviewId,
          { kind: 'approve', reason: 'approve while another adopts', idempotencyKey: 'approve-parallel-human-2' },
          fixture.humanPrincipals[1],
        ),
      ]);
      assert.equal(concurrentRecovery.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(concurrentRecovery.filter((result) => result.status === 'rejected').length, 1);

      const adoptedReview = await left.collaborationReview.findUniqueOrThrow({
        where: { id: loser.submission.reviewId }, include: { artifact: true },
      });
      assert.equal(adoptedReview.status, 'approved');
      assert.equal(adoptedReview.artifact.status, 'accepted');
      assert.equal(adoptedReview.artifact.payload.markdown, currentPage.content);
      assert.equal(adoptedReview.artifact.payload.adoptedCurrentPage.pageVersionId, currentVersion.id);
      assert.equal(
        (await left.collaborationTaskArtifact.findUniqueOrThrow({ where: { id: loser.submission.artifactId } })).status,
        'superseded',
      );
      assert.equal(
        (await left.changeSet.findUniqueOrThrow({ where: { id: loser.submission.changeSetId } })).status,
        'superseded',
      );
    } finally {
      await Promise.all([left.$disconnect(), right.$disconnect()]);
    }
  });
});

test('Run cancellation invalidates a pending Page candidate without rewriting a published one', {
  timeout: 180_000,
}, async () => {
  await withPageTemplateTestDatabase(baseDatabaseUrl, async ({ databaseUrl }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const services = createServices(prisma);
    try {
      const fixture = await createFixture(prisma);
      const run = await createRun(prisma, fixture);
      const pending = await claimAndSubmit(services, fixture, run, '# Pending candidate', 'cancel-pending');
      const published = await createPublishedCandidate(prisma, fixture, run);

      await services.runs.cancelRun(run.runId, {
        reason: 'cancel mixed publication run', idempotencyKey: 'cancel-mixed-publication-1',
      }, fixture.humanPrincipals[0], fixture.spaceId);

      assert.deepEqual(
        await prisma.changeSet.findMany({
          where: { id: { in: [pending.changeSetId, published.changeSetId] } },
          orderBy: { id: 'asc' }, select: { id: true, status: true },
        }),
        [
          { id: pending.changeSetId, status: 'superseded' },
          { id: published.changeSetId, status: 'published' },
        ].sort((left, right) => left.id.localeCompare(right.id)),
      );
      assert.equal(
        (await prisma.collaborationTaskArtifact.findUniqueOrThrow({ where: { id: pending.artifactId } })).status,
        'superseded',
      );
      assert.equal(
        (await prisma.collaborationTaskArtifact.findUniqueOrThrow({ where: { id: published.artifactId } })).status,
        'accepted',
      );
      assert.equal(
        (await prisma.collaborationReview.findUniqueOrThrow({ where: { id: pending.reviewId } })).status,
        'superseded',
      );
      assert.equal(
        (await prisma.collaborationReview.findUniqueOrThrow({ where: { id: published.reviewId } })).status,
        'approved',
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});

function createServices(prisma) {
  const config = { get: (key) => key === 'JWT_SECRET' ? 'page-conflict-db-test-secret' : undefined };
  const notifications = new CollaborationEventsService(prisma, { publish: async () => undefined });
  const events = new RunEventStore();
  const authorization = new AuthorizationService(prisma);
  const progression = new ProgressionService(events);
  const writer = SpaceRevisionWriterService.legacyOnly(prisma);
  const contentTree = new ContentTreeService(prisma, writer, new ReadableSyncPathService());
  const pageResults = new PageResultService();
  const publication = new PagePublicationService(contentTree);
  return {
    prisma,
    contentTree,
    execution: new ExecutionService(
      prisma, authorization, config, events, new ArtifactValidator(), progression,
      notifications, pageResults,
    ),
    reviews: new ReviewService(
      prisma, authorization, events, progression, notifications, publication, pageResults,
    ),
    runs: new RunService(
      prisma, authorization, events, progression, notifications,
      new HistoryCursorService(config), {},
    ),
  };
}

async function createPublishedCandidate(prisma, fixture, run) {
  const suffix = randomUUID().replaceAll('-', '');
  const taskId = `published_task_${suffix}`;
  const attemptId = `published_attempt_${suffix}`;
  const artifactId = `published_artifact_${suffix}`;
  const changeSetId = `published_change_set_${suffix}`;
  const reviewId = `published_review_${suffix}`;
  const now = new Date();
  const page = await prisma.page.findUniqueOrThrow({ where: { id: fixture.pageId } });
  await prisma.collaborationRunTask.create({ data: {
    id: taskId, runId: run.runId, nodeId: `published-node-${suffix}`, ordinal: 1,
    name: 'Published Page task', objective: 'Already published', roleSlotId: 'writer',
    assigneeAgentId: fixture.agentId, status: 'completed', generation: 1, dependencyMode: 'all',
    outputContract: { key: 'published-page', kind: 'markdown' }, requiredEvidence: [],
    humanAcceptance: true, leaseSeconds: 300, maxExecutionSeconds: 3600,
    retryBudget: 1, repairBudget: 1, targetPageId: fixture.pageId, targetSpaceId: fixture.spaceId,
    basePageVersionId: null, basePageUpdatedAt: page.updatedAt, baseContentHash: hash(page.content),
    completedAt: now,
  } });
  await prisma.collaborationTaskAttempt.create({ data: {
    id: attemptId, runId: run.runId, taskId, generation: 1, agentId: fixture.agentId,
    attemptNumber: 1, status: 'completed', claimIdempotencyKey: `published-claim-${suffix}`,
    leaseTokenHash: hash(`published-lease-${suffix}`), leaseStartedAt: now,
    leaseExpiresAt: new Date(now.getTime() + 300_000), maxExecutionAt: new Date(now.getTime() + 3_600_000),
    finishedAt: now, basePageUpdatedAt: page.updatedAt, baseContentHash: hash(page.content),
  } });
  await prisma.collaborationTaskArtifact.create({ data: {
    id: artifactId, runId: run.runId, taskId, attemptId, generation: 1, version: 1,
    kind: 'markdown', status: 'accepted', payload: { markdown: '# Already published' },
    evidence: [], acceptedAt: now,
  } });
  await prisma.changeSet.create({ data: {
    id: changeSetId, spaceId: fixture.spaceId, title: 'Published candidate', origin: 'collaboration',
    status: 'published', createdByAgentId: fixture.agentId, reviewedAt: now, publishedAt: now,
    items: { create: {
      type: 'update_page', status: 'published', publishedResourceId: fixture.pageId,
      payload: { pageId: fixture.pageId, changes: { content: '# Already published' } },
    } },
  } });
  await prisma.collaborationArtifactChangeSetLink.create({ data: {
    artifactId, changeSetId, runId: run.runId, taskId,
    spaceId: fixture.spaceId, pageId: fixture.pageId,
  } });
  await prisma.collaborationReview.create({ data: {
    id: reviewId, runId: run.runId, nodeId: `published-review-${suffix}`, revision: 1,
    generation: 1, sourceTaskId: taskId, artifactId, revisionTaskId: taskId,
    minimumRole: 'editor', reviewerUserIds: [], allowTerminate: true,
    status: 'approved', reviewerUserId: fixture.humanPrincipals[0].userId,
    reason: 'Previously published', decidedAt: now,
  } });
  return { taskId, artifactId, changeSetId, reviewId };
}

async function createFixture(prisma) {
  const suffix = randomUUID().replaceAll('-', '');
  const userA = await prisma.user.create({ data: {
    id: `conflict_user_a_${suffix}`, email: `conflict-a-${suffix}@example.test`, name: 'Reviewer A',
  } });
  const userB = await prisma.user.create({ data: {
    id: `conflict_user_b_${suffix}`, email: `conflict-b-${suffix}@example.test`, name: 'Reviewer B',
  } });
  const space = await prisma.space.create({ data: {
    id: `conflict_space_${suffix}`, name: 'Conflict fixture', slug: `conflict-${suffix}`,
    members: { create: [{ userId: userA.id, role: 'owner' }, { userId: userB.id, role: 'editor' }] },
  } });
  const agent = await prisma.agent.create({ data: {
    id: `conflict_agent_${suffix}`, name: 'Writer', ownerId: userA.id,
  } });
  const grant = await prisma.agentGrant.create({ data: { agentId: agent.id, spaceId: space.id, role: 'editor' } });
  const credential = await prisma.agentCredential.create({ data: {
    id: `conflict_credential_${suffix}`, name: 'Fixture credential', prefix: `cfx${suffix.slice(-8)}`,
    keyHash: hash(`credential-${suffix}`), agentId: agent.id, authorizationId: grant.id,
  } });
  const page = await prisma.page.create({ data: {
    id: `conflict_page_${suffix}`, spaceId: space.id, authorId: userA.id,
    title: 'Target Page', slug: `target-${suffix}`, content: '# Initial', format: 'markdown',
    syncPath: `pages/${suffix}.md`, syncPathKey: `pages/${suffix}.md`,
  } });
  return {
    spaceId: space.id,
    pageId: page.id,
    agentId: agent.id,
    humanPrincipals: [
      { userId: userA.id, platformRole: 'user' },
      { userId: userB.id, platformRole: 'user' },
    ],
    agentPrincipal: {
      userId: userA.id, agentId: agent.id, authorizationId: grant.id,
      authorizationSpaceId: space.id, credentialId: credential.id,
      agentRole: 'editor', scopes: ['collaboration:read', 'collaboration:execute'],
    },
  };
}

async function createRun(prisma, fixture) {
  const suffix = randomUUID().replaceAll('-', '');
  const runId = `conflict_run_${suffix}`;
  const taskId = `conflict_task_${suffix}`;
  const page = await prisma.page.findUniqueOrThrow({ where: { id: fixture.pageId } });
  await prisma.collaborationRun.create({ data: {
    id: runId, spaceId: fixture.spaceId, sourceKind: 'page_selection', templateVersion: 1,
    templateSnapshot: definition, snapshotHash: hash(JSON.stringify(definition)),
    name: 'Page conflict', status: 'running', inputs: {},
    startedById: fixture.humanPrincipals[0].userId, startedAt: new Date(),
  } });
  await prisma.collaborationRoleBinding.create({ data: {
    runId, roleSlotId: 'writer', roleSlotName: 'Writer', agentId: fixture.agentId,
  } });
  await prisma.collaborationRunTask.create({ data: {
    id: taskId, runId, nodeId: 'write-page', ordinal: 0, name: 'Write Page', objective: 'Write',
    roleSlotId: 'writer', assigneeAgentId: fixture.agentId, status: 'ready', generation: 1,
    dependencyMode: 'all', outputContract: { key: 'page-markdown', kind: 'markdown' },
    requiredEvidence: [], humanAcceptance: true, leaseSeconds: 300, maxExecutionSeconds: 3600,
    retryBudget: 1, repairBudget: 1, targetPageId: fixture.pageId, targetSpaceId: fixture.spaceId,
    basePageVersionId: null, basePageUpdatedAt: page.updatedAt, baseContentHash: hash(page.content),
  } });
  await prisma.collaborationTaskTodo.create({ data: {
    runId, taskId, generation: 1, templateId: 'write', ordinal: 0, name: 'Write', required: true,
  } });
  return { runId, taskId };
}

async function claimAndSubmit(services, fixture, run, markdown, key) {
  const claim = await services.execution.nextAction(
    { runId: run.runId, idempotencyKey: `claim-${key}` }, fixture.agentPrincipal,
  );
  for (const todo of claim.task.todos) {
    await services.execution.updateTodo({
      runId: run.runId, attemptId: claim.attemptId, todoId: todo.id,
      leaseToken: claim.leaseToken, status: 'done', evidence: [], idempotencyKey: `todo-${key}-${todo.id}`,
    }, fixture.agentPrincipal);
  }
  const submission = await services.execution.submitResult({
    runId: run.runId, attemptId: claim.attemptId, leaseToken: claim.leaseToken,
    artifact: { kind: 'markdown', markdown, evidence: [] }, idempotencyKey: `submit-${key}`,
  }, fixture.agentPrincipal);
  const review = await services.prisma.collaborationReview.findFirst({
    where: { artifactId: submission.artifactId },
  });
  const link = await services.prisma.collaborationArtifactChangeSetLink.findUnique({
    where: { artifactId: submission.artifactId },
  });
  if (!review || !link) throw new Error('submission did not create Page review publication records');
  return { artifactId: submission.artifactId, reviewId: review.id, changeSetId: link.changeSetId };
}

async function assertBusinessCode(promise, code) {
  await assert.rejects(promise, (error) => error?.businessCode === code);
}

function hash(value) {
  return createHash('sha256').update(value.replace(/\r\n?/gu, '\n')).digest('hex');
}
