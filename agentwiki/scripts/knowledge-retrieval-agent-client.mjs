// Consumer facade: no corpus, rubric, seeding or answer-generation imports.
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { appendFile, chmod, lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const allowed = new Set(['wiki_list_spaces', 'wiki_list_pages', 'wiki_search_pages', 'wiki_get_page', 'wiki_list_graph', 'wiki_list_sources']);
const inputKeys = new Set(['spaceId', 'pageId', 'query', 'limit', 'skip', 'take']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
export const isAllowedReadTool = name => allowed.has(name);

export function sanitizeTraceInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).flatMap(([key, value]) => {
    if (key === '__args') return [[key, sanitizeTraceInput(value)]];
    return inputKeys.has(key) && ['string', 'number'].includes(typeof value) ? [[key, value]] : [];
  }));
}

export async function executeReadOperation(client, { operation, tool, input = {} }) {
  if (operation !== 'tools' && (operation !== 'call' || !isAllowedReadTool(tool))) throw new Error('Only read-only knowledge tools are allowed');
  const started = performance.now();
  let result;
  let transportSuccess = false;
  try {
    if (operation === 'tools') {
      const tools = [];
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        tools.push(...page.tools.filter(item => isAllowedReadTool(item.name)));
        cursor = page.nextCursor;
      } while (cursor);
      result = { tools };
    } else result = await client.callTool({ name: tool, arguments: input }, undefined, { timeout: 45_000 });
    transportSuccess = true;
  } catch {
    // Transport errors can include Authorization/config diagnostics. Never echo them.
    result = { isError: true, content: [{ type: 'text', text: 'MCP transport failed; operator diagnostics required.' }] };
  }
  const bytes = JSON.stringify(result);
  return { result, trace: {
    operation, ...(tool ? { tool } : {}), input: sanitizeTraceInput(input),
    transportSuccess, toolIsError: result.isError === true, success: transportSuccess && result.isError !== true,
    responseBytes: Buffer.byteLength(bytes), responseHash: sha256(bytes), durationMs: Math.round(performance.now() - started), tokens: 'unknown',
  } };
}

export async function loadConsumerState(path, agent) {
  if (!isAbsolute(path) || !['a', 'b'].includes(agent)) throw new Error('Absolute state path and agent a or b required');
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid?.()) throw new Error('State must be an owned regular 0600 file');
  const state = JSON.parse(await readFile(path, 'utf8'));
  if (state.version !== 2 || !state.agents?.[agent] || !Number.isInteger(state.harnessPid)) throw new Error('Invalid retrieval state');
  const url = new URL(state.apiUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || !url.port) throw new Error('State must target an isolated loopback API');
  process.kill(state.harnessPid, 0);
  const root = await realpath(state.resourceRoot);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.uid !== process.getuid?.() || (rootInfo.mode & 0o777) !== 0o700) throw new Error('Workspace must be private and owned');
  const selected = state.agents[agent];
  for (const path of [selected.home, selected.wrapperPath]) {
    if (!isAbsolute(path) || !(await realpath(path)).startsWith(root + sep)) throw new Error('Consumer path escapes owned workspace');
  }
  const ipcRoot = await realpath(selected.ipcRoot);
  const tempRoot = await realpath('/tmp');
  const ipcInfo = await lstat(selected.ipcRoot);
  if (selected.ipcRoot !== ipcRoot || !ipcRoot.startsWith(tempRoot + '/aw-kr-') || ipcRoot.slice(tempRoot.length + 1).includes(sep) || !ipcInfo.isDirectory() || ipcInfo.uid !== process.getuid?.() || (ipcInfo.mode & 0o777) !== 0o700) throw new Error('Invalid private IPC directory');
  if (selected.socketPath !== join(ipcRoot, 'rpc.sock') || typeof selected.sessionId !== 'string' || !/^[0-9a-f-]{36}$/.test(selected.sessionId)) throw new Error('Invalid persistent session');
  const socket = await lstat(selected.socketPath);
  if (!socket.isSocket() || socket.uid !== process.getuid?.() || (socket.mode & 0o777) !== 0o600) throw new Error('IPC endpoint must be an owned 0600 socket');
  return state;
}

function redact(value, secrets) {
  let text = JSON.stringify(value);
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 8) text = text.split(secret).join('[REDACTED]');
  return JSON.parse(text);
}

const connectionMode = 'persistent stdio per consumer';
const validOperation = request => request?.operation === 'tools' || (request?.operation === 'call' && isAllowedReadTool(request.tool));

