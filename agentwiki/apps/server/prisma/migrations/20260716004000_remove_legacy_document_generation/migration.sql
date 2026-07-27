ALTER TABLE "Page" DROP CONSTRAINT IF EXISTS "Page_documentGenerationJobId_fkey";
ALTER TABLE "Page" DROP COLUMN IF EXISTS "documentGenerationJobId";
DROP TABLE IF EXISTS "CodebaseSnapshot";
DROP TABLE IF EXISTS "DocumentGenerationJob";
