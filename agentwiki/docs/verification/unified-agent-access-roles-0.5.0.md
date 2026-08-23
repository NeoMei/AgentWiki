# Unified Agent access roles 0.5.0 local verification

## Result

Local release verification passed on 2026-08-23 (Asia/Shanghai) for the unified-role
implementation plus the single-entry authorization correction. No push,
npm publish, production deployment, migration application, service restart, live
connection change, or real OpenCode acceptance was performed.

- Node: `v24.18.0`
- pnpm: `11.9.0`
- Application/local-sync/onboarding version: `0.5.0`
- Shared sync-protocol package version: `0.2.0`
- Agent roles: exactly `reader | editor | publisher`
- Local candidate branch: `codex/agent-authorization-single-source`

## Build and full repository tests

Command:

```bash
pnpm build && pnpm test
```

Result: exit 0. All workspace packages built, then the root test chain passed:

| Suite | Result |
| --- | --- |
| Runtime contracts | 87 passed, 0 failed, 47 skipped |
| Server Jest | 64 suites, 751 tests passed |
| Client Vitest | 45 files, 223 tests passed |
| Sync protocol Vitest | 6 files, 25 tests passed |
| Local Sync Vitest | 59 files, 736 tests passed |

The 47 runtime skips were all explicit environment gates: 46 require a configured local
PostgreSQL `DATABASE_URL`, and one requires the independently installed CodeGraph real
acceptance opt-in. There were no unexpected skips. Vite emitted its existing advisory
that two production chunks exceed 500 kB; the build completed successfully.

## Type, lint, Prisma, and formatting gates

Commands:

```bash
pnpm typecheck
pnpm lint
pnpm --filter @agentwiki/server exec prisma generate
DATABASE_URL=postgresql://agentwiki:placeholder@127.0.0.1:5432/agentwiki \
  pnpm --filter @agentwiki/server exec prisma validate
git diff --check
```

Result: all commands exited 0. Prisma Client 5.22.0 generated successfully and Prisma
reported `prisma/schema.prisma` valid. A preceding `prisma validate` without the
placeholder URL exited with P1012 because this clean worktree intentionally has no
`DATABASE_URL`; validation does not connect to the placeholder database.

The current migration chain, including
`20260823090000_bind_agent_credentials_to_grants`, was applied to a fresh PostgreSQL
database and inspected directly:

- it creates only `reader`, `editor`, and `publisher`;
- `AgentCredential` has `authorizationId` but no `role` or `scopes` columns;
- `AgentGrant` has `role` but no `scopes` column;
- a composite foreign key enforces `(authorizationId, agentId) -> AgentGrant(id, agentId)`;
- existing Agent Credentials are deliberately deleted because legacy data compatibility
  is outside this breaking release.

After the final diagnostic-boundary change, the full 40-migration chain and real
Streamable HTTP MCP smoke were repeated on another fresh PostgreSQL database. The smoke
returned `{"status":"passed","checks":31}` and covered live role downgrade/restore,
Editor proposal to `pending_review`, Agent approval denial, human review-publish, and the
derived connection diagnostic query including the Credential-filtered recent MCP call.
The temporary database was then dropped and its
absence verified.

## Three-client onboarding

Commands:

```bash
pnpm test:e2e:onboarding
pnpm --filter @neomei/agentwiki-local-sync exec vitest run \
  src/onboarding/onboarding-e2e-driver.spec.ts
```

Result: both commands exited 0. The Node harness passed 8/8 and exercised isolated
Codex, Claude Code, and OpenCode homes. The direct Local Sync driver passed 8/8. Active
fixtures submit `role`, never `permissionPreset`, `approvalMode`, or custom scopes.

## Package audit

Commands:

```bash
pnpm --filter @neomei/agentwiki-sync-protocol pack \
  --pack-destination /tmp/agentwiki-role-pack-final
pnpm --filter @neomei/agentwiki-local-sync pack \
  --pack-destination /tmp/agentwiki-role-pack-final
pnpm test:package:local-sync-clean-install
```

The pack lifecycles rebuilt both packages and passed sync-protocol 6 files / 25 tests and
Local Sync 59 files / 736 tests. The clean-install verifier then packed both current
workspace candidates, installed them into a new temporary directory, and completed with
`{"status":"passed","localSyncVersion":"0.5.0","syncProtocolVersion":"0.2.0"}`.

The local-sync tarball metadata pins `@neomei/agentwiki-sync-protocol` to `0.2.0`. The
clean-install gate installed both generated tarballs into a new temporary directory and
the installed CLI printed its usage with exit 0. A scan of packed `dist/` found no
`permissionPreset`, `approvalMode`, or `0.4.0`; the compiled coordinator contains the
exact role choices and `packageVersion: '0.5.0'`.

## Legacy-boundary and secret scans

Targeted scans passed for the active Agent DTOs, connection/onboarding DTOs, coordinator,
three-client harness, smoke/cross-machine E2E harnesses, and Playwright connection
fixtures:

- no legacy `permissionPreset`, client-supplied `approvalMode`, or 0.4.0 request path;
- no request DTO or active fixture accepts/sends custom `scopes`;
- no Agent role value `viewer` or `full` remains in active Agent connection code;
- human Space `viewer/editor/admin/owner` roles and the Reader-to-human-Viewer capability
  mapping remain intentionally separate;
- remaining production `approvalMode` references are server-derived, read-only governance
  state used by Publisher auto-publish checks, not request fields.

## Final authorization-boundary regressions

- Reader full onboarding completes after gateway verification and a read-only pull. The
  coordinator and runtime E2E assert that local planning, prepare, and `confirmAndSync`
  are never called; Editor and Publisher retain the confirmed write-sync path.
