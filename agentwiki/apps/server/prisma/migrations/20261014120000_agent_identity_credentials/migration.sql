-- Preserve existing credentials, key hashes and installation identities. Space
-- grants are resolved per request and no longer own credential lifecycle.
ALTER TABLE "AgentCredential" DROP CONSTRAINT "AgentCredential_authorizationId_agentId_fkey";
DROP INDEX "AgentCredential_authorizationId_agentId_idx";
-- Retained only as historical audit provenance. New credentials leave it null.
ALTER TABLE "AgentCredential" ALTER COLUMN "authorizationId" DROP NOT NULL;
