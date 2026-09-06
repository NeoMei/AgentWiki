# Composite Templates 0.9.0 Release Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Publish the approved composite-template implementation as AgentWiki 0.9.0 with sync-protocol 0.6.0, then safely deploy and verify production.

**Architecture:** Keep the reviewed product implementation unchanged. Prepare synchronized versions and immutable packages; production rollout follows authenticated preflight, coordinated database/attachment backup, forward migration and explicit Space allowlisting.

**Tech Stack:** Node 24, pnpm 11.9, TypeScript, NestJS, React, Prisma/PostgreSQL 16, systemd, npm and GitHub.

**Spec:** User instruction “发布”; feature semantics remain defined by `docs/superpowers/specs/2026-09-05-composite-page-group-agent-collaboration-templates-design.md`.

## Global Constraints

- Work only in `/Users/neomei/.codex/worktrees/69d8/AgentWiki ` (trailing space), application subdirectory `agentwiki`.
- Every Git operation must explicitly set this worktree; shared core.worktree points elsewhere. Preserve main-checkout user files, submodules and other sessions.
- Root, server, client, local-sync and onboarding pins become 0.9.0. Sync-protocol and local-sync's exact protocol dependency become 0.6.0. Do not change historical verification records.
- Do not alter product behavior, feature permissions, template contents or migration SQL in version preparation.
- Only the controller publishes, pushes, merges or accesses production. Workers never spawn subagents.
- Never print secrets. No production writes before target verification and a reviewed coordinated backup/restore procedure. App-only rollback after schema migration is forbidden.
- Composite templates require explicit Space IDs; wildcard rollout and automatic privilege expansion are forbidden.
- Distinguish local verification, registry publication, GitHub release, deployment and real UI acceptance.

### Task 1: Prepare synchronized versions and package evidence

**Files:**
- Modify: `package.json`, `apps/server/package.json`, `apps/client/package.json`, `packages/local-sync/package.json`, `packages/sync-protocol/package.json`, `pnpm-lock.yaml`.
- Modify: `.env.example`, `apps/server/.env.example`, current onboarding version constants in `apps/server/src/onboard`, and `scripts/node-runtime-contract.test.mjs`.
- Create: `docs/verification/composite-v090-release.md` containing release notes and verified local evidence only.
- Test: `scripts/node-runtime-contract.test.mjs`, existing repository and packaging gates.

**Interfaces:** Consumes reviewed HEAD 7c969d6bd5d23d3717c32a05bc74b84e87cf89bd. Produces a committed, clean, versioned source candidate and report with exact test outputs; no registry mutations.

- [ ] Update runtime contract expectations first: app versions and onboarding regex/string `0.8.0` to `0.9.0`, protocol expectations `0.5.1` to `0.6.0`; run `node --test scripts/node-runtime-contract.test.mjs` and capture expected version-mismatch RED.
- [ ] Apply the same new values to current manifests, exact dependency, environment defaults and onboarding constants. Discover current-version references with `rg -n '0\\.8\\.0|0\\.5\\.1'` and update active installation guidance only where needed; retain historical evidence and compatibility fixtures. Use apply_patch, not broad replacement.
- [ ] Run `pnpm install --lockfile-only` then `pnpm install --frozen-lockfile`; retain workspace protocol resolution without a registry dependency on the unpublished version.
- [ ] Run `pnpm --filter shared build`, `pnpm --filter @neomei/agentwiki-sync-protocol build`, focused runtime test, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- [ ] Verify dedicated Docker containers `agentwiki-composite-69d8-db` and `agentwiki-composite-69d8-redis` expose loopback ports 50415 and 50416. Run full tests once with DATABASE_URL, FOLDER_TEST_DATABASE_URL, MARKDOWN_TEST_DATABASE_URL, COLLABORATION_TEST_DATABASE_URL, PAGE_TEMPLATE_TEST_DATABASE_URL and SYNC_V3_TEST_DATABASE_URL all set to `postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test`; TEST_REDIS_URL=`redis://127.0.0.1:50416/0`; PG_DUMP_BIN=`/opt/homebrew/opt/postgresql@16/bin/pg_dump`; PSQL_BIN and AGENTWIKI_PSQL_BIN=`/opt/homebrew/opt/postgresql@16/bin/psql`. Command: `pnpm test:full`. No shared/production DB tests.
- [ ] Run `pnpm test:package:local-sync-clean-install` and `pnpm test:release:sync-v3-registry`. Check public registry protocol 0.6.0 is absent, without treating a network error as absence. Registry protocol parity and registry-dependent install are post-publication controller gates, not expected pre-publication passes.
- [ ] Write local release evidence, limitations and package commands; self-review diff and commit `chore(release): prepare AgentWiki 0.9.0 and protocol 0.6.0`. Report full commands/counts/log paths, expected warnings and any blockers.

### Task 2: Controller publication and protected production rollout

**Files:** Update `docs/verification/composite-v090-release.md` with observed evidence; no new product implementation.

**Interfaces:** Consumes Task 1 candidate after task and final release-delta reviews. Produces independently verified npm artifacts, GitHub source/tag/release and production acceptance, or an exact partial-state handoff.

- [ ] Confirm GitHub/npm authentication and immutable candidate versions; restore SSH authentication to `root@113.249.120.24` before irreversible publication. Do not request passwords in chat.
- [ ] Inspect `/root/agentwiki`, current application/version, migration history, PostgreSQL target, attachment root, unit hardening/drop-ins, available disk and current Space IDs using redacted read-only output.
- [ ] Review deployment/backup commands before execution. Require coordinated custom-format DB dump, attachment snapshot+manifest and SHA-256 checks, application archive and systemd units/drop-ins while writers are quiesced. Backups must be retained and restore commands explicit. Preserve runtime hardening.
- [ ] Publish protocol 0.6.0 first; verify `pnpm test:release:sync-protocol-registry-parity`. Then run `pnpm test:package:local-sync-registry-protocol`, publish local-sync 0.9.0 and verify registry metadata and a clean installation of the published artifact.
- [ ] Recheck remote master ancestry and main user-file preservation before fast-forwarding/pushing. Create immutable tag `v0.9.0` and GitHub release from the exact verified source; no force push or tag overwrite.
- [ ] Build/preflight staged production release before stopping services. Back up the coordinated state before migrations; deploy explicitly to `113.249.120.24` as root, not deploy.sh defaults. Keep feature rollout on explicit canary/user Space IDs.
- [ ] Verify public health, authenticated API smoke and real Chrome flow: template categories, nested page-group creation, late Agent binding, collaboration setup and unchanged legacy single-page behavior. Use isolated release fixtures, never existing user pages. Clean up only this release's identified fixtures.
- [ ] Record exact commit, package versions, production state, backup/rollback points, test boundaries and remaining limitations. Release is complete only when all required outcomes are observed.
