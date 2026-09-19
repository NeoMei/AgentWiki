-- Taskboard collaboration: actor attribution, events, and event sequence.
ALTER TABLE "ProjectBoard" ADD COLUMN "eventSequence" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ProjectBoardEvent" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT,
    "operation" TEXT NOT NULL,
    "taskId" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectBoardEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectBoardEvent_boardId_sequence_key" ON "ProjectBoardEvent"("boardId","sequence");
CREATE INDEX "ProjectBoardEvent_boardId_createdAt_idx" ON "ProjectBoardEvent"("boardId","createdAt");

ALTER TABLE "ProjectBoardEvent" ADD CONSTRAINT "ProjectBoardEvent_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "ProjectBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
