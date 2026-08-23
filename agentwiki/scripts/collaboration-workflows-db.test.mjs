import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { withCollaborationTestDatabase } from './collaboration-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { AuthorizationService } = requireFromServer('./dist/core/authorization/authorization.service.js');
const { ArtifactValidator } = requireFromServer('./dist/collaboration-workflows/artifact-validator.js');
const { ExecutionService } = requireFromServer('./dist/collaboration-workflows/execution.service.js');
const { ProgressionService, calculateRunStatus } = requireFromServer('./dist/collaboration-workflows/progression.service.js');
const { RecoveryWorker } = requireFromServer('./dist/collaboration-workflows/recovery.worker.js');
const { ReviewService } = requireFromServer('./dist/collaboration-workflows/review.service.js');
const { RunEventStore } = requireFromServer('./dist/collaboration-workflows/run-event.store.js');
const { RunService } = requireFromServer('./dist/collaboration-workflows/run.service.js');

export const REQUIRED_DB_SCENARIOS = Object.freeze([
  'same-Agent concurrent next action has one active lease', 'parallel assigned Agents claim distinct tasks',
  'scoped idempotent next action and mismatch rejection', 'heartbeat renewal',
  'lease expiry and late rejection', 'maximum execution deadline', 'ordered Todo and Todo failure',
  'Artifact union, external reference, and bounded JSON Schema validation', 'all dependency',
  'any early release with all-upstream completion', 'approve', 'causal generation reject revision',
  'stale Artifact cannot release or complete', 'mixed review and ready status precedence',
  'terminate', 'retry once then exhaustion pause', 'reassigned Agent join and old lease rejection',
  'active claim pause resume reclaim', 'active reassignment new Agent continues Todo progress',
  'Agent revoke', 'Agent role downgrade', 'Space deletion', 'manual reauthorization',
]);

const baseDatabaseUrl = process.env.COLLABORATION_TEST_DATABASE_URL;
const notifications = {
  publishCurrentRun: async () => undefined,
  publishRunChanged: async () => undefined,
};
const config = {
  get(key) {
    if (key === 'JWT_SECRET') return 'collaboration-db-test-secret-with-enough-entropy';
    if (key === 'PROCESS_ROLE') return 'api';
    return undefined;
  },
};

