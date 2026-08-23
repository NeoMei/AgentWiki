BEGIN;

-- Credential permission state was a second authorization source. Existing
-- connection keys cannot be mapped safely to one Space authorization, and
-- compatibility with pre-single-source credentials is intentionally out of scope.
DELETE FROM "AgentCredential";

ALTER TABLE "AgentCredential"
  DROP COLUMN "role",
  DROP COLUMN "scopes",
  ADD COLUMN "authorizationId" TEXT NOT NULL;

ALTER TABLE "AgentGrant"
  DROP COLUMN "scopes";

CREATE UNIQUE INDEX "AgentGrant_id_agentId_key"
  ON "AgentGrant"("id", "agentId");

CREATE INDEX "AgentCredential_authorizationId_agentId_idx"
  ON "AgentCredential"("authorizationId", "agentId");

ALTER TABLE "AgentCredential"
  ADD CONSTRAINT "AgentCredential_authorizationId_agentId_fkey"
  FOREIGN KEY ("authorizationId", "agentId")
  REFERENCES "AgentGrant"("id", "agentId")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
