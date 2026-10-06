-- Add accepted-source epochs without inferring historical review state.
ALTER TABLE "Source" ADD COLUMN "currentSourceVersionId" TEXT,
    ADD COLUMN "currentSourceGeneration" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "IngestRun" ADD COLUMN "inputSourceGeneration" INTEGER;
ALTER TABLE "Page" ADD COLUMN "sourceGeneration" INTEGER;
ALTER TABLE "Source" ADD CONSTRAINT "Source_currentSourceVersionId_fkey"
    FOREIGN KEY ("currentSourceVersionId") REFERENCES "SourceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Source" ADD CONSTRAINT "Source_currentSourceGeneration_check"
    CHECK ("currentSourceGeneration" >= 0 AND ("currentSourceVersionId" IS NULL OR "currentSourceGeneration" > 0));
ALTER TABLE "IngestRun" ADD CONSTRAINT "IngestRun_inputSourceGeneration_check"
    CHECK ("inputSourceGeneration" IS NULL OR "inputSourceGeneration" > 0);
ALTER TABLE "Page" ADD CONSTRAINT "Page_sourceGeneration_check"
    CHECK ("sourceGeneration" IS NULL OR "sourceGeneration" > 0);
CREATE TABLE "SourceSyncReceipt" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "inputSourceGeneration" INTEGER,
    "resultStatus" TEXT NOT NULL,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceSyncReceipt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SourceSyncReceipt_inputSourceGeneration_check" CHECK ("inputSourceGeneration" IS NULL OR "inputSourceGeneration" > 0),
    CONSTRAINT "SourceSyncReceipt_resultStatus_check" CHECK ("resultStatus" IN ('queued', 'existing', 'noop'))
);
CREATE UNIQUE INDEX "SourceSyncReceipt_sourceId_idempotencyKey_key" ON "SourceSyncReceipt"("sourceId", "idempotencyKey");
ALTER TABLE "SourceSyncReceipt" ADD CONSTRAINT "SourceSyncReceipt_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;
