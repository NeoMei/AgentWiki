-- Serve bounded recent-note discovery within one Space or all authorized
-- Spaces without reusing the page-only creation-order index.
CREATE INDEX "PageNote_space_discovery_idx"
  ON "PageNote" ("spaceId", "deletedAt", "updatedAt" DESC, "id" DESC);
CREATE INDEX "PageNote_global_discovery_idx"
  ON "PageNote" ("deletedAt", "updatedAt" DESC, "id" DESC);
