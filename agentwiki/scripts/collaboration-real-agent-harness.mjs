#!/usr/bin/env node

import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateCollaborationTestDatabaseUrl,
  withCollaborationTestDatabase,
} from './collaboration-test-database.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2];
const templateSlugs = [
  'coding',
  'bid-writing',
  'paper-writing',
  'video-script-writing',
  'novel-writing',
];

validateCollaborationTestDatabaseUrl(process.env.COLLABORATION_TEST_DATABASE_URL);

if (command === 'plan') {
  process.stdout.write(`${JSON.stringify({
    status: 'ready',
    clients: ['codex', 'claude'],
    templates: templateSlugs,
    databaseIsolation: 'random collaboration_test_* schema',
  })}\n`);
} else if (command === 'serve') {
  const stateFile = process.env.COLLABORATION_ACCEPTANCE_STATE_FILE;
  if (!stateFile || !isAbsolute(stateFile)) {
    throw new Error('COLLABORATION_ACCEPTANCE_STATE_FILE must be an absolute path');
  }
  await serve(stateFile);
} else {
  throw new Error('Usage: node scripts/collaboration-real-agent-harness.mjs <plan|serve>');
}

async function serve(stateFile) {
  await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
  const resourceRoot = await mkdtemp(join(dirname(stateFile), 'agentwiki-real-client-'));
  let api;
  let worker;

  try {
    await withCollaborationTestDatabase(
      process.env.COLLABORATION_TEST_DATABASE_URL,
      async ({ databaseUrl, schemaName }) => {
        const port = await availablePort();
        const apiUrl = `http://127.0.0.1:${port}/api`;
        const environment = acceptanceEnvironment(databaseUrl, apiUrl, port);
        api = startProcess('api', resolve(root, 'apps/server/dist/main.js'), {
          ...environment,
          PROCESS_ROLE: 'api',
        });
        await waitForHealth(apiUrl, api);
        worker = startProcess('worker', resolve(root, 'apps/server/dist/worker.js'), {
          ...environment,
          PROCESS_ROLE: 'worker',
        });
        await waitForOutput(worker, /AgentWiki ingestion worker started/u, 30_000);

        const state = await prepareAcceptanceState({ apiUrl, schemaName, resourceRoot });
        await writeSecretJson(stateFile, { ...state, harnessPid: process.pid });
        process.stdout.write(`${JSON.stringify({
          status: 'READY',
          schemaName,
          apiUrl,
          stateFile,
          spaceId: state.spaceId,
          runs: Object.fromEntries(Object.entries(state.runs).map(([slug, run]) => [slug, run.id])),
        })}\n`);

        await waitForShutdownSignal();
      },
    );
  } finally {
    await stopProcess(worker);
    await stopProcess(api);
    await rm(stateFile, { force: true });
    await rm(resourceRoot, { recursive: true, force: true });
    process.stdout.write(`${JSON.stringify({ status: 'CLEANED' })}\n`);
  }
}

function acceptanceEnvironment(databaseUrl, apiUrl, port) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    REDIS_URL: process.env.COLLABORATION_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379',
    JWT_SECRET: `real-client-jwt-${randomUUID()}-${randomUUID()}`,
    AGENTWIKI_SERVER_PEPPER: `real-client-pepper-${randomUUID()}`,
    AGENTWIKI_DEPLOYMENT_SEED: randomBytes(32).toString('base64'),
    LOCAL_SYNC_PACKAGE_VERSION: '0.6.0',
    PUBLIC_API_URL: apiUrl,
    MCP_ALLOWED_HOSTS: '127.0.0.1,localhost',
    CORS_ORIGINS: `http://127.0.0.1:${port}`,
  };
}

