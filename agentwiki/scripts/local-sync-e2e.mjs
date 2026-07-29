import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const AGENT_CREDENTIAL_PATTERN = /\b(?:agk|awk)_[A-Za-z0-9_-]+\b/gu;
const execFile = promisify(execFileCallback);
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_PATH = join(REPOSITORY_ROOT, 'packages', 'local-sync', 'dist', 'cli.js');
const LOCAL_SYNC_SCOPES = ['spaces:read', 'pages:read', 'sources:read', 'sources:write', 'runs:read', 'runs:write', 'review:read'];

export function requireOptIn(environment = process.env) {
  if (environment.AGENTWIKI_LOCAL_SYNC_E2E !== '1') {
    throw new Error('This destructive verifier requires AGENTWIKI_LOCAL_SYNC_E2E=1');
  }
}

export function assertLoopbackUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('AgentWiki URL must be an absolute loopback HTTP(S) URL');
  }

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (!['http:', 'https:'].includes(url.protocol) || !loopbackHosts.has(url.hostname) || url.username || url.password) {
    throw new Error('AgentWiki URL must target loopback');
  }
  return url.toString().replace(/\/$/u, '');
}

export function redact(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text
    .replace(/"(?:access_token|apiKey|password)"\s*:\s*"[^"]*"/giu, (match) => `${match.slice(0, match.indexOf(':') + 1)}"[REDACTED]"`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(AGENT_CREDENTIAL_PATTERN, '[REDACTED]');
}

function output(value) {
  process.stdout.write(`${redact(value)}\n`);
}

function fail(message) {
  throw new Error(redact(message));
}

async function apiRequest(apiUrl, path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let result;
  try {
    result = text ? JSON.parse(text) : undefined;
  } catch {
    result = text;
  }
  if (!response.ok) fail(`AgentWiki API ${method} ${path} failed with ${response.status}: ${typeof result === 'string' ? result : JSON.stringify(result)}`);
  return result;
}

async function eventually(read, predicate, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await new Promise((done) => setTimeout(done, 500));
  } while (Date.now() < deadline);
  fail(`Timed out waiting for ${label}`);
}

async function writeExecutable(path, contents) {
  await writeFile(path, contents, { encoding: 'utf8', mode: 0o700 });
  await chmod(path, 0o700);
}

async function createFakeTools(home, bin) {
  await mkdir(bin, { recursive: true, mode: 0o700 });
  await mkdir(home, { recursive: true, mode: 0o700 });
  await writeExecutable(join(bin, 'openwiki'), `#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
if (process.argv.includes('--version')) { process.stdout.write('openwiki 0.2.0\\n'); process.exit(0); }
await mkdir('openwiki', { recursive: true });
await writeFile('openwiki/architecture.md', '# Architecture\\n[Guide](guide.md)\\n');
await writeFile('openwiki/guide.md', '# Guide\\nDeterministic local sync verification.\\n');
`);
  await writeExecutable(join(bin, 'markitdown'), "#!/usr/bin/env node\nprocess.stdout.write('markitdown 0.1.0\\n');\n");
  await writeExecutable(join(bin, 'codebase-memory-mcp'), "#!/usr/bin/env node\nprocess.stdout.write('codebase-memory-mcp 1.0.0\\n');\n");
  await writeExecutable(join(bin, 'codex'), `#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args[0] !== 'mcp') process.exit(1);
if (args[1] === 'add') {
  const directory = join(process.env.HOME, '.codex');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'mcp.json'), JSON.stringify({ name: args[2], command: args.slice(4) }));
}
if (args[1] === 'get' || args[1] === 'add' || args[1] === 'remove') process.exit(0);
process.exit(1);
`);
  await writeFile(join(home, '.openwiki-env-note'), 'The verifier uses a local deterministic OpenWiki stub.\n', { mode: 0o600 });
}

async function runLocalSyncCli(home, environment, args) {
  try {
    const { stdout, stderr } = await execFile(process.execPath, [CLI_PATH, ...args], {
      cwd: REPOSITORY_ROOT,
      env: environment,
      maxBuffer: 1024 * 1024,
    });
    if (stderr) output({ cliStderr: redact(stderr) });
    return stdout.trim() ? JSON.parse(stdout) : undefined;
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error ? error.stdout : '';
    const stderr = error && typeof error === 'object' && 'stderr' in error ? error.stderr : '';
    fail(`local-sync CLI failed: ${String(stderr || stdout || error)}`);
  }
}

