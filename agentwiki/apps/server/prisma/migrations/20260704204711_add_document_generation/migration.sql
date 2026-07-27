-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "documentGenerationJobId" TEXT;

-- CreateTable
CREATE TABLE "DocumentGenerationJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "repoUrl" TEXT,
    "repoPath" TEXT,
    "spaceId" TEXT NOT NULL,
    "config" JSONB,
    "result" JSONB,
    "error" TEXT,
    "gitHead" TEXT,
    "lastUpdate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentGenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodebaseSnapshot" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "content" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodebaseSnapshot_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_documentGenerationJobId_fkey" FOREIGN KEY ("documentGenerationJobId") REFERENCES "DocumentGenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentGenerationJob" ADD CONSTRAINT "DocumentGenerationJob_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodebaseSnapshot" ADD CONSTRAINT "CodebaseSnapshot_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DocumentGenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
