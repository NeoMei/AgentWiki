BEGIN;

CREATE TABLE "AttachmentCleanupCursor" (
  "key" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "attachmentId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttachmentCleanupCursor_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "AttachmentCleanupCursor_position_check"
    CHECK (("archivedAt" IS NULL) = ("attachmentId" IS NULL))
);

DROP INDEX "SpaceAttachment_status_archivedAt_idx";
CREATE INDEX "SpaceAttachment_status_archivedAt_id_idx"
  ON "SpaceAttachment"("status", "archivedAt", "id");
CREATE INDEX "SyncRevisionAttachmentRow_attachmentId_spaceId_idx"
  ON "SyncRevisionAttachmentRow"("attachmentId", "spaceId");

COMMIT;
