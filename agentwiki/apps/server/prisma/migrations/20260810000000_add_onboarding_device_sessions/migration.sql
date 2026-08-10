-- CreateTable
CREATE TABLE "OnboardingDeviceSession" (
    "id" TEXT NOT NULL,
    "deviceCodeHash" TEXT NOT NULL,
    "userCodeHash" TEXT NOT NULL,
    "packageVersion" TEXT NOT NULL,
    "clientType" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "requestedCapabilities" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "pollIntervalSeconds" INTEGER NOT NULL DEFAULT 5,
    "pollCount" INTEGER NOT NULL DEFAULT 0,
    "authorizedUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "deniedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "onboardingTokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "tokenConsumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingDeviceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingBootstrap" (
    "id" TEXT NOT NULL,
    "deviceSessionId" TEXT NOT NULL,
    "idempotencyKeyHash" TEXT NOT NULL,
    "serverPlanHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "resourceIds" JSONB,
    "resultHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingBootstrap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingDeviceSession_deviceCodeHash_key" ON "OnboardingDeviceSession"("deviceCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingDeviceSession_userCodeHash_key" ON "OnboardingDeviceSession"("userCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingDeviceSession_onboardingTokenHash_key" ON "OnboardingDeviceSession"("onboardingTokenHash");

-- CreateIndex
CREATE INDEX "OnboardingDeviceSession_status_expiresAt_idx" ON "OnboardingDeviceSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "OnboardingDeviceSession_authorizedUserId_createdAt_idx" ON "OnboardingDeviceSession"("authorizedUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingBootstrap_deviceSessionId_key" ON "OnboardingBootstrap"("deviceSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingBootstrap_deviceSessionId_idempotencyKeyHash_key" ON "OnboardingBootstrap"("deviceSessionId", "idempotencyKeyHash");

-- AddForeignKey
ALTER TABLE "OnboardingDeviceSession" ADD CONSTRAINT "OnboardingDeviceSession_authorizedUserId_fkey" FOREIGN KEY ("authorizedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingBootstrap" ADD CONSTRAINT "OnboardingBootstrap_deviceSessionId_fkey" FOREIGN KEY ("deviceSessionId") REFERENCES "OnboardingDeviceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
