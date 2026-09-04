import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  validateCollaborationTestDatabaseUrl,
  withCollaborationTestDatabase,
} from './collaboration-test-database.mjs';
import * as collaborationDatabase from './collaboration-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const baseDatabaseUrl = process.env.COLLABORATION_TEST_DATABASE_URL;
const REVIEWED_MIGRATION_TREE_SHA256 = 'aea568306ebeb5ce70977a19b205cdb8c2d8bed0bc434e49a2e82a15d477c32e';

test('dedicated collaboration database URLs fail closed', () => {
  assert.throws(() => validateCollaborationTestDatabaseUrl(undefined), /required/i);
  assert.throws(() => validateCollaborationTestDatabaseUrl('postgresql://localhost/agentwiki'), /test/i);
  for (const unsafeHost of [
    '203.0.113.10',
    'localhost.evil',
    '2130706433',
    '0x7f000001',
  ]) {
    assert.throws(
      () => validateCollaborationTestDatabaseUrl(`postgresql://${unsafeHost}/agentwiki_test`),
      /loopback/i,
    );
  }
  assert.throws(() => validateCollaborationTestDatabaseUrl('postgresql://localhost/agentwiki_test?schema=public'), /schema/i);
  assert.doesNotThrow(() => validateCollaborationTestDatabaseUrl('postgresql://localhost/agentwiki_test'));
  assert.doesNotThrow(() => validateCollaborationTestDatabaseUrl('postgresql://127.42.0.9/agentwiki_test'));
  assert.doesNotThrow(() => validateCollaborationTestDatabaseUrl('postgresql://[0:0:0:0:0:0:0:1]/agentwiki_test'));
  assert.doesNotThrow(() => validateCollaborationTestDatabaseUrl('postgresql://localhost/agentwiki_test?schema=collaboration_test_existing'));
});

test('collaboration preflight rejects a missing or non-public vector extension', async () => {
  assert.equal(typeof collaborationDatabase.assertCollaborationDatabaseSafetyPreflight, 'function');
  await assert.rejects(
    collaborationDatabase.assertCollaborationDatabaseSafetyPreflight({ $queryRaw: async () => [] }),
    /vector extension must be preconfigured in public/iu,
  );
  await assert.rejects(
    collaborationDatabase.assertCollaborationDatabaseSafetyPreflight({
      $queryRaw: async () => [{ name: 'vector', schema: 'private' }],
    }),
    /vector extension must be preconfigured in public/iu,
  );
});

test('collaboration harness removes its random schema when the callback fails', {
  skip: baseDatabaseUrl ? false : 'COLLABORATION_TEST_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  let createdSchema;
  await assert.rejects(
    withCollaborationTestDatabase(baseDatabaseUrl, async ({ schemaName }) => {
      createdSchema = schemaName;
      throw new Error('intentional collaboration cleanup probe');
    }),
    /intentional collaboration cleanup probe/u,
  );
  const administrativeUrl = new URL(baseDatabaseUrl);
  administrativeUrl.searchParams.delete('schema');
  const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl.toString() } } });
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT nspname FROM pg_namespace WHERE nspname = $1',
      createdSchema,
    );
    assert.deepEqual(rows, []);
  } finally {
    await prisma.$disconnect();
  }
});

