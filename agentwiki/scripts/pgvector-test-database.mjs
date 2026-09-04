import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import {
  assertFolderDatabaseSafetyPreflight,
  captureFolderDatabaseSafetyInventory,
  folderDatabaseSafetyInventoryDigest,
  withFolderMigrationBundle,
} from './folder-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const SAFE_SCHEMA = /^pgvector_test_[a-z0-9_]+$/u;

export function validatePgvectorTestDatabaseUrl(value) {
  if (!value) throw new Error('DATABASE_URL is required');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!databaseName || !databaseName.toLowerCase().includes('test')) {
    throw new Error('DATABASE_URL database name must contain test');
  }
  const schemas = parsed.searchParams.getAll('schema');
  if (schemas.length > 1) throw new Error('DATABASE_URL schema must appear at most once');
  if (schemas[0] !== undefined && !SAFE_SCHEMA.test(schemas[0])) {
    throw new Error('DATABASE_URL schema must use the pgvector_test_ prefix');
  }
  return parsed;
}

function quoteIdentifier(value) {
  if (!SAFE_SCHEMA.test(value)) throw new Error('Refusing unsafe pgvector test schema identifier');
  return `"${value.replaceAll('"', '""')}"`;
}

export async function assertPgvectorDatabaseSafetyPreflight(prisma) {
  return assertFolderDatabaseSafetyPreflight(prisma);
}

function assertSafetyInventoryUnchanged(before, after, boundary) {
  if (!isDeepStrictEqual(after, before)) {
    throw new Error(
      `pgvector database ${boundary} changed protected structural inventory `
      + `${folderDatabaseSafetyInventoryDigest(before)} -> ${folderDatabaseSafetyInventoryDigest(after)}`,
    );
  }
}

export function selectPgvectorIndexForSchema(rows, schemaName, indexName) {
  const matches = rows.filter((row) => (
    row.schemaName === schemaName && row.indexName === indexName
  ));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${schemaName}.${indexName} index, found ${matches.length}`);
  }
  return matches[0];
}

export async function withPgvectorTestDatabase(baseDatabaseUrl, callback) {
  const parsed = validatePgvectorTestDatabaseUrl(baseDatabaseUrl);
  parsed.searchParams.delete('schema');
  const administrativeUrl = parsed.toString();
  return withFolderMigrationBundle({}, async (preparedMigrations) => {
    const schemaName = `pgvector_test_${randomUUID().replaceAll('-', '')}`;
    const schemaSql = quoteIdentifier(schemaName);
    const testUrl = new URL(administrativeUrl);
    testUrl.searchParams.set('schema', schemaName);
    const databaseUrl = testUrl.toString();
    const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl } } });
    let schemaCreated = false;
    let safetyInventory;

    try {
      await assertPgvectorDatabaseSafetyPreflight(prisma);
      safetyInventory = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
      await prisma.$executeRawUnsafe(`CREATE SCHEMA ${schemaSql}`);
      schemaCreated = true;
      return await callback({
        databaseUrl,
        schemaName,
        schemaPath: preparedMigrations.schemaPath,
        migrationsRoot: preparedMigrations.migrationsRoot,
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
