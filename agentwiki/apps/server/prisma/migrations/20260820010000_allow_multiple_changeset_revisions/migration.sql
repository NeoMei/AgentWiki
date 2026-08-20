-- A published KnowledgeSubmission revision and its later compensation
-- revision must both retain the originating ChangeSet for auditability.
DROP INDEX IF EXISTS "SpaceKnowledgeRevision_sourceChangeSetId_key";

CREATE INDEX "SpaceKnowledgeRevision_sourceChangeSetId_idx"
ON "SpaceKnowledgeRevision"("sourceChangeSetId");
