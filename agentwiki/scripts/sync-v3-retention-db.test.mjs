import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { withSyncV3TestDatabase } from './sync-v3-test-database.mjs';
import { PrismaService } from '../apps/server/dist/database/prisma.service.js';
import { AuthorizationService } from '../apps/server/dist/core/authorization/authorization.service.js';
import { RevisionRetentionService } from '../apps/server/dist/core/sync/revision-retention.service.js';
import { SpaceRevisionWriterService } from '../apps/server/dist/core/sync/space-revision-writer.service.js';
import { AttachmentCleanupWorker } from '../apps/server/dist/attachments/attachment-cleanup.worker.js';
import { AttachmentService } from '../apps/server/dist/attachments/attachment.service.js';
import { LocalAttachmentStorage } from '../apps/server/dist/attachments/local-attachment.storage.js';

const baseDatabaseUrl = process.env.SYNC_V3_TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1_000;

function storageKey(hash) {
  return `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

test('Sync v3 retention and Blob GC preserve every live owner and close deletion races', {
  skip: baseDatabaseUrl ? false : 'SYNC_V3_TEST_DATABASE_URL is not configured',
  timeout: 180_000,
}, async () => {
  await withSyncV3TestDatabase(baseDatabaseUrl, async ({
    applySyncV3Migration, applySyncV3PushOrdinalMigration, databaseUrl, schemaName,
  }) => {
    await applySyncV3Migration();
    await applySyncV3PushOrdinalMigration();
    const prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    const root = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-retention-v3-'));
    const suffix = schemaName.slice(-10);
    const userId = `user-${suffix}`;
    const spaceId = `space-${suffix}`;
    const now = Date.now();
    const config = {
      storagePath: root,
      maxFileBytes: 10n * 1024n * 1024n,
      maxSpaceBytes: 500n * 1024n * 1024n,
      maxDimension: 10_000,
      maxPixels: 40_000_000n,
      minFreeBytes: 1n,
      retentionMs: 30 * DAY,
      orphanGraceMs: DAY,
      contentLockTimeoutMs: 5_000,
    };
    const storage = new LocalAttachmentStorage(config);
    const paths = new Map();
    const createBlob = async (character) => {
      const hash = character.repeat(64);
      const key = storageKey(hash);
      const path = join(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(character));
      const old = new Date(now - 2 * DAY);
      await utimes(path, old, old);
      paths.set(character, path);
      return { hash, key, path };
    };

    try {
      await prisma.$connect();
      await prisma.user.create({ data: { id: userId, email: `${userId}@retention-v3.test` } });
      await prisma.space.create({ data: { id: spaceId, name: 'Retention v3', slug: spaceId } });
      await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
      const [referenced, archived, unexpired, grace, expired, orphan, racing] = await Promise.all(
        ['a', 'b', 'c', 'd', 'e', 'f', '9'].map(createBlob),
      );

      const page = await prisma.page.create({ data: {
        id: `page-${suffix}`,
        knowledgeKey: `page-key-${suffix}`,
        title: 'Referenced page',
        slug: `referenced-${suffix}`,
        content: `![[assets/photo-${suffix}.png]]\nprivate markdown body`,
        spaceId,
        authorId: userId,
        syncPath: `pages/referenced-${suffix}.md`,
        syncPathKey: `pages/referenced-${suffix}.md`,
      } });
      const attachment = await prisma.spaceAttachment.create({ data: {
        id: `attachment-${suffix}`, spaceId,
        displayName: `photo-${suffix}.png`, nameKey: `photo-${suffix}.png`,
        contentHash: referenced.hash, storageKey: referenced.key, mimeType: 'image/png',
        sizeBytes: 1n, width: 1, height: 1, status: 'active', uploadedByUserId: userId,
      } });
      const version = await prisma.attachmentVersion.create({ data: {
        id: `version-${suffix}`, attachmentId: attachment.id,
        contentHash: referenced.hash, storageKey: referenced.key, mimeType: 'image/png',
        sizeBytes: 1n, width: 1, height: 1,
      } });
      const archivedAttachment = await prisma.spaceAttachment.create({ data: {
        id: `archived-${suffix}`, spaceId,
        displayName: `old-${suffix}.png`, nameKey: `old-${suffix}.png`,
        contentHash: archived.hash, storageKey: archived.key, mimeType: 'image/png',
        sizeBytes: 1n, width: 1, height: 1, status: 'archived',
        archivedAt: new Date(now - 31 * DAY), uploadedByUserId: userId,
      } });
      await prisma.attachmentVersion.create({ data: {
        attachmentId: archivedAttachment.id,
        contentHash: archived.hash, storageKey: archived.key, mimeType: 'image/png',
        sizeBytes: 1n, width: 1, height: 1,
      } });

      const oldRevisionId = `revision-old-${suffix}`;
      const currentRevisionId = `revision-current-${suffix}`;
      await prisma.spaceKnowledgeRevision.createMany({ data: [
        {
          id: oldRevisionId, spaceId, sequence: 1, schemaVersion: 'content-tree@3',
          recipeVersion: 'referenced-images-v1', contentHash: '1'.repeat(64),
          revisionContentHash: '2'.repeat(64), pageCount: 0n, revisionBodyBytes: 0n,
          revisionManifestByteLength: 2n, attachmentCount: 1n, revisionAttachmentBytes: 1n,
          createdAt: new Date(now - 40 * DAY), supersededAt: new Date(now - 35 * DAY),
        },
        {
          id: currentRevisionId, spaceId, sequence: 2, parentRevisionId: oldRevisionId,
          schemaVersion: 'content-tree@3', recipeVersion: 'referenced-images-v1',
          contentHash: '3'.repeat(64), revisionContentHash: '4'.repeat(64),
          pageCount: 1n, revisionBodyBytes: 1n, revisionManifestByteLength: 2n,
          attachmentCount: 1n, revisionAttachmentBytes: 1n,
        },
      ] });
      await prisma.syncRevisionAttachmentRow.createMany({ data: [
        {
          revisionId: oldRevisionId, attachmentId: attachment.id,
          attachmentVersionId: version.id, spaceId, path: `assets/photo-${suffix}.png`,
          pathKey: `assets/photo-${suffix}.png`, ordinal: 0,
        },
        {
          revisionId: currentRevisionId, attachmentId: attachment.id,
          attachmentVersionId: version.id, spaceId, path: `assets/photo-${suffix}.png`,
          pathKey: `assets/photo-${suffix}.png`, ordinal: 0,
        },
      ] });
      await prisma.legacyRevisionSidecar.create({ data: {
        revisionId: currentRevisionId,
        sidecar: {
          syncV3Revision: {
            protocolVersion: '3',
            pageAttachmentIds: [
              { pageId: page.knowledgeKey, referencedAttachmentIds: [attachment.id] },
              { pageId: page.knowledgeKey, referencedAttachmentIds: [attachment.id] },
            ],
          },
        },
      } });

      const sessions = [
        { id: randomUUID(), expiresAt: new Date(now + DAY), blob: unexpired },
        { id: randomUUID(), expiresAt: new Date(now - DAY / 2), blob: grace },
        { id: randomUUID(), expiresAt: new Date(now - 2 * DAY), blob: expired },
      ];
      for (const entry of sessions) {
        await prisma.pushSession.create({ data: {
          id: entry.id, protocolVersion: '3', credentialFamilyId: randomUUID(),
          credentialId: randomUUID(), userId, spaceId, baseRevisionId: currentRevisionId,
          idempotencyKey: randomUUID(), capabilitiesHash: '5'.repeat(64),
          confirmationHash: '6'.repeat(64), confirmationByteLength: 2,
          changeCount: 0, totalBodyBytes: 0n, expiresAt: entry.expiresAt,
        } });
        await prisma.pushSessionBlob.create({ data: {
          sessionId: entry.id, contentHash: entry.blob.hash, sizeBytes: 1n,
          mimeType: 'image/png', width: 1, height: 1, status: 'verified',
          storageKey: entry.blob.key, verifiedAt: new Date(),
        } });
      }

      const authorization = new AuthorizationService(prisma);
      const writer = new SpaceRevisionWriterService(prisma, {});
      const attachmentService = new AttachmentService(prisma, authorization, writer, storage, config);
      let archiveError;
      try {
        await attachmentService.archive(spaceId, attachment.id, {
          expectedUpdatedAt: attachment.updatedAt.toISOString(),
        }, { userId });
      } catch (error) {
        archiveError = error;
      }
      const afterArchiveAttempt = await prisma.spaceAttachment.findUnique({
        where: { id: attachment.id },
      });

      const rawQuery = prisma.$queryRaw.bind(prisma);
      let raceFirstCheck = false;
      prisma.$queryRaw = async (...args) => {
        const result = await rawQuery(...args);
        const candidateKey = args[1];
        if (!raceFirstCheck && candidateKey === racing.key) {
          raceFirstCheck = true;
          await prisma.spaceAttachment.create({ data: {
            id: `race-owner-${suffix}`, spaceId,
            displayName: `race-${suffix}.png`, nameKey: `race-${suffix}.png`,
            contentHash: racing.hash, storageKey: racing.key, mimeType: 'image/png',
            sizeBytes: 1n, width: 1, height: 1, status: 'active', uploadedByUserId: userId,
          } });
        }
        return result;
      };
      const worker = new AttachmentCleanupWorker(
        prisma,
        { get: (key) => key === 'PROCESS_ROLE' ? 'worker' : undefined },
        storage,
        config,
      );
      await worker.tick();
      prisma.$queryRaw = rawQuery;

      const retention = new RevisionRetentionService(prisma);
      let retainedCount;
      let retentionError;
      try {
        retainedCount = await retention.cleanSpace(spaceId);
      } catch (error) {
        retentionError = error;
      }

      assert.equal(archiveError?.businessCode, 'ATTACHMENT_REFERENCED');
      assert.deepEqual(archiveError?.getResponse()?.details, {
        pages: [{ id: page.id, title: page.title }],
      });
      assert.equal(afterArchiveAttempt.status, 'active');
      assert.equal(retentionError, undefined);
      assert.equal(retainedCount, 1);
      assert.equal(await prisma.syncRevisionAttachmentRow.count({
        where: { revisionId: oldRevisionId },
      }), 0);
      assert.equal((await prisma.spaceAttachment.findUnique({ where: { id: attachment.id } })).status, 'active');
      assert.equal(await prisma.attachmentVersion.count({ where: { attachmentId: attachment.id } }), 1);
      assert.equal(await exists(referenced.path), true, 'readable revision/current/version owner');
      assert.equal(await exists(unexpired.path), true, 'unexpired session owner');
      assert.equal(await exists(grace.path), true, 'expired session grace owner');
      assert.equal(await exists(racing.path), true, 'new owner created between GC checks');
      assert.equal(await exists(expired.path), false, 'session beyond grace is collectible');
      assert.equal(await exists(orphan.path), false, 'unowned Blob is collectible');
      assert.equal(await exists(archived.path), false, 'unreferenced archived version is collectible');
      assert.equal(await prisma.spaceAttachment.findUnique({ where: { id: archivedAttachment.id } }), null);
      assert.equal(await prisma.attachmentVersion.count({ where: { attachmentId: archivedAttachment.id } }), 0);
    } finally {
      await prisma.$disconnect();
      await storage.onModuleDestroy?.();
      await rm(root, { recursive: true, force: true });
    }
  });
});
