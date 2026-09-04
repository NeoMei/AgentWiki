import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  validateSyncV3TestDatabaseUrl,
  withSyncV3TestDatabase,
} from './sync-v3-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const baseDatabaseUrl = process.env.SYNC_V3_TEST_DATABASE_URL;
const UNIQUE_VIOLATION = /23505|already exists|unique constraint/iu;
const FOREIGN_KEY_VIOLATION = /23503|is still referenced|foreign key constraint/iu;

test('Sync v3 database URLs fail closed outside a dedicated test database and schema', () => {
  assert.throws(() => validateSyncV3TestDatabaseUrl(undefined), /required/iu);
  assert.throws(
    () => validateSyncV3TestDatabaseUrl('mysql://localhost/agentwiki_sync_v3_test'),
    /PostgreSQL/iu,
  );
  assert.throws(
    () => validateSyncV3TestDatabaseUrl('postgresql://localhost/agentwiki'),
    /database name.*test/iu,
  );
  assert.throws(
    () => validateSyncV3TestDatabaseUrl(
      'postgresql://localhost/agentwiki_test?schema=sync_v3_test_safe&schema=public',
    ),
    /schema/iu,
  );
  assert.throws(
    () => validateSyncV3TestDatabaseUrl('postgresql://localhost/agentwiki_test?schema=public'),
    /schema/iu,
  );
  assert.doesNotThrow(
    () => validateSyncV3TestDatabaseUrl('postgresql://localhost/agentwiki_sync_v3_test'),
  );
  assert.doesNotThrow(
    () => validateSyncV3TestDatabaseUrl(
      'postgresql://localhost/agentwiki_sync_v3_test?schema=sync_v3_test_existing_1',
    ),
  );
});

