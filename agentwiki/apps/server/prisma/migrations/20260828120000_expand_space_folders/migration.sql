BEGIN;

ALTER TABLE "Space" ADD COLUMN "contentTreeRevision" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Page" ADD COLUMN "folderId" TEXT;
ALTER TABLE "Page" ADD COLUMN "deletionBatchId" TEXT;
ALTER TABLE "PageVersion" ADD COLUMN "folderId" TEXT;
ALTER TABLE "SyncRevisionPageRow" ADD COLUMN "folderId" TEXT;

CREATE TABLE "Folder" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "pathKey" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT,
  "createdByAgentId" TEXT,
  "sourceChangeSetId" TEXT,
  "lastModifiedByUserId" TEXT,
  "lastModifiedByAgentId" TEXT,
  "lastModifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletionBatchId" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PagePathAlias" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "pathKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "PagePathAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentDeletionBatch" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "rootFolderId" TEXT NOT NULL,
  "deletedByUserId" TEXT,
  "deletedByAgentId" TEXT,
  "deletedTreeRevision" BIGINT NOT NULL,
  "folderCount" INTEGER NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "impactHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "restoredAt" TIMESTAMP(3),
  CONSTRAINT "ContentDeletionBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SyncRevisionFolderRow" (
  "revisionId" TEXT NOT NULL,
  "folderId" TEXT NOT NULL,
  "parentFolderId" TEXT,
  "name" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "pathKey" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SyncRevisionFolderRow_pkey" PRIMARY KEY ("revisionId", "folderId")
);

CREATE TABLE "SyncRevisionTreeDeltaRow" (
  "revisionId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "operation" TEXT NOT NULL,
  "folderId" TEXT,
  "pageId" TEXT,
  "previousPath" TEXT,
  "contentHash" TEXT,
  CONSTRAINT "SyncRevisionTreeDeltaRow_pkey" PRIMARY KEY ("revisionId", "ordinal")
);

CREATE UNIQUE INDEX "Folder_active_sibling_name_key"
  ON "Folder"("spaceId", COALESCE("parentId", ''), "nameKey")
  WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Folder_active_path_key"
  ON "Folder"("spaceId", "pathKey")
  WHERE "deletedAt" IS NULL;
CREATE INDEX "Folder_spaceId_parentId_deletedAt_sortOrder_id_idx"
  ON "Folder"("spaceId", "parentId", "deletedAt", "sortOrder", "id");
CREATE INDEX "Folder_deletionBatchId_idx" ON "Folder"("deletionBatchId");
CREATE INDEX "Folder_sourceChangeSetId_idx" ON "Folder"("sourceChangeSetId");
CREATE UNIQUE INDEX "Folder_id_spaceId_key" ON "Folder"("id", "spaceId");

CREATE UNIQUE INDEX "Page_id_spaceId_key" ON "Page"("id", "spaceId");
CREATE UNIQUE INDEX "ChangeSet_id_spaceId_key" ON "ChangeSet"("id", "spaceId");

CREATE UNIQUE INDEX "PagePathAlias_spaceId_pathKey_pageId_key"
  ON "PagePathAlias"("spaceId", "pathKey", "pageId");
CREATE INDEX "PagePathAlias_spaceId_pathKey_expiresAt_idx"
  ON "PagePathAlias"("spaceId", "pathKey", "expiresAt");
CREATE INDEX "PagePathAlias_pageId_createdAt_idx"
  ON "PagePathAlias"("pageId", "createdAt" DESC);

CREATE INDEX "ContentDeletionBatch_spaceId_restoredAt_createdAt_idx"
  ON "ContentDeletionBatch"("spaceId", "restoredAt", "createdAt" DESC);
CREATE INDEX "ContentDeletionBatch_rootFolderId_createdAt_idx"
  ON "ContentDeletionBatch"("rootFolderId", "createdAt" DESC);
CREATE UNIQUE INDEX "ContentDeletionBatch_id_spaceId_key"
  ON "ContentDeletionBatch"("id", "spaceId");

CREATE INDEX "Page_spaceId_folderId_deletedAt_sortOrder_id_idx"
  ON "Page"("spaceId", "folderId", "deletedAt", "sortOrder", "id");

CREATE UNIQUE INDEX "SyncRevisionFolderRow_revisionId_pathKey_key"
  ON "SyncRevisionFolderRow"("revisionId", "pathKey");
CREATE INDEX "SyncRevisionFolderRow_revisionId_sortOrder_folderId_idx"
  ON "SyncRevisionFolderRow"("revisionId", "sortOrder", "folderId");
CREATE UNIQUE INDEX "SyncRevisionTreeDeltaRow_revisionId_folderId_key"
  ON "SyncRevisionTreeDeltaRow"("revisionId", "folderId");
CREATE UNIQUE INDEX "SyncRevisionTreeDeltaRow_revisionId_pageId_key"
  ON "SyncRevisionTreeDeltaRow"("revisionId", "pageId");

