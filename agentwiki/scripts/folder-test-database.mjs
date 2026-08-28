import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const SAFE_SCHEMA = /^folder_test_[a-z0-9_]+$/u;
const VECTOR_EXTENSION_STATEMENT = /CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+vector\s+WITH\s+SCHEMA\s+public\s*;/giu;
const HNSW_DATABASE_SETTING_STATEMENT = /DO\s+\$\$\s*BEGIN\s+EXECUTE\s+format\(\s*'ALTER DATABASE %I SET hnsw\.ef_search = 200'\s*,\s*current_database\(\)\s*\)\s*;\s*END\s+\$\$\s*;/giu;
const FORBIDDEN_MIGRATION_PATTERNS = [
  /(?:CREATE|ALTER|DROP)\s+EXTENSION\b[^;]*;/giu,
  /(?:CREATE|ALTER|DROP)\s+SCHEMA\b[^;]*;/giu,
  /(?:CREATE|ALTER|DROP)\s+(?:CAST|EVENT\s+TRIGGER|PUBLICATION|SUBSCRIPTION|ROLE|DATABASE|TABLESPACE|ACCESS\s+METHOD|LANGUAGE)\b[^;]*;/giu,
  /ALTER\s+SYSTEM\b[^;]*;/giu,
  /COMMENT\s+ON\s+(?:EXTENSION|SCHEMA|DATABASE|ROLE)\b[^;]*;/giu,
  /ALTER\s+DEFAULT\s+PRIVILEGES\b[^;]*;/giu,
  /SET\s+(?:LOCAL\s+)?search_path\b[^;]*;/giu,
  /(?:GRANT|REVOKE)\b[^;]*(?:SCHEMA\s+public|IN\s+SCHEMA\s+public)[^;]*;/giu,
  /(?:CREATE|ALTER|DROP|COMMENT\s+ON)\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE|FUNCTION|PROCEDURE|TYPE|DOMAIN|OPERATOR(?:\s+CLASS|\s+FAMILY)?|CAST)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?public\./giu,
];

const stripSqlComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//gu, ' ')
  .replace(/--[^\r\n]*/gu, ' ');

export async function auditFolderMigrations() {
  const migrationsRoot = new URL('../apps/server/prisma/migrations/', import.meta.url);
  const entries = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  let allowedVectorExtensionStatements = 0;
  let allowedHnswDatabaseSettingStatements = 0;
  const forbiddenStatements = [];
  for (const entry of entries) {
    const migrationUrl = new URL(`${entry.name}/migration.sql`, migrationsRoot);
    const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
    const allowed = sql.match(VECTOR_EXTENSION_STATEMENT) ?? [];
    allowedVectorExtensionStatements += allowed.length;
    const allowedHnswSetting = sql.match(HNSW_DATABASE_SETTING_STATEMENT) ?? [];
    allowedHnswDatabaseSettingStatements += allowedHnswSetting.length;
    let remainder = sql
      .replace(VECTOR_EXTENSION_STATEMENT, ' ')
      .replace(HNSW_DATABASE_SETTING_STATEMENT, ' ');
    for (const pattern of FORBIDDEN_MIGRATION_PATTERNS) {
      const matches = remainder.match(pattern) ?? [];
      forbiddenStatements.push(...matches.map((statement) => ({
        migration: entry.name,
        statement: statement.replace(/\s+/gu, ' ').trim(),
      })));
      remainder = remainder.replace(pattern, ' ');
    }
  }
  return {
    allowedVectorExtensionStatements,
    allowedHnswDatabaseSettingStatements,
    forbiddenStatements,
  };
}

export async function assertFolderDatabaseSafetyPreflight(prisma) {
  const vector = await prisma.$queryRaw`
    SELECT e.extname AS name,
           n.nspname AS schema,
           pg_get_userbyid(e.extowner) AS owner,
           e.extversion AS version
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'vector'
  `;
  if (vector.length !== 1 || vector[0].schema !== 'public') {
    throw new Error('vector extension must be preconfigured in public before Folder test migrations');
  }
  const hnswSetting = await prisma.$queryRaw`
    SELECT configured_setting.setting
    FROM pg_database database
    JOIN pg_db_role_setting configured
      ON configured.setdatabase = database.oid
     AND configured.setrole = 0
    CROSS JOIN LATERAL unnest(configured.setconfig) AS configured_setting(setting)
    WHERE database.datname = current_database()
      AND configured_setting.setting = 'hnsw.ef_search=200'
  `;
  if (hnswSetting.length !== 1) {
    throw new Error('hnsw.ef_search=200 must be preconfigured for the Folder test database before migrations');
  }
  return { vector: vector[0], hnswEfSearch: '200' };
}

