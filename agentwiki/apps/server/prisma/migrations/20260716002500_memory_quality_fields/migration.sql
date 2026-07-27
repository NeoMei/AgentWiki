ALTER TABLE "AgentMemory" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "AgentMemory" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';
ALTER TABLE "AgentMemory" ADD COLUMN "embedding" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[];
ALTER TABLE "AgentMemory" ADD COLUMN "embeddingModel" TEXT;
UPDATE "AgentMemory" SET "contentHash" = md5(lower(regexp_replace("content", '\s+', ' ', 'g')));
ALTER TABLE "AgentMemory" ALTER COLUMN "contentHash" SET NOT NULL;
UPDATE "AgentMemory" memory SET "sourceEvidenceId" = NULL
WHERE memory."sourceEvidenceId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Evidence" evidence WHERE evidence."id" = memory."sourceEvidenceId");
CREATE INDEX "AgentMemory_agentId_spaceId_contentHash_idx" ON "AgentMemory"("agentId", "spaceId", "contentHash");
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_sourceEvidenceId_fkey" FOREIGN KEY ("sourceEvidenceId") REFERENCES "Evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
