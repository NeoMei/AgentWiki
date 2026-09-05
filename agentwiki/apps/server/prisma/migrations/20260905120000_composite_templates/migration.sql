BEGIN;

CREATE TYPE "CollaborationRunSourceKind" AS ENUM ('legacy', 'composite', 'page_selection');

ALTER TABLE "CollaborationRun" DROP CONSTRAINT "CollaborationRun_templateId_fkey";

ALTER TABLE "PageTemplateVersion"
  ADD COLUMN "definition" JSONB,
  ADD COLUMN "schemaVersion" INTEGER,
  ADD COLUMN "definitionHash" TEXT;

ALTER TABLE "CollaborationRun"
  ADD COLUMN "sourceKind" "CollaborationRunSourceKind" NOT NULL DEFAULT 'legacy',
  ADD COLUMN "compositeTemplateVersionId" TEXT,
  ADD COLUMN "templateInstantiationId" TEXT,
  ALTER COLUMN "templateId" DROP NOT NULL;

ALTER TABLE "CollaborationRunTask"
  ADD COLUMN "targetPageId" TEXT,
  ADD COLUMN "targetSpaceId" TEXT,
  ADD COLUMN "basePageVersionId" TEXT,
  ADD COLUMN "basePageUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "baseContentHash" TEXT;

ALTER TABLE "CollaborationTaskAttempt"
  ADD COLUMN "basePageVersionId" TEXT,
  ADD COLUMN "basePageUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "baseContentHash" TEXT;

