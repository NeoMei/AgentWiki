import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { assertLoopbackDatabaseHost } from './test-database-url-safety.mjs';
import {
  assertFolderDatabaseSafetyPreflight,
  captureFolderDatabaseSafetyInventory,
  folderDatabaseSafetyInventoryDigest,
  withFolderMigrationBundle,
} from './folder-test-database.mjs';
import { boundedMigrationOptions, spawnPnpmSync } from './package-manager-process.mjs';
import { withTestDatabaseCleanup } from './test-database-lifecycle.mjs';

const SAFE_SCHEMA = /^mac_e2e_[A-Za-z0-9_]+$/u;
const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');

export function validateCompositeTemplateE2EDatabaseUrl(value) {
  if (!value) throw new Error('COMPOSITE_TEMPLATE_E2E_DATABASE_URL is required');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('COMPOSITE_TEMPLATE_E2E_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('COMPOSITE_TEMPLATE_E2E_DATABASE_URL must use PostgreSQL');
  }
  assertLoopbackDatabaseHost(parsed, 'COMPOSITE_TEMPLATE_E2E_DATABASE_URL');
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!databaseName || !databaseName.toLowerCase().includes('test')) {
    throw new Error('COMPOSITE_TEMPLATE_E2E_DATABASE_URL database name must contain test');
  }
  const schemas = parsed.searchParams.getAll('schema');
  if (schemas.length > 1 || (schemas.length === 1 && !SAFE_SCHEMA.test(schemas[0]))) {
    throw new Error('COMPOSITE_TEMPLATE_E2E_DATABASE_URL schema must use mac_e2e_*');
  }
  return parsed;
}

export function acceptanceChildEnvironment({
  parent,
  databaseUrl,
  redisUrl,
  apiPort,
  webOrigin,
  spaceId,
}) {
  return {
    ...parent,
    NODE_ENV: 'test',
    PROCESS_ROLE: 'api',
    AGENTWIKI_LISTEN_HOST: '127.0.0.1',
    PORT: String(apiPort),
    DATABASE_URL: databaseUrl,
    COLLABORATION_TEST_DATABASE_URL: databaseUrl,
    SYNC_V3_TEST_DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    TEST_REDIS_URL: redisUrl,
    COLLABORATION_TEST_REDIS_URL: redisUrl,
    JWT_SECRET: `composite-e2e-jwt-${randomUUID()}-${randomUUID()}`,
    AGENTWIKI_SERVER_PEPPER: `composite-e2e-pepper-${randomUUID()}`,
    AGENTWIKI_DEPLOYMENT_SEED: randomBytes(32).toString('base64'),
    LOCAL_SYNC_PACKAGE_VERSION: '0.7.0',
    PUBLIC_API_URL: `http://127.0.0.1:${apiPort}/api`,
    MCP_ALLOWED_HOSTS: '127.0.0.1,localhost',
    CORS_ORIGINS: webOrigin,
    COMPOSITE_TEMPLATE_SPACE_ALLOWLIST: spaceId,
    OPENROUTER_API_KEY: '',
    LLM_GATEWAY: 'openrouter',
  };
}

export async function collectContentTree(loadChildren) {
  const nodes = [];
  const pendingFolders = [null];
  while (pendingFolders.length) {
    const parentFolderId = pendingFolders.shift();
    let cursor;
    do {
      const response = await loadChildren(parentFolderId, cursor);
      if (!response || !Array.isArray(response.data)) {
        throw new Error('Content-tree response must contain a data array');
      }
      nodes.push(...response.data);
      for (const node of response.data) {
        if (node?.kind === 'folder' && typeof node.id === 'string') pendingFolders.push(node.id);
      }
      cursor = typeof response.nextCursor === 'string' && response.nextCursor ? response.nextCursor : undefined;
    } while (cursor);
  }
  return nodes;
}

