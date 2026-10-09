import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const harness = fileURLToPath(new URL('./runtime-test-harness.mjs', import.meta.url));
const fullTestEnvironmentNames = [
  'DATABASE_URL',
  'FOLDER_TEST_DATABASE_URL',
  'MARKDOWN_TEST_DATABASE_URL',
  'COLLABORATION_TEST_DATABASE_URL',
  'PAGE_TEMPLATE_TEST_DATABASE_URL',
  'SYNC_V3_TEST_DATABASE_URL',
  'SYNC_VERSION_TEST_DATABASE_URL',
  'SOURCE_FRESHNESS_TEST_DATABASE_URL',
  'TEST_REDIS_URL',
];

function environmentWithoutFullTestGate() {
  const environment = { ...process.env };
  delete environment.AGENTWIKI_FULL_TEST;
  delete environment.NODE_TEST_CONTEXT;
  for (const name of fullTestEnvironmentNames) delete environment[name];
  return environment;
}

function completeFullTestEnvironment() {
  return {
    ...environmentWithoutFullTestGate(),
    AGENTWIKI_FULL_TEST: '1',
    DATABASE_URL: 'postgresql://tester:HARNESS_SECRET_DATABASE@127.0.0.1/agentwiki_test',
    FOLDER_TEST_DATABASE_URL: 'postgresql://tester:HARNESS_SECRET_FOLDER@127.0.0.1/agentwiki_test',
    MARKDOWN_TEST_DATABASE_URL: 'postgresql://tester:HARNESS_SECRET_MARKDOWN@127.0.0.1/agentwiki_test',
    COLLABORATION_TEST_DATABASE_URL: 'postgresql://tester:HARNESS_SECRET_COLLABORATION@127.0.0.1/agentwiki_test',
    PAGE_TEMPLATE_TEST_DATABASE_URL: 'postgresql://tester:HARNESS_SECRET_TEMPLATE@127.0.0.1/agentwiki_test',
    SYNC_V3_TEST_DATABASE_URL: 'postgresql://tester:HARNESS_SECRET_SYNC_V3@127.0.0.1/agentwiki_test',
    SYNC_VERSION_TEST_DATABASE_URL: 'postgresql://tester:HARNESS_SECRET_SYNC_VERSION@127.0.0.1/agentwiki_test',
    SOURCE_FRESHNESS_TEST_DATABASE_URL: 'postgresql://tester:HARNESS_SECRET_SOURCE_FRESHNESS@127.0.0.1/agentwiki_test',
    TEST_REDIS_URL: 'redis://:HARNESS_SECRET_REDIS@127.0.0.1:6379/1',
    AGENTWIKI_PSQL_BIN: process.execPath,
  };
}

