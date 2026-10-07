# Review cache fix — independent review R2

Disposition: **changes requested — one P2 remaining**.

Immutable patch: `/tmp/agentwiki-comprehensive-audit-20261007/review-cache-fix-r1.patch`; SHA256 verified `14b6c55679cf5be496757901d3b4b3e1afdfa51bd9f6275543ee59fcd7ed7b4c`. Inspected only ReviewPage.tsx/spec and this patch. No product edits, build, runtime, database or browser.

## P2 — mutation authorization denial still retains inaccessible candidate and decision controls

Absolute file: `/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki /agentwiki/apps/client/src/features/review/ReviewPage.tsx`
- item decision catch: lines **362–373**
- action/publish/revert catch: lines **331–342**
- new invalidation helper exists at lines **153–173** but is not called by either mutation catch.

Reproduce: load and expand a pending candidate as an owner. Transfer ownership and remove that user using another session, then, before the next polling/focus refresh, click Accept candidate in the existing UI. PATCH returns 403. The catch sets the toast but preserves items, source evidence and permissions. `finally` clears mutating state and re-enables the stale buttons. Publish/reject action POST follows the same path. Server authorization prevents the write; this finding concerns the already-observed authorization denial not invalidating UI state.

Independent executable reproduction: created a copy of the current test suite under `/tmp/agentwiki-comprehensive-audit-20261007/review-r2-probe/`, with absolute imports of the real product component (no repository edits). Added `R2 clears candidate and controls after mutation authorization denial`. It opens real rendered ReviewPage with allowed reads, returns 403 from api.patch, clicks Accept candidate, waits for the error toast, then asserts candidate content is absent. **RED**: `Proposed content` remains in the DOM. Output in `review-r2-probe/results.log`, probe file `ReviewPage.probe.spec.tsx`.

Fix expectation: invalidate cached decision permissions and inaccessible details after authoritative mutation denial; cover both action and decide. A mutation 403 can also mean owner→viewer downgrade while read access survives, so a fresh authorized read may legitimately restore the candidate with no owner controls. Preserve ordinary 5xx behavior. Add mutation 403/404 and late-response coverage alongside list/detail tests.

## Race and regression review

- List/detail `accessEpochRef` stops pre-denial successful responses from reintroducing cached rows. Clearing detail sequences alone would have been insufficient; epoch also covers stale list reads.
- Successful background summaries advance detail sequences, drop missing rows/permissions and collapse removed selections. This closes the empty-list→late-detail resurrection path.
- Authoritative summary run/sourceStatus replace cached source projection. Per-item status comes from summary.items. Cached evidence is removed if fresh summary has no evidence; following successful detail restores it. Ordinary 5xx list/detail failures keep authorized candidate content, per explicit tests.
- Normal post-mutation parallel `expandChangeSet + load()` uses non-background list merging, so it does not invalidate the corresponding detail read merely by incrementing detail sequences.
- **No confirmed late-mutation-success resurrection**: mutation callbacks do not adopt POST/PATCH response objects into items. They issue new GET detail/list reads. If an independent detail denial arrives while a mutation is pending, it clears items and increments epoch; the late mutation success then starts fresh GETs, which remain denied while membership is revoked. Added a passing independent probe for this reachable ordering: pending Accept → collapse/reopen → detail 403 → mutation success → new GETs still 403; candidate stays absent. Do not invent an authorization bypass by mocking fresh post-revocation GETs as stale successes.

## Executed checks

- Existing ReviewPage suite: **61/61 passed** independently rerun.
- Independent temp probes: **1 RED (remaining mutation denial defect), 1 GREEN (late successful mutation cannot resurrect under continued revocation)**; 61 unrelated tests skipped in probe run.
- Initial temp test runner path resolution failed under macOS `/tmp` symlink; corrected config root to `/private/tmp`. This setup error is not product evidence.

Parent supplied actual e0 UI/API revocation reproduction; this review does not claim to have rerun native/browser acceptance on the patch. Recommend repeating that acceptance after remaining mutation path is corrected.