export function assertCollaborationOffPersistence({
  beforeTreeRevision,
  afterTreeRevision,
  instantiation,
  bindingCount,
}) {
  if (afterTreeRevision !== beforeTreeRevision + 1n) {
    throw new Error('Collaboration-off instantiation must advance contentTreeRevision exactly one');
  }
  if (instantiation.treeRevision !== afterTreeRevision) {
    throw new Error('Collaboration-off instantiation treeRevision does not match the Space revision');
  }
  const stored = instantiation.result;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)
    || typeof stored.treeRevision !== 'string' || !Array.isArray(stored.pageIds)) {
    throw new Error('Collaboration-off instantiation result is invalid');
  }
  if (BigInt(stored.treeRevision) !== afterTreeRevision) {
    throw new Error('Collaboration-off result treeRevision does not match the Space revision');
  }
  const nodePageIds = instantiation.nodes
    .map((node) => node.pageId)
    .filter((pageId) => typeof pageId === 'string')
    .sort();
  const resultPageIds = stored.pageIds
    .filter((pageId) => typeof pageId === 'string')
    .sort();
  if (!isDeepStrictEqual(nodePageIds, resultPageIds)) {
    throw new Error('Collaboration-off created Page scope does not match its instantiation result');
  }
  if (bindingCount !== 0) {
    throw new Error('Collaboration-off created Page scope must have zero PageAgentBinding rows');
  }
  return {
    instantiationId: instantiation.id,
    treeRevisionBefore: beforeTreeRevision.toString(),
    treeRevisionAfter: afterTreeRevision.toString(),
    createdPageCount: resultPageIds.length,
    bindingCount,
  };
}

export function buildExternalAgentStagePrompt({ client, runId, stage }) {
  if (!client || !runId || !stage) throw new Error('External Agent prompt requires client, runId, and stage');
  return `${client} isolated AgentWiki acceptance stage ${stage}.

This is a bounded test fixture. Use only the AgentWiki MCP tools named below. Do not use shell, files, browser, generic network tools, subagents, or human-review tools.

Run ID: ${runId}

1. Call wiki_collaboration_join_run with that Run ID.
2. Call wiki_collaboration_next_action with that Run ID, waitSeconds 0, and a fresh idempotency key beginning acceptance-${stage}-next-.
   If the initial action is not execute_task, report it and stop; do not poll.
3. If the action is execute_task, handle exactly one task. For each returned Todo in ordinal order, call wiki_collaboration_update_todo first with doing and then with done, using the returned attempt ID and lease token, empty evidence, a concise summary, and a fresh idempotency key for every write.
4. Submit exactly one Markdown result with wiki_collaboration_submit_result. The Markdown must truthfully address the returned task objective and project input, be concise, include the literal marker "External Agent acceptance: ${stage}", and use empty evidence. Use the returned attempt ID and lease token and a fresh idempotency key.
5. Call wiki_collaboration_next_action once more with waitSeconds 0 and a fresh idempotency key. If it returns waiting_human, paused, or any terminal action, report that status and stop safely. On waiting_human do not poll and do not attempt human approval.

Never reveal an API key or lease token in the final response. Return only a concise receipt naming the tool sequence, task ID, submit action/status, and final next-action kind.`;
}

