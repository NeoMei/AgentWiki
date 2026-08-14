-- Release A: expand. Adds nullable columns and new tables so the app can
-- dual-write both legacy JSON and normalized sync rows. Rollback to the old
-- binary remains safe during this window.

-- AlterTable Page
ALTER TABLE "Page" ADD COLUMN "syncPath" TEXT;
ALTER TABLE "Page" ADD COLUMN "syncPathKey" TEXT;

-- AlterTable PageVersion
ALTER TABLE "PageVersion" ADD COLUMN "syncPath" TEXT;
ALTER TABLE "PageVersion" ADD COLUMN "syncPathKey" TEXT;
ALTER TABLE "PageVersion" ADD COLUMN "migrationBatchId" TEXT;

-- AlterTable ChangeSet
ALTER TABLE "ChangeSet" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'review';
ALTER TABLE "ChangeSet" ADD COLUMN "humanDeviceCredentialId" TEXT;
ALTER TABLE "ChangeSet" ADD COLUMN "confirmationHash" TEXT;
ALTER TABLE "ChangeSet" ADD COLUMN "baseRevisionId" TEXT;

-- AlterTable SpaceKnowledgeRevision
ALTER TABLE "SpaceKnowledgeRevision" ADD COLUMN "revisionContentHash" TEXT;
ALTER TABLE "SpaceKnowledgeRevision" ADD COLUMN "pageCount" BIGINT;
ALTER TABLE "SpaceKnowledgeRevision" ADD COLUMN "revisionBodyBytes" BIGINT;
ALTER TABLE "SpaceKnowledgeRevision" ADD COLUMN "revisionManifestByteLength" BIGINT;
ALTER TABLE "SpaceKnowledgeRevision" ADD COLUMN "supersededAt" TIMESTAMP(3);
ALTER TABLE "SpaceKnowledgeRevision" ADD COLUMN "origin" TEXT;
ALTER TABLE "SpaceKnowledgeRevision" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "SpaceKnowledgeRevision" ADD COLUMN "humanDeviceCredentialId" TEXT;
ALTER TABLE "SpaceKnowledgeRevision" ADD COLUMN "migrationBatchId" TEXT;

-- CreateTable SyncPageContentRow
CREATE TABLE "SyncPageContentRow" (
    "contentHash" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "byteLength" INTEGER NOT NULL,

    CONSTRAINT "SyncPageContentRow_pkey" PRIMARY KEY ("contentHash")
);

-- CreateTable SyncRevisionPageRow
CREATE TABLE "SyncRevisionPageRow" (
    "revisionId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "pathKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRevisionPageRow_pkey" PRIMARY KEY ("revisionId","pageId")
);

-- CreateTable SyncRevisionDeltaRow
CREATE TABLE "SyncRevisionDeltaRow" (
    "revisionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "previousPath" TEXT,
    "contentHash" TEXT,

    CONSTRAINT "SyncRevisionDeltaRow_pkey" PRIMARY KEY ("revisionId","ordinal")
);

-- CreateTable LegacyRevisionSidecar
CREATE TABLE "LegacyRevisionSidecar" (
    "revisionId" TEXT NOT NULL,
    "sidecar" JSONB NOT NULL,

    CONSTRAINT "LegacyRevisionSidecar_pkey" PRIMARY KEY ("revisionId")
);

-- CreateTable LegacyRevisionPageExtra
CREATE TABLE "LegacyRevisionPageExtra" (
    "revisionId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "extra" JSONB NOT NULL,
    "legacyBodyHash" TEXT NOT NULL,

    CONSTRAINT "LegacyRevisionPageExtra_pkey" PRIMARY KEY ("revisionId","pageId")
);

-- CreateTable LegacyPageBodyRow
CREATE TABLE "LegacyPageBodyRow" (
    "contentHash" TEXT NOT NULL,
    "body" JSONB NOT NULL,

    CONSTRAINT "LegacyPageBodyRow_pkey" PRIMARY KEY ("contentHash")
);

