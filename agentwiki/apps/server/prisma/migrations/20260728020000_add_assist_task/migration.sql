-- CreateTable
CREATE TABLE "AssistTask" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "intent" TEXT NOT NULL,
    "pageSnapshot" JSONB,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "spaceId" TEXT NOT NULL,
    "pageId" TEXT,
    "requestedByUserId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AssistTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistTask_spaceId_status_createdAt_idx" ON "AssistTask"("spaceId", "status", "createdAt");
CREATE INDEX "AssistTask_status_leaseExpiresAt_idx" ON "AssistTask"("status", "leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "AssistTask" ADD CONSTRAINT "AssistTask_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistTask" ADD CONSTRAINT "AssistTask_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssistTask" ADD CONSTRAINT "AssistTask_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
