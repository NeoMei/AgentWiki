import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as syncV3TestDatabase from './sync-v3-test-database.mjs';

const {
  validateSyncV3TestDatabaseUrl,
  withSyncV3TestDatabase,
} = syncV3TestDatabase;

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const baseDatabaseUrl = process.env.SYNC_V3_TEST_DATABASE_URL;
const UNIQUE_VIOLATION = /23505|already exists|unique constraint/iu;
const FOREIGN_KEY_VIOLATION = /23503|is still referenced|foreign key constraint/iu;

test('migration deploy keeps credentials out of argv and redacts failure diagnostics', () => {
  assert.equal(typeof syncV3TestDatabase.buildMigrationDeployProcess, 'function');
  assert.equal(typeof syncV3TestDatabase.redactMigrationDiagnostics, 'function');

  const secretUrl = 'postgresql://sync-user:secret-password@localhost/agentwiki_test';
  const invocation = syncV3TestDatabase.buildMigrationDeployProcess({
    databaseUrl: secretUrl,
    prismaRoot: '/tmp/sync-v3-prisma',
  });
  assert.equal(invocation.args.some((argument) => argument.includes(secretUrl)), false);
  assert.equal(invocation.args.some((argument) => argument.includes('secret-password')), false);
  assert.equal(invocation.options.env.DATABASE_URL, secretUrl);
  assert.equal('SYNC_V3_TEST_DATABASE_URL' in invocation.options.env, false);
  assert.equal(
    syncV3TestDatabase.redactMigrationDiagnostics(
      `migration failed for ${secretUrl}: secret-password`,
      new Set([secretUrl, 'secret-password']),
    ),
    'migration failed for [REDACTED]: [REDACTED]',
  );
});

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

      const deployment = await applySyncV3Migration();
      assert.match(deployment.firstDeployOutput, /1 migration found|Applying migration/iu);
      assert.match(deployment.secondDeployOutput, /No pending migrations to apply/iu);
      const deploymentDiagnostics = JSON.stringify(deployment);
      assert.equal(deploymentDiagnostics.includes(baseDatabaseUrl), false);
      const configuredPassword = decodeURIComponent(
        validateSyncV3TestDatabaseUrl(baseDatabaseUrl).password,
      );
      if (configuredPassword) {
        assert.equal(deploymentDiagnostics.includes(configuredPassword), false);
      }
      const migrationLedger = await prisma.$queryRawUnsafe(`
        SELECT
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE finished_at IS NOT NULL)::int AS finished,
          COUNT(*) FILTER (WHERE rolled_back_at IS NOT NULL)::int AS rolled_back
        FROM "_prisma_migrations"
        WHERE migration_name = '20260904120000_add_sync_v3_attachments'
      `);
      assert.deepEqual(migrationLedger[0], { count: 1, finished: 1, rolled_back: 0 });

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
      const insertRevisionAttachment = ({
        revisionId = `revision_v2_${suffix}`,
        attachmentId,
        attachmentVersionId,
        rowSpaceId = spaceId,
        path,
        pathKey = path,
        ordinal,
      }) => prisma.$executeRawUnsafe(`
        INSERT INTO "SyncRevisionAttachmentRow" (
          "revisionId", "attachmentId", "attachmentVersionId", "spaceId",
          path, "pathKey", ordinal
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, revisionId, attachmentId, attachmentVersionId, rowSpaceId, path, pathKey, ordinal);
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

      await insertRevisionAttachment({
        attachmentId: versions[0].attachmentId,
        attachmentVersionId: versions[0].id,
        path: 'assets/a.png',
        ordinal: 0,
      });
      await assert.rejects(
        insertRevisionAttachment({
          attachmentId: versions[0].attachmentId,
          attachmentVersionId: versions[0].id,
          path: 'assets/a-renamed.png',
          ordinal: 1,
        }),
        UNIQUE_VIOLATION,
      );
      await assert.rejects(
        insertRevisionAttachment({
          attachmentId: versions[1].attachmentId,
          attachmentVersionId: versions[1].id,
          path: 'assets/different.png',
          pathKey: 'assets/a.png',
          ordinal: 1,
        }),
        UNIQUE_VIOLATION,
      );
      await assert.rejects(
        insertRevisionAttachment({
          attachmentId: versions[1].attachmentId,
          attachmentVersionId: versions[1].id,
          path: 'assets/b.webp',
          ordinal: 0,
        }),
        UNIQUE_VIOLATION,
      );

      await assert.rejects(
        insertRevisionAttachment({
          attachmentId: versions[1].attachmentId,
          attachmentVersionId: versions[0].id,
          path: 'assets/wrong-version.webp',
          ordinal: 1,
        }),
        FOREIGN_KEY_VIOLATION,
      );

      const secondSpaceId = `space_other_${suffix}`;
      const secondAttachmentId = `other_attachment_${suffix}`;
      const secondVersionId = `other_version_${suffix}`;
      await prisma.space.create({
        data: { id: secondSpaceId, name: 'Other Sync v3', slug: secondSpaceId },
      });
      await prisma.spaceAttachment.create({
        data: {
          id: secondAttachmentId,
          spaceId: secondSpaceId,
          displayName: 'other.jpeg',
          nameKey: 'other.jpeg',
          contentHash: '6'.repeat(64),
          storageKey: `66/${'6'.repeat(64)}`,
          mimeType: 'image/jpeg',
          sizeBytes: 4n,
          width: 1,
          height: 1,
          status: 'active',
        },
      });
      await prisma.$executeRawUnsafe(`
        INSERT INTO "AttachmentVersion" (
          id, "attachmentId", "contentHash", "storageKey", "mimeType",
          "sizeBytes", width, height
        ) VALUES ($1, $2, $3, $4, 'image/jpeg', 4, 1, 1)
      `, secondVersionId, secondAttachmentId, '6'.repeat(64), `66/${'6'.repeat(64)}`);
      await assert.rejects(
        insertRevisionAttachment({
          attachmentId: secondAttachmentId,
          attachmentVersionId: secondVersionId,
          path: 'assets/other.jpeg',
          ordinal: 1,
        }),
        FOREIGN_KEY_VIOLATION,
      );

      for (const invalidPath of [
        'assets/',
        'assets/sub/a.png',
        'assets/../a.png',
        'assets/..',
        String.raw`assets\a.png`,
        String.raw`assets/a\b.png`,
      ]) {
        await assert.rejects(
          insertRevisionAttachment({
            attachmentId: versions[1].attachmentId,
            attachmentVersionId: versions[1].id,
            path: invalidPath,
            pathKey: 'assets/valid.png',
            ordinal: 1,
          }),
          /23514|check constraint/iu,
          `expected database to reject invalid attachment path: ${invalidPath}`,
        );
        await assert.rejects(
          insertRevisionAttachment({
            attachmentId: versions[1].attachmentId,
            attachmentVersionId: versions[1].id,
            path: 'assets/valid.png',
            pathKey: invalidPath,
            ordinal: 1,
          }),
          /23514|check constraint/iu,
          `expected database to reject invalid attachment pathKey: ${invalidPath}`,
        );
      }

      for (const validPath of [
        'assets/image.png',
        'assets/image.jpg',
        'assets/image.jpeg',
        'assets/image.webp',
        'assets/image.gif',
      ]) {
        await insertRevisionAttachment({
          attachmentId: versions[1].attachmentId,
          attachmentVersionId: versions[1].id,
          path: validPath,
          ordinal: 1,
        });
        await prisma.$executeRawUnsafe(`
          DELETE FROM "SyncRevisionAttachmentRow"
          WHERE "revisionId" = $1 AND "attachmentId" = $2
        `, `revision_v2_${suffix}`, versions[1].attachmentId);
      }

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
