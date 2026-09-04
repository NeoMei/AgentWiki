import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const SAFE_SCHEMA = /^sync_v3_test_[a-z0-9_]+$/u;
const EMPTY_AUTHORITY_SOCKET_URL = /^(postgres(?:ql)?:\/\/)([^/?#]+@)\/([^?#]+)(\?[^#]*)?$/iu;
const SYNC_V3_MIGRATION = '20260904120000_add_sync_v3_attachments';

function normalizeEmptyAuthoritySocketUrl(value) {
  const match = EMPTY_AUTHORITY_SOCKET_URL.exec(value);
  if (!match) return value;

  const normalized = `${match[1]}${match[2]}localhost/${match[3]}${match[4] ?? ''}`;
  const parsed = new URL(normalized);
  const socketHosts = parsed.searchParams.getAll('host');
  if (socketHosts.length !== 1 || !socketHosts[0]?.startsWith('/')) return value;
  return normalized;
}

export function validateSyncV3TestDatabaseUrl(value) {
  if (!value) throw new Error('SYNC_V3_TEST_DATABASE_URL is required');
  let parsed;
  try {
    parsed = new URL(normalizeEmptyAuthoritySocketUrl(value));
  } catch {
    throw new Error('SYNC_V3_TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('SYNC_V3_TEST_DATABASE_URL must use PostgreSQL');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!databaseName || !databaseName.toLowerCase().includes('test')) {
    throw new Error('SYNC_V3_TEST_DATABASE_URL database name must contain test');
  }
  const schemas = parsed.searchParams.getAll('schema');
  if (schemas.length > 1) {
    throw new Error('SYNC_V3_TEST_DATABASE_URL schema must appear at most once');
  }
  const schema = schemas[0];
  if (schema !== undefined && !SAFE_SCHEMA.test(schema)) {
    throw new Error('SYNC_V3_TEST_DATABASE_URL schema must match ^sync_v3_test_[a-z0-9_]+$');
  }
  return parsed;
}

const quoteIdentifier = (value) => {
  if (!SAFE_SCHEMA.test(value)) {
    throw new Error('Refusing unsafe Sync v3 test schema identifier');
  }
  return `"${value.replaceAll('"', '""')}"`;
};

export async function withSyncV3TestDatabase(baseDatabaseUrl, callback) {
  const parsed = validateSyncV3TestDatabaseUrl(baseDatabaseUrl);
  parsed.searchParams.delete('schema');
  const administrativeUrl = parsed.toString();
  const schemaName = `sync_v3_test_${randomUUID().replaceAll('-', '')}`;
  const schemaSql = quoteIdentifier(schemaName);
  const testUrl = new URL(administrativeUrl);
  testUrl.searchParams.set('schema', schemaName);
  const databaseUrl = testUrl.toString();
  const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl } } });
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'agentwiki-sync-v3-migrations-'));
  const temporaryPrismaRoot = join(temporaryRoot, 'prisma');
  let created = false;

  try {
    const [preflight] = await prisma.$queryRawUnsafe(
      `SELECT current_database() AS database,
              (SELECT count(*)::int FROM pg_namespace WHERE nspname = $1) AS schema_count`,
      schemaName,
    );
    if (!preflight.database.toLowerCase().includes('test')) {
      throw new Error('Connected database name must contain test');
    }
    if (preflight.schema_count !== 0) {
      throw new Error(`Generated Sync v3 test schema already exists: ${schemaName}`);
    }
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${schemaSql}`);
    created = true;
    await cp(new URL('../apps/server/prisma/', import.meta.url), temporaryPrismaRoot, {
      recursive: true,
    });
    await rm(join(temporaryPrismaRoot, 'migrations', SYNC_V3_MIGRATION), {
      recursive: true,
      force: true,
    });
    const migration = spawnSync(
      'pnpm',
      [
        '--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy',
        '--schema', join(temporaryPrismaRoot, 'schema.prisma'),
      ],
      {
        cwd: new URL('..', import.meta.url),
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env, DATABASE_URL: databaseUrl },
      },
    );
    if (migration.error || migration.status !== 0) {
      const details = [migration.error?.message, migration.stdout, migration.stderr]
        .filter(Boolean)
        .join('\n');
      throw new Error(`Sync v3 test migration failed:\n${details}`);
    }
    const applySyncV3Migration = async () => {
      const migrationSql = await readFile(new URL(
        `../apps/server/prisma/migrations/${SYNC_V3_MIGRATION}/migration.sql`,
        import.meta.url,
      ), 'utf8');
      const result = spawnSync(
        'psql',
        ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', administrativeUrl],
        {
          encoding: 'utf8',
          input: `SET search_path TO ${schemaSql};\n${migrationSql}`,
          timeout: 60_000,
        },
      );
      if (result.error || result.status !== 0) {
        const details = [result.error?.message, result.stdout, result.stderr]
          .filter(Boolean)
          .join('\n');
        throw new Error(`Sync v3 attachment migration failed:\n${details}`);
      }
    };
    return await callback({ applySyncV3Migration, databaseUrl, schemaName });
  } finally {
    try {
      if (created) await prisma.$executeRawUnsafe(`DROP SCHEMA ${schemaSql} CASCADE`);
    } finally {
      await prisma.$disconnect();
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}