export async function captureFolderDatabaseSafetyInventory(prisma) {
  const [
    extensions,
    extensionObjects,
    publicSchema,
    publicRelations,
    publicTypes,
    publicFunctions,
    publicOperators,
    publicOperatorClasses,
    publicOperatorFamilies,
    databaseSettings,
  ] = await Promise.all([
    prisma.$queryRaw`
      SELECT e.extname AS name,
             n.nspname AS schema,
             pg_get_userbyid(e.extowner) AS owner,
             e.extversion AS version,
             e.extrelocatable AS relocatable
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      ORDER BY e.extname
    `,
    prisma.$queryRaw`
      SELECT e.extname AS extension,
             identified.type AS type,
             COALESCE(identified.schema, '') AS schema,
             COALESCE(identified.name, '') AS name,
             identified.identity AS identity
      FROM pg_depend dependency
      JOIN pg_extension e ON e.oid = dependency.refobjid
      CROSS JOIN LATERAL pg_identify_object(
        dependency.classid,
        dependency.objid,
        dependency.objsubid
      ) AS identified
      WHERE dependency.refclassid = 'pg_extension'::regclass
        AND dependency.deptype = 'e'
      ORDER BY e.extname, identified.type, identified.schema, identified.name, identified.identity
    `,
    prisma.$queryRaw`
      SELECT n.nspname AS name,
             pg_get_userbyid(n.nspowner) AS owner,
             COALESCE(n.nspacl::text, '') AS acl,
             COALESCE(obj_description(n.oid, 'pg_namespace'), '') AS comment
      FROM pg_namespace n
      WHERE n.nspname = 'public'
    `,
    prisma.$queryRaw`
      SELECT c.relname AS name,
             c.relkind AS kind,
             c.relpersistence AS persistence,
             pg_get_userbyid(c.relowner) AS owner,
             COALESCE(c.relacl::text, '') AS acl,
             COALESCE(array_to_string(c.reloptions, ','), '') AS options,
             COALESCE(obj_description(c.oid, 'pg_class'), '') AS comment
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      ORDER BY c.relname, c.relkind
    `,
    prisma.$queryRaw`
      SELECT t.typname AS name,
             t.typtype AS type,
             t.typcategory AS category,
             pg_get_userbyid(t.typowner) AS owner,
             COALESCE(t.typacl::text, '') AS acl,
             format_type(t.oid, NULL) AS formatted,
             t.typnotnull AS not_null,
             COALESCE(t.typdefault, '') AS default_value,
             COALESCE(format_type(NULLIF(t.typbasetype, 0), NULL), '') AS base_type,
             COALESCE(format_type(NULLIF(t.typelem, 0), NULL), '') AS element_type,
             COALESCE((
               SELECT string_agg(enum_value.enumlabel, E'\n' ORDER BY enum_value.enumsortorder)
               FROM pg_enum enum_value
               WHERE enum_value.enumtypid = t.oid
             ), '') AS enum_labels
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      ORDER BY t.typname
    `,
    prisma.$queryRaw`
      SELECT p.proname AS name,
             pg_get_function_identity_arguments(p.oid) AS arguments,
             pg_get_function_result(p.oid) AS result,
             p.prokind AS kind,
             p.provolatile AS volatility,
             p.proparallel AS parallel,
             p.prosecdef AS security_definer,
             pg_get_userbyid(p.proowner) AS owner,
             COALESCE(p.proacl::text, '') AS acl
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
    `,
    prisma.$queryRaw`
      SELECT operator.oprname AS name,
             operator.oprkind AS kind,
             format_type(operator.oprleft, NULL) AS left_type,
             format_type(operator.oprright, NULL) AS right_type,
             format_type(operator.oprresult, NULL) AS result_type,
             operator.oprcode::regprocedure::text AS implementation,
             pg_get_userbyid(operator.oprowner) AS owner
      FROM pg_operator operator
      JOIN pg_namespace n ON n.oid = operator.oprnamespace
      WHERE n.nspname = 'public'
      ORDER BY operator.oprname, left_type, right_type
    `,
    prisma.$queryRaw`
      SELECT class.opcname AS name,
             method.amname AS access_method,
             family.opfname AS family,
             format_type(class.opcintype, NULL) AS input_type,
             class.opcdefault AS is_default,
             pg_get_userbyid(class.opcowner) AS owner
      FROM pg_opclass class
      JOIN pg_namespace n ON n.oid = class.opcnamespace
      JOIN pg_am method ON method.oid = class.opcmethod
      JOIN pg_opfamily family ON family.oid = class.opcfamily
      WHERE n.nspname = 'public'
      ORDER BY class.opcname, method.amname
    `,
    prisma.$queryRaw`
      SELECT family.opfname AS name,
             method.amname AS access_method,
             pg_get_userbyid(family.opfowner) AS owner
      FROM pg_opfamily family
      JOIN pg_namespace n ON n.oid = family.opfnamespace
      JOIN pg_am method ON method.oid = family.opfmethod
      WHERE n.nspname = 'public'
      ORDER BY family.opfname, method.amname
    `,
    prisma.$queryRaw`
      SELECT database.datname AS name,
             pg_get_userbyid(database.datdba) AS owner,
             COALESCE(database.datacl::text, '') AS acl,
             COALESCE(settings.settings, '') AS settings
      FROM pg_database database
      LEFT JOIN LATERAL (
        SELECT string_agg(configured_setting.setting, E'\n' ORDER BY configured_setting.setting) AS settings
        FROM pg_db_role_setting configured
        CROSS JOIN LATERAL unnest(configured.setconfig) AS configured_setting(setting)
        WHERE configured.setdatabase = database.oid
          AND configured.setrole = 0
      ) settings ON true
      WHERE database.datname = current_database()
    `,
  ]);
  return {
    extensions,
    extensionObjects,
    publicSchema,
    publicRelations,
    publicTypes,
    publicFunctions,
    publicOperators,
    publicOperatorClasses,
    publicOperatorFamilies,
    databaseSettings,
  };
}

