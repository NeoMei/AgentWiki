import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { withFolderTestDatabase } from './folder-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const {
  batchHash,
  canonicalBytes,
  confirmationHash,
  contentHash,
  pathKey,
  treeBatchHashV2,
  treeConfirmationHashV2,
} = requireFromServer('@neomei/agentwiki-sync-protocol');
const { ReadableSyncPathService } = requireFromServer('./dist/core/sync/readable-sync-path.service.js');
const { SpaceRevisionWriterService } = requireFromServer('./dist/core/sync/space-revision-writer.service.js');
const { RevisionRetentionService } = requireFromServer('./dist/core/sync/revision-retention.service.js');
const { ContentTreeService } = requireFromServer('./dist/content-tree/content-tree.service.js');
const { PushSessionService } = requireFromServer('./dist/integrations/obsidian/push-session.service.js');
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

const waitForAdvisoryWaiter = async (prisma) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await prisma.$queryRaw`
      SELECT count(*)::int AS count
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND NOT granted
    `;
    if ((rows[0]?.count ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the staged upload advisory latch');
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
      const credentialFamilyId = `retention-family-${suffix}`;
      const credentialId = `retention-credential-${suffix}`;
      await prisma.humanDeviceCredentialFamily.create({ data: {
        id: credentialFamilyId,
        userId,
        deviceId: `retention-device-${suffix}`,
        vaultId: `retention-vault-${suffix}`,
      } });
      await prisma.humanDeviceCredential.create({ data: {
        id: credentialId,
        credentialFamilyId,
        userId,
        deviceId: `retention-device-${suffix}`,
        vaultId: `retention-vault-${suffix}`,
        deviceName: 'Retention content GC test',
        credentialHash: `retention-credential-hash-${suffix}`,
        status: 'active',
        activatedAt: new Date(),
      } });

      const writer = SpaceRevisionWriterService.legacyOnly(prisma);
      const tree = new ContentTreeService(prisma, writer, new ReadableSyncPathService());
      const retention = new RevisionRetentionService(prisma);
      const pushes = new PushSessionService(
        prisma,
        { batchReceipt: (_sessionId, index, hash) => `receipt:${index}:${hash}` },
        tree,
        { indexPage: async () => undefined, deletePageIndex: async () => undefined },
        undefined,
        { enqueue: () => undefined },
      );
      const reader = new SyncV2RevisionService(
        prisma,
        cursorCodec,
        { capabilitiesV2: () => ({ maxResponseBytes: 4 * 1024 * 1024 }) },
      );
      const principal = { userId, platformRole: 'user' };
      const devicePrincipal = {
        userId,
        platformRole: 'user',
        credentialId,
        credentialFamilyId,
      };
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

      const raceStagedUploadAgainstGc = async ({ label, sessionId, gcSpaceId, upload }) => {
        const safeLabel = `${label}_${suffix}`.replaceAll(/[^a-zA-Z0-9_]/g, '_').slice(0, 48);
        const functionName = `gc_stage_fn_${safeLabel}`;
        const triggerName = `gc_stage_trigger_${safeLabel}`;
        const latchKey = `agentwiki:test:gc-staging:${label}:${suffix}`;
        const blockerPrisma = new PrismaClient({ datasources: { db: { url: isolatedUrl } } });
        let releaseLatch = () => undefined;
        let blocker;
        let uploadPromise;
        let gcPromise;
        try {
          await prisma.$executeRawUnsafe(`
            CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW."sessionId" = '${sessionId}' THEN
                PERFORM pg_advisory_xact_lock(hashtext('${latchKey}'), 1);
              END IF;
              RETURN NEW;
            END $$
          `);
          await prisma.$executeRawUnsafe(`
            CREATE TRIGGER "${triggerName}" BEFORE INSERT ON "PushSessionChange"
            FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
          `);
          let latchHeldResolve;
          const latchHeld = new Promise((resolve) => { latchHeldResolve = resolve; });
          const latchRelease = new Promise((resolve) => { releaseLatch = resolve; });
          blocker = blockerPrisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
              'SELECT pg_advisory_xact_lock(hashtext($1), $2::integer)',
              latchKey,
              1,
            );
            latchHeldResolve();
            await latchRelease;
          }, { timeout: 120_000 });
          void blocker.catch(() => undefined);
          await Promise.race([
            latchHeld,
            blocker.then(
              () => { throw new Error('Advisory blocker ended before holding the latch'); },
              (error) => { throw error; },
            ),
          ]);
          uploadPromise = upload();
          void uploadPromise.catch(() => undefined);
          await waitForAdvisoryWaiter(prisma);
          gcPromise = retention.cleanSpace(gcSpaceId);
          void gcPromise.catch(() => undefined);
          await assertPending(
            gcPromise,
            `${label} GC must wait behind the staged upload's global content lock`,
          );
          releaseLatch();
          const [, uploadResult, removed] = await Promise.all([blocker, uploadPromise, gcPromise]);
          assert.equal(removed, 0);
          return uploadResult;
        } finally {
          releaseLatch();
          await Promise.allSettled([blocker, uploadPromise, gcPromise].filter(Boolean));
          await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "PushSessionChange"`);
          await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`);
          await blockerPrisma.$disconnect();
        }
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

      // A large eligible chain is compacted in a fixed oldest-prefix batch.
      // Query count is measured by the real Prisma/PostgreSQL boundary so a
      // return to full-history hydration or per-revision evidence reads fails.
      const boundedSpace = await createSpace('bounded');
      const boundedRevisions = [await initialRevision(boundedSpace, 'Bounded')];
      for (let index = 1; index < 130; index += 1) {
        boundedRevisions.push(await nextRevision(boundedSpace));
      }
      await expire(...boundedRevisions.slice(0, -1));
      const queryPrisma = new PrismaClient({
        datasources: { db: { url: isolatedUrl } },
        log: [{ emit: 'event', level: 'query' }],
      });
      let boundedRetentionQueries = 0;
      queryPrisma.$on('query', () => { boundedRetentionQueries += 1; });
      try {
        const measuredRetention = new RevisionRetentionService(queryPrisma);
        assert.equal(await measuredRetention.cleanSpace(boundedSpace), 64);
        console.log(`bounded_retention_queries=${boundedRetentionQueries}`);
        assert.ok(
          boundedRetentionQueries <= 48,
          `one bounded retention tick used ${boundedRetentionQueries} queries`,
        );
        let boundedTickEnteredResolve;
        let boundedTickReleaseResolve;
        let pauseBoundedTick = true;
        const boundedTickEntered = new Promise((resolve) => { boundedTickEnteredResolve = resolve; });
        const boundedTickRelease = new Promise((resolve) => { boundedTickReleaseResolve = resolve; });
        const latchedRetentionPrisma = queryPrisma.$extends({
          query: {
            spaceKnowledgeRevision: {
              async findMany({ args, query }) {
                if (
                  pauseBoundedTick
                  && args.where?.spaceId === boundedSpace
                  && args.take === 65
                ) {
                  pauseBoundedTick = false;
                  boundedTickEnteredResolve();
                  await boundedTickRelease;
                }
                return query(args);
              },
            },
          },
        });
        const latchedRetention = new RevisionRetentionService(latchedRetentionPrisma);
        const secondTick = latchedRetention.cleanSpace(boundedSpace);
        void secondTick.catch(() => undefined);
        await boundedTickEntered;
        const boundedWriter = nextRevision(boundedSpace);
        void boundedWriter.catch(() => undefined);
        await assertPending(
          boundedWriter,
          'writer must wait behind the one bounded retention tick',
        );
        boundedTickReleaseResolve();
        const boundedOutcome = await Promise.race([
          Promise.all([secondTick, boundedWriter]),
          new Promise((resolve) => setTimeout(() => resolve('timeout'), 10_000)),
        ]);
        assert.notEqual(boundedOutcome, 'timeout', 'one bounded tick must release the writer promptly');
        const [secondRemoved, boundedWrite] = boundedOutcome;
        assert.equal(secondRemoved, 64);
        assert.equal((await reader.head(boundedSpace)).revision, boundedWrite);
        assert.equal(await queryPrisma.spaceKnowledgeRevision.count({ where: {
          spaceId: boundedSpace,
          id: boundedRevisions[128],
        } }), 1, 'writer is released before a later tick consumes the last eligible revision');
        assert.equal(await measuredRetention.cleanSpace(boundedSpace), 1);
        assert.equal(await measuredRetention.cleanSpace(boundedSpace), 0);
        assert.deepEqual(
          (await queryPrisma.spaceKnowledgeRevision.findMany({
            where: { spaceId: boundedSpace },
            orderBy: { sequence: 'asc' },
            select: { id: true },
          })).map((row) => row.id),
          [boundedRevisions.at(-1), boundedWrite],
        );
        assert.equal(await queryPrisma.spaceRevisionChainCheckpoint.count({
          where: { spaceId: boundedSpace },
        }), 1);
      } finally {
        await queryPrisma.$disconnect();
      }

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

      // A logical reader pins one PostgreSQL snapshot before loading ancestors.
      // Pause the checkpoint lookup, advance retention concurrently, then
      // prove the response is consistently old (and the next read consistently new).
      const readRaceSpace = await createSpace('read-race');
      const readRace1 = await initialRevision(readRaceSpace, 'ReadRace');
      const readRace2 = await nextRevision(readRaceSpace);
      const readRace3 = await nextRevision(readRaceSpace);
      await expire(readRace1, readRace2);
      let checkpointEnteredResolve;
      let checkpointReleaseResolve;
      let pauseCheckpoint = true;
      const checkpointEntered = new Promise((resolve) => { checkpointEnteredResolve = resolve; });
      const checkpointRelease = new Promise((resolve) => { checkpointReleaseResolve = resolve; });
      const latchedPrisma = new PrismaClient({ datasources: { db: { url: isolatedUrl } } }).$extends({
        query: {
          spaceRevisionChainCheckpoint: {
            async findUnique({ args, query }) {
              if (pauseCheckpoint && args.where.spaceId === readRaceSpace) {
                pauseCheckpoint = false;
                checkpointEnteredResolve();
                await checkpointRelease;
              }
              return query(args);
            },
          },
        },
      });
      try {
        const latchedReader = new SyncV2RevisionService(
          latchedPrisma,
          cursorCodec,
          { capabilitiesV2: () => ({ maxResponseBytes: 4 * 1024 * 1024 }) },
        );
        const inFlightRead = latchedReader.snapshot(readRaceSpace, readRace3, undefined, 100);
        void inFlightRead.catch(() => undefined);
        await checkpointEntered;
        assert.equal(await retention.cleanSpace(readRaceSpace), 2);
        checkpointReleaseResolve();
        assert.equal((await inFlightRead).revision, readRace3);
        assert.equal((await latchedReader.head(readRaceSpace)).revision, readRace3);
      } finally {
        checkpointReleaseResolve();
        await latchedPrisma.$disconnect();
      }

      // Global content GC is cross-Space safe. Each live uploader acquires the
      // global lock before its staging row; while that insert is latched, an
      // unrelated Space's GC must wait, then preserve both v1/v2 content hashes.
      const gcSpace = await createSpace('gc-runner');
      const gcV2Space = await createSpace('gc-v2-live');
      const gcV2Body = '# Live v2 staging\n';
      const gcV2Hash = await contentHash(gcV2Body);
      const gcV2Change = {
        operation: 'upsert_page',
        page: {
          pageId: `gc-v2-page-${suffix}`,
          folderId: null,
          path: 'pages/GC-v2.md',
          title: 'GC v2',
          body: gcV2Body,
          contentHash: gcV2Hash,
          updatedAt: '2026-08-29T00:00:00.000Z',
        },
      };
      const gcV2Manifest = {
        protocolVersion: '2',
        spaceId: gcV2Space,
        baseRevision: '0',
        changes: [{
          operation: 'upsert_page',
          page: {
            pageId: gcV2Change.page.pageId,
            folderId: null,
            path: gcV2Change.page.path,
            title: gcV2Change.page.title,
            contentHash: gcV2Hash,
            updatedAt: gcV2Change.page.updatedAt,
          },
        }],
      };
      const gcV2Confirmation = await treeConfirmationHashV2(gcV2Manifest);
      const gcV2Session = await pushes.createV2(devicePrincipal, gcV2Space, {
        protocolVersion: '2',
        baseRevision: '0',
        idempotencyKey: `70000000-0000-4000-8000-${suffix.slice(0, 12)}`,
        capabilitiesHash: await pushes.capabilityHashV2(),
        confirmationHash: gcV2Confirmation,
        confirmationByteLength: canonicalBytes(gcV2Manifest).byteLength,
        changeCount: 1,
        totalBodyBytes: Buffer.byteLength(gcV2Body, 'utf8'),
      });
      const gcV2BatchInput = { protocolVersion: '2', batchIndex: 0, changes: [gcV2Change] };
      const gcV2Batch = {
        ...gcV2BatchInput,
        batchHash: await treeBatchHashV2(gcV2BatchInput),
      };
      await prisma.syncPageContentRow.create({ data: {
        contentHash: gcV2Hash,
        body: gcV2Body,
        byteLength: Buffer.byteLength(gcV2Body, 'utf8'),
      } });
      await prisma.legacyPageBodyRow.create({ data: { contentHash: gcV2Hash, body: gcV2Body } });
      await raceStagedUploadAgainstGc({
        label: 'v2',
        sessionId: gcV2Session.sessionId,
        gcSpaceId: gcSpace,
        upload: () => pushes.uploadV2(devicePrincipal, gcV2Space, gcV2Session.sessionId, gcV2Batch),
      });
      assert.equal(await prisma.syncPageContentRow.count({ where: { contentHash: gcV2Hash } }), 1);
      assert.equal(await prisma.legacyPageBodyRow.count({ where: { contentHash: gcV2Hash } }), 1);
      const gcV2Published = await pushes.finalizeV2(
        devicePrincipal,
        gcV2Space,
        gcV2Session.sessionId,
        { protocolVersion: '2', confirmationHash: gcV2Confirmation, userConfirmed: true },
      );
      assert.equal(gcV2Published.status, 'published');
      assert.equal(await prisma.syncRevisionPageRow.count({ where: { contentHash: gcV2Hash } }), 1);

      const gcV1Space = await createSpace('gc-v1-live');
      const gcV1Body = '# Live v1 staging\n';
      const gcV1Hash = await contentHash(gcV1Body);
      const gcV1PageId = `gc-v1-page-${suffix}`;
      const gcV1Manifest = {
        protocolVersion: '1',
        spaceId: gcV1Space,
        baseRevision: '0',
        changes: [{
          operation: 'upsert',
          pageId: gcV1PageId,
          path: 'pages/GC-v1.md',
          title: 'GC v1',
          contentHash: gcV1Hash,
        }],
      };
      const gcV1Confirmation = await confirmationHash(gcV1Manifest);
      const gcV1Session = await pushes.create(devicePrincipal, gcV1Space, {
        baseRevision: '0',
        idempotencyKey: `71000000-0000-4000-8000-${suffix.slice(0, 12)}`,
        capabilitiesHash: await pushes.capabilityHash(),
        confirmationHash: gcV1Confirmation,
        confirmationByteLength: canonicalBytes(gcV1Manifest).byteLength,
        changeCount: 1,
        totalBodyBytes: Buffer.byteLength(gcV1Body, 'utf8'),
      });
      const gcV1BatchInput = {
        protocolVersion: '1',
        batchIndex: 0,
        changes: [{
          operation: 'upsert',
          pageId: gcV1PageId,
          path: 'pages/GC-v1.md',
          title: 'GC v1',
          body: gcV1Body,
          contentHash: gcV1Hash,
        }],
      };
      const gcV1Batch = { ...gcV1BatchInput, batchHash: await batchHash(gcV1BatchInput) };
      await prisma.syncPageContentRow.create({ data: {
        contentHash: gcV1Hash,
        body: gcV1Body,
        byteLength: Buffer.byteLength(gcV1Body, 'utf8'),
      } });
      await prisma.legacyPageBodyRow.create({ data: { contentHash: gcV1Hash, body: gcV1Body } });
      await raceStagedUploadAgainstGc({
        label: 'v1',
        sessionId: gcV1Session.sessionId,
        gcSpaceId: gcSpace,
        upload: () => pushes.upload(devicePrincipal, gcV1Space, gcV1Session.sessionId, gcV1Batch),
      });
      assert.equal(await prisma.syncPageContentRow.count({ where: { contentHash: gcV1Hash } }), 1);
      assert.equal(await prisma.legacyPageBodyRow.count({ where: { contentHash: gcV1Hash } }), 1);
      const gcV1Published = await pushes.finalize(
        devicePrincipal,
        gcV1Space,
        gcV1Session.sessionId,
        gcV1Confirmation,
      );
      assert.equal(gcV1Published.status, 'published');
      assert.equal(await prisma.syncRevisionPageRow.count({ where: { contentHash: gcV1Hash } }), 1);

      // Once staging is gone, the committed revision remains the reference;
      // after that revision is genuinely pruned, the unreferenced blob is GC'd.
      await prisma.pushSession.delete({ where: { id: gcV1Session.sessionId } });
      assert.equal(await retention.cleanSpace(gcSpace), 0);
      assert.equal(await prisma.syncPageContentRow.count({ where: { contentHash: gcV1Hash } }), 1);
      const gcV1Archive = await prisma.$transaction(async (tx) => {
        const locked = await writer.lockSpace(tx, gcV1Space);
        return writer.advanceLocked(locked, gcV1Space, [{
          operation: 'archive',
          pageId: gcV1PageId,
          previousPath: 'pages/GC-v1.md',
        }], { origin: 'web_editor', createdByUserId: userId });
      });
      assert.ok(gcV1Archive.revisionId);
      await expire(gcV1Published.revision);
      assert.equal(await retention.cleanSpace(gcV1Space), 1);
      assert.equal(await prisma.syncPageContentRow.count({ where: { contentHash: gcV1Hash } }), 0);
      assert.equal(await prisma.legacyPageBodyRow.count({ where: { contentHash: gcV1Hash } }), 0);

      // A GC exception cannot roll back the already-committed checkpoint. It
      // leaks content for this tick, then a later tick retries successfully.
      const gcFailureSpace = await createSpace('gc-failure');
      const gcFailure1 = await initialRevision(gcFailureSpace, 'GcFailure');
      await nextRevision(gcFailureSpace);
      await expire(gcFailure1);
      const gcFailureBody = '# Retry orphan\n';
      const gcFailureHash = await contentHash(gcFailureBody);
      await prisma.syncPageContentRow.create({ data: {
        contentHash: gcFailureHash,
        body: gcFailureBody,
        byteLength: Buffer.byteLength(gcFailureBody, 'utf8'),
      } });
      await prisma.legacyPageBodyRow.create({ data: {
        contentHash: gcFailureHash,
        body: gcFailureBody,
      } });
      const gcFailureFunction = `gc_failure_fn_${suffix}`;
      const gcFailureTrigger = `gc_failure_trigger_${suffix}`;
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION "${gcFailureFunction}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD."contentHash" = '${gcFailureHash}' THEN
            RAISE EXCEPTION 'forced content GC failure';
          END IF;
          RETURN OLD;
        END $$
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "${gcFailureTrigger}" BEFORE DELETE ON "SyncPageContentRow"
        FOR EACH ROW EXECUTE FUNCTION "${gcFailureFunction}"()
      `);
      assert.equal(await retention.cleanSpace(gcFailureSpace), 1);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { id: gcFailure1 } }), 0);
      assert.equal(await prisma.spaceRevisionChainCheckpoint.count({ where: { spaceId: gcFailureSpace } }), 1);
      assert.equal(await prisma.syncPageContentRow.count({ where: { contentHash: gcFailureHash } }), 1);
      await prisma.$executeRawUnsafe(`DROP TRIGGER "${gcFailureTrigger}" ON "SyncPageContentRow"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION "${gcFailureFunction}"()`);
      assert.equal(await retention.cleanSpace(gcFailureSpace), 0);
      assert.equal(await prisma.syncPageContentRow.count({ where: { contentHash: gcFailureHash } }), 0);
      assert.equal(await prisma.legacyPageBodyRow.count({ where: { contentHash: gcFailureHash } }), 0);

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
      // With the sequence-1 predecessor still retained, ordinary chain trust
      // requires the exact same-Space predecessor ID. A missing, wrong, or
      // cross-Space parent can never be reclassified as a migration boundary.
      assert.equal((await reader.snapshot(bootstrapSpace, genesis.revisionId, undefined, 100)).revision, genesis.revisionId);
      const crossParent = `cross-parent-${suffix}`;
      await prisma.spaceKnowledgeRevision.create({ data: {
        ...legacyData(crossParent, 1, null),
        spaceId: wrongSpace,
      } });
      for (const parentRevisionId of [`missing-${suffix}`, legacy1, crossParent]) {
        await prisma.spaceKnowledgeRevision.update({
          where: { id: genesis.revisionId }, data: { parentRevisionId },
        });
        await expectSyncCode(reader.snapshot(bootstrapSpace, genesis.revisionId, undefined, 100), 'REVISION_GONE');
        await assert.rejects(
          nextRevision(bootstrapSpace),
          (error) => error?.code === 'CONTENT_TREE_REVISION_GONE',
        );
      }
      await prisma.spaceKnowledgeRevision.update({
        where: { id: genesis.revisionId }, data: { parentRevisionId: legacy2 },
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

      // A physically pruned gap before an exact retained legacy predecessor is
      // valid: the retained suffix still proves genesis -> sequence-1 exactly.
      await prisma.spaceKnowledgeRevision.delete({ where: { id: legacy1 } });
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
      const retainedSuffixChild = await nextRevision(bootstrapSpace);
      assert.equal(
        (await reader.snapshot(bootstrapSpace, retainedSuffixChild, undefined, 100)).revision,
        retainedSuffixChild,
      );
      await prisma.spaceKnowledgeRevision.delete({ where: { id: legacy2 } });
      assert.equal((await reader.snapshot(bootstrapSpace, ordinary, undefined, 100)).revision, ordinary);
      const afterBootstrap = await nextRevision(bootstrapSpace);
      assert.equal((await reader.snapshot(bootstrapSpace, afterBootstrap, undefined, 100)).revision, afterBootstrap);

      await prisma.spaceKnowledgeRevision.delete({ where: { id: genesis.revisionId } });
      await expectSyncCode(reader.snapshot(bootstrapSpace, afterBootstrap, undefined, 100), 'REVISION_GONE');

      assert.equal(await prisma.spaceRevisionChainCheckpoint.count(), 6);
    } finally {
      await prisma.$disconnect();
    }
  });
});
