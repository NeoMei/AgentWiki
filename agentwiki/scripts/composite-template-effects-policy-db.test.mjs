import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertTestRedisAvailable, resolveTestRedisTarget } from './e2e-safety.mjs';
import { withPageTemplateTestDatabase } from './page-template-test-database.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { JwtService } = requireFromServer('@nestjs/jwt');
const { Client } = requireFromServer('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = requireFromServer('@modelcontextprotocol/sdk/client/streamableHttp.js');
const protocol = requireFromServer('@neomei/agentwiki-sync-protocol');
const { SearchService } = requireFromServer('./dist/core/search/search.service.js');
const { TemplateEffectsService } = requireFromServer('./dist/page-templates/template-effects.service.js');
const baseDatabaseUrl = process.env.PAGE_TEMPLATE_TEST_DATABASE_URL;

if (!baseDatabaseUrl) throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL is required');
const redisTarget = resolveTestRedisTarget(
  process.env.PAGE_TEMPLATE_TEST_REDIS_URL ?? process.env.TEST_REDIS_URL,
);
assertTestRedisAvailable(redisTarget);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function createFixture(prisma, suffix) {
  const userId = `effects_user_${suffix}`;
  const spaceId = `effects_space_${suffix}`;
  const templateId = `effects_template_${suffix}`;
  const versionId = `effects_version_${suffix}`;
  const instantiationId = `effects_instantiation_${suffix}`;
  const agentId = `effects_agent_${suffix}`;
  const runId = `effects_run_${suffix}`;
  const taskId = `effects_task_${suffix}`;
  const pageId = `effects_page_${suffix}`;
  const rawApiKey = `agk_${randomBytes(24).toString('base64url')}`;
  const initialPageContent = '# Existing Page';
  const snapshot = {
    schemaVersion: 1,
    inputs: [],
    roleSlots: [{ id: 'writer', name: 'Writer', required: true, description: 'Writes' }],
    nodes: [{
      kind: 'agent_task', id: 'draft', name: 'Draft', roleSlotId: 'writer', objective: 'Draft',
      inputKeys: [], upstreamArtifacts: [], output: { key: 'draft-output', kind: 'markdown' },
      evidenceRequired: [], humanAcceptance: true, leaseSeconds: 60, maxExecutionSeconds: 600,
      retryBudget: 1, repairBudget: 1, skippable: false,
      todos: [{ id: 'write', name: 'Write', required: true, evidenceKinds: [] }],
    }, {
      kind: 'human_review', id: 'review-draft', name: 'Review Draft',
      artifactTaskId: 'draft', revisionTaskId: 'draft', minimumRole: 'editor',
      reviewerUserIds: [], approvalCriteria: ['Complete'], allowTerminate: true,
    }],
    dependencies: [{ from: 'draft', to: 'review-draft', mode: 'all' }],
    terminalNodeIds: ['review-draft'],
  };
  await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, type: 'human' } });
  await prisma.space.create({ data: { id: spaceId, name: 'Effects fixture', slug: spaceId } });
  await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
  await prisma.agent.create({ data: { id: agentId, name: 'Writer', ownerId: userId, status: 'active' } });
  const grant = await prisma.agentGrant.create({ data: {
    agentId, spaceId, role: 'editor',
  } });
  await prisma.agentCredential.create({ data: {
    name: 'Effects fixture credential', prefix: rawApiKey.slice(0, 12),
    keyHash: sha256(rawApiKey), agentId, authorizationId: grant.id,
  } });
  const page = await prisma.page.create({ data: {
    id: pageId, spaceId, authorId: userId, title: 'Existing Page',
    slug: `existing-${suffix}`, content: initialPageContent, format: 'markdown',
    syncPath: `pages/${pageId}.md`, syncPathKey: `pages/${pageId}.md`,
  } });
  await prisma.pageTemplate.create({ data: {
    id: templateId, scope: 'system', scopeKey: 'system', stableKey: `effects-${suffix}`,
    category: 'planning', displayOrder: 1,
    nameI18n: { en: 'Effects' }, descriptionI18n: { en: '' },
    defaultTitleI18n: { en: 'Effects' }, currentVersion: 1,
  } });
  await prisma.pageTemplateVersion.create({ data: {
    id: versionId, templateId, version: 1, contentI18n: { en: '' }, contentHash: sha256(''),
    definition: {
      schemaVersion: 1, kind: 'single_page', collaboration: null,
      nodes: [{ nodeId: 'page', parentNodeId: null, kind: 'page', order: 0,
        titleI18n: { en: 'Page' }, contentI18n: { en: '# Page' }, roleSlotKey: null }],
    }, schemaVersion: 1, definitionHash: sha256('fixture-definition'),
  } });
  await prisma.templateInstantiation.create({ data: {
    id: instantiationId, spaceId, compositeTemplateVersionId: versionId,
    createdByUserId: userId, idempotencyKey: `effects-${suffix}`,
    requestHash: sha256(`effects-${suffix}`), treeRevision: 0n,
    result: {}, status: 'completed', completedAt: new Date(),
  } });
  await prisma.collaborationRun.create({ data: {
    id: runId, spaceId, sourceKind: 'composite', compositeTemplateVersionId: versionId,
    templateInstantiationId: instantiationId, templateVersion: 1,
    templateSnapshot: snapshot, snapshotHash: sha256(JSON.stringify(snapshot)),
    name: 'Existing composite run', status: 'paused', version: 1, inputs: {},
    startedById: userId, pauseReason: 'maintenance', startedAt: new Date(),
  } });
  await prisma.collaborationRoleBinding.create({ data: {
    runId, roleSlotId: 'writer', roleSlotName: 'Writer', agentId,
  } });
  await prisma.collaborationRunTask.create({ data: {
    id: taskId, runId, nodeId: 'draft', ordinal: 0, name: 'Draft', objective: 'Draft',
    roleSlotId: 'writer', assigneeAgentId: agentId, status: 'ready', generation: 1,
    dependencyMode: 'all', outputContract: { key: 'draft-output', kind: 'markdown' },
    requiredEvidence: [], humanAcceptance: true, skippable: false,
    leaseSeconds: 60, maxExecutionSeconds: 600, retryBudget: 1, repairBudget: 1,
    targetPageId: pageId, targetSpaceId: spaceId, basePageVersionId: null,
    basePageUpdatedAt: page.updatedAt, baseContentHash: sha256(initialPageContent),
  } });
  await prisma.collaborationTaskTodo.create({ data: {
    runId, taskId, generation: 1, templateId: 'write', ordinal: 0,
    name: 'Write', required: true, status: 'pending',
  } });
  return { userId, spaceId, instantiationId, runId, taskId, pageId, rawApiKey };
}

