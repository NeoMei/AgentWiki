ALTER TABLE "AgentGrant"
ADD COLUMN "folderScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "AgentGrant"
ADD CONSTRAINT "AgentGrant_folderScopes_canonical_check"
CHECK (
  "folderScopes" = ARRAY[]::TEXT[]
  OR "folderScopes" = ARRAY['folders:read']::TEXT[]
  OR "folderScopes" = ARRAY['folders:read', 'folders:write']::TEXT[]
  OR "folderScopes" = ARRAY['folders:read', 'folders:write', 'folders:delete']::TEXT[]
);
