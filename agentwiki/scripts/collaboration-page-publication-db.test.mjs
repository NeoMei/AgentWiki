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
const { RunEventStore } = requireFromServer('./dist/collaboration-workflows/run-event.store.js');
const { ContentTreeService } = requireFromServer('./dist/content-tree/content-tree.service.js');
const { ReadableSyncPathService } = requireFromServer('./dist/core/sync/readable-sync-path.service.js');
const { SpaceRevisionWriterService } = requireFromServer('./dist/core/sync/space-revision-writer.service.js');
const { PagePublicationService } = requireFromServer('./dist/review/page-publication.service.js');

const baseDatabaseUrl = process.env.PAGE_TEMPLATE_TEST_DATABASE_URL;
if (!baseDatabaseUrl) throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL is required');

test('targeted collaboration Page approval is atomic and retryable in real PostgreSQL', {
  timeout: 180_000,
}, async () => {
  await withPageTemplateTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    assert.match(schemaName, /^page_template_test_[a-z0-9_]+$/u);
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = randomUUID().replaceAll('-', '');
    const id = (prefix) => `${prefix}_${suffix}`;
    const config = { get: (key) => key === 'JWT_SECRET' ? 'page-publication-db-test-secret' : undefined };
    const notifications = new CollaborationEventsService(prisma, { publish: async () => undefined });
    const events = new RunEventStore();
    const authorization = new AuthorizationService(prisma);
    const artifacts = new ArtifactValidator();
    const progression = new ProgressionService(events);
    const writer = SpaceRevisionWriterService.legacyOnly(prisma);
    const contentTree = new ContentTreeService(prisma, writer, new ReadableSyncPathService());
    const pageResults = new PageResultService();
    const publication = new PagePublicationService(contentTree, { indexPage: async () => ({ lexicalIndexed: true }) }, { enqueue: () => undefined });
    const execution = new ExecutionService(
      prisma, authorization, config, events, artifacts, progression, notifications, pageResults,
    );
    const reviews = new ReviewService(
      prisma, authorization, events, progression, notifications, publication,
    );
    try {
      const fixture = await createFixture(prisma, id);
      const claim = await execution.nextAction({ runId: fixture.runId, idempotencyKey: 'claim-page-01' }, fixture.agentPrincipal);
      for (const todo of claim.task.todos) {
        await execution.updateTodo({
          runId: fixture.runId, attemptId: claim.attemptId, todoId: todo.id,
          leaseToken: claim.leaseToken, status: 'done', evidence: [],
          idempotencyKey: `todo-${todo.id}`,
        }, fixture.agentPrincipal);
      }
      const submittedMarkdown = '# Published from collaboration\n\nAtomic result.';
      const submitted = await execution.submitResult({
        runId: fixture.runId, attemptId: claim.attemptId, leaseToken: claim.leaseToken,
        artifact: { kind: 'markdown', markdown: submittedMarkdown, evidence: [] },
        idempotencyKey: 'submit-page-01',
      }, fixture.agentPrincipal);
      assert.equal(submitted.runStatus, 'running');
      const before = await readState(prisma, fixture, submitted.artifactId);
      assert.equal(before.links.length, 1);
      assert.equal(before.changeSet.runId, null);

      await installAfterImageFailureTrigger(prisma, schemaName, fixture.pageId, submittedMarkdown);
      await assert.rejects(
        reviews.decide(fixture.spaceId, fixture.runId, before.review.id, {
          kind: 'approve', reason: 'approve atomically', idempotencyKey: 'approve-page-01',
        }, fixture.humanPrincipal),
      );
      assert.deepEqual(await readState(prisma, fixture, submitted.artifactId), before);

      await removeAfterImageFailureTrigger(prisma, schemaName);
      await reviews.decide(fixture.spaceId, fixture.runId, before.review.id, {
        kind: 'approve', reason: 'approve atomically', idempotencyKey: 'approve-page-01',
      }, fixture.humanPrincipal);
      const after = await readState(prisma, fixture, submitted.artifactId);
      assert.equal(after.review.status, 'approved');
      assert.equal(after.artifact.status, 'accepted');
      assert.equal(after.changeSet.status, 'published');
      assert.equal(after.page.content, submittedMarkdown);
      assert.equal(after.approvals.length, 1);
      assert.equal(after.run.status, 'running');
      assert.equal(after.parallelTask.status, 'running');
      assert.equal(after.pageVersions.filter((version) => version.content === submittedMarkdown).length, 1);

      await reviews.decide(fixture.spaceId, fixture.runId, before.review.id, {
        kind: 'approve', reason: 'approve atomically', idempotencyKey: 'approve-page-01',
      }, fixture.humanPrincipal);
      const replay = await readState(prisma, fixture, submitted.artifactId);
      assert.equal(replay.approvals.length, 1);
      assert.equal(replay.pageVersions.filter((version) => version.content === submittedMarkdown).length, 1);

      const stale = await createFixture(prisma, id);
      const staleClaim = await execution.nextAction({ runId: stale.runId, idempotencyKey: 'claim-stale-01' }, stale.agentPrincipal);
      for (const todo of staleClaim.task.todos) {
        await execution.updateTodo({
          runId: stale.runId, attemptId: staleClaim.attemptId, todoId: todo.id,
          leaseToken: staleClaim.leaseToken, status: 'done', evidence: [], idempotencyKey: `stale-${todo.id}`,
        }, stale.agentPrincipal);
      }
      const staleSubmitted = await execution.submitResult({
        runId: stale.runId, attemptId: staleClaim.attemptId, leaseToken: staleClaim.leaseToken,
        artifact: { kind: 'markdown', markdown: '# Stale candidate', evidence: [] },
        idempotencyKey: 'submit-stale-01',
      }, stale.agentPrincipal);
      await prisma.$executeRaw`UPDATE "Page" SET "content" = ${'human edit after claim'} WHERE "id" = ${stale.pageId}`;
      const staleReview = await prisma.collaborationReview.findFirstOrThrow({ where: { artifactId: staleSubmitted.artifactId } });
      await assertBusinessCode(reviews.decide(stale.spaceId, stale.runId, staleReview.id, {
        kind: 'approve', reason: 'must conflict', idempotencyKey: 'approve-stale-01',
      }, stale.humanPrincipal), 'CHANGESET_CONFLICT');
      assert.equal((await prisma.page.findUniqueOrThrow({ where: { id: stale.pageId } })).content, 'human edit after claim');
    } finally {
      await prisma.$disconnect();
    }
  });
});

