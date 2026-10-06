// Consumer facade: no corpus, rubric, seeding or answer-generation imports.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { appendFile, lstat, readFile, realpath } from 'node:fs/promises';
import { watchFile, unwatchFile } from 'node:fs';
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
  if (state.version !== 1 || !state.agents?.[agent] || !Number.isInteger(state.harnessPid)) throw new Error('Invalid retrieval state');
  const url = new URL(state.apiUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || !url.port) throw new Error('State must target an isolated loopback API');
  process.kill(state.harnessPid, 0);
  const root = await realpath(state.resourceRoot);
  const selected = state.agents[agent];
  for (const path of [selected.home, selected.wrapperPath]) {
    if (!isAbsolute(path) || !(await realpath(path)).startsWith(root + sep)) throw new Error('Consumer path escapes owned workspace');
  }
  return state;
}

function redact(value, secrets) {
  let text = JSON.stringify(value);
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 8) text = text.split(secret).join('[REDACTED]');
  return JSON.parse(text);
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
  if (argv.length || (operation !== 'tools' && (operation !== 'call' || !isAllowedReadTool(tool)))) throw new Error('Only read-only knowledge tools are allowed');
  const state = await loadConsumerState(statePath, agent);
  const selected = state.agents[agent];
  const client = new Client({ name: `knowledge-retrieval-${agent}`, version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [selected.wrapperPath], cwd: selected.home, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stderr: 'pipe' });
  // Do not forward gateway stderr: it may contain runtime configuration.
  transport.stderr?.on('data', () => {});
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await client.close(); await transport.close(); } };
  const stop = () => { void close(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  watchFile(statePath, { interval: 250, persistent: false }, current => { if (current.nlink === 0) stop(); });
  try {
    const gatewayStarted = performance.now();
    // executeReadOperation records the disconnected transport as a failed attempt.
    try { await client.connect(transport); } catch { /* Never lose or echo a failed handshake. */ }
    const receipt = await executeReadOperation(client, { operation, tool, input });
    receipt.trace.gatewayDurationMs = Math.round(performance.now() - gatewayStarted);
    const secrets = Object.values(state.agents).map(value => value.apiKey);
    const sanitized = redact(receipt, secrets);
    // Responses are retained for operator grading, and never fed back as hints.
    await appendFile(join(selected.home, 'trace.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), agent, ...sanitized.trace, result: sanitized.result })}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(sanitized.result)}\n`);
    if (!receipt.trace.success) process.exitCode = 1;
  } finally {
    unwatchFile(statePath);
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    await close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runConsumer(process.argv.slice(2)).catch(() => {
    process.stderr.write('Read-only consumer failed. Verify the isolated harness state and invocation.\n');
    process.exitCode = 1;
  });
}