export function externalAgentGatewayFiles({
  client,
  apiUrl,
  agent,
  fixtureHome,
  cliPath,
  nodePath,
  connectionId,
}) {
  const wrapperPath = join(fixtureHome, `gateway-${client}.mjs`);
  const wrapperSource = `import { runCli } from ${JSON.stringify(cliPath)};\nawait runCli(['gateway','--connection',${JSON.stringify(connectionId)}], ${JSON.stringify(fixtureHome)});\n`;
  return {
    wrapperPath,
    wrapperSource,
    localSync: {
      version: 1,
      defaultConnectionId: connectionId,
      connections: {
        [connectionId]: {
          id: connectionId,
          serverUrl: apiUrl,
          agentId: agent.id,
          credentialId: agent.credentialId,
          pluginVersion: '0.7.0',
          client,
          mcpName: 'agentwiki',
        },
      },
    },
    credentials: { version: 2, credentials: { [agent.credentialId]: { apiKey: agent.apiKey } } },
    mcpConfig: { mcpServers: { agentwiki: { command: nodePath, args: [wrapperPath] } } },
    openCodeConfig: {
      $schema: 'https://opencode.ai/config.json',
      permission: { '*': 'deny', 'agentwiki_*': 'allow' },
      mcp: { agentwiki: { type: 'local', command: [nodePath, wrapperPath], enabled: true, timeout: 300_000 } },
    },
  };
}

function collaborationToolName(value) {
  if (typeof value !== 'string') return undefined;
  return value.match(/(wiki_collaboration_[a-z_]+)$/u)?.[1];
}

function parsedToolPayload(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return undefined; }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parsedToolPayload(item);
      if (parsed !== undefined) return parsed;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value.content)) return parsedToolPayload(value.content);
  if (typeof value.text === 'string') return parsedToolPayload(value.text);
  return value;
}

function safeRequestedInput(tool, input) {
  const value = input && typeof input === 'object' ? input : {};
  if (tool === 'wiki_collaboration_join_run') return { ...(typeof value.runId === 'string' ? { runId: value.runId } : {}) };
  if (tool === 'wiki_collaboration_next_action') return {
    ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
    ...(Number.isInteger(value.waitSeconds) ? { waitSeconds: value.waitSeconds } : {}),
  };
  if (tool === 'wiki_collaboration_update_todo') return {
    ...(typeof value.todoId === 'string' ? { todoId: value.todoId } : {}),
    ...(typeof value.status === 'string' ? { status: value.status } : {}),
  };
  if (tool === 'wiki_collaboration_submit_result') return {
    ...(typeof value.artifact?.kind === 'string' ? { artifactKind: value.artifact.kind } : {}),
  };
  return {};
}

function safeResultSummary(tool, rawResult) {
  const value = parsedToolPayload(rawResult);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  if (tool === 'wiki_collaboration_join_run') return {
    ...(typeof value.status === 'string' ? { status: value.status } : {}),
  };
  if (tool === 'wiki_collaboration_next_action') return {
    ...(typeof value.action === 'string' ? { action: value.action } : {}),
    ...(typeof value.task?.id === 'string' ? { taskId: value.task.id } : {}),
    ...(Array.isArray(value.task?.todos) ? {
      todos: value.task.todos.flatMap((todo) => typeof todo?.id === 'string' && Number.isInteger(todo.ordinal)
        ? [{ id: todo.id, ordinal: todo.ordinal }]
        : []),
    } : {}),
  };
  if (tool === 'wiki_collaboration_update_todo') return {
    ...(typeof value.todo?.id === 'string' ? { todoId: value.todo.id } : {}),
    ...(typeof value.todo?.status === 'string' ? { todoStatus: value.todo.status } : {}),
    ...(typeof value.taskStatus === 'string' ? { taskStatus: value.taskStatus } : {}),
  };
  if (tool === 'wiki_collaboration_submit_result') return {
    ...(typeof value.action === 'string' ? { action: value.action } : {}),
    ...(typeof value.artifactStatus === 'string' ? { artifactStatus: value.artifactStatus } : {}),
    ...(typeof value.taskStatus === 'string' ? { taskStatus: value.taskStatus } : {}),
    ...(typeof value.runStatus === 'string' ? { runStatus: value.runStatus } : {}),
  };
  return {};
}

