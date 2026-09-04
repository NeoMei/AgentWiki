import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import test, { before } from 'node:test';
import * as folderDatabaseSafety from './folder-test-database.mjs';
import * as testDatabaseLifecycle from './test-database-lifecycle.mjs';
import {
  assertFolderDatabaseSafetyPreflight,
  captureFolderDatabaseSafetyInventory,
  folderDatabaseSafetyInventoryDigest,
  validateFolderTestDatabaseUrl,
  withFolderTestDatabase,
} from './folder-test-database.mjs';
import { runBlockingLockProbe } from './content-tree-lock-probe.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { ContentTreeService } = requireFromServer('./dist/content-tree/content-tree.service.js');
const { ReadableSyncPathService } = requireFromServer('./dist/core/sync/readable-sync-path.service.js');
const { SpaceRevisionWriterService } = requireFromServer('./dist/core/sync/space-revision-writer.service.js');
const baseDatabaseUrl = process.env.FOLDER_TEST_DATABASE_URL;
let publicInventoryBefore;
const REVIEWED_MIGRATION_TREE_SHA256 = 'a9df765539a99252a6547a83a80549fcce2d109d395e4b7a595cf6bb07a622bc';

const folderPgDumpFixture = (token, body) => `--\n-- PostgreSQL database dump\n--\n\n\\restrict ${token}\n\n${body}\n\n--\n-- PostgreSQL database dump complete\n--\n\n\\unrestrict ${token}\n\n`;

const administrativeUrl = (value) => {
  const parsed = validateFolderTestDatabaseUrl(value);
  parsed.searchParams.delete('schema');
  return parsed.toString();
};

