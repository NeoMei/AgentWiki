import assert from 'node:assert/strict';
import test from 'node:test';

import { assertLoopbackUrl, redact, requireOptIn } from './local-sync-e2e.mjs';

test('rejects non-loopback AgentWiki targets', () => {
  assert.throws(() => assertLoopbackUrl('https://agentwiki.example/api'), /loopback/i);
  assert.throws(() => assertLoopbackUrl('http://0.0.0.0:3000/api'), /loopback/i);
  assert.equal(assertLoopbackUrl('http://127.0.0.1:3000/api'), 'http://127.0.0.1:3000/api');
  assert.equal(assertLoopbackUrl('http://localhost:3000/api'), 'http://localhost:3000/api');
  assert.equal(assertLoopbackUrl('http://[::1]:3000/api'), 'http://[::1]:3000/api');
});

test('requires explicit destructive-test opt-in', () => {
  assert.throws(() => requireOptIn({}), /AGENTWIKI_LOCAL_SYNC_E2E=1/);
  assert.throws(() => requireOptIn({ AGENTWIKI_LOCAL_SYNC_E2E: 'true' }), /AGENTWIKI_LOCAL_SYNC_E2E=1/);
  assert.doesNotThrow(() => requireOptIn({ AGENTWIKI_LOCAL_SYNC_E2E: '1' }));
});

test('redacts agent credentials from output', () => {
  assert.equal(redact('failed agk_secret-value and awk_another_secret'), 'failed [REDACTED] and [REDACTED]');
  assert.equal(redact({ authorization: 'Bearer agk_secret-value', nested: ['awk_other-secret'] }), '{"authorization":"Bearer [REDACTED]","nested":["[REDACTED]"]}');
  assert.equal(redact('request used Bearer human-session-token'), 'request used Bearer [REDACTED]');
  assert.equal(redact({ access_token: 'human-session-token', password: 'test-password' }), '{"access_token":"[REDACTED]","password":"[REDACTED]"}');
});
