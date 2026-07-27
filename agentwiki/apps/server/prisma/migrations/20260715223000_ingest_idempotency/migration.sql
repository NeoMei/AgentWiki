ALTER TABLE "IngestRun" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "IngestRun_sourceId_idempotencyKey_key" ON "IngestRun"("sourceId", "idempotencyKey");
