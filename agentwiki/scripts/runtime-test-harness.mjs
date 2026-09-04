#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptsDirectory = join(root, 'scripts');
const command = process.argv[2];
const DATABASE_TEST_EXCEPTIONS = new Set([
  'collaboration-real-agent-harness.test.mjs',
  'sync-v1-http-e2e.test.mjs',
]);

function createPlan() {
  const inventory = readdirSync(scriptsDirectory)
    .filter((name) => name.endsWith('.test.mjs'))
    .sort();
  const databaseTests = inventory.filter((name) => (
    name.endsWith('-db.test.mjs') || DATABASE_TEST_EXCEPTIONS.has(name)
  ));
  const databaseSet = new Set(databaseTests);
  const parallelTests = inventory.filter((name) => !databaseSet.has(name));
  const assigned = [...parallelTests, ...databaseTests];
  if (assigned.length !== inventory.length || new Set(assigned).size !== inventory.length) {
    throw new Error('Runtime test inventory must assign every test exactly once');
  }
  return {
    parallelTests,
    databaseTests,
    parallelArgs: ['--test', ...parallelTests.map((name) => join('scripts', name))],
    databaseArgs: [
      '--test',
      '--test-concurrency=1',
      ...databaseTests.map((name) => join('scripts', name)),
    ],
  };
}

function runNodeTests(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const plan = createPlan();
if (command === 'plan') {
  process.stdout.write(`${JSON.stringify(plan)}\n`);
} else if (command === 'run') {
  const parallelExit = runNodeTests(plan.parallelArgs);
  process.exitCode = parallelExit === 0
    ? runNodeTests(plan.databaseArgs)
    : parallelExit;
} else {
  throw new Error('Usage: node scripts/runtime-test-harness.mjs <plan|run>');
}
