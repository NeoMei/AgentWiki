import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { appendFile, chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { withCollaborationTestDatabase } from './collaboration-test-database.mjs';
import { resolveTestRedisTarget, assertTestRedisAvailable } from './e2e-safety.mjs';
import { validateStatePath, validateDatabaseUrl, isolatedEnvironment, createOwnedWorkspace, writeOwnedState, startOwnedProcess, startOwnedRedis, stopOwnedProcess, ownedProcessDiagnostic, checkApiHealth } from './knowledge-retrieval-harness.mjs';
import { startPersistentReadSession } from './knowledge-retrieval-agent-client.mjs';
import { fixtureEnvelope, fixtureHash, unrelatedPage } from './source-freshness-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = dirname(root);
const hash = value => createHash('sha256').update(value).digest('hex');
const id = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid resource ID');
  return value;
};
const key = value => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[\r\n]/.test(value)) throw new Error('Explicit idempotency key required');
  return value;
};
function loopbackApi(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/api' || url.search || url.hash) throw new Error('Owned loopback API required');
  return url;
}
export function sanitize(value, secrets = []) {
  if (Array.isArray(value)) return value.map(item => sanitize(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, /^(?:apiKey|access_token|token|password|authorization|config|secret|pepper|seed)$/i.test(name) ? '[REDACTED]' : sanitize(item, secrets)]));
  if (typeof value !== 'string') return value;
  let text = value;
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 8) text = text.split(secret).join('[REDACTED]');
  return text.replace(/\b(?:agk|awk)_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/(?:postgres(?:ql)?|redis):\/\/[^\s"']+/g, '[REDACTED_URL]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
}
const privateJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });

export function createPlan() {
  return { prepares: 'v1 pending_review; no automatic decisions or publication', workerRequired: true, modelExecuted: false,
    confirmFixtureHash: fixtureHash('v1'), databaseIsolation: 'reviewed migrations; random protected collaboration_test_* schema',
    required: ['reviewed Task1/2 commit and frozen server/worker/client/local-sync/shared/protocol builds', 'dedicated loopback test PostgreSQL and compatible absolute PG_DUMP_BIN', 'owned Redis AOF, API, worker and built-frontend preview', 'private unused state path', 'explicit v1 fixture hash confirmation'],
    consumers: 'independent reader a/b, persistent stdio; separate real model sessions supplied by operator' };
}

// No redirects, retries, request bodies, headers or raw upstream errors in receipts.
export function createApi({ apiUrl, owner, token = owner?.token, secrets = [], record = async () => {}, fetchImpl = fetch, signal }) {
  loopbackApi(apiUrl);
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\#\r\n]/.test(path)
      || decodeURIComponent(path).split(/[/?]/).some(part => part === '.' || part === '..')) throw new Error('Invalid relative API path');
    const url = new URL(apiUrl + path);
    for (const param of url.searchParams.keys()) if (!['spaceId', 'take', 'skip', 'q', 'limit'].includes(param)) throw new Error('Unsupported API query');
    const requestBody = body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body);
    const started = performance.now();
    let status = null;
    let data;
    let bytes = '';
    try {
      const response = await fetchImpl(url.href, { method, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(requestBody !== undefined ? { body: requestBody } : {}) });
      status = response.status;
      bytes = await response.text();
      try { data = JSON.parse(bytes); } catch { throw new Error('Invalid JSON response'); }
      if (!response.ok) throw new Error('API rejected request');
      return data;
    } catch {
      throw new Error(`Owned API ${method} request failed (${status ?? 'transport'})`);
    } finally {
      await record(sanitize({ at: new Date().toISOString(), method, path, status, success: status !== null && status >= 200 && status < 300 && data !== undefined,
        code: typeof data?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(data.code) ? data.code : undefined,
        responseBytes: Buffer.byteLength(bytes), responseHash: hash(bytes), durationMs: Math.round(performance.now() - started) }, [token, ...secrets]));
    }
  };
}

