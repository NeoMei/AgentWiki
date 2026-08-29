import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { withFolderTestDatabase } from './folder-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { pathKey } = requireFromServer('@neomei/agentwiki-sync-protocol');
const { ReadableSyncPathService } = requireFromServer('./dist/core/sync/readable-sync-path.service.js');
const { SpaceRevisionWriterService } = requireFromServer('./dist/core/sync/space-revision-writer.service.js');
const { RevisionRetentionService } = requireFromServer('./dist/core/sync/revision-retention.service.js');
const { ContentTreeService } = requireFromServer('./dist/content-tree/content-tree.service.js');
const { SyncV2RevisionService } = requireFromServer('./dist/integrations/obsidian/sync-v2-revision.service.js');

const databaseUrl = process.env.FOLDER_TEST_DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1_000;
const OLD = new Date(Date.now() - 40 * DAY_MS);

const cursorCodec = {
  encode: (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url'),
  decode: (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
};

const expectSyncCode = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.syncCode, code);
    return true;
  });
};

const assertPending = async (promise, message) => {
  const state = await Promise.race([
    promise.then(() => 'settled', () => 'settled'),
    new Promise((resolve) => setTimeout(() => resolve('pending'), 50)),
  ]);
  assert.equal(state, 'pending', message);
};