async function createFixture(prisma, id) {
  const userId = id(`user_${randomUUID().slice(0, 6)}`);
  const spaceId = id(`space_${randomUUID().slice(0, 6)}`);
  const agentId = id(`agent_${randomUUID().slice(0, 6)}`);
  const pageId = id(`page_${randomUUID().slice(0, 6)}`);
  const taskId = id(`task_${randomUUID().slice(0, 6)}`);
  const parallelTaskId = id(`parallel_task_${randomUUID().slice(0, 6)}`);
  const runId = id(`run_${randomUUID().slice(0, 6)}`);
  const credentialId = id(`credential_${randomUUID().slice(0, 6)}`);
  const oldContent = '# Existing Page';
  const human = await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, name: 'Reviewer' } });
  const space = await prisma.space.create({ data: {
    id: spaceId, name: 'Publication fixture', slug: spaceId, members: { create: { userId, role: 'owner' } },
  } });
  const agent = await prisma.agent.create({ data: { id: agentId, name: 'Writer', ownerId: userId } });
  const grant = await prisma.agentGrant.create({ data: { agentId, spaceId, role: 'editor' } });
  const credential = await prisma.agentCredential.create({ data: {
    id: credentialId, name: 'Fixture credential', prefix: `pub${randomUUID().slice(0, 6)}`,
    keyHash: randomUUID().replaceAll('-', ''), agentId, authorizationId: grant.id,
  } });
  const page = await prisma.page.create({ data: {
    id: pageId, spaceId, authorId: userId, title: 'Target Page', slug: `target-${pageId}`,
    content: oldContent, format: 'markdown', syncPath: `pages/${pageId}.md`, syncPathKey: `pages/${pageId}.md`,
  } });
  const definition = {
    schemaVersion: 1,
    inputs: [], roleSlots: [{ id: 'writer', name: 'Writer', required: true, description: 'Writes' }],
    nodes: [
      {
        kind: 'agent_task', id: 'write-page', name: 'Write Page', roleSlotId: 'writer', objective: 'Write',
        inputKeys: [], upstreamArtifacts: [], output: { key: 'page-markdown', kind: 'markdown' }, evidenceRequired: [],
        humanAcceptance: true, leaseSeconds: 300, maxExecutionSeconds: 3600, retryBudget: 1, repairBudget: 1,
        skippable: false, todos: [{ id: 'write', name: 'Write', required: true, evidenceKinds: [] }],
      },
      {
        kind: 'human_review', id: 'review-page', name: 'Review Page', artifactTaskId: 'write-page',
        revisionTaskId: 'write-page', minimumRole: 'editor', reviewerUserIds: [], approvalCriteria: ['Complete'], allowTerminate: true,
      },
      {
        kind: 'agent_task', id: 'parallel-work', name: 'Parallel Work', roleSlotId: 'writer', objective: 'Continue',
        inputKeys: [], upstreamArtifacts: [], output: { key: 'parallel-output', kind: 'markdown' }, evidenceRequired: [],
        humanAcceptance: false, leaseSeconds: 300, maxExecutionSeconds: 3600, retryBudget: 1, repairBudget: 1,
        skippable: false, todos: [{ id: 'continue', name: 'Continue', required: true, evidenceKinds: [] }],
      },
    ],
    dependencies: [{ from: 'write-page', to: 'review-page', mode: 'all' }],
    terminalNodeIds: ['review-page', 'parallel-work'],
  };
  await prisma.collaborationRun.create({ data: {
    id: runId, spaceId, sourceKind: 'page_selection', templateVersion: 1, templateSnapshot: definition,
    snapshotHash: 'a'.repeat(64), name: 'Page publication', status: 'running', inputs: {}, startedById: userId, startedAt: new Date(),
  } });
  await prisma.collaborationRoleBinding.create({ data: {
    runId, roleSlotId: 'writer', roleSlotName: 'Writer', agentId,
  } });
  await prisma.collaborationRunTask.create({ data: {
    id: taskId, runId, nodeId: 'write-page', ordinal: 0, name: 'Write Page', objective: 'Write', roleSlotId: 'writer',
    assigneeAgentId: agentId, status: 'ready', generation: 1, dependencyMode: 'all',
    outputContract: { key: 'page-markdown', kind: 'markdown' }, requiredEvidence: [], humanAcceptance: true,
    leaseSeconds: 300, maxExecutionSeconds: 3600, retryBudget: 1, repairBudget: 1,
    targetPageId: pageId, targetSpaceId: spaceId, basePageVersionId: null,
    basePageUpdatedAt: page.updatedAt, baseContentHash: hash(oldContent),
  } });
  await prisma.collaborationRunTask.create({ data: {
    id: parallelTaskId, runId, nodeId: 'parallel-work', ordinal: 1, name: 'Parallel Work', objective: 'Continue',
    roleSlotId: 'writer', assigneeAgentId: agentId, status: 'running', generation: 1, dependencyMode: 'all',
    outputContract: { key: 'parallel-output', kind: 'markdown' }, requiredEvidence: [], humanAcceptance: false,
    leaseSeconds: 300, maxExecutionSeconds: 3600, retryBudget: 1, repairBudget: 1,
  } });
  await prisma.collaborationTaskTodo.create({ data: {
    runId, taskId, generation: 1, templateId: 'write', ordinal: 0, name: 'Write', required: true,
  } });
  return {
    runId, taskId, pageId, spaceId, humanPrincipal: { userId: human.id, platformRole: 'user' },
    agentPrincipal: {
      userId, agentId, authorizationId: grant.id, authorizationSpaceId: spaceId, credentialId: credential.id,
      agentRole: 'editor', scopes: ['collaboration:read', 'collaboration:execute'],
    },
  };
}

