# AgentWiki deployment and operations

This runbook describes the current React/Vite + NestJS + PostgreSQL deployment.

## Required configuration

- `DATABASE_URL`: PostgreSQL connection string held in the secret manager.
- `JWT_SECRET`: high-entropy signing secret; rotate through a planned session invalidation.
- `CORS_ORIGINS`: comma-separated exact browser origins.
- `MCP_ALLOWED_HOSTS`: comma-separated HTTP Host allowlist for `/api/mcp`.
- `ALLOWED_GIT_HOSTS`: exact HTTPS Git hosts accepted by the ingestion worker.
- `REDIS_URL`: shared rate-limit counter. The server uses a bounded in-memory fallback if Redis is unavailable.
- `AGENT_MEMORY_QUOTA`: active-memory maximum per Agent.

Do not commit `.env`, Agent credentials, personal access tokens, database dumps, or generated deployment archives.

## Deploy

The current host uses direct Node.js processes, not Docker. Run `deploy.sh` to upload source without `.env`, install the locked dependencies, build shared/server/client, apply Prisma migrations, and restart the three user-level systemd services.

Before deployment, verify that both the local shell and the remote `/usr/bin/node` report Node.js 26. `deploy.sh` enforces this preflight and stops before upload, dependency installation, migrations, or service restarts when either runtime is not Node 26.

1. `agentwiki-api.service` runs the Nest API with `PROCESS_ROLE=api` on port 3000.
2. `agentwiki-worker.service` runs the isolated ingestion worker with no HTTP listener.
3. `agentwiki-frontend.service` serves the production Vite build on port 5173.
4. `GET /api/health` must report database and Redis as healthy before the deployment succeeds.
5. Preserve `Authorization`, `x-api-key`, `Host`, and `x-request-id` if a reverse proxy is added later.
6. After deployment, health-check login, space list, a read-only MCP call, and one queued ingestion in a non-production Space.

Workers use database leases. On restart, interrupted ingestion leases are returned to the queue. API replicas never execute ingestion work; scale workers separately for the configured workload.

## Backup and restore

- Take encrypted PostgreSQL logical backups at least daily and before every migration.
- Retain daily backups for 14 days and monthly backups according to the organization's policy.
- Test restoration quarterly in an isolated network: restore the dump, run `prisma migrate status`, start the server, and verify Source → Run → Evidence → ChangeSet → Page provenance.
- A restore is complete only after credentials created after the backup are revoked and integrations are revalidated.

### Forward-migration preflight

Stop application writes and take a fresh target backup before applying migrations. Before the migration that removes the deprecated `User.apiKey` column, output only the number of non-null values; never select or log the PAT values themselves:

```sql
SELECT COUNT(*) FROM "User" WHERE "apiKey" IS NOT NULL;
```

If the count is non-zero, record the count, revoke those legacy PATs, and require every affected user to create and verify a new `ApiKeyCredential`. Do not copy plaintext legacy values into the credential table. The migration emits the same count and forced-rotation warning before clearing and dropping the column.

The follow-up Memory migration uses a locale-independent canonical form: collapse and trim only ASCII whitespace, lowercase only ASCII `A-Z`, and preserve every non-ASCII code point. Run this query first:

```sql
WITH normalized AS (
  SELECT
    "id",
    "agentId",
    "spaceId",
    "type",
    md5(translate(
      btrim(regexp_replace("content", E'[ \x09-\x0D]+', ' ', 'g'), ' '),
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'abcdefghijklmnopqrstuvwxyz'
    )) AS canonical_hash
  FROM "AgentMemory"
)
SELECT
  "agentId",
  "spaceId",
  "type",
  canonical_hash,
  COUNT(*) AS memory_count,
  array_agg("id" ORDER BY "id") AS memory_ids
FROM normalized
GROUP BY "agentId", "spaceId", "type", canonical_hash
HAVING COUNT(*) > 1;
```

Zero rows is the migration precondition. If any group is returned, the migration intentionally aborts before changing hashes. Review those memories and decide manually which records remain distinct; do not delete or merge memories automatically.

