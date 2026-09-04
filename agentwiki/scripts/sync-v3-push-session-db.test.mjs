import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalBytes,
  contentHash,
  treeBatchHashV3,
  treeConfirmationHashV3,
  blobContentHashV3,
} from '../packages/sync-protocol/dist/esm/index.js';
import { withSyncV3TestDatabase } from './sync-v3-test-database.mjs';
import { PrismaService } from '../apps/server/dist/database/prisma.service.js';
import { AuthorizationService } from '../apps/server/dist/core/authorization/authorization.service.js';
import { MarkdownResourceService } from '../apps/server/dist/markdown-resources/markdown-resource.service.js';
import { SyncV3RevisionWriterService } from '../apps/server/dist/core/sync/sync-v3-revision-writer.service.js';
import { SpaceRevisionWriterService } from '../apps/server/dist/core/sync/space-revision-writer.service.js';
import { ReadableSyncPathService } from '../apps/server/dist/core/sync/readable-sync-path.service.js';
import { ContentTreeService } from '../apps/server/dist/content-tree/content-tree.service.js';
import { SyncCapabilitiesService } from '../apps/server/dist/integrations/obsidian/sync-capabilities.service.js';
import { SyncV3PushSessionService } from '../apps/server/dist/integrations/obsidian/sync-v3-push-session.service.js';
import { LocalAttachmentStorage } from '../apps/server/dist/attachments/local-attachment.storage.js';

const baseDatabaseUrl = process.env.SYNC_V3_TEST_DATABASE_URL;

function serviceGraph(prisma, storageOverride, effects) {
  const authorization = new AuthorizationService(prisma);
  const storage = storageOverride ?? { openVerified: async () => { throw new Error('no attachment expected'); } };
  const markdown = new MarkdownResourceService(prisma, authorization);
  const writer = new SyncV3RevisionWriterService(markdown, storage);
  const spaceWriter = new SpaceRevisionWriterService(prisma, writer);
  const contentTree = new ContentTreeService(prisma, spaceWriter, new ReadableSyncPathService());
  const capabilities = new SyncCapabilitiesService(prisma, writer);
  const crypto = { batchReceipt: (sessionId, index, hash) => `receipt:${sessionId}:${index}:${hash}` };
  const service = new SyncV3PushSessionService(
    prisma, crypto, contentTree, authorization, capabilities, writer, storage,
    effects ? {
      indexPage: async (id) => {
        effects.indexed.push(id);
        if (effects.fail) throw new Error('search unavailable');
      },
      deletePageIndex: async (id) => effects.deleted.push(id),
    } : undefined,
    effects ? {
      enqueue: (id) => {
        effects.enqueued.push(id);
        if (effects.fail) throw new Error('graph unavailable');
      },
    } : undefined,
  );
  return { service, writer, spaceWriter, contentTree, capabilities };
}

async function stageChanges(graph, principal, spaceId, baseRevision, changes, requirements = []) {
  const manifestChanges = changes.map((change) => {
    if (change.operation !== 'upsert_page') return change;
    const { body: _body, ...page } = change.page;
    return { operation: 'upsert_page', page };
  });
  const manifest = {
    protocolVersion: '3', spaceId, baseRevision,
    capabilitiesHash: await graph.capabilities.hashV3(), changes: manifestChanges,
  };
  const confirmationHash = await treeConfirmationHashV3(manifest);
  const created = await graph.service.create(principal, spaceId, {
    protocolVersion: '3', baseRevision, idempotencyKey: randomUUID(),
    capabilitiesHash: manifest.capabilitiesHash, confirmationHash,
    confirmationByteLength: canonicalBytes(manifest).byteLength,
    changeCount: changes.length,
    totalBodyBytes: changes.reduce((sum, change) => sum + (
      change.operation === 'upsert_page' ? Buffer.byteLength(change.page.body) : 0
    ), 0),
    attachmentCount: changes.filter((change) => change.operation === 'upsert_attachment').length,
    transferBlobBytes: requirements.reduce((sum, requirement) => sum + Number(requirement.sizeBytes), 0),
    blobRequirements: requirements,
  });
  const withoutHash = { protocolVersion: '3', batchIndex: 0, changes };
  await graph.service.uploadBatch(principal, spaceId, created.sessionId, {
    ...withoutHash, batchHash: await treeBatchHashV3(withoutHash),
  });
  return { ...created, confirmationHash };
}

