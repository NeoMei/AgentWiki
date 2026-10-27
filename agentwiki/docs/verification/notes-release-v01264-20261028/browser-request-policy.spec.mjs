import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixtureRequester, retryAfterMilliseconds } from './browser-request-policy.mjs';
const minute = 60_000;
function harness(statuses, headers = {}) {
  let time = 2 * minute;
  const waits = [], calls = [], retries = [];
  const request = createFixtureRequester({ now: () => time, waitImpl: async delay => { waits.push(delay); time += delay; },
    fetchImpl: async (url, options) => { calls.push({ url, method: options.method }); return new Response('{}', { status: statuses.shift() ?? 200, headers }); },
    onRetry: detail => retries.push(detail) });
  return { request, waits, calls, retries };
}
test('GET retries twice at most, preserving the terminal response', async () => {
  const state = harness([429, 429, 429, 200], { 'retry-after': '0' });
  assert.equal((await state.request('http://fixture.test/api/users/me', { method: 'GET' })).status, 429);
  assert.equal(state.calls.length, 3); assert.equal(state.retries.length, 2);
});
test('HEAD may recover once while writes never repeat on 429', async () => {
  const head = harness([429, 200], { 'retry-after': '1' });
  assert.equal((await head.request('http://fixture.test', { method: 'HEAD' })).status, 200);
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    const state = harness([429, 200]);
    assert.equal((await state.request('http://fixture.test', { method })).status, 429);
    assert.equal(state.calls.length, 1); assert.deepEqual(state.retries, []);
  }
});
test('Retry-After accepts seconds/date, caps at 61 seconds, and uses next bucket when absent', () => {
  assert.equal(retryAfterMilliseconds('2', 0), 2_000);
  assert.equal(retryAfterMilliseconds('120', 0), 61_000);
  assert.equal(retryAfterMilliseconds('Thu, 01 Jan 1970 00:00:05 GMT', 0), 5_000);
  assert.equal(retryAfterMilliseconds(undefined, 2 * minute), 61_000);
  assert.equal(retryAfterMilliseconds(null, 2 * minute + 5_000), 56_000);
  assert.equal(retryAfterMilliseconds('invalid', 2 * minute + 59_000), 2_000);
});
test('Every individual wait is at most 60 seconds, including 61-second bucket fallback', async () => {
  const state = harness([429, 200]);
  assert.equal((await state.request('http://fixture.test', { method: 'GET' })).status, 200);
  assert.deepEqual(state.waits, [60_000, 1_000]);
  assert.equal(state.retries[0].delayMs, 61_000);
});
test('Explicit requests are spaced by 200ms without real sleeps', async () => {
  const state = harness([200, 200, 200]);
  await state.request('http://fixture.test', { method: 'GET' });
  await state.request('http://fixture.test', { method: 'DELETE' });
  await state.request('http://fixture.test', { method: 'GET' });
  assert.deepEqual(state.waits, [200, 200]);
});
test('Network failure never triggers automatic mutation retry', async () => {
  let calls = 0;
  const request = createFixtureRequester({ fetchImpl: async () => { calls++; throw new Error('uncertain transport outcome'); } });
  await assert.rejects(request('http://fixture.test', { method: 'DELETE' }), /uncertain transport outcome/);
  assert.equal(calls, 1);
});

test('Each fetch attempt receives a fresh timeout, separate from the retry wait', async () => {
  const signals = []; let calls = 0;
  const request = createFixtureRequester({ waitImpl: async () => {}, fetchImpl: async (url, options) => {
    assert.equal('timeoutMs' in options, false); signals.push(options.signal);
    return new Response('{}', { status: ++calls === 1 ? 429 : 200, headers: { 'retry-after': '61' } });
  } });
  assert.equal((await request('http://fixture.test', { method: 'GET', timeoutMs: 25_000 })).status, 200);
  assert.notEqual(signals[0], signals[1]);
});
