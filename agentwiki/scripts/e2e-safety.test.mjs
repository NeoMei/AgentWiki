import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertE2ETarget, cleanupFixture } from './e2e-safety.mjs';

test('requires explicit opt-in before any destructive E2E target is accepted', () => {
  assert.throws(
    () => assertE2ETarget('http://127.0.0.1:3000/api', {}, 'AGENTWIKI_E2E'),
    /AGENTWIKI_E2E=1/,
  );
});

test('allows loopback after the suite opt-in', () => {
  assert.equal(
    assertE2ETarget(
      'http://127.0.0.1:3000/api/',
      { AGENTWIKI_E2E: '1' },
      'AGENTWIKI_E2E',
    ),
    'http://127.0.0.1:3000/api',
  );
});

test('remote destructive tests require HTTPS, remote opt-in, and exact host confirmation', () => {
  const base = { AGENTWIKI_E2E: '1' };
  assert.throws(
    () => assertE2ETarget('https://agentwiki.quukk.com/api', base, 'AGENTWIKI_E2E'),
    /ALLOW_REMOTE/,
  );
  assert.throws(
    () => assertE2ETarget(
      'https://agentwiki.quukk.com/api',
      { ...base, AGENTWIKI_E2E_ALLOW_REMOTE: '1', AGENTWIKI_E2E_CONFIRM_HOST: 'example.com' },
      'AGENTWIKI_E2E',
    ),
    /confirmed host/,
  );
  assert.throws(
    () => assertE2ETarget(
      'http://agentwiki.quukk.com/api',
      { ...base, AGENTWIKI_E2E_ALLOW_REMOTE: '1', AGENTWIKI_E2E_CONFIRM_HOST: 'agentwiki.quukk.com' },
      'AGENTWIKI_E2E',
    ),
    /HTTPS/,
  );
});

test('cleanup attempts every resource and reports all failures', async () => {
  const calls = [];
  await assert.rejects(
    cleanupFixture(
      { agentId: 'agent-1', spaceId: 'space-1', userId: 'user-1' },
      async (kind, id) => {
        calls.push([kind, id]);
        if (kind !== 'space') throw new Error(`${kind} unavailable`);
      },
    ),
    /agent, user/,
  );
  assert.deepEqual(calls, [
    ['agent', 'agent-1'],
    ['space', 'space-1'],
    ['user', 'user-1'],
  ]);
});

test('destructive E2E harnesses share target validation and fixture cleanup', async () => {
  for (const file of [
    'smoke-test.mjs',
    'cross-machine-e2e.mjs',
    'test-space-agent-member.mjs',
    'ui-route-smoke.mjs',
  ]) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /assertE2ETarget/);
    assert.match(source, /cleanupFixture/);
    assert.doesNotMatch(source, /https:\/\/agentwiki\.quukk\.com/);
  }
});

test('active Agent E2E requests use roles without legacy permission inputs', async () => {
  for (const file of [
    'smoke-test.mjs',
    'cross-machine-e2e.mjs',
    'onboarding-e2e.mjs',
  ]) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b(?:permissionPreset|approvalMode)\s*:/u, `${file} must not send legacy permission fields`);
    assert.doesNotMatch(source, /\bbody\s*:\s*\{[^}]*\bscopes\s*:/su, `${file} must not send custom scopes`);
  }
});

test('active Agent E2E obtains credentials only through unified connection exchange', async () => {
  for (const file of ['smoke-test.mjs', 'cross-machine-e2e.mjs']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /local-sync-installations/u, `${file} must create a unified connection intent`);
    assert.match(source, /integrations\/local-sync\/exchange/u, `${file} must exchange the unified connection code`);
    assert.doesNotMatch(source, /\/agents\/\$\{[^}]+\}\/credentials/u, `${file} must not mint a manual Agent credential`);
  }
});

test('cross-machine E2E exercises the real sync engine and conflict gate', async () => {
  const source = await readFile(new URL('cross-machine-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /SyncEngine/);
  assert.match(source, /pushAndPublish\(\s*machineA/);
  assert.match(source, /pushAndPublish\(\s*machineB/);
  assert.match(source, /conflicts\.length/);
});
