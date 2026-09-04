import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { spawnPnpmSync } from './package-manager-process.mjs';
import { randomUUID } from 'node:crypto';
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertPhysicallyDistinctDatabases,
} from './recover-legacy-document-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.DATABASE_URL;
const psqlAvailable = spawnSync('psql', ['--version'], { encoding: 'utf8' }).status === 0;
const databaseSkip = !databaseUrl
  ? 'DATABASE_URL is not configured for local migration tests'
  : !psqlAvailable
    ? 'psql is unavailable for local migration tests'
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
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode) env.PGSSLMODE = sslMode;
  return env;
}

function runPsql(sql, rawUrl = databaseUrl) {
  return spawnSync('psql', ['-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
    env: postgresEnvironment(rawUrl),
  });
}

function runPrisma(args, rawUrl, cwd = root) {
  return spawnPnpmSync(['--filter', '@agentwiki/server', 'exec', 'prisma', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: rawUrl },
  });
}

function isolatedSchema(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function quotedIdentifier(identifier) {
  assert.match(identifier, /^[a-z0-9_]+$/);
  return `"${identifier}"`;
}

async function migration(path) {
  return readFile(resolve(root, path), 'utf8');
}

async function markedOperationsSql(marker) {
  const operations = await readFile(resolve(root, '../design/OPERATIONS.md'), 'utf8');
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = operations.match(new RegExp(
    `-- BEGIN ${escapedMarker}\\n([\\s\\S]*?)\\n-- END ${escapedMarker}`,
  ));
  assert.ok(match, `OPERATIONS.md is missing the ${marker} executable SQL block`);
  return match[1];
}

function assertPsqlSuccess(result) {
  assert.equal(result.status, 0, `psql failed:\n${result.stderr}`);
}

function assertPrismaSuccess(result) {
  assert.equal(result.status, 0, `Prisma failed:\n${result.stdout}\n${result.stderr}`);
}

const firstThirteenMigrations = [
  '20260704184923_init',
  '20260704204711_add_document_generation',
  '20260704215050_add_soft_delete',
  '20260706182924_add_pageversion_relations',
  '20260715193000_security_baseline',
  '20260715213000_knowledge_pipeline_review_memory',
  '20260715223000_ingest_idempotency',
  '20260715224500_migrate_legacy_document_jobs',
  '20260715225500_ingest_scope_snapshot',
  '20260716001000_source_file_snapshots',
  '20260716002500_memory_quality_fields',
  '20260716004000_remove_legacy_document_generation',
  '20260716010000_close_alignment_gaps',
];

async function firstThirteenPrismaDirectory() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'agentwiki-first-thirteen-'));
  const prismaDirectory = join(temporaryRoot, 'prisma');
  const migrationsDirectory = join(prismaDirectory, 'migrations');
  await mkdir(migrationsDirectory, { recursive: true });
  await writeFile(join(prismaDirectory, 'schema.prisma'), `
    datasource db {
      provider = "postgresql"
      url      = env("DATABASE_URL")
    }
  `);
  await copyFile(
    resolve(root, 'apps/server/prisma/migrations/migration_lock.toml'),
    join(migrationsDirectory, 'migration_lock.toml'),
  );
  for (const migrationName of firstThirteenMigrations) {
    await cp(
      resolve(root, 'apps/server/prisma/migrations', migrationName),
      join(migrationsDirectory, migrationName),
      { recursive: true },
    );
  }
  return { temporaryRoot, schemaPath: join(prismaDirectory, 'schema.prisma') };
}

function databaseUrlForSchema(schemaName) {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schemaName);
  return url.href;
}

async function migrationCount() {
  const entries = await readdir(resolve(root, 'apps/server/prisma/migrations'), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).length;
}