function createEffectService(prisma, handlers = {}) {
  return new TemplateEffectsService(
    prisma,
    { get: (_key, fallback) => fallback } ,
    { indexPage: handlers.indexPage ?? (async () => ({ lexicalIndexed: true, semanticIndexed: true })) },
    { refresh: handlers.refresh ?? (async () => ({ llm: { reason: 'not_enough_pages' } })) },
    { publishCurrentRun: handlers.publishCurrentRun ?? (async () => undefined) },
  );
}

test('durable effects use real PostgreSQL claim fences and deduplicate concurrent workers', {
  timeout: 120_000,
}, async () => {
  await withPageTemplateTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName, publicInventoryDigest }) => {
    const first = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const second = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const fixture = await createFixture(first, randomUUID().replaceAll('-', ''));
    let publishes = 0;
    try {
      const rows = await first.templateEffectJob.createMany({
        data: Array.from({ length: 2 }, () => ({
          instantiationId: fixture.instantiationId, spaceId: fixture.spaceId,
          effectKey: `collaboration-run:${fixture.runId}`, kind: 'collaboration_run',
          payload: { runId: fixture.runId },
        })),
        skipDuplicates: true,
      });
      assert.equal(rows.count, 1);
      const publishCurrentRun = async () => { publishes += 1; };
      const [left, right] = await Promise.all([
        createEffectService(first, { publishCurrentRun }).drain(),
        createEffectService(second, { publishCurrentRun }).drain(),
      ]);
      assert.equal(left.claimed + right.claimed, 1);
      assert.equal(publishes, 1);
      assert.deepEqual(await first.templateEffectJob.findMany({
        select: { status: true, attempts: true, lockedAt: true, lastError: true },
      }), [{ status: 'done', attempts: 1, lockedAt: null, lastError: null }]);

      await first.templateEffectJob.create({ data: {
        instantiationId: fixture.instantiationId, spaceId: fixture.spaceId,
        effectKey: `collaboration-run-retry:${fixture.runId}`, kind: 'collaboration_run',
        payload: { runId: fixture.runId },
      } });
      let retryPublishes = 0;
      const retryService = createEffectService(first, {
        publishCurrentRun: async () => {
          retryPublishes += 1;
          if (retryPublishes === 1) throw new Error('temporary boundary failure');
        },
      });
      const beforeFailure = new Date();
      await retryService.drain();
      const pending = await first.templateEffectJob.findUniqueOrThrow({
        where: {
          instantiationId_effectKey: {
            instantiationId: fixture.instantiationId,
            effectKey: `collaboration-run-retry:${fixture.runId}`,
          },
        },
      });
      assert.equal(pending.status, 'pending');
      assert.equal(pending.attempts, 1);
      assert.equal(pending.lastError, 'TEMPLATE_EFFECT_HANDLER_FAILED');
      assert.ok(pending.availableAt > beforeFailure);
      await first.templateEffectJob.update({
        where: { id: pending.id }, data: { availableAt: new Date(0) },
      });
      await retryService.drain();
      assert.deepEqual(await first.templateEffectJob.findUniqueOrThrow({
        where: { id: pending.id }, select: { status: true, attempts: true, lastError: true },
      }), { status: 'done', attempts: 2, lastError: null });

      const staleVector = `[${Array.from({ length: 2048 }, () => '0').join(',')}]`;
      await first.$executeRawUnsafe(
        'UPDATE "Page" SET "embeddingVector" = $1::public.halfvec WHERE "id" = $2',
        staleVector,
        fixture.pageId,
      );
      let releaseOldEmbedding;
      const oldEmbeddingReleased = new Promise((resolveRelease) => {
        releaseOldEmbedding = resolveRelease;
      });
      let markOldEmbeddingStarted;
      const oldEmbeddingStarted = new Promise((resolveStarted) => {
        markOldEmbeddingStarted = resolveStarted;
      });
      const oldSearch = new SearchService(first, {
        generateEmbedding: async () => {
          markOldEmbeddingStarted();
          await oldEmbeddingReleased;
          return { embedding: Array(2048).fill(0.1) };
        },
      });
      const oldAttempt = oldSearch.indexPage(fixture.pageId, { requireSemanticWrite: true });
      await oldEmbeddingStarted;
      await first.page.update({
        where: { id: fixture.pageId },
        data: { title: 'Newer Page', content: '# Newer Page' },
      });
      const newerSearch = new SearchService(first, {
        generateEmbedding: async () => { throw new Error('isolated embedding failure'); },
      });
      assert.deepEqual(
        await newerSearch.indexPage(fixture.pageId, { requireSemanticWrite: true }),
        { lexicalIndexed: true, semanticIndexed: false },
      );
      releaseOldEmbedding();
      assert.deepEqual(await oldAttempt, {
        lexicalIndexed: true, semanticIndexed: false, superseded: true,
      });
      const retrySearch = new SearchService(first, {
        generateEmbedding: async () => ({ embedding: Array(2048).fill(0.2) }),
      });
      assert.deepEqual(
        await retrySearch.indexPage(fixture.pageId, { requireSemanticWrite: true }),
        { lexicalIndexed: true, semanticIndexed: true },
      );
      process.stdout.write(`${JSON.stringify({
        check: 'durable-effect-claim-retry-and-semantic-fence', schemaName, publicInventoryDigest,
      })}\n`);
    } finally {
      await Promise.all([first.$disconnect(), second.$disconnect()]);
    }
  });
});

