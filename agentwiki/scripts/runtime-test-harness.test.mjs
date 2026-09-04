import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const harness = fileURLToPath(new URL('./runtime-test-harness.mjs', import.meta.url));
const fullTestEnvironmentNames = [
  'DATABASE_URL',
  'FOLDER_TEST_DATABASE_URL',
  'MARKDOWN_TEST_DATABASE_URL',
  'PAGE_TEMPLATE_TEST_DATABASE_URL',
  'TEST_REDIS_URL',
];

function environmentWithoutFullTestGate() {
  const environment = { ...process.env };
  delete environment.AGENTWIKI_FULL_TEST;
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
    PAGE_TEMPLATE_TEST_DATABASE_URL: 'postgresql://tester:HARNESS_SECRET_TEMPLATE@127.0.0.1/agentwiki_test',
    TEST_REDIS_URL: 'redis://:HARNESS_SECRET_REDIS@127.0.0.1:6379/1',
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
  assert.ok(plan.parallelTests.length >= 19, 'non-database runtime suites must remain parallel');
  assert.equal(plan.parallelArgs[0], '--test');
  assert.equal(plan.parallelArgs.includes('--test-concurrency=1'), false);
  assert.equal(plan.databaseArgs.includes('--test-concurrency=1'), true);
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
