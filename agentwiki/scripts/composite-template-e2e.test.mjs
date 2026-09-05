import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  acceptanceChildEnvironment,
  acceptanceCompletionStatus,
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

test('external Agent receipt distinguishes requested tools from successful results for every CLI', () => {
  const receipt = [
    JSON.stringify({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'agentwiki', tool: 'wiki_collaboration_join_run' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'agentwiki', tool: 'wiki_collaboration_join_run', status: 'failed', result: null, error: 'approval denied' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'agentwiki', tool: 'wiki_collaboration_next_action', status: 'completed', result: { content: [{ type: 'text', text: '{}' }] }, error: null } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'claude-1', name: 'mcp__agentwiki__wiki_collaboration_update_todo' }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'claude-1', is_error: false, content: 'ok' }] } }),
    JSON.stringify({ type: 'tool_use', part: { type: 'tool', tool: 'agentwiki_wiki_collaboration_submit_result', state: { status: 'completed', output: '{}' } } }),
    JSON.stringify({ type: 'tool_use', part: { type: 'tool', tool: 'agentwiki_wiki_collaboration_heartbeat', state: { status: 'error', error: 'failed' } } }),
    JSON.stringify({ type: 'assistant', text: 'I plan to call wiki_collaboration_submit_result later.' }),
  ].join('\n');
  assert.deepEqual(extractCollaborationToolReceipt(receipt), {
    requested: [
      'wiki_collaboration_join_run',
      'wiki_collaboration_next_action',
      'wiki_collaboration_update_todo',
      'wiki_collaboration_submit_result',
      'wiki_collaboration_heartbeat',
    ],
    succeeded: [
      'wiki_collaboration_next_action',
      'wiki_collaboration_update_todo',
      'wiki_collaboration_submit_result',
    ],
  });
  assert.deepEqual(extractExecutedCollaborationTools(receipt), [
    'wiki_collaboration_next_action',
    'wiki_collaboration_update_todo',
    'wiki_collaboration_submit_result',
  ]);
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
