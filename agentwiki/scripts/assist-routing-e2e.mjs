import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const AGENT_CREDENTIAL_PATTERN = /\b(?:agk|awk)_[A-Za-z0-9._~-]+\b/giu;
const BEARER_PATTERN = /\bBearer\s+[^\s,;"']+/giu;
const ENV_SECRET_PATTERN = /\b((?:[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)|DATABASE_URL|REDIS_URL))\s*=\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const SENSITIVE_JSON_PATTERN = /"(?:access_token|refresh_token|authorization|apiKey|password|token|secret)"\s*:\s*"[^"]*"/giu;
const URL_CREDENTIAL_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/giu;
const PROVIDER_KEY_PATTERN = /\b(?:sk|rk|pk|opk)[-_][A-Za-z0-9_-]{8,}\b/giu;
const TOKEN_FIELDS = ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'total'];

export function requireOptIn(environment = process.env) {
  if (environment.AGENTWIKI_ASSIST_E2E !== '1') {
    throw new Error('This destructive verifier requires AGENTWIKI_ASSIST_E2E=1');
  }
}

export function assertTargetUrl(value, environment = process.env) {
  requireOptIn(environment);

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('AgentWiki target must be an absolute HTTP(S) URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('AgentWiki target must be an absolute HTTP(S) URL');
  }
  if (url.username || url.password) {
    throw new Error('AgentWiki target URL must not contain credentials');
  }

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (!loopbackHosts.has(url.hostname)) {
    if (environment.AGENTWIKI_ASSIST_E2E_ALLOW_REMOTE !== '1') {
      throw new Error('A remote target requires AGENTWIKI_ASSIST_E2E_ALLOW_REMOTE=1');
    }
    const confirmedHost = environment.AGENTWIKI_ASSIST_E2E_CONFIRM_HOST?.trim().toLowerCase();
    if (!confirmedHost || confirmedHost !== url.hostname.toLowerCase()) {
      throw new Error('The target must match the confirmed remote host');
    }
    if (url.protocol !== 'https:') {
      throw new Error('A remote target must use HTTPS');
    }
  }

  return url.toString().replace(/\/$/u, '');
}

export function redact(value) {
  let text;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }

  return text
    .replace(SENSITIVE_JSON_PATTERN, (match) => `${match.slice(0, match.indexOf(':') + 1)}"[REDACTED]"`)
    .replace(ENV_SECRET_PATTERN, '$1=[REDACTED]')
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(AGENT_CREDENTIAL_PATTERN, '[REDACTED]')
    .replace(PROVIDER_KEY_PATTERN, '[REDACTED]')
    .replace(URL_CREDENTIAL_PATTERN, '$1[REDACTED]@');
}

function output(value) {
  process.stdout.write(`${redact(value)}\n`);
}

function fail(message) {
  throw new Error(redact(message));
}

export async function apiRequest(apiUrl, path, { method = 'GET', token, body } = {}) {
  let response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    fail(`AgentWiki API ${method} ${path} request failed`);
  }

  const responseText = await response.text();
  let result;
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      fail(`AgentWiki API ${method} ${path} returned invalid JSON`);
    }
  }
  if (!response.ok) {
    fail(`AgentWiki API ${method} ${path} failed with status ${response.status}`);
  }
  return result;
}

