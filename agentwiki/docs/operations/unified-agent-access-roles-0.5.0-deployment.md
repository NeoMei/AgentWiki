# Unified Agent access roles 0.5.0 deployment gate

This is a breaking application, database, and local-sync protocol release. Do not push,
publish `@neomei/agentwiki-sync-protocol@0.2.0` or
`@neomei/agentwiki-local-sync@0.5.0`, apply the migration, restart services, or change a
live Agent connection until the release owner explicitly authorizes those actions.

## Required preflight

1. Record the exact release commit, `origin/master`, npm `latest`, and the production
   application version with read-only checks.
2. Verify the local release matrix and pack the exact sync-protocol 0.2.0 and local-sync
   0.5.0 npm tarballs. Record both filenames, contents, sizes, and SHA-256 digests. Run
   `pnpm test:package:local-sync-clean-install` to install both candidates in an empty
   directory and start the installed CLI.
3. Fingerprint the current production application and migration state before copying
   files.
4. Create a PostgreSQL custom-format dump and an application rollback archive outside
   the deployment tree. Verify both files are non-empty, record their SHA-256 digests,
   and test that the database dump can be listed with `pg_restore --list`.

Never print database URLs, API keys, connection codes, or environment-file contents in
release evidence.

## Migration semantics

Migration `20260822120000_unify_agent_access_roles` creates the exact enum
`reader | editor | publisher`. The later breaking migration
`20260823090000_bind_agent_credentials_to_grants` makes `AgentGrant.role` the sole
persisted permission fact: it removes Credential role/scopes and Grant scopes, adds the
required Credential `authorizationId`, and enforces the same-Agent binding with a
composite foreign key. Because old-version data is explicitly unsupported, this migration
deletes existing Agent Credentials; owners must create new connections after deployment.

After migration, owners must authorize a new connection for each required Space. The
server accepts only the 0.5.0 onboarding flow; 0.4.0 clients and
legacy `viewer`, `full`, `permissionPreset`, `approvalMode`, or custom-scope requests are
not compatible.

## Release and verification order

After explicit authorization and successful backup verification:

1. Push the verified commit.
2. Publish the audited `@neomei/agentwiki-sync-protocol@0.2.0` tarball and verify the npm
   version and exported Agent role contract.
3. Publish the audited `@neomei/agentwiki-local-sync@0.5.0` tarball only after the
   sync-protocol dependency is available, then repeat the clean-install CLI check using
   the registry packages.
4. Prepare the new AgentWiki release outside the live deployment path while preserving
   production environment files. Install with the lockfile, regenerate Prisma Client,
   build, and verify the exact artifact before entering the maintenance window.
5. Put the site into maintenance mode. Stop and drain the existing AgentWiki API and Worker processes,
   verify both old processes are no longer serving requests or holding jobs, and keep them
   stopped for the schema cutover. The old build is incompatible with the migrated schema.
6. Apply Prisma migrations while the old API and Worker remain stopped. If migration fails,
   do not start either application version; restore the verified database/application pair.
7. Atomically activate the prepared release, then start only the newly built AgentWiki API and Worker.
   Restart or switch the frontend only to the matching new build, then remove maintenance mode.
8. Verify `/api/health`, service restart counters, the advertised 0.5.0 onboarding
   version, and the three-role UI. Verify Reader onboarding completes through pull
   without a write request, and that another user's Agent grant has no role mutation UI.
9. Create a new Editor connection and run the real OpenCode acceptance. Its proposal must
   enter `pending_review`, and Agent approval must fail.
10. Before accepting Publisher auto-publish, race at least one Credential revoke and one
   Space policy downgrade against publication; both must remain `pending_review` and
   must not create or update content.

## Rollback boundary

There is no supported schema-only downgrade to the legacy Agent authorization model.
Rollback means restoring both the verified pre-release PostgreSQL dump and the matching
application archive, then rechecking services and health. Restoring only old application
code against the migrated schema, or only the database beneath 0.5.0 code, is not a valid
rollback.