async function prepareAcceptanceState({ apiUrl, schemaName, resourceRoot }) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const owner = await register(
    apiUrl,
    `release-owner-${suffix}@example.test`,
    `Release-${suffix}!`,
    'Release acceptance owner',
  );
  const space = await request(apiUrl, '/spaces', {
    method: 'POST',
    token: owner.token,
    body: { name: `Release acceptance ${suffix}` },
  });
  const agents = {
    codex: await createConnectedAgent(apiUrl, owner.token, space.id, `Codex acceptance ${suffix}`),
    claude: await createConnectedAgent(apiUrl, owner.token, space.id, `Claude acceptance ${suffix}`),
    alternate: await createConnectedAgent(apiUrl, owner.token, space.id, `Alternate acceptance ${suffix}`),
  };
  const templates = await request(apiUrl, `/spaces/${space.id}/collaboration/templates`, {
    token: owner.token,
  });
  const runs = {};
  for (const slug of templateSlugs) {
    const template = templates.find((candidate) => candidate.slug === slug && candidate.system === true);
    if (!template) throw new Error(`Built-in collaboration template is missing: ${slug}`);
    runs[slug] = await createRun(apiUrl, owner.token, space.id, template, agents, suffix);
  }

  const fixture = await createEvidenceRepository(resourceRoot);
  const homes = {
    codex: await prepareClientHome(resourceRoot, 'codex', apiUrl, agents.codex),
    claude: await prepareClientHome(resourceRoot, 'claude', apiUrl, agents.claude),
    alternate: await prepareClientHome(resourceRoot, 'alternate', apiUrl, agents.alternate),
  };

  return {
    schemaName,
    apiUrl,
    resourceRoot,
    spaceId: space.id,
    owner,
    agents,
    runs,
    homes,
    fixture,
  };
}

async function createConnectedAgent(apiUrl, token, spaceId, name) {
  const agent = await request(apiUrl, '/agents', { method: 'POST', token, body: { name } });
  const installation = await request(apiUrl, `/agents/${agent.id}/local-sync-installations`, {
    method: 'POST',
    token,
    body: { spaceId, role: 'publisher', pluginVersion: '0.6.0' },
  });
  const exchange = await request(apiUrl, '/integrations/local-sync/exchange', {
    method: 'POST',
    body: { code: installation.code },
  });
  return {
    id: agent.id,
    credentialId: exchange.credentialId,
    apiKey: exchange.apiKey,
  };
}

async function createRun(apiUrl, token, spaceId, template, agents, suffix) {
  const agentCycle = [agents.codex.id, agents.claude.id];
  const roleBindings = template.definition.roleSlots.map((slot, index) => ({
    roleSlotId: slot.id,
    agentId: agentCycle[index % agentCycle.length],
  }));
  const draft = await request(apiUrl, `/spaces/${spaceId}/collaboration/runs/drafts`, {
    method: 'POST',
    token,
    body: {
      templateId: template.id,
      name: `Release acceptance ${template.slug} ${suffix}`,
      inputs: acceptanceInputs(template.slug),
      roleBindings,
    },
  });
  const validated = await request(apiUrl, `/spaces/${spaceId}/collaboration/runs/${draft.id}/validate`, {
    method: 'POST', token, body: { expectedVersion: draft.version },
  });
  const started = await request(apiUrl, `/spaces/${spaceId}/collaboration/runs/${draft.id}/start`, {
    method: 'POST',
    token,
    body: { expectedVersion: validated.version, idempotencyKey: `release-start-${template.slug}-${suffix}` },
  });
  return { id: started.id, templateId: template.id, slug: template.slug };
}

function acceptanceInputs(slug) {
  const values = {
    coding: {
      'project-brief': 'Validate a tiny JavaScript library with two auditable commits, tests, review, revision, and release summary.',
      'repository-reference': 'The isolated fixture repository path is supplied to each real client at execution time.',
    },
    'bid-writing': {
      'tender-brief': 'Prepare a concise technical response for a 30-day knowledge-platform pilot. Mandatory: delivery plan, security, training, and evidence matrix.',
      'available-materials': 'Available: architecture note and test report. Missing: customer certificate and named staff resumes. Never invent missing materials.',
    },
    'paper-writing': {
      'research-question': 'How does deterministic lease-based orchestration improve recoverability in multi-agent workflows?',
      'source-boundary': 'Use only explicitly identified standards or the provided workflow evidence; mark unsupported claims as unverifiable.',
    },
    'video-script-writing': {
      'video-goal': 'Explain deterministic Agent collaboration to software teams using only verified workflow facts.',
      'target-duration-seconds': 60,
      'brand-guidance': 'Precise, calm, no hype, and no unsupported performance claims.',
    },
    'novel-writing': {
      'story-premise': 'In a city where every promise becomes a timed lease, an archivist must recover one expired promise without breaking causality.',
      'style-guidance': 'Concise speculative fiction; preserve knowledge boundaries, chronology, object state, and unresolved clues.',
    },
  };
  return values[slug];
}

