BEGIN;
CREATE TYPE "SpaceAttachmentStatus" AS ENUM ('active', 'archived');

CREATE TABLE "SpaceAttachment" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "status" "SpaceAttachmentStatus" NOT NULL DEFAULT 'active',
  "uploadedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "SpaceAttachment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SpaceAttachment" ADD CONSTRAINT "SpaceAttachment_hash_check"
  CHECK ("contentHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "SpaceAttachment" ADD CONSTRAINT "SpaceAttachment_size_check"
  CHECK ("sizeBytes" > 0);
ALTER TABLE "SpaceAttachment" ADD CONSTRAINT "SpaceAttachment_dimensions_check"
  CHECK ("width" > 0 AND "height" > 0);
ALTER TABLE "SpaceAttachment" ADD CONSTRAINT "SpaceAttachment_state_check"
  CHECK (("status" = 'active' AND "archivedAt" IS NULL)
    OR ("status" = 'archived' AND "archivedAt" IS NOT NULL));

CREATE UNIQUE INDEX "SpaceAttachment_spaceId_nameKey_key"
  ON "SpaceAttachment"("spaceId", "nameKey");
CREATE INDEX "SpaceAttachment_spaceId_status_updatedAt_idx"
  ON "SpaceAttachment"("spaceId", "status", "updatedAt");
CREATE INDEX "SpaceAttachment_contentHash_idx"
  ON "SpaceAttachment"("contentHash");
CREATE INDEX "SpaceAttachment_status_archivedAt_idx"
  ON "SpaceAttachment"("status", "archivedAt");

ALTER TABLE "SpaceAttachment" ADD CONSTRAINT "SpaceAttachment_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpaceAttachment" ADD CONSTRAINT "SpaceAttachment_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;