ALTER TABLE "Folder" ADD CONSTRAINT "Folder_not_self_parent"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_non_empty_fields"
  CHECK (
    char_length("name") BETWEEN 1 AND 200
    AND char_length("nameKey") > 0
    AND char_length("path") > 0
    AND char_length("pathKey") > 0
    AND "path" LIKE 'pages/%'
    AND "pathKey" LIKE 'pages/%'
  );
ALTER TABLE "PagePathAlias" ADD CONSTRAINT "PagePathAlias_non_empty_path"
  CHECK (char_length("path") > 0 AND char_length("pathKey") > 0 AND "path" LIKE 'pages/%');
ALTER TABLE "ContentDeletionBatch" ADD CONSTRAINT "ContentDeletionBatch_actor_check"
  CHECK (num_nonnulls("deletedByUserId", "deletedByAgentId") = 1);
ALTER TABLE "ContentDeletionBatch" ADD CONSTRAINT "ContentDeletionBatch_counts_hash_check"
  CHECK (
    "deletedTreeRevision" >= 0
    AND "folderCount" > 0
    AND "pageCount" >= 0
    AND "impactHash" ~ '^[0-9a-f]{64}$'
  );
ALTER TABLE "SyncRevisionFolderRow" ADD CONSTRAINT "SyncRevisionFolderRow_non_empty_fields"
  CHECK (
    char_length("name") > 0
    AND char_length("path") > 0
    AND char_length("pathKey") > 0
    AND "path" LIKE 'pages/%'
  );
ALTER TABLE "SyncRevisionTreeDeltaRow" ADD CONSTRAINT "SyncRevisionTreeDeltaRow_operation_check"
  CHECK ("operation" IN ('upsert_folder', 'archive_folder', 'upsert_page', 'archive_page'));
ALTER TABLE "SyncRevisionTreeDeltaRow" ADD CONSTRAINT "SyncRevisionTreeDeltaRow_target_check"
  CHECK (
    ("operation" IN ('upsert_folder', 'archive_folder') AND "folderId" IS NOT NULL AND "pageId" IS NULL)
    OR
    ("operation" IN ('upsert_page', 'archive_page') AND "folderId" IS NULL AND "pageId" IS NOT NULL)
  );
ALTER TABLE "SyncRevisionTreeDeltaRow" ADD CONSTRAINT "SyncRevisionTreeDeltaRow_previous_path_check"
  CHECK (
    ("operation" IN ('archive_folder', 'archive_page') AND "previousPath" IS NOT NULL AND char_length("previousPath") > 0)
    OR
    ("operation" IN ('upsert_folder', 'upsert_page') AND "previousPath" IS NULL)
  );
ALTER TABLE "SyncRevisionTreeDeltaRow" ADD CONSTRAINT "SyncRevisionTreeDeltaRow_content_hash_check"
  CHECK (
    ("operation" = 'upsert_page' AND "contentHash" IS NOT NULL AND "contentHash" ~ '^[0-9a-f]{64}$')
    OR
    ("operation" <> 'upsert_page' AND "contentHash" IS NULL)
  );

ALTER TABLE "Folder" ADD CONSTRAINT "Folder_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey"
  FOREIGN KEY ("parentId", "spaceId") REFERENCES "Folder"("id", "spaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_createdByAgentId_fkey"
  FOREIGN KEY ("createdByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- NO ACTION is intentional: Folder/source/deletion structure is soft-deleted and retained.
-- Direct physical target deletion must fail while evidence remains; whole-Space CASCADE removes the graph together.
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_sourceChangeSetId_fkey"
  FOREIGN KEY ("sourceChangeSetId", "spaceId") REFERENCES "ChangeSet"("id", "spaceId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_lastModifiedByUserId_fkey"
  FOREIGN KEY ("lastModifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_lastModifiedByAgentId_fkey"
  FOREIGN KEY ("lastModifiedByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PagePathAlias" ADD CONSTRAINT "PagePathAlias_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PagePathAlias" ADD CONSTRAINT "PagePathAlias_pageId_fkey"
  FOREIGN KEY ("pageId", "spaceId") REFERENCES "Page"("id", "spaceId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentDeletionBatch" ADD CONSTRAINT "ContentDeletionBatch_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentDeletionBatch" ADD CONSTRAINT "ContentDeletionBatch_rootFolderId_fkey"
  FOREIGN KEY ("rootFolderId", "spaceId") REFERENCES "Folder"("id", "spaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- These NO ACTION edges prevent silent root placement or loss of deletion-batch evidence.
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_deletionBatchId_fkey"
  FOREIGN KEY ("deletionBatchId", "spaceId") REFERENCES "ContentDeletionBatch"("id", "spaceId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_folderId_fkey"
  FOREIGN KEY ("folderId", "spaceId") REFERENCES "Folder"("id", "spaceId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_deletionBatchId_fkey"
  FOREIGN KEY ("deletionBatchId", "spaceId") REFERENCES "ContentDeletionBatch"("id", "spaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT;