export function folderDatabaseSafetyInventoryDigest(inventory) {
  return createHash('sha256').update(JSON.stringify(inventory), 'utf8').digest('hex');
}

function assertSafetyInventoryUnchanged(before, after, boundary) {
  if (!isDeepStrictEqual(after, before)) {
    throw new Error(
      `Folder database ${boundary} changed protected public inventory `
      + `${folderDatabaseSafetyInventoryDigest(before)} -> ${folderDatabaseSafetyInventoryDigest(after)}`,
    );
  }
}

export function validateFolderTestDatabaseUrl(value) {
  if (!value) throw new Error('FOLDER_TEST_DATABASE_URL is required');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('FOLDER_TEST_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('FOLDER_TEST_DATABASE_URL must use PostgreSQL');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!databaseName || !databaseName.toLowerCase().includes('test')) {
    throw new Error('FOLDER_TEST_DATABASE_URL database name must contain test');
  }
  const schemas = parsed.searchParams.getAll('schema');
  if (schemas.length > 1) {
    throw new Error('FOLDER_TEST_DATABASE_URL schema must appear at most once');
  }
  const schema = schemas[0];
  if (schema !== undefined && !SAFE_SCHEMA.test(schema)) {
    throw new Error('FOLDER_TEST_DATABASE_URL schema must use folder_test_ prefix');
  }
  return parsed;
}

const quoteIdentifier = (value) => {
  if (!SAFE_SCHEMA.test(value)) {
    throw new Error('Refusing unsafe Folder test schema identifier');
  }
  return `"${value.replaceAll('"', '""')}"`;
};

export async function withFolderTestDatabase(baseDatabaseUrl, callback) {
  const parsed = validateFolderTestDatabaseUrl(baseDatabaseUrl);
  parsed.searchParams.delete('schema');
  const administrativeUrl = parsed.toString();
  const schemaName = `folder_test_${randomUUID().replaceAll('-', '')}`;
  const schemaSql = quoteIdentifier(schemaName);
  const testUrl = new URL(administrativeUrl);
  testUrl.searchParams.set('schema', schemaName);
  const databaseUrl = testUrl.toString();
  const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl } } });
  let created = false;
  let safetyInventory;
  let callbackStarted = false;
  try {
    const migrationAudit = await auditFolderMigrations();
    if (
      migrationAudit.allowedVectorExtensionStatements !== 1
      || migrationAudit.allowedHnswDatabaseSettingStatements !== 1
      || migrationAudit.forbiddenStatements.length > 0
    ) {
      throw new Error(`Folder migration safety audit failed: ${JSON.stringify(migrationAudit)}`);
    }
    await assertFolderDatabaseSafetyPreflight(prisma);
    safetyInventory = await captureFolderDatabaseSafetyInventory(prisma);
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
    const postMigrationInventory = await captureFolderDatabaseSafetyInventory(prisma);
    assertSafetyInventoryUnchanged(safetyInventory, postMigrationInventory, 'migration');
    callbackStarted = true;
    return await callback({
      databaseUrl,
      schemaName,
      publicInventoryDigest: folderDatabaseSafetyInventoryDigest(safetyInventory),
    });
  } finally {
    let safetyError;
    try {
      if (safetyInventory && callbackStarted) {
        try {
          const postCallbackInventory = await captureFolderDatabaseSafetyInventory(prisma);
          assertSafetyInventoryUnchanged(safetyInventory, postCallbackInventory, 'callback');
        } catch (error) {
          safetyError = error;
        }
      }
      if (created) {
        try {
          await prisma.$executeRawUnsafe(`DROP SCHEMA ${schemaSql} CASCADE`);
        } catch (error) {
          safetyError ??= error;
        }
      }
    } finally {
      await prisma.$disconnect();
    }
    if (safetyError) throw safetyError;
  }
}
