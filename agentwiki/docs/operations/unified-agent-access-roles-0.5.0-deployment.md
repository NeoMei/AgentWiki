# Unified Agent access roles 0.5.0 deployment gate

This is a breaking application, database, and local-sync protocol release. Do not push,
publish `@neomei/agentwiki-local-sync@0.5.0`, apply the migration, restart services, or
change a live Agent connection until the release owner explicitly authorizes those actions.

## Required preflight

1. Record the exact release commit, `origin/master`, npm `latest`, and the production
   application version with read-only checks.
2. Verify the local release matrix and pack the exact 0.5.0 npm tarball. Record its
   filename, contents, size, and SHA-256 digest.
3. Fingerprint the current production application and migration state before copying
   files.
4. Create a PostgreSQL custom-format dump and an application rollback archive outside
   the deployment tree. Verify both files are non-empty, record their SHA-256 digests,
   and test that the database dump can be listed with `pg_restore --list`.

Never print database URLs, API keys, connection codes, or environment-file contents in
release evidence.

## Migration semantics

Migration `20260822120000_unify_agent_access_roles` creates the exact enum
`reader | editor | publisher`, adds `AgentCredential.role`, and converts every existing
`AgentGrant.role` to `reader` with a constant expression. It deliberately does not infer
a role from legacy scopes. Existing stored scopes remain diagnostic data but cannot
raise effective access above the persisted role ceiling.

After migration, owners must authorize a new role package for each connection that needs
more than Reader. The server accepts only the 0.5.0 onboarding flow; 0.4.0 clients and
legacy `viewer`, `full`, `permissionPreset`, `approvalMode`, or custom-scope requests are
not compatible.

## Release and verification order

After explicit authorization and successful backup verification:

1. Push the verified commit and publish only the audited tarball.
2. Mirror the AgentWiki source while preserving production environment files.
3. Install with the lockfile, regenerate Prisma Client, and build.
4. Apply Prisma migrations, then restart only the AgentWiki API, Worker, and frontend.
5. Verify `/api/health`, service restart counters, the advertised 0.5.0 onboarding
   version, and the three-role UI.
6. Create a new Editor connection and run the real OpenCode acceptance. Its proposal must
   enter `pending_review`, and Agent approval must fail.

## Rollback boundary

There is no supported schema-only downgrade to the legacy Agent authorization model.
Rollback means restoring both the verified pre-release PostgreSQL dump and the matching
application archive, then rechecking services and health. Restoring only old application
code against the migrated schema, or only the database beneath 0.5.0 code, is not a valid
rollback.
