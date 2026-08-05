import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  assertAssistResult,
  assertTargetUrl,
  cleanupResources,
  redact,
  requireOptIn,
} from './assist-routing-e2e.mjs';

const localEnv = { AGENTWIKI_ASSIST_E2E: '1' };
const remoteEnv = {
  AGENTWIKI_ASSIST_E2E: '1',
  AGENTWIKI_ASSIST_E2E_ALLOW_REMOTE: '1',
  AGENTWIKI_ASSIST_E2E_CONFIRM_HOST: 'agentwiki.quukk.com',
};
const execFileAsync = promisify(execFile);

const completedTask = {
  status: 'done',
  result: {
    changes: '# Clear draft',
    model: 'opencode/free-model',
    modelTier: 'free',
    attemptCount: 1,
    usage: {
      input: 10,
      output: 5,
      reasoning: 2,
      cacheRead: 1,
      cacheWrite: 0,
      total: 18,
    },
    cost: 0,
  },
};

test('requires the explicit destructive verifier opt-in', () => {
  assert.throws(() => requireOptIn({}), /AGENTWIKI_ASSIST_E2E=1/u);
  assert.throws(() => requireOptIn({ AGENTWIKI_ASSIST_E2E: 'true' }), /AGENTWIKI_ASSIST_E2E=1/u);
  assert.doesNotThrow(() => requireOptIn(localEnv));
});

test('exits promptly after a successful poll instead of retaining its deadline timer', async () => {
  const moduleUrl = new URL('./assist-routing-e2e.mjs', import.meta.url).href;
  await assert.doesNotReject(execFileAsync(process.execPath, [
    '--input-type=module',
    '--eval',
    `import { eventually } from ${JSON.stringify(moduleUrl)}; await eventually(async () => 1, (value) => value === 1, 'fast', 60_000);`,
  ], { timeout: 1_000 }));
});

test('allows loopback by default and a confirmed remote host with triple opt-in', () => {
  assert.equal(assertTargetUrl('http://127.0.0.1:3000/api', localEnv), 'http://127.0.0.1:3000/api');
  assert.equal(assertTargetUrl('http://localhost:3000/api/', localEnv), 'http://localhost:3000/api');
  assert.equal(assertTargetUrl('http://[::1]:3000/api', localEnv), 'http://[::1]:3000/api');
  assert.equal(assertTargetUrl('https://agentwiki.quukk.com/api', remoteEnv), 'https://agentwiki.quukk.com/api');
  assert.throws(() => assertTargetUrl('https://other.example/api', remoteEnv), /confirmed remote host/u);
});

test('rejects incomplete remote opt-in and unsafe target URLs', () => {
  assert.throws(() => assertTargetUrl('https://agentwiki.quukk.com/api', localEnv), /remote target/u);
  assert.throws(
    () => assertTargetUrl('https://agentwiki.quukk.com/api', { ...localEnv, AGENTWIKI_ASSIST_E2E_ALLOW_REMOTE: '1' }),
    /confirmed remote host/u,
  );
  assert.throws(() => assertTargetUrl('https://user:pass@agentwiki.quukk.com/api', remoteEnv), /credentials/u);
  assert.throws(() => assertTargetUrl('file:///tmp/agentwiki', localEnv), /HTTP\(S\)/u);
  assert.throws(() => assertTargetUrl('not a url', localEnv), /absolute HTTP\(S\) URL/u);
});

test('redacts bearer tokens, AgentWiki keys, environment secrets, and structured credentials', () => {
  const redacted = redact('Bearer abc agk_secret OPENAI_API_KEY=secret');
  assert.doesNotMatch(redacted, /abc|agk_secret|=secret/u);
  assert.equal(
    redact({ access_token: 'human-session-token', password: 'test-password', apiKey: 'provider-key' }),
    '{"access_token":"[REDACTED]","password":"[REDACTED]","apiKey":"[REDACTED]"}',
  );
  assert.doesNotMatch(
    redact('JWT_SECRET="jwt-value" DATABASE_URL=postgres://user:password@host/db REDIS_URL=redis://:redis-password@host'),
    /jwt-value|password@host|redis-password/u,
  );
});

test('attempts both cleanup operations and reports every deletion failure', async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push([url, init?.method]);
    return { ok: false, status: 500, text: async () => '' };
  };
  try {
    await assert.rejects(
      cleanupResources('http://127.0.0.1:3000/api', 'token', 'user-1', 'space-1', 'user@test.local', 'password'),
      /space, user/u,
    );
    assert.deepEqual(requests.map(([, method]) => method), ['DELETE', 'DELETE']);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('confirms the disposable space and user are unavailable after cleanup', async () => {
  const previousFetch = globalThis.fetch;
  const statuses = [200, 404, 200, 401];
  globalThis.fetch = async () => {
    const status = statuses.shift();
    return { ok: status >= 200 && status < 300, status, text: async () => '' };
  };
  try {
    await assert.doesNotReject(
      cleanupResources('http://127.0.0.1:3000/api', 'token', 'user-1', 'space-1', 'user@test.local', 'password'),
    );
    assert.equal(statuses.length, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('accepts a completed assist task with routing, usage, cost, and changes metadata', () => {
  assert.doesNotThrow(() => assertAssistResult(completedTask));
});

test('rejects a non-done or empty assist result contract', () => {
  assert.throws(() => assertAssistResult({ ...completedTask, status: 'failed' }), /status=done/u);
  assert.throws(
    () => assertAssistResult({ ...completedTask, result: { ...completedTask.result, changes: '  ' } }),
    /non-empty changes/u,
  );
  assert.throws(
    () => assertAssistResult({ ...completedTask, result: { ...completedTask.result, model: '' } }),
    /model ID/u,
  );
  assert.throws(
    () => assertAssistResult({ ...completedTask, result: { ...completedTask.result, modelTier: 'unknown' } }),
    /tier/u,
  );
});

test('rejects invalid attempt, token, and actual-cost metadata', () => {
  assert.throws(
    () => assertAssistResult({ ...completedTask, result: { ...completedTask.result, attemptCount: 1.5 } }),
    /integer attempt count/u,
  );
  assert.throws(
    () => assertAssistResult({
      ...completedTask,
      result: { ...completedTask.result, usage: { ...completedTask.result.usage, output: Number.NaN } },
    }),
    /finite token fields/u,
  );
  assert.throws(
    () => assertAssistResult({ ...completedTask, result: { ...completedTask.result, cost: -0.01 } }),
    /finite non-negative actual cost/u,
  );
});
