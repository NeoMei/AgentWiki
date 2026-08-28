import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { withFolderTestDatabase } from './folder-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const {
  canonicalBytes, contentHash, treeBatchHashV2, treeConfirmationHashV2,
} = requireFromServer('@neomei/agentwiki-sync-protocol');
const { ReadableSyncPathService } = requireFromServer('./dist/core/sync/readable-sync-path.service.js');
const { SpaceRevisionWriterService } = requireFromServer('./dist/core/sync/space-revision-writer.service.js');
const { ContentTreeService } = requireFromServer('./dist/content-tree/content-tree.service.js');
const { PushSessionService } = requireFromServer('./dist/integrations/obsidian/push-session.service.js');

const databaseUrl = process.env.FOLDER_TEST_DATABASE_URL;

test('Sync v2 mixed Folder/Page publish is one ContentTree transaction in real PostgreSQL', {
  skip: databaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is not configured',
  timeout: 300_000,
}, async () => {
  await withFolderTestDatabase(databaseUrl, async ({ databaseUrl: isolatedUrl, schemaName }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: isolatedUrl } } });
    try {
      const suffix = schemaName.slice('folder_test_'.length);
      const userId = `sync-v2-user-${suffix}`;
      const spaceId = `sync-v2-space-${suffix}`;
      await prisma.user.create({ data: {
        id: userId, email: `${userId}@example.test`, type: 'human', platformRole: 'user',
      } });
      await prisma.space.create({ data: { id: spaceId, name: 'Sync v2', slug: spaceId } });
      await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
      const credentialFamilyId = `sync-v2-family-${suffix}`;
      const credentialId = `sync-v2-credential-${suffix}`;
      await prisma.humanDeviceCredentialFamily.create({ data: {
        id: credentialFamilyId, userId, deviceId: `device-${suffix}`, vaultId: `vault-${suffix}`,
      } });
      await prisma.humanDeviceCredential.create({ data: {
        id: credentialId, credentialFamilyId, userId, deviceId: `device-${suffix}`,
        vaultId: `vault-${suffix}`, deviceName: 'Sync v2 test',
        credentialHash: `credential-hash-${suffix}`, status: 'active', activatedAt: new Date(),
      } });

      const writer = new SpaceRevisionWriterService(prisma);
      const tree = new ContentTreeService(prisma, writer, new ReadableSyncPathService());
      const now = '2026-08-29T00:00:00.000Z';
      const body = '# Child\n';
      const bodyHash = await contentHash(body);
      const changes = [
        {
          operation: 'upsert_folder',
          folder: {
            folderId: `root-${suffix}`, parentFolderId: null, name: 'Root', path: 'pages/Root',
            sortOrder: 0, updatedAt: now,
          },
        },
        {
          operation: 'upsert_folder',
          folder: {
            folderId: `child-${suffix}`, parentFolderId: `root-${suffix}`,
            name: 'Child', path: 'pages/Root/Child', sortOrder: 0, updatedAt: now,
          },
        },
        {
          operation: 'upsert_page',
          page: {
            pageId: `page-${suffix}`, folderId: `child-${suffix}`,
            path: 'pages/Root/Child/Page.md', title: 'Page', body,
            contentHash: bodyHash, updatedAt: now,
          },
        },
      ];
      const principal = { userId, platformRole: 'user' };
      const result = await prisma.$transaction((tx) => tree.publishSyncV2Batch(tx, {
        spaceId, baseRevision: '0', changes, actor: { userId }, principal,
        revisionOrigin: { origin: 'obsidian_sync', createdByUserId: userId },
      }));

      assert.equal(result.protocolVersion, '2');
      assert.equal(result.status, 'published');
      assert.equal(result.folderCount, '2');
      assert.equal(result.pageCount, '1');
      assert.ok(result.changeSetId);
      const [folder, page, revision, changeItems, space] = await Promise.all([
        prisma.folder.findUnique({ where: { id: `root-${suffix}` } }),
        prisma.page.findUnique({ where: { knowledgeKey: `page-${suffix}` } }),
        prisma.spaceKnowledgeRevision.findUnique({ where: { id: result.revision } }),
        prisma.changeItem.findMany({ where: { changeSetId: result.changeSetId } }),
        prisma.space.findUnique({ where: { id: spaceId } }),
      ]);
      assert.equal(folder?.sourceChangeSetId, result.changeSetId);
      assert.equal(page?.folderId, `child-${suffix}`);
      assert.equal(page?.sourceChangeSetId, result.changeSetId);
      assert.equal(revision?.sourceChangeSetId, result.changeSetId);
      assert.equal(revision?.schemaVersion, 'content-tree@2');
      assert.deepEqual(changeItems.map((item) => item.type).sort(), ['create_folder', 'create_folder', 'create_page']);
      assert.equal(space?.contentTreeRevision, 1n);

      const countsBefore = await Promise.all([
        prisma.folder.count({ where: { spaceId } }),
        prisma.page.count({ where: { spaceId } }),
        prisma.changeSet.count({ where: { spaceId } }),
        prisma.spaceKnowledgeRevision.count({ where: { spaceId } }),
      ]);
      await assert.rejects(
        prisma.$transaction((tx) => tree.publishSyncV2Batch(tx, {
          spaceId, baseRevision: result.revision,
          changes: [
            {
              operation: 'upsert_folder',
              folder: {
                folderId: `orphan-${suffix}`, parentFolderId: null, name: 'Orphan',
                path: 'pages/Orphan', sortOrder: 1, updatedAt: now,
              },
            },
            {
              operation: 'upsert_page',
              page: {
                pageId: `broken-${suffix}`, folderId: 'missing-folder',
                path: 'pages/Missing/Broken.md', title: 'Broken', body,
                contentHash: bodyHash, updatedAt: now,
              },
            },
          ],
          actor: { userId }, principal,
          revisionOrigin: { origin: 'obsidian_sync', createdByUserId: userId },
        })),
        (error) => error?.code === 'FOLDER_NOT_FOUND',
      );
      assert.deepEqual(await Promise.all([
        prisma.folder.count({ where: { spaceId } }),
        prisma.page.count({ where: { spaceId } }),
        prisma.changeSet.count({ where: { spaceId } }),
        prisma.spaceKnowledgeRevision.count({ where: { spaceId } }),
      ]), countsBefore);

      await assert.rejects(
        prisma.$transaction((tx) => tree.publishSyncV2Batch(tx, {
          spaceId, baseRevision: '0', changes: [{
            operation: 'archive_page', pageId: `page-${suffix}`,
            previousPath: 'pages/Root/Child/Page.md',
          }], actor: { userId }, principal,
          revisionOrigin: { origin: 'obsidian_sync', createdByUserId: userId },
        })),
        (error) => error?.code === 'CONTENT_TREE_CONFLICT',
      );

      const [childBeforeMove, pageBeforeMove] = await Promise.all([
        prisma.folder.findUnique({ where: { id: `child-${suffix}` } }),
        prisma.page.findUnique({ where: { knowledgeKey: `page-${suffix}` } }),
      ]);
      const moved = await prisma.$transaction((tx) => tree.publishSyncV2Batch(tx, {
        spaceId, baseRevision: result.revision, changes: [
          {
            operation: 'upsert_folder',
            folder: {
              folderId: `target-${suffix}`, parentFolderId: null, name: 'Target',
              path: 'pages/Target', sortOrder: 1, updatedAt: now,
            },
          },
          {
            operation: 'upsert_folder',
            folder: {
              folderId: `child-${suffix}`, parentFolderId: `target-${suffix}`, name: 'Child',
              path: 'pages/Target/Child', sortOrder: 0,
              updatedAt: childBeforeMove.updatedAt.toISOString(),
            },
          },
          {
            operation: 'upsert_page',
            page: {
              pageId: `page-${suffix}`, folderId: `child-${suffix}`,
              path: 'pages/Target/Child/Page.md', title: 'Page', body,
              contentHash: bodyHash, updatedAt: pageBeforeMove.updatedAt.toISOString(),
            },
          },
        ], actor: { userId }, principal,
        revisionOrigin: { origin: 'obsidian_sync', createdByUserId: userId },
      }));
      const moveDelta = await prisma.syncRevisionTreeDeltaRow.findMany({
        where: { revisionId: moved.revision }, orderBy: { ordinal: 'asc' },
      });
      assert.deepEqual(moveDelta.map((row) => row.operation), [
        'upsert_folder', 'upsert_folder', 'upsert_page',
      ]);
      assert.deepEqual(moveDelta.map((row) => row.folderId ?? row.pageId), [
        `target-${suffix}`, `child-${suffix}`, `page-${suffix}`,
      ]);

      const archived = await prisma.$transaction((tx) => tree.publishSyncV2Batch(tx, {
        spaceId, baseRevision: moved.revision, changes: [{
          operation: 'archive_folder', folderId: `target-${suffix}`, previousPath: 'pages/Target',
        }], actor: { userId }, principal,
        revisionOrigin: { origin: 'obsidian_sync', createdByUserId: userId },
      }));
      const archiveDelta = await prisma.syncRevisionTreeDeltaRow.findMany({
        where: { revisionId: archived.revision }, orderBy: { ordinal: 'asc' },
      });
      assert.deepEqual(archiveDelta.map((row) => row.operation), [
        'archive_page', 'archive_folder', 'archive_folder',
      ]);
      assert.deepEqual(archiveDelta.map((row) => row.pageId ?? row.folderId), [
        `page-${suffix}`, `child-${suffix}`, `target-${suffix}`,
      ]);

      const [deletedFolders, deletedPage] = await Promise.all([
        prisma.folder.findMany({
          where: { id: { in: [`target-${suffix}`, `child-${suffix}`] } },
          orderBy: { path: 'asc' },
        }),
        prisma.page.findUnique({ where: { knowledgeKey: `page-${suffix}` } }),
      ]);
      assert.equal(new Set(deletedFolders.map((folder) => folder.deletionBatchId)).size, 1);
      assert.equal(deletedPage.deletionBatchId, deletedFolders[0].deletionBatchId);
      const deletedPageHash = await contentHash(deletedPage.content);
      const restored = await prisma.$transaction((tx) => tree.publishSyncV2Batch(tx, {
        spaceId, baseRevision: archived.revision, changes: [
          ...deletedFolders.map((folder) => ({
            operation: 'upsert_folder',
            folder: {
              folderId: folder.id, parentFolderId: folder.parentId, name: folder.name,
              path: folder.path, sortOrder: folder.sortOrder, updatedAt: folder.updatedAt.toISOString(),
            },
          })),
          {
            operation: 'upsert_page',
            page: {
              pageId: deletedPage.knowledgeKey, folderId: deletedPage.folderId,
              path: deletedPage.syncPath, title: deletedPage.title, body: deletedPage.content,
              contentHash: deletedPageHash, updatedAt: deletedPage.updatedAt.toISOString(),
            },
          },
        ], actor: { userId }, principal,
        revisionOrigin: { origin: 'obsidian_sync', createdByUserId: userId },
      }));
      const restoreDelta = await prisma.syncRevisionTreeDeltaRow.findMany({
        where: { revisionId: restored.revision }, orderBy: { ordinal: 'asc' },
      });
      assert.deepEqual(restoreDelta.map((row) => row.operation), [
        'upsert_folder', 'upsert_folder', 'upsert_page',
      ]);
      assert.equal(await prisma.contentDeletionBatch.count({
        where: { id: deletedFolders[0].deletionBatchId, restoredAt: { not: null } },
      }), 1);

      const authorizationCounts = await Promise.all([
        prisma.changeSet.count({ where: { spaceId } }),
        prisma.spaceKnowledgeRevision.count({ where: { spaceId } }),
      ]);
      await prisma.spaceMember.updateMany({ where: { userId, spaceId }, data: { role: 'admin' } });
      await assert.rejects(
        prisma.$transaction((tx) => tree.publishSyncV2Batch(tx, {
          spaceId, baseRevision: restored.revision, changes: [{
            operation: 'archive_page', pageId: `page-${suffix}`,
            previousPath: 'pages/Target/Child/Page.md',
          }], actor: { userId }, principal,
          revisionOrigin: { origin: 'obsidian_sync', createdByUserId: userId },
        })),
        (error) => error?.code === 'CONTENT_TREE_SPACE_READ_ONLY',
      );
      assert.deepEqual(await Promise.all([
        prisma.changeSet.count({ where: { spaceId } }),
        prisma.spaceKnowledgeRevision.count({ where: { spaceId } }),
      ]), authorizationCounts);
      await prisma.spaceMember.updateMany({ where: { userId, spaceId }, data: { role: 'owner' } });

      const flowSpaceId = `sync-v2-flow-space-${suffix}`;
      await prisma.space.create({ data: { id: flowSpaceId, name: 'Sync v2 flow', slug: flowSpaceId } });
      await prisma.spaceMember.create({ data: { userId, spaceId: flowSpaceId, role: 'owner' } });
      const pushes = new PushSessionService(
        prisma,
        { batchReceipt: () => `receipt-${suffix}` },
        tree,
        { indexPage: async () => undefined, deletePageIndex: async () => undefined },
        undefined,
        { enqueue: () => undefined },
      );
      const flowPrincipal = {
        userId, platformRole: 'user', credentialId, credentialFamilyId,
      };
      const flowBody = '# Flow\n';
      const flowBodyHash = await contentHash(flowBody);
      const flowChanges = [
        {
          operation: 'upsert_folder',
          folder: {
            folderId: `flow-folder-${suffix}`, parentFolderId: null, name: 'Flow',
            path: 'pages/Flow', sortOrder: 0, updatedAt: now,
          },
        },
        {
          operation: 'upsert_page',
          page: {
            pageId: `flow-page-${suffix}`, folderId: `flow-folder-${suffix}`,
            path: 'pages/Flow/Page.md', title: 'Page', body: flowBody,
            contentHash: flowBodyHash, updatedAt: now,
          },
        },
      ];
      const flowManifest = {
        protocolVersion: '2', spaceId: flowSpaceId, baseRevision: '0',
        changes: flowChanges.map((change) => change.operation === 'upsert_page'
          ? { operation: change.operation, page: {
            pageId: change.page.pageId, folderId: change.page.folderId,
            path: change.page.path, title: change.page.title,
            contentHash: change.page.contentHash, updatedAt: change.page.updatedAt,
          } }
          : change),
      };
      const flowConfirmationHash = await treeConfirmationHashV2(flowManifest);
      const session = await pushes.createV2(flowPrincipal, flowSpaceId, {
        protocolVersion: '2', baseRevision: '0',
        idempotencyKey: `11111111-1111-4111-8111-${suffix.slice(0, 12)}`,
        capabilitiesHash: await pushes.capabilityHashV2(),
        confirmationHash: flowConfirmationHash,
        confirmationByteLength: canonicalBytes(flowManifest).byteLength,
        changeCount: flowChanges.length,
        totalBodyBytes: Buffer.byteLength(flowBody, 'utf8'),
      });
      const flowBatchWithoutHash = { protocolVersion: '2', batchIndex: 0, changes: flowChanges };
      const flowBatch = {
        ...flowBatchWithoutHash, batchHash: await treeBatchHashV2(flowBatchWithoutHash),
      };
      await pushes.uploadV2(flowPrincipal, flowSpaceId, session.sessionId, flowBatch);
      const finalized = await pushes.finalizeV2(flowPrincipal, flowSpaceId, session.sessionId, {
        protocolVersion: '2', confirmationHash: flowConfirmationHash, userConfirmed: true,
      });
      assert.equal(finalized.protocolVersion, '2');
      assert.equal(finalized.status, 'published');
      assert.equal(finalized.folderCount, '1');
      assert.equal(finalized.pageCount, '1');
      assert.deepEqual(await pushes.finalizeV2(
        flowPrincipal, flowSpaceId, session.sessionId,
        { protocolVersion: '2', confirmationHash: flowConfirmationHash, userConfirmed: true },
      ), finalized);
    } finally {
      await prisma.$disconnect();
    }
  });
});
