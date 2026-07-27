CREATE TABLE "SourceFileSnapshot" (
  "id" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "commit" TEXT,
  "sourceVersionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceFileSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SourceFileSnapshot_sourceVersionId_path_key" ON "SourceFileSnapshot"("sourceVersionId", "path");
CREATE INDEX "SourceFileSnapshot_contentHash_idx" ON "SourceFileSnapshot"("contentHash");
ALTER TABLE "SourceFileSnapshot" ADD CONSTRAINT "SourceFileSnapshot_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "SourceVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