test('collaboration workflow database scenarios use real Prisma transactions', {
  skip: baseDatabaseUrl ? false : 'COLLABORATION_TEST_DATABASE_URL is not configured',
  timeout: 180_000,
}, async (suite) => {
  await withCollaborationTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    assert.match(schemaName, /^collaboration_test_[a-z0-9_]+$/u);
    assert.notEqual(schemaName, 'public');
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const services = createServices(prisma);
    const covered = new Set();
    const cover = (...names) => names.forEach((name) => covered.add(name));
    try {
      await suite.test('claims, idempotency, leases, Todo ordering, and Artifact validation', async () => {
        const fixture = await createFixture(prisma, {
          taskSpecs: [
            { nodeId: 'first', status: 'ready', todoNames: ['Inspect', 'Implement'] },
            { nodeId: 'second', status: 'ready', ordinal: 1 },
          ],
        });
        const [left, right] = await Promise.all([
          services.execution.nextAction(nextInput(fixture.run.id, 'concurrent-left'), fixture.principals[0]),
          services.execution.nextAction(nextInput(fixture.run.id, 'concurrent-right'), fixture.principals[0]),
        ]);
        assert.equal(left.action, 'execute_task');
        assert.equal(right.action, 'execute_task');
        assert.equal(left.attemptId, right.attemptId);
        assert.equal(await prisma.collaborationTaskAttempt.count({
          where: { runId: fixture.run.id, agentId: fixture.agents[0].id, status: { in: ['claimed', 'running'] } },
        }), 1);

        const replay = await services.execution.nextAction(nextInput(fixture.run.id, 'concurrent-left'), fixture.principals[0]);
        assert.equal(replay.attemptId, left.attemptId);
        assert.equal(replay.leaseToken, left.leaseToken);
        await assertBusinessCode(
          services.execution.nextAction({ ...nextInput(fixture.run.id, 'concurrent-left'), waitSeconds: 1 }, fixture.principals[0]),
          'COLLABORATION_IDEMPOTENCY_MISMATCH',
        );

        const before = await prisma.collaborationTaskAttempt.findUniqueOrThrow({ where: { id: left.attemptId } });
        const heartbeat = await services.execution.heartbeat({
          runId: fixture.run.id, attemptId: left.attemptId, leaseToken: left.leaseToken,
          idempotencyKey: 'heartbeat-renewal-01',
        }, fixture.principals[0]);
        assert.ok(new Date(heartbeat.leaseExpiresAt).getTime() >= before.leaseExpiresAt.getTime());
        assert.ok(new Date(heartbeat.leaseExpiresAt).getTime() <= before.maxExecutionAt.getTime());

        const [firstTodo, secondTodo] = left.task.todos;
        await assertBusinessCode(services.execution.updateTodo({
          runId: fixture.run.id, attemptId: left.attemptId, todoId: secondTodo.id,
          leaseToken: left.leaseToken, status: 'done', evidence: [], idempotencyKey: 'todo-out-of-order-01',
        }, fixture.principals[0]), 'COLLABORATION_TODO_OUT_OF_ORDER');
        await services.execution.updateTodo({
          runId: fixture.run.id, attemptId: left.attemptId, todoId: firstTodo.id,
          leaseToken: left.leaseToken, status: 'doing', evidence: [], idempotencyKey: 'todo-first-doing-01',
        }, fixture.principals[0]);
        await services.execution.updateTodo({
          runId: fixture.run.id, attemptId: left.attemptId, todoId: firstTodo.id,
          leaseToken: left.leaseToken, status: 'done', evidence: [], idempotencyKey: 'todo-first-done-01',
        }, fixture.principals[0]);
        await services.execution.updateTodo({
          runId: fixture.run.id, attemptId: left.attemptId, todoId: secondTodo.id,
          leaseToken: left.leaseToken, status: 'done', evidence: [], idempotencyKey: 'todo-second-done-01',
        }, fixture.principals[0]);
        const submission = await services.execution.submitResult({
          runId: fixture.run.id, attemptId: left.attemptId, leaseToken: left.leaseToken,
          artifact: { kind: 'markdown', markdown: '# Complete', evidence: [] },
          idempotencyKey: 'submit-first-task-01',
        }, fixture.principals[0]);
        assert.equal(submission.action, 'submitted');
        assert.equal(await prisma.collaborationTaskArtifact.count({ where: { taskId: fixture.tasks[0].id } }), 1);

        const validator = services.artifacts;
        assert.equal(validator.validate(
          { kind: 'json', json: { ok: true }, evidence: [] },
          { key: 'json', kind: 'json', jsonSchema: {
            type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } },
          } }, [],
        ).valid, true);
        assert.equal(validator.validate(
          { kind: 'json', json: { ok: 'yes' }, evidence: [] },
          { key: 'json', kind: 'json', jsonSchema: {
            type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } },
          } }, [],
        ).valid, false);
        const external = validator.validate({
          kind: 'external_reference',
          externalReference: {
            kind: 'workspace_path', displayName: 'Evidence', value: './reports/result.md', contentHash: 'a'.repeat(64),
          }, evidence: [],
        }, { key: 'external', kind: 'external_reference' }, []);
        assert.equal(external.valid, true);
        assert.equal(external.normalizedArtifact.externalReference.value, 'reports/result.md');
        assert.equal(validator.validate(
          { kind: 'json', json: {}, evidence: [] },
          { key: 'unsafe', kind: 'json', jsonSchema: { $ref: 'https://example.test/schema.json' } }, [],
        ).valid, false);

        const expired = await createFixture(prisma);
        const expiredClaim = await services.execution.nextAction(nextInput(expired.run.id, 'expired-claim-01'), expired.principals[0]);
        await prisma.collaborationTaskAttempt.update({
          where: { id: expiredClaim.attemptId },
          data: { leaseExpiresAt: new Date(Date.now() - 2_000) },
        });
        await assertBusinessCode(services.execution.submitResult({
          runId: expired.run.id, attemptId: expiredClaim.attemptId, leaseToken: expiredClaim.leaseToken,
          artifact: { kind: 'markdown', markdown: 'late', evidence: [] }, idempotencyKey: 'late-submit-01',
        }, expired.principals[0]), 'COLLABORATION_LEASE_EXPIRED');

        const maximum = await createFixture(prisma);
        const maximumClaim = await services.execution.nextAction(nextInput(maximum.run.id, 'maximum-claim-01'), maximum.principals[0]);
        const past = new Date(Date.now() - 2_000);
        await prisma.collaborationTaskAttempt.update({
          where: { id: maximumClaim.attemptId }, data: { leaseExpiresAt: past, maxExecutionAt: past },
        });
        await assertBusinessCode(services.execution.heartbeat({
          runId: maximum.run.id, attemptId: maximumClaim.attemptId, leaseToken: maximumClaim.leaseToken,
          idempotencyKey: 'maximum-heartbeat-01',
        }, maximum.principals[0]), 'COLLABORATION_LEASE_EXPIRED');

        const todoFailure = await createFixture(prisma, { taskSpecs: [{ retryBudget: 0 }] });
        const failedClaim = await services.execution.nextAction(nextInput(todoFailure.run.id, 'todo-failure-claim-01'), todoFailure.principals[0]);
        const failed = await services.execution.updateTodo({
          runId: todoFailure.run.id, attemptId: failedClaim.attemptId, todoId: failedClaim.task.todos[0].id,
          leaseToken: failedClaim.leaseToken, status: 'failed', summary: 'deterministic failure', evidence: [],
          idempotencyKey: 'todo-failure-01',
        }, todoFailure.principals[0]);
        assert.equal(failed.taskStatus, 'failed');
        assert.equal((await prisma.collaborationRun.findUniqueOrThrow({ where: { id: todoFailure.run.id } })).status, 'paused');

        cover(
          'same-Agent concurrent next action has one active lease',
          'scoped idempotent next action and mismatch rejection',
          'heartbeat renewal', 'lease expiry and late rejection', 'maximum execution deadline',
          'ordered Todo and Todo failure',
          'Artifact union, external reference, and bounded JSON Schema validation',
        );
      });

      await suite.test('parallel Agents and dependency progression preserve deterministic precedence', async () => {
        const parallel = await createFixture(prisma, {
          agentRoles: ['editor', 'publisher'],
          taskSpecs: [
            { nodeId: 'parallel-a', assigneeIndex: 0, status: 'ready' },
            { nodeId: 'parallel-b', assigneeIndex: 1, status: 'ready', ordinal: 1 },
          ],
        });
        const [claimA, claimB] = await Promise.all([
          services.execution.nextAction(nextInput(parallel.run.id, 'parallel-claim-a'), parallel.principals[0]),
          services.execution.nextAction(nextInput(parallel.run.id, 'parallel-claim-b'), parallel.principals[1]),
        ]);
        assert.equal(claimA.action, 'execute_task');
        assert.equal(claimB.action, 'execute_task');
        assert.notEqual(claimA.attemptId, claimB.attemptId);
        assert.notEqual(claimA.task.id, claimB.task.id);

        const all = await createFixture(prisma, {
          taskSpecs: [
            { nodeId: 'up-a', status: 'completed' },
            { nodeId: 'up-b', status: 'blocked', ordinal: 1 },
            { nodeId: 'down-all', status: 'blocked', ordinal: 2, dependencyMode: 'all' },
          ],
          dependencies: [
            { from: 'up-a', to: 'down-all', mode: 'all' },
            { from: 'up-b', to: 'down-all', mode: 'all' },
          ],
          terminalNodeIds: ['down-all'],
        });
        await prisma.$transaction((tx) => services.progression.advanceRun(tx, all.run.id, 'all-first', false));
        assert.equal((await prisma.collaborationRunTask.findUniqueOrThrow({ where: { id: all.tasks[2].id } })).status, 'blocked');
        await prisma.collaborationRunTask.update({ where: { id: all.tasks[1].id }, data: { status: 'completed', completedAt: new Date() } });
        await prisma.$transaction((tx) => services.progression.advanceRun(tx, all.run.id, 'all-second', false));
        assert.equal((await prisma.collaborationRunTask.findUniqueOrThrow({ where: { id: all.tasks[2].id } })).status, 'ready');

        const any = await createFixture(prisma, {
          taskSpecs: [
            { nodeId: 'any-a', status: 'completed' },
            { nodeId: 'any-b', status: 'blocked', ordinal: 1 },
            { nodeId: 'down-any', status: 'blocked', ordinal: 2, dependencyMode: 'any' },
          ],
          dependencies: [
            { from: 'any-a', to: 'down-any', mode: 'any' },
            { from: 'any-b', to: 'down-any', mode: 'any' },
          ],
          terminalNodeIds: ['down-any'],
        });
        await prisma.$transaction((tx) => services.progression.advanceRun(tx, any.run.id, 'any-release', false));
        assert.equal((await prisma.collaborationRunTask.findUniqueOrThrow({ where: { id: any.tasks[2].id } })).status, 'ready');
        await prisma.collaborationRunTask.update({ where: { id: any.tasks[2].id }, data: { status: 'completed', completedAt: new Date() } });
        await prisma.$transaction((tx) => services.progression.advanceRun(tx, any.run.id, 'any-not-finished', false));
        assert.notEqual((await prisma.collaborationRun.findUniqueOrThrow({ where: { id: any.run.id } })).status, 'completed');
        await prisma.collaborationRunTask.update({ where: { id: any.tasks[1].id }, data: { status: 'completed', completedAt: new Date() } });
        await prisma.collaborationRun.update({ where: { id: any.run.id }, data: { pauseReason: null, status: 'running' } });
        await prisma.$transaction((tx) => services.progression.advanceRun(tx, any.run.id, 'any-finished', false));
        assert.equal((await prisma.collaborationRun.findUniqueOrThrow({ where: { id: any.run.id } })).status, 'completed');

        const stale = await createFixture(prisma, {
          taskSpecs: [
            { nodeId: 'stale-source', status: 'blocked', generation: 2 },
            { nodeId: 'stale-downstream', status: 'blocked', ordinal: 1 },
          ],
          dependencies: [{ from: 'stale-source', to: 'stale-downstream', mode: 'all' }],
          terminalNodeIds: ['stale-downstream'],
        });
        await insertHistoricalArtifact(prisma, stale, stale.tasks[0], 1, 'accepted');
        await prisma.$transaction((tx) => services.progression.advanceRun(tx, stale.run.id, 'stale-artifact', false));
        assert.equal((await prisma.collaborationRunTask.findUniqueOrThrow({ where: { id: stale.tasks[1].id } })).status, 'blocked');
        assert.notEqual((await prisma.collaborationRun.findUniqueOrThrow({ where: { id: stale.run.id } })).status, 'completed');

        assert.equal(calculateRunStatus({
          run: { status: 'running', pauseReason: null, templateSnapshot: { terminalNodeIds: ['review'] } },
          tasks: [{ id: 'ready', nodeId: 'ready', status: 'ready' }],
          reviews: [{ nodeId: 'review', status: 'pending' }], satisfiedNodeIds: new Set(),
        }), 'running');

        cover(
          'parallel assigned Agents claim distinct tasks', 'all dependency',
          'any early release with all-upstream completion', 'stale Artifact cannot release or complete',
          'mixed review and ready status precedence',
        );
      });

      await suite.test('human reviews approve, reject causal generations, and terminate', async () => {
        const approved = await createReviewFixture(prisma, services, 'approve');
        const approval = await services.reviews.decide(
          approved.space.id, approved.run.id, approved.review.id,
          { kind: 'approve', reason: 'Evidence accepted', idempotencyKey: 'approve-review-01' },
          approved.humanPrincipal,
        );
        assert.equal(approval.status, 'completed');
        assert.equal((await prisma.collaborationTaskArtifact.findUniqueOrThrow({ where: { id: approved.artifact.id } })).status, 'accepted');

        const rejected = await createReviewFixture(prisma, services, 'reject');
        await services.reviews.decide(
          rejected.space.id, rejected.run.id, rejected.review.id,
          { kind: 'reject_for_revision', reason: 'Revise the causal source', idempotencyKey: 'reject-review-01' },
          rejected.humanPrincipal,
        );
        const tasks = await prisma.collaborationRunTask.findMany({ where: { runId: rejected.run.id }, orderBy: { ordinal: 'asc' } });
        assert.deepEqual(tasks.map((item) => [item.nodeId, item.generation, item.status]), [
          ['revision', 2, 'ready'], ['source', 2, 'blocked'],
        ]);
        assert.equal((await prisma.collaborationTaskArtifact.findUniqueOrThrow({ where: { id: rejected.artifact.id } })).status, 'rejected');
        assert.equal((await prisma.collaborationTaskArtifact.findUniqueOrThrow({ where: { id: rejected.revisionArtifact.id } })).status, 'superseded');
        assert.equal(await prisma.collaborationTaskTodo.count({ where: { runId: rejected.run.id, generation: 2 } }), 2);

        const terminated = await createReviewFixture(prisma, services, 'terminate');
        await services.reviews.decide(
          terminated.space.id, terminated.run.id, terminated.review.id,
          { kind: 'terminate', reason: 'Human terminates this run', idempotencyKey: 'terminate-review-01' },
          terminated.humanPrincipal,
        );
        assert.equal((await prisma.collaborationRun.findUniqueOrThrow({ where: { id: terminated.run.id } })).status, 'cancelled');
        await services.recovery.tick();
        assert.equal((await prisma.collaborationRun.findUniqueOrThrow({ where: { id: terminated.run.id } })).status, 'cancelled');

        cover('approve', 'causal generation reject revision', 'terminate');
      });

      await suite.test('active claim survives pause and resume as a new same-generation Attempt', async () => {
        const paused = await createFixture(prisma, { taskSpecs: [{ todoNames: ['Inspect', 'Implement'] }] });
        const oldClaim = await services.execution.nextAction(
          nextInput(paused.run.id, 'pause-old-claim'),
          paused.principals[0],
        );
        await services.execution.updateTodo({
          runId: paused.run.id, attemptId: oldClaim.attemptId, todoId: oldClaim.task.todos[0].id,
          leaseToken: oldClaim.leaseToken, status: 'doing', evidence: [], idempotencyKey: 'pause-todo-doing-01',
        }, paused.principals[0]);

        await services.runs.pauseRun(paused.run.id, {
          reason: 'Human maintenance', idempotencyKey: 'pause-active-01',
        }, paused.humanPrincipal, paused.space.id);
        assert.equal((await prisma.collaborationRun.findUniqueOrThrow({ where: { id: paused.run.id } })).status, 'paused');
        assert.equal((await prisma.collaborationRunTask.findUniqueOrThrow({ where: { id: paused.tasks[0].id } })).status, 'ready');
        await assertBusinessCode(services.execution.heartbeat({
          runId: paused.run.id, attemptId: oldClaim.attemptId, leaseToken: oldClaim.leaseToken,
          idempotencyKey: 'pause-old-heartbeat-01',
        }, paused.principals[0]), 'COLLABORATION_LEASE_EXPIRED');
        assert.equal((await services.execution.nextAction(
          nextInput(paused.run.id, 'pause-blocked-claim'), paused.principals[0],
        )).action, 'paused');

        await services.runs.resumeRun(paused.run.id, {
          reason: 'Maintenance complete', idempotencyKey: 'resume-active-01',
        }, paused.humanPrincipal, paused.space.id);
        const resumedClaim = await services.execution.nextAction(
          nextInput(paused.run.id, 'pause-new-claim'), paused.principals[0],
        );
        assert.equal(resumedClaim.action, 'execute_task');
        assert.notEqual(resumedClaim.attemptId, oldClaim.attemptId);
        const resumedAttempt = await prisma.collaborationTaskAttempt.findUniqueOrThrow({
          where: { id: resumedClaim.attemptId },
        });
        assert.equal(resumedAttempt.generation, paused.tasks[0].generation);
        assert.equal(resumedAttempt.attemptNumber, 2);
        assert.equal(resumedClaim.task.todos[0].status, 'doing');

        cover('active claim pause resume reclaim');
      });

      await suite.test('active reassignment issues a new lease and preserves current-generation Todo progress', async () => {
        const reassigned = await createFixture(prisma, {
          agentRoles: ['editor', 'editor'], bindAgentIndexes: [0],
          taskSpecs: [{ todoNames: ['Inspect', 'Implement'] }],
        });
        const oldClaim = await services.execution.nextAction(
          nextInput(reassigned.run.id, 'active-reassign-old-claim'), reassigned.principals[0],
        );
        await services.execution.updateTodo({
          runId: reassigned.run.id, attemptId: oldClaim.attemptId, todoId: oldClaim.task.todos[0].id,
          leaseToken: oldClaim.leaseToken, status: 'doing', evidence: [], idempotencyKey: 'active-reassign-todo-01',
        }, reassigned.principals[0]);
        const bindingsBefore = await prisma.collaborationRoleBinding.findMany({ where: { runId: reassigned.run.id } });

        await services.runs.reassignTask(reassigned.run.id, reassigned.tasks[0].id, {
          agentId: reassigned.agents[1].id, reason: 'Manual handoff', idempotencyKey: 'active-reassign-01',
        }, reassigned.humanPrincipal, reassigned.space.id);
        await assertBusinessCode(services.execution.heartbeat({
          runId: reassigned.run.id, attemptId: oldClaim.attemptId, leaseToken: oldClaim.leaseToken,
          idempotencyKey: 'active-reassign-old-heartbeat-01',
        }, reassigned.principals[0]), 'COLLABORATION_LEASE_EXPIRED');

        const newClaim = await services.execution.nextAction(
          nextInput(reassigned.run.id, 'active-reassign-new-claim'), reassigned.principals[1],
        );
        assert.equal(newClaim.action, 'execute_task');
        assert.notEqual(newClaim.attemptId, oldClaim.attemptId);
        const newAttempt = await prisma.collaborationTaskAttempt.findUniqueOrThrow({
          where: { id: newClaim.attemptId },
        });
        assert.equal(newAttempt.generation, reassigned.tasks[0].generation);
        assert.equal(newAttempt.attemptNumber, 2);
        assert.equal(newClaim.task.todos[0].status, 'doing');
        await services.execution.updateTodo({
          runId: reassigned.run.id, attemptId: newClaim.attemptId, todoId: newClaim.task.todos[0].id,
          leaseToken: newClaim.leaseToken, status: 'done', evidence: [], idempotencyKey: 'active-reassign-continue-01',
        }, reassigned.principals[1]);
        assert.deepEqual(
          await prisma.collaborationRoleBinding.findMany({ where: { runId: reassigned.run.id } }),
          bindingsBefore,
        );

        cover('active reassignment new Agent continues Todo progress');
      });

      await suite.test('recovery, reassignment, revocation, downgrade, deletion, and reauthorization fail closed', async () => {
        const retry = await createFixture(prisma, { taskSpecs: [{ retryBudget: 1 }] });
        const first = await services.execution.nextAction(nextInput(retry.run.id, 'retry-first-claim'), retry.principals[0]);
        await expireAttempt(prisma, first.attemptId);
        await services.recovery.tick();
        assert.equal((await prisma.collaborationRunTask.findUniqueOrThrow({ where: { id: retry.tasks[0].id } })).status, 'retry_wait');
        await prisma.collaborationRunTask.update({ where: { id: retry.tasks[0].id }, data: { nextAttemptAt: new Date(Date.now() - 1_000) } });
        await services.recovery.tick();
        const second = await services.execution.nextAction(nextInput(retry.run.id, 'retry-second-claim'), retry.principals[0]);
        await expireAttempt(prisma, second.attemptId);
        await services.recovery.tick();
        assert.equal((await prisma.collaborationRun.findUniqueOrThrow({ where: { id: retry.run.id } })).status, 'paused');
        assert.equal((await prisma.collaborationRunTask.findUniqueOrThrow({ where: { id: retry.tasks[0].id } })).status, 'failed');

        const reassigned = await createFixture(prisma, { agentRoles: ['editor', 'editor'], bindAgentIndexes: [0] });
        const oldClaim = await services.execution.nextAction(nextInput(reassigned.run.id, 'old-agent-claim'), reassigned.principals[0]);
        await services.runs.reassignTask(reassigned.run.id, reassigned.tasks[0].id, {
          agentId: reassigned.agents[1].id, reason: 'Manual reassignment', idempotencyKey: 'manual-reassign-01',
        }, reassigned.humanPrincipal, reassigned.space.id);
        await assertBusinessCode(services.execution.heartbeat({
          runId: reassigned.run.id, attemptId: oldClaim.attemptId, leaseToken: oldClaim.leaseToken,
          idempotencyKey: 'old-agent-heartbeat-01',
        }, reassigned.principals[0]), 'COLLABORATION_LEASE_EXPIRED');
        assert.equal((await services.execution.joinRun(reassigned.run.id, reassigned.principals[1])).runId, reassigned.run.id);

        const revoked = await createFixture(prisma);
        await prisma.agent.update({ where: { id: revoked.agents[0].id }, data: { status: 'revoked', revokedAt: new Date() } });
        await assertBusinessCode(
          services.execution.nextAction(nextInput(revoked.run.id, 'revoked-agent-claim'), revoked.principals[0]),
          'SPACE_ACCESS_DENIED',
        );

        const downgraded = await createFixture(prisma);
        await prisma.agentGrant.update({ where: { id: downgraded.grants[0].id }, data: { role: 'reader' } });
        await assertBusinessCode(
          services.execution.nextAction(nextInput(downgraded.run.id, 'downgraded-agent-claim'), downgraded.principals[0]),
          'SPACE_ACCESS_DENIED',
        );

        const deleted = await createFixture(prisma);
        await prisma.space.update({ where: { id: deleted.space.id }, data: { deletedAt: new Date() } });
        await assertBusinessCode(
          services.execution.nextAction(nextInput(deleted.run.id, 'deleted-space-claim'), deleted.principals[0]),
          'SPACE_ACCESS_DENIED',
        );

        const reauthorized = await createFixture(prisma);
        await prisma.agentGrant.update({ where: { id: reauthorized.grants[0].id }, data: { role: 'reader' } });
        await assertBusinessCode(
          services.execution.nextAction(nextInput(reauthorized.run.id, 'reauthorize-denied-claim'), reauthorized.principals[0]),
          'SPACE_ACCESS_DENIED',
        );
        await prisma.agentGrant.update({ where: { id: reauthorized.grants[0].id }, data: { role: 'editor' } });
        const restored = await services.execution.nextAction(nextInput(reauthorized.run.id, 'reauthorize-restored-claim'), reauthorized.principals[0]);
        assert.equal(restored.action, 'execute_task');

        cover(
          'retry once then exhaustion pause', 'reassigned Agent join and old lease rejection',
          'Agent revoke', 'Agent role downgrade', 'Space deletion', 'manual reauthorization',
        );
      });

      await suite.test('transactional live authorization and replay/recovery gates fail closed', async () => {
        const humanReplay = await createFixture(prisma);
        const pauseInput = { reason: 'maintenance', idempotencyKey: 'human-live-auth-pause-01' };
        await services.runs.pauseRun(
          humanReplay.run.id,
          pauseInput,
          humanReplay.humanPrincipal,
          humanReplay.space.id,
        );
        await prisma.spaceMember.delete({
          where: { userId_spaceId: { userId: humanReplay.human.id, spaceId: humanReplay.space.id } },
        });
        await assertBusinessCode(
          services.runs.pauseRun(
            humanReplay.run.id,
            pauseInput,
            humanReplay.humanPrincipal,
            humanReplay.space.id,
          ),
          'COLLABORATION_HUMAN_PERMISSION_DENIED',
        );

        const heartbeatReplay = await createFixture(prisma);
        const heartbeatClaim = await services.execution.nextAction(
          nextInput(heartbeatReplay.run.id, 'heartbeat-replay-claim-01'),
          heartbeatReplay.principals[0],
        );
        const heartbeatInput = {
          runId: heartbeatReplay.run.id,
          attemptId: heartbeatClaim.attemptId,
          leaseToken: heartbeatClaim.leaseToken,
          idempotencyKey: 'heartbeat-expired-replay-01',
        };
        await services.execution.heartbeat(heartbeatInput, heartbeatReplay.principals[0]);
        await expireAttempt(prisma, heartbeatClaim.attemptId);
        await assertBusinessCode(
          services.execution.heartbeat(heartbeatInput, heartbeatReplay.principals[0]),
          'COLLABORATION_LEASE_EXPIRED',
        );

        const completedReplay = await createFixture(prisma);
        const completedClaim = await services.execution.nextAction(
          nextInput(completedReplay.run.id, 'completed-submit-claim-01'),
          completedReplay.principals[0],
        );
        for (const todo of completedClaim.task.todos) {
          await services.execution.updateTodo({
            runId: completedReplay.run.id,
            attemptId: completedClaim.attemptId,
            todoId: todo.id,
            leaseToken: completedClaim.leaseToken,
            status: 'done',
            evidence: [],
            idempotencyKey: `completed-submit-todo-${todo.id}`,
          }, completedReplay.principals[0]);
        }
        const submitInput = {
          runId: completedReplay.run.id,
          attemptId: completedClaim.attemptId,
          leaseToken: completedClaim.leaseToken,
          artifact: { kind: 'markdown', markdown: 'Complete', evidence: [] },
          idempotencyKey: 'completed-submit-replay-01',
        };
        const submitted = await services.execution.submitResult(submitInput, completedReplay.principals[0]);
        assert.equal((await prisma.collaborationRun.findUniqueOrThrow({ where: { id: completedReplay.run.id } })).status, 'completed');
        assert.deepEqual(
          await services.execution.submitResult(submitInput, completedReplay.principals[0]),
          submitted,
        );
        assert.equal(await prisma.collaborationTaskArtifact.count({
          where: { taskId: completedReplay.tasks[0].id },
        }), 1);

        for (const status of ['paused', 'waiting_review', 'completed']) {
          const gated = await createFixture(prisma, {
            runStatus: status,
            taskSpecs: [{ status: 'retry_wait' }],
          });
          await prisma.collaborationRunTask.update({
            where: { id: gated.tasks[0].id },
            data: { nextAttemptAt: new Date(Date.now() - 1_000) },
          });
          await services.recovery.tick();
          assert.equal(
            (await prisma.collaborationRunTask.findUniqueOrThrow({ where: { id: gated.tasks[0].id } })).status,
            'retry_wait',
          );
          assert.equal(
            (await prisma.collaborationRun.findUniqueOrThrow({ where: { id: gated.run.id } })).status,
            status,
          );
        }

        const credentialGate = await createFixture(prisma);
        const credentialClaim = await services.execution.nextAction(
          nextInput(credentialGate.run.id, 'credential-recovery-claim-01'),
          credentialGate.principals[0],
        );
        await expireAttempt(prisma, credentialClaim.attemptId);
        await prisma.agentCredential.update({
          where: { id: credentialGate.principals[0].credentialId },
          data: { revokedAt: new Date() },
        });
        await services.recovery.tick();
        assert.equal(
          (await prisma.collaborationRun.findUniqueOrThrow({ where: { id: credentialGate.run.id } })).status,
          'paused',
        );
        assert.equal(
          (await prisma.collaborationRunTask.findUniqueOrThrow({ where: { id: credentialGate.tasks[0].id } })).status,
          'failed',
        );
      });

      assert.deepEqual([...covered].sort(), [...REQUIRED_DB_SCENARIOS].sort());
    } finally {
      await prisma.$disconnect();
    }
  });
});

