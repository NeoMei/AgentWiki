import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, stat, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { corpus, publicQuestions, operatorRubric, privateSentinel, hashCorpus } from './knowledge-retrieval-corpus.mjs';
import { validateStatePath, validateDatabaseUrl, createOwnedWorkspace, writeOwnedState, startOwnedProcess, startOwnedRedis, stopOwnedProcess, isolatedEnvironment } from './knowledge-retrieval-harness.mjs';
import { isAllowedReadTool, executeReadOperation, loadConsumerState, sanitizeTraceInput } from './knowledge-retrieval-agent-client.mjs';
import * as harness from './knowledge-retrieval-harness.mjs';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { z } = require('zod');

test('state and database validation reject shared/remote targets without echoing secrets', () => {
  for (const path of ['', 'relative.json', '/', '/tmp/../']) assert.throws(() => validateStatePath(path));
  assert.equal(validateStatePath('/tmp/retrieval-state.json'), '/tmp/retrieval-state.json');
  for (const value of [undefined, 'postgres://u:SECRET@example.com/test', 'postgres://u:SECRET@127.0.0.1/production', 'postgres://u:SECRET@127.0.0.1/test?schema=public']) {
    assert.throws(() => validateDatabaseUrl(value), error => !error.message.includes('SECRET'));
  }
  assert.equal(validateDatabaseUrl('postgres://u:p@127.0.0.1/knowledge_test').hostname, '127.0.0.1');
});

test('fixed public questions cannot expose rubric or private/evidence-only answers', () => {
  assert.equal(publicQuestions.length, 8);
  const questions = JSON.stringify(publicQuestions);
  assert.equal(questions.includes(privateSentinel), false);
  assert.equal(questions.includes('KR-EVIDENCE-47'), false);
  assert.equal(operatorRubric.length, 8);
  const reordered = Object.fromEntries(Object.entries(corpus).reverse());
  assert.equal(hashCorpus(corpus), hashCorpus(reordered));
  const changed = structuredClone(corpus);
  changed.pages[0].content += ' changed';
  assert.notEqual(hashCorpus(changed), hashCorpus(corpus));
  assert.equal(corpus.pages.some(page => page.content.includes('KR-EVIDENCE-47')), false);
});

test('facade denies writes and sanitizes unknown config fields without rewriting real arguments', async () => {
  assert.equal(isAllowedReadTool('wiki_propose_page'), false);
  assert.equal(isAllowedReadTool('local_read_artifacts'), false);
  assert.equal(isAllowedReadTool('wiki_get_page'), true);
  await assert.rejects(executeReadOperation(null, { operation: 'call', tool: 'wiki_propose_page', input: {} }), /read-only/);
  assert.deepEqual(sanitizeTraceInput({ spaceId: 's', __args: { query: '候选', token: 'SECRET' }, headers: { Authorization: 'SECRET' } }), { spaceId: 's', __args: { query: '候选' } });
});

