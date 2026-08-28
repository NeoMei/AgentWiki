import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { withFolderTestDatabase } from './folder-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const {
  canonicalBytes, contentHash, pathKey, treeBatchHashV2, treeConfirmationHashV2,
} = requireFromServer('@neomei/agentwiki-sync-protocol');
const { ReadableSyncPathService } = requireFromServer('./dist/core/sync/readable-sync-path.service.js');
const { SpaceRevisionWriterService } = requireFromServer('./dist/core/sync/space-revision-writer.service.js');
const { ContentTreeService } = requireFromServer('./dist/content-tree/content-tree.service.js');
const { PushSessionService } = requireFromServer('./dist/integrations/obsidian/push-session.service.js');
const { SyncV2RevisionService } = requireFromServer('./dist/integrations/obsidian/sync-v2-revision.service.js');

const databaseUrl = process.env.FOLDER_TEST_DATABASE_URL;

const expectSyncCode = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.syncCode, code);
    return true;
  });
};

const assertPending = async (promise, message) => {
  const state = await Promise.race([
    promise.then(() => 'settled', () => 'settled'),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 40)),
  ]);
  assert.equal(state, 'pending', message);
};

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

      const crossV1Batch = {
        protocolVersion: '1', batchIndex: 0, batchHash: 'a'.repeat(64), changes: [],
      };
      await expectSyncCode(
        pushes.upload(flowPrincipal, flowSpaceId, session.sessionId, crossV1Batch),
        'PUSH_SESSION_NOT_FOUND',
      );
      await expectSyncCode(pushes.get(flowPrincipal, flowSpaceId, session.sessionId), 'PUSH_SESSION_NOT_FOUND');
      await expectSyncCode(pushes.abort(flowPrincipal, flowSpaceId, session.sessionId), 'PUSH_SESSION_NOT_FOUND');
      await expectSyncCode(
        pushes.finalize(flowPrincipal, flowSpaceId, session.sessionId, flowConfirmationHash),
        'PUSH_SESSION_NOT_FOUND',
      );

      const v1SpaceId = `sync-v1-protocol-space-${suffix}`;
      await prisma.space.create({ data: { id: v1SpaceId, name: 'Sync v1 protocol', slug: v1SpaceId } });
      await prisma.spaceMember.create({ data: { userId, spaceId: v1SpaceId, role: 'owner' } });
      const v1Session = await pushes.create(flowPrincipal, v1SpaceId, {
        baseRevision: '0', idempotencyKey: `33333333-3333-4333-8333-${suffix.slice(0, 12)}`,
        capabilitiesHash: await pushes.capabilityHash(), confirmationHash: 'b'.repeat(64),
        confirmationByteLength: 0, changeCount: 0, totalBodyBytes: 0,
      });
      const crossV2Batch = {
        protocolVersion: '2', batchIndex: 0, batchHash: 'c'.repeat(64), changes: [],
      };
      await expectSyncCode(
        pushes.uploadV2(flowPrincipal, v1SpaceId, v1Session.sessionId, crossV2Batch),
        'PUSH_SESSION_NOT_FOUND',
      );
      await expectSyncCode(pushes.getV2(flowPrincipal, v1SpaceId, v1Session.sessionId), 'PUSH_SESSION_NOT_FOUND');
      await expectSyncCode(pushes.abortV2(flowPrincipal, v1SpaceId, v1Session.sessionId), 'PUSH_SESSION_NOT_FOUND');
      await expectSyncCode(pushes.finalizeV2(flowPrincipal, v1SpaceId, v1Session.sessionId, {
        protocolVersion: '2', confirmationHash: 'b'.repeat(64), userConfirmed: true,
      }), 'PUSH_SESSION_NOT_FOUND');

      const concurrentSpaceId = `sync-v2-concurrent-space-${suffix}`;
      await prisma.space.create({ data: {
        id: concurrentSpaceId, name: 'Sync v2 concurrent', slug: concurrentSpaceId,
      } });
      await prisma.spaceMember.create({ data: { userId, spaceId: concurrentSpaceId, role: 'owner' } });
      const concurrentChanges = [{
        operation: 'upsert_folder',
        folder: {
          folderId: `concurrent-folder-${suffix}`, parentFolderId: null, name: 'Concurrent',
          path: 'pages/Concurrent', sortOrder: 0, updatedAt: now,
        },
      }];
      const concurrentManifest = {
        protocolVersion: '2', spaceId: concurrentSpaceId, baseRevision: '0', changes: concurrentChanges,
      };
      const concurrentHash = await treeConfirmationHashV2(concurrentManifest);
      const concurrentSession = await pushes.createV2(flowPrincipal, concurrentSpaceId, {
        protocolVersion: '2', baseRevision: '0',
        idempotencyKey: `44444444-4444-4444-8444-${suffix.slice(0, 12)}`,
        capabilitiesHash: await pushes.capabilityHashV2(), confirmationHash: concurrentHash,
        confirmationByteLength: canonicalBytes(concurrentManifest).byteLength,
        changeCount: 1, totalBodyBytes: 0,
      });
      const concurrentBatchWithoutHash = {
        protocolVersion: '2', batchIndex: 0, changes: concurrentChanges,
      };
      await pushes.uploadV2(flowPrincipal, concurrentSpaceId, concurrentSession.sessionId, {
        ...concurrentBatchWithoutHash,
        batchHash: await treeBatchHashV2(concurrentBatchWithoutHash),
      });
      const revisionsBeforeConcurrentFinalize = await prisma.spaceKnowledgeRevision.count({
        where: { spaceId: concurrentSpaceId },
      });
      const concurrentResults = await Promise.all([
        pushes.finalizeV2(flowPrincipal, concurrentSpaceId, concurrentSession.sessionId, {
          protocolVersion: '2', confirmationHash: concurrentHash, userConfirmed: true,
        }),
        pushes.finalizeV2(flowPrincipal, concurrentSpaceId, concurrentSession.sessionId, {
          protocolVersion: '2', confirmationHash: concurrentHash, userConfirmed: true,
        }),
      ]);
      assert.deepEqual(concurrentResults[1], concurrentResults[0]);
      assert.equal(await prisma.spaceKnowledgeRevision.count({
        where: { spaceId: concurrentSpaceId },
      }), revisionsBeforeConcurrentFinalize + 1);

      const beforeRowSpaceId = `sync-v2-policy-before-${suffix}`;
      await prisma.space.create({ data: {
        id: beforeRowSpaceId, name: 'Sync v2 policy before', slug: beforeRowSpaceId,
      } });
      await prisma.spaceMember.create({ data: { userId, spaceId: beforeRowSpaceId, role: 'owner' } });
      const beforeManifest = { protocolVersion: '2', spaceId: beforeRowSpaceId, baseRevision: '0', changes: [] };
      const beforeHash = await treeConfirmationHashV2(beforeManifest);
      const beforeSession = await pushes.createV2(flowPrincipal, beforeRowSpaceId, {
        protocolVersion: '2', baseRevision: '0',
        idempotencyKey: `55555555-5555-4555-8555-${suffix.slice(0, 12)}`,
        capabilitiesHash: await pushes.capabilityHashV2(), confirmationHash: beforeHash,
        confirmationByteLength: canonicalBytes(beforeManifest).byteLength,
        changeCount: 0, totalBodyBytes: 0,
      });
      await prisma.space.update({ where: { id: beforeRowSpaceId }, data: { deletedAt: new Date() } });
      await expectSyncCode(pushes.finalizeV2(flowPrincipal, beforeRowSpaceId, beforeSession.sessionId, {
        protocolVersion: '2', confirmationHash: beforeHash, userConfirmed: true,
      }), 'SPACE_FORBIDDEN');

      const afterRowSpaceId = `sync-v2-policy-after-${suffix}`;
      await prisma.space.create({ data: {
        id: afterRowSpaceId, name: 'Sync v2 policy after', slug: afterRowSpaceId,
      } });
      await prisma.spaceMember.create({ data: { userId, spaceId: afterRowSpaceId, role: 'owner' } });
      const afterManifest = { protocolVersion: '2', spaceId: afterRowSpaceId, baseRevision: '0', changes: [] };
      const afterHash = await treeConfirmationHashV2(afterManifest);
      const afterSession = await pushes.createV2(flowPrincipal, afterRowSpaceId, {
        protocolVersion: '2', baseRevision: '0',
        idempotencyKey: `66666666-6666-4666-8666-${suffix.slice(0, 12)}`,
        capabilitiesHash: await pushes.capabilityHashV2(), confirmationHash: afterHash,
        confirmationByteLength: canonicalBytes(afterManifest).byteLength,
        changeCount: 0, totalBodyBytes: 0,
      });
      const originalSyncLock = tree.lockSyncMutationSpace;
      let rowAcquiredResolve;
      let releaseRowResolve;
      const rowAcquired = new Promise((resolve) => { rowAcquiredResolve = resolve; });
      const releaseRow = new Promise((resolve) => { releaseRowResolve = resolve; });
      tree.lockSyncMutationSpace = async (...args) => {
        const locked = await originalSyncLock.call(tree, ...args);
        if (args[1] === afterRowSpaceId) {
          rowAcquiredResolve();
          await releaseRow;
        }
        return locked;
      };
      let afterFinalize;
      let afterDelete;
      try {
        afterFinalize = pushes.finalizeV2(flowPrincipal, afterRowSpaceId, afterSession.sessionId, {
          protocolVersion: '2', confirmationHash: afterHash, userConfirmed: true,
        });
        void afterFinalize.catch(() => undefined);
        await rowAcquired;
        afterDelete = prisma.space.update({
          where: { id: afterRowSpaceId }, data: { deletedAt: new Date() },
        });
        void afterDelete.catch(() => undefined);
        await assertPending(afterDelete, 'Space policy update must wait behind the Sync Space row lock');
        releaseRowResolve();
        assert.equal((await afterFinalize).status, 'noop');
        await afterDelete;
      } finally {
        releaseRowResolve();
        tree.lockSyncMutationSpace = originalSyncLock;
        await Promise.allSettled([afterFinalize, afterDelete].filter(Boolean));
      }

      const immutableReader = new SyncV2RevisionService(
        prisma,
        {
          encode: (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url'),
          decode: (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
        },
        { capabilitiesV2: () => ({ maxResponseBytes: 4 * 1024 * 1024 }) },
      );
      const chainHead = await prisma.spaceKnowledgeRevision.findFirst({
        where: { spaceId }, orderBy: { sequence: 'desc' },
      });
      assert.ok(chainHead?.parentRevisionId, 'real v2 chain needs a parent for integrity coverage');
      await immutableReader.snapshot(spaceId, chainHead.id, undefined, 100);
      const chainParent = await prisma.spaceKnowledgeRevision.findUnique({
        where: { id: chainHead.parentRevisionId },
      });
      assert.ok(chainParent);
      await prisma.spaceKnowledgeRevision.update({
        where: { id: chainParent.id }, data: { parentRevisionId: chainParent.id },
      });
      try {
        await expectSyncCode(
          immutableReader.snapshot(spaceId, chainHead.id, undefined, 100),
          'REVISION_GONE',
        );
      } finally {
        await prisma.spaceKnowledgeRevision.update({
          where: { id: chainParent.id }, data: { parentRevisionId: chainParent.parentRevisionId },
        });
      }
      await immutableReader.snapshot(spaceId, chainHead.id, undefined, 100);

      const archiveSpaceId = `sync-v2-archive-space-${suffix}`;
      const archiveFolderId = `sync-v2-archive-folder-${suffix}`;
      await prisma.space.create({ data: {
        id: archiveSpaceId, name: 'Sync v2 archive boundary', slug: archiveSpaceId,
      } });
      await prisma.spaceMember.create({ data: { userId, spaceId: archiveSpaceId, role: 'owner' } });
      await prisma.folder.create({ data: {
        id: archiveFolderId, spaceId: archiveSpaceId, parentId: null,
        name: 'Archive boundary', nameKey: 'archive boundary',
        path: 'pages/Archive boundary', pathKey: pathKey('pages/Archive boundary'),
        sortOrder: 0, createdByUserId: userId, lastModifiedByUserId: userId,
      } });
      const archivePages = Array.from({ length: 9_999 }, (_, index) => ({
        id: `archive-row-${suffix}-${index}`,
        knowledgeKey: `archive-key-${suffix}-${index}`,
        title: `Archive ${index}`,
        slug: `archive-${index}`,
        content: `# Archive ${index}\n`,
        folderId: archiveFolderId,
        spaceId: archiveSpaceId,
        authorId: userId,
        sortOrder: index,
        syncPath: `pages/Archive boundary/Archive ${index}.md`,
        syncPathKey: pathKey(`pages/Archive boundary/Archive ${index}.md`),
        lastModifiedByUserId: userId,
      }));
      await prisma.page.createMany({ data: archivePages });
      const queryPrisma = new PrismaClient({
        datasources: { db: { url: isolatedUrl } },
        log: [{ emit: 'event', level: 'query' }],
      });
      let archiveQueryCount = 0;
      queryPrisma.$on('query', () => { archiveQueryCount += 1; });
      try {
        const queryWriter = new SpaceRevisionWriterService(queryPrisma);
        const queryTree = new ContentTreeService(
          queryPrisma, queryWriter, new ReadableSyncPathService(),
        );
        const archiveResult = await queryPrisma.$transaction((tx) => queryTree.publishSyncV2Batch(tx, {
          spaceId: archiveSpaceId,
          baseRevision: '0',
          changes: [{
            operation: 'archive_folder', folderId: archiveFolderId,
            previousPath: 'pages/Archive boundary',
          }],
          actor: { userId }, principal,
          revisionOrigin: { origin: 'obsidian_sync', createdByUserId: userId },
        }), { timeout: 120_000 });
        assert.equal(archiveResult.status, 'published');
        assert.equal(await queryPrisma.pageVersion.count({
          where: { page: { spaceId: archiveSpaceId } },
        }), 9_999);
        console.log(`recursive_archive_queries=${archiveQueryCount}`);
        assert.ok(
          archiveQueryCount <= 80,
          `recursive 10,000-node archive used ${archiveQueryCount} queries`,
        );
      } finally {
        await queryPrisma.$disconnect();
      }
    } finally {
      await prisma.$disconnect();
    }
  });
});