### Recover legacy document-generation history

Use this procedure only with a trusted backup that still contains `DocumentGenerationJob`, `CodebaseSnapshot`, and `Page.documentGenerationJobId`. The restored source and current target must be different PostgreSQL databases.

1. Restore the pre-migration backup to an isolated database with restricted network access. Never restore it over the current target.

```bash
createdb "$LEGACY_RESTORE_DB"
pg_restore --exit-on-error --no-owner --dbname="$LEGACY_RESTORE_DB" "$PRE_MIGRATION_DUMP"
```

2. Supply `LEGACY_DATABASE_URL` for the isolated, read-only restore and `DATABASE_URL` for the current target through the secret manager. Do not put either URL in shell history, command arguments, logs, or this repository. The tool compares both URL identities and the connected `current_database()`, `inet_server_addr()`, and `inet_server_port()` values before reading legacy tables, so aliases such as `localhost` and `127.0.0.1` cannot bypass same-database rejection. Legacy table reads execute only after `SET TRANSACTION READ ONLY`.

3. From the `agentwiki/` directory, run the recovery tool without flags. This is always a dry-run and performs no writes:

```bash
node scripts/recover-legacy-document-data.mjs > recovery-dry-run.json
```

Inspect `jobsBlocked`, `conflicts`, and `failures`. Resolve missing Spaces, duplicate paths, and existing Page provenance conflicts before continuing. The tool never overwrites different `sourceId`, `sourceVersionId`, or `sourcePath` values.

4. Apply the reviewed plan explicitly. Each legacy job is committed in its own target transaction:

```bash
node scripts/recover-legacy-document-data.mjs --apply > recovery-apply.json
```

5. Run the dry-run again. `failures` and `conflicts` must be empty and `plannedOperations` must be `0`, demonstrating an idempotent rerun.

6. Compare source and target counts. On the isolated source, record counts for jobs, snapshots, and linked Pages:

```sql
SELECT COUNT(*) FROM "DocumentGenerationJob";
SELECT COUNT(*) FROM "CodebaseSnapshot";
SELECT COUNT(*) FROM "Page" WHERE "documentGenerationJobId" IS NOT NULL;
```

On the target, count the recovered SourceVersion, SourceFileSnapshot, Evidence, and fully linked Page provenance rows. Version and file counts must match source job and snapshot counts, and the Evidence count must match the source linked-Page count. The fully linked count can be lower: an unmapped legacy Page deliberately keeps `Page.sourcePath` NULL, while its fallback `linkStrategy` and optional `requestedPath` remain only in `Evidence.location`. Review those low-confidence fallbacks separately; never turn their labels into fake Page paths.

```sql
SELECT COUNT(*)
FROM "SourceVersion"
WHERE "metadata"->>'contentFormat' = 'agentwiki/legacy-codebase-snapshot-bundle@1';

SELECT COUNT(*)
FROM "SourceFileSnapshot" snapshot
LEFT JOIN "SourceVersion" version ON version."id" = snapshot."sourceVersionId"
WHERE version."metadata"->>'contentFormat' = 'agentwiki/legacy-codebase-snapshot-bundle@1';

SELECT COUNT(*)
FROM "Evidence"
WHERE "location"->>'legacyJobId' IS NOT NULL;

-- BEGIN LEGACY_FULLY_LINKED_COUNT
SELECT COUNT(DISTINCT page."id")
FROM "Page" page
LEFT JOIN "Evidence" evidence ON evidence."targetPageId" = page."id"
LEFT JOIN "SourceVersion" version ON version."id" = page."sourceVersionId"
LEFT JOIN "Source" source
  ON source."id" = page."sourceId"
 AND source."id" = version."sourceId"
WHERE version."metadata"->>'contentFormat' = 'agentwiki/legacy-codebase-snapshot-bundle@1'
  AND evidence."location"->>'legacyJobId' IS NOT NULL
  AND page."sourceId" IS NOT NULL
  AND page."sourceVersionId" IS NOT NULL
  AND page."sourcePath" IS NOT NULL
  AND evidence."location"->>'linkStrategy' IS NOT NULL
  AND evidence."confidence" IS NOT NULL
  AND evidence."location"->>'linkStrategy' IN ('legacy-result', 'single-snapshot')
  AND evidence."sourceVersionId" IS NOT DISTINCT FROM page."sourceVersionId"
  AND evidence."location"->>'sourcePath' IS NOT DISTINCT FROM page."sourcePath"
  AND evidence."location"->>'bundlePath' IS NOT DISTINCT FROM page."sourcePath"
  AND evidence."location"->>'requestedPath' IS NULL
  AND source."id" IS NOT NULL
  AND (
    COALESCE((version."content"::jsonb)->'filesByPath', '{}'::jsonb)
    ? (evidence."location"->>'bundlePath')
  )
  AND evidence."confidence" IS NOT DISTINCT FROM CASE evidence."location"->>'linkStrategy'
    WHEN 'legacy-result' THEN 1.0
    WHEN 'single-snapshot' THEN 0.75
    WHEN 'legacy-result-path-missing-snapshot' THEN 0.25
    WHEN 'synthetic-page-link' THEN 0.5
  END;
-- END LEGACY_FULLY_LINKED_COUNT
```

