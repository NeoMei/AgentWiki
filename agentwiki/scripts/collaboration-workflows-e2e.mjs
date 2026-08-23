import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { withCollaborationTestDatabase } from './collaboration-test-database.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { Client } = requireFromServer('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = requireFromServer('@modelcontextprotocol/sdk/client/streamableHttp.js');
const protocol = requireFromServer('@neomei/agentwiki-sync-protocol');
const baseDatabaseUrl = process.env.COLLABORATION_TEST_DATABASE_URL;
const REQUIRED_TOOLS = Object.freeze([
  'collaboration_join_run', 'collaboration_next_action', 'collaboration_heartbeat',
  'collaboration_update_todo', 'collaboration_submit_result', 'collaboration_get_run',
]);

if (!baseDatabaseUrl) {
  throw new Error('COLLABORATION_TEST_DATABASE_URL is required; skipped HTTP/MCP runs do not satisfy collaboration acceptance');
}

await access(resolve(root, 'apps/server/dist/main.js')).catch(() => {
  throw new Error('Server build is missing. Run pnpm --filter @agentwiki/server build before this E2E gate.');
});

await withCollaborationTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
  assert.match(schemaName, /^collaboration_test_[a-z0-9_]+$/u);
  assert.notEqual(schemaName, 'public');
  const port = await availablePort();
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const deploymentSeed = randomBytes(32).toString('base64');
  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    REDIS_URL: process.env.COLLABORATION_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379',
    JWT_SECRET: `collaboration-e2e-jwt-${randomUUID()}-${randomUUID()}`,
    AGENTWIKI_SERVER_PEPPER: `collaboration-e2e-pepper-${randomUUID()}`,
    AGENTWIKI_DEPLOYMENT_SEED: deploymentSeed,
    LOCAL_SYNC_PACKAGE_VERSION: '0.6.0',
    PUBLIC_API_URL: `http://127.0.0.1:${port}/api`,
    MCP_ALLOWED_HOSTS: '127.0.0.1,localhost',
    CORS_ORIGINS: `http://127.0.0.1:${port}`,
  };
  const api = startProcess('api', resolve(root, 'apps/server/dist/main.js'), { ...environment, PROCESS_ROLE: 'api' });
  let worker;
  try {
    const apiUrl = `http://127.0.0.1:${port}/api`;
    await waitForHealth(apiUrl, api);
    worker = startProcess('worker', resolve(root, 'apps/server/dist/worker.js'), { ...environment, PROCESS_ROLE: 'worker' });
    await waitForOutput(worker, /AgentWiki ingestion worker started/u, 30_000);

    const owner = await register(apiUrl, `owner-${suffix}@example.test`, `Owner-${suffix}!`, 'Workflow Owner');
    const editorHuman = await register(apiUrl, `editor-${suffix}@example.test`, `Editor-${suffix}!`, 'Workflow Editor');
    const viewerHuman = await register(apiUrl, `viewer-${suffix}@example.test`, `Viewer-${suffix}!`, 'Workflow Viewer');
    const space = (await request(apiUrl, '/spaces', {
      method: 'POST', token: owner.token, body: { name: `Collaboration E2E ${suffix}` },
    })).data;
    await request(apiUrl, `/spaces/${space.id}/members`, {
      method: 'POST', token: owner.token, body: { email: editorHuman.email, role: 'editor' },
    });
    await request(apiUrl, `/spaces/${space.id}/members`, {
      method: 'POST', token: owner.token, body: { email: viewerHuman.email, role: 'viewer' },
    });

    const workerAgent = await createConnectedAgent(apiUrl, owner.token, space.id, `Editor Agent ${suffix}`, 'editor');
    const publisherAgent = await createConnectedAgent(apiUrl, owner.token, space.id, `Publisher Agent ${suffix}`, 'publisher');
    const observerAgent = await createConnectedAgent(apiUrl, owner.token, space.id, `Reader Agent ${suffix}`, 'editor');
    const alternateAgent = await createConnectedAgent(apiUrl, owner.token, space.id, `Alternate Agent ${suffix}`, 'editor');

    const definition = collaborationDefinition();
    const template = (await request(apiUrl, `/spaces/${space.id}/collaboration/templates`, {
      method: 'POST', token: owner.token,
      body: { name: `E2E workflow ${suffix}`, slug: `e2e-${suffix.toLowerCase()}`, description: 'Isolated HTTP/MCP acceptance', definition },
    })).data;
    const draft = (await request(apiUrl, `/spaces/${space.id}/collaboration/runs/drafts`, {
      method: 'POST', token: editorHuman.token,
      body: {
        templateId: template.id, name: `E2E run ${suffix}`, inputs: { brief: 'Exercise every collaboration boundary.' },
        roleBindings: [
          { roleSlotId: 'worker', agentId: workerAgent.id },
          { roleSlotId: 'finisher', agentId: publisherAgent.id },
          { roleSlotId: 'observer', agentId: observerAgent.id },
        ],
      },
    })).data;
    assert.equal(draft.status, 'draft');
    const validated = (await request(apiUrl, `/spaces/${space.id}/collaboration/runs/${draft.id}/validate`, {
      method: 'POST', token: editorHuman.token, body: { expectedVersion: draft.version },
    })).data;
    assert.equal(validated.status, 'ready');
    const started = (await request(apiUrl, `/spaces/${space.id}/collaboration/runs/${draft.id}/start`, {
      method: 'POST', token: editorHuman.token,
      body: { expectedVersion: validated.version, idempotencyKey: `start-${suffix}` },
    })).data;
    assert.equal(started.status, 'running');
    assert.equal(started.tasks.length, 2);

    await request(apiUrl, `/agents/${observerAgent.id}/grants/${space.id}`, {
      method: 'PUT', token: owner.token, body: { role: 'reader' },
    });

    await verifyHumanPermissions(apiUrl, space.id, draft.id, owner, editorHuman, viewerHuman, template.id);
    await verifyToolManifest(apiUrl, workerAgent.apiKey);

    const reader = await connectMcp(apiUrl, observerAgent.apiKey, `reader-${suffix}`);
    try {
      const readerView = await callJsonTool(reader, 'collaboration_get_run', { runId: draft.id });
      protocol.CollaborationGetRunOutputSchema.parse(readerView);
      assert.equal(readerView.runId, draft.id);
      assert.equal(readerView.assignedTasks.length, 0);
      const denied = await reader.callTool({ name: 'collaboration_join_run', arguments: { runId: draft.id } });
      assert.equal(denied.isError, true);
      assert.match(toolText(denied), /scope|collaboration:execute|denied|permission/iu);
    } finally {
      await reader.close();
    }

    const editor = await connectMcp(apiUrl, workerAgent.apiKey, `editor-${suffix}`);
    let firstClaim;
    try {
      const joinInput = protocol.CollaborationJoinRunInputSchema.parse({ runId: draft.id });
      const joined = await callJsonTool(editor, 'collaboration_join_run', joinInput);
      protocol.CollaborationJoinRunOutputSchema.parse(joined);
      assert.equal(joined.protocol.nextActionTool, 'wiki_collaboration_next_action');

      const nextInput = protocol.CollaborationNextActionInputSchema.parse({
        runId: draft.id, idempotencyKey: `next-editor-${suffix}`, waitSeconds: 0,
      });
      firstClaim = await callJsonTool(editor, 'collaboration_next_action', nextInput);
      protocol.CollaborationNextActionOutputSchema.parse(firstClaim);
      assert.equal(firstClaim.action, 'execute_task');
      assert.equal(firstClaim.task.nodeId, 'draft');

      const heartbeatInput = protocol.CollaborationHeartbeatInputSchema.parse({
        runId: draft.id, attemptId: firstClaim.attemptId, leaseToken: firstClaim.leaseToken,
        idempotencyKey: `heartbeat-${suffix}`,
      });
      protocol.CollaborationHeartbeatOutputSchema.parse(
        await callJsonTool(editor, 'collaboration_heartbeat', heartbeatInput),
      );

      for (const todo of firstClaim.task.todos) {
        const todoInput = protocol.CollaborationUpdateTodoInputSchema.parse({
          runId: draft.id, attemptId: firstClaim.attemptId, todoId: todo.id, leaseToken: firstClaim.leaseToken,
          status: 'done', evidence: [], idempotencyKey: `todo-${todo.ordinal}-${suffix}`,
        });
        const todoResult = await callJsonTool(editor, 'collaboration_update_todo', todoInput);
        protocol.CollaborationUpdateTodoOutputSchema.parse(todoResult);
        assert.equal(todoResult.todo.status, 'done');
      }

      const submitInput = protocol.CollaborationSubmitResultInputSchema.parse({
        runId: draft.id, attemptId: firstClaim.attemptId, leaseToken: firstClaim.leaseToken,
        artifact: { kind: 'markdown', markdown: '# Draft\n\nReady for human review.', evidence: [] },
        idempotencyKey: `submit-editor-${suffix}`,
      });
      const submitted = await callJsonTool(editor, 'collaboration_submit_result', submitInput);
      protocol.CollaborationSubmitResultOutputSchema.parse(submitted);
      assert.equal(submitted.runStatus, 'waiting_review');

      const waiting = await callJsonTool(editor, 'collaboration_next_action', {
        runId: draft.id, idempotencyKey: `waiting-human-${suffix}`, waitSeconds: 0,
      });
      protocol.CollaborationNextActionOutputSchema.parse(waiting);
      assert.deepEqual(waiting, {
        action: 'waiting_human', resumeRequired: true, message: 'Human review is required',
      });
    } finally {
      await editor.close();
    }

    let humanRun = (await request(apiUrl, `/spaces/${space.id}/collaboration/runs/${draft.id}`, {
      token: viewerHuman.token,
    })).data;
    const review = humanRun.reviews.find((item) => item.status === 'pending');
    assert.ok(review);
    const approved = (await request(apiUrl, `/spaces/${space.id}/collaboration/runs/${draft.id}/reviews/${review.id}/decision`, {
      method: 'POST', token: editorHuman.token,
      body: { kind: 'approve', reason: 'Human acceptance in E2E', idempotencyKey: `approve-${suffix}` },
    })).data;
    assert.equal(approved.status, 'running');

    humanRun = (await request(apiUrl, `/spaces/${space.id}/collaboration/runs/${draft.id}`, { token: owner.token })).data;
    const finalTask = humanRun.tasks.find((item) => item.nodeId === 'finalize');
    assert.equal(finalTask.status, 'ready');
    const reassigned = (await request(apiUrl, `/spaces/${space.id}/collaboration/runs/${draft.id}/tasks/${finalTask.id}/reassign`, {
      method: 'POST', token: owner.token,
      body: { agentId: alternateAgent.id, reason: 'Verify assignment-based participation', idempotencyKey: `reassign-${suffix}` },
    })).data;
    assert.ok(reassigned.joinInstructions.some((item) => item.agentId === alternateAgent.id && item.taskIds.includes(finalTask.id)));

    const alternate = await connectMcp(apiUrl, alternateAgent.apiKey, `alternate-${suffix}`);
    try {
      const joined = await callJsonTool(alternate, 'collaboration_join_run', { runId: draft.id });
      protocol.CollaborationJoinRunOutputSchema.parse(joined);
      assert.equal(joined.roleSlots.length, 0);
      const claim = await callJsonTool(alternate, 'collaboration_next_action', {
        runId: draft.id, idempotencyKey: `next-alternate-${suffix}`, waitSeconds: 0,
      });
      protocol.CollaborationNextActionOutputSchema.parse(claim);
      assert.equal(claim.task.nodeId, 'finalize');
      for (const todo of claim.task.todos) {
        const result = await callJsonTool(alternate, 'collaboration_update_todo', {
          runId: draft.id, attemptId: claim.attemptId, todoId: todo.id, leaseToken: claim.leaseToken,
          status: 'done', evidence: [], idempotencyKey: `alternate-todo-${todo.ordinal}-${suffix}`,
        });
        protocol.CollaborationUpdateTodoOutputSchema.parse(result);
      }
      const completed = await callJsonTool(alternate, 'collaboration_submit_result', {
        runId: draft.id, attemptId: claim.attemptId, leaseToken: claim.leaseToken,
        artifact: { kind: 'markdown', markdown: '# Final\n\nWorkflow complete.', evidence: [] },
        idempotencyKey: `submit-alternate-${suffix}`,
      });
      protocol.CollaborationSubmitResultOutputSchema.parse(completed);
      assert.equal(completed.action, 'submitted');
      assert.equal(completed.taskStatus, 'completed');
      assert.equal(completed.runStatus, 'completed');
      const participationEnded = await alternate.callTool({
        name: 'collaboration_next_action',
        arguments: { runId: draft.id, idempotencyKey: `terminal-${suffix}`, waitSeconds: 0 },
      });
      assert.equal(participationEnded.isError, true);
      assert.match(toolText(participationEnded), /not bound|assigned participant|COLLABORATION_AGENT_NOT_BOUND/iu);
    } finally {
      await alternate.close();
    }

    const finalRun = (await request(apiUrl, `/spaces/${space.id}/collaboration/runs/${draft.id}`, { token: viewerHuman.token })).data;
    assert.equal(finalRun.status, 'completed');
    assert.equal(finalRun.tasks.every((task) => task.status === 'completed'), true);
    assert.equal(finalRun.reviews.every((item) => item.status === 'approved'), true);
    assert.equal(finalRun.events.some((event) => event.operation === 'reassign_task'), true);

    process.stdout.write(JSON.stringify({
      status: 'PASS', schemaName, checks: {
        humanRoles: ['owner', 'editor', 'viewer'], agentRoles: ['reader', 'editor', 'publisher'],
        tools: REQUIRED_TOOLS, flow: 'draft-start-mcp-review-reassign-complete', worker: 'started',
      },
    }) + '\n');
  } finally {
    await stopProcess(worker);
    await stopProcess(api);
  }
});

