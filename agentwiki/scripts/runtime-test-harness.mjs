#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertZeroSkippedDatabaseTests } from './runtime-test-result-safety.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptsDirectory = join(root, 'scripts');
const command = process.argv[2];
const DATABASE_TEST_EXCEPTIONS = new Set([
  'collaboration-real-agent-harness.test.mjs',
  'sync-v1-http-e2e.test.mjs',
]);
const FULL_TEST_PREREQUISITES = [
  'DATABASE_URL',
  'FOLDER_TEST_DATABASE_URL',
  'MARKDOWN_TEST_DATABASE_URL',
  'COLLABORATION_TEST_DATABASE_URL',
  'PAGE_TEMPLATE_TEST_DATABASE_URL',
  'SYNC_V3_TEST_DATABASE_URL',
  'TEST_REDIS_URL',
];

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
      '--test-reporter=tap',
      ...databaseTests.map((name) => join('scripts', name)),
    ],
  };
}

function runNodeTests(args, { requireZeroSkips = false } = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (status === 0 && requireZeroSkips) {
    assertZeroSkippedDatabaseTests(result.stdout);
  }
  return status;
}

function assertFullTestPrerequisites(plan, environment = process.env) {
  if (environment.AGENTWIKI_FULL_TEST !== '1' || plan.databaseTests.length === 0) return;
  const missing = FULL_TEST_PREREQUISITES.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`${missing.join(', ')} is required when AGENTWIKI_FULL_TEST=1`);
  }

  const psqlExecutable = environment.AGENTWIKI_PSQL_BIN?.trim() || 'psql';
  const probe = spawnSync(psqlExecutable, ['--version'], {
    encoding: 'utf8',
    env: environment,
    timeout: 10_000,
  });
  if (probe.error || probe.status !== 0) {
    throw new Error('psql is required and must be available when AGENTWIKI_FULL_TEST=1');
  }
}

const plan = createPlan();
assertFullTestPrerequisites(plan);
if (command === 'plan') {
  process.stdout.write(`${JSON.stringify(plan)}\n`);
} else if (command === 'run') {
  const parallelExit = runNodeTests(plan.parallelArgs);
  process.exitCode = parallelExit === 0
    ? runNodeTests(plan.databaseArgs, {
      requireZeroSkips: process.env.AGENTWIKI_FULL_TEST === '1',
    })
    : parallelExit;
} else {
  throw new Error('Usage: node scripts/runtime-test-harness.mjs <plan|run>');
}
