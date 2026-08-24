# Agent Collaboration Release Final Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `systematic-debugging`, `test-driven-development`, and `verification-before-completion`. Every validated defect must enter a RED -> GREEN regression cycle before the task is considered complete.

**Goal:** Prove that the Agent collaboration templates release candidate is complete, internally consistent, free of worthwhile known defects, and functional across backend, MCP, frontend, and rendered UI flows.

**Architecture:** Audit the committed release candidate from four independent boundaries: requirements and state documentation, collaboration domain execution, external Agent gateway/contracts, and rendered React workflows. Fix only reproduced defects at their source, then repeat review and verification until a clean round finds no remaining important or worthwhile issue.

**Tech Stack:** TypeScript, NestJS, Prisma/PostgreSQL, React/Vite, Vitest/Jest/Node test runner, Local Sync MCP gateway, in-app Browser.

## Global Constraints

- Git push, npm publication, and production deployment require explicit user authorization; the user has authorized this release-finalization chain.
- Preserve unrelated dirty subprojects and `agentwiki/.codebase-memory/`.
- Use only `COLLABORATION_TEST_DATABASE_URL` with random `collaboration_test_*` schemas; never migrate or write test fixtures into `public`.
- Preserve `AgentGrant.role` as the sole authorization fact and never grant Agents human review permission.
- Preserve Sync Protocol independent semver while server, client, onboarding, gateway, and Local Sync remain pinned to the corrected `0.6.1` release line.
- Preserve existing user changes in the separate `codex/agent-collaboration-workflows` worktree.

---

### Task 1: Requirements and task-state closure

**Files:**
- Review: `agentwiki/docs/superpowers/specs/2026-08-22-agent-collaboration-templates-design.md`
- Review: `agentwiki/docs/superpowers/plans/2026-08-22-agent-collaboration-templates-plan.md`
- Review: `.codex-memory/tasks/active/agent-collaboration-templates/brief.md`
- Modify if stale: `.codex-memory/current.md`, `.codex-memory/tasks/index.md`, task brief/decisions/refs

- [x] Map every confirmed requirement to implementation and fresh evidence.
- [x] Search active tasks, unchecked plan items, TODO/FIXME markers, incomplete acceptance rows, and version drift.
- [x] Repair only genuine state/documentation gaps and re-run exact consistency searches.

### Task 2: Backend execution and concurrency review

**Files:**
- Review: `agentwiki/apps/server/src/collaboration-workflows/**/*.ts`
- Review: `agentwiki/apps/server/prisma/migrations/*collaboration*`
- Test: `agentwiki/apps/server/src/collaboration-workflows/**/*.spec.ts`
- Test: `agentwiki/scripts/collaboration-schema-db.test.mjs`
- Test: `agentwiki/scripts/collaboration-workflows-db.test.mjs`

- [x] Trace run/task/attempt/review state transitions, authorization rechecks, idempotency, leases, generation invalidation, notification timing, and Serializable retry boundaries.
- [x] For each reproduced defect, write the smallest failing unit or real-PostgreSQL test and verify the expected RED failure.
- [x] Implement the root-cause fix, verify GREEN, and rerun collaboration server and database suites.

### Task 3: Shared contracts, MCP gateway, and release boundary review

**Files:**
- Review: `agentwiki/packages/sync-protocol/src/collaboration.ts`
- Review: `agentwiki/packages/local-sync/src/gateway/collaboration-*.ts`
- Review: `agentwiki/apps/server/src/collaboration-workflows/**/*.ts`
- Review: `agentwiki/package.json`, package manifests, onboarding/version surfaces

- [x] Compare REST DTOs, shared schemas, MCP tool inputs/outputs, and server behavior field by field.
- [x] Exercise all six Agent tools, malformed inputs, authorization changes, replay, waiting states, and external-reference normalization.
- [x] Verify the corrected `0.6.1` release surfaces and independent Sync Protocol `0.3.0` have no drift; reject and deprecate the broken `0.6.0` manifest.

### Task 4: Frontend code and rendered interaction review

**Files:**
- Review: `agentwiki/apps/client/src/features/collaboration/**`
- Review: `agentwiki/apps/client/src/api/**`
- Review: `agentwiki/apps/client/src/i18n/**` and shared language context usage
- Test: collaboration Vitest suites and real Browser flows