-- CreateTable PushSession
CREATE TABLE "PushSession" (
    "id" TEXT NOT NULL,
    "credentialFamilyId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "baseRevisionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "capabilitiesHash" TEXT NOT NULL,
    "confirmationHash" TEXT NOT NULL,
    "confirmationByteLength" INTEGER NOT NULL,
    "changeCount" INTEGER NOT NULL,
    "totalBodyBytes" BIGINT NOT NULL,
    "receivedBatchCount" INTEGER NOT NULL DEFAULT 0,
    "receivedChangeCount" INTEGER NOT NULL DEFAULT 0,
    "receivedBodyBytes" BIGINT NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "publishedChangeSetId" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable PushSessionBatch
CREATE TABLE "PushSessionBatch" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "batchIndex" INTEGER NOT NULL,
    "batchHash" TEXT NOT NULL,
    "receipt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSessionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable PushSessionChange
CREATE TABLE "PushSessionChange" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "path" TEXT,
    "title" TEXT,
    "body" TEXT,
    "contentHash" TEXT,
    "previousPath" TEXT,

    CONSTRAINT "PushSessionChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageVersion_pageId_migrationBatchId_key" ON "PageVersion"("pageId", "migrationBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceKnowledgeRevision_spaceId_migrationBatchId_key" ON "SpaceKnowledgeRevision"("spaceId", "migrationBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncRevisionPageRow_revisionId_pathKey_key" ON "SyncRevisionPageRow"("revisionId", "pathKey");

-- CreateIndex
CREATE INDEX "SyncRevisionPageRow_revisionId_pageId_idx" ON "SyncRevisionPageRow"("revisionId", "pageId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncRevisionDeltaRow_revisionId_pageId_key" ON "SyncRevisionDeltaRow"("revisionId", "pageId");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyRevisionPageExtra_revisionId_ordinal_key" ON "LegacyRevisionPageExtra"("revisionId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "PushSession_credentialFamilyId_idempotencyKey_key" ON "PushSession"("credentialFamilyId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PushSession_spaceId_publishedChangeSetId_key" ON "PushSession"("spaceId", "publishedChangeSetId");

-- CreateIndex
CREATE INDEX "PushSession_spaceId_status_expiresAt_idx" ON "PushSession"("spaceId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "PushSession_credentialId_spaceId_idx" ON "PushSession"("credentialId", "spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSessionBatch_sessionId_batchIndex_key" ON "PushSessionBatch"("sessionId", "batchIndex");

-- CreateIndex
CREATE UNIQUE INDEX "PushSessionBatch_sessionId_batchHash_key" ON "PushSessionBatch"("sessionId", "batchHash");

-- CreateIndex
CREATE UNIQUE INDEX "PushSessionChange_sessionId_pageId_key" ON "PushSessionChange"("sessionId", "pageId");

-- CreateIndex
CREATE INDEX "PushSessionChange_sessionId_ordinal_idx" ON "PushSessionChange"("sessionId", "ordinal");

-- AddForeignKey
ALTER TABLE "ChangeSet" ADD CONSTRAINT "ChangeSet_humanDeviceCredentialId_fkey" FOREIGN KEY ("humanDeviceCredentialId") REFERENCES "HumanDeviceCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceKnowledgeRevision" ADD CONSTRAINT "SpaceKnowledgeRevision_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceKnowledgeRevision" ADD CONSTRAINT "SpaceKnowledgeRevision_humanDeviceCredentialId_fkey" FOREIGN KEY ("humanDeviceCredentialId") REFERENCES "HumanDeviceCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRevisionPageRow" ADD CONSTRAINT "SyncRevisionPageRow_contentHash_fkey" FOREIGN KEY ("contentHash") REFERENCES "SyncPageContentRow"("contentHash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSessionBatch" ADD CONSTRAINT "PushSessionBatch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PushSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSessionChange" ADD CONSTRAINT "PushSessionChange_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PushSessionBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSessionChange" ADD CONSTRAINT "PushSessionChange_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PushSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