export function extractCollaborationToolReceipt(output) {
  const requestedCalls = [];
  const successfulCalls = [];
  const claudeRequests = new Map();
  const codexRequestIds = new Set();
  const request = (tool, input, id) => {
    if (!tool || (id && codexRequestIds.has(id))) return;
    requestedCalls.push({ tool, input: safeRequestedInput(tool, input) });
    if (id) codexRequestIds.add(id);
  };
  const succeed = (tool, input, result) => {
    if (!tool) return;
    successfulCalls.push({
      tool,
      input: safeRequestedInput(tool, input),
      result: safeResultSummary(tool, result),
    });
  };
  for (const line of output.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const item = event?.item;
    if (item?.type === 'mcp_tool_call') {
      const name = collaborationToolName(item.tool);
      request(name, item.arguments, item.id);
      const resultFailed = item.result?.isError === true || item.result?.is_error === true;
      if (event.type === 'item.completed' && item.status === 'completed' && !item.error && item.result && !resultFailed) {
        succeed(name, item.arguments, item.result);
      }
    }
    const claudeContent = event?.message?.content;
    if (Array.isArray(claudeContent)) {
      for (const block of claudeContent) {
        if (block?.type === 'tool_use') {
          const name = collaborationToolName(block.name);
          request(name, block.input);
          if (name && typeof block.id === 'string') claudeRequests.set(block.id, { tool: name, input: block.input });
        } else if (block?.type === 'tool_result') {
          const pending = claudeRequests.get(block.tool_use_id);
          if (pending && block.is_error !== true && block.isError !== true) {
            succeed(pending.tool, pending.input, block.content);
          }
        }
      }
    }
    const part = event?.part;
    if (part?.type === 'tool') {
      const name = collaborationToolName(part.tool);
      request(name, part.state?.input);
      if (part.state?.status === 'completed' && part.state?.error == null) {
        succeed(name, part.state?.input, part.state?.output);
      }
    }
  }
  return { requestedCalls, successfulCalls };
}

export function extractExecutedCollaborationTools(output) {
  return extractCollaborationToolReceipt(output).successfulCalls.map((call) => call.tool);
}

export function assertExternalAgentSuccessfulSequence(calls) {
  const expectTool = (index, tool) => {
    if (calls[index]?.tool !== tool) throw new Error(`External Agent receipt expected ${tool} at successful call ${index + 1}`);
  };
  expectTool(0, 'wiki_collaboration_join_run');
  if (calls[0].result?.status !== 'running') throw new Error('External Agent join must return running');
  expectTool(1, 'wiki_collaboration_next_action');
  const execute = calls[1];
  const todos = execute?.result?.todos;
  const todoCount = Array.isArray(todos) ? todos.length : 0;
  if (execute.result?.action !== 'execute_task' || typeof execute.result?.taskId !== 'string' || todoCount < 1) {
    throw new Error('External Agent initial next_action must return execute_task with Todos');
  }
  const expectedCount = 4 + (todoCount * 2);
  if (calls.length !== expectedCount) {
    throw new Error(`External Agent receipt needs exact successful call count ${expectedCount}, got ${calls.length}`);
  }
  const orderedTodos = [...todos].sort((left, right) => left.ordinal - right.ordinal);
  for (const [ordinalIndex, todo] of orderedTodos.entries()) {
    const doingIndex = 2 + (ordinalIndex * 2);
    const doneIndex = doingIndex + 1;
    expectTool(doingIndex, 'wiki_collaboration_update_todo');
    if (calls[doingIndex].input?.todoId !== todo.id || calls[doingIndex].input?.status !== 'doing'
      || calls[doingIndex].result?.todoId !== todo.id || calls[doingIndex].result?.todoStatus !== 'doing') {
      throw new Error(`External Agent Todo doing transition is invalid for ordinal ${todo.ordinal}`);
    }
    expectTool(doneIndex, 'wiki_collaboration_update_todo');
    if (calls[doneIndex].input?.todoId !== todo.id || calls[doneIndex].input?.status !== 'done'
      || calls[doneIndex].result?.todoId !== todo.id || calls[doneIndex].result?.todoStatus !== 'done') {
      throw new Error(`External Agent Todo done transition is invalid for ordinal ${todo.ordinal}`);
    }
  }
  const submitIndex = 2 + (todoCount * 2);
  expectTool(submitIndex, 'wiki_collaboration_submit_result');
  const submit = calls[submitIndex];
  if (submit.input?.artifactKind !== 'markdown' || submit.result?.action !== 'submitted'
    || submit.result?.artifactStatus !== 'pending' || submit.result?.taskStatus !== 'submitted'
    || submit.result?.runStatus !== 'waiting_review') {
    throw new Error('External Agent submit must return submitted/pending waiting_review state');
  }
  expectTool(submitIndex + 1, 'wiki_collaboration_next_action');
  if (calls[submitIndex + 1].result?.action !== 'waiting_human') {
    throw new Error('External Agent final next_action must return waiting_human');
  }
  return { taskId: execute.result.taskId, todoCount, finalAction: 'waiting_human' };
}