CREATE TABLE "TemplateInstantiation" (
  "id" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "compositeTemplateVersionId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "targetParentFolderId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "treeRevision" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "TemplateInstantiation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateInstantiationNode" (
  "id" TEXT NOT NULL,
  "instantiationId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "templateNodeId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "folderId" TEXT,
  "pageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TemplateInstantiationNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PageAgentBinding" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "roleSlotKey" TEXT,
  "assignedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PageAgentBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PageAgentBindingEvent" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "beforeAgentId" TEXT,
  "afterAgentId" TEXT,
  "beforeRoleSlotKey" TEXT,
  "afterRoleSlotKey" TEXT,
  "actorUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PageAgentBindingEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollaborationArtifactChangeSetLink" (
  "id" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  "changeSetId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollaborationArtifactChangeSetLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TemplateEffectJob" (
  "id" TEXT NOT NULL,
  "instantiationId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "effectKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TemplateEffectJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PageTemplateVersionLegacyWorkflowSource" (
  "id" TEXT NOT NULL,
  "compositeTemplateVersionId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "legacyTemplateId" TEXT NOT NULL,
  "legacyVersion" INTEGER NOT NULL,
  "legacyDefinitionHash" TEXT NOT NULL,
  "upgradeRequestHash" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PageTemplateVersionLegacyWorkflowSource_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PageTemplateVersion" ADD CONSTRAINT "PageTemplateVersion_definition_tuple_check" CHECK (
  ("definition" IS NULL AND "schemaVersion" IS NULL AND "definitionHash" IS NULL)
  OR
  ("definition" IS NOT NULL AND "schemaVersion" IS NOT NULL AND "schemaVersion" = 1 AND "definitionHash" IS NOT NULL AND "definitionHash" ~ '^[a-f0-9]{64}$')
);

ALTER TABLE "CollaborationRun" ADD CONSTRAINT "CollaborationRun_source_check" CHECK (
  ("sourceKind" = 'legacy' AND "templateId" IS NOT NULL AND "compositeTemplateVersionId" IS NULL AND "templateInstantiationId" IS NULL)
  OR
  ("sourceKind" = 'composite' AND "templateId" IS NULL AND "compositeTemplateVersionId" IS NOT NULL)
  OR
  ("sourceKind" = 'page_selection' AND "templateId" IS NULL AND "compositeTemplateVersionId" IS NULL AND "templateInstantiationId" IS NULL AND "templateSnapshot" IS NOT NULL AND jsonb_typeof("templateSnapshot") = 'object')
);
ALTER TABLE "CollaborationRunTask" ADD CONSTRAINT "CollaborationRunTask_target_tuple_check" CHECK (
  ("targetPageId" IS NULL AND "targetSpaceId" IS NULL)
  OR
  ("targetPageId" IS NOT NULL AND "targetSpaceId" IS NOT NULL)
);
ALTER TABLE "CollaborationRunTask" ADD CONSTRAINT "CollaborationRunTask_base_target_check" CHECK (
  "basePageVersionId" IS NULL OR "targetPageId" IS NOT NULL
);

ALTER TABLE "TemplateInstantiationNode" ADD CONSTRAINT "TemplateInstantiationNode_mapping_check" CHECK (
  ("kind" = 'folder' AND "folderId" IS NOT NULL AND "pageId" IS NULL)
  OR
  ("kind" = 'page' AND "folderId" IS NULL AND "pageId" IS NOT NULL)
);

ALTER TABLE "TemplateInstantiation" ADD CONSTRAINT "TemplateInstantiation_requestHash_check" CHECK ("requestHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "PageAgentBindingEvent" ADD CONSTRAINT "PageAgentBindingEvent_changed_check" CHECK (
  "beforeAgentId" IS DISTINCT FROM "afterAgentId"
  OR "beforeRoleSlotKey" IS DISTINCT FROM "afterRoleSlotKey"
);
ALTER TABLE "TemplateEffectJob" ADD CONSTRAINT "TemplateEffectJob_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "PageTemplateVersionLegacyWorkflowSource" ADD CONSTRAINT "PageTemplateVersionLegacyWorkflowSource_hashes_check" CHECK (
  "legacyDefinitionHash" ~ '^[a-f0-9]{64}$' AND "upgradeRequestHash" ~ '^[a-f0-9]{64}$'
);

CREATE FUNCTION "enforce_legacy_workflow_upgrade_source_space"()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM "CollaborationTemplate" legacy
     WHERE legacy."id" = NEW."legacyTemplateId"
       AND legacy."system" = FALSE
       AND legacy."spaceId" = NEW."spaceId"
       AND legacy."scopeKey" = NEW."spaceId"
  ) OR NOT EXISTS (
    SELECT 1
      FROM "PageTemplateVersion" version
      JOIN "PageTemplate" template ON template."id" = version."templateId"
     WHERE version."id" = NEW."compositeTemplateVersionId"
       AND version."definition" IS NOT NULL
       AND template."scope" = 'space'
       AND template."spaceId" = NEW."spaceId"
       AND template."scopeKey" = NEW."spaceId"
  ) THEN
    RAISE EXCEPTION 'Legacy workflow upgrade source, composite version, and Space must share ownership'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PageTemplateVersionLegacyWorkflowSource_space"
BEFORE INSERT ON "PageTemplateVersionLegacyWorkflowSource"
FOR EACH ROW EXECUTE FUNCTION "enforce_legacy_workflow_upgrade_source_space"();

CREATE FUNCTION "reject_legacy_workflow_upgrade_source_update"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."compositeTemplateVersionId" IS DISTINCT FROM OLD."compositeTemplateVersionId"
    OR NEW."spaceId" IS DISTINCT FROM OLD."spaceId"
    OR NEW."legacyTemplateId" IS DISTINCT FROM OLD."legacyTemplateId"
    OR NEW."legacyVersion" IS DISTINCT FROM OLD."legacyVersion"
    OR NEW."legacyDefinitionHash" IS DISTINCT FROM OLD."legacyDefinitionHash"
    OR NEW."upgradeRequestHash" IS DISTINCT FROM OLD."upgradeRequestHash"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Legacy workflow upgrade source is immutable';
  END IF;
  IF NEW."createdById" IS DISTINCT FROM OLD."createdById"
    AND NOT (OLD."createdById" IS NOT NULL AND NEW."createdById" IS NULL)
  THEN
    RAISE EXCEPTION 'Legacy workflow upgrade source createdById may only be cleared';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PageTemplateVersionLegacyWorkflowSource_immutable"
BEFORE UPDATE ON "PageTemplateVersionLegacyWorkflowSource"
FOR EACH ROW EXECUTE FUNCTION "reject_legacy_workflow_upgrade_source_update"();

CREATE FUNCTION "reject_collaboration_template_ownership_update"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."spaceId" IS DISTINCT FROM OLD."spaceId"
    OR NEW."scopeKey" IS DISTINCT FROM OLD."scopeKey"
    OR NEW."system" IS DISTINCT FROM OLD."system"
  THEN
    RAISE EXCEPTION 'CollaborationTemplate scope and Space ownership are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CollaborationTemplate_ownership_immutable"
BEFORE UPDATE OF "spaceId", "scopeKey", "system" ON "CollaborationTemplate"
FOR EACH ROW EXECUTE FUNCTION "reject_collaboration_template_ownership_update"();

CREATE OR REPLACE FUNCTION "reject_page_template_version_update"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."contentI18n" IS DISTINCT FROM OLD."contentI18n"
    OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
    OR NEW."definition" IS DISTINCT FROM OLD."definition"
    OR NEW."schemaVersion" IS DISTINCT FROM OLD."schemaVersion"
    OR NEW."definitionHash" IS DISTINCT FROM OLD."definitionHash"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'PageTemplateVersion identity and content are immutable';
  END IF;

  IF NEW."sourcePageId" IS DISTINCT FROM OLD."sourcePageId"
    AND NOT (OLD."sourcePageId" IS NOT NULL AND NEW."sourcePageId" IS NULL)
  THEN
    RAISE EXCEPTION 'PageTemplateVersion sourcePageId may only be cleared';
  END IF;

  IF NEW."createdById" IS DISTINCT FROM OLD."createdById"
    AND NOT (OLD."createdById" IS NOT NULL AND NEW."createdById" IS NULL)
  THEN
    RAISE EXCEPTION 'PageTemplateVersion createdById may only be cleared';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "enforce_page_agent_binding_grant"()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "AgentGrant"
    WHERE "agentId" = NEW."agentId" AND "spaceId" = NEW."spaceId"
  ) THEN
    RAISE EXCEPTION 'PageAgentBinding Agent must have a grant in the Page Space'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PageAgentBinding_grant_space"
