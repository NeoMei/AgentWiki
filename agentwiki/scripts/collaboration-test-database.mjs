import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const SAFE_SCHEMA = /^collaboration_test_[a-z0-9_]+$/;

export function validateCollaborationTestDatabaseUrl(value) {
  if (!value) throw new Error('COLLABORATION_TEST_DATABASE_URL is required');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('COLLABORATION_TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('COLLABORATION_TEST_DATABASE_URL must use PostgreSQL');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!databaseName || !databaseName.toLowerCase().includes('test')) {
    throw new Error('COLLABORATION_TEST_DATABASE_URL database name must contain test');
  }
  const existingSchema = parsed.searchParams.get('schema');
  if (existingSchema && !SAFE_SCHEMA.test(existingSchema)) {
    throw new Error('COLLABORATION_TEST_DATABASE_URL schema must use the collaboration_test_ prefix');
  }
  return parsed;
}

function quoteIdentifier(value) {
  if (!SAFE_SCHEMA.test(value)) throw new Error('Refusing unsafe collaboration test schema identifier');
  return `"${value.replaceAll('"', '""')}"`;
}

export async function withCollaborationTestDatabase(baseDatabaseUrl, callback) {
  const parsed = validateCollaborationTestDatabaseUrl(baseDatabaseUrl);
  parsed.searchParams.delete('schema');
  const administrativeUrl = parsed.toString();
  const schemaName = `collaboration_test_${randomUUID().replaceAll('-', '')}`;
  const schemaSql = quoteIdentifier(schemaName);
  const testUrl = new URL(administrativeUrl);
  testUrl.searchParams.set('schema', schemaName);
  const databaseUrl = testUrl.toString();
  const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl } } });
  let schemaCreated = false;

  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${schemaSql}`);
    schemaCreated = true;
    const root = new URL('..', import.meta.url);
    const migration = spawnSync(
      'pnpm',
      ['--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: databaseUrl },
        timeout: 90_000,
      },
    );
    if (migration.error || migration.status !== 0) {
      const details = [migration.error?.message, migration.stdout, migration.stderr].filter(Boolean).join('\n');
      throw new Error(`Collaboration test migration failed:\n${details}`);
    }
    return await callback({ databaseUrl, schemaName });
  } finally {
    try {
      if (schemaCreated) await prisma.$executeRawUnsafe(`DROP SCHEMA ${schemaSql} CASCADE`);
    } finally {
      await prisma.$disconnect();
    }
  }
}
