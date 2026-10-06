CREATE TABLE "AssistSession" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'New conversation',
  "spaceId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssistSession_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssistSession_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AssistSession_requestedByUserId_spaceId_updatedAt_idx" ON "AssistSession"("requestedByUserId", "spaceId", "updatedAt" DESC);
ALTER TABLE "AssistTask"
  ADD COLUMN "sessionId" TEXT,
  ADD COLUMN "clientRequestId" TEXT,
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'proposal',
  ADD COLUMN "context" JSONB,
  ADD COLUMN "progressText" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "progressVersion" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "AssistTask_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssistSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssistTask_session_request_check" CHECK (
    "sessionId" IS NULL OR ("clientRequestId" IS NOT NULL AND "context" IS NOT NULL)
  ),
  ADD CONSTRAINT "AssistTask_mode_check" CHECK ("mode" IN ('question', 'proposal'));
CREATE UNIQUE INDEX "AssistTask_sessionId_clientRequestId_key" ON "AssistTask"("sessionId", "clientRequestId");
CREATE INDEX "AssistTask_sessionId_createdAt_idx" ON "AssistTask"("sessionId", "createdAt");
-- Prisma cannot express partial unique indexes. This is the database backstop
-- for one active turn, including callers outside the session row-lock protocol.
CREATE UNIQUE INDEX "AssistTask_session_active_key" ON "AssistTask"("sessionId")
  WHERE "sessionId" IS NOT NULL AND "status" IN ('queued', 'running');