BEFORE INSERT OR UPDATE OF "agentId", "spaceId" ON "PageAgentBinding"
FOR EACH ROW EXECUTE FUNCTION "enforce_page_agent_binding_grant"();

CREATE FUNCTION "enforce_composite_template_version_space"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."compositeTemplateVersionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "PageTemplateVersion" AS version
    JOIN "PageTemplate" AS template ON template."id" = version."templateId"
    WHERE version."id" = NEW."compositeTemplateVersionId"
      AND (
        (template."scope" = 'system' AND template."spaceId" IS NULL)
        OR
        (template."scope" = 'space' AND template."spaceId" = NEW."spaceId")
      )
  ) THEN
    RAISE EXCEPTION 'Composite PageTemplateVersion must be system-scoped or belong to the target Space'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TemplateInstantiation_composite_template_space"
BEFORE INSERT OR UPDATE OF "compositeTemplateVersionId", "spaceId" ON "TemplateInstantiation"
FOR EACH ROW EXECUTE FUNCTION "enforce_composite_template_version_space"();

CREATE TRIGGER "CollaborationRun_composite_template_space"
BEFORE INSERT OR UPDATE OF "compositeTemplateVersionId", "spaceId" ON "CollaborationRun"
FOR EACH ROW EXECUTE FUNCTION "enforce_composite_template_version_space"();

CREATE FUNCTION "reject_page_template_ownership_update"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."scope" IS DISTINCT FROM OLD."scope"
    OR NEW."scopeKey" IS DISTINCT FROM OLD."scopeKey"
    OR NEW."spaceId" IS DISTINCT FROM OLD."spaceId"
  THEN
    RAISE EXCEPTION 'PageTemplate scope and Space ownership are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PageTemplate_ownership_immutable"
BEFORE UPDATE OF "scope", "scopeKey", "spaceId" ON "PageTemplate"
FOR EACH ROW EXECUTE FUNCTION "reject_page_template_ownership_update"();

CREATE FUNCTION "enforce_collaboration_attempt_baseline_page"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."basePageVersionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "CollaborationRunTask" AS task
    JOIN "PageVersion" AS version
      ON version."id" = NEW."basePageVersionId"
      AND version."pageId" = task."targetPageId"
    WHERE task."id" = NEW."taskId" AND task."runId" = NEW."runId"
  ) THEN
    RAISE EXCEPTION 'CollaborationTaskAttempt baseline must belong to its Task target Page'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CollaborationTaskAttempt_baseline_page"
BEFORE INSERT OR UPDATE OF "basePageVersionId", "taskId", "runId" ON "CollaborationTaskAttempt"
FOR EACH ROW EXECUTE FUNCTION "enforce_collaboration_attempt_baseline_page"();