function collaborationDefinition() {
  const task = (id, name, roleSlotId, outputKey, todos, upstreamArtifacts = []) => ({
    kind: 'agent_task', id, name, roleSlotId, objective: name, inputKeys: id === 'draft' ? ['brief'] : [],
    upstreamArtifacts, output: { key: outputKey, kind: 'markdown' }, evidenceRequired: [], humanAcceptance: id === 'draft',
    leaseSeconds: 60, maxExecutionSeconds: 600, retryBudget: 1, repairBudget: 1, skippable: false,
    todos: todos.map((todo, index) => ({ id: `todo-${id}-${index}`, name: todo, required: true, evidenceKinds: [] })),
  });
  return {
    schemaVersion: 1,
    inputs: [{ key: 'brief', label: 'Brief', required: true, type: 'long_text' }],
    roleSlots: [
      { id: 'worker', name: 'Worker', required: true, description: 'Creates the reviewed draft' },
      { id: 'finisher', name: 'Finisher', required: true, description: 'Produces the final Artifact' },
      { id: 'observer', name: 'Observer', required: true, description: 'Read-only participant after start' },
    ],
    nodes: [
      task('draft', 'Draft the result', 'worker', 'draft-artifact', ['Inspect input', 'Write draft']),
      {
        kind: 'human_review', id: 'human-review', name: 'Human review', artifactTaskId: 'draft',
        minimumRole: 'editor', reviewerUserIds: [], approvalCriteria: ['Draft is complete'],
        revisionTaskId: 'draft', allowTerminate: true,
      },
      task('finalize', 'Finalize the result', 'finisher', 'final-artifact', ['Integrate approval'], [
        { key: 'draft-artifact', required: true },
      ]),
    ],
    dependencies: [
      { from: 'draft', to: 'human-review', mode: 'all' },
      { from: 'human-review', to: 'finalize', mode: 'all' },
    ],
    terminalNodeIds: ['finalize'],
  };
}