test('real PostgreSQL migration reports and removes a non-empty legacy PAT in an isolated schema', {
  skip: databaseSkip,
}, async () => {
  const schema = isolatedSchema('legacy_pat_test');
  const quotedSchema = quotedIdentifier(schema);
  try {
    assertPsqlSuccess(runPsql(`
      CREATE SCHEMA ${quotedSchema};
      SET search_path TO ${quotedSchema};
      CREATE TABLE "User" (
        "id" TEXT PRIMARY KEY,
        "apiKey" TEXT
      );
      CREATE UNIQUE INDEX "User_apiKey_key" ON "User"("apiKey");
      CREATE TABLE "AgentMemory" (
        "id" TEXT PRIMARY KEY,
        "agentId" TEXT NOT NULL,
        "spaceId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "content" TEXT NOT NULL,
        "contentHash" TEXT NOT NULL
      );
      CREATE UNIQUE INDEX "AgentMemory_agentId_spaceId_type_contentHash_key"
        ON "AgentMemory"("agentId", "spaceId", "type", "contentHash");
      INSERT INTO "User" ("id", "apiKey") VALUES ('user-1', 'test-only-legacy-pat');
      INSERT INTO "AgentMemory" ("id", "agentId", "spaceId", "type", "content", "contentHash")
        VALUES ('memory-1', 'agent-1', 'space-1', 'semantic', 'Memory', 'old-hash');
    `));

    const applied = runPsql(`
      SET search_path TO ${quotedSchema};
      ${await migration('apps/server/prisma/migrations/20260727010000_remove_legacy_user_api_key/migration.sql')}
    `);
    assertPsqlSuccess(applied);
    assert.match(applied.stderr, /Legacy User\.apiKey count: 1/);
    assert.match(applied.stderr, /rotate/);

    const verified = runPsql(`
      SELECT COUNT(*)
      FROM information_schema.columns
      WHERE table_schema = '${schema}' AND table_name = 'User' AND column_name = 'apiKey';
      SET search_path TO ${quotedSchema};
      SELECT COUNT(*) FROM "User";
    `);
    assertPsqlSuccess(verified);
    assert.deepEqual(verified.stdout.trim().split('\n'), ['0', '1']);
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE;`);
  }
});

test('legacy PAT migration rolls back its PAT changes when Memory conflict detection fails', {
  skip: databaseSkip,
}, async () => {
  const schema = isolatedSchema('legacy_pat_rollback_test');
  const quotedSchema = quotedIdentifier(schema);
  try {
    assertPsqlSuccess(runPsql(`
      CREATE SCHEMA ${quotedSchema};
      SET search_path TO ${quotedSchema};
      CREATE TABLE "User" (
        "id" TEXT PRIMARY KEY,
        "apiKey" TEXT
      );
      CREATE UNIQUE INDEX "User_apiKey_key" ON "User"("apiKey");
      CREATE TABLE "AgentMemory" (
        "id" TEXT PRIMARY KEY,
        "agentId" TEXT NOT NULL,
        "spaceId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "content" TEXT NOT NULL,
        "contentHash" TEXT NOT NULL
      );
      CREATE UNIQUE INDEX "AgentMemory_agentId_spaceId_type_contentHash_key"
        ON "AgentMemory"("agentId", "spaceId", "type", "contentHash");
      INSERT INTO "User" VALUES ('user-1', 'test-only-legacy-pat');
      INSERT INTO "AgentMemory" VALUES
        ('memory-a', 'agent-1', 'space-1', 'semantic', 'A' || chr(9) || 'B', 'old-a'),
        ('memory-b', 'agent-1', 'space-1', 'semantic', 'a b', 'old-b');
    `));

    const rejected = runPsql(`
      SET search_path TO ${quotedSchema};
      ${await migration('apps/server/prisma/migrations/20260727010000_remove_legacy_user_api_key/migration.sql')}
    `);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /canonical memory hash conflict/);

    const verified = runPsql(`
      SELECT COUNT(*)
      FROM information_schema.columns
      WHERE table_schema = '${schema}' AND table_name = 'User' AND column_name = 'apiKey';
      SET search_path TO ${quotedSchema};
      SELECT "apiKey" FROM "User" WHERE "id" = 'user-1';
      SELECT COUNT(*), string_agg("contentHash", ',' ORDER BY "id") FROM "AgentMemory";
    `);
    assertPsqlSuccess(verified);
    assert.deepEqual(verified.stdout.trim().split('\n'), [
      '1',
      'test-only-legacy-pat',
      '2|old-a,old-b',
    ]);
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE;`);
  }
});

