# AgentWiki Technical Debt Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task.

**Goal:** Resolve all actionable technical debt in this AgentWiki repository, integrate valuable local work into `master`, and leave one tested, published, deployable mainline.

**Architecture:** Preserve the existing monorepo and Sync v2 compatibility while merging the additive Sync v3 protocol, schema, attachment-version, reference-parsing, and server orchestration layers. Treat release evidence as separate gates for GitHub, npm, production services, and browser-visible behavior.

**Tech Stack:** pnpm workspace, TypeScript, NestJS, Next.js, Prisma/PostgreSQL with pgvector, Redis, Node test runner, Playwright, Docker, GitHub/npm.

**Spec:** `docs/superpowers/specs/2026-09-05-technical-debt-consolidation-design.md`

---

### Task 1: Stabilize the existing mainline baseline

- [x] Reproduce the full-suite onboarding timing failure.
- [x] Replace parent-process pipe timing with child event-time verification.
- [x] Add sufficient fixture timer margin to satisfy the one-second behavior contract.
- [x] Run the focused test repeatedly and the complete fixture test.
- [ ] Commit the isolated regression fix.

### Task 2: Integrate the valuable Sync v3 branch

- [ ] Reconfirm the branch base, commit range, migration order, and virtual-merge cleanliness.
- [ ] Merge `codex/referenced-image-sync-v3` with history preserved.
- [ ] Run protocol, migration, parser, server, and compatibility tests immediately after merge.
- [ ] Review every merge overlap for semantic—not merely textual—conflicts.

### Task 3: Close test-harness and release-contract gaps

- [ ] Add a failing harness test proving `SYNC_V3_TEST_DATABASE_URL` is mandatory for full runs.
- [ ] Add the prerequisite and isolated-schema guidance; verify fail-closed and success paths.
- [ ] Review package dependency edges and assign a correct semantic version to changed public protocol APIs.
- [ ] Verify `pnpm pack` contents and public import behavior from the tarball.

### Task 4: Repeat code review and fix actionable findings

- [ ] Review database invariants, transactional boundaries, revision ordering, idempotency, limits, authorization, and error mapping.
- [ ] Review protocol validators/types for compatibility and malformed-input behavior.
- [ ] Review frontend call sites and legacy Sync v2 behavior.
- [ ] For each actionable finding, add a failing test, implement the smallest fix, and rerun the relevant suite.
- [ ] Repeat the review after fixes until no actionable finding remains.

### Task 5: Execute full functional and UI verification

- [ ] Run lint, typecheck, unit/integration tests, database tests, build, audit, and `git diff --check` with fresh output.
- [ ] Start the real local stack against Docker PostgreSQL/Redis and apply migrations from a clean database.
- [ ] Exercise backend health/auth/sync endpoints, including v2 compatibility and v3 attachment behavior.
- [ ] Use Playwright in a real browser for primary navigation and affected UI flows; inspect browser console/network failures.
- [ ] Fix and retest any discovered defects; repeat until clean.

### Task 6: Consolidate documentation and local Git debt

- [ ] Compare readable-path local reports with the existing task-specific verification document and preserve only unique evidence.
- [ ] Update `.codex-memory/current.md` and active task records to current truth.
- [ ] Create recoverable refs or stashes for superseded dirty worktrees before cleanup.
- [ ] Remove obsolete worktrees/stashes/branches only after verifying their retained evidence and recovery path.
- [ ] Confirm no unmerged valuable commit or uncommitted source change remains.

### Task 7: Integrate and publish

- [ ] Merge the verified integration branch into local `master` without losing history.
- [ ] Rerun the full verification gate on the exact release commit.
- [ ] Push `master` and verify GitHub branch/PR state.
- [ ] Publish changed npm package versions and verify registry metadata/tarball.
- [ ] Deploy the exact release commit, run migrations safely, and verify public API plus browser-visible production behavior.
- [ ] Confirm local `master`, `origin/master`, published packages, and deployed revision are explicitly accounted for.

## Plan self-review

The plan keeps external Obsidian-plugin work outside this repository, makes every release surface independently verifiable, and requires recoverable cleanup rather than silent deletion. The main risk is a semantic Sync v2/v3 interaction after an old branch is merged; targeted compatibility tests precede the expensive full and UI gates.
