# Task 5 server slice report

Implementation complete for controller commit and independent scoped review. No commit, client edits, schema/dependency edits, external provider requests, production data or Page writes were performed.

## Exact files changed

All paths below are relative to `agentwiki/`:

- `apps/server/src/assist/assist.service.ts` / `assist.service.spec.ts`
- `apps/server/src/assist/assist.queue.ts` / `assist.queue.spec.ts`
- `apps/server/src/assist/opencode.runner.ts` / `opencode.runner.spec.ts`
- `apps/server/src/assist/assist-target.ts` / `assist-target.spec.ts` (new)
- `apps/server/src/assist/assist.module.ts` (explicit AuthorizationModule DI import)
- `apps/server/src/assist/assist.controller.ts` / `assist.controller.spec.ts` (controller-approved narrow extension)
- `apps/server/src/core/collaboration/collaboration.gateway.ts` / `collaboration.gateway.spec.ts` (controller-approved requester stream privacy extension)

`assist.module.spec.ts` was run unchanged to prove production AppModule DI binding. `opencode.router.spec.ts` was run unchanged to cover the existing actual runner router and isActive retry hook.

## Client-facing transport contract

Existing `POST /assist/tasks` body remains `{spaceId,pageId?,intent,snapshot?}`. HTTP authenticated human identity supplies the requester; missing caller identity is rejected. Scoped requests require pageId. Add optional `snapshot.assistTarget`:

```ts
snapshot: {
  title: string,
  content: string,              // full source draft, may differ from saved page
  updatedAt: string,            // saved page version at capture
  assistTarget: {
    kind: 'selection' | 'section' | 'document',
    from: number,               // finite safe integer UTF-16 offsets
    to: number,                 // half-open [from,to)
    quote: string,              // exactly content.slice(from,to)
    prefix: string,             // <=256 chars, immediately adjacent before from
    suffix: string,             // <=256 chars, immediately adjacent after to
    baseUpdatedAt: string,      // exactly snapshot.updatedAt, valid timestamp
  }
}
```

The serialized snapshot remains capped at existing 50,000 characters. Supplied context may be shorter than the full outside source, including empty context; it must match exactly and fit inside the source. Selection/section ranges are nonempty. Document is `[0,content.length)` and permits empty content. An explicitly supplied null/invalid/mismatched target is rejected with BadRequest rather than silently converting to whole-document. Target base must match current saved Page.updatedAt at creation, before model execution/retries and before done persistence. Server compares saved version, never saved content, so unsaved draft source is valid.

`result` remains `{summary,changes:<full Markdown>,...}` with current result sanitization. Target prompt instructs full source output with all outside characters unchanged. Queue checks full outside prefix and suffix plus minimum non-overlapping length; output may delete or resize the selected text, but changing any outside text fails without persisting model content as a done result. Existing generic failure text is retained. Server never applies Page writes.

Readback now filters tasks by current requester. List also filters by authorized page Space; get validates current page access and task/page Space consistency. Other requesters receive no task through get; missing internal read scope is rejected before Prisma can omit undefined filters. This protects private unsaved draft snapshots/results.

Streaming remains functional: Redis event names/payloads and queue emitter arguments stay unchanged. API relay resolves canonical task requester+page+Space from DB (no publisher-provided requester is trusted), refreshes requester socket identity/account/token state and page write authorization, and emits directly to eligible requester sockets. Same-page other users receive no stream, completion task IDs, or error events.

## Authorization and compatibility

- Creation calls existing `AuthorizationService.assertLiveHumanSpaceAccess` in the existing Serializable transaction. Account locking/deletion, human type, Space deletion and actual membership role are checked by that existing service. Current role mapping including human admin/editor semantics is preserved; no AuthorizationService edits.
- Queue carries canonical spaceId/requestedByUserId from its task select and checks task running status, lease owner, non-expired lease, task/page/requester/Space binding before provider run. Existing router isActive callback repeats current authorization and version validation before every model attempt. Completion rechecks within its DB transaction and conditions update on the same active lease and binding.
- No-target page tasks retain whole-document rewrite behavior, without adding target version checks. No-target non-page tasks remain valid when bound to a current authorized human requester. Null/missing/deleted requester rows fail closed, including legacy orphan rows; they cannot safely execute privileged model work or expose private snapshots. HTTP always requires a requester, so optional old input userId type is not an authorization bypass.
- Mid-attempt revocation cannot retract content already sent while authorized; it prevents subsequent attempts, denies done persistence, and relay independently stops further delivery. Already running provider execution is not force-cancelled; existing runner only supplies between-attempt isActive. No external provider run was performed to claim cancellation behavior.

## RED/GREEN and commands

Workdir: `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki /agentwiki` (literal trailing space before slash).

RED first:

- Added service malformed-target/version/page/requester/account-role tests, queue outside-scope/revoked/stale/page-binding tests and target prompt test before production code.
- `pnpm --filter @agentwiki/server test -- --runTestsByPath src/assist/assist.service.spec.ts src/assist/assist.queue.spec.ts src/assist/opencode.runner.spec.ts`: 30 failed / 52 passed / 1 platform skip, expected missing validation, revoked model execution and changed outside content incorrectly completing.
- Added requester readback and same-page stream privacy tests before controller/gateway production changes. `pnpm --filter @agentwiki/server exec jest --runInBand --runTestsByPath src/assist/assist.controller.spec.ts src/assist/assist.service.spec.ts src/core/collaboration/collaboration.gateway.spec.ts`: 33 failed / 30 passed, expected privacy/binding checks absent.
- Added missing-scope internal read test after first GREEN; focused service RED: 1 failed / 28 passed because missing userId was silently passed to Prisma. Added fail-closed service guards.

Final GREEN:

```sh
pnpm --filter @agentwiki/server exec jest --runInBand --runTestsByPath src/assist/assist-target.spec.ts src/assist/assist.service.spec.ts src/assist/assist.queue.spec.ts src/assist/opencode.runner.spec.ts src/assist/assist.controller.spec.ts src/assist/assist.module.spec.ts src/assist/opencode.router.spec.ts src/core/collaboration/collaboration.gateway.spec.ts
pnpm --filter @agentwiki/server typecheck
git --work-tree='/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ' diff --check -- agentwiki/apps/server/src/assist agentwiki/apps/server/src/core/collaboration/collaboration.gateway.ts agentwiki/apps/server/src/core/collaboration/collaboration.gateway.spec.ts
```

Results: 8 suites passed, 164 passed, 1 existing platform-specific Windows binary execution test skipped on macOS; typecheck exit 0; diff --check exit 0. Service/queue tests use actual AuthorizationService with fake DB boundaries. Runner spawn is mocked, so no model/provider call occurs. Gateway tests cover requester versus another user sharing page, account revocation, missing task, foreign task page/Space and page permission revocation. Queue covers expired lease, scope overlap/prefix/suffix, saved version changing mid-run, malformed persisted target and revoked attempt/completion. Existing router/DI regression suites passed.

## Remaining gates

Controller commit, independent server scoped review, integration with Task5 client and integrated Task5 review remain. This slice does not establish live provider, native/browser integrated acceptance, release or deployment.

CodeGraph was attempted first because an `agentwiki/.codegraph` directory placeholder exists; `codegraph explore` returned no index, so ordinary file reads were used. No index was created.


## Independent review I1/I2 repair (2026-10-06)

Read the complete `task-5-server-review.md` and verified its named production paths: actual member removal locks administrator User then `SpaceRevisionWriterService.lockSpace`; actual Page writes use `ContentTreeService.lockPageMutationSpace`, which resolves the same advisory Space lock. No auth/page/member writer implementation changes were required.

Exact repair file set (relative to agentwiki):

- `apps/server/src/assist/assist.queue.ts`
- `apps/server/src/assist/assist.queue.spec.ts`
- `apps/server/src/assist/assist.module.ts`
- `apps/server/src/core/collaboration/collaboration.gateway.ts`
- `apps/server/src/core/collaboration/collaboration.gateway.spec.ts`

I1: Queue completion injects the existing runtime `SpaceRevisionWriterService` via explicit SyncModule registration. Done transaction explicitly uses ReadCommitted and follows User → Space: lockLiveHumanPrincipal first, lockSpace next, recheck live membership/current page Space+version after acquiring that lock, and write done under the held advisory lock. Reentrant human principal checking is the existing authorization-service pattern. This coordinates with real revocation/Page mutation paths and prevents their committing in the check-to-done gap. Provider calls remain outside the locks.

Deterministic barrier coverage uses the real AuthorizationService and real SpaceRevisionWriterService with a test-only transaction advisory mutex at the `$executeRaw` DB boundary. Competing writer holds the Space lock; completion must wait, then sees committed revocation or Page.updatedAt change and fails rather than saving done. Reverse order pauses done persistence: competing revocation cannot commit until completion releases the Space transaction lock. Tests check actual writer SQL boundary, User-before-Space acquisition, lock acquisition/transaction commit ordering and task result; no PostgreSQL instance or production data was contacted. This is deterministic algorithm/DB-boundary evidence, not a claim of a live PostgreSQL concurrency run.

I2: Relay enqueues every valid stream/complete/error event into a Promise chain keyed by canonical event taskId before starting any async task/socket/authorization read. Different tasks remain independent. Each processed event performs fresh canonical task/account/token/page authorization checks. A caught drained promise lets subsequent events proceed after one event fails, while the subscriber still receives and logs that individual failure. Finalization removes a Map entry only when the completed event remains its latest chain, avoiding both premature removal and retained drained tasks.

RED: With production unchanged and only the new behavior tests, targeted queue/gateway command produced 5 failed / 52 passed. Failure evidence: while a competing writer held the Space lock, queue saved done; another revocation interleaved while done write was paused; delayed A authorization allowed B and complete first; drained-chain state was absent. An initial constructor type failure was corrected in test setup before obtaining this behavioral RED.

Final focused GREEN (same workdir as above):

```sh
pnpm --filter @agentwiki/server exec jest --runInBand --runTestsByPath src/assist/assist.queue.spec.ts src/core/collaboration/collaboration.gateway.spec.ts src/assist/assist.module.spec.ts
pnpm --filter @agentwiki/server typecheck
git --work-tree='/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ' diff --check -- agentwiki/apps/server/src/assist/assist.queue.ts agentwiki/apps/server/src/assist/assist.queue.spec.ts agentwiki/apps/server/src/assist/assist.module.ts agentwiki/apps/server/src/core/collaboration/collaboration.gateway.ts agentwiki/apps/server/src/core/collaboration/collaboration.gateway.spec.ts
```

Results: 3 suites, 60 passed, no skips/failures; server typecheck exit 0; scoped diff --check exit 0. No full-suite rerun was needed for these two bounded repair hunks. Additional relay regressions demonstrate revoked authorization after A blocks queued B/complete, unrelated tasks can proceed during A's delay, ordering A→B→complete, error recovery and map drain cleanup. Existing DI AppModule compile passes with the new dependency.

No commits, client edits, schema/dependency edits, external model calls, Page writes or production writes. Controller exact staging and independent I1/I2 re-review remain. Existing limitation unchanged: an already-running provider attempt is not force-cancelled; its result is prevented from done persistence after revocation/version change, and further relay events remain authorization-gated. In-progress never-settling infrastructure calls can retain their pending chain until they settle; drained chains are removed.