export function externalAgentClientArgs({
  client,
  fixtureHome,
  wrapperPath,
  mcpConfigPath,
  prompt,
  lastMessagePath,
  nodePath,
}) {
  if (client === 'codex') return [
    'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
    '--approve-for-me', '-C', fixtureHome,
    '--model', 'gpt-5.4-mini',
    '-c', `mcp_servers.agentwiki.command=${JSON.stringify(nodePath)}`,
    '-c', `mcp_servers.agentwiki.args=${JSON.stringify([wrapperPath])}`,
    '--json', '--output-last-message', lastMessagePath, prompt,
  ];
  if (client === 'opencode') return [
    'run', '--pure', '--model', 'deepseek/deepseek-v4-flash', '--variant', 'low',
    '--format', 'json', '--dir', fixtureHome, prompt,
  ];
  return [
    '--print', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--no-chrome',
    '--model', 'haiku', '--effort', 'low', '--setting-sources', '', '--disable-slash-commands',
    '--strict-mcp-config', '--mcp-config', mcpConfigPath,
    '--tools', '', '--allowedTools', [
      'mcp__agentwiki__wiki_collaboration_join_run',
      'mcp__agentwiki__wiki_collaboration_next_action',
      'mcp__agentwiki__wiki_collaboration_heartbeat',
      'mcp__agentwiki__wiki_collaboration_update_todo',
      'mcp__agentwiki__wiki_collaboration_submit_result',
      'mcp__agentwiki__wiki_collaboration_get_run',
    ].join(','),
    '--permission-mode', 'dontAsk', '--max-budget-usd', '1', prompt,
  ];
}

export function externalAgentClientEnvironment({ client, parent, openCodeConfig }) {
  if (client === 'claude') {
    return Object.fromEntries(Object.entries(parent).filter(([name]) => name !== 'ANTHROPIC_AUTH_TOKEN'));
  }
  if (client === 'opencode') {
    return { ...parent, OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig) };
  }
  return parent;
}

export function selectExternalAgentStages(selection = 'all') {
  if (selection === 'none') return [];
  if (selection === 'opencode') {
    return [{ key: 'opencode', label: 'OpenCode', stage: 'opencode-initial', evidence: 11 }];
  }
  if (selection !== 'all') {
    throw new Error('COMPOSITE_TEMPLATE_E2E_EXTERNAL_STAGES must be all, opencode, or none');
  }
  return [
    { key: 'codex', label: 'Codex', stage: 'codex-initial', evidence: 7 },
    { key: 'codex', label: 'Codex', stage: 'codex-resume-after-review-1', evidence: 9 },
    { key: 'opencode', label: 'OpenCode', stage: 'opencode-initial-after-review-2', evidence: 11 },
  ];
}

export function selectExternalAgentRoleAssignments(selection, agents) {
  return {
    projectOwner: selection === 'opencode' ? agents.opencode : agents.codex,
    executionOwner: agents.opencode,
    riskReviewer: agents.codex,
  };
}

