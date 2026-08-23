BEGIN;

CREATE TYPE "CollaborationRunStatus" AS ENUM ('draft', 'ready', 'running', 'waiting_review', 'paused', 'completed', 'failed', 'cancelled');
CREATE TYPE "CollaborationTaskStatus" AS ENUM ('blocked', 'ready', 'claimed', 'running', 'submitted', 'completed', 'retry_wait', 'failed', 'skipped');
CREATE TYPE "CollaborationTodoStatus" AS ENUM ('pending', 'doing', 'done', 'failed');
CREATE TYPE "CollaborationDependencyMode" AS ENUM ('all', 'any');
CREATE TYPE "CollaborationAttemptStatus" AS ENUM ('claimed', 'running', 'expired', 'completed', 'failed', 'invalidated');
CREATE TYPE "CollaborationArtifactKind" AS ENUM ('markdown', 'json', 'external_reference', 'evidence_summary');
CREATE TYPE "CollaborationArtifactStatus" AS ENUM ('pending', 'accepted', 'rejected', 'superseded');
CREATE TYPE "CollaborationReviewStatus" AS ENUM ('pending', 'approved', 'rejected', 'terminated', 'superseded');

CREATE TABLE "CollaborationTemplate" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "seedVersion" INTEGER,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "definition" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CollaborationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollaborationRun" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "templateSnapshot" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CollaborationRunStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "inputs" JSONB NOT NULL,
    "startedById" TEXT NOT NULL,
    "pauseReason" TEXT,
    "eventSequence" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CollaborationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollaborationRoleBinding" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "roleSlotId" TEXT NOT NULL,
    "roleSlotName" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    CONSTRAINT "CollaborationRoleBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollaborationRunTask" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "roleSlotId" TEXT NOT NULL,
    "assigneeAgentId" TEXT NOT NULL,
    "status" "CollaborationTaskStatus" NOT NULL DEFAULT 'blocked',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "dependencyMode" "CollaborationDependencyMode" NOT NULL DEFAULT 'all',
    "outputContract" JSONB NOT NULL,
    "requiredEvidence" JSONB NOT NULL,
    "humanAcceptance" BOOLEAN NOT NULL DEFAULT false,
    "skippable" BOOLEAN NOT NULL DEFAULT false,
    "leaseSeconds" INTEGER NOT NULL,
    "maxExecutionSeconds" INTEGER NOT NULL,
    "retryBudget" INTEGER NOT NULL DEFAULT 0,
    "repairBudget" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CollaborationRunTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollaborationTaskTodo" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "templateId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "CollaborationTodoStatus" NOT NULL DEFAULT 'pending',
    "summary" TEXT,
    "evidence" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CollaborationTaskTodo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollaborationTaskDependency" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "mode" "CollaborationDependencyMode" NOT NULL,
    CONSTRAINT "CollaborationTaskDependency_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollaborationTaskAttempt" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "agentId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "CollaborationAttemptStatus" NOT NULL,
    "claimIdempotencyKey" TEXT NOT NULL,
    "leaseTokenHash" TEXT NOT NULL,
    "leaseStartedAt" TIMESTAMP(3) NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "maxExecutionAt" TIMESTAMP(3) NOT NULL,
    "failureCode" TEXT,
    "repairCount" INTEGER NOT NULL DEFAULT 0,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CollaborationTaskAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollaborationTaskArtifact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "CollaborationArtifactKind" NOT NULL,
    "status" "CollaborationArtifactStatus" NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollaborationTaskArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollaborationReview" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "generation" INTEGER NOT NULL,
    "sourceTaskId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "revisionTaskId" TEXT NOT NULL,
    "minimumRole" TEXT NOT NULL,
    "reviewerUserIds" JSONB NOT NULL,
    "allowTerminate" BOOLEAN NOT NULL DEFAULT false,
    "status" "CollaborationReviewStatus" NOT NULL DEFAULT 'pending',
    "reviewerUserId" TEXT,
    "reason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollaborationReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollaborationRunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorAgentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollaborationRunEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CollaborationTemplate_spaceId_archivedAt_idx" ON "CollaborationTemplate"("spaceId", "archivedAt");
