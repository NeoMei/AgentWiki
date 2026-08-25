import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const SAFE_SCHEMA = /^page_template_test_[a-z0-9_]+$/u;

export function validatePageTemplateTestDatabaseUrl(value) {
  if (!value) throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL is required');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL must use PostgreSQL');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!databaseName || !databaseName.toLowerCase().includes('test')) {
    throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL database name must contain test');
  }
  const schema = parsed.searchParams.get('schema');
  if (schema && !SAFE_SCHEMA.test(schema)) {
    throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL schema must use page_template_test_ prefix');
  }
  return parsed;
}

const quoteIdentifier = (value) => {
  if (!SAFE_SCHEMA.test(value)) {
    throw new Error('Refusing unsafe page-template test schema identifier');
  }
  return `"${value.replaceAll('"', '""')}"`;
};

export async function withPageTemplateTestDatabase(baseDatabaseUrl, callback) {
  const parsed = validatePageTemplateTestDatabaseUrl(baseDatabaseUrl);
  parsed.searchParams.delete('schema');
  const administrativeUrl = parsed.toString();
  const schemaName = `page_template_test_${randomUUID().replaceAll('-', '')}`;
  const schemaSql = quoteIdentifier(schemaName);
  const testUrl = new URL(administrativeUrl);
  testUrl.searchParams.set('schema', schemaName);
  const databaseUrl = testUrl.toString();
  const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl } } });
  let created = false;
  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${schemaSql}`);
    created = true;
    const migration = spawnSync(
      'pnpm',
      ['--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy'],
      {
        cwd: new URL('..', import.meta.url),
        encoding: 'utf8',
        timeout: 90_000,
        env: { ...process.env, DATABASE_URL: databaseUrl },
      },
    );
    if (migration.error || migration.status !== 0) {
      throw new Error(
        [migration.error?.message, migration.stdout, migration.stderr].filter(Boolean).join('\n'),
      );
    }
    return await callback({ databaseUrl, schemaName });
  } finally {
    try {
      if (created) await prisma.$executeRawUnsafe(`DROP SCHEMA ${schemaSql} CASCADE`);
    } finally {
      await prisma.$disconnect();
    }
  }
}
