BEGIN;

ALTER TABLE "SpaceKnowledgeRevision"
  ADD COLUMN "attachmentCount" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "revisionAttachmentBytes" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "PushSession"
  ADD COLUMN "attachmentCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "transferBlobBytes" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "PushSession" DROP CONSTRAINT "PushSession_protocolVersion_check";
ALTER TABLE "PushSession" ADD CONSTRAINT "PushSession_protocolVersion_check"
  CHECK ("protocolVersion" IN ('1', '2', '3'));

CREATE TABLE "AttachmentVersion" (
  "id" TEXT NOT NULL,
  "attachmentId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttachmentVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SyncRevisionAttachmentRow" (
  "revisionId" TEXT NOT NULL,
  "attachmentId" TEXT NOT NULL,
  "attachmentVersionId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "pathKey" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  CONSTRAINT "SyncRevisionAttachmentRow_pkey" PRIMARY KEY ("revisionId", "attachmentId")
);

CREATE TABLE "PushSessionV3Change" (
  "sessionId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  CONSTRAINT "PushSessionV3Change_pkey" PRIMARY KEY ("sessionId", "ordinal")
);

CREATE TABLE "PushSessionBlob" (
  "sessionId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "storageKey" TEXT,
  "verifiedAt" TIMESTAMP(3),
  CONSTRAINT "PushSessionBlob_pkey" PRIMARY KEY ("sessionId", "contentHash")
);

CREATE TABLE "PushSessionBlobChunk" (
  "sessionId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "chunkHash" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "receipt" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSessionBlobChunk_pkey" PRIMARY KEY ("sessionId", "contentHash", "chunkIndex")
);

CREATE INDEX "AttachmentVersion_contentHash_idx"
  ON "AttachmentVersion"("contentHash");
CREATE UNIQUE INDEX "AttachmentVersion_attachmentId_contentHash_key"
  ON "AttachmentVersion"("attachmentId", "contentHash");
CREATE UNIQUE INDEX "AttachmentVersion_id_attachmentId_key"
  ON "AttachmentVersion"("id", "attachmentId");
CREATE UNIQUE INDEX "SpaceAttachment_id_spaceId_key"
  ON "SpaceAttachment"("id", "spaceId");
CREATE UNIQUE INDEX "SpaceKnowledgeRevision_id_spaceId_key"
  ON "SpaceKnowledgeRevision"("id", "spaceId");
CREATE UNIQUE INDEX "SyncRevisionAttachmentRow_revisionId_pathKey_key"
  ON "SyncRevisionAttachmentRow"("revisionId", "pathKey");
CREATE UNIQUE INDEX "SyncRevisionAttachmentRow_revisionId_ordinal_key"
  ON "SyncRevisionAttachmentRow"("revisionId", "ordinal");
CREATE UNIQUE INDEX "PushSessionV3Change_sessionId_entityType_entityId_key"
  ON "PushSessionV3Change"("sessionId", "entityType", "entityId");
CREATE UNIQUE INDEX "PushSessionBlobChunk_sessionId_contentHash_receipt_key"
  ON "PushSessionBlobChunk"("sessionId", "contentHash", "receipt");

ALTER TABLE "AttachmentVersion" ADD CONSTRAINT "AttachmentVersion_content_check"
  CHECK (
    "contentHash" ~ '^[0-9a-f]{64}$'
    AND char_length("storageKey") > 0
    AND "mimeType" IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
    AND "sizeBytes" BETWEEN 0 AND 10485760
    AND "width" BETWEEN 1 AND 10000
    AND "height" BETWEEN 1 AND 10000
    AND "width"::BIGINT * "height"::BIGINT <= 40000000
  );
ALTER TABLE "SyncRevisionAttachmentRow" ADD CONSTRAINT "SyncRevisionAttachmentRow_fields_check"
  CHECK (
    "path" ~* '^assets/[^/\\]+\.(png|jpe?g|webp|gif)$'
    AND "pathKey" ~* '^assets/[^/\\]+\.(png|jpe?g|webp|gif)$'
    AND substring("path" FROM 8) NOT IN ('.', '..')
    AND substring("pathKey" FROM 8) NOT IN ('.', '..')
    AND "ordinal" BETWEEN 0 AND 999
  );
ALTER TABLE "PushSessionV3Change" ADD CONSTRAINT "PushSessionV3Change_fields_check"
  CHECK (
    "ordinal" BETWEEN 0 AND 99
    AND char_length("entityType") > 0
    AND char_length("entityId") > 0
    AND char_length("operation") > 0
  );
ALTER TABLE "PushSessionBlob" ADD CONSTRAINT "PushSessionBlob_content_check"
  CHECK (
    "contentHash" ~ '^[0-9a-f]{64}$'
    AND "sizeBytes" BETWEEN 0 AND 10485760
    AND "mimeType" IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
    AND "width" BETWEEN 1 AND 10000
    AND "height" BETWEEN 1 AND 10000
    AND "width"::BIGINT * "height"::BIGINT <= 40000000
  );
ALTER TABLE "PushSessionBlobChunk" ADD CONSTRAINT "PushSessionBlobChunk_bounds_check"
  CHECK (
    "chunkIndex" BETWEEN 0 AND 9
    AND "chunkHash" ~ '^[0-9a-f]{64}$'
    AND "sizeBytes" BETWEEN 0 AND 1048576
    AND char_length("receipt") > 0
  );
ALTER TABLE "SpaceKnowledgeRevision" ADD CONSTRAINT "SpaceKnowledgeRevision_attachment_counts_check"
  CHECK (
    "attachmentCount" BETWEEN 0 AND 1000
    AND "revisionAttachmentBytes" >= 0
  );
ALTER TABLE "PushSession" ADD CONSTRAINT "PushSession_attachment_counts_check"
  CHECK (
    "attachmentCount" BETWEEN 0 AND 1000
    AND "transferBlobBytes" BETWEEN 0 AND 104857600
  );

ALTER TABLE "AttachmentVersion" ADD CONSTRAINT "AttachmentVersion_attachmentId_fkey"
  FOREIGN KEY ("attachmentId") REFERENCES "SpaceAttachment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SyncRevisionAttachmentRow" ADD CONSTRAINT "SyncRevisionAttachmentRow_revisionId_spaceId_fkey"
  FOREIGN KEY ("revisionId", "spaceId") REFERENCES "SpaceKnowledgeRevision"("id", "spaceId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SyncRevisionAttachmentRow" ADD CONSTRAINT "SyncRevisionAttachmentRow_attachmentId_spaceId_fkey"
  FOREIGN KEY ("attachmentId", "spaceId") REFERENCES "SpaceAttachment"("id", "spaceId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SyncRevisionAttachmentRow" ADD CONSTRAINT "SyncRevisionAttachmentRow_attachmentVersionId_attachmentId_fkey"
  FOREIGN KEY ("attachmentVersionId", "attachmentId") REFERENCES "AttachmentVersion"("id", "attachmentId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PushSessionV3Change" ADD CONSTRAINT "PushSessionV3Change_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "PushSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSessionBlob" ADD CONSTRAINT "PushSessionBlob_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "PushSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSessionBlobChunk" ADD CONSTRAINT "PushSessionBlobChunk_sessionId_contentHash_fkey"
  FOREIGN KEY ("sessionId", "contentHash") REFERENCES "PushSessionBlob"("sessionId", "contentHash")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "AttachmentVersion" (
  "id", "attachmentId", "contentHash", "storageKey", "mimeType",
  "sizeBytes", "width", "height", "createdAt"
)
SELECT
  'syncv3_' || md5(a."id" || chr(31) || a."contentHash"),
  a."id",
  a."contentHash",
  a."storageKey",
  a."mimeType",
  a."sizeBytes",
  a."width",
  a."height",
  a."createdAt"
FROM "SpaceAttachment" a
WHERE a."status" = 'active';

COMMIT;
