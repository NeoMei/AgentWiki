-- Release B: contract. After Release A backfill and the legacy local-sync
-- regression window, stop dual-writing legacy JSON, add non-null/unique
-- constraints, and drop the legacy contentHash uniqueness.

-- Drop the legacy (spaceId, contentHash) unique constraint so A -> B -> A is
-- still represented by three distinct revisions.
ALTER TABLE "SpaceKnowledgeRevision" DROP CONSTRAINT IF EXISTS "SpaceKnowledgeRevision_spaceId_contentHash_key";

-- Keep a plain index for lookups without enforcing identity.
CREATE INDEX IF NOT EXISTS "SpaceKnowledgeRevision_spaceId_contentHash_idx" ON "SpaceKnowledgeRevision"("spaceId", "contentHash");

-- Legacy JSON becomes nullable; the compatibility adapter synthesizes the DTO
-- from the sidecar and normalized rows instead.
ALTER TABLE "SpaceKnowledgeRevision" ALTER COLUMN "snapshot" DROP NOT NULL;
ALTER TABLE "SpaceKnowledgeRevision" ALTER COLUMN "delta" DROP NOT NULL;

-- Normalized sync fields are now required.
ALTER TABLE "SpaceKnowledgeRevision" ALTER COLUMN "revisionContentHash" SET NOT NULL;
ALTER TABLE "SpaceKnowledgeRevision" ALTER COLUMN "pageCount" SET NOT NULL;
ALTER TABLE "SpaceKnowledgeRevision" ALTER COLUMN "revisionBodyBytes" SET NOT NULL;
ALTER TABLE "SpaceKnowledgeRevision" ALTER COLUMN "revisionManifestByteLength" SET NOT NULL;

-- Page sync path becomes the authoritative non-null sync identity.
ALTER TABLE "Page" ALTER COLUMN "syncPath" SET NOT NULL;
ALTER TABLE "Page" ALTER COLUMN "syncPathKey" SET NOT NULL;

-- Unique sync path key within a space, with an explicit constraint name.
ALTER TABLE "Page" ADD CONSTRAINT "Page_spaceId_syncPathKey_key" UNIQUE ("spaceId", "syncPathKey");

-- Global page identity: knowledgeKey must be unique across all spaces so two
-- concurrent finalizes cannot create the same public pageId in two spaces.
ALTER TABLE "Page" ADD CONSTRAINT "Page_knowledgeKey_key" UNIQUE ("knowledgeKey");

-- The old (spaceId, knowledgeKey) unique is now redundant with the global one.
ALTER TABLE "Page" DROP CONSTRAINT IF EXISTS "Page_spaceId_knowledgeKey_key";

-- NOTE: The bulk UPDATE that clears historical legacy JSON is a separate
-- operations step, run only after normalized rows/sidecar/blob validation and
-- after the compatibility routes no longer read the legacy JSON. Do not run it
-- here because it would remove the rollback safety net before validation.