- `GET /spaces/:id/members` returns `canManageRole` per Agent grant. It is true only for
  a Space owner/admin who also owns that Agent; another user's Agent is rendered read-only,
  and grant removal uses the same dual authorization gate.
- Agent auto-publish revalidates the live Credential binding, Agent/owner, Grant, Space policy,
  canonical role ceilings, derived scopes, and item-domain scopes after acquiring row
  locks in the publication transaction. Sixteen revoke, expiry, deactivation, deletion,
  role/scope, switch, policy, and domain-gate races fall back to `pending_review` without
  writing a page. MCP and background ingestion pass the same Agent/Credential identity
  into this final check.

`git diff --check` passed. The changed-file secret scan found only documented placeholder
URLs and synthetic test fixtures; no environment file, API key, connection code, private
key, or live credential was added.

## Repeated defect audit

Four independent review passes after the original implementation fixed the following
additional issues before convergence:

- Publisher manual Credential/Grant writes now persist their required Agent switches in
  the same transaction; exchange receipt replay also rejects a deleted Space.
- Reader onboarding fails closed when pull support is unavailable. The onboarding token
  remains available until the post-install checkpoint is durable, and a resumed durable
  checkpoint removes a token left by a crash.
- Bootstrap installation verifies the confirmed created-Space and Agent names as well as
  IDs, role, scopes, and package version.
- The UI discards generated instructions when Space/role changes and repairs a stale Space
  selection before issuing a request.
- Grant upsert/removal revalidates live Agent ownership, owner state, Space administration,
  and platform-admin override inside its database transaction; Grant mutation and its
  audit record commit together. Manual Agent Credential creation does not exist.
- A connection bound to one Space no longer receives MCP diagnostic grants, Credentials,
  or recent-call audit records from another Space; the latter is filtered by the current
  Credential identity.
- The unified role selector now initializes from the selected Space's existing Grant and
  does not silently propose a downgrade to Reader or overwrite an in-progress role choice
  during an equivalent parent rerender.
- The disk-backed Local Sync lock tests now wait for actual critical-section entry and use
  an explicit 20-second I/O test budget, eliminating false failures under clean-install load
  without weakening the production lock timeout.

The final no-find pass re-read the active DTO, controller, authorization, exchange,
onboarding, installation, and UI paths and found no further defect worth changing. Fresh
full verification was then repeated rather than relying on an earlier green run.

## Single-entry authorization correction

A production screenshot exposed that the original role migration had not changed the
actual product model: Agent detail still presented separate editable Space Grant,
connection, and Credential controls. The correction now enforces one product authorization
surface:

- Agent detail contains exactly one editable `Space + role` selector in the connection card;
- connection exchange atomically creates/updates the Space Grant and binds an identity-only Credential;
- existing Space authorizations and connection records are read-only diagnostics with
  remove/revoke actions; Credential diagnostics nest the live bound authorization instead
  of exposing a second flat role/scopes model;
- the server no longer exposes `POST /agents/:id/credentials` or its DTO/service path;
- smoke and cross-machine E2E fixtures obtain credentials only through connection exchange;
- user and security documentation no longer describes a separate API-key authorization path.

The corrected UI was exercised against an isolated migrated PostgreSQL database in the
real local application. Desktop and 390x844 browser checks each found one role selector,
zero manual Grant/Credential buttons, no horizontal overflow, and no console warning or
error. Generating an Editor instruction produced one connection instruction block. The
temporary QA user, Space, Agent, connection, and database were removed after validation.

The first full suite after this correction caught a shared guide-title regression. The
component now keeps the global `AgentWiki unified gateway` title while Agent detail passes
its specific `Agent access and authorization` title. Targeted tests and the complete fresh
suite passed after that repair. A final copy scan also found and corrected two stale guide
statements that still described manual Credential creation.

## External release result

The authorized release completed on 2026-08-23:

- GitHub `master`: `d88e93036e00598e326421a03aa4a889406b49b9`;
- npm `@neomei/agentwiki-sync-protocol@0.2.0` and
  `@neomei/agentwiki-local-sync@0.5.0` published, followed by registry clean-install and
  installed CLI verification;
- production applied all 40 migrations and advertises local-sync 0.5.0 / protocol 0.2.0;
- all 633 deployment-managed tracked files matched local SHA-256 content, and no AppleDouble
  files remained;
- API, Worker, and Frontend user services were active with zero restarts and no error-level
  journal entries after the final switch;
- public health reported database, Redis, and audit persistence `ok`;
- public HTTP/MCP smoke returned `{"status":"passed","checks":31}` and covered live role
  downgrade/restore, Editor proposal to `pending_review`, Agent approval denial, human
  publication, diagnostics isolation, and disposable fixture cleanup;
- an authenticated production browser showed the primary `Connect Obsidian` navigation
  entry, the single unified gateway action, exactly Reader/Editor/Publisher role choices,
  and no independent Credential authorization control.

Verified rollback artifacts are the PostgreSQL custom dump
`/root/backups/agentwiki/pre-unified-agent-access-0.5.0-20260823-190857.dump` (SHA-256
`8e1dc8a5cbbf43eef4bda5425870ed5f6073e6dccf6c848bdc72c5ad5263f6ec`) and application
archive `/root/backups/agentwiki/pre-unified-agent-access-0.5.0-20260823-190857-app.tar.gz`
(SHA-256 `a649e6bef312f3a5c886503b2619dd13cfabd35c8febd7209047dcd5587c171a`). Rollback still
requires restoring this database/application pair together.

Release validation also found and fixed two issues before final convergence: macOS
AppleDouble/xattr archive pollution (`888113f`, `ba2bd72`) and AuditService draining before
Redis initialization (`d88e930`). The final production switch had neither condition.