test('real Prisma chain upgrades 13 migrations through legacy false conflicts without data loss', {
  skip: databaseSkip,
}, async () => {
  const schema = isolatedSchema('agentwiki_chain_test');
  const quotedSchema = quotedIdentifier(schema);
  const targetUrl = databaseUrlForSchema(schema);
  let temporaryRoot;
  try {
    const expectedMigrationCount = await migrationCount();
    assertPsqlSuccess(runPsql(`CREATE SCHEMA ${quotedSchema};`));
    const temporary = await firstThirteenPrismaDirectory();
    temporaryRoot = temporary.temporaryRoot;

    const firstDeploy = runPrisma(
      ['migrate', 'deploy', '--schema', temporary.schemaPath],
      targetUrl,
    );
    assertPrismaSuccess(firstDeploy);

    const seeded = runPsql(`
      SET search_path TO ${quotedSchema};
      INSERT INTO "User" ("id", "email", "type", "apiKey", "createdAt", "updatedAt")
        VALUES ('chain-user', 'chain-user@example.test', 'human', 'test-only-chain-pat', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "Space" ("id", "name", "slug", "createdAt", "updatedAt")
        VALUES ('chain-space', 'Chain Space', 'chain-space', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "Agent" ("id", "name", "ownerId", "createdAt", "updatedAt")
        VALUES ('chain-agent', 'Chain Agent', 'chain-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "AgentMemory" (
        "id", "type", "content", "contentHash", "agentId", "spaceId", "createdAt", "updatedAt"
      ) VALUES
        ('ascii-i', 'semantic', 'i', 'old-ascii-i', 'chain-agent', 'chain-space', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('unicode-i', 'semantic', U&'\\0130', 'old-unicode-i', 'chain-agent', 'chain-space', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      SELECT COUNT(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL;
    `);
    assertPsqlSuccess(seeded);
    assert.equal(seeded.stdout.trim(), '13');

    const fullDeploy = runPrisma(['migrate', 'deploy'], targetUrl);
    assertPrismaSuccess(fullDeploy);

    const status = runPrisma(['migrate', 'status'], targetUrl);
    assertPrismaSuccess(status);
    assert.match(status.stdout, /Database schema is up to date/);

    const verified = runPsql(`
      SET search_path TO ${quotedSchema};
      SELECT COUNT(*)
      FROM information_schema.columns
      WHERE table_schema = '${schema}' AND table_name = 'User' AND column_name = 'apiKey';
      SELECT "id", encode(convert_to("content", 'UTF8'), 'hex'), "type", "contentHash"
      FROM "AgentMemory"
      ORDER BY "id";
      SELECT COUNT(*)
      FROM information_schema.tables
      WHERE table_schema = '${schema}' AND table_name = '_AgentMemoryCanonicalizationBridge';
      SELECT COUNT(*)
      FROM "_prisma_migrations"
      WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL;
    `);
    assertPsqlSuccess(verified);
    assert.deepEqual(verified.stdout.trim().split('\n'), [
      '0',
      'ascii-i|69|semantic|865c0c0b4ab0e063e5caa3387c1a8741',
      'unicode-i|c4b0|semantic|1a313f370a5ba8fd5dad6f793d84ff21',
      '0',
      String(expectedMigrationCount),
    ]);
  } finally {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    runPsql(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE;`);
  }
});

test('real Prisma chain deploys all migrations to an empty schema with the local knowledge revision shape', {
  skip: databaseSkip,
}, async () => {
  const schema = isolatedSchema('fresh_install_chain');
  const quotedSchema = quotedIdentifier(schema);
  const targetUrl = databaseUrlForSchema(schema);
  try {
    const expectedMigrationCount = await migrationCount();
    assertPsqlSuccess(runPsql(`CREATE SCHEMA ${quotedSchema};`));

    const deployed = runPrisma(['migrate', 'deploy'], targetUrl);
    assertPrismaSuccess(deployed);

    const status = runPrisma(['migrate', 'status'], targetUrl);
    assertPrismaSuccess(status);
    assert.match(status.stdout, /Database schema is up to date/);

    const verified = runPsql(`
      SET search_path TO ${quotedSchema};
      SELECT COUNT(*)
      FROM "_prisma_migrations"
      WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL;
      SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
      FROM information_schema.columns
      WHERE table_schema = '${schema}' AND table_name = 'SpaceKnowledgeRevision';
      SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
      FROM information_schema.columns
      WHERE table_schema = '${schema}' AND table_name = 'KnowledgeSubmission';
      SELECT COUNT(*)
      FROM pg_constraint constraint_record
      JOIN pg_class table_record ON table_record.oid = constraint_record.conrelid
      JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
      WHERE namespace_record.nspname = '${schema}'
        AND table_record.relname IN ('SpaceKnowledgeRevision', 'KnowledgeSubmission')
        AND constraint_record.contype = 'f';
    `);
    assertPsqlSuccess(verified);
    assert.deepEqual(verified.stdout.trim().split('\n'), [
      String(expectedMigrationCount),
      'id,spaceId,sequence,parentRevisionId,schemaVersion,recipeVersion,contentHash,snapshot,createdAt,delta,sourceChangeSetId,revisionContentHash,pageCount,revisionBodyBytes,revisionManifestByteLength,supersededAt,origin,createdByUserId,humanDeviceCredentialId,migrationBatchId',
      'id,spaceId,baseRevisionId,principalKey,idempotencyKey,schemaVersion,recipeVersion,contentHash,bundle,status,changeSetId,appliedRevisionId,createdAt,updatedAt',
      '7',
    ]);
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE;`);
  }
});

