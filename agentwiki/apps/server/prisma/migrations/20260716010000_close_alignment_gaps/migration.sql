-- Make memory deduplication race-safe. Existing exact duplicates are collapsed first.
DROP INDEX IF EXISTS "AgentMemory_agentId_spaceId_contentHash_idx";
DELETE FROM "AgentMemory" duplicate
USING "AgentMemory" keeper
WHERE duplicate."agentId" = keeper."agentId"
  AND duplicate."spaceId" = keeper."spaceId"
  AND duplicate."type" = keeper."type"
  AND duplicate."contentHash" = keeper."contentHash"
  AND (duplicate."createdAt", duplicate."id") > (keeper."createdAt", keeper."id");
CREATE UNIQUE INDEX "AgentMemory_agentId_spaceId_type_contentHash_key"
  ON "AgentMemory"("agentId", "spaceId", "type", "contentHash");

-- Source versions use the same race-safe content deduplication rule.
CREATE TEMP TABLE "_SourceVersionDuplicate" AS
SELECT duplicate."id" AS "duplicateId", keeper."id" AS "keeperId"
FROM "SourceVersion" duplicate
JOIN "SourceVersion" keeper
  ON keeper."sourceId" = duplicate."sourceId"
 AND keeper."contentHash" = duplicate."contentHash"
 AND (keeper."createdAt", keeper."id") < (duplicate."createdAt", duplicate."id")
WHERE NOT EXISTS (
  SELECT 1 FROM "SourceVersion" earlier
  WHERE earlier."sourceId" = duplicate."sourceId"
    AND earlier."contentHash" = duplicate."contentHash"
    AND (earlier."createdAt", earlier."id") < (keeper."createdAt", keeper."id")
);
UPDATE "Evidence" evidence SET "sourceVersionId" = duplicate."keeperId"
FROM "_SourceVersionDuplicate" duplicate WHERE evidence."sourceVersionId" = duplicate."duplicateId";
DELETE FROM "SourceFileSnapshot" snapshot USING "_SourceVersionDuplicate" duplicate
WHERE snapshot."sourceVersionId" = duplicate."duplicateId";
DELETE FROM "SourceVersion" version USING "_SourceVersionDuplicate" duplicate
WHERE version."id" = duplicate."duplicateId";
DROP TABLE "_SourceVersionDuplicate";
CREATE UNIQUE INDEX "SourceVersion_sourceId_contentHash_key" ON "SourceVersion"("sourceId", "contentHash");

-- Preserve both origin provenance and the latest modifying actor/source.
ALTER TABLE "Page"
  ADD COLUMN "lastChangeSetId" TEXT,
  ADD COLUMN "lastModifiedByUserId" TEXT,
  ADD COLUMN "lastModifiedByAgentId" TEXT,
  ADD COLUMN "lastModifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "sourceVersionId" TEXT,
  ADD COLUMN "sourcePath" TEXT;

UPDATE "Page"
SET "lastChangeSetId" = "sourceChangeSetId",
    "lastModifiedByUserId" = CASE WHEN "createdByAgentId" IS NULL THEN "authorId" ELSE NULL END,
    "lastModifiedByAgentId" = "createdByAgentId",
    "lastModifiedAt" = "updatedAt";

UPDATE "Page" page
SET "sourceId" = run."sourceId"
FROM "ChangeSet" change_set
JOIN "IngestRun" run ON run."id" = change_set."runId"
WHERE page."sourceChangeSetId" = change_set."id";

UPDATE "Page" page
SET "sourceVersionId" = evidence."sourceVersionId"
FROM "Evidence" evidence
WHERE evidence."targetPageId" = page."id"
  AND page."sourceVersionId" IS NULL;

CREATE UNIQUE INDEX "Page_spaceId_sourceId_sourcePath_key" ON "Page"("spaceId", "sourceId", "sourcePath");
CREATE INDEX "Page_sourceId_sourceVersionId_idx" ON "Page"("sourceId", "sourceVersionId");