async function verifyHumanPermissions(apiUrl, spaceId, runId, owner, editor, viewer, templateId) {
  assert.equal((await request(apiUrl, `/spaces/${spaceId}/collaboration/runs/${runId}`, { token: viewer.token })).status, 200);
  assert.equal((await request(apiUrl, `/spaces/${spaceId}/collaboration/templates`, { token: editor.token })).status, 200);
  const denied = await request(apiUrl, `/spaces/${spaceId}/collaboration/runs/drafts`, {
    method: 'POST', token: viewer.token, expected: [403],
    body: { templateId, name: 'Viewer cannot create', inputs: {}, roleBindings: [] },
  });
  assert.equal(denied.status, 403);
  assert.ok(owner.token && editor.token && viewer.token);
}

async function verifyToolManifest(apiUrl, apiKey) {
  const client = await connectMcp(apiUrl, apiKey, 'manifest-check');
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    for (const name of REQUIRED_TOOLS) assert.ok(names.includes(name), `missing MCP tool: ${name}`);
    for (const humanTool of ['collaboration_approve', 'collaboration_reassign', 'collaboration_cancel']) {
      assert.equal(names.includes(humanTool), false, `human control leaked to MCP: ${humanTool}`);
    }
  } finally {
    await client.close();
  }
}

