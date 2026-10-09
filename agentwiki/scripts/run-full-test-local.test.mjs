import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FULL_TEST_ENVIRONMENT_NAMES,
  classifyFullTestEnvironment,
  buildFullTestEnvironment,
} from './run-full-test-local.mjs';

test('full-test environment classification rejects partial explicit configuration', () => {
  const environment = { DATABASE_URL: 'postgresql://127.0.0.1/agentwiki_test' };
  const result = classifyFullTestEnvironment(environment);

  assert.equal(result.mode, 'partial');
  assert.ok(result.missing.includes('TEST_REDIS_URL'));
  assert.equal(result.configured, 1);
});

test('full-test environment classification permits a completely explicit gate', () => {
  const environment = Object.fromEntries(
    FULL_TEST_ENVIRONMENT_NAMES.map((name) => [name, `configured-${name}`]),
  );

  assert.deepEqual(classifyFullTestEnvironment(environment), {
    mode: 'explicit',
    configured: FULL_TEST_ENVIRONMENT_NAMES.length,
    missing: [],
  });
});

test('autoprovisioned full-test environment binds every gate to the dedicated URLs', () => {
  const environment = buildFullTestEnvironment({
    baseDatabaseUrl: 'postgresql://127.0.0.1/agentwiki_full_test',
    syncVersionDatabaseUrl: 'postgresql://127.0.0.1/agentwiki_sync_version_test',
    redisUrl: 'redis://127.0.0.1:6392/0',
    psqlBin: '/opt/homebrew/bin/psql',
    pgDumpBin: '/opt/homebrew/bin/pg_dump',
  });

  assert.equal(environment.AGENTWIKI_FULL_TEST, '1');
  assert.equal(environment.DATABASE_URL, 'postgresql://127.0.0.1/agentwiki_full_test');
  assert.equal(environment.SYNC_VERSION_TEST_DATABASE_URL, 'postgresql://127.0.0.1/agentwiki_sync_version_test');
  assert.equal(environment.TEST_REDIS_URL, 'redis://127.0.0.1:6392/0');
  assert.equal(environment.AGENTWIKI_PSQL_BIN, '/opt/homebrew/bin/psql');
  assert.equal(environment.PG_DUMP_BIN, '/opt/homebrew/bin/pg_dump');
  assert.ok(environment.FOLDER_TEST_DATABASE_URL);
  assert.ok(environment.SOURCE_FRESHNESS_TEST_DATABASE_URL);
});