7. Verify every bundle path in both directions. Each `filesByPath` payload retains the original content, legacy hash, and an independent `contentChecksum`. The following query uses `LEFT JOIN` plus `IS DISTINCT FROM`, so missing rows and NULL values cannot disappear from the report. It must return zero rows:

```sql
WITH legacy_versions AS (
  SELECT "id", "content"
  FROM "SourceVersion"
  WHERE "metadata"->>'contentFormat' = 'agentwiki/legacy-codebase-snapshot-bundle@1'
), bundle_files AS (
  SELECT
    version."id" AS "sourceVersionId",
    entry.key AS "path",
    entry.value AS "payload"
  FROM legacy_versions version
  LEFT JOIN LATERAL jsonb_each(
    COALESCE((version."content"::jsonb)->'filesByPath', '{}'::jsonb)
  ) entry ON TRUE
)
SELECT
  'bundle_without_matching_snapshot' AS problem,
  bundle."sourceVersionId",
  bundle."path"
FROM bundle_files bundle
LEFT JOIN "SourceFileSnapshot" snapshot
  ON snapshot."sourceVersionId" = bundle."sourceVersionId"
 AND snapshot."path" = bundle."path"
WHERE bundle."path" IS NOT NULL
  AND (
    snapshot."id" IS NULL
    OR snapshot."contentHash" IS DISTINCT FROM bundle."payload"->>'contentHash'
    OR bundle."payload"->>'contentChecksum'
       IS DISTINCT FROM 'md5:' || md5(COALESCE(bundle."payload"->>'content', ''))
  )
UNION ALL
SELECT
  'snapshot_without_bundle_path' AS problem,
  version."id" AS "sourceVersionId",
  snapshot."path"
FROM legacy_versions version
LEFT JOIN "SourceFileSnapshot" snapshot ON snapshot."sourceVersionId" = version."id"
LEFT JOIN bundle_files bundle
  ON bundle."sourceVersionId" = snapshot."sourceVersionId"
 AND bundle."path" = snapshot."path"
WHERE snapshot."id" IS NOT NULL
  AND bundle."path" IS NULL;
```

Finally, verify Page → SourceVersion → Source and Page → Evidence provenance in both directions. Both `linkStrategy` and `confidence` are mandatory. `legacy-result` requires confidence `1`; `single-snapshot` requires `0.75`; both require non-null, equal Page/source/bundle paths that exist in `filesByPath`, and neither permits `requestedPath`. The `legacy-result-path-missing-snapshot` fallback requires confidence `0.25`, NULL Page/source/bundle paths, and a non-empty `requestedPath`; `synthetic-page-link` requires confidence `0.5`, NULL Page/source/bundle paths, and NULL `requestedPath`. The two-sided `LEFT JOIN` checks also expose missing Page, SourceVersion, Source, and Evidence edges instead of losing them through NULL filtering. This query must return zero rows:

```sql
-- BEGIN LEGACY_PROVENANCE_VALIDATION
WITH evidence_problems AS (
  SELECT
    CASE
      WHEN evidence."location"->>'legacyJobId' IS NULL
        THEN 'evidence_missing_legacy_job'
      WHEN page."id" IS NULL
        THEN 'evidence_missing_page'
      WHEN version."id" IS NULL
        THEN 'evidence_missing_source_version'
      WHEN evidence."sourceVersionId" IS DISTINCT FROM page."sourceVersionId"
        THEN 'evidence_page_version_mismatch'
      WHEN source."id" IS NULL
        THEN 'evidence_missing_or_mismatched_source'
      WHEN evidence."location"->>'linkStrategy' IS NULL
        THEN 'evidence_link_strategy_missing'
      WHEN evidence."confidence" IS NULL
        THEN 'evidence_confidence_missing'
      WHEN evidence."location"->>'linkStrategy' NOT IN (
        'legacy-result',
        'single-snapshot',
        'legacy-result-path-missing-snapshot',
        'synthetic-page-link'
      )
        THEN 'evidence_link_strategy_invalid'
      WHEN evidence."confidence" IS DISTINCT FROM CASE evidence."location"->>'linkStrategy'
        WHEN 'legacy-result' THEN 1.0
        WHEN 'single-snapshot' THEN 0.75
        WHEN 'legacy-result-path-missing-snapshot' THEN 0.25
        WHEN 'synthetic-page-link' THEN 0.5
      END
        THEN 'evidence_confidence_mismatch'
      WHEN evidence."location"->>'sourcePath' IS DISTINCT FROM page."sourcePath"
        THEN 'evidence_source_path_mismatch'
      WHEN evidence."location"->>'linkStrategy' = 'legacy-result' AND (
        page."sourcePath" IS NULL
        OR evidence."location"->>'sourcePath' IS NULL
        OR evidence."location"->>'bundlePath' IS NULL
        OR evidence."location"->>'bundlePath' IS DISTINCT FROM page."sourcePath"
      )
        THEN 'high_confidence_bundle_path_mismatch'
      WHEN evidence."location"->>'linkStrategy' = 'single-snapshot' AND (
        page."sourcePath" IS NULL
        OR evidence."location"->>'sourcePath' IS NULL
        OR evidence."location"->>'bundlePath' IS NULL
        OR evidence."location"->>'bundlePath' IS DISTINCT FROM page."sourcePath"
      )
        THEN 'evidence_mapped_path_invalid'
      WHEN evidence."location"->>'linkStrategy' IN (
        'legacy-result-path-missing-snapshot',
        'synthetic-page-link'
      ) AND (
        page."sourcePath" IS NOT NULL
        OR evidence."location"->>'sourcePath' IS NOT NULL
        OR evidence."location"->>'bundlePath' IS NOT NULL
      )
        THEN 'evidence_fallback_path_invalid'
      WHEN evidence."location"->>'linkStrategy' IN (
        'legacy-result',
        'single-snapshot',
        'synthetic-page-link'
      ) AND evidence."location"->>'requestedPath' IS NOT NULL
        THEN 'evidence_requested_path_invalid'
      WHEN evidence."location"->>'linkStrategy' = 'legacy-result-path-missing-snapshot'
        AND NULLIF(btrim(evidence."location"->>'requestedPath'), '') IS NULL
        THEN 'evidence_requested_path_invalid'
      WHEN evidence."location"->>'linkStrategy' IN ('legacy-result', 'single-snapshot')
        AND NOT (
          COALESCE((version."content"::jsonb)->'filesByPath', '{}'::jsonb)
          ? (evidence."location"->>'bundlePath')
        )
        THEN 'evidence_bundle_path_missing'
    END AS problem,
    evidence."id" AS "evidenceId",
    page."id" AS "pageId"
  FROM "Evidence" evidence
  LEFT JOIN "Page" page ON page."id" = evidence."targetPageId"
  LEFT JOIN "SourceVersion" version ON version."id" = evidence."sourceVersionId"
  LEFT JOIN "Source" source
    ON source."id" = page."sourceId"
   AND source."id" = version."sourceId"
  WHERE evidence."location"->>'legacyJobId' IS NOT NULL
     OR version."metadata"->>'contentFormat' = 'agentwiki/legacy-codebase-snapshot-bundle@1'
), page_problems AS (
  SELECT
    CASE
      WHEN page."sourceId" IS NULL OR source."id" IS NULL
        THEN 'page_missing_source'
      WHEN page."sourceVersionId" IS NULL OR version."id" IS NULL
        THEN 'page_missing_source_version'
      WHEN version."sourceId" IS DISTINCT FROM page."sourceId"
        THEN 'page_source_version_mismatch'
      WHEN evidence."id" IS NULL
        THEN 'page_missing_evidence'
    END AS problem,
    NULL::text AS "evidenceId",
    page."id" AS "pageId"
  FROM "Page" page
  LEFT JOIN "SourceVersion" version ON version."id" = page."sourceVersionId"
  LEFT JOIN "Source" source ON source."id" = page."sourceId"
  LEFT JOIN "Evidence" evidence
    ON evidence."targetPageId" = page."id"
   AND evidence."location"->>'legacyJobId' IS NOT NULL
  WHERE version."metadata"->>'contentFormat' = 'agentwiki/legacy-codebase-snapshot-bundle@1'
     OR page."sourceId" LIKE 'legacy-source-%'
)
SELECT problem, "evidenceId", "pageId"
FROM evidence_problems
WHERE problem IS NOT NULL
UNION ALL
SELECT problem, "evidenceId", "pageId"
FROM page_problems
WHERE problem IS NOT NULL
ORDER BY 1, 2, 3;
-- END LEGACY_PROVENANCE_VALIDATION
```