export async function uploadConfirmed(api, { spaceId, version, sourceKey = 'freshness-main', idempotencyKey, confirmation }) {
  const envelope = fixtureEnvelope(version, sourceKey);
  if (confirmation !== fixtureHash(version, sourceKey)) throw new Error('Explicit matching fixture hash confirmation required');
  const form = new FormData();
  form.set('file', new Blob([JSON.stringify(envelope)], { type: 'application/json' }), `${version}.okf.json`);
  return api(`/spaces/${id(spaceId)}/knowledge-syncs`, { method: 'POST', body: form,
    headers: { 'idempotency-key': key(idempotencyKey), 'x-agentwiki-user-confirmed': 'true' } });
}
export async function waitForCandidate(api, runId, { timeoutMs = 90_000, pause: sleep = pause, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const run = await api(`/runs/${id(runId)}`);
    if (['failed', 'cancelled', 'partial'].includes(run.status)) throw new Error('Worker did not complete the candidate');
    if (run.status === 'completed') {
      if (run.changeSet?.status !== 'pending_review' || !run.changeSet.items?.length) throw new Error('Expected actual pending review candidate');
      return run;
    }
    await sleep(1000, undefined, signal ? { signal } : undefined);
  }
  throw new Error('Worker candidate deadline exceeded');
}

export function previewConfig({ workspace, webPort, apiOrigin, clientRoot, dist }) {
  loopbackApi(apiOrigin + '/api');
  if (![workspace, clientRoot, dist].every(isAbsolute) || !Number.isInteger(webPort) || webPort < 1024 || webPort > 65535) throw new Error('Invalid owned preview settings');
  // Plain config deliberately has no repo plugins or dotenv directory. Preview serves frozen dist.
  return `export default { root: ${JSON.stringify(clientRoot)}, envDir: ${JSON.stringify(workspace)}, build: { outDir: ${JSON.stringify(dist)} }, preview: { host: '127.0.0.1', port: ${webPort}, strictPort: true, proxy: { '/api': { target: ${JSON.stringify(apiOrigin)}, changeOrigin: true }, '/socket.io': { target: ${JSON.stringify(apiOrigin)}, changeOrigin: true, ws: true } } } };\n`;
}

export async function loadOperatorState(path) {
  validateStatePath(path);
  const info = await lstat(path);
  if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600) throw new Error('Private owned state required');
  const state = JSON.parse(await readFile(path, 'utf8'));
  if (state.kind !== 'source-freshness' || state.version !== 2 || !Number.isSafeInteger(state.harnessPid) || state.harnessPid <= 0 || typeof state.owner?.token !== 'string') throw new Error('Invalid source acceptance state');
  loopbackApi(state.apiUrl); id(state.spaceId);
  process.kill(state.harnessPid, 0);
  const directory = await lstat(await realpath(state.resourceRoot));
  if (!directory.isDirectory() || directory.uid !== process.getuid?.() || (directory.mode & 0o777) !== 0o700) throw new Error('Private resource root required');
  if (typeof state.artifacts !== 'string' || !isAbsolute(state.artifacts)) throw new Error('Private evidence directory required');
  const evidence = await lstat(state.artifacts);
  if (!evidence.isDirectory() || evidence.uid !== process.getuid?.() || (evidence.mode & 0o777) !== 0o700
    || !basename(state.artifacts).startsWith('source-freshness-evidence-') || await realpath(dirname(state.artifacts)) !== await realpath(dirname(path))) throw new Error('Invalid owned evidence directory');
  return state;
}