test('default-closed production HTTP blocks new writes while an existing composite Run completes Page publication', {
  timeout: 120_000,
}, async () => {
  await withPageTemplateTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName, publicInventoryDigest }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const fixture = await createFixture(prisma, randomUUID().replaceAll('-', ''));
    const port = await availablePort();
    const jwtSecret = `effects-policy-jwt-${randomUUID()}-${randomUUID()}`;
    const token = new JwtService({ secret: jwtSecret }).sign({
      sub: fixture.userId,
      email: `${fixture.userId}@example.test`,
      type: 'human',
      platformRole: 'user',
      authVersion: 0,
      passwordChangeRequired: false,
    });
    const apiUrl = `http://127.0.0.1:${port}/api`;
    await access(resolve(root, 'apps/server/dist/main.js'));
    const api = startProcess(resolve(root, 'apps/server/dist/main.js'), {
      ...process.env,
      NODE_ENV: 'test',
      PROCESS_ROLE: 'api',
      AGENTWIKI_LISTEN_HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisTarget.url,
      JWT_SECRET: jwtSecret,
      AGENTWIKI_SERVER_PEPPER: `effects-policy-pepper-${randomUUID()}`,
      AGENTWIKI_DEPLOYMENT_SEED: randomBytes(32).toString('base64'),
      LOCAL_SYNC_PACKAGE_VERSION: '0.7.0',
      PUBLIC_API_URL: apiUrl,
      MCP_ALLOWED_HOSTS: '127.0.0.1,localhost',
      CORS_ORIGINS: `http://127.0.0.1:${port}`,
      COMPOSITE_TEMPLATE_SPACE_ALLOWLIST: '',
    });
    try {
      await waitForHealth(apiUrl, api);
      const catalog = await request(apiUrl, `/spaces/${fixture.spaceId}/templates?locale=en&take=1`, { token });
      assert.equal(catalog.data.capabilities.canCreate, false);
      const definition = {
        schemaVersion: 1, kind: 'single_page', collaboration: null,
        nodes: [{ nodeId: 'page', parentNodeId: null, kind: 'page', order: 0,
          titleI18n: { en: 'Page' }, contentI18n: { en: '# Page' }, roleSlotKey: null }],
      };
      const denied = await request(apiUrl, `/spaces/${fixture.spaceId}/templates`, {
        method: 'POST', token, expected: [409],
        body: {
          name: 'Must remain disabled', description: '', category: 'planning',
          defaultTitle: 'Disabled', locale: 'en', definition,
        },
      });
      assert.equal(denied.data.code, 'COMPOSITE_TEMPLATE_FEATURE_DISABLED');
      const legacy = await request(apiUrl, `/spaces/${fixture.spaceId}/page-templates?locale=en&scope=all&archived=active&skip=0&take=1`, { token });
      assert.equal(legacy.status, 200);

      const resumed = await request(
        apiUrl,
        `/spaces/${fixture.spaceId}/collaboration/runs/${fixture.runId}/actions/resume`,
        {
          method: 'POST', token,
          body: { reason: 'continue after rollout close', idempotencyKey: `resume-${randomUUID()}` },
        },
      );
      assert.equal(resumed.data.status, 'running');
      assert.equal((await prisma.collaborationRun.findUniqueOrThrow({
        where: { id: fixture.runId }, select: { status: true, pauseReason: true },
      })).pauseReason, null);

      const agent = await connectMcp(apiUrl, fixture.rawApiKey);
      const submittedMarkdown = '# Completed after rollout close\n\nPublished by the existing Run.';
      try {
        const claim = await callJsonTool(agent, 'collaboration_next_action', {
          runId: fixture.runId, idempotencyKey: `claim-${randomUUID()}`, waitSeconds: 0,
        });
        protocol.CollaborationNextActionOutputSchema.parse(claim);
        assert.equal(claim.action, 'execute_task');
        assert.equal(claim.task.id, fixture.taskId);
        for (const todo of claim.task.todos) {
          protocol.CollaborationUpdateTodoOutputSchema.parse(await callJsonTool(
            agent,
            'collaboration_update_todo',
            {
              runId: fixture.runId, attemptId: claim.attemptId, todoId: todo.id,
              leaseToken: claim.leaseToken, status: 'done', evidence: [],
              idempotencyKey: `todo-${randomUUID()}`,
            },
          ));
        }
        const submitted = await callJsonTool(agent, 'collaboration_submit_result', {
          runId: fixture.runId, attemptId: claim.attemptId, leaseToken: claim.leaseToken,
          artifact: { kind: 'markdown', markdown: submittedMarkdown, evidence: [] },
          idempotencyKey: `submit-${randomUUID()}`,
        });
        protocol.CollaborationSubmitResultOutputSchema.parse(submitted);
        assert.equal(submitted.runStatus, 'waiting_review');
      } finally {
        await agent.close();
      }

      const humanRun = await request(
        apiUrl,
        `/spaces/${fixture.spaceId}/collaboration/runs/${fixture.runId}`,
        { token },
      );
      const review = humanRun.data.reviews.find((item) => item.status === 'pending');
      assert.ok(review, 'the submitted Page result must create one pending human review');
      const approved = await request(
        apiUrl,
        `/spaces/${fixture.spaceId}/collaboration/runs/${fixture.runId}/reviews/${review.id}/decision`,
        {
          method: 'POST', token,
          body: {
            kind: 'approve', reason: 'Complete existing Run after rollout close',
            idempotencyKey: `approve-${randomUUID()}`,
          },
        },
      );
      assert.equal(approved.data.status, 'completed');
      assert.equal((await prisma.page.findUniqueOrThrow({ where: { id: fixture.pageId } })).content, submittedMarkdown);
      assert.equal(await prisma.pageVersion.count({
        where: { pageId: fixture.pageId, content: submittedMarkdown },
      }), 1);
      assert.ok(await prisma.pageTemplate.count({ where: { scope: 'system' } }) > 0, 'seed must remain ungated');
      process.stdout.write(`${JSON.stringify({
        check: 'feature-off-http-existing-run-continuation', schemaName, publicInventoryDigest,
      })}\n`);
    } finally {
      await stopProcess(api);
      await prisma.$disconnect();
    }
  });
});