CREATE UNIQUE INDEX "CollaborationTemplate_scopeKey_slug_key" ON "CollaborationTemplate"("scopeKey", "slug");
CREATE INDEX "CollaborationRun_spaceId_status_updatedAt_idx" ON "CollaborationRun"("spaceId", "status", "updatedAt");
CREATE INDEX "CollaborationRoleBinding_agentId_runId_idx" ON "CollaborationRoleBinding"("agentId", "runId");
CREATE UNIQUE INDEX "CollaborationRoleBinding_runId_roleSlotId_key" ON "CollaborationRoleBinding"("runId", "roleSlotId");
CREATE INDEX "CollaborationRunTask_runId_assigneeAgentId_status_ordinal_idx" ON "CollaborationRunTask"("runId", "assigneeAgentId", "status", "ordinal");
CREATE INDEX "CollaborationRunTask_status_nextAttemptAt_idx" ON "CollaborationRunTask"("status", "nextAttemptAt");
CREATE UNIQUE INDEX "CollaborationRunTask_id_runId_key" ON "CollaborationRunTask"("id", "runId");
CREATE UNIQUE INDEX "CollaborationRunTask_runId_nodeId_key" ON "CollaborationRunTask"("runId", "nodeId");
CREATE UNIQUE INDEX "CollaborationTaskTodo_taskId_generation_templateId_key" ON "CollaborationTaskTodo"("taskId", "generation", "templateId");
CREATE UNIQUE INDEX "CollaborationTaskTodo_taskId_generation_ordinal_key" ON "CollaborationTaskTodo"("taskId", "generation", "ordinal");
CREATE INDEX "CollaborationTaskDependency_runId_toNodeId_idx" ON "CollaborationTaskDependency"("runId", "toNodeId");
CREATE UNIQUE INDEX "CollaborationTaskDependency_runId_fromNodeId_toNodeId_key" ON "CollaborationTaskDependency"("runId", "fromNodeId", "toNodeId");
CREATE INDEX "CollaborationTaskAttempt_runId_agentId_status_idx" ON "CollaborationTaskAttempt"("runId", "agentId", "status");
CREATE INDEX "CollaborationTaskAttempt_lease_scan" ON "CollaborationTaskAttempt"("status", "leaseExpiresAt");
CREATE UNIQUE INDEX "CollaborationTaskAttempt_taskId_generation_attemptNumber_key" ON "CollaborationTaskAttempt"("taskId", "generation", "attemptNumber");
CREATE UNIQUE INDEX "CollaborationTaskAttempt_id_taskId_runId_generation_key" ON "CollaborationTaskAttempt"("id", "taskId", "runId", "generation");
CREATE INDEX "CollaborationTaskArtifact_taskId_generation_status_version_idx" ON "CollaborationTaskArtifact"("taskId", "generation", "status", "version");
CREATE UNIQUE INDEX "CollaborationTaskArtifact_id_runId_key" ON "CollaborationTaskArtifact"("id", "runId");
CREATE UNIQUE INDEX "CollaborationTaskArtifact_id_runId_generation_key" ON "CollaborationTaskArtifact"("id", "runId", "generation");
CREATE UNIQUE INDEX "CollaborationTaskArtifact_taskId_generation_version_key" ON "CollaborationTaskArtifact"("taskId", "generation", "version");
CREATE INDEX "CollaborationReview_runId_status_idx" ON "CollaborationReview"("runId", "status");
CREATE UNIQUE INDEX "CollaborationReview_runId_nodeId_revision_key" ON "CollaborationReview"("runId", "nodeId", "revision");
CREATE INDEX "CollaborationRunEvent_runId_createdAt_idx" ON "CollaborationRunEvent"("runId", "createdAt");
CREATE UNIQUE INDEX "CollaborationRunEvent_runId_sequence_key" ON "CollaborationRunEvent"("runId", "sequence");
CREATE UNIQUE INDEX "CollaborationRunEvent_runId_actorKind_actorId_operation_ide_key" ON "CollaborationRunEvent"("runId", "actorKind", "actorId", "operation", "idempotencyKey");

CREATE UNIQUE INDEX "CollaborationTaskAttempt_one_active"
ON "CollaborationTaskAttempt" ("taskId")
WHERE "status" IN ('claimed', 'running');