test('collaboration migration exposes all ten tables and integrity guards', {
  skip: baseDatabaseUrl ? false : 'COLLABORATION_TEST_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  await withCollaborationTestDatabase(baseDatabaseUrl, async ({
    databaseUrl,
    schemaName,
    migrationTreeDigest,
    publicInventoryDigest,
  }) => {
    assert.equal(migrationTreeDigest, REVIEWED_MIGRATION_TREE_SHA256);
    assert.match(publicInventoryDigest, /^[a-f0-9]{64}$/u);
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = schemaName.replace('collaboration_test_', '');
    const ids = Object.fromEntries([
      'user1', 'user2', 'space1', 'space2', 'agent1', 'agent2', 'template',
      'run1', 'run2', 'task1', 'task2', 'attempt1', 'artifact1',
    ].map((name) => [name, `${name}_${suffix}`]));
    try {
      const rows = await prisma.$queryRawUnsafe(
        'SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename LIKE \'Collaboration%\' ORDER BY tablename',
        schemaName,
      );
      assert.deepEqual(rows.map((row) => row.tablename), [
        'CollaborationReview',
        'CollaborationRoleBinding',
        'CollaborationRun',
        'CollaborationRunEvent',
        'CollaborationRunTask',
        'CollaborationTaskArtifact',
        'CollaborationTaskAttempt',
        'CollaborationTaskDependency',
        'CollaborationTaskTodo',
        'CollaborationTemplate',
      ]);
      const guards = await prisma.$queryRawUnsafe(
        `SELECT indexname AS name FROM pg_indexes
         WHERE schemaname = $1 AND indexname IN (
           'CollaborationTaskAttempt_one_active',
           'CollaborationTaskAttempt_one_active_per_agent_run',
           'CollaborationTaskAttempt_lease_scan'
         )
         UNION ALL
         SELECT conname AS name FROM pg_constraint
         WHERE connamespace = $1::regnamespace AND conname IN (
           'CollaborationTemplate_scope_check',
           'CollaborationTaskAttempt_lease_bounds_check',
           'CollaborationRunEvent_actor_check'
         )
         ORDER BY name`,
        schemaName,
      );
      assert.deepEqual(guards.map((guard) => guard.name), [
        'CollaborationRunEvent_actor_check',
        'CollaborationTaskAttempt_lease_bounds_check',
        'CollaborationTaskAttempt_lease_scan',
        'CollaborationTaskAttempt_one_active',
        'CollaborationTaskAttempt_one_active_per_agent_run',
        'CollaborationTemplate_scope_check',
      ]);

      await prisma.user.createMany({ data: [
        { id: ids.user1, email: `${ids.user1}@collaboration.test` },
        { id: ids.user2, email: `${ids.user2}@collaboration.test` },
      ] });
      await prisma.space.createMany({ data: [
        { id: ids.space1, name: 'Space 1', slug: ids.space1 },
        { id: ids.space2, name: 'Space 2', slug: ids.space2 },
      ] });
      await prisma.agent.createMany({ data: [
        { id: ids.agent1, name: 'Agent 1', ownerId: ids.user1 },
        { id: ids.agent2, name: 'Agent 2', ownerId: ids.user2 },
      ] });
      await prisma.collaborationTemplate.create({
        data: {
          id: ids.template,
          scopeKey: 'system',
          slug: `coding-${suffix}`,
          name: 'Coding',
          system: true,
          definition: {},
        },
      });
      await prisma.collaborationRun.createMany({ data: [
        {
          id: ids.run1,
          spaceId: ids.space1,
          templateId: ids.template,
          templateVersion: 1,
          templateSnapshot: {},
          snapshotHash: 'a'.repeat(64),
          name: 'Run 1',
          inputs: {},
          startedById: ids.user1,
        },
        {
          id: ids.run2,
          spaceId: ids.space2,
          templateId: ids.template,
          templateVersion: 1,
          templateSnapshot: {},
          snapshotHash: 'b'.repeat(64),
          name: 'Run 2',
          inputs: {},
          startedById: ids.user2,
        },
      ] });
      await prisma.collaborationRunTask.createMany({ data: [
        {
          id: ids.task1,
          runId: ids.run1,
          nodeId: 'task-1',
          ordinal: 1,
          name: 'Task 1',
          objective: 'Do work',
          roleSlotId: 'writer',
          assigneeAgentId: ids.agent1,
          outputContract: {},
          requiredEvidence: [],
          leaseSeconds: 300,
          maxExecutionSeconds: 3600,
        },
        {
          id: ids.task2,
          runId: ids.run2,
          nodeId: 'task-2',
          ordinal: 1,
          name: 'Task 2',
          objective: 'Do other work',
          roleSlotId: 'writer',
          assigneeAgentId: ids.agent2,
          outputContract: {},
          requiredEvidence: [],
          leaseSeconds: 300,
          maxExecutionSeconds: 3600,
        },
      ] });
      const leaseStartedAt = new Date('2026-01-01T00:00:00.000Z');
      const leaseExpiresAt = new Date('2026-01-01T00:05:00.000Z');
      const maxExecutionAt = new Date('2026-01-01T01:00:00.000Z');
      await prisma.collaborationTaskAttempt.create({ data: {
        id: ids.attempt1,
        runId: ids.run1,
        taskId: ids.task1,
        generation: 1,
        agentId: ids.agent1,
        attemptNumber: 1,
        status: 'completed',
        claimIdempotencyKey: 'claim-0001',
        leaseTokenHash: 'c'.repeat(64),
        leaseStartedAt,
        leaseExpiresAt,
        maxExecutionAt,
        finishedAt: leaseExpiresAt,
      } });
      await prisma.collaborationTaskArtifact.create({ data: {
        id: ids.artifact1,
        runId: ids.run1,
        taskId: ids.task1,
        attemptId: ids.attempt1,
        generation: 1,
        version: 1,
        kind: 'markdown',
        status: 'accepted',
        payload: { markdown: 'done' },
        evidence: [],
      } });
      const otherSourceTaskId = `task1_other_${suffix}`;
      await prisma.collaborationRunTask.create({ data: {
        id: otherSourceTaskId,
        runId: ids.run1,
        nodeId: 'task-1-other',
        ordinal: 2,
        name: 'Other source task',
        objective: 'Must not own Task 1 Artifact',
        roleSlotId: 'writer',
        assigneeAgentId: ids.agent1,
        outputContract: {},
        requiredEvidence: [],
        leaseSeconds: 300,
        maxExecutionSeconds: 3600,
      } });

      await assert.rejects(
        prisma.collaborationReview.create({ data: {
          id: `bad_same_run_review_${suffix}`,
          runId: ids.run1,
          nodeId: 'review-wrong-source-task',
          generation: 1,
          sourceTaskId: otherSourceTaskId,
          artifactId: ids.artifact1,
          revisionTaskId: ids.task1,
          minimumRole: 'editor',
          reviewerUserIds: [],
        } }),
        /foreign key|constraint/i,
      );
      const validReview = await prisma.collaborationReview.create({ data: {
        id: `valid_review_${suffix}`,
        runId: ids.run1,
        nodeId: 'review-matching-source-task',
        generation: 1,
        sourceTaskId: ids.task1,
        artifactId: ids.artifact1,
        revisionTaskId: ids.task1,
        minimumRole: 'editor',
        reviewerUserIds: [],
      } });
      assert.equal(validReview.sourceTaskId, ids.task1);
      assert.equal(validReview.artifactId, ids.artifact1);

      await assert.rejects(
        prisma.collaborationTaskAttempt.create({ data: {
          runId: ids.run2,
          taskId: ids.task1,
          generation: 1,
          agentId: ids.agent2,
          attemptNumber: 2,
          status: 'failed',
          claimIdempotencyKey: 'claim-cross-run',
          leaseTokenHash: 'f'.repeat(64),
          leaseStartedAt,
          leaseExpiresAt,
          maxExecutionAt,
        } }),
        /foreign key|constraint/i,
      );

      await assert.rejects(
        prisma.collaborationTaskTodo.create({ data: {
          id: `bad_todo_${suffix}`,
          runId: ids.run2,
          taskId: ids.task1,
          generation: 1,
          templateId: 'todo',
          ordinal: 1,
          name: 'Cross-run Todo',
        } }),
        /foreign key|constraint/i,
      );
      await assert.rejects(
        prisma.collaborationTaskArtifact.create({ data: {
          id: `bad_artifact_${suffix}`,
          runId: ids.run2,
          taskId: ids.task2,
          attemptId: ids.attempt1,
          generation: 1,
          version: 1,
          kind: 'markdown',
          payload: {},
          evidence: [],
        } }),
        /foreign key|constraint/i,
      );
      await assert.rejects(
        prisma.collaborationReview.create({ data: {
          id: `bad_review_${suffix}`,
          runId: ids.run2,
          nodeId: 'review',
          generation: 1,
          sourceTaskId: ids.task1,
          artifactId: ids.artifact1,
          revisionTaskId: ids.task2,
          minimumRole: 'editor',
          reviewerUserIds: [],
        } }),
        /foreign key|constraint/i,
      );
      await assert.rejects(
        prisma.collaborationTemplate.create({ data: {
          scopeKey: 'wrong',
          slug: `invalid-${suffix}`,
          name: 'Invalid',
          system: true,
          definition: {},
        } }),
        /check|constraint/i,
      );

      await prisma.collaborationTaskAttempt.create({ data: {
        runId: ids.run2,
        taskId: ids.task2,
        generation: 1,
        agentId: ids.agent2,
        attemptNumber: 1,
        status: 'claimed',
        claimIdempotencyKey: 'claim-active-1',
        leaseTokenHash: '1'.repeat(64),
        leaseStartedAt,
        leaseExpiresAt,
        maxExecutionAt,
      } });
      await assert.rejects(
        prisma.collaborationTaskAttempt.create({ data: {
          runId: ids.run2,
          taskId: ids.task2,
          generation: 1,
          agentId: ids.agent2,
          attemptNumber: 2,
          status: 'running',
          claimIdempotencyKey: 'claim-active-2',
          leaseTokenHash: '2'.repeat(64),
          leaseStartedAt,
          leaseExpiresAt,
          maxExecutionAt,
        } }),
        /unique|constraint/i,
      );
      const task3 = `task3_${suffix}`;
      await prisma.collaborationRunTask.create({ data: {
        id: task3,
        runId: ids.run2,
        nodeId: 'task-3',
        ordinal: 2,
        name: 'Task 3',
        objective: 'Concurrent work',
        roleSlotId: 'writer',
        assigneeAgentId: ids.agent2,
        outputContract: {},
        requiredEvidence: [],
        leaseSeconds: 300,
        maxExecutionSeconds: 3600,
      } });
      await assert.rejects(
        prisma.collaborationTaskAttempt.create({ data: {
          runId: ids.run2,
          taskId: task3,
          generation: 1,
          agentId: ids.agent2,
          attemptNumber: 1,
          status: 'claimed',
          claimIdempotencyKey: 'claim-active-agent',
          leaseTokenHash: '3'.repeat(64),
          leaseStartedAt,
          leaseExpiresAt,
          maxExecutionAt,
        } }),
        /unique|constraint/i,
      );
      await assert.rejects(
        prisma.collaborationTaskAttempt.create({ data: {
          runId: ids.run2,
          taskId: ids.task2,
          generation: 1,
          agentId: ids.agent2,
          attemptNumber: 3,
          status: 'failed',
          claimIdempotencyKey: 'claim-bad-lease',
          leaseTokenHash: 'd'.repeat(64),
          leaseStartedAt,
          leaseExpiresAt: maxExecutionAt,
          maxExecutionAt: leaseExpiresAt,
        } }),
        /check|constraint/i,
      );
      await assert.rejects(
        prisma.collaborationRunEvent.create({ data: {
          runId: ids.run1,
          sequence: 1,
          type: 'invalid-actor',
          actorKind: 'human',
          actorId: ids.user1,
          actorUserId: ids.user1,
          actorAgentId: ids.agent1,
          operation: 'test',
          target: ids.run1,
          idempotencyKey: 'event-0001',
          requestHash: 'e'.repeat(64),
          metadata: {},
        } }),
        /check|constraint/i,
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});
