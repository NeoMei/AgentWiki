CREATE TABLE "PageNoteReply" (
  "id" TEXT NOT NULL,
  "noteId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "clientReplyId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PageNoteReply_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PageNoteReply_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "PageNote"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PageNoteReply_noteId_authorId_clientReplyId_key" ON "PageNoteReply"("noteId", "authorId", "clientReplyId");
CREATE INDEX "PageNoteReply_noteId_createdAt_id_idx" ON "PageNoteReply"("noteId", "createdAt", "id");