async function stagePage(graph, principal, spaceId, baseRevision, suffix) {
  const body = `# ${suffix}\n`;
  const page = {
    pageId: `page-${suffix}`, folderId: null, path: `pages/${suffix}.md`, title: suffix,
    body, contentHash: await contentHash(body), updatedAt: '2026-09-05T00:00:00.000Z',
    referencedAttachmentIds: [],
  };
  const manifest = {
    protocolVersion: '3', spaceId, baseRevision,
    capabilitiesHash: await graph.capabilities.hashV3(),
    changes: [{ operation: 'upsert_page', page: (({ body: _body, ...rest }) => rest)(page) }],
  };
  const confirmationHash = await treeConfirmationHashV3(manifest);
  const created = await graph.service.create(principal, spaceId, {
    protocolVersion: '3', baseRevision, idempotencyKey: randomUUID(),
    capabilitiesHash: manifest.capabilitiesHash, confirmationHash,
    confirmationByteLength: canonicalBytes(manifest).byteLength,
    changeCount: 1, totalBodyBytes: Buffer.byteLength(body), attachmentCount: 0,
    transferBlobBytes: 0, blobRequirements: [],
  });
  const withoutHash = {
    protocolVersion: '3', batchIndex: 0,
    changes: [{ operation: 'upsert_page', page }],
  };
  await graph.service.uploadBatch(principal, spaceId, created.sessionId, {
    ...withoutHash, batchHash: await treeBatchHashV3(withoutHash),
  });
  return { ...created, confirmationHash };
}

