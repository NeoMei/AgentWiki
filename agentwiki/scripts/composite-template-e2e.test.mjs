import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  acceptanceChildEnvironment,
  acceptanceCompletionStatus,
  assertCollaborationOffPersistence,
  assertExternalAgentSuccessfulSequence,
  assertExternalAgentReceipt,
  buildExternalAgentStagePrompt,
  collectContentTree,
  externalAgentGatewayFiles,
  externalAgentClientArgs,
  externalAgentClientEnvironment,
  extractCollaborationToolReceipt,
  extractExecutedCollaborationTools,
  selectExternalAgentStages,
  selectExternalAgentRoleAssignments,
  assertPublishedPageVersionPair,
  validateCompositeTemplateE2EDatabaseUrl,
} from './composite-template-e2e-support.mjs';

const script = fileURLToPath(new URL('./composite-template-e2e.mjs', import.meta.url));

function baseEnvironment() {
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  delete environment.COMPOSITE_TEMPLATE_E2E_DATABASE_URL;
  delete environment.PAGE_TEMPLATE_TEST_DATABASE_URL;
  delete environment.TEST_REDIS_URL;
  delete environment.COMPOSITE_TEMPLATE_E2E_REDIS_URL;
  delete environment.COMPOSITE_TEMPLATE_E2E_ARTIFACTS_DIR;
  return environment;
}

test('composite acceptance plan fails closed without its dedicated database and Redis', () => {
  const databaseMissing = spawnSync(process.execPath, [script, 'plan'], {
    encoding: 'utf8',
    env: {
      ...baseEnvironment(),
      COMPOSITE_TEMPLATE_E2E_REDIS_URL: 'redis://127.0.0.1:50416/0',
    },
  });
  assert.notEqual(databaseMissing.status, 0);
  assert.match(`${databaseMissing.stdout}${databaseMissing.stderr}`, /COMPOSITE_TEMPLATE_E2E_DATABASE_URL is required/u);

  const redisMissing = spawnSync(process.execPath, [script, 'plan'], {
    encoding: 'utf8',
    env: {
      ...baseEnvironment(),
      COMPOSITE_TEMPLATE_E2E_DATABASE_URL: 'postgresql://tester:secret@127.0.0.1/agentwiki_test',
    },
  });
  assert.notEqual(redisMissing.status, 0);
  assert.match(`${redisMissing.stdout}${redisMissing.stderr}`, /TEST_REDIS_URL is required/u);
});