async function createConnectedAgent(apiUrl, token, spaceId, name, role) {
  const agent = (await request(apiUrl, '/agents', { method: 'POST', token, body: { name } })).data;
  const installation = (await request(apiUrl, `/agents/${agent.id}/local-sync-installations`, {
    method: 'POST', token, body: { spaceId, role, pluginVersion: '0.6.0' },
  })).data;
  const exchange = (await request(apiUrl, '/integrations/local-sync/exchange', {
    method: 'POST', body: { code: installation.code },
  })).data;
  assert.equal(exchange.role, role);
  assert.equal(exchange.spaceId, spaceId);
  assert.match(exchange.apiKey, /^agk_/u);
  return { ...agent, apiKey: exchange.apiKey, credentialId: exchange.credentialId };
}

async function register(apiUrl, email, password, name) {
  const response = await request(apiUrl, '/auth/register', { method: 'POST', body: { email, password, name } });
  assert.match(response.data.access_token, /\S/u);
  return { ...response.data.user, email, token: response.data.access_token };
}

async function connectMcp(apiUrl, apiKey, name) {
  const client = new Client({ name: `collaboration-e2e-${name}`, version: '0.6.0' });
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
  const accepted = expected ?? [...Array.from({ length: 100 }, (_, index) => index + 200)];
  if (!accepted.includes(response.status)) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 1_000)}`);
  }
  return { status: response.status, data };
}

function startProcess(label, entry, env) {
  const child = spawn(process.execPath, [entry], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.label = label;
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
      if (response.ok) {
        const body = await response.json();
        if (body.status === 'ok') return;
      }
    } catch {
      // Startup races are expected until Nest begins listening.
    }
    await delay(250);
  }
  throw new Error(`API health timed out:\n${child.output}`);
}

async function waitForOutput(child, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(child.output)) return;
    if (child.exitCode !== null) throw new Error(`${child.label} exited early (${child.exitCode}):\n${child.output}`);
    await delay(100);
  }
  throw new Error(`${child.label} startup timed out:\n${child.output}`);
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