export function acceptanceCompletionStatus(full, evidence) {
  if (!full) return 'STARTUP_READY';
  const successfulClients = new Set((evidence?.externalAgents?.clients ?? [])
    .filter((client) => client.exitCode === 0)
    .map((client) => client.client));
  return evidence?.scenariosPassed === 6
    && successfulClients.has('codex')
    && (successfulClients.has('claude') || successfulClients.has('opencode'))
    ? 'ACCEPTANCE_COMPLETE'
    : 'ACCEPTANCE_PARTIAL';
}

export function assertPublishedPageVersionPair({ beforeVersions, afterVersions, priorContent, publishedContent }) {
  const priorIds = new Set(beforeVersions.map((version) => version.id));
  const created = afterVersions.filter((version) => !priorIds.has(version.id));
  if (created.length !== 2) throw new Error(`Expected exactly two PageVersions for one reviewed publication, got ${created.length}`);
  const contents = created.map((version) => version.content);
  if (!contents.includes(priorContent)) throw new Error('Reviewed publication is missing its immutable before-image PageVersion');
  if (!contents.includes(publishedContent)) throw new Error('Reviewed publication is missing its immutable after-image PageVersion');
}

function quoteIdentifier(value) {
  if (!SAFE_SCHEMA.test(value)) throw new Error('Refusing unsafe composite E2E schema identifier');
  return `"${value.replaceAll('"', '""')}"`;
}

export async function withCompositeTemplateE2EDatabase(baseDatabaseUrl, callback) {
  const parsed = validateCompositeTemplateE2EDatabaseUrl(baseDatabaseUrl);
  parsed.searchParams.delete('schema');
  const administrativeUrl = parsed.toString();
  return withFolderMigrationBundle({}, async (preparedMigrations) => {
    const schemaName = `mac_e2e_${randomUUID().replaceAll('-', '')}`;
    const schemaSql = quoteIdentifier(schemaName);
    const testUrl = new URL(administrativeUrl);
    testUrl.searchParams.set('schema', schemaName);
    const databaseUrl = testUrl.toString();
    const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl } } });
    let schemaCreated = false;
    let safetyInventory;
    return withTestDatabaseCleanup(
      'Composite template E2E database',
      async () => {
        await assertFolderDatabaseSafetyPreflight(prisma);
        safetyInventory = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
        await prisma.$executeRawUnsafe(`CREATE SCHEMA ${schemaSql}`);
        schemaCreated = true;
        const migration = spawnPnpmSync([
          '--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy',
          '--schema', preparedMigrations.schemaPath,
        ], boundedMigrationOptions({
          cwd: new URL('..', import.meta.url),
          encoding: 'utf8',
          env: { ...process.env, DATABASE_URL: databaseUrl },
        }));
        if (migration.error || migration.status !== 0) {
          const details = [migration.error?.message, migration.stdout, migration.stderr].filter(Boolean).join('\n');
          throw new Error(`Composite E2E migration failed:\n${details}`);
        }
        const afterMigration = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
        if (!isDeepStrictEqual(afterMigration, safetyInventory)) {
          throw new Error('Composite E2E migration changed protected public inventory');
        }
        return callback({
          databaseUrl,
          schemaName,
          migrationTreeDigest: preparedMigrations.treeDigest,
          publicInventoryDigest: folderDatabaseSafetyInventoryDigest(safetyInventory),
        });
      },
      [
        async () => {
          if (safetyInventory) {
            const finalInventory = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
            if (!isDeepStrictEqual(finalInventory, safetyInventory)) {
              throw new Error('Composite E2E test changed protected public inventory');
            }
          }
        },
        async () => { if (schemaCreated) await prisma.$executeRawUnsafe(`DROP SCHEMA ${schemaSql} CASCADE`); },
        async () => prisma.$disconnect(),
      ],
    );
  });
}
