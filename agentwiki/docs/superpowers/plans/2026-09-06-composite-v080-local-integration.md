# Composite templates and v0.8.0 local integration plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for the bounded integration task; the controller performs the already-authorized local-master fast-forward after review. Steps use checkbox syntax.

**Goal:** Integrate the reviewed composite-template feature with current origin/master v0.8.0, preserving both contracts, and merge the verified result into local master without publishing.

**Architecture:** Merge upstream into the existing feature worktree first. Resolve the seven known textual conflicts by composition and inspect automatically merged shared consumers. Existing immutable template/Page/Run/ChangeSet truths and upstream immutable Sync v3 publication/attachment semantics stay intact; no redesign.

**Tech Stack:** pnpm, TypeScript, NestJS, Prisma/PostgreSQL 16+pgvector, React/Vitest, Redis, real Chrome acceptance harness.

**Spec:** User authorization in this task: local merge option 1, followed by explicit authorization to integrate latest master, resolve cross-feature conflicts and repeat full acceptance. Existing composite spec is `docs/superpowers/specs/2026-09-05-composite-page-group-agent-collaboration-templates-design.md`; upstream integration contract is `origin/master` pinned below, especially `docs/contracts/agentwiki-obsidian-sync-api-v3.md` and `docs/operations/sync-v3-attachments.md`. Their behavior must be preserved together.

## Global Constraints

- Exact worktree `/Users/neomei/.codex/worktrees/69d8/AgentWiki ` and main checkout `/Users/neomei/项目/codexprojects/AgentWiki ` both end with a space. Every Git call must use explicit `--work-tree`; main operations also use explicit `-C`. Shared core.worktree must not be changed.
- Original feature tip `f4cf46524b1e5418e4f64109e739e8e9a0e04608`; upstream `ea56d75b2cf58b191022e84368f32b042cd38e6f` (v0.8.0), common base `711cae77277af1f79c6f4c16f998dbc66f6e2dae`. Controller's planning commit may follow the feature tip; preserve it.
- Work only in the current isolated worktree for implementation. Do not create another worktree, alter other active worktrees, or switch/update local master from a worker. Controller owns main checkout updates.
- Authorization now includes required Sync v3/attachment/composite integration edits and tests, but no unrelated redesign, package publication/version bump, push, force update, deployment, credential/account modification, production migration or paid-model replay.
- Preserve both `revertible` restrictions on v3-published ChangeSets and `collaborationArtifactLink` reviewPath/ordinary-entry protection. Preserve template atomicity, live authority at Page approval, exact idempotency, ordinary unbound Pages and task-derived participants.
- Never choose entire ours/theirs files as a substitute for resolving both contracts. Do not rewrite already released upstream migrations or remove new feature constraints to make schema gates pass.
- Existing main checkout has dirty submodules and untracked documents. Preserve all; no stash/clean/reset, submodule update or deletion. Current feature source is clean except controller planning/records; stage exact paths only.
- Tests use only dedicated `postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test` and Redis `redis://127.0.0.1:50416/0`; verify current Docker ports. All six DB aliases must be explicit and helpers generate random schemas; never migrate/clean shared public. PG16 dump/psql paths under `/opt/homebrew/opt/postgresql@16/bin/`.
- Old feature 4861-pass/Chrome4 evidence is baseline only, not evidence for the merged tree. Record fresh exact exit codes/pass/skip counts, expected negatives, and schema/process/public cleanup. Current public inventory digest `887e5d38ed14a3945866940b88cb74236e4f56f7636235f53d289095ba0ef73b`.

### Task 1: Resolve the merged feature and verify both contracts

**Files:**
- Resolve `apps/client/src/features/review/ReviewPage.tsx`, `apps/server/src/review/review.service.ts`, `packages/sync-protocol/src/index.ts`, `scripts/collaboration-schema-db.test.mjs`, `scripts/content-tree-core-db.test.mjs`, `scripts/folder-test-database.mjs`, `scripts/server-test-harness.mjs` (all relative to agentwiki).
- Inspect automatically merged shared consumers: PageEditor plus its tests, ReviewPage/service tests, i18n, Prisma schema, content-tree service, business-error, content-tree consumer DB and server-test-harness tests.
- Add covering cases in existing ReviewPage/review.service tests and appropriate existing real DB/HTTP integration files; modify additional files only when actual integration evidence requires it.
- Create `docs/verification/composite-v080-local-integration.md` with immutable parents, resolutions, test commands/outcomes, browser evidence, limits, and cleanup.

**Interfaces:** Consumes two already reviewed feature sets at the pinned parents. Produces a merge commit (plus narrowly scoped fixes if needed) that is descendant of both, exact merged behavior evidence, and a report for independent pre-merge review.

- [ ] Confirm worktree/branch/status and both immutable parent SHAs. Read relevant specs/skills, then merge upstream in the feature worktree:

```sh
git --work-tree='/Users/neomei/.codex/worktrees/69d8/AgentWiki ' merge --no-ff --no-commit ea56d75b2cf58b191022e84368f32b042cd38e6f
git --work-tree='/Users/neomei/.codex/worktrees/69d8/AgentWiki ' diff --name-only --diff-filter=U
```

