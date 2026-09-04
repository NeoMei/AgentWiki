import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  assertFolderDatabaseSafetyInventoryUnchanged,
  assertFolderDatabaseSafetyPreflight,
  captureFolderDatabaseSafetyInventory,
  folderDatabaseSafetyInventoryDigest,
  withFolderMigrationBundle,
} from './folder-test-database.mjs';
import { boundedMigrationOptions, spawnPnpmSync } from './package-manager-process.mjs';
import { errorWithTestDatabaseCleanup } from './test-database-lifecycle.mjs';
import { assertLoopbackDatabaseHost } from './test-database-url-safety.mjs';

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
  assertLoopbackDatabaseHost(parsed, 'PAGE_TEMPLATE_TEST_DATABASE_URL');
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!databaseName || !databaseName.toLowerCase().includes('test')) {
    throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL database name must contain test');
  }
  const schemas = parsed.searchParams.getAll('schema');
  if (schemas.length > 1) {
    throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL schema must appear at most once');
  }
  const schema = schemas[0];
  if (schema !== undefined && !SAFE_SCHEMA.test(schema)) {
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
  return withFolderMigrationBundle({}, async (preparedMigrations) => {
    const schemaName = `page_template_test_${randomUUID().replaceAll('-', '')}`;
    const schemaSql = quoteIdentifier(schemaName);
    const testUrl = new URL(administrativeUrl);
    testUrl.searchParams.set('schema', schemaName);
    const databaseUrl = testUrl.toString();
    const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl } } });
    let created = false;
    let primaryError;
    let result;
    let safetyInventory;

    try {
      await assertFolderDatabaseSafetyPreflight(prisma);
      safetyInventory = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
      await prisma.$executeRawUnsafe(`CREATE SCHEMA ${schemaSql}`);
      created = true;
      const migration = spawnPnpmSync(
        [
          '--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy',
          '--schema', preparedMigrations.schemaPath,
        ],
        boundedMigrationOptions({
          cwd: new URL('..', import.meta.url),
          encoding: 'utf8',
          env: { ...process.env, DATABASE_URL: databaseUrl },
        }),
      );
      if (migration.error || migration.status !== 0) {
        throw new Error(
          [migration.error?.message, migration.stdout, migration.stderr].filter(Boolean).join('\n'),
        );
      }
      const postMigrationInventory = await captureFolderDatabaseSafetyInventory(
        administrativeUrl,
        prisma,
      );
      assertFolderDatabaseSafetyInventoryUnchanged(
        safetyInventory,
        postMigrationInventory,
        'migration',
        'Page-template',
      );
      result = await callback({
        databaseUrl,
        schemaName,
        migrationTreeDigest: preparedMigrations.treeDigest,
        publicInventoryDigest: folderDatabaseSafetyInventoryDigest(safetyInventory),
      });
    } catch (error) {
      primaryError = error;
    }

    const cleanupErrors = [];
    if (created) {
      try {
        await prisma.$executeRawUnsafe(`DROP SCHEMA ${schemaSql} CASCADE`);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (safetyInventory) {
      try {
        const finalInventory = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
        assertFolderDatabaseSafetyInventoryUnchanged(
          safetyInventory,
          finalInventory,
          'run',
          'Page-template',
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await prisma.$disconnect();
    } catch (error) {
      cleanupErrors.push(error);
    }
    const finalError = errorWithTestDatabaseCleanup(
      primaryError,
      cleanupErrors,
      'Page-template test database harness',
    );
    if (finalError) throw finalError;
    return result;
  });
}