CREATE FUNCTION "reject_collaboration_task_target_update"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."targetPageId" IS DISTINCT FROM OLD."targetPageId"
    OR NEW."targetSpaceId" IS DISTINCT FROM OLD."targetSpaceId"
  THEN
    RAISE EXCEPTION 'CollaborationRunTask target Page and Space are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CollaborationRunTask_target_immutable"
BEFORE UPDATE OF "targetPageId", "targetSpaceId" ON "CollaborationRunTask"
FOR EACH ROW EXECUTE FUNCTION "reject_collaboration_task_target_update"();

CREATE FUNCTION "reject_page_version_ownership_update"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."pageId" IS DISTINCT FROM OLD."pageId" THEN
    RAISE EXCEPTION 'PageVersion Page ownership is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PageVersion_ownership_immutable"
BEFORE UPDATE OF "pageId" ON "PageVersion"
FOR EACH ROW EXECUTE FUNCTION "reject_page_version_ownership_update"();

CREATE UNIQUE INDEX "TemplateInstantiation_id_spaceId_key" ON "TemplateInstantiation"("id", "spaceId");
CREATE UNIQUE INDEX "TemplateInstantiation_id_compositeTemplateVersionId_spaceId_key" ON "TemplateInstantiation"("id", "compositeTemplateVersionId", "spaceId");
CREATE UNIQUE INDEX "TemplateInstantiation_spaceId_createdByUserId_idempotencyKe_key" ON "TemplateInstantiation"("spaceId", "createdByUserId", "idempotencyKey");
CREATE INDEX "TemplateInstantiation_compositeTemplateVersionId_idx" ON "TemplateInstantiation"("compositeTemplateVersionId");
CREATE INDEX "TemplateInstantiation_targetParentFolderId_idx" ON "TemplateInstantiation"("targetParentFolderId");

CREATE UNIQUE INDEX "TemplateInstantiationNode_instantiationId_templateNodeId_key" ON "TemplateInstantiationNode"("instantiationId", "templateNodeId");
CREATE INDEX "TemplateInstantiationNode_spaceId_folderId_idx" ON "TemplateInstantiationNode"("spaceId", "folderId");
CREATE INDEX "TemplateInstantiationNode_spaceId_pageId_idx" ON "TemplateInstantiationNode"("spaceId", "pageId");

CREATE UNIQUE INDEX "PageAgentBinding_pageId_key" ON "PageAgentBinding"("pageId");
CREATE UNIQUE INDEX "PageAgentBinding_pageId_spaceId_key" ON "PageAgentBinding"("pageId", "spaceId");
CREATE INDEX "PageAgentBinding_spaceId_agentId_idx" ON "PageAgentBinding"("spaceId", "agentId");
CREATE INDEX "PageAgentBindingEvent_pageId_createdAt_idx" ON "PageAgentBindingEvent"("pageId", "createdAt");
CREATE INDEX "PageAgentBindingEvent_spaceId_createdAt_idx" ON "PageAgentBindingEvent"("spaceId", "createdAt");

CREATE UNIQUE INDEX "CollaborationArtifactChangeSetLink_artifactId_key" ON "CollaborationArtifactChangeSetLink"("artifactId");
CREATE UNIQUE INDEX "CollaborationArtifactChangeSetLink_changeSetId_key" ON "CollaborationArtifactChangeSetLink"("changeSetId");
CREATE UNIQUE INDEX "CollaborationArtifactChangeSetLink_changeSetId_spaceId_key" ON "CollaborationArtifactChangeSetLink"("changeSetId", "spaceId");
CREATE UNIQUE INDEX "CollaborationArtifactChangeSetLink_artifactId_taskId_runId_key" ON "CollaborationArtifactChangeSetLink"("artifactId", "taskId", "runId");
CREATE INDEX "CollaborationArtifactChangeSetLink_runId_pageId_idx" ON "CollaborationArtifactChangeSetLink"("runId", "pageId");
CREATE INDEX "CollaborationArtifactChangeSetLink_taskId_runId_idx" ON "CollaborationArtifactChangeSetLink"("taskId", "runId");

