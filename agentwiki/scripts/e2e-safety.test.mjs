import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import * as e2eSafety from './e2e-safety.mjs';

const { assertE2ETarget, cleanupFixture } = e2eSafety;

function resolveTestRedisTarget(...args) {
  assert.equal(
    typeof e2eSafety.resolveTestRedisTarget,
    'function',
    'database-backed integration gates need a shared TEST_REDIS_URL resolver',
  );
  return e2eSafety.resolveTestRedisTarget(...args);
}

test('database-backed gates require an explicit loopback TEST_REDIS_URL', () => {
  assert.equal(resolveTestRedisTarget(undefined, { enabled: false }), undefined);
  assert.throws(
    () => resolveTestRedisTarget(undefined, { enabled: true }),
    /TEST_REDIS_URL is required/u,
  );
  assert.throws(
    () => resolveTestRedisTarget('redis://cache.example.test:6380/0', { enabled: true }),
    /loopback/u,
  );
  assert.throws(
    () => resolveTestRedisTarget('http://127.0.0.1:6380/0', { enabled: true }),
    /redis:\/\/ or rediss:\/\//u,
  );
});

test('Redis availability probe derives its endpoint and authentication from the application URL', () => {
  const password = 'p@ss word';
  const target = resolveTestRedisTarget(
    'redis://e2e:p%40ss%20word@127.0.0.1:56379/2',
    { enabled: true, environment: { PATH: '/test/bin', REDISCLI_AUTH: 'stale-secret' } },
  );
  let invocation;

  assert.equal(
    typeof e2eSafety.probeTestRedis,
    'function',
    'database-backed integration gates need a shared Redis probe',
  );
  const result = e2eSafety.probeTestRedis(target, (command, args, options) => {
    invocation = { command, args, options };
    return { status: 0, stdout: 'PONG\n', stderr: '' };
  });

  assert.equal(result.status, 0);
  assert.equal(target.url, 'redis://e2e:p%40ss%20word@127.0.0.1:56379/2');
  assert.equal(invocation.command, 'redis-cli');
  assert.deepEqual(invocation.args, [
    '-h', '127.0.0.1', '-p', '56379', '--user', 'e2e', '-n', '2', 'ping',
  ]);
  assert.equal(invocation.options.env.PATH, '/test/bin');
  assert.equal(invocation.options.env.REDISCLI_AUTH, password);
  assert.equal(invocation.options.timeout, 5_000);
  assert.equal(invocation.args.join(' ').includes(password), false);
  assert.equal(invocation.args.join(' ').includes('p%40ss%20word'), false);
});

test('an explicitly configured Redis target fails closed when its probe fails', () => {
  const target = resolveTestRedisTarget('redis://127.0.0.1:56379/0', { enabled: true });

  assert.equal(
    typeof e2eSafety.assertTestRedisAvailable,
    'function',
    'configured Redis targets need a fail-closed availability assertion',
  );
  assert.throws(
    () => e2eSafety.assertTestRedisAvailable(
      target,
      () => ({ status: 1, stdout: '', stderr: 'connection refused' }),
    ),
    /TEST_REDIS_URL is unavailable/u,
  );
  assert.throws(
    () => e2eSafety.assertTestRedisAvailable(
      target,
      () => ({ status: 0, stdout: 'AUTH failed\nPONG\n', stderr: '' }),
    ),
    /TEST_REDIS_URL is unavailable/u,
  );
});

test('database-backed integration test entrypoints fail closed without TEST_REDIS_URL', () => {
  for (const [file, databaseVariable, testPattern] of [
    ['sync-v1-http-e2e.test.mjs', 'DATABASE_URL', '__bootstrap_gate_only__'],
    [
      'markdown-attachments-http-db.test.mjs',
      'MARKDOWN_TEST_DATABASE_URL',
      'real HTTP attachment lifecycle',
    ],
  ]) {
    const environment = {
      ...process.env,
      [databaseVariable]: 'postgresql://e2e:test@127.0.0.1:55432/agentwiki_test',
    };
    delete environment.TEST_REDIS_URL;
    delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [
        '--test',
        `--test-name-pattern=${testPattern}`,
        fileURLToPath(new URL(file, import.meta.url)),
      ],
      { encoding: 'utf8', env: environment, timeout: 20_000 },
    );
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    assert.notEqual(result.status, 0, `${file} unexpectedly accepted a missing TEST_REDIS_URL`);
    assert.match(output, /TEST_REDIS_URL is required/u, `${file} did not report the closed gate`);
  }
});

test('database-backed Redis integration entrypoints fail instead of skipping an unavailable target', () => {
  for (const [file, databaseVariable, testPattern] of [
    ['sync-v1-http-e2e.test.mjs', 'DATABASE_URL', '__bootstrap_gate_only__'],
    [
      'markdown-attachments-http-db.test.mjs',
      'MARKDOWN_TEST_DATABASE_URL',
      'real HTTP attachment lifecycle',
    ],
  ]) {
    const environment = {
      ...process.env,
      [databaseVariable]: 'postgresql://e2e:test@127.0.0.1:55432/agentwiki_test',
      TEST_REDIS_URL: 'redis://127.0.0.1:1/0',
    };
    delete environment.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [
        '--test',
        `--test-name-pattern=${testPattern}`,
        fileURLToPath(new URL(file, import.meta.url)),
      ],
      { encoding: 'utf8', env: environment, timeout: 20_000 },
    );
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

    assert.notEqual(result.status, 0, `${file} skipped an unavailable TEST_REDIS_URL`);
    assert.match(output, /TEST_REDIS_URL is unavailable/u, `${file} hid the failed Redis probe`);
  }
});

test('the PostgreSQL-only capacity harness does not require Redis at module startup', () => {
  const environment = {
    ...process.env,
    MARKDOWN_TEST_DATABASE_URL: 'postgresql://e2e:test@127.0.0.1:55432/agentwiki_test',
  };
  delete environment.TEST_REDIS_URL;
  delete environment.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-name-pattern=__capacity_bootstrap_only__',
      fileURLToPath(new URL('markdown-attachments-http-db.test.mjs', import.meta.url)),
    ],
    { encoding: 'utf8', env: environment, timeout: 20_000 },
  );

  assert.equal(result.status, 0, `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
});

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

test('Playwright local-sync cleanup does not hide failed fixture deletion', async () => {
  const source = await readFile(
    new URL('../apps/client/e2e/local-sync.spec.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /requestJson\([^\n]+\)\.catch\(\(\) => undefined\)/u);
  assert.match(source, /Cleanup failed for/u);
});

test('UI route smoke reports the number of mobile routes it actually checks', async () => {
  const source = await readFile(new URL('ui-route-smoke.mjs', import.meta.url), 'utf8');
  assert.match(source, /const mobileRoutes = \[/u);
  assert.match(source, /mobileRoutes: mobileRoutes\.length/u);
  assert.match(source, /expectedTreeRevision: contentTree\.treeRevision/u);
});

test('standalone browser acceptance uses the same installed Chrome channel as Playwright', async () => {
  for (const file of ['test-space-agent-member.mjs', 'ui-route-smoke.mjs']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /chromium\.launch\(\{ channel: 'chrome', headless: true \}\)/u, file);
  }
});

test('self-hosted collaboration acceptance binds its disposable API to loopback', async () => {
  for (const file of [
    'collaboration-workflows-e2e.mjs',
    'collaboration-real-agent-harness.mjs',
  ]) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /AGENTWIKI_LISTEN_HOST: '127\.0\.0\.1'/u, file);
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
