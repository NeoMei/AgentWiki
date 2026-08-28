ALTER TABLE "PushSession"
  ADD COLUMN "protocolVersion" TEXT NOT NULL DEFAULT '1';

ALTER TABLE "PushSession"
  ADD CONSTRAINT "PushSession_protocolVersion_check"
  CHECK ("protocolVersion" IN ('1', '2'));