async function prepareClientHome(resourceRoot, client, apiUrl, agent) {
  const home = join(resourceRoot, `${client}-home`);
  const connectionId = `release-${client}`;
  const credentialId = `release-${client}-credential`;
  await mkdir(join(home, '.agentwiki'), { recursive: true, mode: 0o700 });
  await writeSecretJson(join(home, '.agentwiki', 'local-sync.json'), {
    version: 1,
    defaultConnectionId: connectionId,
    connections: {
      [connectionId]: {
        id: connectionId,
        serverUrl: apiUrl,
        agentId: agent.id,
        credentialId,
        pluginVersion: '0.6.0',
        client: client === 'alternate' ? 'claude' : client,
        mcpName: 'agentwiki',
      },
    },
  });
  await writeSecretJson(join(home, '.agentwiki', 'credentials.json'), {
    version: 1,
    credentials: { [credentialId]: { apiKey: agent.apiKey } },
  });
  const mcpConfigPath = join(home, 'mcp.json');
  await writeSecretJson(mcpConfigPath, {
    mcpServers: {
      agentwiki: {
        command: process.execPath,
        args: [resolve(root, 'packages/local-sync/dist/cli.js'), 'gateway', '--connection', connectionId],
      },
    },
  });
  return { home, connectionId, mcpConfigPath };
}

async function createEvidenceRepository(resourceRoot) {
  const repository = join(resourceRoot, 'evidence-repository');
  await mkdir(join(repository, 'src'), { recursive: true });
  await mkdir(join(repository, 'test'), { recursive: true });
  await writeFile(join(repository, 'package.json'), `${JSON.stringify({
    name: 'agentwiki-release-acceptance-fixture',
    private: true,
    type: 'module',
    scripts: { test: 'node --test' },
  }, null, 2)}\n`);
  await writeFile(join(repository, 'README.md'), '# AgentWiki release acceptance fixture\n');
  git(repository, ['init', '-b', 'main']);
  git(repository, ['config', 'user.name', 'AgentWiki Acceptance']);
  git(repository, ['config', 'user.email', 'acceptance@example.test']);
  git(repository, ['add', '.']);
  git(repository, ['commit', '-m', 'test: create isolated acceptance fixture']);

  await writeFile(join(repository, 'src', 'sum.js'), 'export const sum = (left, right) => left + right;\n');
  await writeFile(join(repository, 'test', 'sum.test.js'), "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { sum } from '../src/sum.js';\ntest('sum adds two numbers', () => assert.equal(sum(2, 3), 5));\n");
  git(repository, ['add', '.']);
  git(repository, ['commit', '-m', 'feat: add audited sum module']);
  const moduleA = git(repository, ['rev-parse', 'HEAD']).trim();

  await writeFile(join(repository, 'src', 'label.js'), "export const label = (value) => `Agent ${String(value).trim()}`;\n");
  await writeFile(join(repository, 'test', 'label.test.js'), "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { label } from '../src/label.js';\ntest('label normalizes an Agent name', () => assert.equal(label(' Wiki '), 'Agent Wiki'));\n");
  git(repository, ['add', '.']);
  git(repository, ['commit', '-m', 'feat: add audited label module']);
  const moduleB = git(repository, ['rev-parse', 'HEAD']).trim();
  const testResult = spawnSync('npm', ['test'], { cwd: repository, encoding: 'utf8' });
  if (testResult.status !== 0) throw new Error(`Fixture tests failed:\n${testResult.stdout}\n${testResult.stderr}`);
  return { repository, moduleA, moduleB, testCommand: 'npm test' };
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

async function register(apiUrl, email, password, name) {
  const response = await request(apiUrl, '/auth/register', {
    method: 'POST', body: { email, password, name },
  });
  return { id: response.user.id, email, token: response.access_token };
}

async function request(apiUrl, path, { method = 'GET', token, body } = {}) {
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
  if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 1_000)}`);
  return data;
}

async function writeSecretJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function startProcess(label, entry, env) {
  const child = spawn(process.execPath, [entry], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
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
      if (response.ok && (await response.json()).status === 'ok') return;
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

function waitForShutdownSignal() {
  return new Promise((resolveShutdown) => {
    const done = () => resolveShutdown();
    process.once('SIGTERM', done);
    process.once('SIGINT', done);
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