-- Version snapshots now restore hierarchy and representation, not only title/content.
ALTER TABLE "PageVersion"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "format" TEXT,
  ADD COLUMN "parentId" TEXT;
UPDATE "PageVersion" version
SET "slug" = page."slug", "format" = page."format", "parentId" = page."parentId"
FROM "Page" page
WHERE page."id" = version."pageId";

-- Persist a real searchable document index that can be rebuilt deterministically.
CREATE TABLE "PageSearchDocument" (
  "pageId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PageSearchDocument_pkey" PRIMARY KEY ("pageId")
);
INSERT INTO "PageSearchDocument" ("pageId", "text", "contentHash", "indexedAt")
SELECT "id", "title" || E'\n' || "content", md5("title" || E'\n' || "content"), CURRENT_TIMESTAMP
FROM "Page"
WHERE "deletedAt" IS NULL;
CREATE INDEX "PageSearchDocument_contentHash_idx" ON "PageSearchDocument"("contentHash");

-- Graph edges retain the latest human modifier in addition to origin evidence.
ALTER TABLE "KnowledgeRelation"
  ADD COLUMN "lastModifiedByUserId" TEXT,
  ADD COLUMN "lastModifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "KnowledgeRelation" SET "lastModifiedAt" = "createdAt";

-- Queue ownership is a renewable lease and execution revalidates the actual credential.
ALTER TABLE "IngestRun"
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "requestedCredentialId" TEXT,
  ADD COLUMN "requestedCredentialType" TEXT;
CREATE INDEX "IngestRun_status_leaseExpiresAt_idx" ON "IngestRun"("status", "leaseExpiresAt");

-- Repair legacy orphaned provenance before adding the missing constraints.
UPDATE "Page" SET "sourceChangeSetId" = NULL
WHERE "sourceChangeSetId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ChangeSet" WHERE "id" = "sourceChangeSetId");
UPDATE "Page" SET "createdByAgentId" = NULL
WHERE "createdByAgentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Agent" WHERE "id" = "createdByAgentId");
UPDATE "KnowledgeRelation" SET "sourceChangeSetId" = NULL
WHERE "sourceChangeSetId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ChangeSet" WHERE "id" = "sourceChangeSetId");
UPDATE "KnowledgeRelation" SET "createdByAgentId" = NULL
WHERE "createdByAgentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Agent" WHERE "id" = "createdByAgentId");
UPDATE "KnowledgeRelation" SET "evidenceId" = NULL
WHERE "evidenceId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Evidence" WHERE "id" = "evidenceId");
DELETE FROM "KnowledgeRelation" relation
WHERE NOT EXISTS (SELECT 1 FROM "Page" page WHERE page."id" = relation."sourcePageId")
   OR NOT EXISTS (SELECT 1 FROM "Page" page WHERE page."id" = relation."targetPageId");

ALTER TABLE "Page" ADD CONSTRAINT "Page_sourceChangeSetId_fkey" FOREIGN KEY ("sourceChangeSetId") REFERENCES "ChangeSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_lastChangeSetId_fkey" FOREIGN KEY ("lastChangeSetId") REFERENCES "ChangeSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_createdByAgentId_fkey" FOREIGN KEY ("createdByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_lastModifiedByUserId_fkey" FOREIGN KEY ("lastModifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_lastModifiedByAgentId_fkey" FOREIGN KEY ("lastModifiedByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "SourceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PageSearchDocument" ADD CONSTRAINT "PageSearchDocument_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_sourcePageId_fkey" FOREIGN KEY ("sourcePageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_targetPageId_fkey" FOREIGN KEY ("targetPageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_sourceChangeSetId_fkey" FOREIGN KEY ("sourceChangeSetId") REFERENCES "ChangeSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_createdByAgentId_fkey" FOREIGN KEY ("createdByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_lastModifiedByUserId_fkey" FOREIGN KEY ("lastModifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
