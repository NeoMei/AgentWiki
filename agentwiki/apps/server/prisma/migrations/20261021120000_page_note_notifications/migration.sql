CREATE TABLE "PageNoteRecipient" (
  "id" TEXT NOT NULL,
  "noteId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PageNoteRecipient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PageNoteRecipient_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "PageNote"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PageNoteRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PageNoteRecipient_noteId_userId_key" ON "PageNoteRecipient"("noteId", "userId");
CREATE INDEX "PageNoteRecipient_userId_createdAt_idx" ON "PageNoteRecipient"("userId", "createdAt");

CREATE TABLE "UserNotification" (
  "id" TEXT NOT NULL,
  "recipientUserId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "spaceId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "pageNoteId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserNotification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserNotification_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "UserNotification_pageId_spaceId_fkey" FOREIGN KEY ("pageId", "spaceId") REFERENCES "Page"("id", "spaceId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserNotification_pageNoteId_fkey" FOREIGN KEY ("pageNoteId") REFERENCES "PageNote"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserNotification_type_pageNoteId_recipientUserId_key" ON "UserNotification"("type", "pageNoteId", "recipientUserId");
CREATE INDEX "UserNotification_recipientUserId_readAt_createdAt_idx" ON "UserNotification"("recipientUserId", "readAt", "createdAt");
