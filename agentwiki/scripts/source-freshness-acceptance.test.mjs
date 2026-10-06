import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, chmod, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { fixtureEnvelope, fixtureHash, unrelatedPage } from './source-freshness-fixtures.mjs';
import { createPlan, createApi, uploadConfirmed, waitForCandidate, previewConfig, operatorAction, loadOperatorState, serve, monitorOwnedChildren, cleanupOwnedScope, identity, RUNTIME_INPUTS } from './source-freshness-acceptance.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const state = { kind: 'source-freshness', version: 2, apiUrl: 'http://127.0.0.1:34567/api', spaceId: 'space-test', owner: { token: 'TEST-OWNER-SECRET' }, agents: { a: { id: 'agent-a', credentialId: 'credential-a' } } };

test('fixtures preserve exact A identity on replay and hash every document', () => {
  const a = fixtureEnvelope('v1');
  assert.deepEqual(fixtureEnvelope('v1'), a);
  assert.equal(a.documents.length, 2);
  assert.deepEqual(Object.keys(a.documents[0]).sort(), ['content', 'contentHash', 'evidence', 'path']);
  for (const version of ['v1', 'v2', 'v3']) for (const doc of fixtureEnvelope(version).documents) {
    assert.equal(doc.contentHash, hash(doc.content));
    assert.ok(doc.evidence[0].quote.length <= 500);
    assert.equal(doc.evidence[0].sourceHash, hash(doc.evidence[0].quote));
  }
  assert.notEqual(fixtureHash('v1'), fixtureHash('v2'));
  assert.notEqual(fixtureHash('v2'), fixtureHash('v3'));
  assert.equal(fixtureEnvelope('v2').sourceKey, a.sourceKey);
  assert.equal('sourceId' in unrelatedPage, false);
  for (const key of ['../bad', '/absolute', 'a/b', 'a'.repeat(129)]) assert.throws(() => fixtureEnvelope('v1', key));
  assert.throws(() => fixtureEnvelope('v4'));
});

test('plan explicitly stops before UI approval and never claims model or runtime execution', () => {
  const plan = createPlan();
  assert.equal(plan.workerRequired, true);
  assert.equal(plan.modelExecuted, false);
  assert.equal(plan.prepares, 'v1 pending_review; no automatic decisions or publication');
  assert.equal(plan.confirmFixtureHash, fixtureHash('v1'));
});

test('confirmed upload uses exact multipart/header contract and rejects confirmation before fetch', async () => {
  const calls = [];
  const api = createApi({ ...state, fetchImpl: async (url, init) => {
    calls.push([url, init]);
    return Response.json({ status: 'queued', sourceId: 'source-1', sourceVersionId: 'version-1', runId: 'run-1' });
  } });
  await assert.rejects(uploadConfirmed(api, { spaceId: state.spaceId, version: 'v1', idempotencyKey: 'K1', confirmation: 'wrong' }), /confirmation/i);
  assert.equal(calls.length, 0);
  await uploadConfirmed(api, { spaceId: state.spaceId, version: 'v1', idempotencyKey: 'K1', confirmation: fixtureHash('v1') });
  assert.equal(calls.length, 1);
  const [url, request] = calls[0];
  assert.equal(url, state.apiUrl + '/spaces/space-test/knowledge-syncs');
  assert.equal(request.headers['x-agentwiki-user-confirmed'], 'true');
  assert.equal(request.headers['idempotency-key'], 'K1');
  assert.equal(request.headers['Content-Type'], undefined);
  assert.deepEqual(JSON.parse(await request.body.get('file').text()), fixtureEnvelope('v1'));
  assert.match(request.body.get('file').name, /\.okf\.json$/);
});

test('API cannot redirect credentials and receipts redact secrets even on errors', async () => {
  const receipts = [];
  let request;
  const api = createApi({ ...state, secrets: ['TEST-OWNER-SECRET'], record: row => receipts.push(row), fetchImpl: async (_url, init) => {
    request = init;
    return Response.json({ code: 'SOURCE_VERSION_CONFLICT', content: 'TEST-OWNER-SECRET', config: { apiKey: 'agk_unexpected' } }, { status: 409 });
  } });
  await assert.rejects(api('/pages/p'), error => /409/.test(error.message) && !error.message.includes('SECRET'));
  assert.equal(request.redirect, 'error');
  assert.equal(receipts[0].status, 409);
  assert.equal(receipts[0].code, 'SOURCE_VERSION_CONFLICT');
  assert.doesNotMatch(JSON.stringify(receipts), /TEST-OWNER-SECRET|agk_unexpected/);
  for (const path of ['https://evil.test', '//evil.test', '/pages/../auth', '/pages/p?token=SECRET']) await assert.rejects(api(path));
});

