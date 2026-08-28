import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as wait } from 'node:timers/promises';
import test from 'node:test';
import {
  validateFolderTestDatabaseUrl,
  withFolderTestDatabase,
} from './folder-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { ContentTreeService } = requireFromServer('./dist/content-tree/content-tree.service.js');
const { ReadableSyncPathService } = requireFromServer('./dist/core/sync/readable-sync-path.service.js');
const { SpaceRevisionWriterService } = requireFromServer('./dist/core/sync/space-revision-writer.service.js');
const baseDatabaseUrl = process.env.FOLDER_TEST_DATABASE_URL;

const administrativeUrl = (value) => {
  const parsed = validateFolderTestDatabaseUrl(value);
  parsed.searchParams.delete('schema');
  return parsed.toString();
};

const databaseCounts = async (value) => {
  const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl(value) } } });
  try {
    const [schemas, publicTables] = await Promise.all([
      prisma.$queryRaw`
        SELECT COUNT(*)::int AS count
        FROM pg_namespace
        WHERE nspname LIKE 'folder\_test\_%' ESCAPE '\'
      `,
      prisma.$queryRaw`
        SELECT COUNT(*)::int AS count
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `,
    ]);
    return {
      folderTestSchemas: schemas[0].count,
      publicTables: publicTables[0].count,
    };
  } finally {
    await prisma.$disconnect();
  }
};

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

      let releaseCommitLock;
      let signalCommitLock;
      const commitRelease = new Promise((resolve) => { releaseCommitLock = resolve; });
      const commitAcquired = new Promise((resolve) => { signalCommitLock = resolve; });
      const firstCommit = prisma.$transaction(async (tx) => {
        await writer.lockContentTreeSpace(tx, commitSpaceId);
        signalCommitLock();
        await commitRelease;
      });
      await commitAcquired;
      let secondCommitAcquired = false;
      const secondCommit = prisma.$transaction(async (tx) => {
        const locked = await writer.lockContentTreeSpace(tx, commitSpaceId);
        secondCommitAcquired = true;
        return locked?.contentTreeRevision;
      });
      await wait(150);
      assert.equal(secondCommitAcquired, false, 'second transaction bypassed the production advisory lock');
      releaseCommitLock();
      await firstCommit;
      assert.equal(await secondCommit, 0n);

      let releaseRollbackLock;
      let signalRollbackLock;
      const rollbackRelease = new Promise((resolve) => { releaseRollbackLock = resolve; });
      const rollbackAcquired = new Promise((resolve) => { signalRollbackLock = resolve; });
      const rollbackFailure = prisma.$transaction(async (tx) => {
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
        signalRollbackLock();
        await rollbackRelease;
        throw new Error('force rollback');
      });
      const observedRollbackFailure = rollbackFailure.then(
        () => null,
        (error) => error,
      );
      await rollbackAcquired;
      let afterRollbackAcquired = false;
      const afterRollback = prisma.$transaction(async (tx) => {
        const locked = await writer.lockContentTreeSpace(tx, rollbackSpaceId);
        afterRollbackAcquired = true;
        return locked?.contentTreeRevision;
      });
      await wait(150);
      assert.equal(afterRollbackAcquired, false, 'rollback did not retain the advisory lock until transaction end');
      releaseRollbackLock();
      assert.match((await observedRollbackFailure).message, /force rollback/u);
      assert.equal(await afterRollback, 0n);
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

test('ContentTree DB gate leaves no generated schemas and never touches public', {
  skip: baseDatabaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is not configured',
}, async () => {
  const counts = await databaseCounts(baseDatabaseUrl);
  assert.equal(counts.folderTestSchemas, 0);
  assert.equal(counts.publicTables, 0);
  console.log(`folder_test_schemas=${counts.folderTestSchemas}`);
  console.log(`public_tables=${counts.publicTables}`);
});