CREATE UNIQUE INDEX "TemplateEffectJob_instantiationId_effectKey_key" ON "TemplateEffectJob"("instantiationId", "effectKey");
CREATE INDEX "TemplateEffectJob_status_availableAt_idx" ON "TemplateEffectJob"("status", "availableAt");
CREATE INDEX "TemplateEffectJob_spaceId_status_idx" ON "TemplateEffectJob"("spaceId", "status");

CREATE UNIQUE INDEX "PageTemplateVersionLegacyWorkflowSource_compositeTemplateVersionId_key" ON "PageTemplateVersionLegacyWorkflowSource"("compositeTemplateVersionId");
CREATE UNIQUE INDEX "PageTemplateVersionLegacyWorkflowSource_source_snapshot_key" ON "PageTemplateVersionLegacyWorkflowSource"("spaceId", "legacyTemplateId", "legacyVersion", "legacyDefinitionHash");
CREATE INDEX "PageTemplateVersionLegacyWorkflowSource_legacyTemplateId_legacyVersion_idx" ON "PageTemplateVersionLegacyWorkflowSource"("legacyTemplateId", "legacyVersion");

CREATE UNIQUE INDEX "CollaborationRun_id_spaceId_key" ON "CollaborationRun"("id", "spaceId");
CREATE UNIQUE INDEX "CollaborationRun_templateInstantiationId_key" ON "CollaborationRun"("templateInstantiationId");
CREATE UNIQUE INDEX "CollaborationRun_templateInstantiationId_compositeTemplateV_key" ON "CollaborationRun"("templateInstantiationId", "compositeTemplateVersionId", "spaceId");
CREATE INDEX "CollaborationRun_compositeTemplateVersionId_idx" ON "CollaborationRun"("compositeTemplateVersionId");
CREATE UNIQUE INDEX "PageVersion_id_pageId_key" ON "PageVersion"("id", "pageId");
CREATE INDEX "CollaborationRunTask_targetPageId_idx" ON "CollaborationRunTask"("targetPageId");
CREATE UNIQUE INDEX "CollaborationRunTask_id_runId_targetPageId_targetSpaceId_key" ON "CollaborationRunTask"("id", "runId", "targetPageId", "targetSpaceId");
CREATE INDEX "CollaborationRunTask_basePageVersionId_idx" ON "CollaborationRunTask"("basePageVersionId");
CREATE UNIQUE INDEX "CollaborationTaskArtifact_id_taskId_runId_key" ON "CollaborationTaskArtifact"("id", "taskId", "runId");
CREATE INDEX "CollaborationTaskAttempt_basePageVersionId_idx" ON "CollaborationTaskAttempt"("basePageVersionId");

