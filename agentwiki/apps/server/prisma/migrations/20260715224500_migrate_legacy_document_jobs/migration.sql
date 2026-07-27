-- Preserve legacy document-generation history in the unified Source/Run model.
-- Local-path jobs are archived because that input is no longer accepted.
INSERT INTO "Source" (
  "id", "type", "name", "uri", "status", "contentHash", "config",
  "spaceId", "createdAt", "updatedAt", "archivedAt"
)
SELECT
  'legacy-source-' || job."id",
  CASE WHEN job."repoUrl" IS NOT NULL THEN 'git' ELSE 'legacy-local-path' END,
  'Legacy document job ' || job."id",
  job."repoUrl",
  CASE WHEN job."repoUrl" IS NOT NULL THEN 'active' ELSE 'archived' END,
  md5(COALESCE(job."repoUrl", job."repoPath", job."id")),
  jsonb_build_object('legacyJobId', job."id", 'gitHead', job."gitHead"),
  job."spaceId",
  job."createdAt",
  job."updatedAt",
  CASE WHEN job."repoUrl" IS NULL THEN job."updatedAt" ELSE NULL END
FROM "DocumentGenerationJob" job
ON CONFLICT DO NOTHING;

INSERT INTO "IngestRun" (
  "id", "status", "stage", "attempts", "maxAttempts", "error", "result",
  "sourceId", "spaceId", "createdAt", "updatedAt", "completedAt"
)
SELECT
  'legacy-run-' || job."id",
  CASE
    WHEN job."status" = 'completed' THEN 'completed'
    WHEN job."status" = 'failed' THEN 'failed'
    ELSE 'cancelled'
  END,
  CASE
    WHEN job."status" = 'completed' THEN 'completed'
    WHEN job."status" = 'failed' THEN 'failed'
    ELSE 'cancelled'
  END,
  job."attempts",
  job."maxAttempts",
  COALESCE(job."error", CASE WHEN job."status" IN ('pending', 'running') THEN 'Legacy queue retired during migration' ELSE NULL END),
  COALESCE(job."result", '{}'::jsonb) || jsonb_build_object('legacyJobId', job."id"),
  'legacy-source-' || job."id",
  job."spaceId",
  job."createdAt",
  job."updatedAt",
  CASE WHEN job."status" IN ('completed', 'failed') THEN job."updatedAt" ELSE NULL END
FROM "DocumentGenerationJob" job
ON CONFLICT DO NOTHING;