test('actual SDK receipts distinguish tool errors from transport success and retain schemas', async () => {
  const server = new McpServer({ name: 'retrieval-contract-test', version: '1' });
  server.registerTool('wiki_get_page', { inputSchema: { pageId: z.string() } }, async ({ pageId }) => ({ content: [{ type: 'text', text: pageId }], isError: pageId === 'denied' }));
  server.registerTool('wiki_propose_page', { inputSchema: {} }, async () => ({ content: [] }));
  const client = new Client({ name: 'retrieval-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const listed = await executeReadOperation(client, { operation: 'tools' });
    assert.deepEqual(listed.result.tools.map(tool => tool.name), ['wiki_get_page']);
    assert.ok(listed.result.tools[0].inputSchema.properties.pageId);
    const denied = await executeReadOperation(client, { operation: 'call', tool: 'wiki_get_page', input: { pageId: 'denied' } });
    assert.equal(denied.trace.transportSuccess, true);
    assert.equal(denied.trace.success, false);
    assert.equal(denied.result.isError, true);
    assert.ok(denied.trace.responseBytes > 0);
    assert.match(denied.trace.responseHash, /^[a-f0-9]{64}$/);
    assert.equal(denied.trace.tokens, 'unknown');
    const accepted = await executeReadOperation(client, { operation: 'call', tool: 'wiki_get_page', input: { pageId: 'visible' } });
    assert.equal(accepted.trace.success, true);
    assert.equal(accepted.result.content[0].text, 'visible');
  } finally { await client.close(); await server.close(); }
  const failed = await executeReadOperation(client, { operation: 'call', tool: 'wiki_get_page', input: { pageId: 'visible' } });
  assert.equal(failed.trace.transportSuccess, false);
  assert.equal(failed.trace.success, false);
});

test('workspace and state cleanup preserve neighboring files and replacement state', async () => {
  const external = await mkdtemp(join(tmpdir(), 'retrieval-neighbor-'));
  const statePath = join(external, 'state.json');
  const workspace = await createOwnedWorkspace();
  try {
    await writeFile(join(external, 'keep'), 'keep');
    const cleanup = await writeOwnedState(statePath, { version: 1, resourceRoot: workspace.path });
    assert.equal((await stat(statePath)).mode & 0o777, 0o600);
    await assert.rejects(writeOwnedState(statePath, {}), /EEXIST/);
    await rm(statePath);
    await writeFile(statePath, 'replacement');
    await cleanup();
    assert.equal(await readFile(statePath, 'utf8'), 'replacement');
    await workspace.cleanup();
    await assert.rejects(access(workspace.path));
    assert.equal(await readFile(join(external, 'keep'), 'utf8'), 'keep');
  } finally { await workspace.cleanup(); await rm(external, { recursive: true, force: true }); }
});

test('owned process shutdown waits for termination without killing unrelated processes', async () => {
  const child = startOwnedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: tmpdir(), env: isolatedEnvironment() });
  await stopOwnedProcess(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});

test('owned Redis satisfies the product AOF durability prerequisite', {
  skip: spawnSync('redis-server', ['--version']).status !== 0 || spawnSync('redis-cli', ['--version']).status !== 0 ? 'Redis binaries unavailable' : false,
}, async () => {
  const workspace = await createOwnedWorkspace();
  const reservation = createServer();
  await new Promise(done => reservation.listen(0, '127.0.0.1', done));
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  const child = startOwnedRedis(port, workspace.path);
  try {
    const deadline = Date.now() + 5_000;
    while (!child.output.includes('Ready to accept connections') && Date.now() < deadline && child.exitCode === null) await new Promise(done => setTimeout(done, 25));
    const info = spawnSync('redis-cli', ['-h', '127.0.0.1', '-p', String(port), 'INFO', 'persistence'], { encoding: 'utf8' });
    assert.equal(info.status, 0);
    assert.match(info.stdout, /(?:^|\r?\n)aof_enabled:1(?:\r?\n|$)/);
  } finally { await stopOwnedProcess(child); await workspace.cleanup(); }
});

test('exit diagnostics preserve the cause but omit environment and credential values', () => {
  const diagnostic = harness.ownedProcessDiagnostic({ pid: 123, exitCode: 1, signalCode: null, output: 'Redis AOF persistence is not enabled\nJWT_SECRET=fixture-jwt-value\nBearer fixture-bearer-value\npostgres://user:password@localhost/test', secretValues: ['fixture-jwt-value'] }, 'api');
  assert.equal(diagnostic.stage, 'api');
  assert.equal(diagnostic.exitCode, 1);
  assert.match(diagnostic.output, /Redis AOF persistence is not enabled/);
  assert.doesNotMatch(JSON.stringify(diagnostic), /fixture-jwt-value|fixture-bearer-value|user:password/);
  assert.equal('secretValues' in diagnostic, false);
});