## Incident response

1. Pause or revoke the affected Agent and revoke its credentials.
2. Use Agent and security audit events plus `x-request-id` to bound affected resources.
3. Revert published ChangeSets; do not edit away provenance.
4. Rotate exposed secrets and invalidate sessions as needed.
5. Preserve audit evidence, record the timeline, and add a regression test before re-enabling access.

## Data lifecycle

- Memory privacy deletion overwrites content, tags and entity metadata before retaining a tombstone.
- Local-path legacy Sources are archived and cannot be rerun.
- Source versions and Evidence are retained with published knowledge so provenance remains verifiable.
- Audit retention and backup retention must be configured to meet the deploying organization's policy; no UI claim should promise indefinite retention.
## Local knowledge sync operations

### Server configuration

Set these values in the API process environment before enabling local-sync enrollment:

| Variable | Required | Operational requirement |
| --- | --- | --- |
| `PUBLIC_API_URL` | Yes outside development | Canonical public absolute `http(s)` API URL, including `/api`, with no credentials, query, or fragment. It is embedded in generated local installation instructions. |
| `LOCAL_SYNC_PACKAGE_VERSION` | Yes | Exact published `@agentwiki/local-sync` version accepted by the enrollment exchange. It must match the version used by the client enrollment card. |
| `REDIS_URL` | Yes | Stores one-time enrollment records and the exchange rate-limit counters. Redis must be available for issuance, exchange, and revocation of unexchanged installation codes. |
| `NODE_ENV` | Yes | In production and staging, absence of `PUBLIC_API_URL` fails enrollment closed. Development alone may derive the URL from the request. |

Use TLS at the public endpoint. Do not place a credential, enrollment code, or server URL with embedded credentials in an environment variable, reverse-proxy log, shell history, or ticket. Installation codes expire after 10 minutes, are stored only as a hash-derived identifier, and are consumed atomically on exchange.

### npm release dependency and procedure

The UI and server deliberately pin an exact local-sync package version. An enrollment can succeed only when all three values agree: the published npm package version, the client enrollment-card constant, and `LOCAL_SYNC_PACKAGE_VERSION` on the server. Never generate instructions for an unpublished version.

