import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.DATABASE_URL;
const psqlAvailable = spawnSync('psql', ['--version'], { encoding: 'utf8' }).status === 0;
const skip = !databaseUrl
  ? 'DATABASE_URL is not configured'
  : !psqlAvailable
    ? 'psql is unavailable'
    : false;

function postgresEnvironment(rawUrl) {
  const parsed = new URL(rawUrl);
  const env = { ...process.env };
  delete env.DATABASE_URL;
  env.PGHOST = parsed.hostname;
  env.PGPORT = parsed.port || '5432';
  env.PGDATABASE = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  env.PGUSER = decodeURIComponent(parsed.username);
  env.PGPASSWORD = decodeURIComponent(parsed.password);
  return env;
}

function runPsql(sql, schema) {
  return spawnSync('psql', ['-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
    env: postgresEnvironment(databaseUrl),
  });
}

test('sync v1 migrations apply and contract fields are non-null', { skip }, async () => {
  const schema = `sync_v1_${randomUUID().replaceAll('-', '')}`;
  const quoted = `"${schema}"`;
  try {
    assert.equal(runPsql(`CREATE SCHEMA ${quoted}`).status, 0);
    const url = new URL(databaseUrl);
    url.searchParams.set('schema', schema);
    const deploy = spawnSync('pnpm', ['--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url.href },
    });
    assert.equal(deploy.status, 0, `prisma migrate deploy failed:\n${deploy.stdout}\n${deploy.stderr}`);

    const check = runPsql(`
      SET search_path TO ${quoted};
      SELECT
        (SELECT count(*) FROM "SpaceKnowledgeRevision" WHERE "revisionContentHash" IS NULL),
        (SELECT count(*) FROM "SpaceKnowledgeRevision" WHERE "pageCount" IS NULL),
        (SELECT count(*) FROM "SpaceKnowledgeRevision" WHERE "revisionBodyBytes" IS NULL),
        (SELECT count(*) FROM "SpaceKnowledgeRevision" WHERE "revisionManifestByteLength" IS NULL),
        (SELECT count(*) FROM "Page" WHERE "syncPath" IS NULL OR "syncPathKey" IS NULL);
    `);
    assert.equal(check.status, 0, check.stderr);
    assert.deepEqual(check.stdout.trim().split('|'), ['0', '0', '0', '0', '0']);

    const indexCheck = runPsql(`
      SELECT count(*)
      FROM pg_indexes
      WHERE schemaname = '${schema}'
        AND indexname IN (
          'HumanDeviceCredential_one_provisional_per_family',
          'HumanDeviceCredential_one_active_per_family'
        );
    `);
    assert.equal(indexCheck.status, 0, indexCheck.stderr);
    assert.equal(indexCheck.stdout.trim(), '2');
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  }
});
