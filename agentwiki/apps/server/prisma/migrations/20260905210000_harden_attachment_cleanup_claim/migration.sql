BEGIN;

ALTER TABLE "AttachmentCleanupCursor"
  ADD COLUMN "sweepArchivedAt" TIMESTAMP(3),
  ADD COLUMN "sweepAttachmentId" TEXT,
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

ALTER TABLE "AttachmentCleanupCursor"
  ADD CONSTRAINT "AttachmentCleanupCursor_sweep_check"
    CHECK (("sweepArchivedAt" IS NULL) = ("sweepAttachmentId" IS NULL)),
  ADD CONSTRAINT "AttachmentCleanupCursor_lease_check"
    CHECK (("leaseOwner" IS NULL) = ("leaseExpiresAt" IS NULL)),
  ADD CONSTRAINT "AttachmentCleanupCursor_singleton_check"
    CHECK ("key" = 'archived-attachments-v1');

INSERT INTO "AttachmentCleanupCursor" ("key")
VALUES ('archived-attachments-v1')
ON CONFLICT ("key") DO NOTHING;

COMMIT;
