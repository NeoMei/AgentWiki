# Task 1 fix round 1 — independent scoped re-review

- Reviewer: `sessions_backend_review`; no child agents or product patches.
- Immutable base: `5fd5e944855fb027ab157ed189fc2eb1a2e02f5a`.
- Immutable candidate: **`b5e80d7a725675715b40633ec52356dcc56ed28a`**.
- Review package: `review-5fd5e944..b5e80d7a.diff`, SHA256 `6e6831bb90ffdf879008468ffd2ac8bc26b98162f48a87a0bf11c54d3b5bde6d`.
- Scope: all four Task 1 findings and regressions introduced by this single fix commit (9 files). Read the complete fixed diff in bounded chunks, appended implementation report and recorded test results. No passed suite was rerun. Coordinator current/task notes were outside scope.

## Verdict

**Specification compliance: APPROVED for Task 1. Code quality: APPROVED.** All four findings are closed in this candidate; no new actionable issue found in the scoped fix. Task 2 implementation is no longer blocked by the Task 1 review. This code approval is separate from isolated API/worker/DB acceptance, rendered UI acceptance, real-provider quality and deployment.

## Finding disposition

### P1 — Independent worker session-service dependency: CLOSED

- `apps/server/src/worker.module.ts:38` now registers `AssistSessionService` in the real standalone worker graph.
- `apps/server/src/assist/assist.queue.ts:42` removes Nest's `@Optional()` decorator. Although the TypeScript parameter retains `?` for existing manual constructor tests, Nest now requires the reflected service dependency and cannot silently inject `undefined` on production bootstrap.
- The new real `Test.createTestingModule({ imports: [WorkerModule] })` regression overrides only persistence/provider fixtures, resolves the actual queue/service/authorization graph, processes a session turn, observes provider invocation and verifies durable `done` data. Existing API-module graph coverage was included in the focused run.
- This closes the missing-provider mechanism. Restarted independent API/worker plus real DB/Redis acceptance is coordinator-owned and is not inferred from the dependency-graph test.

### P2 — Immutable bounded source replay: CLOSED

- `apps/server/src/assist/assist-session.service.ts:147–158` now includes the captured prior `pageSnapshot` and server-captured reference objects in each chosen history item. The matching internal history type includes both fields; public HTTP response shape remains unchanged.
- Sources, answers, proposals and annotations share the existing latest-10/120000-character budget. Accounting includes JSON array brackets and commas; omitted turns are reflected in `historyWindow`. No current-source replacement or unbounded union is introduced.
- The added regression sends A plus R, returns an answer omitting unique A/R markers, changes both live sources, then passes a B turn through the real queue and inspects runtime input. Original markers/title/version are present and changed bodies are absent. A second exact-boundary regression verifies serialized history stays within the 120000-character ceiling.
- Current source/ref authorization remains enforced before replay; active snapshot staleness checks remain unchanged.

### P2 — Inaccessible conversation blocks entire list: CLOSED

- `apps/server/src/assist/assist-session.service.ts:45–56` filters individual inaccessible conversations with a dedicated exception and the existing explicit `SPACE_ACCESS_DENIED` business code. Their title/content is never added to the result.
- Principal/Space admission remains outside the per-conversation catch. Corrupt binding/context exceptions and database failures are not broadly swallowed; direct history reads and sends remain fail-closed.
- Regressions cover deleted sources, reference movement to another Space and lost proposal role while preserving unrelated good/new sessions. An injected Prisma P1001 is propagated unchanged.

### P2 — Linux long-prompt argv limit: CLOSED

- Both direct `run` and routed `runModel` remove prompt text from argv and supply it to the runner's UTF-8 stdin path, ending the stream with EOF. Model/catalog flags remain unchanged and catalog stdin still closes.
- `apps/server/src/assist/opencode.runner.ts:240–242,344–351` installs input/abort/output/error handlers and deadlines before writing input, destroys pending stdin on abort/cleanup, treats EPIPE/synchronous write errors as global failures and retains a stream error sink for late teardown errors. Cancellation still terminates the child and cannot trigger fallback.
- The real spawned fixture receives exactly 90000 Chinese characters / 270000 UTF-8 bytes through stdin and verifies argv contains flags/model only. Real Writable regressions cover backpressured cancellation and late EPIPE; emitted and synchronous input errors both trigger termination. The reviewed tests establish fixture transport behavior on the available host, not Linux-host execution or external-model success.
- Corrected the original report's Darwin-only non-finding. The [Linux execve manual](https://man7.org/linux/man-pages/man2/execve.2.html) documents a separate 32-page per-string limit, so Darwin success was not portable evidence. The pinned [OpenCode 1.18.12 source](https://github.com/anomalyco/opencode/blob/v1.18.12/packages/opencode/src/cli/cmd/run.ts#L400-L402) confirms non-TTY stdin consumption. This fix removes that argument-size dependency without relaxing content bounds.

## Validation evidence inspected

- `/tmp/agentwiki-sessions-20261006/task1-fix1/green-final.log`: **6 suites passed, 132 tests passed, 1 existing skipped**, 3.16 seconds. Service, WorkerModule, AssistModule, queue, runner and router were included.
- Final fix typecheck/build logs are successful; scoped lint log has no diagnostics and the implementer records successful exit. Red receipts and the exact-boundary failure are recorded in the appended implementation report.
- Coordinator's `/tmp/agentwiki-sessions-20261006/server-after-fix.log` on this fixed candidate: **159 passed suites / 5 skipped suites, 2877 passed tests / 26 skipped tests, zero failures**, 21.799 seconds. This is the post-fix count; the original 2866-pass result belongs to `8489c685`.
- No test rerun, external provider request, process initialization, runtime restart or DB mutation performed by this reviewer in this re-review.

## Migration and gate verification

- Independently inspected gate commit `5fd5e944855fb027ab157ed189fc2eb1a2e02f5a`: exactly two hash constants changed, in `scripts/folder-test-database.mjs` and `scripts/content-tree-core-db.test.mjs`, from the old approved digest to the independently approved new digest. No gate/allowlist logic changed.
- `5fd5e944..b5e80d7a` has no Prisma migration/schema or gate-script changes.
- Recomputed the live corpus read-only: **61 files**, SHA256 **`39e27b72da1e030c676cb858b642c3f231d6ddc4d5f531b7f4749f45c9ced7a5`**.
- Original explicit SQL approval remains valid. The fixes do not expand the global DDL boundary or alter that reviewed corpus.

## Remaining acceptance boundaries

The coordinator must still report the separate runtime-r2 HTTP/independent worker/Redis/PostgreSQL results and later frontend/UI/whole-feature acceptance. Linux-host execution, resistant-process SIGKILL behavior and external-model quality are not newly claimed by this review. ACP remains an interface boundary; no local ACP connection or production deployment was performed.