test('runtime plan assigns every test exactly once and serializes only database suites', () => {
  const result = spawnSync(process.execPath, [harness, 'plan'], {
    encoding: 'utf8',
    env: environmentWithoutFullTestGate(),
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  const inventory = readdirSync(scriptsDirectory)
    .filter((name) => name.endsWith('.test.mjs'))
    .sort();
  const assigned = [...plan.parallelTests, ...plan.databaseTests];

  assert.deepEqual([...assigned].sort(), inventory);
  assert.equal(new Set(assigned).size, inventory.length);
  assert.ok(plan.databaseTests.every((name) => name.endsWith('-db.test.mjs') || [
    'collaboration-real-agent-harness.test.mjs',
    'sync-v1-http-e2e.test.mjs',
  ].includes(name)));
  assert.ok(inventory.filter((name) => name.endsWith('-db.test.mjs'))
    .every((name) => plan.databaseTests.includes(name)));
  assert.ok(plan.databaseTests.includes('composite-template-effects-policy-db.test.mjs'));
  for (const requiredGate of [
    'composite-template-schema-db.test.mjs',
    'composite-template-catalog-db.test.mjs',
    'composite-template-instantiation-db.test.mjs',
    'page-agent-binding-db.test.mjs',
    'composite-template-snapshot-db.test.mjs',
    'collaboration-page-publication-db.test.mjs',
    'collaboration-page-conflict-db.test.mjs',
    'composite-template-effects-policy-db.test.mjs',
    'composite-template-e2e-db.test.mjs',
  ]) {
    assert.ok(plan.databaseTests.includes(requiredGate), `missing required DB gate: ${requiredGate}`);
  }
  assert.ok(plan.parallelTests.length >= 19, 'non-database runtime suites must remain parallel');
  assert.equal(plan.parallelArgs[0], '--test');
  assert.equal(plan.parallelArgs.includes('--test-concurrency=1'), false);
  assert.equal(plan.databaseArgs.includes('--test-concurrency=1'), true);
  assert.equal(plan.databaseArgs.includes('--test-reporter=tap'), true);
});

test('runtime plan remains available without database services for the ordinary development gate', () => {
  const result = spawnSync(process.execPath, [harness, 'plan'], {
    encoding: 'utf8',
    env: environmentWithoutFullTestGate(),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).databaseTests.length > 0);
});

for (const command of ['plan', 'run']) {
  for (const missingName of fullTestEnvironmentNames) {
    test(`runtime ${command} full gate fails closed without ${missingName} and redacts configured URLs`, () => {
      const environment = completeFullTestEnvironment();
      delete environment[missingName];
      // Never launch actual suites if prerequisite validation regresses.
      environment.AGENTWIKI_PSQL_BIN = '/nonexistent-agentwiki-harness-psql';

      const result = spawnSync(process.execPath, [harness, command], {
        encoding: 'utf8',
        env: environment,
      });
      const output = `${result.stdout}${result.stderr}`;

      assert.notEqual(result.status, 0);
      assert.match(output, new RegExp(`${missingName} is required`, 'u'));
      assert.doesNotMatch(output, /HARNESS_SECRET_/u);
    });
  }
}

test('runtime plan full gate succeeds when every database and Redis prerequisite is configured', () => {
  const result = spawnSync(process.execPath, [harness, 'plan'], {
    encoding: 'utf8',
    env: completeFullTestEnvironment(),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(JSON.parse(result.stdout).databaseTests.length > 0);
});

test('runtime full gate fails closed before database tests when psql is unavailable', () => {
  const environment = completeFullTestEnvironment();
  delete environment.AGENTWIKI_PSQL_BIN;
  environment.PATH = '';

  const result = spawnSync(process.execPath, [harness, 'plan'], {
    encoding: 'utf8',
    env: environment,
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /psql.*required|psql.*unavailable/iu);
});

test('full database phase rejects skipped tests without counting known non-database skips', async () => {
  const resultSafety = await import('./runtime-test-result-safety.mjs');
  assert.doesNotThrow(() => resultSafety.assertZeroSkippedDatabaseTests([
    'TAP version 13',
    '1..139',
    '# tests 139',
    '# pass 139',
    '# fail 0',
    '# skipped 0',
  ].join('\n')));
  assert.throws(
    () => resultSafety.assertZeroSkippedDatabaseTests([
      'TAP version 13',
      '1..139',
      '# tests 139',
      '# pass 111',
      '# fail 0',
      '# skipped 28',
    ].join('\n')),
    /database phase skipped 28 tests/iu,
  );
});

test('runtime full gate preserves large TAP diagnostics before rejecting a skipped database test', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-output-gate-'));
  const scripts = join(fixture, 'scripts');
  mkdirSync(scripts);
  try {
    for (const name of ['runtime-test-harness.mjs', 'runtime-test-result-safety.mjs']) {
      copyFileSync(join(scriptsDirectory, name), join(scripts, name));
    }
    writeFileSync(join(scripts, 'ordinary.test.mjs'), "import test from 'node:test'; test('ordinary', () => {});\n");
    writeFileSync(join(scripts, 'diagnostic-db.test.mjs'), `
      import test from 'node:test';
      console.log('x'.repeat(2 * 1024 * 1024));
      console.log('FINAL_DATABASE_DIAGNOSTIC');
      test.skip('intentional missing prerequisite', () => {});
    `);
    const child = spawn(process.execPath, [join(scripts, 'runtime-test-harness.mjs'), 'run'], {
      env: completeFullTestEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    // A slow consumer exposes writes still queued when an uncaught error exits.
    child.stdout.pause();
    const resume = setTimeout(() => child.stdout.resume(), 200);
    const status = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }).finally(() => clearTimeout(resume));
    assert.equal(status, 1, stderr);
    assert.match(stderr, /database phase skipped 1 tests/iu);
    assert.ok(stdout.includes('FINAL_DATABASE_DIAGNOSTIC'), `missing final diagnostic; received ${stdout.length} bytes`);
    assert.match(stdout, /# skipped 1/u);
    assert.ok(stdout.length > 2 * 1024 * 1024, 'large TAP output must be complete');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