test('v2 revision retention checkpoints are bounded, atomic, and fail closed', {
  skip: databaseUrl ? false : 'FOLDER_TEST_DATABASE_URL is not configured',
  timeout: 300_000,
}, async () => {
  await withFolderTestDatabase(databaseUrl, async ({ databaseUrl: isolatedUrl, schemaName }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: isolatedUrl } } });
    try {
      const suffix = schemaName.slice('folder_test_'.length);
      const userId = `retention-user-${suffix}`;
      await prisma.user.create({ data: {
        id: userId,
        email: `${userId}@example.test`,
        type: 'human',
        platformRole: 'user',
      } });

      const writer = new SpaceRevisionWriterService(prisma);
      const tree = new ContentTreeService(prisma, writer, new ReadableSyncPathService());
      const retention = new RevisionRetentionService(prisma);
      const reader = new SyncV2RevisionService(
        prisma,
        cursorCodec,
        { capabilitiesV2: () => ({ maxResponseBytes: 4 * 1024 * 1024 }) },
      );
      const principal = { userId, platformRole: 'user' };
      const checkpointTables = await prisma.$queryRaw`
        SELECT count(*)::int AS count
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'SpaceRevisionChainCheckpoint'
      `;
      assert.equal(checkpointTables[0]?.count, 1, 'additive checkpoint table must exist');

      const createSpace = async (label) => {
        const spaceId = `retention-${label}-${suffix}`;
        await prisma.space.create({ data: { id: spaceId, name: label, slug: spaceId } });
        await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
        return spaceId;
      };

      const initialRevision = async (spaceId, label) => {
        const folderId = `${label}-folder-${suffix}`;
        const published = await prisma.$transaction((tx) => tree.publishSyncV2Batch(tx, {
          spaceId,
          baseRevision: '0',
          changes: [{
            operation: 'upsert_folder',
            folder: {
              folderId,
              parentFolderId: null,
              name: label,
              path: `pages/${label}`,
              sortOrder: 0,
              updatedAt: '2026-08-29T00:00:00.000Z',
            },
          }],
          actor: { userId },
          principal,
          revisionOrigin: { origin: 'obsidian_sync', createdByUserId: userId },
        }));
        return published.revision;
      };

      const nextRevision = async (spaceId, origin = {}) => prisma.$transaction(async (tx) => {
        const locked = await writer.lockSpace(tx, spaceId);
        const result = await writer.advanceStructuralPagesLocked(locked, spaceId, [], {
          origin: 'web_editor',
          createdByUserId: userId,
          ...origin,
        });
        return result.revisionId;
      });

      const expire = async (...revisionIds) => {
        await prisma.spaceKnowledgeRevision.updateMany({
          where: { id: { in: revisionIds } },
          data: { createdAt: OLD, supersededAt: OLD },
        });
      };

      // Normal retention must preserve the retained v2 head, delta, and next writer.
      const normalSpace = await createSpace('normal');
      const normal1 = await initialRevision(normalSpace, 'Normal');
      const normal2 = await nextRevision(normalSpace);
      const normal3 = await nextRevision(normalSpace);
      const prunedCursor = cursorCodec.encode({
        kind: 'snapshot-v2',
        spaceId: normalSpace,
        revision: normal1,
        lastPageId: `folder:Normal-folder-${suffix}`,
      });
      await expire(normal1, normal2);
      await reader.snapshot(normalSpace, normal3, undefined, 100);

      assert.equal(await retention.cleanSpace(normalSpace), 2);
      const checkpoint1 = await prisma.spaceRevisionChainCheckpoint.findUnique({
        where: { spaceId: normalSpace },
      });
      assert.equal(checkpoint1?.boundaryRevisionId, normal2);
      assert.equal(checkpoint1?.boundarySequence, 2);
      assert.equal(checkpoint1?.anchorRevisionId, normal3);
      assert.equal(checkpoint1?.anchorSequence, 3);
      assert.equal(checkpoint1?.anchorParentRevisionId, normal2);
      assert.equal(await prisma.spaceRevisionChainCheckpoint.count({ where: { spaceId: normalSpace } }), 1);
      assert.deepEqual(
        (await prisma.spaceKnowledgeRevision.findMany({
          where: { spaceId: normalSpace }, orderBy: { sequence: 'asc' }, select: { id: true },
        })).map((row) => row.id),
        [normal3],
      );
      await expectSyncCode(reader.snapshot(normalSpace, normal1, undefined, 100), 'REVISION_GONE');
      await expectSyncCode(reader.snapshot(normalSpace, 'current', prunedCursor, 100), 'REVISION_GONE');
      assert.equal((await reader.head(normalSpace)).revision, normal3);
      assert.equal((await reader.snapshot(normalSpace, normal3, undefined, 100)).revision, normal3);
      assert.equal((await reader.delta(normalSpace, '0', undefined, 100)).toRevision, normal3);

      const normal4 = await nextRevision(normalSpace);
      assert.equal((await reader.snapshot(normalSpace, normal4, undefined, 100)).revision, normal4);
      await expire(normal3);
      assert.equal(await retention.cleanSpace(normalSpace), 1);
      const checkpoint2 = await prisma.spaceRevisionChainCheckpoint.findUnique({
        where: { spaceId: normalSpace },
      });
      assert.equal(checkpoint2?.boundaryRevisionId, normal3);
      assert.equal(checkpoint2?.boundarySequence, 3);
      assert.equal(checkpoint2?.anchorRevisionId, normal4);
      assert.notEqual(checkpoint2?.rollingChainHash, checkpoint1?.rollingChainHash);
      assert.equal(await prisma.spaceRevisionChainCheckpoint.count({ where: { spaceId: normalSpace } }), 1);
      assert.equal(await retention.cleanSpace(normalSpace), 0);

      // A fresh/non-contiguous row stops pruning; later expired rows cannot be skipped.
      const holeSpace = await createSpace('hole');
      const hole1 = await initialRevision(holeSpace, 'Hole');
      const hole2 = await nextRevision(holeSpace);
      const hole3 = await nextRevision(holeSpace);
      const hole4 = await nextRevision(holeSpace);
      await expire(hole1, hole3);
      assert.equal(await retention.cleanSpace(holeSpace), 1);
      assert.deepEqual(
        (await prisma.spaceKnowledgeRevision.findMany({
          where: { spaceId: holeSpace }, orderBy: { sequence: 'asc' }, select: { id: true },
        })).map((row) => row.id),
        [hole2, hole3, hole4],
      );
      assert.equal(await retention.cleanSpace(holeSpace), 0);
      await expire(hole2);
      assert.equal(await retention.cleanSpace(holeSpace), 2);
      assert.equal(await prisma.spaceRevisionChainCheckpoint.count({ where: { spaceId: holeSpace } }), 1);
      assert.equal((await prisma.spaceRevisionChainCheckpoint.findUnique({
        where: { spaceId: holeSpace },
      }))?.boundaryRevisionId, hole3);

      // A physical v2 ancestry gap is corruption, never a new pruning boundary.
      const gapSpace = await createSpace('gap');
      const gap1 = await initialRevision(gapSpace, 'Gap');
      const gap2 = await nextRevision(gapSpace);
      const gap3 = await nextRevision(gapSpace);
      await nextRevision(gapSpace);
      await expire(gap1, gap3);
      await prisma.spaceKnowledgeRevision.delete({ where: { id: gap2 } });
      await assert.rejects(retention.cleanSpace(gapSpace));
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { id: gap1 } }), 1);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { id: gap3 } }), 1);
      assert.equal(await prisma.spaceRevisionChainCheckpoint.count({ where: { spaceId: gapSpace } }), 0);

      // Retention and a real writer serialize on the same Space advisory lock.
      const concurrentSpace = await createSpace('concurrent');
      const concurrent1 = await initialRevision(concurrentSpace, 'Concurrent');
      await nextRevision(concurrentSpace);
      await expire(concurrent1);
      let acquiredResolve;
      let releaseResolve;
      const acquired = new Promise((resolve) => { acquiredResolve = resolve; });
      const release = new Promise((resolve) => { releaseResolve = resolve; });
      const heldWriter = prisma.$transaction(async (tx) => {
        const locked = await writer.lockSpace(tx, concurrentSpace);
        acquiredResolve();
        await release;
        return writer.advanceStructuralPagesLocked(locked, concurrentSpace, [], {
          origin: 'web_editor', createdByUserId: userId,
        });
      });
      void heldWriter.catch(() => undefined);
      await acquired;
      const waitingRetention = retention.cleanSpace(concurrentSpace);
      void waitingRetention.catch(() => undefined);
      await assertPending(waitingRetention, 'retention must wait behind the writer advisory lock');
      releaseResolve();
      const [concurrentWrite, concurrentRemoved] = await Promise.all([heldWriter, waitingRetention]);
      assert.equal(concurrentRemoved, 1);
      assert.equal((await reader.head(concurrentSpace)).revision, concurrentWrite.revisionId);

      // Corrupt immutable v2 evidence must not be washed into a checkpoint.
      const corruptSpace = await createSpace('corrupt');
      const corrupt1 = await initialRevision(corruptSpace, 'Corrupt');
      await nextRevision(corruptSpace);
      await expire(corrupt1);
      const corruptSidecar = await prisma.legacyRevisionSidecar.findUnique({
        where: { revisionId: corrupt1 },
      });
      corruptSidecar.sidecar.spaceFolderMigration.v2Revision.revisionContentHash = 'f'.repeat(64);
      await prisma.legacyRevisionSidecar.update({
        where: { revisionId: corrupt1 }, data: { sidecar: corruptSidecar.sidecar },
      });
      await assert.rejects(retention.cleanSpace(corruptSpace));
      assert.equal(await prisma.spaceRevisionChainCheckpoint.count({ where: { spaceId: corruptSpace } }), 0);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { id: corrupt1 } }), 1);

      // A delete failure rolls back both the checkpoint upsert and all earlier heavy-row deletes.
      const rollbackSpace = await createSpace('rollback');
      const rollback1 = await initialRevision(rollbackSpace, 'Rollback');
      await nextRevision(rollbackSpace);
      await expire(rollback1);
      const functionName = `retention_fail_${suffix}`;
      const triggerName = `retention_fail_trigger_${suffix}`;
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD."id" = '${rollback1}' THEN RAISE EXCEPTION 'forced retention rollback'; END IF;
          RETURN OLD;
        END $$
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "${triggerName}" BEFORE DELETE ON "SpaceKnowledgeRevision"
        FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
      `);
      await assert.rejects(retention.cleanSpace(rollbackSpace));
      assert.equal(await prisma.spaceRevisionChainCheckpoint.count({ where: { spaceId: rollbackSpace } }), 0);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { id: rollback1 } }), 1);
      assert.ok(await prisma.syncRevisionFolderRow.count({ where: { revisionId: rollback1 } }) > 0);
      await prisma.$executeRawUnsafe(`DROP TRIGGER "${triggerName}" ON "SpaceKnowledgeRevision"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${functionName}"()`);

      // Missing or tampered checkpoint fields fail readers and writers closed.
      const saved = await prisma.spaceRevisionChainCheckpoint.findUnique({
        where: { spaceId: normalSpace },
      });
      assert.ok(saved);
      await prisma.spaceRevisionChainCheckpoint.delete({ where: { spaceId: normalSpace } });
      await expectSyncCode(reader.snapshot(normalSpace, normal4, undefined, 100), 'REVISION_GONE');
      await assert.rejects(nextRevision(normalSpace), (error) => error?.code === 'CONTENT_TREE_REVISION_GONE');
      await prisma.spaceRevisionChainCheckpoint.create({ data: saved });
      const fieldMutations = [
        {
          boundarySequence: saved.boundarySequence + 1,
          anchorSequence: saved.anchorSequence + 1,
        },
        {
          boundaryRevisionId: `${saved.boundaryRevisionId}-wrong`,
          anchorParentRevisionId: `${saved.boundaryRevisionId}-wrong`,
        },
        { boundaryParentRevisionId: `${saved.boundaryParentRevisionId}-wrong` },
        { boundaryRevisionContentHash: 'c'.repeat(64) },
        { rollingChainHash: 'd'.repeat(64) },
        { anchorRevisionId: `${saved.anchorRevisionId}-wrong` },
        { anchorRevisionContentHash: 'c'.repeat(64) },
        { anchorTreeDeltaHash: 'd'.repeat(64) },
        { evidenceHash: 'e'.repeat(64) },
      ];
      for (const mutation of fieldMutations) {
        await prisma.spaceRevisionChainCheckpoint.update({
          where: { spaceId: normalSpace }, data: mutation,
        });
        await expectSyncCode(reader.snapshot(normalSpace, normal4, undefined, 100), 'REVISION_GONE');
        await assert.rejects(nextRevision(normalSpace), (error) => error?.code === 'CONTENT_TREE_REVISION_GONE');
        await prisma.spaceRevisionChainCheckpoint.update({ where: { spaceId: normalSpace }, data: saved });
      }
      await assert.rejects(
        prisma.spaceRevisionChainCheckpoint.update({
          where: { spaceId: normalSpace }, data: { contractVersion: 'revision-chain-checkpoint@2' },
        }),
      );
      await assert.rejects(
        prisma.spaceRevisionChainCheckpoint.update({
          where: { spaceId: normalSpace }, data: { evidenceHash: null },
        }),
      );
      await assert.rejects(
        prisma.spaceRevisionChainCheckpoint.update({
          where: { spaceId: normalSpace }, data: { anchorSequence: saved.anchorSequence + 1 },
        }),
      );
      await assert.rejects(
        prisma.spaceRevisionChainCheckpoint.update({
          where: { spaceId: normalSpace }, data: { anchorParentRevisionId: 'wrong' },
        }),
      );

      const wrongSpace = await createSpace('wrong-space');
      await prisma.spaceRevisionChainCheckpoint.update({
        where: { spaceId: normalSpace }, data: { spaceId: wrongSpace },
      });
      await expectSyncCode(reader.snapshot(normalSpace, normal4, undefined, 100), 'REVISION_GONE');
      await prisma.spaceRevisionChainCheckpoint.update({
        where: { spaceId: wrongSpace }, data: { spaceId: normalSpace },
      });

      // The anchor delta itself is immutable evidence, not merely a row count.
      const anchorSidecar = await prisma.legacyRevisionSidecar.findUnique({
        where: { revisionId: normal4 },
      });
      anchorSidecar.sidecar.spaceFolderMigration.v2Revision.treeDeltaCount = '1';
      await prisma.legacyRevisionSidecar.update({
        where: { revisionId: normal4 }, data: { sidecar: anchorSidecar.sidecar },
      });
      await prisma.syncRevisionTreeDeltaRow.create({ data: {
        revisionId: normal4,
        ordinal: 0,
        operation: 'upsert_folder',
        folderId: `tampered-${suffix}`,
        pageId: null,
        previousPath: null,
        contentHash: null,
      } });
      await expectSyncCode(reader.snapshot(normalSpace, normal4, undefined, 100), 'REVISION_GONE');
      await assert.rejects(nextRevision(normalSpace), (error) => error?.code === 'CONTENT_TREE_REVISION_GONE');
      await prisma.syncRevisionTreeDeltaRow.deleteMany({ where: { revisionId: normal4 } });
      anchorSidecar.sidecar.spaceFolderMigration.v2Revision.treeDeltaCount = '0';
      await prisma.legacyRevisionSidecar.update({
        where: { revisionId: normal4 }, data: { sidecar: anchorSidecar.sidecar },
      });
      assert.equal((await reader.head(normalSpace)).revision, normal4);

      // Already-pruned legacy history may bootstrap only at the exact Task 6 v2 migration genesis.
      const bootstrapSpace = await createSpace('bootstrap');
      const legacy1 = `legacy-1-${suffix}`;
      const legacy2 = `legacy-2-${suffix}`;
      const legacyData = (id, sequence, parentRevisionId) => ({
        id, spaceId: bootstrapSpace, sequence, parentRevisionId,
        schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none',
        contentHash: '1'.repeat(64), revisionContentHash: '1'.repeat(64),
        snapshot: null, delta: null, pageCount: 0n,
        revisionBodyBytes: 0n, revisionManifestByteLength: 0n,
        origin: 'web_editor', createdAt: OLD, supersededAt: OLD,
      });
      await prisma.spaceKnowledgeRevision.create({ data: legacyData(legacy1, 1, null) });
      await prisma.spaceKnowledgeRevision.create({ data: legacyData(legacy2, 2, legacy1) });
      await prisma.spaceKnowledgeRevision.delete({ where: { id: legacy1 } });

      const genesis = await prisma.$transaction(async (tx) => {
        const locked = await writer.lockSpace(tx, bootstrapSpace);
        await locked.folder.create({ data: {
          id: `bootstrap-folder-${suffix}`,
          spaceId: bootstrapSpace,
          parentId: null,
          name: 'Bootstrap',
          nameKey: 'bootstrap',
          path: 'pages/Bootstrap',
          pathKey: pathKey('pages/Bootstrap'),
          sortOrder: 0,
        } });
        return writer.advanceStructuralPagesLocked(locked, bootstrapSpace, [], {
          origin: 'migration',
          migrationBatchId: `space-folders-v1:${bootstrapSpace}`,
          legacySidecarOverride: {
            spaceFolderMigration: {
              version: 1,
              status: 'completed',
              batchKey: `space-folders-v1:${bootstrapSpace}`,
              inputHash: 'b'.repeat(64),
            },
          },
        });
      });
      assert.equal((await reader.snapshot(bootstrapSpace, genesis.revisionId, undefined, 100)).revision, genesis.revisionId);
      const ordinary = await nextRevision(bootstrapSpace);
      assert.equal((await reader.snapshot(bootstrapSpace, ordinary, undefined, 100)).revision, ordinary);

      // An exact migration marker is trusted only when it is the first retained
      // v2 evidence. Earlier v2 ancestry may not be hidden behind that marker.
      await prisma.spaceKnowledgeRevision.update({
        where: { id: legacy2 }, data: { schemaVersion: 'content-tree@2' },
      });
      await expectSyncCode(reader.snapshot(bootstrapSpace, ordinary, undefined, 100), 'REVISION_GONE');
      await assert.rejects(
        nextRevision(bootstrapSpace),
        (error) => error?.code === 'CONTENT_TREE_REVISION_GONE',
      );
      await prisma.spaceKnowledgeRevision.update({
        where: { id: legacy2 }, data: { schemaVersion: 'knowledge-bundle@1' },
      });
      assert.equal((await reader.snapshot(bootstrapSpace, ordinary, undefined, 100)).revision, ordinary);

      await prisma.spaceKnowledgeRevision.delete({ where: { id: genesis.revisionId } });
      await expectSyncCode(reader.snapshot(bootstrapSpace, ordinary, undefined, 100), 'REVISION_GONE');

      assert.equal(await prisma.spaceRevisionChainCheckpoint.count(), 3);
    } finally {
      await prisma.$disconnect();
    }
  });
});