- [x] Review loading/error/empty/stale-response states, role mapping, expectedVersion refresh, review actions, Todo/artifact rendering, responsive layout, keyboard access, and Chinese/English copy.
- [x] Start the isolated API/Worker/frontend candidate and use the in-app Browser for page identity, DOM, console, desktop/mobile, and interaction checks.
- [x] Reproduce UI defects before changes, write a failing component test, implement the smallest fix, then repeat the exact Browser interaction.

### Task 5: Repeated clean review rounds and final gate

**Files:**
- Update: `agentwiki/docs/testing/collaboration-real-agent-acceptance.md`
- Update: project task/current records when the final state changes

- [x] Run independent code reviews of backend, frontend, and contracts/release boundaries; validate every reported finding against source and tests.
- [x] Repeat static review and rendered smoke after all fixes; stop only after a clean round finds no remaining important or worthwhile defect.
- [x] Run `git diff --check && pnpm lint && pnpm typecheck && pnpm build && pnpm test`.
- [x] Run the isolated PostgreSQL schema 2/2 and transaction 10/10 suites plus real API/Worker/Credential/MCP E2E.
- [x] Confirm zero `collaboration_test_*` schemas, inspect final diff/status, and report local/master/origin/npm/production states separately.

## Final Result

- Four review/remediation rounds completed. The final independent backend and frontend reviews found no remaining Critical or Important defect.
- Final fixes include live eligible reviewer validation and owner/admin recovery, review-graph deadlock rejection, authoritative `Review.canDecide`, current-run self-review confirmation after version refresh, immutable Todo failure audit, route/epoch stale-response protection, incremental history, and direct authorized Artifact reads.
- Fresh gates: Runtime 95 passed/50 environment-skipped; Server 1003 passed/3 skipped; Client 314/314; Sync Protocol 42/42; Local Sync 748/748; schema 2/2; real transactions 10/10; API/Worker/Credential/MCP E2E `PASS`; clean dual-tarball install and CLI startup `PASS`.
- Real browser acceptance passed registration, Space and Publisher Agent setup, all five templates, the three-step wizard, self-review confirmation, eight-task dashboard, Todo/review/Artifact/activity views, and a 390px viewport with no horizontal overflow or console error/warning.
- Implementation and release are complete. Git push, npm publication, public-registry verification, production deployment, and post-deploy acceptance all passed.

## Authorized Release Finalization Recheck (2026-08-24)

- After the user authorized the release chain, three additional task/code/security review rounds found and repaired two worthwhile defects with RED -> GREEN evidence: review-preview starvation across nodes, and stale WebSocket run-room membership after access revocation.
- The real npm publication gate then exposed a third release defect: `npm publish` preserved `workspace:0.3.0`, so `0.6.0` could not be installed from the public registry even though the pnpm-pack gate passed. Contract tests were first made RED, the manifest/gate/version surfaces were corrected to `0.6.1`, and a public-registry clean install plus CLI startup passed before `0.6.0` was deprecated.
- Fresh gates now pass at Runtime 95/50 environment-skipped, Server 1005/3 skipped, Client 316/316, Sync Protocol 42/42, Local Sync 748/748, schema 2/2, real transactions 10/10, HTTP/Worker/MCP E2E `PASS`, Prisma validate, lint, typecheck, build, diff check, dependency audit, and clean dual-package installation.
- Fresh Browser acceptance passed registration, Space/Agent setup, five templates, the coding-template wizard, six role assignments, the eight-task ordered-Todo dashboard, pause/resume, audit history, and the 390px layout. The document width stayed at 390px and the browser console contained no warning/error. Obsidian remains inside the Usage Guide and is absent from Space navigation.
- All temporary `collaboration_test_*` schemas and local API/frontend processes were removed after acceptance. The third review round found no additional worthwhile code defect.
- Production preflight confirmed the live `0.5.1/0.2.0` services and application database. A verified PostgreSQL custom dump and full application archive were created before deploying `0.6.1/0.3.0`; all 42 migrations are applied and API, Worker, and Frontend remain active with zero restarts.
- The public API/MCP smoke passed 31/31 twice. The first production UI route run exposed a stale acceptance expectation for the retired standalone integrations route; the product's `/guide/obsidian` redirect was retained, the smoke contract was corrected RED -> GREEN, and the final clean UI rounds passed 5 public, 15 authenticated, and 6 mobile routes with no browser/server failures.
- Active smoke Users, Spaces, Agents, and `collaboration_test_*` schemas are all zero. One fully isolated 2026-08-21 UI fixture left active by an old failed run was removed through the product's own soft-delete APIs; audit history was not physically deleted. The release task is complete and archived.