CREATE UNIQUE INDEX "CollaborationTaskAttempt_one_active_per_agent_run"
ON "CollaborationTaskAttempt" ("runId", "agentId")
WHERE "status" IN ('claimed', 'running');

ALTER TABLE "CollaborationTemplate" ADD CONSTRAINT "CollaborationTemplate_scope_check"
CHECK (("system" AND "scopeKey" = 'system' AND "spaceId" IS NULL)
    OR (NOT "system" AND "spaceId" IS NOT NULL AND "scopeKey" = "spaceId"));
ALTER TABLE "CollaborationTaskAttempt" ADD CONSTRAINT "CollaborationTaskAttempt_lease_bounds_check"
CHECK ("leaseExpiresAt" <= "maxExecutionAt");
ALTER TABLE "CollaborationRunEvent" ADD CONSTRAINT "CollaborationRunEvent_actor_check"
CHECK (("actorUserId" IS NOT NULL)::int + ("actorAgentId" IS NOT NULL)::int <= 1);

ALTER TABLE "CollaborationTemplate" ADD CONSTRAINT "CollaborationTemplate_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollaborationTemplate" ADD CONSTRAINT "CollaborationTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CollaborationRun" ADD CONSTRAINT "CollaborationRun_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CollaborationTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationRun" ADD CONSTRAINT "CollaborationRun_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollaborationRun" ADD CONSTRAINT "CollaborationRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationRoleBinding" ADD CONSTRAINT "CollaborationRoleBinding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CollaborationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollaborationRoleBinding" ADD CONSTRAINT "CollaborationRoleBinding_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationRunTask" ADD CONSTRAINT "CollaborationRunTask_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CollaborationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollaborationRunTask" ADD CONSTRAINT "CollaborationRunTask_assigneeAgentId_fkey" FOREIGN KEY ("assigneeAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationTaskTodo" ADD CONSTRAINT "CollaborationTaskTodo_taskId_runId_fkey" FOREIGN KEY ("taskId", "runId") REFERENCES "CollaborationRunTask"("id", "runId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollaborationTaskDependency" ADD CONSTRAINT "CollaborationTaskDependency_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CollaborationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollaborationTaskAttempt" ADD CONSTRAINT "CollaborationTaskAttempt_taskId_runId_fkey" FOREIGN KEY ("taskId", "runId") REFERENCES "CollaborationRunTask"("id", "runId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollaborationTaskAttempt" ADD CONSTRAINT "CollaborationTaskAttempt_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationTaskArtifact" ADD CONSTRAINT "CollaborationTaskArtifact_taskId_runId_fkey" FOREIGN KEY ("taskId", "runId") REFERENCES "CollaborationRunTask"("id", "runId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollaborationTaskArtifact" ADD CONSTRAINT "CollaborationTaskArtifact_attemptId_taskId_runId_generatio_fkey" FOREIGN KEY ("attemptId", "taskId", "runId", "generation") REFERENCES "CollaborationTaskAttempt"("id", "taskId", "runId", "generation") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationReview" ADD CONSTRAINT "CollaborationReview_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CollaborationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollaborationReview" ADD CONSTRAINT "CollaborationReview_sourceTaskId_runId_fkey" FOREIGN KEY ("sourceTaskId", "runId") REFERENCES "CollaborationRunTask"("id", "runId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollaborationReview" ADD CONSTRAINT "CollaborationReview_revisionTaskId_runId_fkey" FOREIGN KEY ("revisionTaskId", "runId") REFERENCES "CollaborationRunTask"("id", "runId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationReview" ADD CONSTRAINT "CollaborationReview_artifactId_runId_generation_fkey" FOREIGN KEY ("artifactId", "runId", "generation") REFERENCES "CollaborationTaskArtifact"("id", "runId", "generation") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollaborationReview" ADD CONSTRAINT "CollaborationReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CollaborationRunEvent" ADD CONSTRAINT "CollaborationRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CollaborationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollaborationRunEvent" ADD CONSTRAINT "CollaborationRunEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CollaborationRunEvent" ADD CONSTRAINT "CollaborationRunEvent_actorAgentId_fkey" FOREIGN KEY ("actorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
