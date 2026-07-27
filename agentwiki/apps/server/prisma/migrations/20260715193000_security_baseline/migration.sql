-- CreateTable
CREATE TABLE "ApiKeyCredential" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Personal access token',
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['*']::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApiKeyCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityAuditEvent" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiKeyCredential_keyHash_key" ON "ApiKeyCredential"("keyHash");
CREATE INDEX "ApiKeyCredential_prefix_idx" ON "ApiKeyCredential"("prefix");
CREATE INDEX "ApiKeyCredential_userId_revokedAt_idx" ON "ApiKeyCredential"("userId", "revokedAt");
CREATE INDEX "SecurityAuditEvent_actorUserId_createdAt_idx" ON "SecurityAuditEvent"("actorUserId", "createdAt");
CREATE INDEX "SecurityAuditEvent_action_createdAt_idx" ON "SecurityAuditEvent"("action", "createdAt");

ALTER TABLE "ApiKeyCredential" ADD CONSTRAINT "ApiKeyCredential_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SecurityAuditEvent" ADD CONSTRAINT "SecurityAuditEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DocumentGenerationJob"
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "lockedAt" TIMESTAMP(3),
ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE TABLE "Agent" (
    "id" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "approvalMode" TEXT NOT NULL DEFAULT 'always-review',
    "memoryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AgentCredential" (
    "id" TEXT NOT NULL, "name" TEXT NOT NULL, "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL, "scopes" TEXT[], "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3), "lastUsedAt" TIMESTAMP(3), "agentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentCredential_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AgentGrant" (
    "id" TEXT NOT NULL, "role" TEXT NOT NULL DEFAULT 'viewer',
    "agentId" TEXT NOT NULL, "spaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentGrant_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AgentAuditEvent" (
    "id" TEXT NOT NULL, "action" TEXT NOT NULL, "outcome" TEXT NOT NULL,
    "resourceType" TEXT, "resourceId" TEXT, "metadata" JSONB, "agentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentAuditEvent_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "SecurityAuditEvent" ADD COLUMN "actorAgentId" TEXT;
CREATE INDEX "Agent_ownerId_status_idx" ON "Agent"("ownerId", "status");
CREATE UNIQUE INDEX "AgentCredential_keyHash_key" ON "AgentCredential"("keyHash");
CREATE INDEX "AgentCredential_prefix_idx" ON "AgentCredential"("prefix");
CREATE INDEX "AgentCredential_agentId_revokedAt_idx" ON "AgentCredential"("agentId", "revokedAt");
CREATE UNIQUE INDEX "AgentGrant_agentId_spaceId_key" ON "AgentGrant"("agentId", "spaceId");
CREATE INDEX "AgentGrant_spaceId_idx" ON "AgentGrant"("spaceId");
CREATE INDEX "AgentAuditEvent_agentId_createdAt_idx" ON "AgentAuditEvent"("agentId", "createdAt");
CREATE INDEX "AgentAuditEvent_resourceType_resourceId_idx" ON "AgentAuditEvent"("resourceType", "resourceId");
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentCredential" ADD CONSTRAINT "AgentCredential_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentGrant" ADD CONSTRAINT "AgentGrant_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentGrant" ADD CONSTRAINT "AgentGrant_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentAuditEvent" ADD CONSTRAINT "AgentAuditEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecurityAuditEvent" ADD CONSTRAINT "SecurityAuditEvent_actorAgentId_fkey" FOREIGN KEY ("actorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
