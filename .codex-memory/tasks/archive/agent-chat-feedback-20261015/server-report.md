# Task 1 server execution progress

- Base: v0.12.34 `479419eff227a09350dd7cdc695450de238bb894`.
- Commit: `6cecf4d5` (`fix(assist): report sanitized session execution progress`).
- Worktree: `/Users/neomei/.codex/worktrees/agent-chat-feedback/AgentWiki `.
- Scope: 11 server files only. No frontend files, migration, deployment or production writes.

## Behavior

- Runtime input gains `onProgress({ phase, attempt? })`; phase is one of `preparing`, `waiting`, `generating`, `finalizing`, attempt is an optional 1-based integer bounded to 1..100.
- Queue writes `preparing` after authorized execution-context acquisition and before invoking the runtime. Router reports catalog preparation and each actual attempt; runner reports waiting after launching the child, generating from actual `step_start`/text events, and finalizing after successful output completion.
- CLI phases are deduplicated; queue deduplicates phase + attempt. Router adds attempt counts to runner phases without model identity, failure text, event payloads, reasoning or tool arguments.
- Session-only progress is sanitized and written into existing `AssistTask.result.progress`; answer text remains on its existing validated callback and `progressText` channel.
- Phase and answer writes share a serial transaction chain with live session authorization and the existing running/worker/lease fence. Failure aborts and drains the chain before terminal persistence; session failure clears `result`. Cancellation and lease takeover prevent late writes. Completion replaces progress with the existing final-answer result.
- Session service independently sanitizes stored progress and exposes the optional DTO only while `running`. Queued/recovered and terminal rows omit it; queued UI uses its existing status/fallback. Final result shape and history contract remain unchanged.

## Verification

Initial failing regression run, before production edits:

`pnpm --filter @agentwiki/server test --runTestsByPath src/assist/opencode.runner.spec.ts src/assist/opencode.router.spec.ts src/assist/assist.queue.spec.ts src/assist/assist-session.service.spec.ts`

- Expected RED: 4 suites failed, 5 new behavioral failures (missing runner/router/queue/service phases), 142 passed, 1 existing skip.
- After implementation: the same 4 suites passed, 147 passed, 1 existing skip.

Final relevant suite run (including extra progress-only subscription, failure drain and permission-loss checks):

`pnpm --filter @agentwiki/server test --runTestsByPath src/assist/assist.queue.spec.ts src/assist/assist-session.service.spec.ts src/assist/assist-session.controller.spec.ts src/assist/opencode.runner.spec.ts src/assist/opencode.router.spec.ts src/assist/opencode.config.spec.ts src/assist/opencode.catalog.spec.ts`

- PASS: 7 suites, 178 tests passed, 1 existing skip, exit 0. Warning logs are expected recovery/catalog failure fixtures.
- `pnpm --filter @agentwiki/server typecheck`: exit 0.
- `pnpm --filter @agentwiki/server build`: exit 0.
- `pnpm exec eslint apps/server/src/assist/assist-progress.ts apps/server/src/assist/assist-session.types.ts apps/server/src/assist/assist-session.service.ts apps/server/src/assist/assist-session.service.spec.ts apps/server/src/assist/assist.queue.ts apps/server/src/assist/assist.queue.spec.ts apps/server/src/assist/opencode.types.ts apps/server/src/assist/opencode.router.ts apps/server/src/assist/opencode.router.spec.ts apps/server/src/assist/opencode.runner.ts apps/server/src/assist/opencode.runner.spec.ts`: exit 0.
- `git --work-tree="$PWD" diff --check`: exit 0.

## Limits / remaining integration work

- This is structured real execution status, not token-level model output. Existing complete, validated answer streaming is deliberately unchanged.
- Unit/component tests include real CLI subprocess fixtures, but this task did not call a production model or database. Stateful database doubles cover progress behavior; existing PostgreSQL acceptance still belongs to integration gates.
- Legacy non-session websocket streaming is unchanged and is not the new session progress channel.
- Frontend integration/browser acceptance and independent review remain with the parent task. No reviewer was spawned by this implementation agent.

## Independent review P2 correction

- Correction commit: `b2620dc7` (`fix(assist): clear stale session progress on reclaim`).
- Review: `/tmp/agentwiki-chat-feedback/server-review.md` identified stale `result.progress` resurfacing after an expired lease is recovered and the task is reclaimed as running, before the new worker finishes startup authorization.
- Fix: session-only queued-to-running claim now atomically sets `result: Prisma.DbNull` alongside its new lease. Legacy non-session result behavior is unchanged. The normal authorized `preparing` write still initializes the new execution's progress.
- Added a stateful lifecycle regression using the actual queue recovery/claim and public session `get()` paths. It starts from expired `finalizing/attempt 2`, performs recovery/backoff/claim, blocks startup before runtime invocation, asserts running with no old progress, then releases startup and observes fresh `waiting/attempt 1`. Existing non-session claim coverage now also asserts it does not alter `result`.
- RED: `pnpm --filter @agentwiki/server test --runTestsByPath src/assist/assist.queue.spec.ts` failed exactly on obsolete `{phase:'finalizing',attempt:2}` being returned after reclaim; 36 existing tests passed.
- GREEN: the 7-suite command above passed with **179 passed / 1 existing skip**. Final queue-only run after the legacy compatibility assertion: **37 passed**, exit 0.
- `pnpm --filter @agentwiki/server typecheck`: exit 0.
- `pnpm --filter @agentwiki/server build`: exit 0.
- `pnpm exec eslint apps/server/src/assist/assist.queue.ts apps/server/src/assist/assist.queue.spec.ts`: exit 0.
- Scoped `git diff --check`: exit 0. Only queue source/spec were changed; no frontend edits, deploy, or production calls. This in-memory lifecycle regression is not a substitute for PostgreSQL concurrency acceptance.
