BEGIN;

-- Match Prisma's application-generated cuid defaults and missing indexes.
ALTER TABLE "Page" ALTER COLUMN "knowledgeKey" DROP DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS "Page_spaceId_knowledgeKey_key"
  ON "Page"("spaceId", "knowledgeKey");

ALTER TABLE "KnowledgeRelation" ALTER COLUMN "knowledgeKey" DROP DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeRelation_knowledgeKey_key"
  ON "KnowledgeRelation"("knowledgeKey");

ALTER TABLE "KnowledgeSubmission" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "KnowledgeSubmission" ALTER COLUMN "updatedAt" DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'KnowledgeSubmission_spaceId_fkey'
      AND conrelid = '"KnowledgeSubmission"'::regclass
  ) THEN
    ALTER TABLE "KnowledgeSubmission"
      ADD CONSTRAINT "KnowledgeSubmission_spaceId_fkey"
      FOREIGN KEY ("spaceId") REFERENCES "Space"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "SpaceKnowledgeRevision"
  ADD COLUMN IF NOT EXISTS "delta" JSONB,
  ADD COLUMN IF NOT EXISTS "sourceChangeSetId" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'SpaceKnowledgeRevision'
      AND column_name = 'changeSetId'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM "SpaceKnowledgeRevision"
      WHERE "sourceChangeSetId" IS NOT NULL
        AND "changeSetId" IS NOT NULL
        AND "sourceChangeSetId" IS DISTINCT FROM "changeSetId"
    ) THEN
      RAISE EXCEPTION 'SpaceKnowledgeRevision contains conflicting changeSetId values';
    END IF;

    UPDATE "SpaceKnowledgeRevision"
    SET "sourceChangeSetId" = COALESCE("sourceChangeSetId", "changeSetId");

    ALTER TABLE "SpaceKnowledgeRevision"
      DROP CONSTRAINT IF EXISTS "SpaceKnowledgeRevision_changeSetId_fkey";
    ALTER TABLE "SpaceKnowledgeRevision"
      DROP COLUMN "changeSetId";
  END IF;
END $$;

UPDATE "SpaceKnowledgeRevision"
SET "delta" = '{}'::jsonb
WHERE "delta" IS NULL;

ALTER TABLE "SpaceKnowledgeRevision" ALTER COLUMN "delta" SET NOT NULL;
ALTER TABLE "SpaceKnowledgeRevision" ALTER COLUMN "delta" DROP DEFAULT;
ALTER TABLE "SpaceKnowledgeRevision" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "SpaceKnowledgeRevision" DROP COLUMN IF EXISTS "updatedAt";
ALTER TABLE "SpaceKnowledgeRevision"
  DROP CONSTRAINT IF EXISTS "SpaceKnowledgeRevision_parentRevisionId_fkey";

DROP INDEX IF EXISTS "SpaceKnowledgeRevision_spaceId_sequence_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "SpaceKnowledgeRevision_spaceId_sequence_key"
  ON "SpaceKnowledgeRevision"("spaceId", "sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "SpaceKnowledgeRevision_spaceId_contentHash_key"
  ON "SpaceKnowledgeRevision"("spaceId", "contentHash");
CREATE UNIQUE INDEX IF NOT EXISTS "SpaceKnowledgeRevision_sourceChangeSetId_key"
  ON "SpaceKnowledgeRevision"("sourceChangeSetId");
CREATE INDEX IF NOT EXISTS "SpaceKnowledgeRevision_spaceId_createdAt_idx"
  ON "SpaceKnowledgeRevision"("spaceId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'SpaceKnowledgeRevision_spaceId_fkey'
      AND conrelid = '"SpaceKnowledgeRevision"'::regclass
  ) THEN
    ALTER TABLE "SpaceKnowledgeRevision"
      ADD CONSTRAINT "SpaceKnowledgeRevision_spaceId_fkey"
      FOREIGN KEY ("spaceId") REFERENCES "Space"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'SpaceKnowledgeRevision_sourceChangeSetId_fkey'
      AND conrelid = '"SpaceKnowledgeRevision"'::regclass
  ) THEN
    ALTER TABLE "SpaceKnowledgeRevision"
      ADD CONSTRAINT "SpaceKnowledgeRevision_sourceChangeSetId_fkey"
      FOREIGN KEY ("sourceChangeSetId") REFERENCES "ChangeSet"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
