CREATE TABLE "PageNote" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "authorType" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "clientNoteId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "target" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "taskId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "PageNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PageNote_authorType_check" CHECK ("authorType" IN ('user', 'agent')),
  CONSTRAINT "PageNote_status_check" CHECK ("status" IN ('pending', 'dispatched', 'awaiting-review', 'resolved')),
  CONSTRAINT "PageNote_pageId_spaceId_fkey" FOREIGN KEY ("pageId", "spaceId") REFERENCES "Page"("id", "spaceId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PageNote_pageId_authorType_authorId_clientNoteId_key" ON "PageNote"("pageId", "authorType", "authorId", "clientNoteId");
CREATE INDEX "PageNote_spaceId_pageId_deletedAt_createdAt_idx" ON "PageNote"("spaceId", "pageId", "deletedAt", "createdAt");
