import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as wait } from 'node:timers/promises';
import test, { before } from 'node:test';
import {
  assertFolderDatabaseSafetyPreflight,
  auditFolderMigrations,
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
    publicInventoryBefore = await captureFolderDatabaseSafetyInventory(prisma);
  } finally {
    await prisma.$disconnect();
  }
});

test('Folder migration safety audit requires preconfigured public and database dependencies', async () => {
  const audit = await auditFolderMigrations();
  assert.equal(audit.allowedVectorExtensionStatements, 1);
  assert.equal(audit.allowedHnswDatabaseSettingStatements, 1);
  assert.deepEqual(audit.forbiddenStatements, []);
  await assert.rejects(
    assertFolderDatabaseSafetyPreflight({ $queryRaw: async () => [] }),
    /vector extension must be preconfigured in public/iu,
  );
  let queryIndex = 0;
  await assert.rejects(
    assertFolderDatabaseSafetyPreflight({
      $queryRaw: async () => {
        queryIndex += 1;
        return queryIndex === 1 ? [{ name: 'vector', schema: 'public' }] : [];
      },
    }),
    /hnsw\.ef_search=200 must be preconfigured/iu,
  );
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
          await writer.advance(locked, rollbackSpaceId, [], { origin: 'web_editor', createdByUserId: userId });
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
    publicInventoryAfter = await captureFolderDatabaseSafetyInventory(prisma);
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
  assert.match(publicInventoryAfter.databaseSettings[0]?.settings ?? '', /(?:^|\n)hnsw\.ef_search=200(?:\n|$)/u);
  console.log('folder_test_schemas=0');
  console.log(`public_inventory_before=${beforeDigest}`);
  console.log(`public_inventory_after=${afterDigest}`);
  console.log('public_inventory_equal=true');
  console.log(`vector_extension_schema=${vector.schema}`);
  console.log('database_hnsw_ef_search=200');
});