// One SDK client and real gateway per consumer; the shell facade never starts one.
export async function startPersistentReadSession({ agent, home, wrapperPath, secrets = [] }) {
  const ipcRoot = await realpath(await mkdtemp('/tmp/aw-kr-'));
  await chmod(ipcRoot, 0o700);
  const socketPath = join(ipcRoot, 'rpc.sock');
  const sessionId = randomUUID();
  const client = new Client({ name: `knowledge-retrieval-${agent}`, version: '2.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [wrapperPath], cwd: home, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stderr: 'pipe' });
  transport.stderr?.on('data', () => {});
  const connections = new Set();
  const pending = new Set();
  let traceWrites = Promise.resolve();
  let closing;
  let gatewayPid;
  let sessionStartupMs;
  const server = createServer(socket => {
    socket.setEncoding('utf8');
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(50_000, () => socket.destroy());
    let buffer = '';
    let accepted = false;
    socket.on('data', chunk => {
      if (accepted || closing) { socket.destroy(); return; }
      buffer += chunk.toString('utf8');
      if (Buffer.byteLength(buffer) > 64 * 1024) { socket.destroy(); return; }
      if (!buffer.includes('\n')) return;
      accepted = true;
      const task = (async () => {
        let request;
        try { request = JSON.parse(buffer.trim()); } catch { socket.end(JSON.stringify({ error: 'Invalid read-only request' }) + '\n'); return; }
        const { id } = request ?? {};
        if (typeof id !== 'string' || id.length > 64 || request.sessionId !== sessionId || !validOperation(request)) {
          socket.end(JSON.stringify({ id, error: 'Invalid read-only request' }) + '\n'); return;
        }
        const receipt = redact(await executeReadOperation(client, request), secrets);
        const trace = { at: new Date().toISOString(), agent, requestId: id, sessionId, connectionMode, ...receipt.trace, result: receipt.result };
        traceWrites = traceWrites.then(() => appendFile(join(home, 'trace.jsonl'), JSON.stringify(trace) + '\n', { mode: 0o600 }));
        await traceWrites;
        socket.end(JSON.stringify({ id, sessionId, ...receipt }) + '\n');
      })().catch(() => { socket.destroy(); });
      pending.add(task);
      void task.finally(() => pending.delete(task));
    });
  });
  // Avoid an unhandled error after readiness; existing and subsequent RPCs fail closed.
  server.on('error', () => { for (const socket of connections) socket.destroy(); });
  const close = () => {
    if (!closing) closing = (async () => {
      const serverClosed = new Promise((done, fail) => {
        if (!server.listening) return done();
        server.close(error => error ? fail(error) : done());
      });
      for (const socket of connections) socket.destroy();
      const stopped = await Promise.allSettled([client.close(), transport.close()]);
      await Promise.all([...pending]);
      await serverClosed;
      await traceWrites;
      if (stopped.some(result => result.status === 'rejected')) throw new Error('Persistent gateway cleanup failed');
      let gatewayExited = true;
      if (gatewayPid) { try { process.kill(gatewayPid, 0); gatewayExited = false; } catch (error) { if (error.code !== 'ESRCH') throw error; } }
      if (!gatewayExited) throw new Error('Persistent gateway is still alive');
      await rm(ipcRoot, { recursive: true });
      return { agent, sessionId, gatewayPid, gatewayExited, ipcRemoved: true, pendingCalls: pending.size };
    })();
    return closing;
  };
  try {
    const started = performance.now();
    await client.connect(transport, { timeout: 15_000 });
    gatewayPid = transport.pid;
    sessionStartupMs = Math.round(performance.now() - started);
    await new Promise((done, fail) => { server.once('error', fail); server.listen(socketPath, () => { server.removeListener('error', fail); done(); }); });
    await chmod(socketPath, 0o600);
    return { socketPath, ipcRoot, sessionId, gatewayPid, sessionStartupMs, connectionMode, close };
  } catch {
    gatewayPid = transport.pid;
    await close();
    throw new Error('Persistent read-only gateway startup failed');
  }
}

export function requestReadSession(socketPath, sessionId, request) {
  return new Promise((done, fail) => {
    const id = randomUUID();
    const socket = createConnection(socketPath);
    socket.setEncoding('utf8');
    let buffer = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? fail(new Error('Persistent read-only session unavailable or request rejected')) : done(value);
    };
    socket.setTimeout(50_000, () => finish(true));
    socket.once('error', () => finish(true));
    socket.once('close', () => finish(true));
    socket.once('connect', () => socket.write(JSON.stringify({ ...request, id, sessionId }) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (Buffer.byteLength(buffer) > 32 * 1024 * 1024) return finish(true);
      if (!buffer.includes('\n')) return;
      try {
        const response = JSON.parse(buffer.trim());
        if (response.id !== id || response.sessionId !== sessionId || response.error || !response.trace || !response.result) return finish(true);
        finish(false, response);
      } catch { finish(true); }
    });
  });
}

export async function runConsumer(argv) {
  const stateFlag = argv.shift();
  const agentFlag = argv.shift();
  if (!stateFlag?.startsWith('--state=') || !agentFlag?.startsWith('--agent=')) throw new Error('Usage: --state=<absolute> --agent=a|b tools | call <tool> <JSON>');
  const statePath = stateFlag.slice(8);
  const agent = agentFlag.slice(8);
  const operation = argv.shift();
  const tool = operation === 'call' ? argv.shift() : undefined;
  const input = operation === 'call' ? JSON.parse(argv.shift() ?? '{}') : {};
  if (argv.length || !validOperation({ operation, tool })) throw new Error('Only read-only knowledge tools are allowed');
  const state = await loadConsumerState(statePath, agent);
  const selected = state.agents[agent];
  const receipt = await requestReadSession(selected.socketPath, selected.sessionId, { operation, tool, input });
  process.stdout.write(`${JSON.stringify(receipt.result)}\n`);
  if (!receipt.trace.success) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runConsumer(process.argv.slice(2)).catch(() => {
    process.stderr.write('Read-only consumer failed. Verify the isolated harness state and invocation.\n');
    process.exitCode = 1;
  });
}
