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
