BEGIN;

CREATE INDEX "SpaceAttachment_storageKey_idx"
  ON "SpaceAttachment"("storageKey");
CREATE INDEX "AttachmentVersion_storageKey_idx"
  ON "AttachmentVersion"("storageKey");
CREATE INDEX "PushSessionBlob_storageKey_idx"
  ON "PushSessionBlob"("storageKey");
CREATE INDEX "SyncRevisionAttachmentRow_attachmentVersionId_attachmentId_idx"
  ON "SyncRevisionAttachmentRow"("attachmentVersionId", "attachmentId");

COMMIT;