test('real Prisma chain rejects a true ASCII Memory conflict before changing the legacy PAT', {
  skip: databaseSkip,
}, async () => {
  const schema = isolatedSchema('true_conflict_chain');
  const quotedSchema = quotedIdentifier(schema);
  const targetUrl = databaseUrlForSchema(schema);
  let temporaryRoot;
  try {
    assertPsqlSuccess(runPsql(`CREATE SCHEMA ${quotedSchema};`));
    const temporary = await firstThirteenPrismaDirectory();
    temporaryRoot = temporary.temporaryRoot;
    assertPrismaSuccess(runPrisma(
      ['migrate', 'deploy', '--schema', temporary.schemaPath],
      targetUrl,
    ));

    assertPsqlSuccess(runPsql(`
      SET search_path TO ${quotedSchema};
      INSERT INTO "User" ("id", "email", "type", "apiKey", "createdAt", "updatedAt")
        VALUES ('conflict-user', 'conflict-user@example.test', 'human', 'test-only-conflict-pat', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "Space" ("id", "name", "slug", "createdAt", "updatedAt")
        VALUES ('conflict-space', 'Conflict Space', 'conflict-space', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "Agent" ("id", "name", "ownerId", "createdAt", "updatedAt")
        VALUES ('conflict-agent', 'Conflict Agent', 'conflict-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "AgentMemory" (
        "id", "type", "content", "contentHash", "agentId", "spaceId", "createdAt", "updatedAt"
      ) VALUES
        ('memory-a', 'semantic', 'A' || chr(9) || 'B', 'old-a', 'conflict-agent', 'conflict-space', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('memory-b', 'semantic', 'a b', 'old-b', 'conflict-agent', 'conflict-space', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    `));

    const rejected = runPrisma(['migrate', 'deploy'], targetUrl);
    assert.notEqual(rejected.status, 0);
    assert.match(
      `${rejected.stdout}\n${rejected.stderr}`,
      /Applying migration `20260727009000_prepare_memory_hash_canonicalization`/,
    );
    const directlyRejected = runPsql(`
      SET search_path TO ${quotedSchema};
      ${await migration('apps/server/prisma/migrations/20260727009000_prepare_memory_hash_canonicalization/migration.sql')}
    `);
    assert.notEqual(directlyRejected.status, 0);
    assert.match(directlyRejected.stderr, /canonical memory hash conflict/);

    const verified = runPsql(`
      SELECT COUNT(*)
      FROM information_schema.columns
      WHERE table_schema = '${schema}' AND table_name = 'User' AND column_name = 'apiKey';
      SET search_path TO ${quotedSchema};
      SELECT "apiKey" FROM "User" WHERE "id" = 'conflict-user';
      SELECT "id", "type", "contentHash" FROM "AgentMemory" ORDER BY "id";
      SELECT COUNT(*)
      FROM information_schema.tables
      WHERE table_schema = '${schema}' AND table_name = '_AgentMemoryCanonicalizationBridge';
      SELECT COUNT(*)
      FROM "_prisma_migrations"
      WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL;
    `);
    assertPsqlSuccess(verified);
    assert.deepEqual(verified.stdout.trim().split('\n'), [
      '1',
      'test-only-conflict-pat',
      'memory-a|semantic|old-a',
      'memory-b|semantic|old-b',
      '0',
      '13',
    ]);
  } finally {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    runPsql(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE;`);
  }
});

test('real PostgreSQL ASCII canonical migration matches application hashes for Unicode edge cases', {
  skip: databaseSkip,
}, async () => {
  const schema = isolatedSchema('memory_hash_test');
  const quotedSchema = quotedIdentifier(schema);
  try {
    assertPsqlSuccess(runPsql(`
      CREATE SCHEMA ${quotedSchema};
      SET search_path TO ${quotedSchema};
      CREATE TABLE "AgentMemory" (
        "id" TEXT PRIMARY KEY,
        "agentId" TEXT NOT NULL,
        "spaceId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "content" TEXT NOT NULL,
        "contentHash" TEXT NOT NULL
      );
      CREATE UNIQUE INDEX "AgentMemory_agentId_spaceId_type_contentHash_key"
        ON "AgentMemory"("agentId", "spaceId", "type", "contentHash");
      INSERT INTO "AgentMemory" VALUES
        ('ascii', 'agent-1', 'space-1', 'semantic', ' ' || chr(9) || 'A' || chr(13) || chr(10) || 'B' || chr(12) || chr(11) || ' ', 'old-ascii'),
        ('feff', 'agent-1', 'space-1', 'semantic', U&'\\FEFF A \\FEFF', 'old-feff'),
        ('i-dot', 'agent-1', 'space-1', 'semantic', U&'\\0130 A', 'old-i-dot'),
        ('nbsp', 'agent-1', 'space-1', 'semantic', 'A' || chr(160) || 'B', 'old-nbsp');
    `));

    const applied = runPsql(`
      SET search_path TO ${quotedSchema};
      ${await migration('apps/server/prisma/migrations/20260727011000_align_memory_hash_canonicalization/migration.sql')}
    `);
    assertPsqlSuccess(applied);

    const verified = runPsql(`
      SET search_path TO ${quotedSchema};
      SELECT "id", "contentHash" FROM "AgentMemory" ORDER BY "id";
    `);
    assertPsqlSuccess(verified);
    const actual = Object.fromEntries(verified.stdout.trim().split('\n').map((line) => line.split('|')));
    assert.deepEqual(actual, {
      ascii: '0cc9cd4dd26c5137b675a0d819cb9ab0',
      feff: '6ff7fce6bd22edeac246eed56dbe39f5',
      'i-dot': 'f768706201e258a59afff4ab3e0dc686',
      nbsp: '7570c04097240e0563415b8d354c4607',
    });
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE;`);
  }
});