test('health probe allows the two AOF fsync waits before accepting a healthy API', async () => {
  const server = createHttpServer((_req, response) => {
    setTimeout(() => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"status":"ok"}'); }, 1_800);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try { assert.equal(await harness.checkApiHealth(`http://127.0.0.1:${server.address().port}`), true); }
  finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
});

test('consumer refuses invalid or public state before starting a gateway', async () => {
  const workspace = await createOwnedWorkspace();
  try {
    const path = join(workspace.path, 'state.json');
    await writeFile(path, JSON.stringify({ version: 1, apiUrl: 'https://example.com/api' }), { mode: 0o644 });
    await assert.rejects(loadConsumerState(path, 'a'));
    await assert.rejects(loadConsumerState(path, '../../other'));
  } finally { await workspace.cleanup(); }
});

test('isolated children never inherit provider credentials, proxy or database environment', () => {
  const env = isolatedEnvironment({ PATH: '/bin', OPENAI_API_KEY: 'SECRET', DATABASE_URL: 'SECRET', HTTPS_PROXY: 'SECRET' });
  assert.deepEqual(env, { PATH: '/bin' });
});

test('CLI crosses actual stdio SDK, redacts credentials and records failed connection attempts', async () => {
  const workspace = await createOwnedWorkspace();
  const statePath = join(workspace.path, 'state.json');
  const home = join(workspace.path, 'consumer-a');
  const wrapperPath = join(home, 'gateway.mjs');
  const cli = fileURLToPath(new URL('./knowledge-retrieval-agent-client.mjs', import.meta.url));
  const sdk = require.resolve('@modelcontextprotocol/sdk/server/mcp.js');
  const stdio = require.resolve('@modelcontextprotocol/sdk/server/stdio.js');
  try {
    await mkdir(home, { mode: 0o700 });
    await writeFile(wrapperPath, `import {createRequire} from 'node:module'; const require=createRequire(import.meta.url); const {McpServer}=require(${JSON.stringify(sdk)}); const {StdioServerTransport}=require(${JSON.stringify(stdio)}); const server=new McpServer({name:'fixture',version:'1'}); server.registerTool('wiki_get_page',{inputSchema:{}},async()=>({isError:true,content:[{type:'text',text:'SYNTHETIC-SECRET-123'}]})); await server.connect(new StdioServerTransport());`);
    const agent = { home, wrapperPath, apiKey: 'SYNTHETIC-SECRET-123' };
    await writeOwnedState(statePath, { version: 1, harnessPid: process.pid, resourceRoot: workspace.path, apiUrl: 'http://127.0.0.1:12345/api', agents: { a: agent, b: agent } });
    const run = () => spawnSync(process.execPath, [cli, `--state=${statePath}`, '--agent=a', 'call', 'wiki_get_page', '{}'], { encoding: 'utf8', env: isolatedEnvironment(), timeout: 8_000 });
    const toolError = run();
    assert.equal(toolError.status, 1, toolError.stderr);
    assert.equal(JSON.parse(toolError.stdout).isError, true);
    assert.equal(toolError.stdout.includes('SYNTHETIC-SECRET-123'), false);
    let traces = (await readFile(join(home, 'trace.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(traces[0].transportSuccess, true);
    assert.equal(traces[0].success, false);
    assert.equal(JSON.stringify(traces).includes('SYNTHETIC-SECRET-123'), false);
    await writeFile(wrapperPath, 'throw new Error("SYNTHETIC-SECRET-123");');
    const connectionError = run();
    assert.equal(connectionError.status, 1);
    assert.equal((connectionError.stdout + connectionError.stderr).includes('SYNTHETIC-SECRET-123'), false);
    traces = (await readFile(join(home, 'trace.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(traces.length, 2);
    assert.equal(traces[1].transportSuccess, false);
    assert.equal(traces[1].success, false);
  } finally { await workspace.cleanup(); }
});

test('plan is import-safe, secret-free and requires dedicated database only for serve', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./knowledge-retrieval-harness.mjs', import.meta.url)), 'plan'], { encoding: 'utf8', env: isolatedEnvironment() });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.questionCount, 8);
  assert.equal(plan.databaseIsolation, 'random collaboration_test_* schema');
  assert.equal(plan.modelExecuted, false);
});

test('serve rejects remote database before creating state or runtime artifacts', async () => {
  const workspace = await createOwnedWorkspace();
  try {
    const state = join(workspace.path, 'state.json');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./knowledge-retrieval-harness.mjs', import.meta.url)), 'serve'], { encoding: 'utf8', env: { ...isolatedEnvironment(), KNOWLEDGE_TEST_DATABASE_URL: 'postgres://user:SECRET@example.com/test', KNOWLEDGE_ACCEPTANCE_STATE_FILE: state } });
    assert.equal(result.status, 1);
    assert.equal((result.stdout + result.stderr).includes('SECRET'), false);
    await assert.rejects(access(state));
  } finally { await workspace.cleanup(); }
});