test('candidate polling requires completed worker and actual pending review items', async () => {
  let calls = 0;
  const api = async () => (++calls === 1 ? { status: 'compiling' } : { id: 'run', status: 'completed', changeSet: { id: 'cs', status: 'pending_review', items: [{ id: 'i1' }, { id: 'i2' }] } });
  const result = await waitForCandidate(api, 'run', { pause: async () => {}, timeoutMs: 100 });
  assert.equal(result.changeSet.id, 'cs');
  await assert.rejects(waitForCandidate(async () => ({ status: 'completed', changeSet: { status: 'published', items: [] } }), 'r'), /pending review/i);
  await assert.rejects(waitForCandidate(async () => ({ status: 'failed', error: 'secret' }), 'r'), error => !error.message.includes('secret'));
});

test('operator operations cannot approve or publish and validate Space before mutations', async () => {
  const calls = [];
  const api = async (path, options) => { calls.push([path, options]); return { id: 'source', spaceId: state.spaceId, treeRevision: '4', updatedAt: '2026-10-07T00:00:00.000Z' }; };
  for (const action of ['approve', 'publish', 'review-publish', 'accept']) await assert.rejects(operatorAction(state, action, {}, api));
  assert.equal(calls.length, 0);
  await operatorAction(state, 'new-run', { sourceId: 'source', idempotencyKey: 'regenerate-current' }, api);
  assert.deepEqual(calls.map(([path]) => path), ['/sources/source', '/sources/source/runs']);
  assert.equal(calls[1][1].headers['idempotency-key'], 'regenerate-current');
  calls.length = 0;
  await assert.rejects(operatorAction(state, 'archive', { sourceId: 'source' }, async () => ({ spaceId: 'other' })), /Space/);
  await assert.rejects(operatorAction(state, 'manual-edit', { pageId: '../bad', content: 'body' }, api));
  await operatorAction(state, 'manual-edit', { pageId: 'page', content: 'body' }, api);
  assert.deepEqual(calls.at(-1), ['/pages/page', { method: 'PATCH', body: { content: 'body', expectedUpdatedAt: '2026-10-07T00:00:00.000Z' } }]);
});

test('built frontend config uses isolated env directory and exact loopback API proxy', () => {
  const text = previewConfig({ workspace: '/tmp/owned space', webPort: 34568, apiOrigin: 'http://127.0.0.1:34567', clientRoot: '/tmp/client', dist: '/tmp/frozen-dist' });
  assert.match(text, /envDir.*owned space/);
  assert.match(text, /outDir.*frozen-dist/);
  assert.match(text, /strictPort: true/);
  assert.match(text, /\/socket.io/);
  assert.doesNotMatch(text, /process\.env|\.\.\.base|vite\.config/);
  assert.throws(() => previewConfig({ workspace: '/tmp/owned', webPort: 34568, apiOrigin: 'https://remote.test', clientRoot: '/tmp/client', dist: '/tmp/dist' }));
});

