import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { spawnPnpmSync } from './package-manager-process.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const SAFE_SCHEMA = /^folder_test_[a-z0-9_]+$/u;
const REVIEWED_MIGRATION_TREE_SHA256 = '28c5e130d83492621fc721d6ca8d5d635f4735069ab0522a2869f9af2f442d09';
const DEFAULT_MIGRATIONS_ROOT = fileURLToPath(new URL('../apps/server/prisma/migrations/', import.meta.url));
const DEFAULT_SCHEMA_PATH = fileURLToPath(new URL('../apps/server/prisma/schema.prisma', import.meta.url));
const VECTOR_EXTENSION_FRAGMENT = 'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;';
const HNSW_DATABASE_SETTING_FRAGMENT = `DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET hnsw.ef_search = 200', current_database());
END
$$;`;
const REVIEWED_GLOBAL_FRAGMENTS = [
  {
    relativePath: '20260821120000_pgvector_semantic_search/migration.sql',
    sourceSha256: '9a9bef11535630b9a41db7e1ed7bcd920dea251d958dae91f578e60f97acd7a1',
    fragment: VECTOR_EXTENSION_FRAGMENT,
    replacement: '-- Folder test bundle: vector extension is a preflight-only shared dependency.',
    label: 'public vector extension declaration',
  },
  {
    relativePath: '20260821130000_tune_hnsw_recall/migration.sql',
    sourceSha256: '9e423f946144d7508e23ae8e412bede77f6cd6b2199f740090914e4e8c49e45e',
    fragment: HNSW_DATABASE_SETTING_FRAGMENT,
    replacement: '-- Folder test bundle: database-level hnsw.ef_search configuration is intentionally skipped.',
    label: 'database-level hnsw.ef_search block',
  },
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const compareByteStrings = (left, right) => Buffer.compare(
  Buffer.from(left, 'utf8'),
  Buffer.from(right, 'utf8'),
);

// Git may materialize reviewed SQL blobs with CRLF on Windows. Canonicalize
// only that transport-level conversion so the captured bundle and its
// byte-exact fingerprints remain identical on every supported platform.
function canonicalMigrationBytes(content) {
  return Buffer.from(content.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
}

async function listMigrationFiles(root, relativeDirectory = '') {
  const directoryEntries = (await readdir(join(root, relativeDirectory), { withFileTypes: true }))
    .sort((left, right) => compareByteStrings(left.name, right.name));
  const files = [];
  for (const entry of directoryEntries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listMigrationFiles(root, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Folder migration corpus contains an unsupported entry: ${relativePath}`);
    }
  }
  return files;
}

export async function inspectFolderMigrationCorpus(migrationsRoot = DEFAULT_MIGRATIONS_ROOT) {
  const root = migrationsRoot instanceof URL ? fileURLToPath(migrationsRoot) : migrationsRoot;
  const relativePaths = await listMigrationFiles(root);
  const entries = [];
  let canonicalManifest = '';
  for (const relativePath of relativePaths) {
    const content = canonicalMigrationBytes(await readFile(join(root, relativePath)));
    const contentSha256 = sha256(content);
    entries.push(Object.freeze({
      relativePath,
      sha256: contentSha256,
      contentBase64: content.toString('base64'),
    }));
    canonicalManifest += `${relativePath}\0${contentSha256}\n`;
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    treeDigest: sha256(canonicalManifest),
  });
}

function validatedFolderMigrationInspection(inspection) {
  if (!inspection || !Array.isArray(inspection.entries)) {
    throw new Error('Folder migration inspection must contain captured entries');
  }
  const entries = [];
  let canonicalManifest = '';
  let previousPath;
  for (const entry of inspection.entries) {
    if (
      !entry
      || typeof entry.relativePath !== 'string'
      || entry.relativePath.length === 0
      || entry.relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
      || typeof entry.sha256 !== 'string'
      || typeof entry.contentBase64 !== 'string'
    ) {
      throw new Error('Folder migration inspection contains an invalid captured entry');
    }
    if (previousPath !== undefined && compareByteStrings(previousPath, entry.relativePath) >= 0) {
      throw new Error('Folder migration inspection entries must be uniquely byte-sorted');
    }
    const content = Buffer.from(entry.contentBase64, 'base64');
    if (content.toString('base64') !== entry.contentBase64 || sha256(content) !== entry.sha256) {
      throw new Error(`Folder captured migration bytes do not match inspected hash: ${entry.relativePath}`);
    }
    entries.push({ relativePath: entry.relativePath, sha256: entry.sha256, content });
    canonicalManifest += `${entry.relativePath}\0${entry.sha256}\n`;
    previousPath = entry.relativePath;
  }
  const treeDigest = sha256(canonicalManifest);
  if (treeDigest !== inspection.treeDigest) {
    throw new Error('Folder captured migration manifest does not match inspected tree digest');
  }
  if (treeDigest !== REVIEWED_MIGRATION_TREE_SHA256) {
    throw new Error(
      'Folder migration corpus is not the byte-exact reviewed tree: '
      + `${treeDigest} !== ${REVIEWED_MIGRATION_TREE_SHA256}`,
    );
  }
  return { entries, treeDigest };
}

export function replaceByteExactFragmentOnce(source, fragment, replacement, label) {
  if (!fragment) throw new Error(`Reviewed ${label} fragment must not be empty`);
  const firstIndex = source.indexOf(fragment);
  const secondIndex = firstIndex < 0
    ? -1
    : source.indexOf(fragment, firstIndex + fragment.length);
  if (firstIndex < 0 || secondIndex >= 0) {
    throw new Error(`Reviewed ${label} fragment must occur exactly once`);
  }
  return source.slice(0, firstIndex) + replacement + source.slice(firstIndex + fragment.length);
}

export async function prepareFolderMigrationBundle({
  migrationsRoot = DEFAULT_MIGRATIONS_ROOT,
  schemaPath = DEFAULT_SCHEMA_PATH,
  temporaryParent = tmpdir(),
  inspection,
} = {}) {
  const sourceSchemaPath = schemaPath instanceof URL ? fileURLToPath(schemaPath) : schemaPath;
  const inspected = inspection ?? await inspectFolderMigrationCorpus(migrationsRoot);
  const corpus = validatedFolderMigrationInspection(inspected);

  const temporaryRoot = await mkdtemp(join(temporaryParent, 'agentwiki-folder-migrations-'));
  try {
    const bundleMigrationsRoot = join(temporaryRoot, 'migrations');
    await mkdir(bundleMigrationsRoot);
    await writeFile(join(temporaryRoot, 'schema.prisma'), await readFile(sourceSchemaPath));
    const replacedPaths = new Set();
    for (const entry of corpus.entries) {
      let output = entry.content;
      const reviewedFragment = REVIEWED_GLOBAL_FRAGMENTS.find(
        (candidate) => candidate.relativePath === entry.relativePath,
      );
      if (reviewedFragment) {
        if (entry.sha256 !== reviewedFragment.sourceSha256) {
          throw new Error(`Reviewed global-fragment source hash drifted: ${entry.relativePath}`);
        }
        output = Buffer.from(replaceByteExactFragmentOnce(
          entry.content.toString('utf8'),
          reviewedFragment.fragment,
          reviewedFragment.replacement,
          reviewedFragment.label,
        ), 'utf8');
        replacedPaths.add(entry.relativePath);
      }
      const destination = join(bundleMigrationsRoot, entry.relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, output);
    }
    if (replacedPaths.size !== REVIEWED_GLOBAL_FRAGMENTS.length) {
      throw new Error('Folder sanitized migration bundle did not replace every reviewed global fragment');
    }
    return {
      temporaryRoot,
      schemaPath: join(temporaryRoot, 'schema.prisma'),
      treeDigest: corpus.treeDigest,
      cleanup: () => rm(temporaryRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function withFolderMigrationBundle(options, callback) {
  let prepared;
  try {
    prepared = await prepareFolderMigrationBundle(options);
    return await callback(prepared);
  } finally {
    if (prepared) await prepared.cleanup();
  }
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
  return vector[0];
}

function topLevelPgDumpDirectiveIndexes(lines) {
  const indexes = [];
  let dollarTag;
  let singleQuoted = false;
  let doubleQuoted = false;
  let blockCommentDepth = 0;
  for (const [lineIndex, line] of lines.entries()) {
    if (
      !dollarTag
      && !singleQuoted
      && !doubleQuoted
      && blockCommentDepth === 0
      && /^\\(?:un)?restrict(?:\s|$)/u.test(line)
    ) {
      indexes.push(lineIndex);
    }
    for (let index = 0; index < line.length;) {
      if (dollarTag) {
        const closingIndex = line.indexOf(dollarTag, index);
        if (closingIndex < 0) break;
        index = closingIndex + dollarTag.length;
        dollarTag = undefined;
        continue;
      }
      if (singleQuoted) {
        if (line[index] === "'") {
          if (line[index + 1] === "'") {
            index += 2;
            continue;
          }
          singleQuoted = false;
        }
        index += 1;
        continue;
      }
      if (doubleQuoted) {
        if (line[index] === '"') {
          if (line[index + 1] === '"') {
            index += 2;
            continue;
          }
          doubleQuoted = false;
        }
        index += 1;
        continue;
      }
      if (blockCommentDepth > 0) {
        if (line.startsWith('/*', index)) {
          blockCommentDepth += 1;
          index += 2;
        } else if (line.startsWith('*/', index)) {
          blockCommentDepth -= 1;
          index += 2;
        } else {
          index += 1;
        }
        continue;
      }
      if (line.startsWith('--', index)) break;
      if (line.startsWith('/*', index)) {
        blockCommentDepth = 1;
        index += 2;
        continue;
      }
      if (line[index] === "'") {
        singleQuoted = true;
        index += 1;
        continue;
      }
      if (line[index] === '"') {
        doubleQuoted = true;
        index += 1;
        continue;
      }
      if (line[index] === '$') {
        const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(line.slice(index))?.[0];
        if (tag) {
          dollarTag = tag;
          index += tag.length;
          continue;
        }
      }
      index += 1;
    }
  }
  return indexes;
}

export function normalizeFolderPublicSchemaDump(dump) {
  const normalized = dump.replaceAll('\r\n', '\n');
  const lines = normalized.split('\n');
  const restrictIndex = 4;
  let lastContentIndex = lines.length - 1;
  while (lastContentIndex >= 0 && lines[lastContentIndex] === '') lastContentIndex -= 1;
  const expectedHeader = ['--', '-- PostgreSQL database dump', '--', ''];
  const expectedFooter = ['--', '-- PostgreSQL database dump complete', '--', ''];
  const footerStart = lastContentIndex - expectedFooter.length;
  const restrict = /^\\restrict ([^\s]+)$/u.exec(lines[restrictIndex] ?? '');
  const unrestrict = /^\\unrestrict ([^\s]+)$/u.exec(lines[lastContentIndex] ?? '');
  const headerMatches = expectedHeader.every((line, index) => lines[index] === line);
  const footerMatches = expectedFooter.every(
    (line, index) => lines[footerStart + index] === line,
  );
  const directiveIndexes = topLevelPgDumpDirectiveIndexes(lines);
  if (
    !headerMatches
    || !footerMatches
    || !restrict
    || !unrestrict
    || directiveIndexes.length !== 2
    || directiveIndexes[0] !== restrictIndex
    || directiveIndexes[1] !== lastContentIndex
  ) {
    throw new Error('Folder public schema dump must contain exactly one outer pg_dump directive pair');
  }
  if (restrict[1] !== unrestrict[1]) {
    throw new Error('Folder public schema dump must contain a matching outer pg_dump directive pair');
  }
  return lines
    .filter((_, index) => index !== restrictIndex && index !== lastContentIndex)
    .join('\n');
}

async function assertFolderDatabaseIdentity(prisma, databaseUrl) {
  const parsed = validateFolderTestDatabaseUrl(databaseUrl);
  parsed.searchParams.delete('schema');
  const identityRows = await prisma.$queryRaw`
    SELECT current_database() AS "databaseName",
           current_user AS "currentUser",
           COALESCE(host(inet_server_addr()), '') AS "serverAddress",
           inet_server_port()::int AS "serverPort"
  `;
  const identity = identityRows[0];
  const expectedDatabase = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  const expectedUser = decodeURIComponent(parsed.username);
  const expectedPort = Number(parsed.port || '5432');
  const expectedLiteralAddress = /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(parsed.hostname)
    ? parsed.hostname
    : undefined;
  if (
    !identity
    || identity.databaseName !== expectedDatabase
    || (expectedUser && identity.currentUser !== expectedUser)
    || identity.serverPort !== expectedPort
    || (expectedLiteralAddress && identity.serverAddress !== expectedLiteralAddress)
  ) {
    throw new Error('Folder pg_dump target does not match the explicit test database URL');
  }
  return { administrativeUrl: parsed.toString(), identity };
}

function dumpPublicSchema(databaseUrl) {
  const dump = spawnSync(
    'pg_dump',
    ['--dbname', databaseUrl, '--schema-only', '--schema=public', '--no-password'],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, PGAPPNAME: 'agentwiki-folder-structural-inventory' },
    },
  );
  if (dump.error || dump.status !== 0) {
    throw new Error(
      ['Folder public schema pg_dump failed', dump.error?.message, dump.stdout, dump.stderr]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return normalizeFolderPublicSchemaDump(dump.stdout);
}

export async function captureFolderVectorExtensionCatalog(prisma) {
  const [directObjects, accessMethodOperators, accessMethodProcedures, aggregates] = await Promise.all([
    prisma.$queryRaw`
      WITH extension_objects AS (
        SELECT dependency.classid, dependency.objid
        FROM pg_depend dependency
        JOIN pg_extension extension ON extension.oid = dependency.refobjid
        WHERE dependency.refclassid = 'pg_extension'::regclass
          AND dependency.deptype = 'e'
          AND extension.extname = 'vector'
      )
      SELECT captured."className",
             captured."objectOid",
             captured."objectIdentity",
             captured."catalogRow",
             captured.definition
      FROM (
        SELECT 'pg_am' AS "className",
               catalog.oid::text AS "objectOid",
               identified.identity AS "objectIdentity",
               to_jsonb(catalog) AS "catalogRow",
               '' AS definition
        FROM extension_objects owned
        JOIN pg_am catalog ON catalog.oid = owned.objid
        CROSS JOIN LATERAL pg_identify_object(owned.classid, owned.objid, 0) identified
        WHERE owned.classid = 'pg_am'::regclass
        UNION ALL
        SELECT 'pg_cast', catalog.oid::text, identified.identity, to_jsonb(catalog), ''
        FROM extension_objects owned
        JOIN pg_cast catalog ON catalog.oid = owned.objid
        CROSS JOIN LATERAL pg_identify_object(owned.classid, owned.objid, 0) identified
        WHERE owned.classid = 'pg_cast'::regclass
        UNION ALL
        SELECT 'pg_opclass', catalog.oid::text, identified.identity, to_jsonb(catalog), ''
        FROM extension_objects owned
        JOIN pg_opclass catalog ON catalog.oid = owned.objid
        CROSS JOIN LATERAL pg_identify_object(owned.classid, owned.objid, 0) identified
        WHERE owned.classid = 'pg_opclass'::regclass
        UNION ALL
        SELECT 'pg_operator', catalog.oid::text, identified.identity, to_jsonb(catalog), ''
        FROM extension_objects owned
        JOIN pg_operator catalog ON catalog.oid = owned.objid
        CROSS JOIN LATERAL pg_identify_object(owned.classid, owned.objid, 0) identified
        WHERE owned.classid = 'pg_operator'::regclass
        UNION ALL
        SELECT 'pg_opfamily', catalog.oid::text, identified.identity, to_jsonb(catalog), ''
        FROM extension_objects owned
        JOIN pg_opfamily catalog ON catalog.oid = owned.objid
        CROSS JOIN LATERAL pg_identify_object(owned.classid, owned.objid, 0) identified
        WHERE owned.classid = 'pg_opfamily'::regclass
        UNION ALL
        SELECT 'pg_proc', catalog.oid::text, identified.identity, to_jsonb(catalog),
               CASE WHEN catalog.prokind = 'a' THEN '' ELSE pg_get_functiondef(catalog.oid) END
        FROM extension_objects owned
        JOIN pg_proc catalog ON catalog.oid = owned.objid
        CROSS JOIN LATERAL pg_identify_object(owned.classid, owned.objid, 0) identified
        WHERE owned.classid = 'pg_proc'::regclass
        UNION ALL
        SELECT 'pg_type', catalog.oid::text, identified.identity, to_jsonb(catalog), ''
        FROM extension_objects owned
        JOIN pg_type catalog ON catalog.oid = owned.objid
        CROSS JOIN LATERAL pg_identify_object(owned.classid, owned.objid, 0) identified
        WHERE owned.classid = 'pg_type'::regclass
      ) captured
      ORDER BY captured."className", captured."objectIdentity", captured."objectOid"
    `,
    prisma.$queryRaw`
      WITH owned_families AS (
        SELECT dependency.objid
        FROM pg_depend dependency
        JOIN pg_extension extension ON extension.oid = dependency.refobjid
        WHERE dependency.refclassid = 'pg_extension'::regclass
          AND dependency.deptype = 'e'
          AND dependency.classid = 'pg_opfamily'::regclass
          AND extension.extname = 'vector'
      )
      SELECT family.oid::text AS "familyOid",
             identified.identity AS "familyIdentity",
             am_operator.oid::text AS "operatorOid",
             to_jsonb(am_operator) AS "catalogRow"
      FROM owned_families owned
      JOIN pg_opfamily family ON family.oid = owned.objid
      JOIN pg_amop am_operator ON am_operator.amopfamily = family.oid
      CROSS JOIN LATERAL pg_identify_object('pg_opfamily'::regclass, family.oid, 0) identified
      ORDER BY identified.identity,
               am_operator.amopstrategy,
               am_operator.amoplefttype,
               am_operator.amoprighttype,
               am_operator.oid
    `,
    prisma.$queryRaw`
      WITH owned_families AS (
        SELECT dependency.objid
        FROM pg_depend dependency
        JOIN pg_extension extension ON extension.oid = dependency.refobjid
        WHERE dependency.refclassid = 'pg_extension'::regclass
          AND dependency.deptype = 'e'
          AND dependency.classid = 'pg_opfamily'::regclass
          AND extension.extname = 'vector'
      )
      SELECT family.oid::text AS "familyOid",
             identified.identity AS "familyIdentity",
             am_procedure.oid::text AS "procedureOid",
             to_jsonb(am_procedure) AS "catalogRow"
      FROM owned_families owned
      JOIN pg_opfamily family ON family.oid = owned.objid
      JOIN pg_amproc am_procedure ON am_procedure.amprocfamily = family.oid
      CROSS JOIN LATERAL pg_identify_object('pg_opfamily'::regclass, family.oid, 0) identified
      ORDER BY identified.identity,
               am_procedure.amprocnum,
               am_procedure.amproclefttype,
               am_procedure.amprocrighttype,
               am_procedure.oid
    `,
    prisma.$queryRaw`
      WITH owned_procedures AS (
        SELECT dependency.objid
        FROM pg_depend dependency
        JOIN pg_extension extension ON extension.oid = dependency.refobjid
        WHERE dependency.refclassid = 'pg_extension'::regclass
          AND dependency.deptype = 'e'
          AND dependency.classid = 'pg_proc'::regclass
          AND extension.extname = 'vector'
      )
      SELECT procedure.oid::text AS "procedureOid",
             identified.identity AS "procedureIdentity",
             to_jsonb(aggregate) AS "catalogRow"
      FROM owned_procedures owned
      JOIN pg_proc procedure ON procedure.oid = owned.objid
      JOIN pg_aggregate aggregate ON aggregate.aggfnoid = procedure.oid
      CROSS JOIN LATERAL pg_identify_object('pg_proc'::regclass, procedure.oid, 0) identified
      ORDER BY identified.identity, procedure.oid
    `,
  ]);
  const directObjectCounts = Object.fromEntries(
    [...new Set(directObjects.map((object) => object.className))]
      .sort(compareByteStrings)
      .map((className) => [
        className,
        directObjects.filter((object) => object.className === className).length,
      ]),
  );
  return {
    directObjectCounts,
    directObjects,
    accessMethodOperators,
    accessMethodProcedures,
    aggregates,
  };
}

export async function captureFolderDatabaseSafetyInventory(databaseUrl, prisma) {
  const { administrativeUrl, identity } = await assertFolderDatabaseIdentity(prisma, databaseUrl);
  const [
    extensions,
    publicSchema,
    databaseMetadata,
    databaseSettings,
    vectorExtensionCatalog,
  ] = await Promise.all([
    prisma.$queryRaw`
      SELECT e.extname AS name,
             n.nspname AS schema,
             pg_get_userbyid(e.extowner) AS owner,
             e.extversion AS version,
             e.extrelocatable AS relocatable,
             COALESCE(e.extconfig::text, '') AS config,
             COALESCE(e.extcondition::text, '') AS condition
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      ORDER BY e.extname
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
      SELECT database.datname AS name,
             pg_get_userbyid(database.datdba) AS owner,
             COALESCE(database.datacl::text, '') AS acl,
             current_user AS "currentUser",
             current_setting('hnsw.ef_search', true) AS "effectiveHnswEfSearch"
      FROM pg_database database
      WHERE database.datname = current_database()
    `,
    prisma.$queryRaw`
      WITH target_database AS (
        SELECT oid, datname
        FROM pg_database
        WHERE datname = current_database()
      ), active_role AS (
        SELECT oid FROM pg_roles WHERE rolname = current_user
      )
      SELECT CASE WHEN configured.setdatabase = 0 THEN '*' ELSE target_database.datname END AS scope,
             COALESCE(role.rolname, '*') AS role,
             configured_setting.setting AS setting
      FROM target_database
      JOIN pg_db_role_setting configured
        ON configured.setdatabase = target_database.oid
        OR (
          configured.setdatabase = 0
          AND configured.setrole = (SELECT oid FROM active_role)
        )
      LEFT JOIN pg_roles role ON role.oid = configured.setrole
      CROSS JOIN LATERAL unnest(configured.setconfig) AS configured_setting(setting)
      ORDER BY scope, role, configured_setting.setting
    `,
    captureFolderVectorExtensionCatalog(prisma),
  ]);
  return {
    databaseIdentity: identity,
    databaseMetadata,
    databaseSettings,
    extensions,
    publicSchema,
    publicSchemaDump: dumpPublicSchema(administrativeUrl),
    vectorExtensionCatalog,
  };
}

export function folderDatabaseSafetyInventoryDigest(inventory) {
  return sha256(JSON.stringify(inventory));
}

function assertSafetyInventoryUnchanged(before, after, boundary) {
  if (!isDeepStrictEqual(after, before)) {
    throw new Error(
      `Folder database ${boundary} changed protected structural inventory `
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
  return withFolderMigrationBundle({}, async (preparedMigrations) => {
    const schemaName = `folder_test_${randomUUID().replaceAll('-', '')}`;
    const schemaSql = quoteIdentifier(schemaName);
    const testUrl = new URL(administrativeUrl);
    testUrl.searchParams.set('schema', schemaName);
    const databaseUrl = testUrl.toString();
    let prisma;
    let created = false;
    let safetyInventory;
    let callbackStarted = false;
    try {
      prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl } } });
      await assertFolderDatabaseSafetyPreflight(prisma);
      safetyInventory = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
      await prisma.$executeRawUnsafe(`CREATE SCHEMA ${schemaSql}`);
      created = true;
      const migration = spawnPnpmSync(
        [
          '--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy',
          '--schema', preparedMigrations.schemaPath,
        ],
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
      const postMigrationInventory = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
      assertSafetyInventoryUnchanged(safetyInventory, postMigrationInventory, 'migration');
      callbackStarted = true;
      return await callback({
        databaseUrl,
        schemaName,
        migrationTreeDigest: preparedMigrations.treeDigest,
        publicInventoryDigest: folderDatabaseSafetyInventoryDigest(safetyInventory),
      });
    } finally {
      let safetyError;
      try {
        if (prisma && safetyInventory && callbackStarted) {
          try {
            const postCallbackInventory = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
            assertSafetyInventoryUnchanged(safetyInventory, postCallbackInventory, 'callback');
          } catch (error) {
            safetyError = error;
          }
        }
        if (prisma && created) {
          try {
            await prisma.$executeRawUnsafe(`DROP SCHEMA ${schemaSql} CASCADE`);
          } catch (error) {
            safetyError ??= error;
          }
        }
      } finally {
        if (prisma) await prisma.$disconnect();
      }
      if (safetyError) throw safetyError;
    }
  });
}