export async function eventually(read, predicate, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  const timedOut = Symbol('timed-out');

  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    let timer;
    let value;
    try {
      value = await Promise.race([
        read(),
        new Promise((done) => { timer = setTimeout(() => done(timedOut), remainingMs); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (value === timedOut) break;
    if (predicate(value)) return value;

    const delayMs = Math.min(500, deadline - Date.now());
    if (delayMs > 0) await new Promise((done) => setTimeout(done, delayMs));
  }

  fail(`Timed out waiting for ${label}`);
}

async function assertStatus(apiUrl, path, expectedStatus, { method = 'GET', token, body } = {}) {
  let response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    fail(`Cleanup verification ${method} ${path} request failed`);
  }
  await response.text();
  if (response.status !== expectedStatus) {
    fail(`Cleanup verification ${method} ${path} returned status ${response.status}`);
  }
}

export async function cleanupResources(apiUrl, token, userId, spaceId, email, password) {
  const failures = [];
  if (spaceId) {
    try {
      await apiRequest(apiUrl, `/spaces/${spaceId}`, { method: 'DELETE', token });
      await assertStatus(apiUrl, `/spaces/${spaceId}`, 404, { token });
    } catch {
      failures.push('space');
    }
  }
  if (userId) {
    try {
      await apiRequest(apiUrl, `/users/${userId}`, { method: 'DELETE', token });
      await assertStatus(apiUrl, '/auth/login', 401, {
        method: 'POST',
        body: { email, password },
      });
    } catch {
      failures.push('user');
    }
  }
  if (failures.length) fail(`Cleanup failed for ${failures.join(', ')}`);
}

export function assertAssistResult(task) {
  assert.equal(task?.status, 'done', 'assist task must reach status=done');
  assert.ok(typeof task?.result?.changes === 'string' && task.result.changes.trim(), 'assist result must contain non-empty changes');
  assert.ok(typeof task?.result?.model === 'string' && task.result.model.trim(), 'assist result must contain a model ID');
  assert.ok(['free', 'paid'].includes(task?.result?.modelTier), 'assist result must contain a free or paid tier');
  assert.ok(
    Number.isInteger(task?.result?.attemptCount) && task.result.attemptCount >= 1,
    'assist result must contain a positive integer attempt count',
  );
  assert.ok(
    task?.result?.usage
      && TOKEN_FIELDS.every((field) => Number.isFinite(task.result.usage[field]) && task.result.usage[field] >= 0),
    'assist result must contain finite token fields',
  );
  assert.ok(
    Number.isFinite(task?.result?.cost) && task.result.cost >= 0,
    'assist result must contain a finite non-negative actual cost',
  );
}

export async function main(environment = process.env) {
  requireOptIn(environment);
  const apiUrl = assertTargetUrl(environment.AGENTWIKI_API_URL || 'http://127.0.0.1:3000/api', environment);
  const suffix = `${Date.now()}-${process.pid}`;
  const email = `assist-e2e-${suffix}@test.local`;
  const password = `Assist-${suffix}!`;
  let token;
  let userId;
  let spaceId;

  try {
    const auth = await apiRequest(apiUrl, '/auth/register', {
      method: 'POST',
      body: {
        email,
        name: 'Assist E2E',
        password,
      },
    });
    token = auth.access_token;
    userId = auth.user.id;

    const space = await apiRequest(apiUrl, '/spaces', {
      method: 'POST',
      token,
      body: { name: `Assist E2E ${suffix}` },
    });
    spaceId = space.id;

    const page = await apiRequest(apiUrl, '/pages', {
      method: 'POST',
      token,
      body: {
        spaceId,
        title: 'Routing test',
        content: '# Draft\n\nMake this clearer.',
      },
    });
    const task = await apiRequest(apiUrl, '/assist/tasks', {
      method: 'POST',
      token,
      body: {
        spaceId,
        pageId: page.id,
        intent: 'Rewrite this as concise Markdown.',
        snapshot: page,
      },
    });
    const completed = await eventually(
      () => apiRequest(apiUrl, `/assist/tasks/${task.id}`, { token }),
      (value) => value?.status === 'done' || value?.status === 'failed',
      'assist routing task',
      210_000,
    );
    assertAssistResult(completed);
    const summary = {
      status: completed.status,
      model: completed.result.model,
      tier: completed.result.modelTier,
      attempts: completed.result.attemptCount,
      usage: completed.result.usage,
      cost: completed.result.cost,
    };
    output(summary);
    return summary;
  } finally {
    if (token) await cleanupResources(apiUrl, token, userId, spaceId, email, password);
  }
}

async function run() {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${redact(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void run();
