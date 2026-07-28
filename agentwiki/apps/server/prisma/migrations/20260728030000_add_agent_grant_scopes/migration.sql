-- AlterTable
ALTER TABLE "AgentGrant" ADD COLUMN "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
