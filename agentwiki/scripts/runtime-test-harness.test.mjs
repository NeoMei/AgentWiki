import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import test from 'node:test';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const harness = fileURLToPath(new URL('./runtime-test-harness.mjs', import.meta.url));

test('runtime plan assigns every test exactly once and serializes only database suites', () => {
  const result = spawnSync(process.execPath, [harness, 'plan'], { encoding: 'utf8' });
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