test('real PostgreSQL Memory conflict aborts without changing either row', {
  skip: databaseSkip,
}, async () => {
  const schema = isolatedSchema('memory_conflict_test');
  const quotedSchema = quotedIdentifier(schema);
  try {
    assertPsqlSuccess(runPsql(`
      CREATE SCHEMA ${quotedSchema};
      SET search_path TO ${quotedSchema};
      CREATE TABLE "AgentMemory" (
        "id" TEXT PRIMARY KEY,
        "agentId" TEXT NOT NULL,
        "spaceId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "content" TEXT NOT NULL,
        "contentHash" TEXT NOT NULL
      );
      CREATE UNIQUE INDEX "AgentMemory_agentId_spaceId_type_contentHash_key"
        ON "AgentMemory"("agentId", "spaceId", "type", "contentHash");
      INSERT INTO "AgentMemory" VALUES
        ('memory-a', 'agent-1', 'space-1', 'semantic', 'A' || chr(9) || 'B', 'old-a'),
        ('memory-b', 'agent-1', 'space-1', 'semantic', 'a b', 'old-b');
    `));

    const rejected = runPsql(`
      SET search_path TO ${quotedSchema};
      ${await migration('apps/server/prisma/migrations/20260727011000_align_memory_hash_canonicalization/migration.sql')}
    `);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /canonical memory hash conflict/);

    const verified = runPsql(`
      SET search_path TO ${quotedSchema};
      SELECT COUNT(*), string_agg("contentHash", ',' ORDER BY "id") FROM "AgentMemory";
    `);
    assertPsqlSuccess(verified);
    assert.equal(verified.stdout.trim(), '2|old-a,old-b');
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE;`);
  }
});

test('operations provenance validation catches wrong Evidence fields, NULLs, and missing edges', {
  skip: databaseSkip,
}, async () => {
  const schema = isolatedSchema('legacy_provenance_test');
  const quotedSchema = quotedIdentifier(schema);
  try {
    assertPsqlSuccess(runPsql(`
      CREATE SCHEMA ${quotedSchema};
      SET search_path TO ${quotedSchema};
      CREATE TABLE "Source" (
        "id" TEXT PRIMARY KEY
      );
      CREATE TABLE "SourceVersion" (
        "id" TEXT PRIMARY KEY,
        "sourceId" TEXT,
        "content" TEXT,
        "metadata" JSONB
      );
      CREATE TABLE "Page" (
        "id" TEXT PRIMARY KEY,
        "sourceId" TEXT,
        "sourceVersionId" TEXT,
        "sourcePath" TEXT
      );
      CREATE TABLE "Evidence" (
        "id" TEXT PRIMARY KEY,
        "targetPageId" TEXT,
        "sourceVersionId" TEXT,
        "location" JSONB,
        "confidence" DOUBLE PRECISION
      );

      INSERT INTO "Source" VALUES ('legacy-source-job-42');
      INSERT INTO "SourceVersion" VALUES (
        'legacy-version',
        'legacy-source-job-42',
        '{"filesByPath":{"docs/a.md":{},"docs/b.md":{},"docs/good.md":{},"docs/single.md":{},"docs/null-policy.md":{},"docs/single-invalid.md":{},"docs/null-confidence.md":{}}}',
        '{"contentFormat":"agentwiki/legacy-codebase-snapshot-bundle@1"}'
      );
      INSERT INTO "Page" VALUES
        ('page-good-legacy', 'legacy-source-job-42', 'legacy-version', 'docs/good.md'),
        ('page-good-single', 'legacy-source-job-42', 'legacy-version', 'docs/single.md'),
        ('page-good-fallback', 'legacy-source-job-42', 'legacy-version', NULL),
        ('page-good-synthetic', 'legacy-source-job-42', 'legacy-version', NULL);
      INSERT INTO "Evidence" VALUES
        (
          'evidence-good-legacy',
          'page-good-legacy',
          'legacy-version',
          '{"legacyJobId":"job-42","sourcePath":"docs/good.md","linkStrategy":"legacy-result","bundlePath":"docs/good.md"}',
          1
        ),
        (
          'evidence-good-single',
          'page-good-single',
          'legacy-version',
          '{"legacyJobId":"job-42","sourcePath":"docs/single.md","linkStrategy":"single-snapshot","bundlePath":"docs/single.md"}',
          0.75
        ),
        (
          'evidence-good-fallback',
          'page-good-fallback',
          'legacy-version',
          '{"legacyJobId":"job-42","sourcePath":null,"linkStrategy":"legacy-result-path-missing-snapshot","bundlePath":null,"requestedPath":"docs/missing.md"}',
          0.25
        ),
        (
          'evidence-good-synthetic',
          'page-good-synthetic',
          'legacy-version',
          '{"legacyJobId":"job-42","sourcePath":null,"linkStrategy":"synthetic-page-link","bundlePath":null}',
          0.5
        );
    `));

    const validation = await markedOperationsSql('LEGACY_PROVENANCE_VALIDATION');
    const validResult = runPsql(`
      SET search_path TO ${quotedSchema};
      ${validation}
    `);
    assertPsqlSuccess(validResult);
    assert.equal(validResult.stdout.trim(), '');

    assertPsqlSuccess(runPsql(`
      SET search_path TO ${quotedSchema};
      INSERT INTO "Page" VALUES
        ('page-location', 'legacy-source-job-42', 'legacy-version', 'docs/a.md'),
        ('page-confidence', 'legacy-source-job-42', 'legacy-version', 'docs/b.md'),
        ('page-no-evidence', 'legacy-source-job-42', 'legacy-version', NULL),
        ('page-null-version', 'legacy-source-job-42', NULL, NULL),
        ('page-null-policy', 'legacy-source-job-42', 'legacy-version', 'docs/null-policy.md'),
        ('page-single-null-bundle', 'legacy-source-job-42', 'legacy-version', 'docs/single-invalid.md'),
        ('page-null-confidence', 'legacy-source-job-42', 'legacy-version', 'docs/null-confidence.md'),
        ('page-fallback-path', 'legacy-source-job-42', 'legacy-version', 'docs/fallback-invalid.md'),
        ('page-fallback-request', 'legacy-source-job-42', 'legacy-version', NULL),
        ('page-synthetic-request', 'legacy-source-job-42', 'legacy-version', NULL),
        ('page-mapped-request', 'legacy-source-job-42', 'legacy-version', 'docs/good.md');
      INSERT INTO "Evidence" VALUES
        (
          'evidence-location',
          'page-location',
          'legacy-version',
          '{"legacyJobId":"job-42","sourcePath":"docs/wrong.md","linkStrategy":"legacy-result","bundlePath":"docs/wrong.md"}',
          1
        ),
        (
          'evidence-confidence',
          'page-confidence',
          'legacy-version',
          '{"legacyJobId":"job-42","sourcePath":"docs/b.md","linkStrategy":"legacy-result","bundlePath":"docs/b.md"}',
          0.5
        ),
        (
          'evidence-missing-page',
          'missing-page',
          'legacy-version',
          '{"legacyJobId":"job-42","sourcePath":"docs/a.md","linkStrategy":"legacy-result","bundlePath":"docs/a.md"}',
          1
        ),
        (
          'evidence-null-policy',
          'page-null-policy',
          'legacy-version',
          '{"legacyJobId":"job-42","sourcePath":"docs/null-policy.md","bundlePath":"docs/null-policy.md"}',
          NULL
        ),
        (
          'evidence-single-null-bundle',
          'page-single-null-bundle',
          'legacy-version',
          '{"legacyJobId":"job-42","sourcePath":"docs/single-invalid.md","linkStrategy":"single-snapshot","bundlePath":null}',
          0.75
        ),
        (
          'evidence-null-confidence',
          'page-null-confidence',
          'legacy-version',
          '{"legacyJobId":"job-42","sourcePath":"docs/null-confidence.md","linkStrategy":"legacy-result","bundlePath":"docs/null-confidence.md"}',
          NULL
        ),
        (
          'evidence-fallback-path',
          'page-fallback-path',
          'legacy-version',
          '{"legacyJobId":"job-42","sourcePath":"docs/fallback-invalid.md","linkStrategy":"legacy-result-path-missing-snapshot","bundlePath":"docs/fallback-invalid.md","requestedPath":"docs/missing.md"}',
          0.25
        ),
        (
          'evidence-fallback-request',
          'page-fallback-request',
          'legacy-version',
          '{"legacyJobId":"job-42","sourcePath":null,"linkStrategy":"legacy-result-path-missing-snapshot","bundlePath":null}',
          0.25
        ),
        (
          'evidence-synthetic-request',
          'page-synthetic-request',
          'legacy-version',
          '{"legacyJobId":"job-42","sourcePath":null,"linkStrategy":"synthetic-page-link","bundlePath":null,"requestedPath":"unexpected"}',
          0.5
        ),
        (
          'evidence-mapped-request',
          'page-mapped-request',
          'legacy-version',
          '{"legacyJobId":"job-42","sourcePath":"docs/good.md","linkStrategy":"legacy-result","bundlePath":"docs/good.md","requestedPath":"unexpected"}',
          1
        );
    `));

    const result = runPsql(`
      SET search_path TO ${quotedSchema};
      ${validation}
    `);
    assertPsqlSuccess(result);
    assert.deepEqual(new Set(result.stdout.trim().split('\n')), new Set([
      'evidence_confidence_mismatch|evidence-confidence|page-confidence',
      'evidence_confidence_missing|evidence-null-confidence|page-null-confidence',
      'evidence_fallback_path_invalid|evidence-fallback-path|page-fallback-path',
      'evidence_link_strategy_missing|evidence-null-policy|page-null-policy',
      'evidence_mapped_path_invalid|evidence-single-null-bundle|page-single-null-bundle',
      'evidence_missing_page|evidence-missing-page|',
      'evidence_requested_path_invalid|evidence-fallback-request|page-fallback-request',
      'evidence_requested_path_invalid|evidence-mapped-request|page-mapped-request',
      'evidence_requested_path_invalid|evidence-synthetic-request|page-synthetic-request',
      'evidence_source_path_mismatch|evidence-location|page-location',
      'page_missing_evidence||page-no-evidence',
      'page_missing_source_version||page-null-version',
    ]));

    const fullyLinkedCount = await markedOperationsSql('LEGACY_FULLY_LINKED_COUNT');
    const countResult = runPsql(`
      SET search_path TO ${quotedSchema};
      ${fullyLinkedCount}
    `);
    assertPsqlSuccess(countResult);
    assert.equal(countResult.stdout.trim(), '2');
  } finally {
    runPsql(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE;`);
  }
});