ALTER TABLE "CollaborationRun" ADD CONSTRAINT "CollaborationRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CollaborationTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationRun" ADD CONSTRAINT "CollaborationRun_compositeTemplateVersionId_fkey" FOREIGN KEY ("compositeTemplateVersionId") REFERENCES "PageTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationRun" ADD CONSTRAINT "CollaborationRun_templateInstantiationId_compositeTemplate_fkey" FOREIGN KEY ("templateInstantiationId", "compositeTemplateVersionId", "spaceId") REFERENCES "TemplateInstantiation"("id", "compositeTemplateVersionId", "spaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationRunTask" ADD CONSTRAINT "CollaborationRunTask_runId_targetSpaceId_fkey" FOREIGN KEY ("runId", "targetSpaceId") REFERENCES "CollaborationRun"("id", "spaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollaborationRunTask" ADD CONSTRAINT "CollaborationRunTask_targetPageId_targetSpaceId_fkey" FOREIGN KEY ("targetPageId", "targetSpaceId") REFERENCES "Page"("id", "spaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationRunTask" ADD CONSTRAINT "CollaborationRunTask_basePageVersionId_targetPageId_fkey" FOREIGN KEY ("basePageVersionId", "targetPageId") REFERENCES "PageVersion"("id", "pageId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationTaskAttempt" ADD CONSTRAINT "CollaborationTaskAttempt_basePageVersionId_fkey" FOREIGN KEY ("basePageVersionId") REFERENCES "PageVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TemplateInstantiation" ADD CONSTRAINT "TemplateInstantiation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateInstantiation" ADD CONSTRAINT "TemplateInstantiation_compositeTemplateVersionId_fkey" FOREIGN KEY ("compositeTemplateVersionId") REFERENCES "PageTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TemplateInstantiation" ADD CONSTRAINT "TemplateInstantiation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TemplateInstantiation" ADD CONSTRAINT "TemplateInstantiation_targetParentFolderId_spaceId_fkey" FOREIGN KEY ("targetParentFolderId", "spaceId") REFERENCES "Folder"("id", "spaceId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TemplateInstantiationNode" ADD CONSTRAINT "TemplateInstantiationNode_instantiationId_spaceId_fkey" FOREIGN KEY ("instantiationId", "spaceId") REFERENCES "TemplateInstantiation"("id", "spaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateInstantiationNode" ADD CONSTRAINT "TemplateInstantiationNode_folderId_spaceId_fkey" FOREIGN KEY ("folderId", "spaceId") REFERENCES "Folder"("id", "spaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TemplateInstantiationNode" ADD CONSTRAINT "TemplateInstantiationNode_pageId_spaceId_fkey" FOREIGN KEY ("pageId", "spaceId") REFERENCES "Page"("id", "spaceId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PageAgentBinding" ADD CONSTRAINT "PageAgentBinding_pageId_spaceId_fkey" FOREIGN KEY ("pageId", "spaceId") REFERENCES "Page"("id", "spaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageAgentBinding" ADD CONSTRAINT "PageAgentBinding_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageAgentBinding" ADD CONSTRAINT "PageAgentBinding_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PageAgentBinding" ADD CONSTRAINT "PageAgentBinding_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PageAgentBindingEvent" ADD CONSTRAINT "PageAgentBindingEvent_pageId_spaceId_fkey" FOREIGN KEY ("pageId", "spaceId") REFERENCES "Page"("id", "spaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PageAgentBindingEvent" ADD CONSTRAINT "PageAgentBindingEvent_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageAgentBindingEvent" ADD CONSTRAINT "PageAgentBindingEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CollaborationArtifactChangeSetLink" ADD CONSTRAINT "CollaborationArtifactChangeSetLink_artifactId_taskId_runId_fkey" FOREIGN KEY ("artifactId", "taskId", "runId") REFERENCES "CollaborationTaskArtifact"("id", "taskId", "runId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationArtifactChangeSetLink" ADD CONSTRAINT "CollaborationArtifactChangeSetLink_changeSetId_spaceId_fkey" FOREIGN KEY ("changeSetId", "spaceId") REFERENCES "ChangeSet"("id", "spaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationArtifactChangeSetLink" ADD CONSTRAINT "CollaborationArtifactChangeSetLink_runId_spaceId_fkey" FOREIGN KEY ("runId", "spaceId") REFERENCES "CollaborationRun"("id", "spaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollaborationArtifactChangeSetLink" ADD CONSTRAINT "CollaborationArtifactChangeSetLink_taskId_runId_pageId_spa_fkey" FOREIGN KEY ("taskId", "runId", "pageId", "spaceId") REFERENCES "CollaborationRunTask"("id", "runId", "targetPageId", "targetSpaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationArtifactChangeSetLink" ADD CONSTRAINT "CollaborationArtifactChangeSetLink_pageId_spaceId_fkey" FOREIGN KEY ("pageId", "spaceId") REFERENCES "Page"("id", "spaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationArtifactChangeSetLink" ADD CONSTRAINT "CollaborationArtifactChangeSetLink_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TemplateEffectJob" ADD CONSTRAINT "TemplateEffectJob_instantiationId_spaceId_fkey" FOREIGN KEY ("instantiationId", "spaceId") REFERENCES "TemplateInstantiation"("id", "spaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateEffectJob" ADD CONSTRAINT "TemplateEffectJob_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PageTemplateVersionLegacyWorkflowSource" ADD CONSTRAINT "PageTemplateVersionLegacyWorkflowSource_compositeVersion_fkey" FOREIGN KEY ("compositeTemplateVersionId") REFERENCES "PageTemplateVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageTemplateVersionLegacyWorkflowSource" ADD CONSTRAINT "PageTemplateVersionLegacyWorkflowSource_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageTemplateVersionLegacyWorkflowSource" ADD CONSTRAINT "PageTemplateVersionLegacyWorkflowSource_legacyTemplateId_fkey" FOREIGN KEY ("legacyTemplateId") REFERENCES "CollaborationTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PageTemplateVersionLegacyWorkflowSource" ADD CONSTRAINT "PageTemplateVersionLegacyWorkflowSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
