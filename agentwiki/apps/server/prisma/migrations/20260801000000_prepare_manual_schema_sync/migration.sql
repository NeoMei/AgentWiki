-- Compatibility bridge for the historical manual schema-sync migration.
--
-- The following migration creates KnowledgeSubmission before it creates
-- SpaceKnowledgeRevision, while also adding a foreign key to the latter. A
-- fresh database therefore needs this minimal table to exist first. The
-- 20260803000000 migration removes the compatibility-only columns and aligns
-- the result with prisma/schema.prisma.
CREATE TABLE IF NOT EXISTS "SpaceKnowledgeRevision" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "parentRevisionId" TEXT,
  "schemaVersion" TEXT NOT NULL,
  "recipeVersion" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "changeSetId" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