1. Choose the release version and update the package version, the client enrollment version, and the server deployment value together.
2. Run `pnpm --filter @agentwiki/local-sync test`, `pnpm --filter @agentwiki/local-sync typecheck`, and `pnpm --filter @agentwiki/local-sync build`; inspect the packed tarball to ensure it contains only the declared distributable files and no fixtures, credentials, `.env` files, or local paths.
3. Publish `@agentwiki/local-sync@<exact-version>` to the approved npm registry from the reviewed release commit. Confirm the registry resolves that exact version before changing production configuration.
4. Deploy the matching client and server release, set `LOCAL_SYNC_PACKAGE_VERSION=<exact-version>`, restart the API, then generate a fresh installation instruction and complete `doctor` using a non-production Agent/Space.

The npm release is a production dependency, not an optional convenience: users receive an `npx` command that must resolve the exact pinned version. Keep the previous published package version available until the rollback window has closed.

### Logs, audit evidence, and health checks

Application services write to systemd journal rather than an application log file:

```bash
journalctl --user -u agentwiki-api.service --since '1 hour ago'
journalctl --user -u agentwiki-worker.service --since '1 hour ago'
journalctl --user -u agentwiki-frontend.service --since '1 hour ago'
```

Use the reverse-proxy request log and its `x-request-id` to correlate an exchange with API logs. The server audit store records the successful enrollment exchange as `local-sync.installation.exchange` with the Agent, credential ID, hashed installation ID, plugin version, selected scopes, and source IP. Credential revocation records `credential.revoke`; successful knowledge uploads record `knowledge_sync.create`. Do not log the one-time code, API key, prepared envelope contents, or full local path.

Investigate these events first: repeated `LOCAL_SYNC_CODE_INVALID` or `AUTH_RATE_LIMITED` responses, `LOCAL_SYNC_VERSION_UNSUPPORTED`, unexpected exchange IPs, inactive Agent/credential checks from `doctor`, and failed `knowledge_sync.create` operations. Verify API and Redis with `GET /api/health` after every configuration or release change.

### Credential revocation

There are two different actions:

1. **Cancel an unexchanged instruction:** while its 10-minute TTL is still active, delete it with `DELETE /agents/:agentId/local-sync-installations/:installationId` as the Agent owner. This removes the pending Redis record; it cannot revoke a credential that has already been exchanged.
2. **End an installed connection immediately:** identify the connection's `credentialId` in `~/.agentwiki/local-sync.json`, then revoke it as the Agent owner with `DELETE /agents/:agentId/credentials/:credentialId`. The credential becomes inactive server-side immediately. Remove the local MCP entry with `agentwiki-local-sync uninstall --agent <codex|claude|opencode>` and, if the host is untrusted, add `--delete-credential --delete-sync-state`.

For compromise, revoke the server-side credential first, then revoke or deactivate the Agent, inspect the audit trail and affected Sources/Runs, rotate any unrelated exposed secret, and re-enroll with a new one-time code. Local uninstall alone never revokes server access.

### Rollback

Before a release, record the prior npm package version, client build, and `LOCAL_SYNC_PACKAGE_VERSION`; retain the previous package in the registry. To roll back:

1. Stop issuing new instructions, deploy the previous client/server build, and set `LOCAL_SYNC_PACKAGE_VERSION` back to the previous exact published version.
2. Restart the API, verify `/api/health`, and issue a new non-production instruction. It must install the prior package and pass `doctor`.
3. For a local client already upgraded, run `agentwiki-local-sync upgrade --version <previous-exact-version>` or remove and re-enroll it. The upgrade changes the registered MCP command while retaining the connection ID, local credential, and sync state.
4. If the release exposed a security issue, do not preserve existing credentials for convenience: revoke them and require re-enrollment before re-enabling sync.

Do not roll back the database as a response to a package-only problem. Existing Source, Run, Evidence, ChangeSet, and Page provenance are audit data; recover knowledge through the normal review/revert flow rather than deleting it during rollback.