const localHost = databaseUrl ? new URL(databaseUrl).hostname : '';
const physicalIdentitySkip = databaseSkip || !['127.0.0.1', 'localhost'].includes(localHost)
  ? databaseSkip || 'DATABASE_URL is not a local TCP URL'
  : false;

test('real Prisma connections reject localhost and 127.0.0.1 aliases for the same database', {
  skip: physicalIdentitySkip,
}, async () => {
  const alternateUrl = new URL(databaseUrl);
  alternateUrl.hostname = localHost === 'localhost' ? '127.0.0.1' : 'localhost';
  const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
  const { PrismaClient } = requireFromServer('@prisma/client');
  const source = new PrismaClient({ datasources: { db: { url: alternateUrl.href } } });
  const target = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await assert.rejects(
      assertPhysicallyDistinctDatabases(source, target),
      (error) => {
        assert.match(error.message, /physically different PostgreSQL databases/);
        assert.doesNotMatch(error.message, /postgres(?:ql)?:\/\//);
        return true;
      },
    );

    const cli = spawnSync(process.execPath, ['scripts/recover-legacy-document-data.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        LEGACY_DATABASE_URL: alternateUrl.href,
        DATABASE_URL: databaseUrl,
      },
    });
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /physically different PostgreSQL databases/);
    assert.doesNotMatch(`${cli.stdout}\n${cli.stderr}`, /postgres(?:ql)?:\/\//);
    const databasePassword = new URL(databaseUrl).password;
    if (databasePassword) {
      assert.equal(`${cli.stdout}\n${cli.stderr}`.includes(databasePassword), false);
    }
  } finally {
    await Promise.allSettled([source.$disconnect(), target.$disconnect()]);
  }
});
