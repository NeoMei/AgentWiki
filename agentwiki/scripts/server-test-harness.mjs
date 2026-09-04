#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateCollaborationTestDatabaseUrl,
  withCollaborationTestDatabase,
} from './collaboration-test-database.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2];
const baseDatabaseUrl = process.env.COLLABORATION_TEST_DATABASE_URL;

validateCollaborationTestDatabaseUrl(baseDatabaseUrl);

if (command === 'plan') {
  process.stdout.write(`${JSON.stringify({
    status: 'ready',
    databaseIsolation: 'random collaboration_test_* schema',
  })}\n`);
} else if (command === 'run') {
  const testExit = await withCollaborationTestDatabase(baseDatabaseUrl, async ({ databaseUrl }) => {
    const result = spawnSync('pnpm', ['--filter', '@agentwiki/server', 'test'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        COLLABORATION_TEST_DATABASE_URL: databaseUrl,
      },
      maxBuffer: 64 * 1024 * 1024,
    });
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    if (result.error) throw result.error;
    return result.status ?? 1;
  });
  process.exitCode = testExit;
} else {
  throw new Error('Usage: node scripts/server-test-harness.mjs <plan|run>');
}
