-- This migration syncs the database schema to match prisma/schema.prisma
-- Applied manually because the Prisma user lacks CREATEDB permission for shadow DB.

-- Add missing columns to Page
ALTER TABLE "Page" ADD COLUMN IF NOT EXISTS "knowledgeKey" TEXT NOT NULL DEFAULT gen_random_uuid();

-- Add missing columns to KnowledgeRelation
ALTER TABLE "KnowledgeRelation" ADD COLUMN IF NOT EXISTS "knowledgeKey" TEXT;
ALTER TABLE "KnowledgeRelation" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP;
UPDATE "KnowledgeRelation" SET "knowledgeKey" = gen_random_uuid()::text WHERE "knowledgeKey" IS NULL;
ALTER TABLE "KnowledgeRelation" ALTER COLUMN "knowledgeKey" SET NOT NULL;
ALTER TABLE "KnowledgeRelation" ALTER COLUMN "createdAt" SET NOT NULL;

-- Create missing KnowledgeSubmission table
CREATE TABLE IF NOT EXISTS "KnowledgeSubmission" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId" TEXT NOT NULL,
  "baseRevisionId" TEXT,
  "principalKey" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "recipeVersion" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  bundle JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  "changeSetId" TEXT UNIQUE,
  "appliedRevisionId" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeSubmission_spaceId_principalKey_idempotencyKey_key" ON "KnowledgeSubmission"("spaceId", "principalKey", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "KnowledgeSubmission_spaceId_status_createdAt_idx" ON "KnowledgeSubmission"("spaceId", status, "createdAt");
ALTER TABLE "KnowledgeSubmission" DROP CONSTRAINT IF EXISTS "KnowledgeSubmission_changeSetId_fkey";
ALTER TABLE "KnowledgeSubmission" ADD CONSTRAINT "KnowledgeSubmission_changeSetId_fkey" FOREIGN KEY ("changeSetId") REFERENCES "ChangeSet"(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSubmission" DROP CONSTRAINT IF EXISTS "KnowledgeSubmission_appliedRevisionId_fkey";
ALTER TABLE "KnowledgeSubmission" ADD CONSTRAINT "KnowledgeSubmission_appliedRevisionId_fkey" FOREIGN KEY ("appliedRevisionId") REFERENCES "SpaceKnowledgeRevision"(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Create missing SpaceKnowledgeRevision table
CREATE TABLE IF NOT EXISTS "SpaceKnowledgeRevision" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId" TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  "parentRevisionId" TEXT,
  "schemaVersion" TEXT NOT NULL,
  "recipeVersion" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  "changeSetId" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SpaceKnowledgeRevision_spaceId_sequence_idx" ON "SpaceKnowledgeRevision"("spaceId", sequence);
ALTER TABLE "SpaceKnowledgeRevision" DROP CONSTRAINT IF EXISTS "SpaceKnowledgeRevision_changeSetId_fkey";
ALTER TABLE "SpaceKnowledgeRevision" ADD CONSTRAINT "SpaceKnowledgeRevision_changeSetId_fkey" FOREIGN KEY ("changeSetId") REFERENCES "ChangeSet"(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SpaceKnowledgeRevision" DROP CONSTRAINT IF EXISTS "SpaceKnowledgeRevision_parentRevisionId_fkey";
ALTER TABLE "SpaceKnowledgeRevision" ADD CONSTRAINT "SpaceKnowledgeRevision_parentRevisionId_fkey" FOREIGN KEY ("parentRevisionId") REFERENCES "SpaceKnowledgeRevision"(id) ON DELETE SET NULL ON UPDATE CASCADE;
