ALTER TABLE "CollaborationTaskTodo"
  ADD COLUMN "createdAt" TIMESTAMP(3);

-- Preserve every existing row and use its pre-migration last-write time as the
-- best available immutable ordering point. Future Todo updates never touch it.
UPDATE "CollaborationTaskTodo"
SET "createdAt" = "updatedAt";

ALTER TABLE "CollaborationTaskTodo"
  ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "createdAt" SET NOT NULL;

CREATE INDEX "CollaborationTaskTodo_runId_createdAt_id_idx"
  ON "CollaborationTaskTodo"("runId", "createdAt", "id");