- [ ] Record conflict evidence before edits. Resolve seven conflicts with apply_patch. ReviewService must return both the live upstream `revertible` value and collaboration Link with reviewPath. ReviewPage must hide ordinary publish for linked artifacts and hide revert when `revertible === false`. Protocol exports must include both new composite and upstream APIs. Database helpers/inventories must preserve all upstream migrations and all composite migrations, exact alias isolation and no-skipped-DB gates; remove assumptions that a single feature migration is globally last.
- [ ] Add focused semantic regressions before behavioral correction where practical, recording valid failing assertions. Cover response `{revertible:false, collaborationArtifactLink:{reviewPath}}` together and UI published-v3 no-revert plus linked-approved no-ordinary-publish. Preserve ordinary legacy allowed cases. Run the named server/client focused tests and actual migration/integration DB gates; raw conflict-marker compile failure alone is not semantic TDD evidence. Document any test fixture adaptation separately from behavioral RED.
- [ ] Inspect automatic merge interactions including schema, revision effects and package lock/version integrity. Use `pnpm install --frozen-lockfile` only if required by upstream dependency metadata; no dependency upgrades or package bump. Keep independent composite exports out of Sync wire schemas.
- [ ] Reuse existing UI-only composite acceptance harness, read its instructions and named final-fix report for invocation. Run six real Chrome journeys including existing-page bindings, ordinary Pages, source-CAS, conflict publication, legacy/feature-off and mobile/English; keep exact HTTP/console provenance and persisted assertions. Verify merged ordinary-review UI/API respects both v3 no-revert and composite routing using a bounded existing fixture/regression. No paid-model repeat and no production data.
- [ ] At source freeze run the full sequential gate with all explicit prerequisites:

```sh
export DATABASE_URL=postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test
export FOLDER_TEST_DATABASE_URL="$DATABASE_URL"
export MARKDOWN_TEST_DATABASE_URL="$DATABASE_URL"
export COLLABORATION_TEST_DATABASE_URL="$DATABASE_URL"
export PAGE_TEMPLATE_TEST_DATABASE_URL="$DATABASE_URL"
export SYNC_V3_TEST_DATABASE_URL="$DATABASE_URL"
export TEST_REDIS_URL=redis://127.0.0.1:50416/0
export PG_DUMP_BIN=/opt/homebrew/opt/postgresql@16/bin/pg_dump
export PSQL_BIN=/opt/homebrew/opt/postgresql@16/bin/psql
export AGENTWIKI_PSQL_BIN="$PSQL_BIN"
pnpm typecheck && pnpm lint && pnpm build && pnpm test:full
```

- [ ] Inspect complete outputs, required upstream gates and unknown failures; repair only evidenced integration regressions with focused tests, then rerun affected/full gates as needed. Record all allowed skips explicitly; DB must have zero skips. Keep one heavy test/browser operation at a time.
- [ ] Verify zero conflict markers/unmerged index, precise staged paths, no unrelated .codex-memory staging, then commit the merge and narrowly required follow-ups. Self-review conflict resolution and automatic shared changes. Write ongoing `task-1-report.md` in this plan's SDD workspace early. Final report gives parents/commits, per-file resolution rationale, commands+RED/GREEN+logs, cleanup and remaining concerns. Return DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT. No subagents; controller owns review.

### Task 2: Controller review and authorized local-master update

**Files:** Existing project current/task records and a local integration verification record only; no controller product fixes.

**Interfaces:** Consumes Task 1 reviewed merge commit. Produces updated local master with verified main-checkout state, preserving all pre-existing user files.

- [ ] Generate immutable merge review package including both parent diffs/resolution surface; request independent integration review of specification compliance and code quality, including automatic shared-file composition and current test evidence. This is a new authorized integration gate, not reopening the original feature implementation. Handle concrete findings through bounded SDD review/fix loop.
- [ ] Recheck main checkout branch/status and record path/content/submodule status of pre-existing local changes without exposing secrets. Verify new merge is descendant of local master and pinned latest origin/master, and no touched-path overlap with user files. If unexpected overlapping work appears, stop rather than stash or overwrite it.
- [ ] Fast-forward local master from its explicit main checkout only after review:

```sh
git -C '/Users/neomei/项目/codexprojects/AgentWiki ' --work-tree='/Users/neomei/项目/codexprojects/AgentWiki ' merge --ff-only codex/composite-page-group-agent-collaboration
```

- [ ] On merged master rerun `pnpm test:full` with the same dedicated explicit environment (and frozen dependency install/build as required), inspect exact exit/counts, and verify preserved user file manifest and other worktree refs. No production environment fallback. If merged result fails, retain branch/worktree and diagnose before claiming completion.
- [ ] Update project handoff with actual local merge result and evidence. Preserve host-owned worktree and unique local proof artifacts; no forced cleanup. State local master SHA, test result and that remote/release/deployment remain unchanged.

## Bounded upstream advance observed before local merge

During final review, another active task advanced `origin/master` to
`e0f7acaf0b6cbbeb8bc56f33e5da2991a9b40991` through published PR9. Relative to the
original pinned v0.8.0 parent, it changes only two executable expressions in
`sync-v3-revision.service.ts`, their tests, and two hotfix documents: preserve a
persisted root Folder's null parent and serialize Prisma dates for the strict
legacy Space-list projection. There is no migration, wire-schema, dependency,
version, or UI change. Read-only merge-tree against reviewed `fe99a4ac` is clean.

This is a bounded continuation of the user's authorized latest-master integration,
not authorization to modify the other task or deploy its code again. The sole
integration worker may merge this exact upstream commit, run the affected service
and real Sync v3 HTTP tests plus the final full gate, and document the new source
identity. An exact incremental independent review precedes controller-owned main
FF and main-checkout full verification. Preserve all prior review/evidence; no
reopening of unchanged product work or paid-model/Chrome replay is required for
this non-UI delta. Further upstream movement is reported separately instead of
indefinitely extending this snapshot.
