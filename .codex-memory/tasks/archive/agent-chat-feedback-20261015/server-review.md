# Task 1 server independent review

- Scope: Task 1 only; `479419eff227a09350dd7cdc695450de238bb894..6cecf4d52d78a33f454f352ade4ed5b5f91722ee`.
- Worktree: `/Users/neomei/.codex/worktrees/agent-chat-feedback/AgentWiki `.
- Reviewed the supplied brief, implementation report and complete server patch, then traced the affected runner/router/queue/session service paths and tests.
- HEAD advanced to frontend commit `7523d9c6` during review; `git --work-tree="$PWD" diff 6cecf4d5 -- agentwiki/apps/server/src/assist` was empty. Frontend changes are outside this review.
- No source changes, no production calls, no re-run of the reported test suites. One additional bounded in-memory reproduction used the existing compiled server classes to inspect the recovery/claim boundary.

## Verdicts

- **Spec compliance: CHANGES REQUESTED.** The structured DTO, sanitization, real event sources and terminal hiding meet the main contract, but recovered tasks can expose an obsolete execution phase as the current attempt before runtime startup.
- **Code quality: CHANGES REQUESTED.** One P2 correctness finding remains. No other blocking finding was identified within the scoped patch. The implementation report's passing test/build/lint results are attributed to the implementer, not independently re-run evidence.

## Blocking finding

### [P2] Clear stale structured progress before a recovered task becomes running again

- Primary changed location: `agentwiki/apps/server/src/assist/assist-session.service.ts:261`.
- Related lifecycle locations: `agentwiki/apps/server/src/assist/assist.queue.ts:91-100`, `146-152`, `191-208`.
- Trigger: a worker dies after persisting `result.progress = { phase: 'generating' | 'finalizing', attempt: N }`; the lease recovery requeues the task and another execution claims it.
- Mechanism: recovery changes status/lease fields but leaves `result`; claim changes status to `running` but also leaves `result`. The new service projection checks only `status === 'running'`, so it re-exposes the previous execution's phase and attempt immediately after claim. The replacement `preparing` write comes later, after asynchronous active-task checks and session-context transactions; it can be delayed by database lock contention. Thus clients can display “finalizing, attempt 2” before the new runtime has even been called. Hiding progress while queued does not eliminate the subsequent reclaim window.
- Independent reproduction: created an expired running row containing `finalizing/2`; invoked the actual compiled `recoverExpiredLeases()`, then `tick()`, holding the existing asynchronous startup authorization boundary before runtime invocation; projected the row with the actual session service `view()` method. Output:

```json
{
  "queued": { "status": "queued" },
  "reclaimed": {
    "status": "running",
    "progress": { "phase": "finalizing", "attempt": 2 }
  },
  "runnerCalled": false
}
```

- Suggested fix: atomically remove the session's old temporary result on the queued-to-running claim (or clear it in every recovery path before it can be reclaimed), while preserving legacy non-session result semantics. Leave the existing authorized `preparing` write as the source of the new phase; until then the optional DTO should be absent. Add a stateful recovery -> claim -> read test that pauses before runtime startup and proves no old phase/attempt is returned, then proves the new execution reports fresh progress. Do not merely add another service test for a row still in `queued` state.

## Reviewed invariants that hold

- `assist-progress.ts` accepts only the four fixed phases and integer attempts 1..100, reconstructing the DTO without provider/model/raw fields. The queue sanitizes before persistence and the session service independently sanitizes on read.
- Runner feedback derives from spawn/waiting, recognized `step_start` or text/generating, and successful process close/finalizing. Repeated phases are deduplicated; router reports actual attempted-candidate count without exposing candidate identifiers or failure payloads. Cancellation suppresses late close finalizing.
- Session invocation does not pass the legacy raw-stream callback. Existing answer callback validation is preserved; this patch does not introduce fake token streaming into sessions.
- Answer and phase writes share one promise chain. Each transaction obtains current session authorization and writes through the active status/worker/live-lease predicate. The abort recheck after authorization prevents a delayed authorization transaction from writing after runtime failure; failure drains the chain before terminal persistence.
- Completion replaces temporary progress with whitelisted final answer fields; failure clears session result and answer text. Cancellation clears result/text and its terminal status prevents late updates. Lost ownership also prevents the old execution from writing through the active predicate.
- Session `publicResult()` emits only done summaries/changes, and history includes only done turns through that projection. Temporary structured progress does not enter final results or conversation history. Terminal DTOs omit progress.

## Limits

This is a scoped source review plus a deterministic in-memory lifecycle reproduction, not PostgreSQL concurrency acceptance or production-provider/browser verification. Those integration gates remain separate from this review.