test('composite acceptance plan is secret-free and declares the exact isolation and browser contract', () => {
  const result = spawnSync(process.execPath, [script, 'plan'], {
    encoding: 'utf8',
    env: {
      ...baseEnvironment(),
      COMPOSITE_TEMPLATE_E2E_DATABASE_URL: 'postgresql://tester:secret@127.0.0.1/agentwiki_test',
      COMPOSITE_TEMPLATE_E2E_REDIS_URL: 'redis://:redis-secret@127.0.0.1:1/0',
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan, {
    status: 'ready',
    databaseIsolation: 'one random mac_e2e_* schema',
    browser: 'repo Playwright with installed Chrome',
    viewports: ['desktop', '390px'],
    locales: ['zh-CN', 'en'],
    scenarios: 6,
    externalAgents: ['codex', 'claude-or-opencode-fallback'],
  });
  assert.doesNotMatch(result.stdout, /secret|postgresql:|redis:/u);
});

test('acceptance child environment is bound to one generated schema, exact ports, and exact Space allowlist', () => {
  const generatedDatabaseUrl = 'postgresql://tester:secret@127.0.0.1:50415/agentwiki_composite_test?schema=mac_e2e_abc123';
  const result = acceptanceChildEnvironment({
    parent: {
      OPENROUTER_API_KEY: 'paid-parent-key',
      LLM_GATEWAY: 'another-provider',
      REDIS_URL: 'redis://127.0.0.1:6379/0',
      DATABASE_URL: 'postgresql://tester@127.0.0.1:50415/agentwiki_composite_test',
      SYNC_V3_TEST_DATABASE_URL: 'postgresql://tester@127.0.0.1:50415/agentwiki_composite_test',
    },
    databaseUrl: generatedDatabaseUrl,
    redisUrl: 'redis://127.0.0.1:50416/0',
    apiPort: 43123,
    webOrigin: 'http://127.0.0.1:43124',
    spaceId: 'space-exact',
  });

  assert.equal(result.NODE_ENV, 'test');
  assert.equal(result.PROCESS_ROLE, 'api');
  assert.equal(result.AGENTWIKI_LISTEN_HOST, '127.0.0.1');
  assert.equal(result.PORT, '43123');
  assert.equal(result.DATABASE_URL, generatedDatabaseUrl);
  assert.equal(result.SYNC_V3_TEST_DATABASE_URL, generatedDatabaseUrl);
  assert.equal(result.COLLABORATION_TEST_DATABASE_URL, generatedDatabaseUrl);
  assert.equal(result.REDIS_URL, 'redis://127.0.0.1:50416/0');
  assert.equal(result.TEST_REDIS_URL, 'redis://127.0.0.1:50416/0');
  assert.equal(result.COMPOSITE_TEMPLATE_SPACE_ALLOWLIST, 'space-exact');
  assert.equal(result.OPENROUTER_API_KEY, '');
  assert.equal(result.LLM_GATEWAY, 'openrouter');
  assert.equal(result.PUBLIC_API_URL, 'http://127.0.0.1:43123/api');
  assert.equal(result.CORS_ORIGINS, 'http://127.0.0.1:43124');
  assert.doesNotMatch(JSON.stringify(result), /127\.0\.0\.1:6379/u);
});

test('acceptance database rejects public or non-mac schemas', () => {
  assert.throws(
    () => validateCompositeTemplateE2EDatabaseUrl('postgresql://tester@127.0.0.1/agentwiki_test?schema=public'),
    /schema must use mac_e2e/u,
  );
  assert.throws(
    () => validateCompositeTemplateE2EDatabaseUrl('postgresql://tester@127.0.0.1/agentwiki_test?schema=collaboration_test_wrong'),
    /schema must use mac_e2e/u,
  );
});

test('acceptance persistence proof walks every nested content-tree folder', async () => {
  const calls = [];
  const byParent = new Map([
    [null, [{ kind: 'folder', id: 'root', name: 'Root' }]],
    ['root', [{ kind: 'page', id: 'overview', title: 'Overview' }, { kind: 'folder', id: 'plan', name: 'Plan' }]],
    ['plan', [{ kind: 'page', id: 'milestones', title: 'Milestones' }]],
  ]);
  const nodes = await collectContentTree(async (parentFolderId) => {
    calls.push(parentFolderId);
    return { data: byParent.get(parentFolderId) ?? [] };
  });
  assert.deepEqual(calls, [null, 'root', 'plan']);
  assert.deepEqual(nodes.map((node) => node.id), ['root', 'overview', 'plan', 'milestones']);
});

test('collaboration-off persistence rejects bindings and any revision proof other than one atomic advance', () => {
  const valid = {
    beforeTreeRevision: 4n,
    afterTreeRevision: 5n,
    instantiation: {
      id: 'instance-1', treeRevision: 5n,
      result: { treeRevision: '5', pageIds: ['page-1', 'page-2'] },
      nodes: [{ pageId: 'page-1' }, { pageId: 'page-2' }],
    },
    bindingCount: 0,
  };
  assert.deepEqual(assertCollaborationOffPersistence(valid), {
    instantiationId: 'instance-1', treeRevisionBefore: '4', treeRevisionAfter: '5',
    createdPageCount: 2, bindingCount: 0,
  });
  assert.throws(() => assertCollaborationOffPersistence({ ...valid, bindingCount: 1 }), /zero PageAgentBinding/u);
  assert.throws(() => assertCollaborationOffPersistence({ ...valid, afterTreeRevision: 6n }), /exactly one/u);
  assert.throws(() => assertCollaborationOffPersistence({
    ...valid, instantiation: { ...valid.instantiation, treeRevision: 4n },
  }), /instantiation treeRevision/u);
  assert.throws(() => assertCollaborationOffPersistence({
    ...valid, instantiation: { ...valid.instantiation, result: { ...valid.instantiation.result, treeRevision: '4' } },
  }), /result treeRevision/u);
});

test('external Agent stage prompt is bounded, copyable, and preserves the human gate', () => {
  const prompt = buildExternalAgentStagePrompt({
    client: 'Codex',
    runId: 'run-acceptance-1',
    stage: 'codex-initial',
  });
  assert.match(prompt, /wiki_collaboration_join_run/u);
  assert.match(prompt, /wiki_collaboration_next_action/u);
  assert.match(prompt, /wiki_collaboration_update_todo/u);
  assert.match(prompt, /wiki_collaboration_submit_result/u);
  assert.match(prompt, /exactly one task/u);
  assert.match(prompt, /waiting_human/u);
  assert.match(prompt, /If the initial action is not execute_task, report it and stop; do not poll/u);
  assert.match(prompt, /run-acceptance-1/u);
  assert.doesNotMatch(prompt, /apiKey|leaseToken.*print/iu);
});

test('external Agent gateway files pass an explicit fixture home without repurposing HOME', () => {
  const files = externalAgentGatewayFiles({
    client: 'claude',
    apiUrl: 'http://127.0.0.1:43123/api',
    agent: { id: 'agent-1', credentialId: 'credential-1', apiKey: 'fixture-secret' },
    fixtureHome: '/tmp/agentwiki-fixture-home',
    cliPath: '/workspace/local-sync/dist/cli.js',
    nodePath: '/usr/local/bin/node',
    connectionId: 'acceptance-claude',
  });
  assert.equal(files.localSync.version, 1);
  assert.equal(files.localSync.connections['acceptance-claude'].serverUrl, 'http://127.0.0.1:43123/api');
  assert.equal(files.credentials.credentials['credential-1'].apiKey, 'fixture-secret');
  assert.match(files.wrapperSource, /runCli\(\['gateway','--connection',["']acceptance-claude["']\],\s*["']\/tmp\/agentwiki-fixture-home["']\)/u);
  assert.deepEqual(files.mcpConfig, {
    mcpServers: { agentwiki: { command: '/usr/local/bin/node', args: [files.wrapperPath] } },
  });
  assert.deepEqual(files.openCodeConfig, {
    $schema: 'https://opencode.ai/config.json',
    permission: { '*': 'deny', 'agentwiki_*': 'allow' },
    mcp: { agentwiki: { type: 'local', command: ['/usr/local/bin/node', files.wrapperPath], enabled: true, timeout: 300_000 } },
  });
  assert.doesNotMatch(files.wrapperSource, /process\.env\.(?:HOME|CODEX_HOME)|homedir/u);
});

test('external Agent receipt preserves safe ordered successes for Codex, Claude, and OpenCode', () => {
  const receipt = [
    JSON.stringify({ type: 'item.started', item: { id: 'codex-failed', type: 'mcp_tool_call', tool: 'wiki_collaboration_join_run', arguments: { runId: 'run-1' } } }),
    JSON.stringify({ type: 'item.completed', item: { id: 'codex-failed', type: 'mcp_tool_call', tool: 'wiki_collaboration_join_run', arguments: { runId: 'run-1' }, status: 'failed', result: null, error: 'approval denied' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', tool: 'wiki_collaboration_next_action', arguments: { runId: 'run-1', waitSeconds: 0, idempotencyKey: 'secret-idempotency' }, status: 'completed', result: { content: [{ type: 'text', text: JSON.stringify({ action: 'execute_task', task: { id: 'task-1', todos: [{ id: 'todo-1', ordinal: 0 }] }, leaseToken: 'secret-lease' }) }] }, error: null } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'claude-1', name: 'mcp__agentwiki__wiki_collaboration_update_todo', input: { todoId: 'todo-1', status: 'doing', leaseToken: 'secret-lease' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'claude-1', is_error: false, content: JSON.stringify({ todo: { id: 'todo-1', status: 'doing' }, taskStatus: 'running' }) }] } }),
    JSON.stringify({ type: 'tool_use', part: { type: 'tool', tool: 'agentwiki_wiki_collaboration_submit_result', state: { status: 'completed', input: { artifact: { kind: 'markdown', markdown: 'raw secret body' }, leaseToken: 'secret-lease' }, output: JSON.stringify({ action: 'submitted', artifactStatus: 'pending', taskStatus: 'submitted', runStatus: 'waiting_review' }) } } }),
  ].join('\n');
  const parsed = extractCollaborationToolReceipt(receipt);
  assert.deepEqual(parsed.requestedCalls.map((call) => call.tool), [
    'wiki_collaboration_join_run', 'wiki_collaboration_next_action',
    'wiki_collaboration_update_todo', 'wiki_collaboration_submit_result',
  ]);
  assert.deepEqual(parsed.successfulCalls, [
    { tool: 'wiki_collaboration_next_action', input: { runId: 'run-1', waitSeconds: 0 }, result: { action: 'execute_task', taskId: 'task-1', todos: [{ id: 'todo-1', ordinal: 0 }] } },
    { tool: 'wiki_collaboration_update_todo', input: { todoId: 'todo-1', status: 'doing' }, result: { todoId: 'todo-1', todoStatus: 'doing', taskStatus: 'running' } },
    { tool: 'wiki_collaboration_submit_result', input: { artifactKind: 'markdown' }, result: { action: 'submitted', artifactStatus: 'pending', taskStatus: 'submitted', runStatus: 'waiting_review' } },
  ]);
  assert.deepEqual(extractExecutedCollaborationTools(receipt), parsed.successfulCalls.map((call) => call.tool));
  assert.doesNotMatch(JSON.stringify(parsed), /secret-|raw secret body|leaseToken|idempotencyKey/u);
});

test('external Agent sequence requires exact Todo transitions, submit state, and final human gate', () => {
  const valid = [
    { tool: 'wiki_collaboration_join_run', input: { runId: 'run-1' }, result: { status: 'running' } },
    { tool: 'wiki_collaboration_next_action', input: { runId: 'run-1', waitSeconds: 0 }, result: { action: 'execute_task', taskId: 'task-1', todos: [{ id: 'todo-1', ordinal: 0 }] } },
    { tool: 'wiki_collaboration_update_todo', input: { todoId: 'todo-1', status: 'doing' }, result: { todoId: 'todo-1', todoStatus: 'doing', taskStatus: 'running' } },
    { tool: 'wiki_collaboration_update_todo', input: { todoId: 'todo-1', status: 'done' }, result: { todoId: 'todo-1', todoStatus: 'done', taskStatus: 'running' } },
    { tool: 'wiki_collaboration_submit_result', input: { artifactKind: 'markdown' }, result: { action: 'submitted', artifactStatus: 'pending', taskStatus: 'submitted', runStatus: 'waiting_review' } },
    { tool: 'wiki_collaboration_next_action', input: { runId: 'run-1', waitSeconds: 0 }, result: { action: 'waiting_human' } },
  ];
  assert.deepEqual(assertExternalAgentSuccessfulSequence(valid), { taskId: 'task-1', todoCount: 1, finalAction: 'waiting_human' });
  assert.throws(() => assertExternalAgentSuccessfulSequence(valid.slice(0, -1)), /exact successful call count/u);
  assert.throws(() => assertExternalAgentSuccessfulSequence([...valid.slice(0, 4), valid[3], ...valid.slice(4)]), /exact successful call count/u);
  assert.throws(() => assertExternalAgentSuccessfulSequence([valid[1], valid[0], ...valid.slice(2)]), /expected wiki_collaboration_join_run/u);
  assert.throws(() => assertExternalAgentSuccessfulSequence(valid.map((call, index) => index === 2
    ? { ...call, input: { todoId: 'todo-1', status: 'done' } } : call)), /Todo doing/u);
  assert.throws(() => assertExternalAgentSuccessfulSequence(valid.map((call, index) => index === 4
    ? { ...call, result: { ...call.result, artifactStatus: 'accepted' } } : call)), /submitted\/pending/u);
  assert.throws(() => assertExternalAgentSuccessfulSequence(valid.map((call, index) => index === 5
    ? { ...call, result: { action: 'completed' } } : call)), /waiting_human/u);
});

test('external Agent receipt gate rejects failed or unmatched requests around a valid success sequence', () => {
  const successfulCalls = [
    { tool: 'wiki_collaboration_join_run', input: { runId: 'run-1' }, result: { status: 'running' } },
    { tool: 'wiki_collaboration_next_action', input: { runId: 'run-1', waitSeconds: 0 }, result: { action: 'execute_task', taskId: 'task-1', todos: [{ id: 'todo-1', ordinal: 0 }] } },
    { tool: 'wiki_collaboration_update_todo', input: { todoId: 'todo-1', status: 'doing' }, result: { todoId: 'todo-1', todoStatus: 'doing', taskStatus: 'running' } },
    { tool: 'wiki_collaboration_update_todo', input: { todoId: 'todo-1', status: 'done' }, result: { todoId: 'todo-1', todoStatus: 'done', taskStatus: 'running' } },
    { tool: 'wiki_collaboration_submit_result', input: { artifactKind: 'markdown' }, result: { action: 'submitted', artifactStatus: 'pending', taskStatus: 'submitted', runStatus: 'waiting_review' } },
    { tool: 'wiki_collaboration_next_action', input: { runId: 'run-1', waitSeconds: 0 }, result: { action: 'waiting_human' } },
  ];
  const requestedCalls = successfulCalls.map(({ tool, input }) => ({ tool, input }));
  assert.deepEqual(assertExternalAgentReceipt({ requestedCalls, successfulCalls }), {
    taskId: 'task-1', todoCount: 1, finalAction: 'waiting_human', requestedCount: 6, successfulCount: 6,
  });
  assert.throws(() => assertExternalAgentReceipt({
    requestedCalls: [{ tool: 'wiki_collaboration_join_run', input: { runId: 'failed-run' } }, ...requestedCalls],
    successfulCalls,
  }), /every requested call to succeed/u);
  assert.throws(() => assertExternalAgentReceipt({
    requestedCalls: requestedCalls.map((call, index) => index === 2
      ? { ...call, input: { todoId: 'different-todo', status: 'doing' } }
      : call),
    successfulCalls,
  }), /request\/success mismatch at call 3/u);
});

test('Codex external invocation uses automatic review in workspace-write without bypass flags', () => {
  const args = externalAgentClientArgs({
    client: 'codex',
    fixtureHome: '/tmp/fixture',
    wrapperPath: '/tmp/fixture/gateway.mjs',
    mcpConfigPath: '/tmp/fixture/mcp.json',
    prompt: 'bounded prompt',
    lastMessagePath: '/tmp/fixture/last.txt',
    nodePath: '/usr/local/bin/node',
  });
  assert.deepEqual(args.slice(0, 6), [
    'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
    '--approve-for-me', '-C',
  ]);
  assert.equal(args.includes('--sandbox'), false, 'Codex rejects an explicit --sandbox alongside --approve-for-me');
  assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
  assert.equal(args.includes('--ignore-rules'), false);
  assert.equal(args.includes('danger-full-access'), false);
});

test('OpenCode fallback uses the proven route and the isolated project config', () => {
  const args = externalAgentClientArgs({
    client: 'opencode', fixtureHome: '/tmp/fixture', wrapperPath: '/tmp/fixture/gateway.mjs',
    mcpConfigPath: '/tmp/fixture/opencode.json', prompt: 'bounded prompt',
    lastMessagePath: '/tmp/fixture/last.txt', nodePath: '/usr/local/bin/node',
  });
  assert.deepEqual(args, [
    'run', '--pure', '--model', 'deepseek/deepseek-v4-flash', '--variant', 'low',
    '--format', 'json', '--dir', '/tmp/fixture', 'bounded prompt',
  ]);
  assert.equal(args.includes('--auto'), false);
  const config = { permission: { '*': 'deny', 'agentwiki_*': 'allow' }, mcp: { agentwiki: { enabled: true } } };
  const environment = externalAgentClientEnvironment({
    client: 'opencode', parent: { HOME: '/real-home', OPENCODE_CONFIG_CONTENT: '{"old":true}' }, openCodeConfig: config,
  });
  assert.equal(environment.HOME, '/real-home');
  assert.equal(environment.OPENCODE_CONFIG_CONTENT, JSON.stringify(config));
});

test('external model stages can be isolated without replaying already accepted clients', () => {
  assert.deepEqual(selectExternalAgentStages('opencode'), [
    { key: 'opencode', label: 'OpenCode', stage: 'opencode-initial', evidence: 11 },
  ]);
  assert.deepEqual(selectExternalAgentStages('none'), []);
  assert.equal(selectExternalAgentStages('all').length, 3);
  assert.throws(() => selectExternalAgentStages('codex,opencode'), /all, opencode, or none/u);
  assert.deepEqual(selectExternalAgentRoleAssignments('opencode', { codex: 'agent-c', opencode: 'agent-o' }), {
    projectOwner: 'agent-o', executionOwner: 'agent-o', riskReviewer: 'agent-c',
  });
  assert.deepEqual(selectExternalAgentRoleAssignments('all', { codex: 'agent-c', opencode: 'agent-o' }), {
    projectOwner: 'agent-c', executionOwner: 'agent-o', riskReviewer: 'agent-c',
  });
});

test('acceptance status remains partial until all six journeys and both clients pass', () => {
  assert.equal(acceptanceCompletionStatus(false), 'STARTUP_READY');
  assert.equal(acceptanceCompletionStatus(true, { scenariosPassed: 2, externalAgents: { clients: [] } }), 'ACCEPTANCE_PARTIAL');
  assert.equal(acceptanceCompletionStatus(true, {
    scenariosPassed: 6,
    externalAgents: { clients: [{ client: 'codex', exitCode: 0 }, { client: 'opencode', exitCode: 0 }] },
  }), 'ACCEPTANCE_COMPLETE');
});

test('published Page evidence requires one before-image and one marked after-image', () => {
  assert.doesNotThrow(() => assertPublishedPageVersionPair({
    beforeVersions: [{ id: 'initial', content: '# Initial' }],
    afterVersions: [
      { id: 'after', content: '# Result\nExternal Agent acceptance: codex-initial' },
      { id: 'before', content: '# Initial' },
      { id: 'initial', content: '# Initial' },
    ],
    priorContent: '# Initial',
    publishedContent: '# Result\nExternal Agent acceptance: codex-initial',
  }));
  assert.throws(() => assertPublishedPageVersionPair({
    beforeVersions: [{ id: 'initial', content: '# Initial' }],
    afterVersions: [{ id: 'after', content: '# Result' }, { id: 'initial', content: '# Initial' }],
    priorContent: '# Initial',
    publishedContent: '# Result',
  }), /exactly two PageVersions/u);
});