function createServices(prisma) {
  const events = new RunEventStore();
  const authorization = new AuthorizationService(prisma);
  const artifacts = new ArtifactValidator();
  const progression = new ProgressionService(events);
  return {
    artifacts,
    progression,
    execution: new ExecutionService(prisma, authorization, config, events, artifacts, progression, notifications),
    recovery: new RecoveryWorker(prisma, config, events, notifications),
    reviews: new ReviewService(prisma, authorization, events, progression, notifications),
    runs: new RunService(prisma, authorization, events, progression, notifications),
  };
}

async function createFixture(prisma, options = {}) {
  const suffix = randomUUID().replaceAll('-', '');
  const human = await prisma.user.create({ data: {
    id: `user_${suffix}`, email: `collaboration-${suffix}@example.test`, name: 'Collaboration DB Owner',
  } });
  const space = await prisma.space.create({ data: {
    id: `space_${suffix}`, name: `Collaboration ${suffix}`, slug: `collaboration-${suffix}`,
    members: { create: { userId: human.id, role: 'owner' } },
  } });
  const roles = options.agentRoles ?? ['editor'];
  const agents = [];
  const grants = [];
  const principals = [];
  for (const [index, role] of roles.entries()) {
    const agent = await prisma.agent.create({ data: {
      id: `agent_${index}_${suffix}`, name: `Agent ${index}`, ownerId: human.id,
    } });
    const grant = await prisma.agentGrant.create({ data: { agentId: agent.id, spaceId: space.id, role } });
    const credential = await prisma.agentCredential.create({ data: {
      name: `DB fixture credential ${index}`,
      prefix: `db${index}${suffix.slice(0, 6)}`,
      keyHash: `${suffix}${String(index).padStart(32, '0')}`,
      agentId: agent.id,
      authorizationId: grant.id,
    } });
    agents.push(agent);
    grants.push(grant);
    principals.push({
      userId: human.id, agentId: agent.id, authorizationId: grant.id, credentialId: credential.id,
      authorizationSpaceId: space.id,
      agentRole: role, scopes: role === 'reader' ? ['collaboration:read'] : ['collaboration:read', 'collaboration:execute'],
    });
  }
  const taskSpecs = options.taskSpecs ?? [{ nodeId: 'task', status: 'ready' }];
  const nodes = taskSpecs.map((spec, index) => taskNode(spec.nodeId ?? `task-${index}`, spec.todoNames));
  const dependencies = options.dependencies ?? [];
  const snapshot = {
    schemaVersion: 1, inputs: [],
    roleSlots: roles.map((_, index) => ({ id: `role-${index}`, name: `Role ${index}`, required: true, description: `Role ${index}` })),
    nodes, dependencies, terminalNodeIds: options.terminalNodeIds ?? [nodes.at(-1).id],
  };
  const template = await prisma.collaborationTemplate.create({ data: {
    id: `template_${suffix}`, scopeKey: space.id, spaceId: space.id, slug: `template-${suffix}`,
    name: 'DB fixture', definition: snapshot, createdById: human.id,
  } });
  const run = await prisma.collaborationRun.create({ data: {
    id: `run_${suffix}`, spaceId: space.id, templateId: template.id, templateVersion: 1,
    templateSnapshot: snapshot, snapshotHash: 'a'.repeat(64), name: 'DB fixture run',
    status: options.runStatus ?? 'running', inputs: {}, startedById: human.id, startedAt: new Date(),
  } });
  const bindIndexes = options.bindAgentIndexes ?? agents.map((_, index) => index);
  if (bindIndexes.length) {
    await prisma.collaborationRoleBinding.createMany({ data: bindIndexes.map((index) => ({
      runId: run.id, roleSlotId: `role-${index}`, roleSlotName: `Role ${index}`, agentId: agents[index].id,
    })) });
  }
  const tasks = [];
  for (const [index, spec] of taskSpecs.entries()) {
    const assigneeIndex = spec.assigneeIndex ?? 0;
    const task = await prisma.collaborationRunTask.create({ data: {
      id: `task_${index}_${suffix}`, runId: run.id, nodeId: spec.nodeId ?? `task-${index}`,
      ordinal: spec.ordinal ?? index, name: spec.nodeId ?? `Task ${index}`, objective: 'Execute the database fixture',
      roleSlotId: `role-${assigneeIndex}`, assigneeAgentId: agents[assigneeIndex].id,
      status: spec.status ?? 'ready', generation: spec.generation ?? 1,
      dependencyMode: spec.dependencyMode ?? 'all', outputContract: spec.outputContract ?? { key: `output-${index}`, kind: 'markdown' },
      requiredEvidence: spec.requiredEvidence ?? [], leaseSeconds: spec.leaseSeconds ?? 60,
      maxExecutionSeconds: spec.maxExecutionSeconds ?? 600, retryBudget: spec.retryBudget ?? 1,
      repairBudget: spec.repairBudget ?? 1, completedAt: spec.status === 'completed' ? new Date() : null,
    } });
    tasks.push(task);
    const todoNames = spec.todoNames ?? ['Complete'];
    await prisma.collaborationTaskTodo.createMany({ data: todoNames.map((name, ordinal) => ({
      runId: run.id, taskId: task.id, generation: task.generation, templateId: `todo-${ordinal}`,
      ordinal, name, required: true, status: spec.status === 'completed' ? 'done' : 'pending',
    })) });
  }
  if (dependencies.length) {
    await prisma.collaborationTaskDependency.createMany({ data: dependencies.map((dependency) => ({
      runId: run.id, fromNodeId: dependency.from, toNodeId: dependency.to, mode: dependency.mode,
    })) });
  }
  return {
    human, humanPrincipal: { userId: human.id, platformRole: 'user' }, space, agents, grants, principals,
    template, run, tasks, snapshot,
  };
}