test('Sync v3 finalize is atomic, race-safe, retryable, and terminally idempotent on PostgreSQL', {
  skip: baseDatabaseUrl ? false : 'SYNC_V3_TEST_DATABASE_URL is not configured',
  timeout: 180_000,
}, async () => {
  await withSyncV3TestDatabase(baseDatabaseUrl, async ({
    applySyncV3Migration, applySyncV3PushOrdinalMigration, databaseUrl, schemaName,
  }) => {
    await applySyncV3Migration();
    await applySyncV3PushOrdinalMigration();
    const prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    const suffix = schemaName.slice(-12);
    const userId = `user-${suffix}`;
    const spaceId = `space-${suffix}`;
    const familyId = randomUUID();
    const credentialId = randomUUID();
    const principal = {
      userId, credentialId, credentialFamilyId: familyId,
      deviceId: `device-${suffix}`, vaultId: `vault-${suffix}`,
      status: 'active', platformRole: 'user',
    };
    let storageRoot;
    try {
      await prisma.user.create({ data: { id: userId, email: `${userId}@push-v3.test` } });
      await prisma.space.create({ data: { id: spaceId, name: 'Push v3', slug: spaceId } });
      await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
      await prisma.humanDeviceCredentialFamily.create({ data: {
        id: familyId, userId, deviceId: principal.deviceId, vaultId: principal.vaultId,
      } });
      await prisma.humanDeviceCredential.create({ data: {
        id: credentialId, credentialFamilyId: familyId, userId,
        deviceId: principal.deviceId, vaultId: principal.vaultId,
        deviceName: 'PG test', credentialHash: `hash-${suffix}`, status: 'active',
      } });
      const graph = serviceGraph(prisma);
      const initial = await prisma.$transaction(async (tx) => {
        const locked = await graph.spaceWriter.lockSpace(tx, spaceId);
        return graph.writer.advanceV3Locked(locked, spaceId, {
          folders: [], pages: [], attachments: [],
        }, { origin: 'manual', createdByUserId: userId });
      }, { isolationLevel: 'Serializable' });

      const left = await stagePage(graph, principal, spaceId, initial.revisionId, 'left');
      const right = await stagePage(graph, principal, spaceId, initial.revisionId, 'right');
      const concurrent = await Promise.allSettled([
        graph.service.finalize(principal, spaceId, left.sessionId, {
          protocolVersion: '3', confirmationHash: left.confirmationHash, userConfirmed: true,
        }),
        graph.service.finalize(principal, spaceId, right.sessionId, {
          protocolVersion: '3', confirmationHash: right.confirmationHash, userConfirmed: true,
        }),
      ]);
      assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(concurrent.filter((result) => result.status === 'rejected'
        && result.reason?.syncCode === 'BASE_STALE').length, 1);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 2);
      assert.equal(await prisma.page.count({ where: { spaceId, deletedAt: null } }), 1);
      const visible = await prisma.spaceKnowledgeRevision.findFirst({
        where: { spaceId }, orderBy: { sequence: 'desc' },
      });
      assert.equal(await prisma.syncRevisionPageRow.count({ where: { revisionId: visible.id } }), 1);

      const webRace = await stagePage(graph, principal, spaceId, visible.id, 'web-race');
      await prisma.$transaction(async (tx) => {
        const locked = await graph.contentTree.lockSyncMutationSpace(tx, spaceId);
        const livePage = await locked.page.findFirst({ where: { spaceId, deletedAt: null } });
        const webBody = `${livePage.content}\nEdited on web\n`;
        await locked.page.update({ where: { id: livePage.id }, data: {
          content: webBody, lastModifiedByUserId: userId, lastModifiedAt: new Date(),
        } });
        await graph.spaceWriter.advanceLocked(locked, spaceId, [{
          operation: 'upsert', pageId: livePage.knowledgeKey, path: livePage.syncPath,
          title: livePage.title, body: webBody,
        }], {
          origin: 'manual', createdByUserId: userId,
        });
      }, { isolationLevel: 'Serializable' });
      await assert.rejects(graph.service.finalize(principal, spaceId, webRace.sessionId, {
        protocolVersion: '3', confirmationHash: webRace.confirmationHash, userConfirmed: true,
      }), (error) => error?.syncCode === 'BASE_STALE');
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), 3);

      const afterWeb = await prisma.spaceKnowledgeRevision.findFirst({
        where: { spaceId }, orderBy: { sequence: 'desc' },
      });
      const rollback = await stagePage(graph, principal, spaceId, afterWeb.id, 'rollback');
      const revisionCount = await prisma.spaceKnowledgeRevision.count({ where: { spaceId } });
      const pageCount = await prisma.page.count({ where: { spaceId } });
      const originalAdvance = graph.writer.advanceV3Locked.bind(graph.writer);
      graph.writer.advanceV3Locked = async (...args) => {
        await originalAdvance(...args);
        throw new Error('fault after revision write');
      };
      await assert.rejects(graph.service.finalize(principal, spaceId, rollback.sessionId, {
        protocolVersion: '3', confirmationHash: rollback.confirmationHash, userConfirmed: true,
      }), /fault after revision write/u);
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), revisionCount);
      assert.equal(await prisma.page.count({ where: { spaceId } }), pageCount);
      assert.equal((await prisma.pushSession.findUnique({ where: { id: rollback.sessionId } })).status,
        'ready_to_finalize');
      graph.writer.advanceV3Locked = originalAdvance;

      const realTransaction = prisma.$transaction.bind(prisma);
      let serializationInjected = false;
      prisma.$transaction = async (...args) => {
        if (!serializationInjected) {
          serializationInjected = true;
          throw Object.assign(new Error('serialization'), { code: 'P2034' });
        }
        return realTransaction(...args);
      };
      const retried = await graph.service.finalize(principal, spaceId, rollback.sessionId, {
        protocolVersion: '3', confirmationHash: rollback.confirmationHash, userConfirmed: true,
      });
      assert.equal(retried.status, 'published');
      prisma.$transaction = realTransaction;

      const latest = await prisma.spaceKnowledgeRevision.findFirst({
        where: { spaceId }, orderBy: { sequence: 'desc' },
      });
      const lost = await stagePage(graph, principal, spaceId, latest.id, 'lost-response');
      let responseLost = true;
      prisma.$transaction = async (...args) => {
        const value = await realTransaction(...args);
        if (responseLost) {
          responseLost = false;
          throw new Error('response lost after commit');
        }
        return value;
      };
      await assert.rejects(graph.service.finalize(principal, spaceId, lost.sessionId, {
        protocolVersion: '3', confirmationHash: lost.confirmationHash, userConfirmed: true,
      }), /response lost after commit/u);
      prisma.$transaction = realTransaction;
      const stored = await prisma.pushSession.findUnique({ where: { id: lost.sessionId } });
      assert.equal(stored.status, 'published');
      const replay = await graph.service.finalize(principal, spaceId, lost.sessionId, {
        protocolVersion: '3', confirmationHash: lost.confirmationHash, userConfirmed: true,
      });
      assert.deepEqual(replay, stored.result);
      const finalHead = await prisma.spaceKnowledgeRevision.findFirst({
        where: { spaceId }, orderBy: { sequence: 'desc' },
      });
      assert.equal(replay.revision, finalHead.id);
      assert.equal(await prisma.syncRevisionPageRow.count({ where: { revisionId: finalHead.id } }),
        await prisma.page.count({ where: { spaceId, deletedAt: null } }));

      storageRoot = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-push-v3-'));
      const storage = new LocalAttachmentStorage({
        storagePath: storageRoot,
        maxFileBytes: 10n * 1024n * 1024n,
        maxSpaceBytes: 500n * 1024n * 1024n,
        maxDimension: 10_000,
        maxPixels: 40_000_000n,
        minFreeBytes: 1n,
        retentionMs: 30 * 24 * 60 * 60 * 1000,
        orphanGraceMs: 24 * 60 * 60 * 1000,
        contentLockTimeoutMs: 5_000,
      });
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3GAAAAAASUVORK5CYII=',
        'base64',
      );
      const blobHash = await blobContentHashV3(png);
      const reservation = await storage.createReservedTempPath(BigInt(png.length), 1n);
      await writeFile(reservation.path, png);
      const storedBlob = await storage.withContentLock(blobHash, (lease) => (
        storage.publish(reservation, blobHash, BigInt(png.length), lease)
      ));
      const attachmentId = `attachment-${suffix}`;
      const attachmentUpdatedAt = new Date('2026-09-05T00:00:00.000Z');
      const liveAttachment = await prisma.spaceAttachment.create({ data: {
        id: attachmentId, spaceId, displayName: 'photo.png', nameKey: 'photo.png',
        contentHash: blobHash, storageKey: storedBlob.storageKey, mimeType: 'image/png',
        sizeBytes: BigInt(png.length), width: 1, height: 1, status: 'active',
        uploadedByUserId: userId, updatedAt: attachmentUpdatedAt,
      } });
      const immutableVersion = await prisma.attachmentVersion.create({ data: {
        attachmentId, contentHash: blobHash, storageKey: storedBlob.storageKey,
        mimeType: 'image/png', sizeBytes: BigInt(png.length), width: 1, height: 1,
      } });
      const effects = { indexed: [], deleted: [], enqueued: [], fail: false };
      const attachmentGraph = serviceGraph(prisma, storage, effects);
      const attachmentHead = await prisma.spaceKnowledgeRevision.findFirst({
        where: { spaceId }, orderBy: { sequence: 'desc' },
      });
      const imageBody = '![[assets/photo.png]]\n';
      const imagePage = {
        pageId: `page-image-${suffix}`, folderId: null, path: 'pages/With image.md',
        title: 'With image', body: imageBody, contentHash: await contentHash(imageBody),
        updatedAt: '2026-09-05T00:01:00.000Z', referencedAttachmentIds: [attachmentId],
      };
      const attachment = {
        attachmentId, path: 'assets/photo.png', contentHash: blobHash,
        mimeType: 'image/png', sizeBytes: String(png.length), width: 1, height: 1,
        updatedAt: attachmentUpdatedAt.toISOString(),
      };
      const requirement = {
        contentHash: blobHash, sizeBytes: String(png.length), mimeType: 'image/png', width: 1, height: 1,
      };
      const attachmentSession = await stageChanges(
        attachmentGraph, principal, spaceId, attachmentHead.id,
        [{ operation: 'upsert_attachment', attachment }, { operation: 'upsert_page', page: imagePage }],
        [requirement],
      );
      assert.deepEqual(attachmentSession.missingContentHashes, []);
      const attachmentResult = await attachmentGraph.service.finalize(
        principal, spaceId, attachmentSession.sessionId,
        { protocolVersion: '3', confirmationHash: attachmentSession.confirmationHash, userConfirmed: true },
      );
      const attachmentRow = await prisma.syncRevisionAttachmentRow.findUnique({
        where: { revisionId_attachmentId: {
          revisionId: attachmentResult.revision, attachmentId,
        } },
      });
      assert.equal(attachmentRow.attachmentVersionId, immutableVersion.id);
      assert.equal(attachmentRow.path, 'assets/photo.png');
      assert.equal((await prisma.spaceAttachment.findUnique({ where: { id: attachmentId } })).storageKey,
        liveAttachment.storageKey);
      const imagePageRow = await prisma.page.findUnique({ where: { knowledgeKey: imagePage.pageId } });
      const pageChangeItem = await prisma.changeItem.findFirst({ where: {
        changeSetId: attachmentResult.changeSetId, type: 'upsert_page',
      } });
      assert.equal(pageChangeItem.publishedResourceId, imagePageRow.id);
      assert.ok(effects.indexed.includes(imagePageRow.id));
      assert.ok(effects.enqueued.includes(spaceId));
      const publishedCandidate = await prisma.$transaction(
        (tx) => attachmentGraph.writer.inspectCurrentLocked(tx, spaceId),
        { isolationLevel: 'RepeatableRead' },
      );
      assert.deepEqual(publishedCandidate.candidate.pages.find((page) => page.pageId === imagePage.pageId)
        .referencedAttachmentIds, [attachmentId]);

      const detachedBody = '# Image removed, attachment retained\n';
      const detachedPage = {
        ...imagePage, body: detachedBody, contentHash: await contentHash(detachedBody),
        updatedAt: '2026-09-05T00:02:00.000Z', referencedAttachmentIds: [],
      };
      const detachSession = await stageChanges(
        attachmentGraph, principal, spaceId, attachmentResult.revision,
        [
          { operation: 'upsert_page', page: detachedPage },
          { operation: 'detach_attachment', attachmentId, previousPath: 'assets/photo.png' },
        ],
      );
      const detachResult = await attachmentGraph.service.finalize(
        principal, spaceId, detachSession.sessionId,
        { protocolVersion: '3', confirmationHash: detachSession.confirmationHash, userConfirmed: true },
      );
      const retained = await prisma.spaceAttachment.findUnique({ where: { id: attachmentId } });
      assert.equal(retained.status, 'active');
      assert.equal(retained.archivedAt, null);
      assert.equal(await prisma.syncRevisionAttachmentRow.count({
        where: { revisionId: detachResult.revision },
      }), 0);
      const detachedCandidate = await prisma.$transaction(
        (tx) => attachmentGraph.writer.inspectCurrentLocked(tx, spaceId),
        { isolationLevel: 'RepeatableRead' },
      );
      assert.deepEqual(detachedCandidate.candidate.attachments, []);
      assert.deepEqual(detachedCandidate.candidate.pages.find((page) => page.pageId === imagePage.pageId)
        .referencedAttachmentIds, []);

      const conflictHeadCount = await prisma.spaceKnowledgeRevision.count({ where: { spaceId } });
      const conflictingAttachment = { ...attachment, attachmentId: `attachment-conflict-${suffix}` };
      const conflictBody = '![[assets/photo.png]]\n';
      const conflictPage = {
        pageId: `page-conflict-${suffix}`, folderId: null, path: 'pages/Conflict.md', title: 'Conflict',
        body: conflictBody, contentHash: await contentHash(conflictBody),
        updatedAt: '2026-09-05T00:03:00.000Z',
        referencedAttachmentIds: [conflictingAttachment.attachmentId],
      };
      const conflictSession = await stageChanges(
        attachmentGraph, principal, spaceId, detachResult.revision,
        [
          { operation: 'upsert_attachment', attachment: conflictingAttachment },
          { operation: 'upsert_page', page: conflictPage },
        ], [requirement],
      );
      await assert.rejects(attachmentGraph.service.finalize(
        principal, spaceId, conflictSession.sessionId,
        { protocolVersion: '3', confirmationHash: conflictSession.confirmationHash, userConfirmed: true },
      ), (error) => error?.syncCode === 'ATTACHMENT_NAME_CONFLICT');
      assert.equal(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }), conflictHeadCount);

      effects.fail = true;
      const refreshFailure = await stagePage(
        attachmentGraph, principal, spaceId, detachResult.revision, 'refresh-failure',
      );
      const refreshResult = await attachmentGraph.service.finalize(
        principal, spaceId, refreshFailure.sessionId,
        { protocolVersion: '3', confirmationHash: refreshFailure.confirmationHash, userConfirmed: true },
      );
      assert.equal(refreshResult.status, 'published');
      assert.equal((await prisma.pushSession.findUnique({ where: { id: refreshFailure.sessionId } })).status,
        'published');
    } finally {
      await prisma.$disconnect();
      if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    }
  });
});
