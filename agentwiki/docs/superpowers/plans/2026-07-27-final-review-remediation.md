# AgentWiki Final Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every validated final-review finding without weakening AgentWiki authorization, provenance, auditability, data preservation, localization, or Node 26 constraints.

**Architecture:** Apply focused RED→GREEN patches at the existing service/UI boundaries. Preserve deployed Prisma migration checksums; use a new forward migration for legacy PAT removal and a separately tested recovery tool for data that can only come from the migration backup. Rebuild the Codebase Memory graph only after generated twins are removed.

**Tech Stack:** Node.js 26.5.0, pnpm 11.9.0, NestJS/Jest, React/Vitest, Prisma/PostgreSQL, codebase-memory-mcp 0.9.0.

## Global Constraints

- Do not edit already-applied migration files.
- Every behavior/security fix must show a focused failing test before production changes and a passing test afterward.
- Remote E2E or smoke execution requires explicit opt-in; defaults must stay on `127.0.0.1`.
- No local credentials, backup contents, reference repositories, dependencies, generated output, or recovery data may enter Git or the code graph.
- User-visible copy must remain complete in Chinese and English.

---

### Task 1: Protect review rollback and security controls

**Files:**
- Modify: `agentwiki/apps/server/src/review/review.service.ts`
- Modify/Test: `agentwiki/apps/server/src/review/review.service.spec.ts`
- Modify: `agentwiki/apps/server/src/core/security/rate-limit.guard.ts`
- Create/Test: `agentwiki/apps/server/src/core/security/rate-limit.guard.spec.ts`
- Modify: `agentwiki/apps/server/src/core/security/audit.service.ts`
- Create/Test: `agentwiki/apps/server/src/core/security/audit.service.spec.ts`

- [ ] Add failing tests proving an old ChangeSet cannot revert pages/relations changed later, while an unchanged published resource can still revert.
- [ ] Make every page/relation revert conditional on ownership by the reverting ChangeSet; throw `CHANGESET_CONFLICT` when any conditional mutation affects zero rows.
- [ ] Add failing tests proving random `x-api-key` values cannot rotate auth-route rate-limit identity and that legitimate non-auth API-key requests keep the higher credential bucket.
- [ ] Key `/api/auth/*` only by normalized client IP; retain hashed key buckets only outside auth routes.
- [ ] Add a failing test proving audit persistence rejection is surfaced; change `AuditService.record` to log and rethrow so sensitive operations cannot report success with a silent audit hole.
- [ ] Run focused Jest tests, server typecheck, lint, and full server tests; commit `fix: protect review and security invariants`.

### Task 2: Repair legacy credential and data recovery paths

**Files:**
- Modify: `agentwiki/apps/server/prisma/schema.prisma`
- Create: `agentwiki/apps/server/prisma/migrations/20260727010000_remove_legacy_user_api_key/migration.sql`
- Create: `agentwiki/scripts/recover-legacy-document-data.mjs`
- Create/Test: `agentwiki/scripts/recover-legacy-document-data.test.mjs`
- Modify: `design/OPERATIONS.md`

- [ ] Write failing runtime tests for deterministic legacy snapshot/source-version/page-provenance recovery planning, whitespace-normalized memory hashes, and refusal to run without distinct source/target database URLs.
- [ ] Add a forward migration that clears and drops deprecated `User.apiKey`; remove the field from Prisma without changing old migration files.
- [ ] Implement a dry-run-by-default recovery CLI that reads `DocumentGenerationJob`, `CodebaseSnapshot`, and Page job links from a separately restored pre-migration database, writes SourceVersion/SourceFileSnapshot/Evidence/Page provenance to the target in idempotent transactions, and requires `--apply` for writes.
- [ ] Add an idempotent forward SQL repair for legacy memory hashes using trim + whitespace collapse before enforcing uniqueness; document conflict reporting instead of destructive deduplication.
- [ ] Document backup restore → dry-run → apply → counts/provenance verification in `OPERATIONS.md` without embedding credentials.
- [ ] Run runtime tests, Prisma validate/generate, migration status against local PostgreSQL, server typecheck/tests; commit `fix: preserve legacy credential and source history`.

### Task 3: Isolate local development and prevent UI state loss

**Files:**
- Modify/Test: `agentwiki/apps/client/src/features/page/PageEditor.tsx` and a focused spec
- Modify/Test: `agentwiki/apps/client/src/features/review/ReviewPage.tsx` and a focused spec
- Modify: `agentwiki/apps/client/vite.config.ts`
- Modify: `agentwiki/apps/client/playwright.config.ts`
- Modify: `agentwiki/apps/client/e2e/editor-language.spec.ts`

- [ ] Add failing tests proving a remote edit cannot overwrite a dirty local draft and post-action Review detail is refreshed.
- [ ] Preserve dirty local content on remote updates, show a bilingual conflict notice, and provide explicit accept-remote/keep-local actions.
- [ ] After review item/action mutation, refetch the currently expanded ChangeSet detail before rendering further actions.
- [ ] Default Vite API/WebSocket proxy and Playwright base URL to `127.0.0.1`; require `ALLOW_REMOTE_E2E=true` for non-loopback E2E targets.
- [ ] Run focused Vitest, client typecheck, client tests/build; commit `fix: isolate local UI workflows`.

### Task 4: Reconcile docs, localization, lint, and graph cleanliness

**Files:**
- Rewrite: `DEVELOPMENT_HANDBOOK.md`, `MIGRATION_README.md`
- Modify: affected client pages and `agentwiki/apps/client/src/i18n/messages.ts`
- Modify: files with unused-import lint warnings
- Move local generated twins out of product tree
- Modify: `agentwiki/.codebase-memory/graph.db.zst`
- Update: `.codex-memory/current.md` and this task's memory files

- [ ] Replace stale handbook/migration instructions with current React/Vite + NestJS, two-layer memory, external Git metadata, secret-safe source-deploy guidance; eliminate historical unchecked tasks or mark them archived.
- [ ] Add shared bilingual mappings for source/run/review/agent status and type enums; use them in Sources, Runs, AgentDetail, and Review pages.
- [ ] Remove all ten unused-import warnings and make lint output zero-warning without changing the configured warning severity.
- [ ] Move `vite.config.js` and `packages/shared/src/index.js` into `.stale-node-modules/generated-js-20260727/`, delete/rebuild the canonical graph, explicitly prove both paths plus dependency/build/reference paths are absent, and normalize the project name only if the upstream bug still requires it.
- [ ] Scan every tracked Markdown file for active unchecked tasks, excluding only explicit templates/archived historical documents.
- [ ] Run lint/typecheck/tests/build and graph verification; commit `chore: close final review findings`.

### Task 5: Final verification and task closure

- [ ] Re-run Node 26 runtime, lint, typecheck, all Jest/Vitest, production builds, Prisma validate/migration status, recovery dry-run tests, graph cleanliness/service discovery, tracked-Markdown task scan, secret scan, and Git status.
- [ ] Update current memory with exact fresh counts and any external recovery execution still required.
- [ ] If the pre-migration backup is locally reachable, run recovery dry-run and verified apply against an isolated restored database; never target production without a fresh backup and explicit deployment authorization.
- [ ] Archive `final-review-remediation` only when every locally verifiable gate passes; otherwise keep it active with the exact external blocker.
- [ ] Commit final evidence as `docs: record final remediation verification` and run a final whole-branch review.
