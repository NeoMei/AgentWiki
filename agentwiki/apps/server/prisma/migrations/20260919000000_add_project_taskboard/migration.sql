-- Native port of project-taskboard: one hierarchical task board per space.
CREATE TABLE "ProjectBoard" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "project" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "sources" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBoard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectBoardTask" (
    "boardId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'task',
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "scopeClass" TEXT,
    "owner" TEXT,
    "summary" TEXT,
    "description" TEXT,
    "currentStep" TEXT,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "statusHistory" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBoardTask_pkey" PRIMARY KEY ("boardId","id")
);

CREATE UNIQUE INDEX "ProjectBoard_spaceId_key" ON "ProjectBoard"("spaceId");
CREATE INDEX "ProjectBoardTask_boardId_parentId_idx" ON "ProjectBoardTask"("boardId","parentId");
CREATE INDEX "ProjectBoardTask_boardId_status_idx" ON "ProjectBoardTask"("boardId","status");
CREATE INDEX "ProjectBoardTask_boardId_ordinal_idx" ON "ProjectBoardTask"("boardId","ordinal");

ALTER TABLE "ProjectBoard" ADD CONSTRAINT "ProjectBoard_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectBoardTask" ADD CONSTRAINT "ProjectBoardTask_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "ProjectBoard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