function assertPrivateMode(details, label) {
  assert.equal(details.mode & 0o077, 0, `${label} must be owner-only`);
}

/**
 * Runs the destructive local-sync verification against an explicitly selected local stack.
 * Every output path is passed through redact(), and all temporary state is removed in finally.
 */
export async function runVerifier(environment = process.env) {
  requireOptIn(environment);
  const apiUrl = assertLoopbackUrl(environment.AGENTWIKI_API_URL ?? 'http://127.0.0.1:3000/api');
  await stat(CLI_PATH).catch(() => fail(`Built local-sync CLI is required at ${CLI_PATH}; run pnpm --filter @neomei/agentwiki-local-sync build first`));

  const root = await mkdtemp(join(tmpdir(), 'agentwiki-local-sync-e2e-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const source = join(root, 'source');
  const childEnvironment = {
    ...environment,
    HOME: home,
    PATH: `${bin}:${environment.PATH ?? process.env.PATH ?? ''}`,
    OPENWIKI_PROVIDER: 'ollama',
    OLLAMA_HOST: 'http://127.0.0.1:11434',
  };
  const fixture = { token: '', userId: '', spaceId: '', agentId: '', installationId: '', credentialId: '' };

  try {
    await mkdir(source, { recursive: true, mode: 0o700 });
    await Promise.all([
      createFakeTools(home, bin),
      writeFile(join(source, 'index.js'), "import { guide } from './guide.js';\nexport const localSync = guide;\n", { encoding: 'utf8', mode: 0o600 }),
      writeFile(join(source, 'guide.js'), 'export const guide = true;\n', { encoding: 'utf8', mode: 0o600 }),
    ]);

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await apiRequest(apiUrl, '/auth/register', {
      method: 'POST', body: { email: `local-sync-e2e-${suffix}@example.test`, password: 'LocalSyncE2E-password', name: `Local sync E2E ${suffix}` },
    });
    fixture.token = user.access_token;
    fixture.userId = user.user.id;
    const space = await apiRequest(apiUrl, '/spaces', {
      method: 'POST', token: fixture.token, body: { name: `Local sync E2E ${suffix}`, visibility: 'private', approvalPolicy: 'always-review' },
    });
    fixture.spaceId = space.id;
    const agent = await apiRequest(apiUrl, '/agents', {
      method: 'POST', token: fixture.token, body: { name: `Local sync E2E ${suffix}`, approvalMode: 'always-review' },
    });
    fixture.agentId = agent.id;
    await apiRequest(apiUrl, `/agents/${fixture.agentId}/grants/${fixture.spaceId}`, {
      method: 'PUT', token: fixture.token, body: { role: 'editor', scopes: LOCAL_SYNC_SCOPES },
    });
    const installation = await apiRequest(apiUrl, `/agents/${fixture.agentId}/local-sync-installations`, {
      method: 'POST', token: fixture.token, body: { pluginVersion: '0.1.0', scopes: LOCAL_SYNC_SCOPES },
    });
    fixture.installationId = installation.installationId;

    await runLocalSyncCli(home, childEnvironment, ['connect', '--server', apiUrl, '--code', installation.code, '--agent', 'codex']);
    const config = JSON.parse(await readFile(join(home, '.agentwiki', 'local-sync.json'), 'utf8'));
    const connection = config.connections[config.defaultConnectionId];
    fixture.credentialId = connection.credentialId;
    assert.equal(connection.serverUrl, apiUrl);
    assert.match(await readFile(join(home, '.agents', 'skills', 'agentwiki-local-sync', 'SKILL.md'), 'utf8'), /local sync/i);
    await readFile(join(home, '.codex', 'mcp.json'), 'utf8');
    assertPrivateMode(await stat(join(home, '.agentwiki', 'local-sync.json')), 'local sync config');
    assertPrivateMode(await stat(join(home, '.agentwiki', 'credentials.json')), 'local sync credentials');
    const doctor = await runLocalSyncCli(home, childEnvironment, ['doctor']);
    assert.ok(Array.isArray(doctor.checks), 'doctor must return checks');
    assert.equal(doctor.checks.find((check) => check.name === 'identity')?.status, 'pass');

    const preview = await runLocalSyncCli(home, childEnvironment, ['scan', '--path', source, '--space', fixture.spaceId]);
    assert.equal(preview.added, 2, 'the first preview must describe two pages before upload');
    const firstSync = await runLocalSyncCli(home, childEnvironment, ['sync', '--preview', preview.previewId, '--confirm']);
    assert.equal(firstSync.status, 'queued');
    const run = await eventually(
      () => apiRequest(apiUrl, `/runs/${firstSync.runId}`, { token: fixture.token }),
      (candidate) => candidate.status === 'completed' && candidate.changeSet?.status === 'pending_review',
      'a completed pending-review run',
    );
    assert.ok(run.changeSet?.items?.length >= 3, 'the run must produce page and relation review items');
    for (const item of run.changeSet.items) {
      await apiRequest(apiUrl, `/change-sets/${run.changeSet.id}/items/${item.id}`, {
        method: 'PATCH', token: fixture.token, body: { status: 'accepted' },
      });
    }
    await apiRequest(apiUrl, `/change-sets/${run.changeSet.id}/approve`, { method: 'POST', token: fixture.token, body: { comment: 'local sync E2E' } });
    await apiRequest(apiUrl, `/change-sets/${run.changeSet.id}/publish`, { method: 'POST', token: fixture.token });
    const pages = await apiRequest(apiUrl, `/pages?spaceId=${encodeURIComponent(fixture.spaceId)}`, { token: fixture.token });
    const publishedPages = pages.data ?? pages;
    assert.equal(publishedPages.length, 2, 'the review must publish both pages');
    const relations = await apiRequest(apiUrl, `/knowledge/relations/${publishedPages[0].id}`, { token: fixture.token });
    assert.ok(relations.length > 0, 'the review must publish the generated relation');
    assert.ok(run.evidences.length > 0, 'the run must retain source evidence');

    const noopPreview = await runLocalSyncCli(home, childEnvironment, ['scan', '--path', source, '--space', fixture.spaceId]);
    assert.equal(noopPreview.unchanged, 2, 'the second preview must show no changes');
    const noop = await runLocalSyncCli(home, childEnvironment, ['sync', '--preview', noopPreview.previewId, '--confirm']);
    assert.equal(noop.status, 'noop');

    const credentials = JSON.parse(await readFile(join(home, '.agentwiki', 'credentials.json'), 'utf8'));
    const apiKey = credentials.credentials[fixture.credentialId].apiKey;
    await apiRequest(apiUrl, `/agents/${fixture.agentId}/credentials/${fixture.credentialId}`, { method: 'DELETE', token: fixture.token });
    const revoked = await fetch(`${apiUrl}/integrations/mcp`, { headers: { Authorization: `Bearer ${apiKey}` } });
    assert.equal(revoked.status, 401, 'revoked agent credential must be rejected');

    return { status: 'passed', pages: publishedPages.length, relationCount: relations.length };
  } finally {
    if (fixture.installationId && fixture.agentId && fixture.token) {
      await apiRequest(apiUrl, `/agents/${fixture.agentId}/local-sync-installations/${fixture.installationId}`, { method: 'DELETE', token: fixture.token }).catch(() => undefined);
    }
    if (fixture.agentId && fixture.token) await apiRequest(apiUrl, `/agents/${fixture.agentId}`, { method: 'DELETE', token: fixture.token }).catch(() => undefined);
    if (fixture.spaceId && fixture.token) await apiRequest(apiUrl, `/spaces/${fixture.spaceId}`, { method: 'DELETE', token: fixture.token }).catch(() => undefined);
    if (fixture.userId && fixture.token) await apiRequest(apiUrl, `/users/${fixture.userId}`, { method: 'DELETE', token: fixture.token }).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  try {
    output(await runVerifier());
  } catch (error) {
    process.stderr.write(`${redact(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main();