export function monitorOwnedChildren(children, onFailure, maximumMs = 2 * 60 * 60_000) {
  let failed = false;
  const listeners = [];
  const fail = message => { if (!failed) { failed = true; onFailure(message); } };
  for (const [name, child] of children) {
    const exited = () => fail(`Owned ${name} exited during acceptance`);
    child.once('exit', exited); child.once('error', exited);
    listeners.push(() => { child.removeListener('exit', exited); child.removeListener('error', exited); });
    if (child.startError || child.exitCode != null || child.signalCode != null) exited();
  }
  const timer = setTimeout(() => fail('Acceptance reached the two-hour runtime deadline'), maximumMs);
  timer.unref();
  return () => { clearTimeout(timer); for (const remove of listeners) remove(); };
}
async function stopChild(child) {
  await stopOwnedProcess(child);
  if (child && !child.startError && child.exitCode === null && child.signalCode === null) throw new Error('Owned child termination is unverified');
}
export async function cleanupOwnedScope({ removeState, sessions, sessionReceipts, children, stopChild: stop = stopChild }) {
  const results = await Promise.allSettled([removeState()]);
  results.push(...await Promise.allSettled([...sessions].map(async ([label, session]) => { sessionReceipts[label] = await session.close(); })));
  // Stop every process even after a prior failure; API/schema stay alive until the worker stops.
  for (const name of ['worker', 'web', 'api']) results.push(...await Promise.allSettled([stop(children.get(name), name)]));
  return results.every(result => result.status === 'fulfilled');
}

