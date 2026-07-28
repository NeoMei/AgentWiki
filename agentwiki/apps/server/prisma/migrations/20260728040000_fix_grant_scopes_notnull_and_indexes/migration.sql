-- Backfill any NULL scopes to empty array before adding NOT NULL constraint
UPDATE "AgentGrant" SET "scopes" = ARRAY[]::TEXT[] WHERE "scopes" IS NULL;

-- Enforce NOT NULL to match Prisma schema
ALTER TABLE "AgentGrant" ALTER COLUMN "scopes" SET NOT NULL;

-- AssistTask: global claim query (status + nextAttemptAt + createdAt)
CREATE INDEX IF NOT EXISTS "AssistTask_status_nextAttempt_created_idx"
  ON "AssistTask" ("status", "nextAttemptAt", "createdAt");

-- AssistTask: per-page list (pageId + createdAt)
CREATE INDEX IF NOT EXISTS "AssistTask_pageId_createdAt_idx"
  ON "AssistTask" ("pageId", "createdAt" DESC);

-- SpaceMember: owner check and member list (spaceId + role + createdAt)
CREATE INDEX IF NOT EXISTS "SpaceMember_spaceId_role_createdAt_idx"
  ON "SpaceMember" ("spaceId", "role", "createdAt");

-- Page: tree/list queries (spaceId + deletedAt + sortOrder)
CREATE INDEX IF NOT EXISTS "Page_spaceId_deletedAt_sortOrder_idx"
  ON "Page" ("spaceId", "deletedAt", "sortOrder");
