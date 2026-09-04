# AgentWiki Release Readiness Audit Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and repair the repository across Windows local sync, server, client, and rendered UI until repeated review and test rounds reveal no actionable defects.

**Architecture:** Keep audits separated by subsystem so findings can be reproduced independently, then integrate through root-level build, typecheck, lint, and test gates. Product-code fixes must start with a failing regression test; platform-only test assumptions may be corrected only after proving the product behavior is already valid.

**Tech Stack:** pnpm workspace, TypeScript, NestJS/Jest, React/Vite/Vitest, Playwright, Prisma/PostgreSQL, Redis, in-app Browser.

## Global Constraints

- Preserve all pre-existing changes under `测试报告/` and all unrelated dirty-worktree files.
- Do not commit or push without an explicit user request.
- Use Windows-native execution and paths for this acceptance run.
- Run rendered UI checks through the in-app Browser before any Playwright fallback.
- Repeat review and validation after every actionable fix; finish with a fresh full gate.

---

### Task 1: Establish the acceptance baseline

**Files:**
- Read: `package.json`
- Read: `apps/client/package.json`
- Read: `apps/server/package.json`
- Read: `packages/local-sync/package.json`

**Interfaces:**
- Consumes: workspace scripts and current dirty-worktree state.
- Produces: exact test matrix and preserved-file boundary for all later tasks.

- [x] Run `git status --short` and record user-owned files that must remain untouched.
- [x] Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`, recording every failure with its owning subsystem.
- [x] Run `pnpm --filter @agentwiki/client exec playwright test --list` to verify the UI suite can be collected (25 tests in 7 files).

### Task 2: Review and test the server and shared protocol

**Files:**
- Review: `apps/server/src/**/*.ts`
- Review: `packages/shared/src/**/*.ts`
- Review: `packages/sync-protocol/src/**/*.ts`
- Test: colocated `*.spec.ts` files in those directories.

**Interfaces:**
- Consumes: HTTP DTOs, authorization boundaries, persistence services, sync contracts.
- Produces: server and protocol behavior that passes unit, type, lint, and build gates.

- [x] Search for unsafe path handling, missing authorization checks, swallowed errors, unbounded input, race-prone writes, and platform assumptions.
- [x] For each confirmed defect, add the smallest colocated regression test and run it to observe the expected failure.
- [x] Implement the minimal product fix and rerun the focused test until green.
- [x] Run `pnpm --filter @agentwiki/server test` and `pnpm --filter @neomei/agentwiki-sync-protocol test`.

### Task 3: Review and test the client

**Files:**
- Review: `apps/client/src/**/*.ts`
- Review: `apps/client/src/**/*.tsx`
- Test: colocated `*.spec.ts`, `*.spec.tsx`, and `*.test.tsx` files.

**Interfaces:**
- Consumes: server API contracts and browser-visible state.
- Produces: accessible, error-safe client behavior with passing unit tests.

- [x] Review navigation, authentication redirects, async loading/error states, modal focus, form submission, and responsive layout logic.
- [x] For each confirmed defect, add and run a failing Vitest regression before editing production code.
- [x] Implement the minimal fix and rerun the focused test.
- [x] Run `pnpm --filter @agentwiki/client test`, client TypeScript compilation, and client build.

### Task 4: Re-review Windows local sync changes

**Files:**
- Review: `packages/local-sync/src/**/*.ts`
- Test: `packages/local-sync/src/**/*.spec.ts`

**Interfaces:**
- Consumes: Windows filesystem, process spawning, onboarding, CodeGraph, and adapter behavior.
- Produces: a second independent review of the current Windows fixes and a green 878-test suite.

- [x] Inspect the complete unstaged local-sync diff for security regressions, legacy-format compatibility, race handling, and test-only seams.
- [x] Reproduce and test any confirmed issue before fixing it.
- [x] Run `pnpm --filter @neomei/agentwiki-local-sync test`, typecheck, and build.

### Task 5: Exercise end-to-end and rendered UI flows

**Files:**
- Test: `apps/client/e2e/*.spec.ts`
- Read: `scripts/*e2e*` and `scripts/*smoke*`

**Interfaces:**
- Consumes: a locally running client/server and test data supported by repository scripts.
- Produces: browser evidence for page load, console health, primary navigation, authentication/onboarding, editor, and responsive behavior.

- [x] Determine whether local PostgreSQL/Redis services and required environment variables are available without mutating external systems.
- [ ] Start the supported local stack and verify health endpoints. Blocked: this Windows host has no PostgreSQL, Redis, Docker, or configured database environment.
- [ ] Run the repository Playwright suite against the exact local target when its prerequisites are available. Blocked: the collected suite creates authenticated database-backed fixtures and cannot run safely without those prerequisites.
- [x] In the in-app Browser, verify `app loads -> first meaningful screen renders -> primary visible controls respond without runtime errors` at desktop and mobile widths.
- [x] Capture page identity, DOM, console warnings/errors, screenshot evidence, and post-interaction state.
- [x] For each rendered defect, add a failing component or Playwright test, fix it, reload, and repeat the failed interaction (no additional rendered defect remained in the final pass).

### Task 6: Repeat independent reviews and final gates

**Files:**
- Review: all files changed from the baseline.
- Verify: entire workspace.

**Interfaces:**
- Consumes: integrated fixes from Tasks 2-5.
- Produces: final evidence-backed completion report and explicit remaining environmental limits, if any.

- [x] Request independent code reviews for server/protocol, client/UI, and Windows local sync changes; resolve every Critical or Important finding.
- [x] Perform a second root-agent diff review for correctness, security, portability, and unintended scope.
- [x] Run production and full dependency audits; remove the unpatched `image-size` parser and pin patched `fast-uri`, `qs`, and `browserslist` versions until `pnpm audit` reports no known vulnerabilities.
- [x] Run a second full `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and applicable Playwright/end-to-end commands.
- [x] Run `git diff --check` and confirm all user-owned report files remain outside this task's edits.
- [x] Report exact pass counts, UI evidence, repaired defects, and any test that could not run with its concrete prerequisite.