async function request(apiUrl, path, { method = 'GET', token, body, expected } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  const accepted = expected ?? [...Array.from({ length: 100 }, (_value, index) => index + 200)];
  if (!accepted.includes(response.status)) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 1_000)}`);
  }
  return { status: response.status, data };
}

function startProcess(entry, env) {
  const child = spawn(process.execPath, [entry], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.output = '';
  const append = (chunk) => { child.output = `${child.output}${chunk}`.slice(-40_000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  return child;
}

async function waitForHealth(apiUrl, child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API exited early (${child.exitCode}):\n${child.output}`);
    try {
      const response = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok && (await response.json()).status === 'ok') return;
    } catch {
      // The API is expected to refuse connections until Nest finishes booting.
    }
    await delay(250);
  }
  throw new Error(`API health timed out:\n${child.output}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(5_000).then(() => child.kill('SIGKILL')),
  ]);
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function connectMcp(apiUrl, apiKey) {
  const client = new Client({ name: 'effects-policy-db-test', version: '0.7.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${apiUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  });
  await client.connect(transport);
  return client;
}

async function callJsonTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, `${name} failed: ${toolText(result)}`);
  return JSON.parse(toolText(result));
}

function toolText(result) {
  const item = result.content?.find((candidate) => candidate.type === 'text');
  assert.equal(typeof item?.text, 'string');
  return item.text;
}
