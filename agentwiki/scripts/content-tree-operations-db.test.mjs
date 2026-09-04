import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  captureFolderDatabaseSafetyInventory,
  folderDatabaseSafetyInventoryDigest,
  validateFolderTestDatabaseUrl,
  withFolderTestDatabase,
} from './folder-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { contentHash, pathKey } = requireFromServer('@neomei/agentwiki-sync-protocol');
const { ContentTreeService } = requireFromServer('./dist/content-tree/content-tree.service.js');
const { ReadableSyncPathService } = requireFromServer('./dist/core/sync/readable-sync-path.service.js');
const { SpaceRevisionWriterService } = requireFromServer('./dist/core/sync/space-revision-writer.service.js');

const baseDatabaseUrl = process.env.FOLDER_TEST_DATABASE_URL;

const administrativeUrl = (value) => {
  const parsed = validateFolderTestDatabaseUrl(value);
  parsed.searchParams.delete('schema');
  return parsed.toString();
};

const countFolderSchemas = async (value) => {
  const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl(value) } } });
  try {
    const rows = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM pg_namespace
      WHERE nspname LIKE 'folder\_test\_%' ESCAPE '\'
    `;
    return rows[0].count;
  } finally {
    await prisma.$disconnect();
  }
};

const countSanitizedMigrationDirectories = async () => (
  (await readdir(tmpdir())).filter((entry) => entry.startsWith('agentwiki-folder-migrations-')).length
);

const expectCode = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
};

test('ContentTree lifecycle operations are atomic in real PostgreSQL', {
  skip: baseDatabaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is not configured',
  timeout: 300_000,
}, async (t) => {
  const adminUrl = administrativeUrl(baseDatabaseUrl);
  const inventoryClient = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  let inventoryBefore;
  try {
    inventoryBefore = await captureFolderDatabaseSafetyInventory(adminUrl, inventoryClient);
  } finally {
    await inventoryClient.$disconnect();
  }

  let operationError;
  try {
    await withFolderTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
      const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      let trackQueries = false;
      let trackedQueryCount = 0;
      prisma.$use(async (params, next) => {
        if (trackQueries) trackedQueryCount += 1;
        return next(params);
      });
      const writer = SpaceRevisionWriterService.legacyOnly(prisma);
      const paths = new ReadableSyncPathService();
      const service = new ContentTreeService(prisma, writer, paths);
      const suffix = schemaName.slice('folder_test_'.length);
      const userId = `lifecycle-user-${suffix}`;
      const actor = { userId };
      let serial = 0;

      const createSpace = async (label) => {
        serial += 1;
        const id = `${label}-${serial}-${suffix}`;
        await prisma.space.create({ data: { id, name: label, slug: id } });
        return id;
      };

      const createFolder = (spaceId, input) => prisma.folder.create({ data: {
        id: input.id,
        spaceId,
        parentId: input.parentId ?? null,
        name: input.name,
        nameKey: input.nameKey ?? input.name.normalize('NFC').toLowerCase(),
        path: input.path,
        pathKey: input.pathKey ?? pathKey(input.path),
        sortOrder: input.sortOrder ?? 0,
        createdByUserId: userId,
        lastModifiedByUserId: userId,
      } });

      const createPage = (spaceId, input) => prisma.page.create({ data: {
        id: input.id,
        knowledgeKey: input.knowledgeKey ?? `knowledge-${input.id}`,
        title: input.title,
        slug: input.slug ?? input.id,
        content: input.content ?? `# ${input.title}`,
        format: 'markdown',
        folderId: input.folderId ?? null,
        sortOrder: input.sortOrder ?? 0,
        spaceId,
        authorId: userId,
        syncPath: input.syncPath,
        syncPathKey: input.syncPathKey ?? pathKey(input.syncPath),
        deletedAt: input.deletedAt ?? null,
        lastModifiedByUserId: userId,
      } });

      try {
        await prisma.user.create({ data: {
          id: userId,
          email: `${userId}@content-tree-operations.test`,
        } });

        await t.test('rename rewrites the full subtree, aliases old Page paths, and trims to 20', async () => {
          const spaceId = await createSpace('rename');
          const root = await createFolder(spaceId, {
            id: `rename-root-${suffix}`, name: '项目', path: 'pages/项目',
          });
          const child = await createFolder(spaceId, {
            id: `rename-child-${suffix}`, parentId: root.id, name: '周报', path: 'pages/项目/周报',
          });
          const movedPage = await createPage(spaceId, {
            id: `rename-page-${suffix}`, folderId: child.id, title: '进度',
            syncPath: 'pages/项目/周报/进度.md',
          });
          const reusedAliasCreatedAt = new Date('2026-07-01T00:00:00.000Z');
          const reusedAliasExpiresAt = new Date('2026-08-01T00:00:00.000Z');
          await prisma.pagePathAlias.create({ data: {
            id: randomUUID(), spaceId, pageId: movedPage.id,
            path: 'pages/项目/周报/进度.md', pathKey: pathKey('pages/项目/周报/进度.md'),
            createdAt: reusedAliasCreatedAt, expiresAt: reusedAliasExpiresAt,
          } });
          await prisma.pagePathAlias.createMany({ data: Array.from({ length: 20 }, (_, index) => ({
            id: randomUUID(),
            spaceId,
            pageId: movedPage.id,
            path: `pages/history-${index}.md`,
            pathKey: pathKey(`pages/history-${index}.md`),
            createdAt: new Date(`2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
          })) });

          const renamed = await service.renameFolder({
            spaceId,
            folderId: root.id,
            name: '新项目',
            expectedTreeRevision: 0n,
            expectedUpdatedAt: root.updatedAt,
            actor,
          });
          assert.equal(renamed.folder.path, 'pages/新项目');
          assert.equal(renamed.treeRevision, 1n);
          assert.equal((await prisma.folder.findUniqueOrThrow({ where: { id: child.id } })).path, 'pages/新项目/周报');
          const currentPage = await prisma.page.findUniqueOrThrow({ where: { id: movedPage.id } });
          assert.equal(currentPage.syncPath, 'pages/新项目/周报/进度.md');
          assert.equal(await prisma.pagePathAlias.count({ where: { pageId: movedPage.id } }), 20);
          const reusedAlias = await prisma.pagePathAlias.findFirst({
            where: { pageId: movedPage.id, pathKey: pathKey('pages/项目/周报/进度.md') },
          });
          assert.ok(reusedAlias);
          assert.equal(reusedAlias.path, 'pages/项目/周报/进度.md');
          assert.equal(reusedAlias.expiresAt, null);
          assert.ok(reusedAlias.createdAt > reusedAliasCreatedAt);
          assert.equal(await prisma.pagePathAlias.count({
            where: { pageId: movedPage.id, pathKey: pathKey('pages/history-0.md') },
          }), 0);
          assert.ok(await prisma.pagePathAlias.findFirst({
            where: { pageId: movedPage.id, pathKey: pathKey('pages/history-1.md') },
          }));
          const revision = await prisma.spaceKnowledgeRevision.findFirstOrThrow({ where: { spaceId } });
          assert.equal(revision.pageCount, 1n);
          assert.ok(revision.revisionManifestByteLength > 0n);
          const revisionRow = await prisma.syncRevisionPageRow.findUniqueOrThrow({
            where: { revisionId_pageId: { revisionId: revision.id, pageId: movedPage.knowledgeKey } },
          });
          assert.equal(revisionRow.path, currentPage.syncPath);
          assert.equal(revisionRow.folderId, child.id);
          assert.equal(revisionRow.contentHash, await contentHash(movedPage.content));
          const legacyExtra = await prisma.legacyRevisionPageExtra.findUniqueOrThrow({
            where: { revisionId_pageId: { revisionId: revision.id, pageId: movedPage.knowledgeKey } },
          });
          assert.equal(legacyExtra.extra.path, currentPage.syncPath);
          assert.equal(legacyExtra.extra.title, movedPage.title);
          const legacyBody = await prisma.legacyPageBodyRow.findUniqueOrThrow({
            where: { contentHash: legacyExtra.legacyBodyHash },
          });
          assert.equal(legacyBody.body, movedPage.content);

          const freshRoot = await prisma.folder.findUniqueOrThrow({ where: { id: root.id } });
          await expectCode(service.moveNode({
            spaceId,
            kind: 'folder',
            nodeId: root.id,
            targetFolderId: child.id,
            expectedTreeRevision: 1n,
            expectedUpdatedAt: freshRoot.updatedAt,
            actor,
          }), 'FOLDER_CYCLE');

          const foreignSpaceId = await createSpace('foreign');
          const foreign = await createFolder(foreignSpaceId, {
            id: `foreign-folder-${suffix}`, name: 'Foreign', path: 'pages/Foreign',
          });
          await expectCode(service.moveNode({
            spaceId,
            kind: 'folder',
            nodeId: root.id,
            targetFolderId: foreign.id,
            expectedTreeRevision: 1n,
            expectedUpdatedAt: freshRoot.updatedAt,
            actor,
          }), 'FOLDER_NOT_FOUND');
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);

          const aliasTarget = await createPage(spaceId, {
            id: `alias-current-peer-${suffix}`, title: 'Peer', syncPath: 'pages/Peer.md',
          });
          await prisma.pagePathAlias.create({ data: {
            id: randomUUID(), spaceId, pageId: aliasTarget.id,
            path: currentPage.syncPath, pathKey: currentPage.syncPathKey,
          } });
          assert.deepEqual(await paths.resolvePagePath(prisma, {
            spaceId, path: '新项目/周报/进度',
          }), {
            kind: 'current', pageId: movedPage.id, path: currentPage.syncPath,
          });
          assert.deepEqual(await paths.resolvePagePath(prisma, {
            spaceId, path: 'pages/项目/周报/进度.md',
          }), {
            kind: 'alias', pageId: movedPage.id, path: currentPage.syncPath,
          });

          const ambiguousA = await createPage(spaceId, {
            id: `ambiguous-a-${suffix}`, title: 'A', syncPath: 'pages/A.md',
          });
          const ambiguousB = await createPage(spaceId, {
            id: `ambiguous-b-${suffix}`, title: 'B', syncPath: 'pages/B.md',
          });
          await prisma.pagePathAlias.createMany({ data: [ambiguousA, ambiguousB].map((candidate) => ({
            id: randomUUID(), spaceId, pageId: candidate.id,
            path: 'pages/Legacy.md', pathKey: pathKey('pages/Legacy.md'),
          })) });
          await expectCode(paths.resolvePagePath(prisma, {
            spaceId, path: 'pages/Legacy.md',
          }), 'MARKDOWN_REFERENCE_AMBIGUOUS');

          const deleted = await createPage(spaceId, {
            id: `deleted-alias-${suffix}`, title: 'Deleted', syncPath: 'pages/Deleted-current.md',
            deletedAt: new Date(),
          });
          await prisma.pagePathAlias.create({ data: {
            id: randomUUID(), spaceId, pageId: deleted.id,
            path: 'pages/Deleted-old.md', pathKey: pathKey('pages/Deleted-old.md'),
          } });
          assert.deepEqual(await paths.resolvePagePath(prisma, {
            spaceId, path: 'pages/Deleted-old.md',
          }), { kind: 'not-found' });
          assert.deepEqual(await paths.resolvePagePath(prisma, {
            spaceId: foreignSpaceId, path: 'pages/新项目/周报/进度.md',
          }), { kind: 'not-found' });
        });

        await t.test('Folder move rewrites its subtree while same-parent reorder leaves descendants untouched', async () => {
          const spaceId = await createSpace('folder-move');
          const source = await createFolder(spaceId, {
            id: `folder-move-source-${suffix}`, name: 'Source', path: 'pages/Source',
          });
          const target = await createFolder(spaceId, {
            id: `folder-move-target-${suffix}`, name: 'Target', path: 'pages/Target', sortOrder: 1,
          });
          const before = await createFolder(spaceId, {
            id: `folder-move-before-${suffix}`, parentId: target.id,
            name: 'Before', path: 'pages/Target/Before',
          });
          const moving = await createFolder(spaceId, {
            id: `folder-moving-${suffix}`, parentId: source.id,
            name: 'Moving', path: 'pages/Source/Moving',
          });
          const child = await createFolder(spaceId, {
            id: `folder-moving-child-${suffix}`, parentId: moving.id,
            name: 'Child', path: 'pages/Source/Moving/Child',
          });
          const page = await createPage(spaceId, {
            id: `folder-moving-page-${suffix}`, folderId: child.id, title: 'Page',
            syncPath: 'pages/Source/Moving/Child/Page.md',
          });

          const moved = await service.moveNode({
            spaceId, kind: 'folder', nodeId: moving.id,
            targetFolderId: target.id, beforeId: before.id,
            expectedTreeRevision: 0n, expectedUpdatedAt: moving.updatedAt, actor,
          });
          assert.equal(moved.node.path, 'pages/Target/Moving');
          assert.equal((await prisma.folder.findUniqueOrThrow({ where: { id: child.id } })).path, 'pages/Target/Moving/Child');
          assert.equal((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).syncPath, 'pages/Target/Moving/Child/Page.md');
          assert.ok(await prisma.pagePathAlias.findFirst({
            where: { pageId: page.id, pathKey: pathKey('pages/Source/Moving/Child/Page.md') },
          }));
          const childAfterMove = await prisma.folder.findUniqueOrThrow({ where: { id: child.id } });
          const rootAfterMove = await prisma.folder.findUniqueOrThrow({ where: { id: moving.id } });
          const firstRevision = await prisma.spaceKnowledgeRevision.findFirstOrThrow({ where: { spaceId } });
          const sidecar = {
            schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', baseRevision: null,
            memories: [{ id: 'memory-1' }], relations: [], provenance: [], deletions: [],
          };
          const revisionSidecar = await prisma.legacyRevisionSidecar.findUniqueOrThrow({
            where: { revisionId: firstRevision.id },
          });
          await prisma.legacyRevisionSidecar.update({
            where: { revisionId: firstRevision.id },
            data: { sidecar: { ...revisionSidecar.sidecar, ...sidecar } },
          });

          await service.moveNode({
            spaceId, kind: 'folder', nodeId: moving.id,
            targetFolderId: target.id,
            expectedTreeRevision: 1n, expectedUpdatedAt: rootAfterMove.updatedAt, actor,
          });
          const childAfterReorder = await prisma.folder.findUniqueOrThrow({ where: { id: child.id } });
          assert.equal(childAfterReorder.updatedAt.toISOString(), childAfterMove.updatedAt.toISOString());
          assert.equal(childAfterReorder.path, childAfterMove.path);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 2n);
          const revisions = await prisma.spaceKnowledgeRevision.findMany({
            where: { spaceId }, orderBy: { sequence: 'asc' },
          });
          assert.equal(revisions.length, 2);
          assert.equal(revisions[1].parentRevisionId, revisions[0].id);
          assert.ok(revisions[0].supersededAt);
          const inherited = await prisma.syncRevisionPageRow.findUniqueOrThrow({
            where: { revisionId_pageId: { revisionId: revisions[1].id, pageId: page.knowledgeKey } },
          });
          assert.equal(inherited.path, 'pages/Target/Moving/Child/Page.md');
          assert.equal(inherited.folderId, child.id);
          assert.ok(await prisma.legacyRevisionPageExtra.findUnique({
            where: { revisionId_pageId: { revisionId: revisions[1].id, pageId: page.knowledgeKey } },
          }));
          const inheritedSidecar = (await prisma.legacyRevisionSidecar.findUniqueOrThrow({
            where: { revisionId: revisions[1].id },
          })).sidecar;
          assert.deepEqual({
            schemaVersion: inheritedSidecar.schemaVersion,
            recipeVersion: inheritedSidecar.recipeVersion,
            baseRevision: inheritedSidecar.baseRevision,
            memories: inheritedSidecar.memories,
            relations: inheritedSidecar.relations,
            provenance: inheritedSidecar.provenance,
            deletions: inheritedSidecar.deletions,
          }, sidecar);
          assert.equal(inheritedSidecar.spaceFolderMigration.v2Revision.protocolVersion, '2');
        });

        await t.test('Page move allocates in the target Folder, compacts siblings, aliases, and rejects stale updatedAt', async () => {
          const spaceId = await createSpace('page-move');
          const source = await createFolder(spaceId, {
            id: `page-source-${suffix}`, name: 'Source', path: 'pages/Source',
          });
          const target = await createFolder(spaceId, {
            id: `page-target-${suffix}`, name: 'Target', path: 'pages/Target', sortOrder: 1,
          });
          const moving = await createPage(spaceId, {
            id: `page-moving-${suffix}`, folderId: source.id, title: 'Report',
            syncPath: 'pages/Source/Report.md',
          });
          const occupied = await createPage(spaceId, {
            id: `page-occupied-${suffix}`, folderId: target.id, title: 'Report',
            syncPath: 'pages/Target/Report.md', sortOrder: 0,
          });
          const before = await createPage(spaceId, {
            id: `page-before-${suffix}`, folderId: target.id, title: 'Before',
            syncPath: 'pages/Target/Before.md', sortOrder: 9,
          });

          const result = await service.moveNode({
            spaceId,
            kind: 'page',
            nodeId: moving.id,
            targetFolderId: target.id,
            beforeId: before.id,
            expectedTreeRevision: 0n,
            expectedUpdatedAt: moving.updatedAt,
            actor,
          });
          assert.equal(result.node.path, 'pages/Target/Report (2).md');
          const siblings = await prisma.page.findMany({
            where: { spaceId, folderId: target.id, deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          });
          assert.deepEqual(siblings.map((item) => item.id), [occupied.id, moving.id, before.id]);
          assert.deepEqual(siblings.map((item) => item.sortOrder), [0, 1, 2]);
          assert.ok(await prisma.pagePathAlias.findFirst({
            where: { pageId: moving.id, pathKey: pathKey('pages/Source/Report.md') },
          }));
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);

          await expectCode(service.moveNode({
            spaceId,
            kind: 'page',
            nodeId: moving.id,
            targetFolderId: source.id,
            expectedTreeRevision: 1n,
            expectedUpdatedAt: moving.updatedAt,
            actor,
          }), 'CONTENT_TREE_CONFLICT');
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);
        });

        await t.test('two concurrent moves serialize so one commits and one conflicts', async () => {
          const spaceId = await createSpace('concurrent-move');
          const source = await createFolder(spaceId, {
            id: `concurrent-source-${suffix}`, name: 'Source', path: 'pages/Source',
          });
          const targetA = await createFolder(spaceId, {
            id: `concurrent-a-${suffix}`, name: 'A', path: 'pages/A', sortOrder: 1,
          });
          const targetB = await createFolder(spaceId, {
            id: `concurrent-b-${suffix}`, name: 'B', path: 'pages/B', sortOrder: 2,
          });
          const moving = await createPage(spaceId, {
            id: `concurrent-page-${suffix}`, folderId: source.id, title: 'Move',
            syncPath: 'pages/Source/Move.md',
          });
          const input = {
            spaceId,
            kind: 'page',
            nodeId: moving.id,
            expectedTreeRevision: 0n,
            expectedUpdatedAt: moving.updatedAt,
            actor,
          };
          const results = await Promise.allSettled([
            service.moveNode({ ...input, targetFolderId: targetA.id }),
            service.moveNode({ ...input, targetFolderId: targetB.id }),
          ]);
          assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
          const rejection = results.find((result) => result.status === 'rejected');
          assert.equal(rejection.reason.code, 'CONTENT_TREE_CONFLICT');
          const committed = await prisma.page.findUniqueOrThrow({ where: { id: moving.id } });
          assert.ok([targetA.id, targetB.id].includes(committed.folderId));
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);
        });

        await t.test('corrupt multi-node Folder cycles fail closed before every lifecycle write', async () => {
          const spaceId = await createSpace('corrupt-cycle');
          const cycleA = await createFolder(spaceId, {
            id: `cycle-a-${suffix}`, name: 'Cycle A', path: 'pages/Cycle A',
          });
          const cycleB = await createFolder(spaceId, {
            id: `cycle-b-${suffix}`, parentId: cycleA.id,
            name: 'Cycle B', path: 'pages/Cycle A/Cycle B',
          });
          const source = await createFolder(spaceId, {
            id: `cycle-source-${suffix}`, name: 'Source', path: 'pages/Source',
          });
          const corruptedA = await prisma.folder.update({
            where: { id: cycleA.id }, data: { parentId: cycleB.id },
          });

          await expectCode(service.renameFolder({
            spaceId, folderId: cycleA.id, name: 'Renamed cycle',
            expectedTreeRevision: 0n, expectedUpdatedAt: corruptedA.updatedAt, actor,
          }), 'FOLDER_CYCLE');
          await expectCode(service.deleteImpact({
            spaceId, folderId: cycleA.id,
          }), 'FOLDER_CYCLE');
          await expectCode(service.deleteFolder({
            spaceId, folderId: cycleA.id,
            expectedTreeRevision: 0n, expectedUpdatedAt: corruptedA.updatedAt,
            expectedImpactHash: '0'.repeat(64), actor,
          }), 'FOLDER_CYCLE');
          await expectCode(service.moveNode({
            spaceId, kind: 'folder', nodeId: source.id, targetFolderId: cycleA.id,
            expectedTreeRevision: 0n, expectedUpdatedAt: source.updatedAt, actor,
          }), 'FOLDER_CYCLE');
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 0n);
          assert.equal(await prisma.pagePathAlias.count({ where: { spaceId } }), 0);
          assert.equal(await prisma.contentDeletionBatch.count({ where: { spaceId } }), 0);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 0);

          const restoreSpaceId = await createSpace('corrupt-restore-cycle');
          const restoreRoot = await createFolder(restoreSpaceId, {
            id: `restore-cycle-root-${suffix}`, name: 'Restore cycle', path: 'pages/Restore cycle',
          });
          const restoreChild = await createFolder(restoreSpaceId, {
            id: `restore-cycle-child-${suffix}`, parentId: restoreRoot.id,
            name: 'Child', path: 'pages/Restore cycle/Child',
          });
          const batch = await prisma.contentDeletionBatch.create({ data: {
            id: randomUUID(),
            spaceId: restoreSpaceId,
            rootFolderId: restoreRoot.id,
            deletedByUserId: userId,
            deletedTreeRevision: 0n,
            folderCount: 2,
            pageCount: 0,
            impactHash: '0'.repeat(64),
          } });
          await prisma.$executeRaw`
            UPDATE "Folder" folder
            SET
              "parentId" = CASE
                WHEN folder."id" = ${restoreRoot.id} THEN ${restoreChild.id}
                ELSE ${restoreRoot.id}
              END,
              "deletedAt" = batch."createdAt",
              "deletionBatchId" = batch."id"
            FROM "ContentDeletionBatch" batch
            WHERE batch."id" = ${batch.id}
              AND folder."spaceId" = ${restoreSpaceId}
              AND folder."id" IN (${restoreRoot.id}, ${restoreChild.id})
          `;
          await expectCode(service.restoreDeletionBatch({
            spaceId: restoreSpaceId,
            deletionBatchId: batch.id,
            strategy: { kind: 'root' },
            expectedTreeRevision: 0n,
            expectedUpdatedAt: restoreRoot.updatedAt,
            actor,
          }), 'FOLDER_CYCLE');
          assert.ok((await prisma.folder.findUniqueOrThrow({ where: { id: restoreRoot.id } })).deletedAt);
          assert.ok((await prisma.folder.findUniqueOrThrow({ where: { id: restoreChild.id } })).deletedAt);
          assert.equal((await prisma.contentDeletionBatch.findUniqueOrThrow({ where: { id: batch.id } })).restoredAt, null);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId: restoreSpaceId } }), 0);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: restoreSpaceId } })).contentTreeRevision, 0n);
        });

        await t.test('delete uses the preview hash, one exact batch/timestamp, and original restore is collision-safe', async () => {
          const spaceId = await createSpace('delete-restore');
          const parent = await createFolder(spaceId, {
            id: `delete-parent-${suffix}`, name: 'Parent', path: 'pages/Parent',
          });
          const root = await createFolder(spaceId, {
            id: `delete-root-${suffix}`, parentId: parent.id, name: 'Trash', path: 'pages/Parent/Trash',
          });
          const child = await createFolder(spaceId, {
            id: `delete-child-${suffix}`, parentId: root.id, name: 'Child', path: 'pages/Parent/Trash/Child',
          });
          const rootPage = await createPage(spaceId, {
            id: `delete-root-page-${suffix}`, folderId: root.id, title: 'Root page',
            syncPath: 'pages/Parent/Trash/Root page.md',
          });
          const childPage = await createPage(spaceId, {
            id: `delete-child-page-${suffix}`, folderId: child.id, title: 'Child page',
            syncPath: 'pages/Parent/Trash/Child/Child page.md',
          });
          const preview = await service.deleteImpact({ spaceId, folderId: root.id });
          assert.equal(preview.treeRevision, 0n);
          assert.equal(preview.rootUpdatedAt.toISOString(), root.updatedAt.toISOString());
          assert.equal(preview.folderCount, 2);
          assert.equal(preview.pageCount, 2);
          assert.match(preview.impactHash, /^[0-9a-f]{64}$/);

          const changedPage = await prisma.page.update({
            where: { id: childPage.id },
            data: { content: '# Child page changed after preview' },
          });
          assert.notEqual(changedPage.updatedAt.toISOString(), childPage.updatedAt.toISOString());
          await expectCode(service.deleteFolder({
            spaceId,
            folderId: root.id,
            expectedTreeRevision: 0n,
            expectedUpdatedAt: root.updatedAt,
            expectedImpactHash: preview.impactHash,
            actor,
          }), 'FOLDER_DELETE_IMPACT_CHANGED');
          assert.equal(await prisma.contentDeletionBatch.count({ where: { spaceId } }), 0);
          assert.equal((await prisma.folder.findUniqueOrThrow({ where: { id: root.id } })).deletedAt, null);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 0n);

          const currentPreview = await service.deleteImpact({ spaceId, folderId: root.id });
          assert.equal(currentPreview.folderCount, 2);
          assert.equal(currentPreview.pageCount, 2);
          assert.notEqual(currentPreview.impactHash, preview.impactHash);

          const deleted = await service.deleteFolder({
            spaceId,
            folderId: root.id,
            expectedTreeRevision: 0n,
            expectedUpdatedAt: root.updatedAt,
            expectedImpactHash: currentPreview.impactHash,
            actor,
          });
          assert.equal(deleted.treeRevision, 1n);
          const deletedFolders = await prisma.folder.findMany({
            where: { id: { in: [root.id, child.id] } }, orderBy: { id: 'asc' },
          });
          const deletedPages = await prisma.page.findMany({
            where: { id: { in: [rootPage.id, childPage.id] } }, orderBy: { id: 'asc' },
          });
          assert.equal(new Set([...deletedFolders, ...deletedPages].map((item) => item.deletionBatchId)).size, 1);
          assert.equal(new Set([...deletedFolders, ...deletedPages].map((item) => item.deletedAt.toISOString())).size, 1);
          assert.equal(deleted.batch.id, deletedFolders[0].deletionBatchId);
          assert.equal(deleted.batch.impactHash, currentPreview.impactHash);
          assert.equal(
            deletedFolders.find((item) => item.id === root.id).updatedAt.toISOString(),
            root.updatedAt.toISOString(),
          );
          assert.equal(
            deletedPages.find((item) => item.id === childPage.id).updatedAt.toISOString(),
            changedPage.updatedAt.toISOString(),
          );
          assert.equal(await prisma.contentDeletionBatch.count({ where: { spaceId } }), 1);

          const collision = await createFolder(spaceId, {
            id: `restore-collision-${suffix}`, parentId: parent.id,
            name: 'Trash', path: 'pages/Parent/Trash',
          });
          await expectCode(service.restoreDeletionBatch({
            spaceId,
            deletionBatchId: deleted.batch.id,
            strategy: { kind: 'original' },
            expectedTreeRevision: 1n,
            expectedUpdatedAt: root.updatedAt,
            actor,
          }), 'FOLDER_RESTORE_CONFLICT');
          assert.ok((await prisma.folder.findUniqueOrThrow({ where: { id: root.id } })).deletedAt);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);
          assert.equal((await prisma.contentDeletionBatch.findUniqueOrThrow({ where: { id: deleted.batch.id } })).restoredAt, null);

          await prisma.folder.delete({ where: { id: collision.id } });
          const restored = await service.restoreDeletionBatch({
            spaceId,
            deletionBatchId: deleted.batch.id,
            strategy: { kind: 'original' },
            expectedTreeRevision: 1n,
            expectedUpdatedAt: root.updatedAt,
            actor,
          });
          assert.equal(restored.treeRevision, 2n);
          const restoredRoot = await prisma.folder.findUniqueOrThrow({ where: { id: root.id } });
          const restoredChild = await prisma.folder.findUniqueOrThrow({ where: { id: child.id } });
          assert.equal(restoredRoot.parentId, parent.id);
          assert.equal(restoredRoot.path, 'pages/Parent/Trash');
          assert.equal(restoredChild.path, 'pages/Parent/Trash/Child');
          assert.equal(restoredRoot.deletedAt, null);
          assert.equal(restoredRoot.deletionBatchId, null);
          assert.equal((await prisma.page.findUniqueOrThrow({ where: { id: childPage.id } })).deletedAt, null);
          assert.ok((await prisma.contentDeletionBatch.findUniqueOrThrow({ where: { id: deleted.batch.id } })).restoredAt);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 2);
        });

        await t.test('restore rejects a same-count swapped deletion-batch identity before writes', async () => {
          const spaceId = await createSpace('restore-membership');
          const root = await createFolder(spaceId, {
            id: `membership-root-${suffix}`, name: 'Membership', path: 'pages/Membership',
          });
          const original = await createPage(spaceId, {
            id: `membership-original-${suffix}`, folderId: root.id, title: 'Original',
            syncPath: 'pages/Membership/Original.md',
          });
          const preview = await service.deleteImpact({ spaceId, folderId: root.id });
          const deletion = await service.deleteFolder({
            spaceId, folderId: root.id,
            expectedTreeRevision: 0n, expectedUpdatedAt: root.updatedAt,
            expectedImpactHash: preview.impactHash, actor,
          });
          const substitute = await createPage(spaceId, {
            id: `membership-substitute-${suffix}`, folderId: root.id, title: 'Original',
            syncPath: 'pages/Membership/Substitute staging.md',
          });
          await prisma.$executeRaw`
            UPDATE "Page"
            SET "deletionBatchId" = NULL,
                "syncPath" = 'pages/Membership/Tampered original.md',
                "syncPathKey" = 'pages/membership/tampered original.md'
            WHERE "id" = ${original.id} AND "spaceId" = ${spaceId}
          `;
          await prisma.$executeRaw`
            UPDATE "Page"
            SET "deletionBatchId" = ${deletion.batch.id},
                "deletedAt" = (
                  SELECT "deletedAt" FROM "Folder"
                  WHERE "id" = ${root.id} AND "spaceId" = ${spaceId}
                ),
                "syncPath" = 'pages/Membership/Original.md',
                "syncPathKey" = 'pages/membership/original.md'
            WHERE "id" = ${substitute.id} AND "spaceId" = ${spaceId}
          `;

          const taggedFolders = await prisma.folder.findMany({
            where: { spaceId, deletionBatchId: deletion.batch.id },
          });
          const taggedPages = await prisma.page.findMany({
            where: { spaceId, deletionBatchId: deletion.batch.id },
          });
          assert.deepEqual(taggedFolders.map((item) => item.id), [root.id]);
          assert.deepEqual(taggedPages.map((item) => item.id), [substitute.id]);
          assert.equal(taggedFolders[0].deletedAt.toISOString(), taggedPages[0].deletedAt.toISOString());

          await assert.rejects(service.restoreDeletionBatch({
            spaceId,
            deletionBatchId: deletion.batch.id,
            strategy: { kind: 'original' },
            expectedTreeRevision: 1n,
            expectedUpdatedAt: root.updatedAt,
            actor,
          }), (error) => {
            assert.equal(error?.code, 'FOLDER_RESTORE_CONFLICT');
            assert.equal(error?.message, 'Deletion batch membership is inconsistent');
            return true;
          });
          assert.ok((await prisma.folder.findUniqueOrThrow({ where: { id: root.id } })).deletedAt);
          assert.ok((await prisma.page.findUniqueOrThrow({ where: { id: original.id } })).deletedAt);
          assert.ok((await prisma.page.findUniqueOrThrow({ where: { id: substitute.id } })).deletedAt);
          assert.equal((await prisma.contentDeletionBatch.findUniqueOrThrow({
            where: { id: deletion.batch.id },
          })).restoredAt, null);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);
          assert.equal(await prisma.pagePathAlias.count({ where: { spaceId } }), 0);
        });

        await t.test('restore rejects uniformly shifted batch timestamps before writes', async () => {
          const spaceId = await createSpace('restore-batch-timestamp');
          const root = await createFolder(spaceId, {
            id: `timestamp-root-${suffix}`, name: 'Timestamp', path: 'pages/Timestamp',
          });
          const child = await createFolder(spaceId, {
            id: `timestamp-child-${suffix}`, parentId: root.id,
            name: 'Child', path: 'pages/Timestamp/Child',
          });
          const page = await createPage(spaceId, {
            id: `timestamp-page-${suffix}`, folderId: child.id, title: 'Evidence',
            syncPath: 'pages/Timestamp/Child/Evidence.md',
          });
          const preview = await service.deleteImpact({ spaceId, folderId: root.id });
          const deletion = await service.deleteFolder({
            spaceId, folderId: root.id,
            expectedTreeRevision: 0n, expectedUpdatedAt: root.updatedAt,
            expectedImpactHash: preview.impactHash, actor,
          });
          await prisma.$executeRaw`
            UPDATE "Folder" folder
            SET "deletedAt" = batch."createdAt" + INTERVAL '1 minute'
            FROM "ContentDeletionBatch" batch
            WHERE batch."id" = ${deletion.batch.id}
              AND folder."spaceId" = ${spaceId}
              AND folder."deletionBatchId" = batch."id"
          `;
          await prisma.$executeRaw`
            UPDATE "Page" page
            SET "deletedAt" = batch."createdAt" + INTERVAL '1 minute'
            FROM "ContentDeletionBatch" batch
            WHERE batch."id" = ${deletion.batch.id}
              AND page."spaceId" = ${spaceId}
              AND page."deletionBatchId" = batch."id"
          `;

          const loadEvidence = async () => ({
            folders: await prisma.folder.findMany({
              where: { id: { in: [root.id, child.id] } },
              orderBy: { id: 'asc' },
            }),
            pages: await prisma.page.findMany({
              where: { id: page.id },
              orderBy: { id: 'asc' },
            }),
            batch: await prisma.contentDeletionBatch.findUniqueOrThrow({
              where: { id: deletion.batch.id },
            }),
            treeRevision: (await prisma.space.findUniqueOrThrow({
              where: { id: spaceId },
            })).contentTreeRevision,
            syncRevisions: await prisma.spaceKnowledgeRevision.findMany({
              where: { spaceId }, orderBy: { sequence: 'asc' },
            }),
            aliases: await prisma.pagePathAlias.findMany({
              where: { spaceId }, orderBy: { id: 'asc' },
            }),
          });
          const beforeRestore = await loadEvidence();
          const taggedDeletedAt = [
            ...beforeRestore.folders.map((item) => item.deletedAt?.toISOString()),
            ...beforeRestore.pages.map((item) => item.deletedAt?.toISOString()),
          ];
          assert.equal(new Set(taggedDeletedAt).size, 1);
          assert.notEqual(taggedDeletedAt[0], beforeRestore.batch.createdAt.toISOString());
          assert.equal(beforeRestore.batch.restoredAt, null);
          assert.equal(beforeRestore.treeRevision, 1n);
          assert.equal(beforeRestore.syncRevisions.length, 1);
          assert.equal(beforeRestore.aliases.length, 0);

          await assert.rejects(service.restoreDeletionBatch({
            spaceId,
            deletionBatchId: deletion.batch.id,
            strategy: { kind: 'original' },
            expectedTreeRevision: 1n,
            expectedUpdatedAt: root.updatedAt,
            actor,
          }), (error) => {
            assert.equal(error?.code, 'FOLDER_RESTORE_CONFLICT');
            assert.equal(error?.message, 'Deletion batch membership is inconsistent');
            return true;
          });

          const afterRestore = await loadEvidence();
          assert.deepEqual(afterRestore, beforeRestore);
        });

        await t.test('restore includes existing active Folders in the 10,000 Folder cap', async () => {
          const spaceId = await createSpace('restore-folder-cap');
          const root = await createFolder(spaceId, {
            id: `restore-cap-root-${suffix}`, name: 'Restore me', path: 'pages/Restore me',
          });
          const preview = await service.deleteImpact({ spaceId, folderId: root.id });
          const deletion = await service.deleteFolder({
            spaceId, folderId: root.id,
            expectedTreeRevision: 0n, expectedUpdatedAt: root.updatedAt,
            expectedImpactHash: preview.impactHash, actor,
          });
          await prisma.$executeRaw`
            INSERT INTO "Folder" (
              "id", "spaceId", "parentId", "name", "nameKey", "path", "pathKey",
              "sortOrder", "createdAt", "updatedAt", "lastModifiedAt"
            )
            SELECT
              'restore-cap-active-' || value || ${suffix}, ${spaceId}, NULL,
              'Active ' || value, 'active ' || value,
              'pages/Active ' || value, 'pages/active ' || value,
              value, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM generate_series(1, 10000) AS value
          `;

          await expectCode(service.restoreDeletionBatch({
            spaceId,
            deletionBatchId: deletion.batch.id,
            strategy: { kind: 'original' },
            expectedTreeRevision: 1n,
            expectedUpdatedAt: root.updatedAt,
            actor,
          }), 'FOLDER_COUNT_LIMIT');
          assert.ok((await prisma.folder.findUniqueOrThrow({ where: { id: root.id } })).deletedAt);
          assert.equal(await prisma.folder.count({ where: { spaceId, deletedAt: null } }), 10_000);
          assert.equal((await prisma.contentDeletionBatch.findUniqueOrThrow({
            where: { id: deletion.batch.id },
          })).restoredAt, null);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 1n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 1);
          assert.equal(await prisma.pagePathAlias.count({ where: { spaceId } }), 0);
        });

        await t.test('root and rename-root restore only change the top-level derivation', async () => {
          const rootSpaceId = await createSpace('root-restore');
          const parent = await createFolder(rootSpaceId, {
            id: `root-parent-${suffix}`, name: 'Parent', path: 'pages/Parent',
          });
          const root = await createFolder(rootSpaceId, {
            id: `root-root-${suffix}`, parentId: parent.id, name: 'Root', path: 'pages/Parent/Root',
          });
          const child = await createFolder(rootSpaceId, {
            id: `root-child-${suffix}`, parentId: root.id, name: 'Child', path: 'pages/Parent/Root/Child',
          });
          const page = await createPage(rootSpaceId, {
            id: `root-page-${suffix}`, folderId: child.id, title: 'Page',
            syncPath: 'pages/Parent/Root/Child/Page.md',
          });
          const rootPreview = await service.deleteImpact({ spaceId: rootSpaceId, folderId: root.id });
          const rootDeletion = await service.deleteFolder({
            spaceId: rootSpaceId, folderId: root.id,
            expectedTreeRevision: 0n, expectedUpdatedAt: root.updatedAt,
            expectedImpactHash: rootPreview.impactHash, actor,
          });
          await service.restoreDeletionBatch({
            spaceId: rootSpaceId, deletionBatchId: rootDeletion.batch.id,
            strategy: { kind: 'root' }, expectedTreeRevision: 1n,
            expectedUpdatedAt: root.updatedAt, actor,
          });
          const rootRestored = await prisma.folder.findUniqueOrThrow({ where: { id: root.id } });
          assert.equal(rootRestored.parentId, null);
          assert.equal(rootRestored.path, 'pages/Root');
          assert.equal((await prisma.folder.findUniqueOrThrow({ where: { id: child.id } })).path, 'pages/Root/Child');
          assert.equal((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).syncPath, 'pages/Root/Child/Page.md');

          const renameSpaceId = await createSpace('rename-root-restore');
          const renameParent = await createFolder(renameSpaceId, {
            id: `rename-parent-${suffix}`, name: 'Parent', path: 'pages/Parent',
          });
          const renameRoot = await createFolder(renameSpaceId, {
            id: `rename-restore-root-${suffix}`, parentId: renameParent.id,
            name: 'Root', path: 'pages/Parent/Root',
          });
          const renameChild = await createFolder(renameSpaceId, {
            id: `rename-restore-child-${suffix}`, parentId: renameRoot.id,
            name: 'Child', path: 'pages/Parent/Root/Child',
          });
          const renamePreview = await service.deleteImpact({ spaceId: renameSpaceId, folderId: renameRoot.id });
          const renameDeletion = await service.deleteFolder({
            spaceId: renameSpaceId, folderId: renameRoot.id,
            expectedTreeRevision: 0n, expectedUpdatedAt: renameRoot.updatedAt,
            expectedImpactHash: renamePreview.impactHash, actor,
          });
          await createFolder(renameSpaceId, {
            id: `rename-original-collision-${suffix}`, parentId: renameParent.id,
            name: 'Root', path: 'pages/Parent/Root',
          });
          await service.restoreDeletionBatch({
            spaceId: renameSpaceId, deletionBatchId: renameDeletion.batch.id,
            strategy: { kind: 'rename-root', name: 'Renamed' },
            expectedTreeRevision: 1n, expectedUpdatedAt: renameRoot.updatedAt, actor,
          });
          const renamedRoot = await prisma.folder.findUniqueOrThrow({ where: { id: renameRoot.id } });
          assert.equal(renamedRoot.parentId, renameParent.id);
          assert.equal(renamedRoot.name, 'Renamed');
          assert.equal(renamedRoot.path, 'pages/Parent/Renamed');
          assert.equal((await prisma.folder.findUniqueOrThrow({ where: { id: renameChild.id } })).path, 'pages/Parent/Renamed/Child');
        });

        await t.test('10,000-object rename uses a bounded structural revision query budget', async () => {
          const spaceId = await createSpace('bounded-revision');
          const root = await createFolder(spaceId, {
            id: `bounded-root-${suffix}`, name: 'Boundary', path: 'pages/Boundary',
          });
          await prisma.$executeRaw`
            INSERT INTO "Page" (
              "id", "title", "slug", "knowledgeKey", "content", "format",
              "folderId", "spaceId", "authorId", "syncPath", "syncPathKey",
              "createdAt", "updatedAt", "lastModifiedAt"
            )
            SELECT
              'bounded-page-' || value || ${suffix},
              'Page ' || value,
              'bounded-' || value,
              'bounded-knowledge-' || value || ${suffix},
              '# shared body', 'markdown', ${root.id}, ${spaceId}, ${userId},
              'pages/Boundary/Page ' || value || '.md',
              'pages/boundary/page ' || value || '.md',
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM generate_series(1, 9999) AS value
          `;

          trackedQueryCount = 0;
          trackQueries = true;
          let renamed;
          try {
            renamed = await service.renameFolder({
              spaceId, folderId: root.id, name: 'Renamed boundary',
              expectedTreeRevision: 0n, expectedUpdatedAt: root.updatedAt, actor,
            });
          } finally {
            trackQueries = false;
          }
          assert.equal(renamed.treeRevision, 1n);
          assert.ok(trackedQueryCount <= 60, `expected bounded queries, received ${trackedQueryCount}`);
          console.log(`structural_revision_queries=${trackedQueryCount}`);
          const revision = await prisma.spaceKnowledgeRevision.findFirstOrThrow({ where: { spaceId } });
          assert.equal(revision.pageCount, 9999n);
          assert.equal(await prisma.syncRevisionPageRow.count({
            where: {
              revisionId: revision.id,
              folderId: root.id,
              path: { startsWith: 'pages/Renamed boundary/' },
            },
          }), 9999);
          assert.equal(await prisma.legacyRevisionPageExtra.count({ where: { revisionId: revision.id } }), 9999);
          assert.equal(await prisma.syncRevisionDeltaRow.count({ where: { revisionId: revision.id } }), 9999);
          assert.equal(await prisma.page.count({
            where: { spaceId, syncPath: { startsWith: 'pages/Renamed boundary/' } },
          }), 9999);
        });

        await t.test('10,001 affected objects roll back before batch, alias, or revision writes', async () => {
          const spaceId = await createSpace('mutation-limit');
          const root = await createFolder(spaceId, {
            id: `limit-root-${suffix}`, name: 'Limit', path: 'pages/Limit',
          });
          await prisma.$executeRaw`
            INSERT INTO "Page" (
              "id", "title", "slug", "knowledgeKey", "content", "format",
              "folderId", "spaceId", "authorId", "syncPath", "syncPathKey",
              "createdAt", "updatedAt", "lastModifiedAt"
            )
            SELECT
              'limit-page-' || value || ${suffix},
              'Limit ' || value,
              'limit-' || value,
              'limit-knowledge-' || value || ${suffix},
              '', 'markdown', ${root.id}, ${spaceId}, ${userId},
              'pages/Limit/Page-' || value || '.md',
              'pages/limit/page-' || value || '.md',
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM generate_series(1, 10000) AS value
          `;

          await expectCode(service.deleteFolder({
            spaceId,
            folderId: root.id,
            expectedTreeRevision: 0n,
            expectedUpdatedAt: root.updatedAt,
            expectedImpactHash: '0'.repeat(64),
            actor,
          }), 'FOLDER_MUTATION_LIMIT');
          assert.equal(await prisma.contentDeletionBatch.count({ where: { spaceId } }), 0);
          assert.equal(await prisma.page.count({ where: { spaceId, deletedAt: null } }), 10_000);
          assert.equal((await prisma.folder.findUniqueOrThrow({ where: { id: root.id } })).deletedAt, null);
          assert.equal((await prisma.space.findUniqueOrThrow({ where: { id: spaceId } })).contentTreeRevision, 0n);
          assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 0);
        });
      } finally {
        await prisma.$disconnect();
      }
    });
  } catch (error) {
    operationError = error;
  }

  const finalClient = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  let inventoryAfter;
  try {
    inventoryAfter = await captureFolderDatabaseSafetyInventory(adminUrl, finalClient);
  } finally {
    await finalClient.$disconnect();
  }
  assert.equal(await countFolderSchemas(baseDatabaseUrl), 0);
  assert.equal(await countSanitizedMigrationDirectories(), 0);
  assert.deepEqual(inventoryAfter, inventoryBefore);
  const beforeDigest = folderDatabaseSafetyInventoryDigest(inventoryBefore);
  const afterDigest = folderDatabaseSafetyInventoryDigest(inventoryAfter);
  assert.equal(afterDigest, beforeDigest);
  console.log('folder_test_schemas=0');
  console.log('sanitized_temp_dirs=0');
  console.log(`public_inventory_before=${beforeDigest}`);
  console.log(`public_inventory_after=${afterDigest}`);
  console.log('public_inventory_equal=true');
  if (operationError) throw operationError;
});
