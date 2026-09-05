# Operating Sync v3 attachment storage

This runbook covers the API and cleanup worker for referenced-image Sync v3. It does not authorize a production deployment.

## Persistent root and permissions

Provision one dedicated filesystem/dataset at `/var/lib/agentwiki/attachments`. It must survive application releases and container/service restarts, be owned by the non-root service identity, and be mode `0700` (service-created files remain private under `UMask=0077`). Do not place it under `/tmp`, a home directory, the checkout, a release symlink, or a broad system root.

Set `ATTACHMENT_STORAGE_PATH=/var/lib/agentwiki/attachments` to exactly the same value for the API and worker. Docker Compose mounts the same named volume at that path in both read-only-root containers; systemd grants that path as the only service write exception under `ProtectSystem=strict`. The frontend and migration one-shot receive neither the volume nor the environment variable.

Startup and deployment validation must resolve the root and its `.tmp`, `.locks`, and `sha256` descendants, reject symlinks/non-directories/path escape, enforce owner-only mode and write access, and fail health when the configured free-space floor is not met. Do not “fix” a rejected path by weakening validation.

## Migration and startup order

1. Stop/quiesce all API and worker writers and take the reviewed database plus attachment-tree backup pair.
2. Validate the staged release and its explicit attachment root before changing the live symlink or database.
3. Run all existing Prisma migrations, then the Sync v3 migrations in repository order: `20260904120000_add_sync_v3_attachments`, `20260905120000_expand_sync_v3_push_change_ordinal`, `20260905180000_add_attachment_blob_reference_indexes`, `20260905200000_add_attachment_cleanup_cursor`, and `20260905210000_harden_attachment_cleanup_claim`.
4. Start the API with `PROCESS_ROLE=api`; require `/api/health` to report both `status: ok` and `attachmentStorage: ok`.
5. Start the worker with `PROCESS_ROLE=worker`, the same database, Redis, attachment root, limits, retention, and lock settings.
6. Only then restore ingress and monitor the first cleanup cycle.

Migrations are forward-only. The cursor migration intentionally replaces `SpaceAttachment_status_archivedAt_idx` with `SpaceAttachment_status_archivedAt_id_idx`; do not recreate the obsolete two-column index.

## Cleanup, retention, and leases

`ATTACHMENT_RETENTION_DAYS` controls archived metadata recovery and `ATTACHMENT_ORPHAN_GRACE_HOURS` delays orphan Blob collection. Revision retention remains an authorization boundary: a Blob referenced by any retained immutable Revision must not be unlinked even when current metadata detached it.

Only workers run cleanup. Archived scanning uses a persisted keyset cursor and an expiring owner token. Claim, renewal, fencing, and expiry comparisons use PostgreSQL `clock_timestamp()`, not host clocks. A worker that cannot acquire or renew the lease must stop before metadata mutation or unlink. Physical removal additionally runs under the content lock, rechecks database ownership, and treats loss of the lease as a no-op. Multiple workers are therefore safe, but all must share the same database and storage root.

## Backup and rollback

Use the reviewed backup/restore scripts and keep the database dump and attachment archive as one manifest-bound pair. The archive allowlist is the attachment root content only; reject symlinks, devices, sockets, FIFOs, hard-link surprises, traversal, duplicate members, and manifests whose hashes/sizes differ. Encrypt and retain backups according to the environment policy; never include `.env` or credentials in an evidence report.

Rollback is an operator maintenance event:

1. Remove ingress and stop both writers.
2. Verify the selected historical pair before execution.
3. Capture an independent rollback pair of the current state.
4. Restore the database first, then atomically promote the matching attachment tree.
5. Start a private one-shot API against the restored pair and require semantic storage health.
6. Promote the application release, then start API and worker.

Application-only rollback after a v3 migration is unsafe. v3 ChangeSets are not revertible through the legacy review API; use a new forward Push for content correction or restore the paired database/filesystem backup.

## Observability and response

Monitor API health/storage status, HTTP counts by public Sync code, Push creation/finalize latency, sessions stuck in `uploading` or `ready_to_finalize`, staged Blob age/bytes, free bytes, archived rows past retention, orphan candidates, cleanup claim/renew/loss, cursor progress, content-lock timeout, and unlink failures. Never log bearer credentials, installation codes, Blob bytes, Page bodies, database URLs, storage keys, or unredacted internal exceptions.

Alert immediately on storage health failure, root validation failure, free space below the configured floor, repeated `INTERNAL_ERROR`, lease churn without cursor progress, or retained-Revision ownership mismatches. First preserve logs/metrics and stop writers if integrity is uncertain; do not manually delete content-addressed files.
