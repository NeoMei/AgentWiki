ALTER TABLE "AgentCredential"
ADD COLUMN "localSyncInstallationId" TEXT;

CREATE UNIQUE INDEX "AgentCredential_localSyncInstallationId_key"
ON "AgentCredential"("localSyncInstallationId");