const folderTestSchemaCount = async (value) => {
  const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl(value) } } });
  try {
    const schemas = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM pg_namespace
      WHERE nspname LIKE 'folder\_test\_%' ESCAPE '\'
    `;
    return schemas[0].count;
  } finally {
    await prisma.$disconnect();
  }
};

before(async () => {
  if (!baseDatabaseUrl) return;
  const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl(baseDatabaseUrl) } } });
  try {
    publicInventoryBefore = await captureFolderDatabaseSafetyInventory(
      administrativeUrl(baseDatabaseUrl),
      prisma,
    );
  } finally {
    await prisma.$disconnect();
  }
});

test('Folder migration safety boundary rejects unknown and byte-modified migration corpora', async () => {
  assert.equal(typeof folderDatabaseSafety.prepareFolderMigrationBundle, 'function');
  const sourceRoot = new URL('../apps/server/prisma/migrations/', import.meta.url);
  const reviewed = await folderDatabaseSafety.inspectFolderMigrationCorpus(sourceRoot);
  assert.equal(reviewed.treeDigest, REVIEWED_MIGRATION_TREE_SHA256);

  const fixtureParent = await mkdtemp(join(tmpdir(), 'agentwiki-folder-corpus-red-'));
  const fixtureRoot = join(fixtureParent, 'migrations');
  const bundleParent = join(fixtureParent, 'bundles');
  await cp(sourceRoot, fixtureRoot, { recursive: true });
  await mkdir(bundleParent);
  try {
    await writeFile(join(fixtureRoot, 'unknown.sql'), 'SELECT 1;\n', 'utf8');
    await assert.rejects(
      folderDatabaseSafety.prepareFolderMigrationBundle({
        migrationsRoot: fixtureRoot,
        temporaryParent: bundleParent,
      }),
      /migration corpus is not the byte-exact reviewed tree/iu,
    );
    assert.deepEqual(await readdir(bundleParent), []);

    await rm(join(fixtureRoot, 'unknown.sql'));
    const changedMigration = join(fixtureRoot, '20260828120000_expand_space_folders', 'migration.sql');
    const original = await readFile(changedMigration, 'utf8');
    await writeFile(changedMigration, `${original}\n`, 'utf8');
    await assert.rejects(
      folderDatabaseSafety.prepareFolderMigrationBundle({
        migrationsRoot: fixtureRoot,
        temporaryParent: bundleParent,
      }),
      /migration corpus is not the byte-exact reviewed tree/iu,
    );
    assert.deepEqual(await readdir(bundleParent), []);
  } finally {
    await rm(fixtureParent, { recursive: true, force: true });
  }
});

test('Folder sanitized bundle removes each reviewed global fragment exactly once and cleans itself', async () => {
  assert.throws(
    () => folderDatabaseSafety.replaceByteExactFragmentOnce(
      'unchanged', 'global DDL', '-- skipped', 'global DDL',
    ),
    /must occur exactly once/iu,
  );
  assert.throws(
    () => folderDatabaseSafety.replaceByteExactFragmentOnce(
      'global DDL; global DDL', 'global DDL', '-- skipped', 'global DDL',
    ),
    /must occur exactly once/iu,
  );

  const prepared = await folderDatabaseSafety.prepareFolderMigrationBundle();
  const temporaryRoot = prepared.temporaryRoot;
  try {
    assert.equal(prepared.treeDigest, REVIEWED_MIGRATION_TREE_SHA256);
    const vectorMigration = await readFile(join(
      temporaryRoot,
      'migrations/20260821120000_pgvector_semantic_search/migration.sql',
    ), 'utf8');
    const hnswMigration = await readFile(join(
      temporaryRoot,
      'migrations/20260821130000_tune_hnsw_recall/migration.sql',
    ), 'utf8');
    assert.doesNotMatch(vectorMigration, /CREATE EXTENSION/iu);
    assert.match(vectorMigration, /public\.halfvec\(2048\)/u);
    assert.doesNotMatch(hnswMigration, /ALTER DATABASE/iu);
    assert.match(hnswMigration, /Page_embeddingVector_hnsw/u);
  } finally {
    await prepared.cleanup();
  }
  await assert.rejects(readFile(join(temporaryRoot, 'schema.prisma')), { code: 'ENOENT' });
});

test('Folder sanitized bundle uses only migration bytes captured by corpus inspection', async () => {
  const sourceRoot = new URL('../apps/server/prisma/migrations/', import.meta.url);
  const fixtureParent = await mkdtemp(join(tmpdir(), 'agentwiki-folder-captured-corpus-red-'));
  const fixtureRoot = join(fixtureParent, 'migrations');
  const bundleParent = join(fixtureParent, 'bundles');
  await cp(sourceRoot, fixtureRoot, { recursive: true });
  await mkdir(bundleParent);
  let prepared;
  try {
    const inspected = await folderDatabaseSafety.inspectFolderMigrationCorpus(fixtureRoot);
    const relativePath = '20260828120000_expand_space_folders/migration.sql';
    const capturedEntry = inspected.entries.find((entry) => entry.relativePath === relativePath);
    assert.equal(typeof capturedEntry?.contentBase64, 'string');
    const capturedBytes = Buffer.from(capturedEntry.contentBase64, 'base64');
    await writeFile(
      join(fixtureRoot, relativePath),
      Buffer.concat([capturedBytes, Buffer.from('\n-- post-inspection source mutation\n')]),
    );

    prepared = await folderDatabaseSafety.prepareFolderMigrationBundle({
      inspection: inspected,
      temporaryParent: bundleParent,
    });
    const bundledBytes = await readFile(join(prepared.temporaryRoot, 'migrations', relativePath));
    assert.deepEqual(bundledBytes, capturedBytes);
  } finally {
    await prepared?.cleanup();
    await rm(fixtureParent, { recursive: true, force: true });
  }
});

test('Folder sanitized bundle rejects captured migration bytes that do not match their inspected hash', async () => {
  const sourceRoot = new URL('../apps/server/prisma/migrations/', import.meta.url);
  const inspected = await folderDatabaseSafety.inspectFolderMigrationCorpus(sourceRoot);
  const entries = await Promise.all(inspected.entries.map(async (entry) => ({
    ...entry,
    contentBase64: (await readFile(new URL(entry.relativePath, sourceRoot))).toString('base64'),
  })));
  entries[0] = {
    ...entries[0],
    contentBase64: Buffer.concat([
      Buffer.from(entries[0].contentBase64, 'base64'),
      Buffer.from('tampered-after-review'),
    ]).toString('base64'),
  };
  const fixtureParent = await mkdtemp(join(tmpdir(), 'agentwiki-folder-captured-hash-red-'));
  let prepared;
  let error;
  try {
    try {
      prepared = await folderDatabaseSafety.prepareFolderMigrationBundle({
        inspection: { ...inspected, entries },
        temporaryParent: fixtureParent,
      });
    } catch (caught) {
      error = caught;
    }
    assert.match(error?.message ?? '', /captured migration bytes do not match inspected hash/iu);
  } finally {
    await prepared?.cleanup();
    await rm(fixtureParent, { recursive: true, force: true });
  }
});

test('Folder sanitized bundle ownership removes the bundle after an asynchronous setup failure', async () => {
  assert.equal(typeof folderDatabaseSafety.withFolderMigrationBundle, 'function');
  const fixtureParent = await mkdtemp(join(tmpdir(), 'agentwiki-folder-bundle-owner-red-'));
  const bundleParent = join(fixtureParent, 'bundles');
  await mkdir(bundleParent);
  let acquiredRoot;
  try {
    await assert.rejects(
      folderDatabaseSafety.withFolderMigrationBundle(
        { temporaryParent: bundleParent },
        async (prepared) => {
          acquiredRoot = prepared.temporaryRoot;
          await Promise.resolve();
          throw new Error('injected post-acquisition setup failure');
        },
      ),
      /injected post-acquisition setup failure/iu,
    );
    assert.deepEqual(await readdir(bundleParent), []);
    await assert.rejects(readFile(join(acquiredRoot, 'schema.prisma')), { code: 'ENOENT' });
  } finally {
    await rm(fixtureParent, { recursive: true, force: true });
  }
});

test('Folder sanitized bundle ownership preserves a primary failure when cleanup also fails', async () => {
  const primary = new Error('injected bundle callback failure');
  const cleanup = new Error('injected bundle cleanup failure');
  let caught;
  try {
    await folderDatabaseSafety.withFolderMigrationBundle(
      {},
      async () => {
        throw primary;
      },
      {
        prepareMigrationBundle: async () => ({
          cleanup: async () => {
            throw cleanup;
          },
        }),
      },
    );
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, primary);
  assert.ok(caught.cause instanceof AggregateError);
  assert.deepEqual(caught.cause.errors, [cleanup]);
});

test('shared database lifecycle preserves the primary error and aggregates every cleanup failure', async () => {
  assert.equal(typeof testDatabaseLifecycle.withTestDatabaseCleanup, 'function');
  const primary = new Error('injected database operation failure');
  const cleanupFailures = [
    new Error('injected inventory failure'),
    new Error('injected schema drop failure'),
    new Error('injected disconnect failure'),
  ];
  const calls = [];
  let caught;
  try {
    await testDatabaseLifecycle.withTestDatabaseCleanup(
      'Injected database harness',
      async () => {
        throw primary;
      },
      cleanupFailures.map((failure, index) => async () => {
        calls.push(index);
        throw failure;
      }),
    );
  } catch (error) {
    caught = error;
  }

  assert.equal(caught, primary);
  assert.deepEqual(calls, [0, 1, 2]);
  assert.ok(caught.cause instanceof AggregateError);
  assert.deepEqual(caught.cause.errors, cleanupFailures);
});

test('folder, collaboration, and pgvector wrappers use the shared cleanup lifecycle', async () => {
  for (const file of [
    'folder-test-database.mjs',
    'collaboration-test-database.mjs',
    'pgvector-test-database.mjs',
  ]) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /import\s+\{[^}]*\bwithTestDatabaseCleanup\b[^}]*\}\s+from\s+'\.\/test-database-lifecycle\.mjs'/su, file);
    assert.match(source, /return withTestDatabaseCleanup\(/u, file);
  }
});

test('Folder structural inventory distinguishes same-name public objects with different definitions', () => {
  const beforeDump = folderPgDumpFixture('random-before', `CREATE TABLE public.same_name (
    value integer NOT NULL
);`);
  const sameStructureDifferentToken = beforeDump.replaceAll('random-before', 'random-after');
  const changedStructure = sameStructureDifferentToken.replace('value integer', 'value bigint');
  const before = { publicSchemaDump: folderDatabaseSafety.normalizeFolderPublicSchemaDump(beforeDump) };
  const same = {
    publicSchemaDump: folderDatabaseSafety.normalizeFolderPublicSchemaDump(sameStructureDifferentToken),
  };
  const changed = {
    publicSchemaDump: folderDatabaseSafety.normalizeFolderPublicSchemaDump(changedStructure),
  };
  assert.equal(folderDatabaseSafetyInventoryDigest(same), folderDatabaseSafetyInventoryDigest(before));
  assert.notEqual(folderDatabaseSafetyInventoryDigest(changed), folderDatabaseSafetyInventoryDigest(before));
});

test('Folder structural inventory preserves dollar-quoted body directives while normalizing the outer pair', () => {
  const beforeDump = folderPgDumpFixture('random-before', String.raw`CREATE FUNCTION public.material_body() RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $function$
SELECT $body$
\restrict material-body-line
$body$;
$function$;`);
  const sameStructureDifferentOuterToken = beforeDump.replaceAll('random-before', 'random-after');
  const changedFunctionBody = sameStructureDifferentOuterToken.replace(
    'material-body-line',
    'material-body-changed',
  );
  const before = {
    publicSchemaDump: folderDatabaseSafety.normalizeFolderPublicSchemaDump(beforeDump),
  };
  const same = {
    publicSchemaDump: folderDatabaseSafety.normalizeFolderPublicSchemaDump(
      sameStructureDifferentOuterToken,
    ),
  };
  const changed = {
    publicSchemaDump: folderDatabaseSafety.normalizeFolderPublicSchemaDump(changedFunctionBody),
  };
  assert.match(before.publicSchemaDump, /^\\restrict material-body-line$/mu);
  assert.equal(folderDatabaseSafetyInventoryDigest(same), folderDatabaseSafetyInventoryDigest(before));
  assert.notEqual(folderDatabaseSafetyInventoryDigest(changed), folderDatabaseSafetyInventoryDigest(before));
});

test('Folder structural inventory rejects malformed or multiple outer pg_dump directives', () => {
  const valid = folderPgDumpFixture('reviewed-token', 'SELECT 1;');
  assert.throws(
    () => folderDatabaseSafety.normalizeFolderPublicSchemaDump(
      valid.replace('\\unrestrict reviewed-token', '\\unrestrict wrong-token'),
    ),
    /matching outer.*directive pair/iu,
  );
  assert.throws(
    () => folderDatabaseSafety.normalizeFolderPublicSchemaDump(
      valid.replace('\\restrict reviewed-token\n', '\\restrict reviewed-token\n\\restrict extra-token\n'),
    ),
    /exactly one outer.*directive pair/iu,
  );
  assert.throws(
    () => folderDatabaseSafety.normalizeFolderPublicSchemaDump('SELECT 1;\n'),
    /outer.*directive pair/iu,
  );
});

test('Folder structural inventory requires an explicit compatible pg_dump without password argv', () => {
  assert.equal(typeof folderDatabaseSafety.dumpFolderPublicSchema, 'function');
  const databaseUrl = 'postgresql://folder_user:super-secret@127.0.0.1:55432/agentwiki_test';
  assert.throws(
    () => folderDatabaseSafety.dumpFolderPublicSchema(databaseUrl, '160015', {
      environment: {},
      spawnSync: () => assert.fail('pg_dump must not start without PG_DUMP_BIN'),
    }),
    /PG_DUMP_BIN is required/iu,
  );

  const calls = [];
  const dump = folderDatabaseSafety.dumpFolderPublicSchema(databaseUrl, '160015', {
    environment: { PG_DUMP_BIN: '/opt/test/postgresql@16/bin/pg_dump' },
    spawnSync: (executable, args, options) => {
      calls.push({ executable, args, options });
      return args[0] === '--version'
        ? { status: 0, stdout: 'pg_dump (PostgreSQL) 16.14\n', stderr: '' }
        : { status: 0, stdout: folderPgDumpFixture('credential-safe', 'SELECT 1;'), stderr: '' };
    },
  });
  assert.match(dump, /SELECT 1;/u);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ executable }) => executable === '/opt/test/postgresql@16/bin/pg_dump'));
  assert.ok(calls.every(({ options }) => options.timeout > 0 && options.timeout <= 30_000));
  assert.doesNotMatch(JSON.stringify(calls.map(({ args }) => args)), /super-secret/u);
  assert.equal(calls[1].options.env.PGPASSWORD, 'super-secret');
  assert.match(calls[1].args.join(' '), /agentwiki_test/u);

  assert.throws(
    () => folderDatabaseSafety.dumpFolderPublicSchema(databaseUrl, '170002', {
      environment: { PG_DUMP_BIN: '/opt/test/postgresql@16/bin/pg_dump' },
      spawnSync: () => ({
        status: 0,
        stdout: 'pg_dump (PostgreSQL) 16.14\n',
        stderr: '',
      }),
    }),
    /pg_dump major 16 is incompatible with PostgreSQL server major 17/iu,
  );
});

test('Folder structural inventory vector catalog digest changes with implementation details', async () => {
  assert.equal(typeof folderDatabaseSafety.captureFolderVectorExtensionCatalog, 'function');
  const queryResults = [
    [
      {
        className: 'pg_proc',
        objectIdentity: 'public.vector_norm(vector)',
        catalogRow: { proname: 'vector_norm', proconfig: ['search_path=public'], prosrc: 'return 1' },
        definition: 'CREATE FUNCTION public.vector_norm(vector) RETURNS double precision ...',
      },
      {
        className: 'pg_opfamily',
        objectIdentity: 'public.vector_l2_ops USING hnsw',
        catalogRow: { opfname: 'vector_l2_ops', opfmethod: 42 },
        definition: '',
      },
    ],
    [
      {
        familyIdentity: 'public.vector_l2_ops USING hnsw',
        operatorOid: 101,
        catalogRow: { amopstrategy: 1, amopopr: 101 },
      },
    ],
    [
      { familyIdentity: 'public.vector_l2_ops USING hnsw', procedureNumber: 1, procedureOid: 201 },
    ],
    [],
  ];
  const catalog = await folderDatabaseSafety.captureFolderVectorExtensionCatalog({
    $queryRaw: async () => queryResults.shift(),
  });
  assert.deepEqual(catalog.directObjectCounts, { pg_opfamily: 1, pg_proc: 1 });
  const changedBody = structuredClone(catalog);
  changedBody.directObjects[0].catalogRow.prosrc = 'return 2';
  const changedOperatorGraph = structuredClone(catalog);
  changedOperatorGraph.accessMethodOperators[0].catalogRow.amopstrategy = 2;
  const digest = folderDatabaseSafetyInventoryDigest({ vectorExtensionCatalog: catalog });
  assert.notEqual(
    folderDatabaseSafetyInventoryDigest({ vectorExtensionCatalog: changedBody }),
    digest,
  );
  assert.notEqual(
    folderDatabaseSafetyInventoryDigest({ vectorExtensionCatalog: changedOperatorGraph }),
    digest,
  );
});

test('Folder database preflight requires only the preinstalled public vector extension', async () => {
  await assert.rejects(
    assertFolderDatabaseSafetyPreflight({ $queryRaw: async () => [] }),
    /vector extension must be preconfigured in public/iu,
  );
  await assert.rejects(
    assertFolderDatabaseSafetyPreflight({ $queryRaw: async () => [{ name: 'vector', schema: 'private' }] }),
    /vector extension must be preconfigured in public/iu,
  );
  let queryCount = 0;
  await assert.doesNotReject(assertFolderDatabaseSafetyPreflight({
    $queryRaw: async () => {
      queryCount += 1;
      return [{ name: 'vector', schema: 'public', owner: 'neomei', version: '0.7.4' }];
    },
  }));
  assert.equal(queryCount, 1, 'sanitized migrations do not require a database-level HNSW setting');
});

test('ContentTree production advisory lock serializes create, commit, and rollback boundaries', {
  skip: baseDatabaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  await withFolderTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const writer = new SpaceRevisionWriterService(prisma);
    const service = new ContentTreeService(prisma, writer, new ReadableSyncPathService());
    const suffix = schemaName.replace('folder_test_', '');
    const userId = `user_${suffix}`;
    const concurrentSpaceId = `concurrent_${suffix}`;
    const commitSpaceId = `commit_${suffix}`;
    const rollbackSpaceId = `rollback_${suffix}`;
    const snapshotSpaceId = `snapshot_${suffix}`;
    try {
      await prisma.user.create({ data: { id: userId, email: `${userId}@content-tree.test` } });
      await prisma.space.createMany({ data: [
        { id: concurrentSpaceId, name: 'Concurrent', slug: concurrentSpaceId },
        { id: commitSpaceId, name: 'Commit lock', slug: commitSpaceId },
        { id: rollbackSpaceId, name: 'Rollback lock', slug: rollbackSpaceId },
        { id: snapshotSpaceId, name: 'Snapshot', slug: snapshotSpaceId },
      ] });

      const createInput = {
        spaceId: concurrentSpaceId,
        parentId: null,
        name: '项目',
        expectedTreeRevision: 0n,
        actor: { userId },
      };
      const concurrent = await Promise.allSettled([
        service.createFolder(createInput),
        service.createFolder(createInput),
      ]);
      assert.deepEqual(concurrent.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
      const rejected = concurrent.find((result) => result.status === 'rejected');
      assert.equal(rejected.reason.code, 'CONTENT_TREE_CONFLICT');
      assert.equal(await prisma.folder.count({ where: { spaceId: concurrentSpaceId } }), 1);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId: concurrentSpaceId } }), 1);
      assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: concurrentSpaceId } })).contentTreeRevision, 1n);
      const observedAfterCommit = await prisma.$transaction(async (tx) => {
        const locked = await writer.lockContentTreeSpace(tx, concurrentSpaceId);
        return locked?.contentTreeRevision;
      });
      assert.equal(observedAfterCommit, 1n);

      let secondCommitAcquired = false;
      const commitSettlements = await runBlockingLockProbe({
        startFirst: ({ hold, signalStarted }) => prisma.$transaction(async (tx) => {
          await writer.lockContentTreeSpace(tx, commitSpaceId);
          signalStarted();
          await hold;
        }),
        startSecond: () => prisma.$transaction(async (tx) => {
          const locked = await writer.lockContentTreeSpace(tx, commitSpaceId);
          secondCommitAcquired = true;
          return locked?.contentTreeRevision;
        }),
        assertBlocked: () => {
          assert.equal(secondCommitAcquired, false, 'second transaction bypassed the production advisory lock');
        },
        holdMs: 150,
      });
      assert.deepEqual(commitSettlements.map((result) => result.status), ['fulfilled', 'fulfilled']);
      assert.equal(commitSettlements[1].value, 0n);

      let afterRollbackAcquired = false;
      const rollbackSettlements = await runBlockingLockProbe({
        startFirst: ({ hold, signalStarted }) => prisma.$transaction(async (tx) => {
          const locked = await writer.lockContentTreeSpace(tx, rollbackSpaceId);
          assert.ok(locked);
          await tx.folder.create({ data: {
            spaceId: rollbackSpaceId,
            name: 'Rolled back',
            nameKey: 'rolled back',
            path: 'pages/Rolled back',
            pathKey: 'pages/rolled back',
          } });
          await writer.advanceContentTreeRevision(locked, rollbackSpaceId, 0n);
          await writer.advanceLocked(locked, rollbackSpaceId, [], { origin: 'web_editor', createdByUserId: userId });
          signalStarted();
          await hold;
          throw new Error('force rollback');
        }),
        startSecond: () => prisma.$transaction(async (tx) => {
          const locked = await writer.lockContentTreeSpace(tx, rollbackSpaceId);
          afterRollbackAcquired = true;
          return locked?.contentTreeRevision;
        }),
        assertBlocked: () => {
          assert.equal(afterRollbackAcquired, false, 'rollback did not retain the advisory lock until transaction end');
        },
        holdMs: 150,
      });
      assert.equal(rollbackSettlements[0].status, 'rejected');
      assert.match(rollbackSettlements[0].reason.message, /force rollback/u);
      assert.equal(rollbackSettlements[1].status, 'fulfilled');
      assert.equal(rollbackSettlements[1].value, 0n);
      assert.equal(await prisma.folder.count({ where: { spaceId: rollbackSpaceId } }), 0);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId: rollbackSpaceId } }), 0);
      assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: rollbackSpaceId } })).contentTreeRevision, 0n);

      let releaseSnapshotRead;
      let signalSnapshotRead;
      const snapshotReadRelease = new Promise((resolve) => { releaseSnapshotRead = resolve; });
      const snapshotRevisionRead = new Promise((resolve) => { signalSnapshotRead = resolve; });
      let revisionRead = false;
      let observedIsolation;
      const readPrisma = {
        $transaction: (callback, options) => {
          observedIsolation = options?.isolationLevel;
          return prisma.$transaction(async (tx) => {
            const space = new Proxy(tx.space, {
              get(target, property) {
                if (property !== 'findUnique') return Reflect.get(target, property);
                return async (...args) => {
                  const result = await target.findUnique(...args);
                  if (!revisionRead) {
                    revisionRead = true;
                    signalSnapshotRead();
                    await snapshotReadRelease;
                  }
                  return result;
                };
              },
            });
            const transaction = new Proxy(tx, {
              get(target, property) {
                if (property === 'space') return space;
                return Reflect.get(target, property);
              },
            });
            return callback(transaction);
          }, options);
        },
      };
      const snapshotReader = new ContentTreeService(
        readPrisma,
        writer,
        new ReadableSyncPathService(),
      );
      const snapshotRead = snapshotReader.listChildren({
        spaceId: snapshotSpaceId,
        parentFolderId: null,
        take: 10,
      });
      await snapshotRevisionRead;
      await service.createFolder({
        spaceId: snapshotSpaceId,
        parentId: null,
        name: 'Committed after snapshot',
        expectedTreeRevision: 0n,
        actor: { userId },
      });
      releaseSnapshotRead();
      const beforeCommitSnapshot = await snapshotRead;
      assert.equal(observedIsolation, 'RepeatableRead');
      assert.equal(beforeCommitSnapshot.treeRevision, 0n);
      assert.deepEqual(beforeCommitSnapshot.data, []);
      const afterCommitSnapshot = await service.listChildren({
        spaceId: snapshotSpaceId,
        parentFolderId: null,
        take: 10,
      });
      assert.equal(afterCommitSnapshot.treeRevision, 1n);
      assert.equal(afterCommitSnapshot.data.length, 1);
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('blocking probe releases latches and the Folder harness cleans a controlled callback failure', {
  skip: baseDatabaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const beforeSchemas = await folderTestSchemaCount(baseDatabaseUrl);
  let firstReleased = false;
  let secondSettled = false;
  await assert.rejects(
    withFolderTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
      const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const writer = new SpaceRevisionWriterService(prisma);
      const spaceId = `cleanup_${schemaName.replace('folder_test_', '')}`;
      try {
        await prisma.space.create({ data: { id: spaceId, name: 'Cleanup', slug: spaceId } });
        await Promise.race([
          runBlockingLockProbe({
            startFirst: ({ hold, signalStarted }) => prisma.$transaction(async (tx) => {
              await writer.lockContentTreeSpace(tx, spaceId);
              signalStarted();
              await hold;
              firstReleased = true;
            }),
            startSecond: () => prisma.$transaction(async (tx) => {
              await writer.lockContentTreeSpace(tx, spaceId);
              secondSettled = true;
            }),
            assertBlocked: () => {
              throw new Error('controlled blocking assertion failure');
            },
            holdMs: 20,
          }),
          wait(1_000).then(() => { throw new Error('blocking probe cleanup hung'); }),
        ]);
      } finally {
        await prisma.$disconnect();
      }
    }),
    /controlled blocking assertion failure/u,
  );
  assert.equal(firstReleased, true);
  assert.equal(secondSettled, true);
  assert.equal(await folderTestSchemaCount(baseDatabaseUrl), beforeSchemas);
});

test('ContentTree DB gate leaves no generated schemas and preserves protected public inventory', {
  skip: baseDatabaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is not configured',
}, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl(baseDatabaseUrl) } } });
  let publicInventoryAfter;
  try {
    publicInventoryAfter = await captureFolderDatabaseSafetyInventory(
      administrativeUrl(baseDatabaseUrl),
      prisma,
    );
  } finally {
    await prisma.$disconnect();
  }
  assert.equal(await folderTestSchemaCount(baseDatabaseUrl), 0);
  assert.deepEqual(publicInventoryAfter, publicInventoryBefore);
  const beforeDigest = folderDatabaseSafetyInventoryDigest(publicInventoryBefore);
  const afterDigest = folderDatabaseSafetyInventoryDigest(publicInventoryAfter);
  assert.equal(afterDigest, beforeDigest);
  const vector = publicInventoryAfter.extensions.find((extension) => extension.name === 'vector');
  assert.equal(vector?.schema, 'public');
  assert.deepEqual(publicInventoryAfter.vectorExtensionCatalog.directObjectCounts, {
    pg_am: 2,
    pg_cast: 23,
    pg_opclass: 24,
    pg_operator: 40,
    pg_opfamily: 24,
    pg_proc: 118,
    pg_type: 3,
  });
  const definedVectorFunction = publicInventoryAfter.vectorExtensionCatalog.directObjects.find(
    (object) => object.className === 'pg_proc' && object.definition,
  );
  assert.equal(typeof definedVectorFunction?.catalogRow?.prosrc, 'string');
  assert.equal(Object.hasOwn(definedVectorFunction?.catalogRow ?? {}, 'proconfig'), true);
  assert.match(definedVectorFunction?.definition ?? '', /CREATE OR REPLACE FUNCTION/iu);
  assert.ok(publicInventoryAfter.vectorExtensionCatalog.accessMethodOperators.length > 0);
  assert.ok(publicInventoryAfter.vectorExtensionCatalog.accessMethodProcedures.length > 0);
  const expectedDatabaseUrl = validateFolderTestDatabaseUrl(baseDatabaseUrl);
  assert.deepEqual(
    publicInventoryAfter.databaseMetadata.map(({ name, currentUser }) => ({ name, currentUser })),
    [{
      name: decodeURIComponent(expectedDatabaseUrl.pathname.replace(/^\//u, '')),
      currentUser: decodeURIComponent(expectedDatabaseUrl.username),
    }],
  );
  assert.ok(publicInventoryAfter.databaseSettings.every(
    (setting) => typeof setting.scope === 'string'
      && typeof setting.role === 'string'
      && typeof setting.setting === 'string',
  ));
  console.log('folder_test_schemas=0');
  console.log(`public_inventory_before=${beforeDigest}`);
  console.log(`public_inventory_after=${afterDigest}`);
  console.log('public_inventory_equal=true');
  console.log(`vector_extension_schema=${vector.schema}`);
  console.log(`vector_extension_direct_objects=${publicInventoryAfter.vectorExtensionCatalog.directObjects.length}`);
  console.log(`migration_tree_sha256=${REVIEWED_MIGRATION_TREE_SHA256}`);
  console.log('sanitized_global_fragments=2');
});
