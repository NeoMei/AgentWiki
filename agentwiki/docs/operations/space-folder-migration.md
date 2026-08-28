# Space Folder legacy-tree migration runbook

This runbook prepares and executes the Release A legacy `Page.parentId` backfill one Space at a time. It does not deploy application code, migrate production by itself, or prove that production has already been migrated.

The command creates a companion Folder for every legacy parent Page, moves active child Pages into the resulting Folder chain, records changed Page paths as aliases, and backfills historical `PageVersion.folderId` from retained `PageVersion.parentId`. Page IDs, knowledge keys, titles, content, authors, and timestamps are preserved. The migration keeps `Page.parentId` and `PageVersion.parentId` until the separately reviewed Release B cutover.

## Safety boundary

- Stop every old API and Worker process that can write the Page tree before apply. Keep them stopped through post-count verification.
- Use the intended database URL explicitly as `DATABASE_URL`; inspect the host, port, database name, and current user before any backup or migration command.
- Run Prisma Release A schema migrations before this data backfill. Do not run the Release B field-removal migration yet.
- Apply exactly one Space ID per command. The transaction obtains the shared Space advisory lock before reading the authoritative Space row.
- A successful Space writes the unique batch key `space-folders-v1:<spaceId>`. Re-running that completed key is a strict no-op even if rows were added later.
- There is no reverse-data migration. Rollback means restoring the verified database backup. Do not try to infer the legacy Page tree from Folder paths or aliases.

## 1. Record identity and create a backup

Use operator-controlled paths and do not place credentials in the report or shell history.

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c \
  'SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), now();'

pg_dump --dbname "$DATABASE_URL" --format=custom --file agentwiki-before-space-folders.dump
shasum -a 256 agentwiki-before-space-folders.dump \
  > agentwiki-before-space-folders.dump.sha256
shasum -a 256 -c agentwiki-before-space-folders.dump.sha256
pg_restore --list agentwiki-before-space-folders.dump \
  > agentwiki-before-space-folders.dump.list
```

Backup verification is not complete after `pg_dump` exits successfully. Restore the dump into a disposable verification database approved for this operation, run the same pre-count queries there, and retain the restore log and counts. Drop that disposable verification database only after the verification record has been retained.

## 2. Record pre-counts and schema state

For the chosen Space, retain the output of:

```sql
SELECT "id", "contentTreeRevision" FROM "Space" WHERE "id" = :'space_id';
SELECT COUNT(*) AS pages,
       COUNT(*) FILTER (WHERE "deletedAt" IS NULL) AS active_pages,
       COUNT(*) FILTER (WHERE "deletedAt" IS NULL AND "parentId" IS NOT NULL) AS active_legacy_children
FROM "Page" WHERE "spaceId" = :'space_id';
SELECT COUNT(*) AS folders,
       COUNT(*) FILTER (WHERE "deletedAt" IS NULL) AS active_folders
FROM "Folder" WHERE "spaceId" = :'space_id';
SELECT COUNT(*) AS aliases FROM "PagePathAlias" WHERE "spaceId" = :'space_id';
SELECT COUNT(*) AS historical_versions_with_parent,
       COUNT(*) FILTER (WHERE version."folderId" IS NULL) AS historical_versions_pending
FROM "PageVersion" version
JOIN "Page" page ON page."id" = version."pageId"
WHERE page."spaceId" = :'space_id' AND version."parentId" IS NOT NULL;
SELECT "id", "migrationBatchId", "createdAt"
FROM "SpaceKnowledgeRevision"
WHERE "spaceId" = :'space_id'
ORDER BY "sequence" DESC LIMIT 5;
```

Also retain `prisma migrate status` output and confirm the additive `20260828120000_expand_space_folders` migration is applied.

## 3. Read-only preflight

Create a report directory with restricted permissions. `--report` refuses to overwrite an existing file.

```bash
install -d -m 700 migration-reports
DATABASE_URL="$DATABASE_URL" pnpm migrate:space-folders:dry-run -- \
  --space '<space-id>' \
  --report 'migration-reports/<space-id>-dry-run.json'
```

The report contains the input snapshot hash, planned Folder/Page/version/alias counts, every title transformation, deterministic sibling collision allocation, and all rejection codes. Legacy sanitization normalizes NFC, folds each consecutive forbidden-character run to one space, collapses whitespace, cleans trailing dots/spaces, handles reserved device names, and hashes any UTF-8 truncation. Preflight is zero-write. Do not apply if it reports a cycle, orphan, cross-Space reference, Folder/path/depth/count/mutation limit, existing-tree inconsistency, or Page/PageVersion placement conflict.

Review sanitized names and ` (2)`, ` (3)` allocations with the Space owner. Retain the exact report and its SHA-256 digest with the backup verification evidence.

## 4. Apply one Space

With all legacy writers still stopped, run:

```bash
DATABASE_URL="$DATABASE_URL" pnpm migrate:space-folders:apply -- \
  --space '<space-id>' \
  --expected-input-hash '<inputHash-from-reviewed-dry-run>' \
  --report 'migration-reports/<space-id>-apply.json'
shasum -a 256 migration-reports/<space-id>-*.json
```

Apply repeats preflight after taking the Space advisory lock and rejects `MIGRATION_INPUT_CHANGED` unless the locked input matches the reviewed dry-run hash. Folder creation, old-path aliases, Page placement/path changes, historical PageVersion placement, the migration revision/batch key, and `contentTreeRevision` advancement commit in one transaction. Any failure leaves none of those writes behind.

Run a second apply command with the same expected input hash and a new report filename. It must return `status: "completed"` with zero created/moved/backfilled counts and the same completed revision ID. The completed batch key is checked before rescanning later rows, so this verification remains a strict no-op.

## 5. Post-counts and evidence retention

Repeat every pre-count query. Additionally retain:

```sql
SELECT "id", "migrationBatchId", "origin", "sequence", "createdAt"
FROM "SpaceKnowledgeRevision"
WHERE "spaceId" = :'space_id'
  AND "migrationBatchId" = 'space-folders-v1:' || :'space_id';

SELECT COUNT(*) AS unresolved_active_legacy_children
FROM "Page"
WHERE "spaceId" = :'space_id'
  AND "deletedAt" IS NULL
  AND "parentId" IS NOT NULL
  AND "folderId" IS NULL;

SELECT COUNT(*) AS unresolved_historical_versions
FROM "PageVersion" version
JOIN "Page" page ON page."id" = version."pageId"
WHERE page."spaceId" = :'space_id'
  AND version."parentId" IS NOT NULL
  AND version."folderId" IS NULL;

SELECT COUNT(*) AS changed_paths_without_alias
FROM "Page" page
WHERE page."spaceId" = :'space_id'
  AND page."deletedAt" IS NULL
  AND page."parentId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "PagePathAlias" alias
    WHERE alias."spaceId" = page."spaceId" AND alias."pageId" = page."id"
  );
```

Retain the database identity, application commit/image identity, migration status, backup hash and restore verification, dry-run/apply/no-op reports and hashes, pre/post counts, and operator/time record. Report local, GitHub, npm, deployed server, and production validation states separately; these local commands do not establish any release or deployment state.

## Rollback

If apply fails, first verify that the Space has no completed batch key and that the transaction left Folder/Page/alias/version/tree revision counts unchanged. Investigate before retrying.

If a committed migration must be rolled back, keep writers stopped and restore the entire database from the verified pre-migration backup according to the database recovery procedure. Re-run database identity, migration status, and pre-count verification after restore. Do not delete migration-created rows manually, clear the batch key, decrement revisions, or reconstruct `parentId` from current Folder paths.