async function createReviewFixture(prisma, services, mode) {
  const fixture = await createFixture(prisma, {
    taskSpecs: [
      { nodeId: 'revision', status: 'completed' },
      { nodeId: 'source', status: 'ready', ordinal: 1 },
    ],
    dependencies: [
      { from: 'revision', to: 'source', mode: 'all' },
      { from: 'source', to: 'review', mode: 'all' },
    ],
    terminalNodeIds: ['review'],
  });
  const reviewNode = {
    kind: 'human_review', id: 'review', name: 'Human review', artifactTaskId: 'source',
    revisionTaskId: 'revision', minimumRole: 'editor', reviewerUserIds: [], approvalCriteria: ['Evidence'],
    allowTerminate: true,
  };
  const snapshot = {
    ...fixture.snapshot,
    nodes: [...fixture.snapshot.nodes, reviewNode],
    terminalNodeIds: ['review'],
  };
  await prisma.collaborationRun.update({ where: { id: fixture.run.id }, data: { templateSnapshot: snapshot } });
  const revisionArtifact = await insertHistoricalArtifact(prisma, fixture, fixture.tasks[0], 1, 'accepted');
  const claim = await services.execution.nextAction(nextInput(fixture.run.id, `review-${mode}-claim`), fixture.principals[0]);
  for (const todo of claim.task.todos) {
    await services.execution.updateTodo({
      runId: fixture.run.id, attemptId: claim.attemptId, todoId: todo.id, leaseToken: claim.leaseToken,
      status: 'done', evidence: [], idempotencyKey: `review-${mode}-todo-${todo.id}`,
    }, fixture.principals[0]);
  }
  const submitted = await services.execution.submitResult({
    runId: fixture.run.id, attemptId: claim.attemptId, leaseToken: claim.leaseToken,
    artifact: { kind: 'markdown', markdown: `Review ${mode}`, evidence: [] },
    idempotencyKey: `review-${mode}-submit`,
  }, fixture.principals[0]);
  assert.equal(submitted.runStatus, 'waiting_review');
  const review = await prisma.collaborationReview.findFirstOrThrow({ where: { runId: fixture.run.id, status: 'pending' } });
  const artifact = await prisma.collaborationTaskArtifact.findUniqueOrThrow({ where: { id: review.artifactId } });
  return { ...fixture, revisionArtifact, review, artifact };
}