test('backfills one immutable version for every active attachment', {
  skip: baseDatabaseUrl ? false : 'SYNC_V3_TEST_DATABASE_URL is not configured',
  timeout: 180_000,
}, async () => {
  await withSyncV3TestDatabase(baseDatabaseUrl, async ({
    applySyncV3Migration,
    databaseUrl,
    schemaName,
  }) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = schemaName.replace('sync_v3_test_', '');
    const userId = `user_${suffix}`;
    const spaceId = `space_${suffix}`;
    try {
      await prisma.user.create({ data: { id: userId, email: `${userId}@sync-v3.test` } });
      await prisma.space.create({ data: { id: spaceId, name: 'Sync v3', slug: spaceId } });
      await prisma.spaceAttachment.createMany({ data: [
        {
          id: `active_a_${suffix}`,
          spaceId,
          displayName: 'a.png',
          nameKey: 'a.png',
          contentHash: 'a'.repeat(64),
          storageKey: `aa/${'a'.repeat(64)}`,
          mimeType: 'image/png',
          sizeBytes: 4n,
          width: 1,
          height: 1,
          status: 'active',
        },
        {
          id: `active_b_${suffix}`,
          spaceId,
          displayName: 'b.webp',
          nameKey: 'b.webp',
          contentHash: 'b'.repeat(64),
          storageKey: `bb/${'b'.repeat(64)}`,
          mimeType: 'image/webp',
          sizeBytes: 8n,
          width: 2,
          height: 2,
          status: 'active',
        },
        {
          id: `archived_${suffix}`,
          spaceId,
          displayName: 'old.gif',
          nameKey: 'old.gif',
          contentHash: 'c'.repeat(64),
          storageKey: `cc/${'c'.repeat(64)}`,
          mimeType: 'image/gif',
          sizeBytes: 16n,
          width: 4,
          height: 4,
          status: 'archived',
          archivedAt: new Date('2026-09-04T00:00:00.000Z'),
        },
      ] });

      await prisma.$executeRawUnsafe(`
        INSERT INTO "SpaceKnowledgeRevision" (
          id, "spaceId", sequence, "parentRevisionId", "schemaVersion", "recipeVersion",
          "contentHash", snapshot, delta, "revisionContentHash", "pageCount",
          "revisionBodyBytes", "revisionManifestByteLength"
        ) VALUES
          ('revision_v1_${suffix}', '${spaceId}', 1, NULL, '1', '1', '${'d'.repeat(64)}',
           NULL, NULL, '${'e'.repeat(64)}', 0, 0, 2),
          ('revision_v2_${suffix}', '${spaceId}', 2, 'revision_v1_${suffix}', '2', '2',
           '${'f'.repeat(64)}', NULL, NULL, '${'1'.repeat(64)}', 0, 0, 2)
      `);
      const historicalRevisionCount = await prisma.$queryRawUnsafe(
        'SELECT COUNT(*)::int AS count FROM "SpaceKnowledgeRevision"',
      );
      assert.equal(historicalRevisionCount[0].count, 2);

      await applySyncV3Migration();

      const rows = await prisma.$queryRawUnsafe(`
        SELECT a.id, v."contentHash", v."storageKey"
        FROM "SpaceAttachment" a
        JOIN "AttachmentVersion" v ON v."attachmentId" = a.id
        WHERE a.status = 'active'
        ORDER BY a.id
      `);
      assert.equal(rows.length, 2);
      assert.ok(rows.every((row) => row.contentHash && row.storageKey));
      assert.deepEqual(rows.map((row) => row.contentHash), ['a'.repeat(64), 'b'.repeat(64)]);

      const archivedVersions = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int AS count
        FROM "AttachmentVersion"
        WHERE "attachmentId" = 'archived_${suffix}'
      `);
      assert.equal(archivedVersions[0].count, 0);
      const historicalRows = await prisma.$queryRawUnsafe(`
        SELECT
          (SELECT COUNT(*)::int FROM "SpaceKnowledgeRevision") AS revisions,
          (SELECT COUNT(*)::int FROM "SyncRevisionAttachmentRow") AS attachment_rows,
          (SELECT COALESCE(SUM("attachmentCount"), 0)::int FROM "SpaceKnowledgeRevision") AS attachment_count,
          (SELECT COALESCE(SUM("revisionAttachmentBytes"), 0)::int FROM "SpaceKnowledgeRevision") AS attachment_bytes
      `);
      assert.deepEqual(historicalRows[0], {
        revisions: 2,
        attachment_rows: 0,
        attachment_count: 0,
        attachment_bytes: 0,
      });

      const versions = await prisma.$queryRawUnsafe(`
        SELECT id, "attachmentId", "contentHash"
        FROM "AttachmentVersion"
        ORDER BY "attachmentId"
      `);
      await assert.rejects(
        prisma.$executeRawUnsafe(`
          INSERT INTO "AttachmentVersion" (
            id, "attachmentId", "contentHash", "storageKey", "mimeType",
            "sizeBytes", width, height
          ) VALUES (
            'duplicate_${suffix}', '${versions[0].attachmentId}', '${versions[0].contentHash}',
            'duplicate/key', 'image/png', 4, 1, 1
          )
        `),
        UNIQUE_VIOLATION,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(`
          INSERT INTO "AttachmentVersion" (
            id, "attachmentId", "contentHash", "storageKey", "mimeType",
            "sizeBytes", width, height
          ) VALUES (
            'negative_${suffix}', '${versions[0].attachmentId}', '${'9'.repeat(64)}',
            'negative/key', 'image/png', -1, 1, 1
          )
        `),
        /23514|check constraint/iu,
      );

      await prisma.$executeRawUnsafe(`
        INSERT INTO "SyncRevisionAttachmentRow" (
          "revisionId", "attachmentId", "attachmentVersionId", path, "pathKey", ordinal
        ) VALUES (
          'revision_v2_${suffix}', '${versions[0].attachmentId}', '${versions[0].id}',
          'assets/a.png', 'assets/a.png', 0
        )
      `);
      await assert.rejects(
        prisma.$executeRawUnsafe(`
          INSERT INTO "SyncRevisionAttachmentRow" (
            "revisionId", "attachmentId", "attachmentVersionId", path, "pathKey", ordinal
          ) VALUES (
            'revision_v2_${suffix}', '${versions[0].attachmentId}', '${versions[0].id}',
            'assets/a-renamed.png', 'assets/a-renamed.png', 1
          )
        `),
        UNIQUE_VIOLATION,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(`
          INSERT INTO "SyncRevisionAttachmentRow" (
            "revisionId", "attachmentId", "attachmentVersionId", path, "pathKey", ordinal
          ) VALUES (
            'revision_v2_${suffix}', '${versions[1].attachmentId}', '${versions[1].id}',
            'assets/different.png', 'assets/a.png', 1
          )
        `),
        UNIQUE_VIOLATION,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(`
          INSERT INTO "SyncRevisionAttachmentRow" (
            "revisionId", "attachmentId", "attachmentVersionId", path, "pathKey", ordinal
          ) VALUES (
            'revision_v2_${suffix}', '${versions[1].attachmentId}', '${versions[1].id}',
            'assets/b.webp', 'assets/b.webp', 0
          )
        `),
        UNIQUE_VIOLATION,
      );

      await assert.rejects(
        prisma.$executeRawUnsafe(`DELETE FROM "AttachmentVersion" WHERE id = '${versions[0].id}'`),
        FOREIGN_KEY_VIOLATION,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(`DELETE FROM "SpaceAttachment" WHERE id = '${versions[0].attachmentId}'`),
        FOREIGN_KEY_VIOLATION,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(`DELETE FROM "SpaceKnowledgeRevision" WHERE id = 'revision_v2_${suffix}'`),
        FOREIGN_KEY_VIOLATION,
      );
      await prisma.spaceAttachment.update({
        where: { id: versions[0].attachmentId },
        data: { status: 'archived', archivedAt: new Date('2026-09-04T01:00:00.000Z') },
      });
      const retainedEvidence = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*)::int AS count
        FROM "SyncRevisionAttachmentRow"
        WHERE "attachmentVersionId" = '${versions[0].id}'
      `);
      assert.equal(retainedEvidence[0].count, 1);
      await assert.rejects(
        prisma.$executeRawUnsafe(`
          UPDATE "SpaceKnowledgeRevision"
          SET "revisionAttachmentBytes" = -1
          WHERE id = 'revision_v1_${suffix}'
        `),
        /23514|check constraint/iu,
      );

      const pushSessionId = `push_${suffix}`;
      await prisma.$executeRawUnsafe(`
        INSERT INTO "PushSession" (
          id, "protocolVersion", "credentialFamilyId", "credentialId", "userId", "spaceId",
          "baseRevisionId", "idempotencyKey", status, "capabilitiesHash", "confirmationHash",
          "confirmationByteLength", "changeCount", "totalBodyBytes", "expiresAt",
          "attachmentCount", "transferBlobBytes", "updatedAt"
        ) VALUES (
          '${pushSessionId}', '3', 'family_${suffix}', 'credential_${suffix}', '${userId}', '${spaceId}',
          'revision_v2_${suffix}', 'idempotency_${suffix}', 'uploading', '${'2'.repeat(64)}',
          '${'3'.repeat(64)}', 1, 0, 0, CURRENT_TIMESTAMP + INTERVAL '1 hour', 1, 4,
          CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "PushSessionBlob" (
          "sessionId", "contentHash", "sizeBytes", "mimeType", width, height, status
        ) VALUES ('${pushSessionId}', '${'4'.repeat(64)}', 4, 'image/png', 1, 1, 'uploading')
      `);
      await prisma.$executeRawUnsafe(`
        INSERT INTO "PushSessionBlobChunk" (
          "sessionId", "contentHash", "chunkIndex", "chunkHash", "sizeBytes", receipt
        ) VALUES ('${pushSessionId}', '${'4'.repeat(64)}', 0, '${'5'.repeat(64)}', 4, 'receipt-0')
      `);
      await assert.rejects(
        prisma.$executeRawUnsafe(`
          INSERT INTO "PushSessionBlobChunk" (
            "sessionId", "contentHash", "chunkIndex", "chunkHash", "sizeBytes", receipt
          ) VALUES ('${pushSessionId}', '${'4'.repeat(64)}', 10, '${'6'.repeat(64)}', 1, 'receipt-10')
        `),
        /check constraint/iu,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(`
          UPDATE "PushSession"
          SET "transferBlobBytes" = -1
          WHERE id = '${pushSessionId}'
        `),
        /23514|check constraint/iu,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(`
          INSERT INTO "PushSessionBlobChunk" (
            "sessionId", "contentHash", "chunkIndex", "chunkHash", "sizeBytes", receipt
          ) VALUES ('${pushSessionId}', '${'4'.repeat(64)}', 1, '${'7'.repeat(64)}', 1048577, 'receipt-large')
        `),
        /check constraint/iu,
      );

      await prisma.$executeRawUnsafe(`
        INSERT INTO "PushSessionV3Change" (
          "sessionId", ordinal, "entityType", "entityId", operation, payload
        ) VALUES ('${pushSessionId}', 0, 'attachment', '${versions[0].attachmentId}', 'upsert_attachment', '{}')
      `);
      await assert.rejects(
        prisma.$executeRawUnsafe(`
          INSERT INTO "PushSessionV3Change" (
            "sessionId", ordinal, "entityType", "entityId", operation, payload
          ) VALUES ('${pushSessionId}', 1, 'attachment', '${versions[0].attachmentId}', 'detach_attachment', '{}')
        `),
        UNIQUE_VIOLATION,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(`
          INSERT INTO "PushSessionV3Change" (
            "sessionId", ordinal, "entityType", "entityId", operation, payload
          ) VALUES ('${pushSessionId}', 100, 'page', 'page-over-limit', 'upsert_page', '{}')
        `),
        /23514|check constraint/iu,
      );
      await prisma.$executeRawUnsafe(`DELETE FROM "PushSession" WHERE id = '${pushSessionId}'`);
      const stagedRows = await prisma.$queryRawUnsafe(`
        SELECT
          (SELECT COUNT(*)::int FROM "PushSessionV3Change") AS changes,
          (SELECT COUNT(*)::int FROM "PushSessionBlob") AS blobs,
          (SELECT COUNT(*)::int FROM "PushSessionBlobChunk") AS chunks
      `);
      assert.deepEqual(stagedRows[0], { changes: 0, blobs: 0, chunks: 0 });
      await assert.rejects(
        prisma.$executeRawUnsafe(`
          INSERT INTO "PushSessionBlob" (
            "sessionId", "contentHash", "sizeBytes", "mimeType", width, height, status
          ) VALUES ('${pushSessionId}', '${'8'.repeat(64)}', -1, 'image/png', 1, 1, 'uploading')
        `),
        /check constraint/iu,
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});