test('operator state rejects public, stale and cross-origin files before any HTTP call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'source-freshness-state-test-'));
  const path = join(directory, 'state.json');
  try {
    const artifacts = join(directory, 'source-freshness-evidence-test');
    await mkdir(artifacts, { mode: 0o700 });
    const valid = { ...state, harnessPid: process.pid, resourceRoot: directory, artifacts };
    await writeFile(path, JSON.stringify(valid), { mode: 0o644 });
    await assert.rejects(loadOperatorState(path));
    await chmod(path, 0o600);
    assert.equal((await loadOperatorState(path)).spaceId, state.spaceId);
    await writeFile(path, JSON.stringify({ ...valid, artifacts: tmpdir() }));
    await assert.rejects(loadOperatorState(path), /evidence/);
    await writeFile(path, JSON.stringify({ ...valid, apiUrl: 'https://example.test/api' }));
    await assert.rejects(loadOperatorState(path));
    await writeFile(path, JSON.stringify({ ...valid, harnessPid: -1 }));
    await assert.rejects(loadOperatorState(path));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('serve refuses absent approval or unsafe database before creating resources', async () => {
  await assert.rejects(serve({ databaseUrl: 'postgres://u:SECRET@example.test/test', statePath: '/tmp/never-created-source-state.json', confirmation: fixtureHash('v1') }), error => !error.message.includes('SECRET'));
  await assert.rejects(serve({ databaseUrl: 'postgres://u:p@127.0.0.1/source_test', statePath: '/tmp/never-created-source-state.json', confirmation: 'wrong' }), /confirmation/i);
});

test('an unexpected owned child exit ends the run, while deliberate shutdown removes monitors', () => {
  const child = new EventEmitter();
  child.on('error', () => {}); // startOwnedProcess already retains a safe error handler.
  const failures = [];
  const stopMonitoring = monitorOwnedChildren(new Map([['worker', child]]), reason => failures.push(reason), 10000);
  child.emit('exit', 1, null);
  assert.deepEqual(failures, ['Owned worker exited during acceptance']);
  stopMonitoring();
  child.emit('error', new Error('sensitive runtime output'));
});

test('scope cleanup attempts all own children even when session cleanup fails', async () => {
  const order = [];
  const sessions = new Map([['a', { close: async () => { order.push('a'); throw new Error('close failed'); } }], ['b', { close: async () => { order.push('b'); return { gatewayExited: true }; } }]]);
  const result = await cleanupOwnedScope({
    removeState: async () => order.push('state'), sessions, sessionReceipts: {},
    children: new Map([['api', {}], ['worker', {}], ['web', {}], ['redis', {}]]),
    stopChild: async (_child, name) => order.push(name),
  });
  assert.equal(result, false);
  assert.equal(order[0], 'state');
  assert.ok(order.indexOf('b') < order.indexOf('worker'));
  assert.deepEqual(order.slice(-3), ['worker', 'web', 'api']);
  assert.equal(order.includes('redis'), false);
});

for (const changedPath of [
  'scripts/source-freshness-acceptance.mjs', 'scripts/source-freshness-fixtures.mjs',
  'scripts/e2e-safety.mjs', 'scripts/test-database-lifecycle.mjs',
  'scripts/package-manager-process-runner.mjs', 'pnpm-lock.yaml', 'packages/local-sync/package.json',
]) test(`reviewed identity rejects changed ${changedPath} before resources or artifact reads`, async () => {
  const expectedCommit = 'a'.repeat(40);
  let artifactReads = 0;
  let resourcesCreated = false;
  const runGit = (_command, args) => {
    if (args.includes('rev-parse')) return { status: 0, stdout: expectedCommit };
    const paths = args.slice(args.indexOf('--') + 1);
    const changed = `agentwiki/${changedPath}`;
    const matches = paths.some(path => changed === path || changed.startsWith(path + '/'));
    return { status: 0, stdout: matches ? ` M ${changed}\n` : '' };
  };
  await assert.rejects(async () => {
    await identity(expectedCommit, { runGit, digestPaths: async () => { artifactReads++; return {}; } });
    resourcesCreated = true; // Resources are created only after identity succeeds.
  }, /differ.*reviewed commit/i);
  assert.equal(artifactReads, 0);
  assert.equal(resourcesCreated, false);
});

test('identity hashes exactly the gated inputs and excludes documentation', async () => {
  const expectedCommit = 'b'.repeat(40);
  let gated;
  const hashed = [];
  const value = await identity(expectedCommit, {
    runGit: (_command, args) => {
      assert.ok(args[0].startsWith('--work-tree='));
      if (args.includes('rev-parse')) return { status: 0, stdout: expectedCommit };
      gated = args.slice(args.indexOf('--') + 1);
      return { status: 0, stdout: '' };
    },
    digestPaths: async paths => { hashed.push([...paths]); return { sha256: 'digest' }; },
  });
  assert.equal(value.commit, expectedCommit);
  assert.deepEqual(gated, [...hashed[0], ...hashed[2]].map(path => `agentwiki/${path}`));
  assert.equal(gated.some(path => /docs|\.superpowers/.test(path)), false);
});

test('runtime manifest covers every transitive local harness import', async () => {
  const paths = new Set(Object.values(RUNTIME_INPUTS).flat());
  const pending = ['scripts/source-freshness-acceptance.mjs'];
  const visited = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    assert.ok(paths.has(path), `Missing runtime input: ${path}`);
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/from\s+['"](\.\/[^'"]+\.mjs)['"]/g)) {
      pending.push(`scripts/${match[1].slice(2)}`);
    }
  }
  assert.ok(visited.has('scripts/package-manager-process-runner.mjs'));
  assert.ok(visited.has('scripts/test-database-lifecycle.mjs'));
});