export async function operatorAction(state, action, input = {}, api = createApi(state)) {
  const scoped = async (kind, resourceId) => {
    const data = await api(`/${kind}/${id(resourceId)}`);
    if ((data.spaceId ?? data.space?.id) !== state.spaceId) throw new Error('Resource is outside this acceptance Space');
    return data;
  };
  const tree = async () => {
    const value = await api(`/spaces/${id(state.spaceId)}/content-tree?take=1`);
    if (typeof value.treeRevision !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value.treeRevision)) throw new Error('Invalid current tree revision');
    return value.treeRevision;
  };
  if (action === 'upload') return uploadConfirmed(api, { ...input, spaceId: state.spaceId });
  if (action === 'new-run' || action === 'archive' || action === 'activate') {
    await scoped('sources', input.sourceId);
    const path = `/sources/${id(input.sourceId)}`;
    if (action === 'new-run') return api(path + '/runs', { method: 'POST', headers: { 'idempotency-key': key(input.idempotencyKey) } });
    return api(path, action === 'archive' ? { method: 'DELETE' } : { method: 'PATCH', body: { status: 'active' } });
  }
  if (action === 'cancel' || action === 'retry') {
    await scoped('runs', input.runId);
    return api(`/runs/${id(input.runId)}/${action}`, { method: 'POST' });
  }
  if (action === 'manual-edit') {
    if (typeof input.content !== 'string' || input.content.length > 200000) throw new Error('Explicit bounded content required');
    const page = await scoped('pages', input.pageId);
    return api(`/pages/${id(input.pageId)}`, { method: 'PATCH', body: { content: input.content, expectedUpdatedAt: page.updatedAt } });
  }
  if (action === 'restore') {
    await scoped('pages', input.pageId); id(input.versionId);
    return api(`/pages/${id(input.pageId)}/versions/${id(input.versionId)}/restore`, { method: 'POST', body: { expectedTreeRevision: await tree() } });
  }
  if (action === 'revert') {
    await scoped('change-sets', input.changeSetId);
    return api(`/change-sets/${id(input.changeSetId)}/revert`, { method: 'POST', body: { expectedTreeRevision: await tree() } });
  }
  if (action === 'revoke-reader') {
    if (!['a', 'b'].includes(input.agent)) throw new Error('Reader a or b required');
    const agent = state.agents[input.agent];
    return api(`/agents/${id(agent.id)}/credentials/${id(agent.credentialId)}`, { method: 'DELETE' });
  }
  if (action === 'read') {
    if (['pages', 'sources', 'runs', 'change-sets'].includes(input.kind)) return scoped(input.kind, input.id);
    if (input.kind === 'versions') { await scoped('pages', input.id); return api(`/pages/${id(input.id)}/versions`); }
    if (input.kind === 'page-list') return api(`/pages?spaceId=${id(state.spaceId)}&take=100`);
    if (input.kind === 'graph') return api(`/knowledge/graph/${id(state.spaceId)}`);
    if (input.kind === 'hierarchy') return api(`/pages/hierarchy/${id(state.spaceId)}`);
    if (input.kind === 'review-list') return api(`/review?spaceId=${id(state.spaceId)}`);
    if (input.kind === 'tree') return api(`/spaces/${id(state.spaceId)}/content-tree?take=1`);
    if (input.kind === 'search' && typeof input.query === 'string' && input.query.length <= 200) return api(`/search?spaceId=${id(state.spaceId)}&q=${encodeURIComponent(input.query)}&limit=10`);
  }
  throw new Error('Unsupported operator action; approve, publish and item decisions require actual UI');
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
    if (child.startError || child.exitCode !== null || child.signalCode !== null) throw new Error('Owned child exited before readiness');
    if (await check().catch(() => false)) return;
    await pause(200, undefined, { signal });
  }
  throw new Error('Owned child readiness deadline exceeded');
}
async function digest(paths) {
  const files = [];
  const visit = async path => {
    const info = await lstat(join(root, path));
    if (info.isDirectory()) for (const child of (await readdir(join(root, path))).sort()) await visit(`${path}/${child}`);
    else if (info.isFile()) files.push([path, hash(await readFile(join(root, path)))]);
    else throw new Error('Frozen artifacts must not contain symlinks');
  };
  for (const path of paths) await visit(path);
  return { sha256: hash(JSON.stringify(files)), fileCount: files.length };
}
// One reviewed-input manifest drives both the dirty gate and recorded digests.
// Built artifacts remain a separately verified build-provenance boundary.
export const RUNTIME_INPUTS = Object.freeze({
  source: Object.freeze([
    'apps/server/src', 'apps/server/prisma', 'apps/client/src',
    'packages/local-sync/src', 'packages/local-sync/skill', 'packages/shared/src', 'packages/sync-protocol/src',
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.pnpm-config.json',
    'apps/server/package.json', 'apps/client/package.json', 'packages/local-sync/package.json',
    'packages/shared/package.json', 'packages/sync-protocol/package.json',
  ]),
  harness: Object.freeze([
    'scripts/source-freshness-acceptance.mjs', 'scripts/source-freshness-fixtures.mjs',
    'scripts/knowledge-retrieval-harness.mjs', 'scripts/knowledge-retrieval-agent-client.mjs',
    'scripts/knowledge-retrieval-corpus.mjs', 'scripts/collaboration-test-database.mjs',
    'scripts/folder-test-database.mjs', 'scripts/e2e-safety.mjs',
    'scripts/package-manager-process.mjs', 'scripts/package-manager-process-runner.mjs',
    'scripts/test-database-url-safety.mjs', 'scripts/test-database-lifecycle.mjs',
  ]),
});
export async function identity(expectedCommit, { runGit = spawnSync, digestPaths = digest } = {}) {
  if (!/^[0-9a-f]{40}$/.test(expectedCommit ?? '')) throw new Error('Explicit reviewed 40-character commit required');
  const git = runGit('git', [`--work-tree=${repository}`, 'rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' });
  if (git.status !== 0 || git.stdout.trim() !== expectedCommit) throw new Error('HEAD differs from reviewed commit');
  const paths = Object.values(RUNTIME_INPUTS).flat();
  const dirty = runGit('git', [`--work-tree=${repository}`, 'status', '--porcelain', '--untracked-files=all', '--', ...paths.map(path => `agentwiki/${path}`)], { cwd: repository, encoding: 'utf8' });
  if (dirty.status !== 0 || dirty.stdout.trim()) throw new Error('Runtime inputs differ from reviewed commit');
  return { commit: expectedCommit, source: await digestPaths(RUNTIME_INPUTS.source),
    build: await digestPaths(['apps/server/dist', 'apps/client/dist', 'packages/local-sync/dist', 'packages/shared/dist', 'packages/sync-protocol/dist']),
    harness: await digestPaths(RUNTIME_INPUTS.harness) };
}
async function prepareReader(api, { apiUrl, spaceId, workspace, label, packageVersion, signal }) {
  const agent = await api('/agents', { method: 'POST', body: { name: `Source review reader ${label}` } });
  const installation = await api(`/agents/${id(agent.id)}/local-sync-installations`, { method: 'POST', body: { spaceId, role: 'reader', pluginVersion: packageVersion } });
  const exchange = await createApi({ apiUrl, signal })('/integrations/local-sync/exchange', { method: 'POST', body: { code: installation.code } });
  const home = join(workspace, `consumer-${label}`);
  await mkdir(join(home, '.agentwiki'), { recursive: true, mode: 0o700 });
  const connectionId = `freshness-${label}`;
  await privateJson(join(home, '.agentwiki/local-sync.json'), { version: 1, defaultConnectionId: connectionId, connections: { [connectionId]: { id: connectionId, serverUrl: apiUrl, agentId: agent.id, credentialId: exchange.credentialId, spaceId, pluginVersion: packageVersion, client: 'codex', mcpName: 'agentwiki' } } });
  await privateJson(join(home, '.agentwiki/credentials.json'), { version: 2, credentials: { [exchange.credentialId]: { apiKey: exchange.apiKey } } });
  const wrapperPath = join(home, 'gateway.mjs');
  await writeFile(wrapperPath, `import {runCli} from ${JSON.stringify(pathToFileURL(join(root, 'packages/local-sync/dist/cli.js')).href)};\nawait runCli(['gateway','--connection',${JSON.stringify(connectionId)}],${JSON.stringify(home)});\n`, { mode: 0o600 });
  const skillPath = join(home, '.agents/skills/agentwiki-local-sync/SKILL.md');
  await mkdir(dirname(skillPath), { recursive: true, mode: 0o700 });
  await copyFile(join(root, 'packages/local-sync/skill/SKILL.md'), skillPath);
  return { id: agent.id, credentialId: exchange.credentialId, apiKey: exchange.apiKey, home, wrapperPath, skillPath };
}

