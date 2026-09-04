import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import {
  assertFolderDatabaseSafetyPreflight,
  captureFolderDatabaseSafetyInventory,
  folderDatabaseSafetyInventoryDigest,
  withFolderMigrationBundle,
} from './folder-test-database.mjs';
import { boundedMigrationOptions, spawnPnpmSync } from './package-manager-process.mjs';
import { assertLoopbackDatabaseHost } from './test-database-url-safety.mjs';

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
  assertLoopbackDatabaseHost(parsed, 'COLLABORATION_TEST_DATABASE_URL');
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

export async function assertCollaborationDatabaseSafetyPreflight(prisma) {
  return assertFolderDatabaseSafetyPreflight(prisma);
}

function assertSafetyInventoryUnchanged(before, after, boundary) {
  if (!isDeepStrictEqual(after, before)) {
    throw new Error(
      `Collaboration database ${boundary} changed protected structural inventory `
      + `${folderDatabaseSafetyInventoryDigest(before)} -> ${folderDatabaseSafetyInventoryDigest(after)}`,
    );
  }
}

export async function withCollaborationTestDatabase(baseDatabaseUrl, callback) {
  const parsed = validateCollaborationTestDatabaseUrl(baseDatabaseUrl);
  parsed.searchParams.delete('schema');
  const administrativeUrl = parsed.toString();
  return withFolderMigrationBundle({}, async (preparedMigrations) => {
    const schemaName = `collaboration_test_${randomUUID().replaceAll('-', '')}`;
    const schemaSql = quoteIdentifier(schemaName);
    const testUrl = new URL(administrativeUrl);
    testUrl.searchParams.set('schema', schemaName);
    const databaseUrl = testUrl.toString();
    const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl } } });
    let schemaCreated = false;
    let safetyInventory;

    try {
      await assertCollaborationDatabaseSafetyPreflight(prisma);
      safetyInventory = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
      await prisma.$executeRawUnsafe(`CREATE SCHEMA ${schemaSql}`);
      schemaCreated = true;
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
        const details = [migration.error?.message, migration.stdout, migration.stderr].filter(Boolean).join('\n');
        throw new Error(`Collaboration test migration failed:\n${details}`);
      }
      const postMigrationInventory = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
      assertSafetyInventoryUnchanged(safetyInventory, postMigrationInventory, 'migration');
      return await callback({
        databaseUrl,
        schemaName,
        migrationTreeDigest: preparedMigrations.treeDigest,
        publicInventoryDigest: folderDatabaseSafetyInventoryDigest(safetyInventory),
      });
    } finally {
      let safetyError;
      if (safetyInventory) {
        try {
          const finalInventory = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
          assertSafetyInventoryUnchanged(safetyInventory, finalInventory, 'test');
        } catch (error) {
          safetyError = error;
        }
      }
      try {
        if (schemaCreated) await prisma.$executeRawUnsafe(`DROP SCHEMA ${schemaSql} CASCADE`);
      } catch (error) {
        safetyError ??= error;
      } finally {
        await prisma.$disconnect();
      }
      if (safetyError) throw safetyError;
    }
  });
}
