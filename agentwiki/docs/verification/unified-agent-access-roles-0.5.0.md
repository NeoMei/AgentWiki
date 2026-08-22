# Unified Agent access roles 0.5.0 local verification

## Result

Local release verification passed on 2026-08-23 (Asia/Shanghai) for application
candidate commit `b735112`. The evidence-only
documentation commit follows this candidate and does not change runtime source. No push,
npm publish, production deployment, migration application, service restart, live
connection change, or real OpenCode acceptance was performed.

- Node: `v24.18.0`
- pnpm: `11.9.0`
- Application/local-sync/onboarding version: `0.5.0`
- Shared sync-protocol package version: `0.2.0`
- Agent roles: exactly `reader | editor | publisher`
- Local candidate branch: `codex/unified-agent-access-roles`

## Build and full repository tests

Command:

```bash
pnpm build && pnpm test
```

Result: exit 0. All workspace packages built, then the root test chain passed:

| Suite | Result |
| --- | --- |
| Runtime contracts | 84 passed, 0 failed, 47 skipped |
| Server Jest | 64 suites, 761 tests passed |
| Client Vitest | 45 files, 224 tests passed |
| Sync protocol Vitest | 6 files, 25 tests passed |
| Local Sync Vitest | 59 files, 732 tests passed |

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

Migration `20260822120000_unify_agent_access_roles` was also inspected directly:

- it creates only `reader`, `editor`, and `publisher`;
- `AgentCredential.role` is added `NOT NULL DEFAULT 'reader'`;
- every legacy `AgentGrant.role` is converted through the constant expression
  `USING ('reader'::"AgentAccessRole")`;
- the migration contains no `CASE`, `WHEN`, or scopes-based inference.

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
Local Sync 59 files / 732 tests. Audited artifacts:

- sync-protocol: `neomei-agentwiki-sync-protocol-0.2.0.tgz`, 48 entries, 27343
  bytes, SHA-256 `796f9e682b6ee75b9452fff8a49f83f04f57bc747a15fe659ee3674ada101ef8`
- local-sync: `neomei-agentwiki-local-sync-0.5.0.tgz`, 151 entries, 147712 bytes,
  SHA-256 `451435b9e9ac28fcfa8412a691ff5e1d75063a856a1099a51ae50b987885a2cd`

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
- Agent auto-publish revalidates the live Credential, Agent/owner, Grant, Space policy,
  canonical role ceilings, stored scopes, and item-domain scopes after acquiring row
  locks in the publication transaction. Sixteen revoke, expiry, deactivation, deletion,
  role/scope, switch, policy, and domain-gate races fall back to `pending_review` without
  writing a page. MCP and background ingestion pass the same Agent/Credential identity
  into this final check.

`git diff --check` passed. The changed-file secret scan found only documented placeholder
URLs and synthetic test fixtures; no environment file, API key, connection code, private
key, or live credential was added.

## External release gate (read-only snapshot)

Read-only checks on 2026-08-23 showed:

- `origin/master`: `c06b9b83b8039a24722cb0a6ce4e1686809c6bf7`
- npm `latest` for `@neomei/agentwiki-sync-protocol`: `0.1.0`
- npm `latest` for `@neomei/agentwiki-local-sync`: `0.4.0`
- production `/api/health`: database, Redis, and audit persistence all `ok`
- production `/api/onboard`: advertises `0.4.0`
- production commit: unavailable through current read-only access because SSH
  authentication was not available; no credential prompt or mutation was attempted

Therefore local candidate, GitHub, npm, and production are intentionally not aligned yet.
Before any authorized release, create and verify both a PostgreSQL custom-format backup
and an application rollback archive. Publish the audited sync-protocol 0.2.0 artifact
before local-sync 0.5.0 and repeat the registry clean-install check. The 0.5.0 protocol is
breaking and rollback requires restoring the matching database and application pair; a
schema-only downgrade is not supported. After release, the separate real OpenCode Editor
acceptance must still prove that a page proposal enters `pending_review` and Agent approval
fails.