async function readState(prisma, fixture, artifactId) {
  const links = await prisma.collaborationArtifactChangeSetLink.findMany({ where: { artifactId } });
  const changeSet = await prisma.changeSet.findUniqueOrThrow({ where: { id: links[0].changeSetId } });
  return {
    links,
    review: await prisma.collaborationReview.findFirstOrThrow({ where: { artifactId } }),
    artifact: await prisma.collaborationTaskArtifact.findUniqueOrThrow({ where: { id: artifactId } }),
    changeSet,
    page: await prisma.page.findUniqueOrThrow({ where: { id: fixture.pageId } }),
    approvals: await prisma.approval.findMany({ where: { changeSetId: changeSet.id }, orderBy: { id: 'asc' } }),
    run: await prisma.collaborationRun.findUniqueOrThrow({ where: { id: fixture.runId } }),
    parallelTask: await prisma.collaborationRunTask.findFirstOrThrow({
      where: { runId: fixture.runId, nodeId: 'parallel-work' },
    }),
    pageVersions: await prisma.pageVersion.findMany({ where: { pageId: fixture.pageId }, orderBy: { createdAt: 'asc' } }),
  };
}

async function installAfterImageFailureTrigger(prisma, schemaName, pageId, submittedMarkdown) {
  const schema = `"${schemaName}"`;
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION ${schema}.fail_published_page_version() RETURNS trigger AS $$
    BEGIN
      IF NEW."pageId" = '${pageId}' AND NEW."content" = '${submittedMarkdown.replaceAll("'", "''")}' THEN
        RAISE EXCEPTION 'injected after-image failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_published_page_version
    BEFORE INSERT ON ${schema}."PageVersion"
    FOR EACH ROW EXECUTE FUNCTION ${schema}.fail_published_page_version()
  `);
}

async function removeAfterImageFailureTrigger(prisma, schemaName) {
  const schema = `"${schemaName}"`;
  await prisma.$executeRawUnsafe(`DROP TRIGGER fail_published_page_version ON ${schema}."PageVersion"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION ${schema}.fail_published_page_version()`);
}

async function assertBusinessCode(promise, code) {
  await assert.rejects(promise, (error) => error?.businessCode === code);
}

function hash(value) {
  return createHash('sha256').update(value.replace(/\r\n?/gu, '\n')).digest('hex');
}