export async function serve({ databaseUrl, statePath, confirmation, expectedCommit }) {
  validateDatabaseUrl(databaseUrl); validateStatePath(statePath);
  if (confirmation !== fixtureHash('v1')) throw new Error('Explicit v1 fixture hash confirmation required');
  const parent = await lstat(dirname(statePath));
  if (!parent.isDirectory() || parent.uid !== process.getuid?.() || (parent.mode & 0o777) !== 0o700) throw new Error('State parent must be a private owned directory');
  try { await lstat(statePath); throw new Error('State already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const product = await identity(expectedCommit);
  const packageVersion = JSON.parse(await readFile(join(root, 'packages/local-sync/package.json'), 'utf8')).version;
  const workspace = await createOwnedWorkspace();
  let artifacts;
  try { artifacts = await mkdtemp(join(dirname(statePath), 'source-freshness-evidence-')); await chmod(artifacts, 0o700); }
  catch (error) { await workspace.cleanup(); throw error; }
  const controller = new AbortController();
  let shutdown;
  const stopped = new Promise(done => { shutdown = done; });
  const onSignal = () => { controller.abort(); shutdown(); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  const children = new Map();
  const sessions = new Map();
  const sessionCleanup = {};
  let cleanupState = async () => {};
  let databaseCleaned = false;
  let ready = false;
  let scopeReceipt;
  let phase = 'redis';
  let stopMonitoring = () => {};
  const secrets = [databaseUrl];
  const record = row => appendFile(join(artifacts, 'http.jsonl'), JSON.stringify(sanitize(row, secrets)) + '\n', { mode: 0o600 });
  const stopChildren = async names => {
    const results = await Promise.allSettled(names.map(async name => {
      const child = children.get(name);
      await stopChild(child);
    }));
    if (results.some(result => result.status === 'rejected')) throw new Error('Owned process cleanup failed');
  };
  const stopScope = async () => {
    stopMonitoring();
    if (!await cleanupOwnedScope({ removeState: cleanupState, sessions, sessionReceipts: sessionCleanup, children })) throw new Error('Scoped resources could not be stopped');
  };
  try {
    const redisPort = await availablePort();
    const redisUrl = `redis://127.0.0.1:${redisPort}/0`;
    const redis = startOwnedRedis(redisPort, workspace.path); children.set('redis', redis);
    await waitReady(redis, async () => redis.output.includes('Ready to accept connections'), controller.signal);
    assertTestRedisAvailable(resolveTestRedisTarget(redisUrl, { environment: isolatedEnvironment() }));
    phase = 'reviewed-database';
    await withCollaborationTestDatabase(databaseUrl, async scope => {
      scopeReceipt = { schemaName: scope.schemaName, migrationTreeDigest: scope.migrationTreeDigest, publicInventoryDigest: scope.publicInventoryDigest };
      try {
        controller.signal.throwIfAborted();
        const apiPort = await availablePort();
        let webPort = await availablePort();
        while (webPort === apiPort) webPort = await availablePort();
        const apiUrl = `http://127.0.0.1:${apiPort}/api`;
        const webOrigin = `http://127.0.0.1:${webPort}`;
        const env = { ...isolatedEnvironment(), NODE_ENV: 'test', PROCESS_ROLE: 'api', AGENTWIKI_LISTEN_HOST: '127.0.0.1', PORT: String(apiPort), DATABASE_URL: scope.databaseUrl, REDIS_URL: redisUrl,
          JWT_SECRET: randomBytes(48).toString('hex'), AGENTWIKI_SERVER_PEPPER: randomBytes(48).toString('hex'), AGENTWIKI_DEPLOYMENT_SEED: randomBytes(32).toString('base64'),
          LOCAL_SYNC_PACKAGE_VERSION: packageVersion, PUBLIC_API_URL: apiUrl, CORS_ORIGINS: webOrigin, MCP_ALLOWED_HOSTS: '127.0.0.1,localhost', ATTACHMENT_STORAGE_PATH: workspace.path, INGEST_CONCURRENCY: '1' };
        phase = 'api-startup';
        const apiChild = startOwnedProcess(process.execPath, [join(root, 'apps/server/dist/main.js')], { cwd: workspace.path, env }); children.set('api', apiChild);
        await waitReady(apiChild, () => apiChild.output.includes(`Server running on http://localhost:${apiPort}`) ? checkApiHealth(apiUrl) : Promise.resolve(false), controller.signal);
        const email = `source-review-${randomUUID()}@example.test`;
        const password = `Synthetic-${randomUUID()}!`; secrets.push(password);
        const registration = await createApi({ apiUrl, record, signal: controller.signal })('/auth/register', { method: 'POST', body: { email, password, name: 'Synthetic Source Reviewer' } });
        const owner = { email, password, token: registration.access_token, userId: registration.user.id }; secrets.push(owner.token);
        const api = createApi({ apiUrl, owner, secrets, record, signal: controller.signal });
        const space = await api('/spaces', { method: 'POST', body: { name: 'Source Review Acceptance' } });
        const tree = await api(`/spaces/${id(space.id)}/content-tree?take=1`);
        const unrelated = await api('/pages', { method: 'POST', body: { ...unrelatedPage, spaceId: space.id, expectedTreeRevision: tree.treeRevision } });
        const agents = {};
        for (const label of ['a', 'b']) { agents[label] = await prepareReader(api, { apiUrl, spaceId: space.id, workspace: workspace.path, label, packageVersion, signal: controller.signal }); secrets.push(agents[label].apiKey); }
        for (const version of ['v1', 'v2', 'v3']) await privateJson(join(artifacts, `${version}.okf.json`), fixtureEnvelope(version));
        phase = 'worker-startup';
        const worker = startOwnedProcess(process.execPath, [join(root, 'apps/server/dist/worker.js')], { cwd: workspace.path, env: { ...env, PROCESS_ROLE: 'worker' } }); children.set('worker', worker);
        await waitReady(worker, async () => worker.output.includes('AgentWiki ingestion worker started'), controller.signal);
        phase = 'confirmed-v1-intake';
        const submission = await uploadConfirmed(api, { spaceId: space.id, version: 'v1', idempotencyKey: 'freshness-main-v1', confirmation });
        if (submission.status !== 'queued' || !submission.runId) throw new Error('Initial fixture must create a real queued Run');
        const run = await waitForCandidate(api, submission.runId, { signal: controller.signal });
        if (run.changeSet.items.length !== 2 || run.changeSet.items.some(item => item.type !== 'create_page' || item.status !== 'pending')) throw new Error('Expected two undecided v1 page candidates');
        phase = 'built-preview';
        const configPath = join(workspace.path, 'preview.config.mjs');
        await writeFile(configPath, previewConfig({ workspace: workspace.path, webPort, apiOrigin: `http://127.0.0.1:${apiPort}`, clientRoot: join(root, 'apps/client'), dist: join(root, 'apps/client/dist') }), { mode: 0o600 });
        const web = startOwnedProcess(process.execPath, [join(root, 'apps/client/node_modules/vite/bin/vite.js'), 'preview', '--config', configPath, '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], { cwd: workspace.path, env: isolatedEnvironment() }); children.set('web', web);
        await waitReady(web, async () => web.output.includes(String(webPort)) && (await fetch(webOrigin, { redirect: 'error', signal: AbortSignal.timeout(5000) })).ok, controller.signal);
        if (!await checkApiHealth(webOrigin + '/api')) throw new Error('Preview proxy health failed');
        for (const label of ['a', 'b']) {
          const session = await startPersistentReadSession({ agent: label, ...agents[label], secrets }); sessions.set(label, session);
          const { close, ...metadata } = session; Object.assign(agents[label], metadata);
        }
        const consumerPath = join(root, 'scripts/knowledge-retrieval-agent-client.mjs');
        const common = { product, ...scopeReceipt, connectionMode: 'persistent stdio per consumer', fixtureHashes: Object.fromEntries(['v1', 'v2', 'v3'].map(version => [version, fixtureHash(version)])), apiUrl, webOrigin, spaceId: space.id, unrelatedPageId: unrelated.id, initial: { ...submission, changeSetId: run.changeSet.id }, consumerPath };
        await privateJson(join(artifacts, 'run.json'), sanitize({ ...common, prepared: 'v1 pending_review', modelExecuted: false, humanUiExecuted: false, processes: Object.fromEntries([...children].map(([name, child]) => [name, child.pid])) }, secrets));
        controller.signal.throwIfAborted();
        cleanupState = await writeOwnedState(statePath, { kind: 'source-freshness', version: 2, harnessPid: process.pid, resourceRoot: workspace.path, artifacts, owner, agents, ...common });
        ready = true; phase = 'human-ui-and-agent-ready';
        let runtimeFailure;
        stopMonitoring = monitorOwnedChildren(children, message => { runtimeFailure = message; controller.abort(); shutdown(); });
        process.stdout.write(JSON.stringify({ status: 'READY', statePath, artifacts, apiUrl, webOrigin, spaceId: space.id, changeSetId: run.changeSet.id, consumerPath }) + '\n');
        await stopped;
        if (runtimeFailure) throw new Error(runtimeFailure);
      } finally { await stopScope(); }
    });
    databaseCleaned = true;
  } catch (error) {
    await privateJson(join(artifacts, 'failure.json'), { phase, error: sanitize(error.message, secrets) });
    throw new Error(`Source acceptance failed at ${phase}; inspect private diagnostics`);
  } finally {
    const cleanupResults = [...await Promise.allSettled([stopScope()]), ...await Promise.allSettled([stopChildren(['redis'])])];
    for (const child of children.values()) child.secretValues.push(...secrets);
    await privateJson(join(artifacts, 'process-diagnostics.json'), [...children].map(([name, child]) => ownedProcessDiagnostic(child, name)));
    for (const label of ['a', 'b']) {
      try { await copyFile(join(workspace.path, `consumer-${label}/trace.jsonl`), join(artifacts, `trace-${label}.jsonl`)); await chmod(join(artifacts, `trace-${label}.jsonl`), 0o600); }
      catch (error) { if (error.code !== 'ENOENT') cleanupResults.push({ status: 'rejected' }); }
    }
    const removed = cleanupResults.every(result => result.status === 'fulfilled') ? await Promise.allSettled([workspace.cleanup()]) : [{ status: 'rejected' }];
    const resourcesRemoved = [...cleanupResults, ...removed].every(result => result.status === 'fulfilled');
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
    const receipt = { status: databaseCleaned && resourcesRemoved ? 'CLEANED' : 'STOPPED_WITH_UNVERIFIED_CLEANUP', ready, databaseCleaned, protectedInventoryVerified: databaseCleaned, resourcesRemoved, sessions: sessionCleanup, ...scopeReceipt };
    await privateJson(join(artifacts, 'cleanup.json'), receipt);
    process.stdout.write(JSON.stringify(receipt) + '\n');
    if (!resourcesRemoved) process.exitCode = 1;
  }
}

export async function main(argv) {
  const [command, ...args] = argv;
  if (command === 'plan' && args.length === 0) return process.stdout.write(JSON.stringify(createPlan(), null, 2) + '\n');
  if (command === 'fixture' && args.length >= 1 && args.length <= 2) return process.stdout.write(JSON.stringify({ confirmation: fixtureHash(...args), envelope: fixtureEnvelope(...args) }, null, 2) + '\n');
  if (command === 'serve' && args.length === 2 && args[0].startsWith('--confirm-fixture=') && args[1].startsWith('--expected-commit=')) return serve({ databaseUrl: process.env.SOURCE_FRESHNESS_TEST_DATABASE_URL, statePath: process.env.SOURCE_FRESHNESS_STATE_FILE, confirmation: args[0].slice(18), expectedCommit: args[1].slice(18) });
  if (command === 'operator' && args.length === 3 && args[0].startsWith('--state=')) {
    const state = await loadOperatorState(args[0].slice(8));
    const secrets = [state.owner.token, state.owner.password, ...Object.values(state.agents).map(agent => agent.apiKey)];
    const record = row => appendFile(join(state.artifacts, 'operator-http.jsonl'), JSON.stringify(row) + '\n', { mode: 0o600 });
    const result = sanitize(await operatorAction(state, args[1], JSON.parse(args[2]), createApi({ ...state, secrets, record })), secrets);
    await appendFile(join(state.artifacts, 'operator-results.jsonl'), JSON.stringify({ at: new Date().toISOString(), action: args[1], result }) + '\n', { mode: 0o600 });
    return process.stdout.write(JSON.stringify(result) + '\n');
  }
  throw new Error('Usage: plan | fixture v1|v2|v3 [sourceKey] | serve --confirm-fixture=<hash> --expected-commit=<sha> | operator --state=<path> <action> <JSON>');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(() => {
  process.stderr.write('Source freshness acceptance failed. Check the private state, arguments or diagnostic receipt; no secrets printed.\n');
  process.exitCode = 1;
});
