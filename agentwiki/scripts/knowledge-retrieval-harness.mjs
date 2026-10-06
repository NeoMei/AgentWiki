import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateCollaborationTestDatabaseUrl, withCollaborationTestDatabase } from './collaboration-test-database.mjs';
import { resolveTestRedisTarget, assertTestRedisAvailable } from './e2e-safety.mjs';
import { corpus, publicQuestions, operatorRubric, hashCorpus } from './knowledge-retrieval-corpus.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = dirname(root);
const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(done => setTimeout(done, ms));

export function validateStatePath(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || !basename(value).endsWith('.json') || value !== resolve(value)) throw new Error('KNOWLEDGE_ACCEPTANCE_STATE_FILE must be an absolute normalized JSON file path');
  return value;
}
export function validateDatabaseUrl(value) {
  try { return validateCollaborationTestDatabaseUrl(value); }
  catch { throw new Error('KNOWLEDGE_TEST_DATABASE_URL requires a dedicated loopback PostgreSQL test database and safe schema'); }
}
export function isolatedEnvironment(parent = process.env) {
  return Object.fromEntries(['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'SystemRoot'].filter(key => typeof parent[key] === 'string').map(key => [key, parent[key]]));
}
export async function createOwnedWorkspace() {
  const path = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-knowledge-'));
  await chmod(path, 0o700);
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}
export async function writeOwnedState(path, state) {
  validateStatePath(path);
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  await writeFile(path, contents, { mode: 0o600, flag: 'wx' });
  const original = await lstat(path);
  return async () => {
    const current = await lstat(path).catch(() => null);
    if (current?.isFile() && current.ino === original.ino && current.dev === original.dev && await readFile(path, 'utf8') === contents) await rm(path);
  };
}

export function startOwnedProcess(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  child.startError = null;
  child.on('error', error => { child.startError = error; });
  child.output = '';
  const capture = data => { child.output = (child.output + data.toString()).slice(-32_000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  return child;
}
export async function stopOwnedProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || child.startError) return;
  await new Promise(done => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 3_000);
    child.once('exit', () => { clearTimeout(timeout); done(); });
    child.once('error', () => { clearTimeout(timeout); done(); });
    child.kill('SIGTERM');
  });
}
async function availablePort() {
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
  return port;
}
async function waitReady(child, check, signal) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (child.startError || child.exitCode !== null || child.signalCode !== null) throw new Error('Owned service exited before readiness');
    if (await check().catch(() => false)) return;
    await delay(150);
  }
  throw new Error('Owned service readiness timed out');
}
async function privateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}
async function digestTrees(paths) {
  const entries = [];
  async function visit(relative) {
    const path = join(root, relative);
    const info = await lstat(path);
    if (info.isDirectory()) for (const name of (await readdir(path)).sort()) await visit(`${relative}/${name}`);
    else if (info.isFile()) entries.push([relative, sha256(await readFile(path))]);
    else throw new Error('Artifact digest refuses symlinks');
  }
  for (const path of paths) await visit(path);
  return { sha256: sha256(JSON.stringify(entries)), fileCount: entries.length };
}
async function productIdentity() {
  const git = spawnSync('git', [`--work-tree=${repository}`, 'rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' });
  if (git.status !== 0) throw new Error('Cannot identify source commit');
  const source = await digestTrees(['apps/server/src', 'apps/server/prisma', 'packages/local-sync/src', 'packages/local-sync/skill', 'packages/shared/src', 'packages/sync-protocol/src', 'pnpm-lock.yaml']);
  const build = await digestTrees(['apps/server/dist', 'packages/local-sync/dist', 'packages/shared/dist', 'packages/sync-protocol/dist']);
  return { commit: git.stdout.trim(), source, build, skillHash: sha256(await readFile(join(root, 'packages/local-sync/skill/SKILL.md'))) };
}
async function request(apiUrl, path, { token, body, method = body ? 'POST' : 'GET' } = {}) {
  const response = await fetch(apiUrl + path, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Fixture API ${method} ${path} failed (${response.status})`);
  return response.json();
}

async function seedCorpus(databaseUrl, ownerId, spaceId, privateSpaceId) {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const ids = {};
  const fixedDate = new Date('2026-10-01T00:00:00.000Z');
  try {
    for (const [page, scope] of [...corpus.pages.map(page => [page, spaceId]), ...corpus.privatePages.map(page => [page, privateSpaceId])]) {
      const id = `kr_page_${page.key}`;
      ids[page.key] = id;
      const sourceContent = page.quote ?? page.content;
      const source = await prisma.source.create({ data: { id: `kr_source_${page.key}`, spaceId: scope, type: 'text', name: `${page.title}来源`, contentHash: sha256(sourceContent), createdByUserId: ownerId } });
      const version = await prisma.sourceVersion.create({ data: { id: `kr_version_${page.key}`, sourceId: source.id, version: page.version ?? 1, content: sourceContent, contentHash: sha256(sourceContent), createdAt: fixedDate } });
      const run = await prisma.ingestRun.create({ data: { sourceId: source.id, inputSourceVersionId: version.id, spaceId: scope, status: 'completed', stage: 'completed', completedAt: fixedDate, requestedByUserId: ownerId } });
      const changeSet = await prisma.changeSet.create({ data: { title: `Synthetic fixture: ${page.title}`, spaceId: scope, runId: run.id, status: 'published', publishedAt: fixedDate, createdByUserId: ownerId } });
      const path = `pages/${page.key}.md`;
      await prisma.page.create({ data: { id, title: page.title, slug: page.key, content: page.content, spaceId: scope, authorId: ownerId, sourceId: source.id, sourceVersionId: version.id, sourceChangeSetId: changeSet.id, syncPath: path, syncPathKey: path, sourcePath: path, createdAt: fixedDate, updatedAt: fixedDate } });
      await prisma.evidence.create({ data: { id: `kr_evidence_${page.key}`, sourceVersionId: version.id, runId: run.id, targetPageId: id, quote: sourceContent, location: { path: page.quote ? 'fixture/verification.md' : path, line: page.quote ? 7 : 1 } } });
      const text = `${page.title}\n${page.content}`;
      await prisma.pageSearchDocument.create({ data: { pageId: id, text, contentHash: sha256(text), indexedAt: fixedDate } });
    }
    for (const relation of corpus.relations) await prisma.knowledgeRelation.create({ data: { sourcePageId: ids[relation.source], targetPageId: ids[relation.target], relation: relation.relation, evidenceId: `kr_evidence_${relation.target}`, origin: 'manual' } });
    return ids;
  } finally { await prisma.$disconnect(); }
}

async function prepareAgent({ apiUrl, token, spaceId, workspace, label, packageVersion }) {
  const agent = await request(apiUrl, '/agents', { token, body: { name: `Retrieval Agent ${label}` } });
  const installation = await request(apiUrl, `/agents/${agent.id}/local-sync-installations`, { token, body: { spaceId, role: 'reader', pluginVersion: packageVersion } });
  const exchange = await request(apiUrl, '/integrations/local-sync/exchange', { body: { code: installation.code } });
  const home = join(workspace, `consumer-${label}`);
  const connectionId = `retrieval-${label}`;
  await mkdir(join(home, '.agentwiki'), { recursive: true, mode: 0o700 });
  await privateJson(join(home, '.agentwiki/local-sync.json'), { version: 1, defaultConnectionId: connectionId, connections: { [connectionId]: { id: connectionId, serverUrl: apiUrl, agentId: agent.id, credentialId: exchange.credentialId, spaceId, pluginVersion: packageVersion, client: 'codex', mcpName: 'agentwiki' } } });
  await privateJson(join(home, '.agentwiki/credentials.json'), { version: 2, credentials: { [exchange.credentialId]: { apiKey: exchange.apiKey } } });
  const wrapperPath = join(home, 'gateway.mjs');
  await writeFile(wrapperPath, `import { runCli } from ${JSON.stringify(pathToFileURL(join(root, 'packages/local-sync/dist/cli.js')).href)};\nawait runCli(['gateway', '--connection', ${JSON.stringify(connectionId)}], ${JSON.stringify(home)});\n`, { mode: 0o600 });
  const skillDirectory = join(home, '.agents/skills/agentwiki-local-sync');
  await mkdir(skillDirectory, { recursive: true, mode: 0o700 });
  await copyFile(join(root, 'packages/local-sync/skill/SKILL.md'), join(skillDirectory, 'SKILL.md'));
  return { id: agent.id, credentialId: exchange.credentialId, apiKey: exchange.apiKey, home, wrapperPath, skillPath: join(skillDirectory, 'SKILL.md') };
}

export async function serve({ databaseUrl, statePath }) {
  validateDatabaseUrl(databaseUrl);
  validateStatePath(statePath);
  // Never overwrite a prior run or create an arbitrary parent directory.
  await access(dirname(statePath));
  try { await lstat(statePath); throw new Error('State path already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const product = await productIdentity();
  const packageVersion = JSON.parse(await readFile(join(root, 'packages/local-sync/package.json'), 'utf8')).version;
  const controller = new AbortController();
  let resolveShutdown;
  const shutdown = new Promise(done => { resolveShutdown = done; });
  const onSignal = () => { controller.abort(); resolveShutdown(); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const workspace = await createOwnedWorkspace();
  let artifacts;
  try {
    artifacts = await mkdtemp(join(dirname(statePath), 'knowledge-retrieval-evidence-'));
    await chmod(artifacts, 0o700);
  } catch (error) {
    await workspace.cleanup();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    throw error;
  }
  let redis;
  let api;
  let cleanupState = async () => {};
  let ready = false;
  let scopeReceipt;
  let databaseCleaned = false;
  try {
    const redisPort = await availablePort();
    const redisUrl = `redis://127.0.0.1:${redisPort}/0`;
    redis = startOwnedProcess('redis-server', ['--bind', '127.0.0.1', '--port', String(redisPort), '--save', '', '--appendonly', 'no', '--dir', workspace.path], { cwd: workspace.path, env: isolatedEnvironment() });
    await waitReady(redis, async () => redis.output.includes('Ready to accept connections'), controller.signal);
    assertTestRedisAvailable(resolveTestRedisTarget(redisUrl, { environment: isolatedEnvironment() }));
    await withCollaborationTestDatabase(databaseUrl, async scope => {
      scopeReceipt = { schemaName: scope.schemaName, migrationTreeDigest: scope.migrationTreeDigest, publicInventoryDigest: scope.publicInventoryDigest };
      try {
        controller.signal.throwIfAborted();
        const port = await availablePort();
        const apiUrl = `http://127.0.0.1:${port}/api`;
        const env = { ...isolatedEnvironment(), NODE_ENV: 'test', PROCESS_ROLE: 'api', AGENTWIKI_LISTEN_HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: scope.databaseUrl, REDIS_URL: redisUrl, JWT_SECRET: randomBytes(48).toString('hex'), AGENTWIKI_SERVER_PEPPER: randomBytes(48).toString('hex'), AGENTWIKI_DEPLOYMENT_SEED: randomBytes(32).toString('base64'), LOCAL_SYNC_PACKAGE_VERSION: packageVersion, PUBLIC_API_URL: apiUrl, MCP_ALLOWED_HOSTS: '127.0.0.1,localhost', CORS_ORIGINS: `http://127.0.0.1:${port}`, ATTACHMENT_STORAGE_PATH: workspace.path };
        api = startOwnedProcess(process.execPath, [join(root, 'apps/server/dist/main.js')], { cwd: workspace.path, env });
        await waitReady(api, async () => {
          // A health response alone could belong to a process winning the port race.
          if (!api.output.includes(`Server running on http://localhost:${port}`)) return false;
          const response = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(1_500) });
          return response.ok && (await response.json()).status === 'ok';
        }, controller.signal);
        const suffix = randomUUID();
        const owner = await request(apiUrl, '/auth/register', { body: { email: `retrieval-${suffix}@example.test`, password: `Retrieval-${suffix}!`, name: 'Synthetic Retrieval Owner' } });
        const token = owner.access_token;
        const space = await request(apiUrl, '/spaces', { token, body: { name: 'Knowledge Retrieval Fixture' } });
        const privateSpace = await request(apiUrl, '/spaces', { token, body: { name: 'Unauthorized Retrieval Decoy' } });
        const pageIds = await seedCorpus(scope.databaseUrl, owner.user.id, space.id, privateSpace.id);
        const agents = {};
        for (const label of ['a', 'b']) agents[label] = await prepareAgent({ apiUrl, token, spaceId: space.id, workspace: workspace.path, label, packageVersion });
        const common = { corpusHash: hashCorpus(corpus), questionsHash: hashCorpus(publicQuestions), product, ...scopeReceipt, embeddingMode: 'lexical-only; no provider credentials', fixtureSeeding: 'direct isolated Prisma fixtures; production HTTP MCP reads', packageVersion };
        await privateJson(join(artifacts, 'operator-rubric.json'), { ...common, rubric: operatorRubric, pageIds, privateSpaceId: privateSpace.id });
        await privateJson(join(artifacts, 'questions.json'), publicQuestions);
        const consumerPath = join(root, 'scripts/knowledge-retrieval-agent-client.mjs');
        await privateJson(join(artifacts, 'run.json'), { ...common, spaceId: space.id, agents: Object.fromEntries(Object.entries(agents).map(([key, agent]) => [key, { id: agent.id, skillPath: agent.skillPath }])), consumerPath, model: 'operator must freeze executor-selected model and effort before comparison', callBudget: 20 });
        controller.signal.throwIfAborted();
        cleanupState = await writeOwnedState(statePath, { version: 1, harnessPid: process.pid, resourceRoot: workspace.path, artifacts, apiUrl, spaceId: space.id, agents, consumerPath, ...common });
        ready = true;
        process.stdout.write(`${JSON.stringify({ status: 'READY', statePath, artifacts, corpusHash: common.corpusHash, apiUrl, spaceId: space.id, consumerPath })}\n`);
        await shutdown;
      } finally {
        const stops = await Promise.allSettled([cleanupState(), stopOwnedProcess(api)]);
        // Preserve only sanitized facade receipts; operator stores model answers beside these.
        for (const label of ['a', 'b']) {
          const source = join(workspace.path, `consumer-${label}/trace.jsonl`);
          try { await copyFile(source, join(artifacts, `trace-${label}.jsonl`)); await chmod(join(artifacts, `trace-${label}.jsonl`), 0o600); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        if (stops.some(result => result.status === 'rejected')) throw new Error('Owned API/state cleanup failed');
      }
    });
    databaseCleaned = true;
  } finally {
    const stops = await Promise.allSettled([cleanupState(), stopOwnedProcess(api), stopOwnedProcess(redis)]);
    const removal = await Promise.allSettled([workspace.cleanup()]);
    const resourcesRemoved = [...stops, ...removal].every(result => result.status === 'fulfilled');
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    const receipt = { status: databaseCleaned && resourcesRemoved ? 'CLEANED' : 'STOPPED_WITH_UNVERIFIED_CLEANUP', ready, databaseCleaned, resourcesRemoved, protectedInventoryVerified: databaseCleaned, ...(scopeReceipt ?? {}), artifacts };
    await privateJson(join(artifacts, 'cleanup.json'), receipt);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
}

export async function main(argv) {
  if (argv.length === 1 && argv[0] === 'plan') {
    process.stdout.write(`${JSON.stringify({ corpusHash: hashCorpus(corpus), questionCount: publicQuestions.length, databaseIsolation: 'random collaboration_test_* schema', agents: ['a', 'b'], modelExecuted: false, required: ['built server/local-sync/shared/protocol', 'dedicated loopback PostgreSQL test DB with reviewed migration corpus', 'PG_DUMP_BIN set to an absolute executable pg_dump path compatible with the test PostgreSQL server', 'redis-server and redis-cli', 'absolute unused state path in an existing private directory'], workerRequired: false })}\n`);
  } else if (argv.length === 1 && argv[0] === 'serve') await serve({ databaseUrl: process.env.KNOWLEDGE_TEST_DATABASE_URL, statePath: process.env.KNOWLEDGE_ACCEPTANCE_STATE_FILE });
  else throw new Error('Usage: knowledge-retrieval-harness.mjs plan|serve');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    // Do not dump upstream errors or process output containing generated secrets.
    process.stderr.write(`Knowledge retrieval harness failed (${error.name ?? 'Error'}); no secrets printed. Check prerequisites and retained cleanup receipt.\n`);
    process.exitCode = 1;
  });
}