async function insertHistoricalArtifact(prisma, fixture, task, generation, status) {
  const now = new Date();
  const attempt = await prisma.collaborationTaskAttempt.create({ data: {
    runId: fixture.run.id, taskId: task.id, generation, agentId: task.assigneeAgentId,
    attemptNumber: 1, status: 'completed', claimIdempotencyKey: `historical-${randomUUID()}`,
    leaseTokenHash: 'b'.repeat(64), leaseStartedAt: new Date(now.getTime() - 5_000),
    leaseExpiresAt: new Date(now.getTime() + 5_000), maxExecutionAt: new Date(now.getTime() + 10_000),
    finishedAt: now,
  } });
  return prisma.collaborationTaskArtifact.create({ data: {
    runId: fixture.run.id, taskId: task.id, attemptId: attempt.id, generation, version: 1,
    kind: 'markdown', status, payload: { markdown: 'historical' }, evidence: [],
    acceptedAt: status === 'accepted' ? now : null,
  } });
}

function taskNode(id, todoNames = ['Complete']) {
  return {
    kind: 'agent_task', id, name: id, roleSlotId: 'role-0', objective: 'Execute fixture', inputKeys: [],
    upstreamArtifacts: [], output: { key: `output-${id}`, kind: 'markdown' }, evidenceRequired: [],
    humanAcceptance: false, leaseSeconds: 60, maxExecutionSeconds: 600, retryBudget: 1, repairBudget: 1,
    skippable: false,
    todos: todoNames.map((name, index) => ({ id: `todo-${index}`, name, required: true, evidenceKinds: [] })),
  };
}

function nextInput(runId, idempotencyKey) {
  return { runId, idempotencyKey, waitSeconds: 0 };
}

async function expireAttempt(prisma, attemptId) {
  await prisma.collaborationTaskAttempt.update({
    where: { id: attemptId }, data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
  });
}

async function assertBusinessCode(promise, code) {
  await assert.rejects(promise, (error) => error?.businessCode === code);
}
