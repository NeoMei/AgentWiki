import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const SAFE_SCHEMA = /^markdown_test_[a-z0-9_]+$/u;
const EMPTY_AUTHORITY_SOCKET_URL = /^(postgres(?:ql)?:\/\/)([^/?#]+@)\/([^?#]+)(\?[^#]*)?$/iu;

function normalizeEmptyAuthoritySocketUrl(value) {
  const match = EMPTY_AUTHORITY_SOCKET_URL.exec(value);
  if (!match) return value;

  const normalized = `${match[1]}${match[2]}localhost/${match[3]}${match[4] ?? ''}`;
  const parsed = new URL(normalized);
  const socketHosts = parsed.searchParams.getAll('host');
  if (socketHosts.length !== 1 || !socketHosts[0]?.startsWith('/')) return value;
  return normalized;
}

export function validateMarkdownTestDatabaseUrl(value) {
  if (!value) throw new Error('MARKDOWN_TEST_DATABASE_URL is required');
  let parsed;
  try {
    parsed = new URL(normalizeEmptyAuthoritySocketUrl(value));
  } catch {
    throw new Error('MARKDOWN_TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('MARKDOWN_TEST_DATABASE_URL must use PostgreSQL');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!databaseName || !databaseName.toLowerCase().includes('test')) {
    throw new Error('MARKDOWN_TEST_DATABASE_URL database name must contain test');
  }
  const schemas = parsed.searchParams.getAll('schema');
  if (schemas.length > 1) {
    throw new Error('MARKDOWN_TEST_DATABASE_URL schema must appear at most once');
  }
  const schema = schemas[0];
  if (schema !== undefined && !SAFE_SCHEMA.test(schema)) {
    throw new Error('MARKDOWN_TEST_DATABASE_URL schema must match ^markdown_test_[a-z0-9_]+$');
  }
  return parsed;
}

export function expectedMarkdownTestDatabaseIdentity(value) {
  const parsed = validateMarkdownTestDatabaseUrl(value);
  return {
    database: decodeURIComponent(parsed.pathname.replace(/^\//u, '')),
    role: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    unixSocket: parsed.searchParams.get('host')?.startsWith('/') ?? false,
  };
}

const quoteIdentifier = (value) => {
  if (!SAFE_SCHEMA.test(value)) {
    throw new Error('Refusing unsafe Markdown test schema identifier');
  }
  return `"${value.replaceAll('"', '""')}"`;
};

const requireSchemaCount = (actual, expected, message) => {
  if (actual !== expected) throw new Error(message);
};

export async function withMarkdownTestDatabase(baseDatabaseUrl, callback) {
  const parsed = validateMarkdownTestDatabaseUrl(baseDatabaseUrl);
  parsed.searchParams.delete('schema');
  const administrativeUrl = parsed.toString();
  const schemaName = `markdown_test_${randomUUID().replaceAll('-', '')}`;
  const schemaSql = quoteIdentifier(schemaName);
  const testUrl = new URL(administrativeUrl);
  testUrl.searchParams.set('schema', schemaName);
  const databaseUrl = testUrl.toString();
  const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl } } });
  let created = false;

  try {
    const [preflight] = await prisma.$queryRawUnsafe(
      `SELECT current_database() AS database, current_user AS role,
              current_schema() AS schema, current_setting('search_path') AS search_path,
              (SELECT count(*)::int FROM pg_namespace WHERE nspname = $1) AS schema_count`,
      schemaName,
    );
    if (!preflight.database.toLowerCase().includes('test')) {
      throw new Error('Connected database name must contain test');
    }
    requireSchemaCount(
      preflight.schema_count,
      0,
      `Generated Markdown test schema already exists: ${schemaName}`,
    );
    console.info(
      `Markdown test preflight database=${preflight.database} role=${preflight.role} `
      + `schema=${preflight.schema} search_path=${preflight.search_path} `
      + `target=${schemaName} count=${preflight.schema_count}`,
    );

    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${schemaSql}`);
    created = true;
    const [createdSchema] = await prisma.$queryRawUnsafe(
      'SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = $1',
      schemaName,
    );
    requireSchemaCount(
      createdSchema.count,
      1,
      `Markdown test schema creation was not isolated: ${schemaName}`,
    );
    console.info(`Markdown test schema created target=${schemaName} count=${createdSchema.count}`);

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
      const details = [migration.error?.message, migration.stdout, migration.stderr]
        .filter(Boolean)
        .join('\n');
      throw new Error(`Markdown test migration failed:\n${details}`);
    }
    return await callback({ databaseUrl, schemaName });
  } finally {
    try {
      if (created) {
        await prisma.$executeRawUnsafe(`DROP SCHEMA ${schemaSql} CASCADE`);
        const [remaining] = await prisma.$queryRawUnsafe(
          'SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = $1',
          schemaName,
        );
        requireSchemaCount(
          remaining.count,
          0,
          `Markdown test schema cleanup failed: ${schemaName}`,
        );
        console.info(`Markdown test schema removed target=${schemaName} count=${remaining.count}`);
      }
    } finally {
      await prisma.$disconnect();
    }
  }
}
