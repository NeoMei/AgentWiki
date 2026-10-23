#!/usr/bin/env node
'use strict';

// Integration probe for the built candidate and an actual administrator-owned
// OpenCode v2 CLI. Uses a loopback Anthropic fixture, fake credentials, temporary
// CLI homes, and nine synthetic documents. Never loads .env or saves app data.
//
// pnpm --filter @agentwiki/server build
// node docs/verification/agent-auto-edit-20261024/readiness-runtime-probe.cjs \
//   --opencode /absolute/path/to/opencode
// Optional: --root /path/to/agentwiki --scenarios success,init-failure,cancel,timeout
// Remote CLI, with candidate JS loaded in memory only:
//   node <this-script> --ssh-host user@host --remote-root /path/to/agentwiki
// Exit 0 means every selected scenario passed. Output contains metadata only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const TOOL_NAMES = ['agentwiki_directory_list_documents', 'agentwiki_directory_read_document'];
const FAKE_KEY = 'synthetic-readiness-probe-not-a-real-api-key';
const MARKERS = Array.from({ length: 9 }, (_, index) => `AW-PROBE-${String(index + 1).padStart(2, '0')}`);
const SCENARIOS = ['success', 'init-failure', 'cancel', 'timeout'];

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

function contentText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(part => part?.text ?? '').join('\n');
  return '';
}

