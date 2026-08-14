-- CreateTable
CREATE TABLE "ServerInstanceIdentity" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "deploymentSeedHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerInstanceIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObsidianInstallation" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "exchangeId" TEXT,
    "requestHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "exchangedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObsidianInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanDeviceCredentialFamily" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanDeviceCredentialFamily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanDeviceCredential" (
    "id" TEXT NOT NULL,
    "credentialFamilyId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'provisional',
    "provisionalExpiresAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HumanDeviceCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServerInstanceIdentity_instanceId_key" ON "ServerInstanceIdentity"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "ObsidianInstallation_codeHash_key" ON "ObsidianInstallation"("codeHash");

-- CreateIndex
CREATE INDEX "ObsidianInstallation_userId_createdAt_idx" ON "ObsidianInstallation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ObsidianInstallation_status_expiresAt_idx" ON "ObsidianInstallation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "HumanDeviceCredentialFamily_userId_deviceId_vaultId_key" ON "HumanDeviceCredentialFamily"("userId", "deviceId", "vaultId");

-- CreateIndex
CREATE UNIQUE INDEX "HumanDeviceCredential_credentialHash_key" ON "HumanDeviceCredential"("credentialHash");

-- CreateIndex
CREATE INDEX "HumanDeviceCredential_credentialFamilyId_status_idx" ON "HumanDeviceCredential"("credentialFamilyId", "status");

-- CreateIndex
CREATE INDEX "HumanDeviceCredential_userId_createdAt_idx" ON "HumanDeviceCredential"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "HumanDeviceCredential_credentialFamilyId_provisionalExpiresAt_idx" ON "HumanDeviceCredential"("credentialFamilyId", "provisionalExpiresAt");

-- Partial unique indexes: at most one provisional and one active credential per family.
CREATE UNIQUE INDEX "HumanDeviceCredential_family_provisional_unique" ON "HumanDeviceCredential"("credentialFamilyId") WHERE "status" = 'provisional';
CREATE UNIQUE INDEX "HumanDeviceCredential_family_active_unique" ON "HumanDeviceCredential"("credentialFamilyId") WHERE "status" = 'active';

-- AddForeignKey
ALTER TABLE "ObsidianInstallation" ADD CONSTRAINT "ObsidianInstallation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanDeviceCredentialFamily" ADD CONSTRAINT "HumanDeviceCredentialFamily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanDeviceCredential" ADD CONSTRAINT "HumanDeviceCredential_credentialFamilyId_fkey" FOREIGN KEY ("credentialFamilyId") REFERENCES "HumanDeviceCredentialFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanDeviceCredential" ADD CONSTRAINT "HumanDeviceCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
