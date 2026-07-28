ALTER TABLE "Source" ADD COLUMN "sourceKey" TEXT;
ALTER TABLE "IngestRun" ADD COLUMN "inputSourceVersionId" TEXT;

CREATE UNIQUE INDEX "Source_spaceId_type_sourceKey_key"
  ON "Source"("spaceId", "type", "sourceKey");
CREATE INDEX "IngestRun_inputSourceVersionId_idx"
  ON "IngestRun"("inputSourceVersionId");

ALTER TABLE "IngestRun"
  ADD CONSTRAINT "IngestRun_inputSourceVersionId_fkey"
  FOREIGN KEY ("inputSourceVersionId") REFERENCES "SourceVersion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