function sendMessage(response, body, blocks, id) {
  const usesTools = blocks.some(block => block.type === 'tool_use');
  const stopReason = usesTools ? 'tool_use' : 'end_turn';
  const usage = { input_tokens: 20, output_tokens: 20 };
  if (!body.stream) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: body.model,
      content: blocks, stop_reason: stopReason, stop_sequence: null, usage }));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const event = (type, value) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  event('message_start', { message: { id, type: 'message', role: 'assistant', model: body.model,
    content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 0 } } });
  blocks.forEach((block, index) => {
    event('content_block_start', { index, content_block: block.type === 'tool_use'
      ? { type: 'tool_use', id: block.id, name: block.name, input: {} } : { type: 'text', text: '' } });
    event('content_block_delta', { index, delta: block.type === 'tool_use'
      ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
    event('content_block_stop', { index });
  });
  event('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 20 } });
  event('message_stop', {});
  response.end();
}

function createFixture(scenario) {
  const requests = [];
  const errors = [];
  const observed = { listed: false, read: new Set() };
  const replacement = '# Synthetic Bug Summary\n\n' + MARKERS.map(marker => `- ${marker}: verified synthetic record`).join('\n');
  const server = http.createServer((request, response) => {
    void (async () => {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        assert.ok(bytes <= 2_000_000, 'Fixture request exceeded its synthetic budget');
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.ok(request.url.endsWith('/messages'), 'Unexpected fixture endpoint');
      const authentication = String(request.headers['x-api-key'] || request.headers.authorization || '');
      assert.ok(authentication.includes(FAKE_KEY), 'Provider did not use the isolated fake key');
      const system = contentText(body.system).toLowerCase();
      // Classify the auxiliary request by its title instructions, never by a
      // missing tools array: doing that would conceal the startup race.
      const title = system.includes('title generator') || system.includes('output only a thread title')
        || system.includes('you name conversations so the user can find them later');
      const toolNames = (body.tools || []).map(tool => tool.name).sort();
      const results = (body.messages || []).flatMap(message => Array.isArray(message.content) ? message.content : [])
        .filter(block => block.type === 'tool_result');
      for (const result of results) {
        const text = contentText(result.content);
        if (result.tool_use_id === 'synthetic_list' && !result.is_error
          && MARKERS.every((_, index) => text.includes(`probe-page-${index}`))) observed.listed = true;
        for (const marker of MARKERS) if (!result.is_error && text.includes(marker)) observed.read.add(marker);
      }
      const metadata = { title, toolNames, toolResultCount: results.length, toolErrors: results.filter(result => result.is_error).length };
      requests.push(metadata);
      const primaryNumber = requests.filter(item => !item.title).length;
      if (title) {
        sendMessage(response, body, [{ type: 'text', text: 'Synthetic readiness check' }], `msg_title_${requests.length}`);
        return;
      }
      // A broken barrier must not be hidden by a cooperative fixture. The first
      // business request must already advertise exactly the two read tools.
      if (scenario === 'success') assert.deepEqual(toolNames, [...TOOL_NAMES].sort(), 'Business request lacks the authorized tools');
      let blocks;
      if (scenario === 'success' && primaryNumber === 1) {
        blocks = [
          { type: 'text', text: 'I will read the synthetic reports.' },
          { type: 'tool_use', id: 'synthetic_list', name: TOOL_NAMES[0], input: {} },
        ];
      } else if (scenario === 'success' && primaryNumber === 2) {
        assert.ok(observed.listed, 'Directory listing did not return all nine synthetic page IDs');
        blocks = MARKERS.map((_, index) => ({ type: 'tool_use', id: `synthetic_read_${index}`, name: TOOL_NAMES[1], input: { pageId: `probe-page-${index}` } }));
      } else {
        if (scenario === 'success') {
          assert.equal(primaryNumber, 3, 'Unexpected extra business model round');
          assert.equal(observed.read.size, 9, 'Directory reads did not return all nine synthetic markers');
          assert.equal(metadata.toolErrors, 0, 'A directory tool returned an error');
        }
        // Negative scenarios intentionally offer a valid update if execution
        // reaches the provider. The runner must reject before accepting it.
        blocks = [{ type: 'text', text: JSON.stringify({ action: 'update', summary: 'Prepared synthetic report.', changes: replacement }) }];
      }
      sendMessage(response, body, blocks, `msg_primary_${primaryNumber}`);
    })().catch(error => {
      errors.push(error.message);
      if (!response.headersSent) response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Synthetic probe assertion failed' } }));
    });
  });
  return { server, requests, errors, observed, replacement };
}

async function runScenario(Runner, executable, scenario) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'agentwiki-readiness-integration-'));
  const fixture = createFixture(scenario);
  const startedAt = Date.now();
  let abortTimer;
  let capturedConfig;
  let result;
  let failure;
  let cliVersion;
  try {
    await new Promise((resolve, reject) => {
      fixture.server.once('error', reject);
      fixture.server.listen(0, '127.0.0.1', resolve);
    });
    const baseURL = `http://127.0.0.1:${fixture.server.address().port}/v1`;
    const configValues = { OPENCODE_BIN: executable, ASSIST_ALIYUN_CODING_PLAN_API_KEY: FAKE_KEY };
    const runner = new Runner({ get: key => configValues[key] });
    // Never pass any real credential from the invoking shell to the CLI.
    runner.llmEnv = () => ({});
    assert.equal(runner.cliMajor, 2, 'This probe requires an actual OpenCode v2 CLI');
    cliVersion = runner.resolveLaunch().version;
    const originalConfig = runner.isolatedConfig.bind(runner);
    const delayMs = scenario === 'success' ? 3000 : 6000;
    const delayFile = path.join(temporary, 'delay-mcp.mjs');
    fs.writeFileSync(delayFile, `await new Promise(resolve => setTimeout(resolve, ${delayMs}));\n`, { mode: 0o600 });
    runner.isolatedConfig = (...args) => {
      const config = originalConfig(...args);
      assert.deepEqual(config.permissions, [
        { action: '*', resource: '*', effect: 'deny' },
        { action: 'agentwiki_directory_*', resource: '*', effect: 'allow' },
      ], 'Probe must preserve the application tool permission policy');
      const provider = config.providers?.['bailian-coding-plan'];
      assert.ok(provider, 'Candidate must configure the v2 provider');
      provider.settings.baseURL = baseURL;
      provider.settings.apiKey = FAKE_KEY;
      const mcp = config.mcp?.servers?.agentwiki_directory;
      assert.equal(mcp?.codemode, false, 'Directory tools must be exposed directly');
      assert.equal(provider.models?.['qwen3.7-plus']?.capabilities?.tools, true);
      if (scenario === 'init-failure') {
        mcp.command = [process.execPath, '-e', "process.stderr.write('Synthetic MCP startup failure\\n');process.exit(17)"];
      } else {
        mcp.command = [mcp.command[0], '--import', delayFile, ...mcp.command.slice(1)];
      }
      capturedConfig = { originalPermissionPolicyPreserved: true, codemode: mcp.codemode,
        startupDelayMs: scenario === 'init-failure' ? null : delayMs };
      return config;
    };
    const directory = { folderId: 'probe-folder', title: 'Synthetic reports', recursive: true,
      documents: MARKERS.map((marker, index) => ({ pageId: `probe-page-${index}`, title: `Synthetic report ${index + 1}`,
        content: `# Synthetic report\n\n${marker}: synthetic regression passed.`, updatedAt: '2026-10-24T00:00:00.000Z', folderId: 'probe-folder' })) };
    const task = { mode: 'auto', intent: 'Read all nine synthetic reports in this directory and update the current Synthetic Bug Summary.',
      actions: { update: true, create: false }, pageSnapshot: { title: 'Synthetic Bug Summary', content: '# Synthetic Bug Summary\n\nPending.' },
      context: { pageId: 'probe-summary', references: [], noteIds: [], directory } };
    const abort = new AbortController();
    const pending = runner.runModel(runner.buildPrompt(task, 'update'), 'bailian-coding-plan/qwen3.7-plus', scenario === 'timeout' ? 1500 : 25000,
      undefined, { mode: 'auto', action: 'update', actions: task.actions, directory, signal: abort.signal });
    if (scenario === 'cancel') abortTimer = setTimeout(() => abort.abort(), 300);
    try { result = await pending; }
    catch (error) { failure = { code: error.code || error.name, scope: error.scope }; }
    const primary = fixture.requests.filter(request => !request.title);
    assert.deepEqual(fixture.errors, [], 'Mock provider assertions failed');
    if (scenario === 'success') {
      assert.equal(failure, undefined, 'Candidate rejected a ready directory run');
      assert.equal(result?.action, 'update');
      assert.equal(result.changes, fixture.replacement);
      assert.equal(primary.length, 3);
      assert.equal(fixture.observed.read.size, 9);
      assert.ok(fixture.observed.listed);
    } else {
      assert.equal(result, undefined, 'Candidate accepted an update without directory readiness');
      assert.ok(failure, 'A negative scenario must fail closed');
      assert.equal(primary.length, 0, 'The provider must not receive business input before directory readiness');
      if (scenario === 'cancel') assert.equal(failure.code, 'cancelled');
      if (scenario === 'timeout') assert.equal(failure.code, 'timeout');
    }
    return { scenario, passed: true, cliVersion, elapsedMs: Date.now() - startedAt, ...capturedConfig,
      businessRequests: primary.length, titleRequests: fixture.requests.length - primary.length,
      firstBusinessTools: primary[0]?.toolNames || [], listed: fixture.observed.listed, readMarkers: fixture.observed.read.size,
      acceptedAction: result?.action || null, failure: failure || null };
  } catch (error) {
    return { scenario, passed: false, cliVersion, elapsedMs: Date.now() - startedAt, ...capturedConfig,
      assertion: error.message, failure: failure || null, acceptedAction: result?.action || null,
      requests: fixture.requests, fixtureErrors: fixture.errors };
  } finally {
    clearTimeout(abortTimer);
    fixture.server.closeAllConnections();
    await new Promise(resolve => fixture.server.close(resolve));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function main() {
  const root = path.resolve(option('--root', path.resolve(__dirname, '../../..')));
  const executable = option('--opencode', process.env.PROBE_OPENCODE_BIN || process.env.OPENCODE_BIN || 'opencode');
  const selected = option('--scenarios', SCENARIOS.join(',')).split(',');
  assert.ok(selected.length && selected.every(value => SCENARIOS.includes(value)), 'Unknown probe scenario');
  const dist = path.join(root, 'apps/server/dist/assist/opencode.runner.js');
  assert.ok(fs.existsSync(dist), 'Build the candidate server before running this probe');
  const sshHost = option('--ssh-host', '');
  if (sshHost) {
    assert.ok(!sshHost.startsWith('-') && !/\s/.test(sshHost), 'Invalid SSH host');
    const remoteRoot = option('--remote-root', '/root/agentwiki');
    assert.ok(path.isAbsolute(remoteRoot), '--remote-root must be absolute');
    const modules = ['opencode-directory-readiness', 'assist-auto-response', 'opencode.runner'].map(name => ({
      name, source: fs.readFileSync(path.join(root, 'apps/server/dist/assist', `${name}.js`), 'utf8'),
    }));
    const script = fs.readFileSync(__filename, 'utf8');
    const bootstrap = `
const Module = require('node:module');
const path = require('node:path');
const root = ${JSON.stringify(remoteRoot)};
const injected = ${JSON.stringify(modules)};
globalThis.__agentwikiProbeInjectedSources = Object.fromEntries(injected.map(item => [item.name, item.source]));
const filenames = new Set(injected.map(item => path.join(root, 'apps/server/dist/assist', item.name + '.js')));
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  const candidate = request.startsWith('.') && parent?.filename
    ? path.resolve(path.dirname(parent.filename), request) : path.isAbsolute(request) ? request : undefined;
  if (candidate && filenames.has(candidate)) return candidate;
  if (candidate && filenames.has(candidate + '.js')) return candidate + '.js';
  return resolveFilename.call(this, request, parent, ...rest);
};
for (const item of injected) {
  const filename = path.join(root, 'apps/server/dist/assist', item.name + '.js');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  require.cache[filename] = loaded;
  loaded._compile(item.source, filename);
  loaded.loaded = true;
}
process.argv = ['node', 'readiness-runtime-probe.cjs', '--root', root, '--opencode', ${JSON.stringify(executable)}, '--scenarios', ${JSON.stringify(selected.join(','))}];
const filename = path.join(root, 'docs/verification/agent-auto-edit-20261024/readiness-runtime-probe.cjs');
const probe = new Module(filename, module);
probe.filename = filename;
probe.paths = Module._nodeModulePaths(path.dirname(filename));
probe._compile(${JSON.stringify(script)}, filename);
`;
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshHost, 'node'], { stdio: ['pipe', 'inherit', 'inherit'] });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(signal ? 1 : code ?? 1));
      child.stdin.on('error', () => {});
      child.stdin.end(bootstrap);
    });
    process.exitCode = exitCode;
    return;
  }
  const { OpencodeCliRunner } = require(dist);
  const receipt = { createdAt: new Date().toISOString(), syntheticOnly: true, realProviderCredentials: false,
    applicationWrites: false, platform: process.platform, nodeVersion: process.version, executable,
    candidateModuleSha256: Object.fromEntries(['opencode-directory-readiness', 'assist-auto-response', 'opencode.runner'].map(name => {
      const filename = path.join(root, 'apps/server/dist/assist', `${name}.js`);
      const source = globalThis.__agentwikiProbeInjectedSources?.[name] ?? fs.readFileSync(filename);
      return [name, createHash('sha256').update(source).digest('hex')];
    })), checks: [] };
  for (const scenario of selected) {
    const check = await runScenario(OpencodeCliRunner, executable, scenario);
    receipt.checks.push(check);
    process.stdout.write(`PROBE_CHECK ${JSON.stringify(check)}\n`);
  }
  receipt.passed = receipt.checks.every(check => check.passed);
  process.stdout.write(`PROBE_RECEIPT ${JSON.stringify(receipt)}\n`);
  process.exitCode = receipt.passed ? 0 : 1;
}

main().catch(error => {
  process.stderr.write(`PROBE_ERROR ${JSON.stringify({ message: error.message })}\n`);
  process.exitCode = 1;
});
