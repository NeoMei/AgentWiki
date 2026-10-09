# Review cache fix — independent review R3

**Disposition: approved for this focused fix. R2 P2 resolved; no new actionable finding.**

Read-only reviewed files:
- `/Users/neomei/.codex/worktrees/knowledge-capabilities/AgentWiki /agentwiki/apps/client/src/features/review/ReviewPage.tsx` SHA256 `a0c6e835ac9fafc6928cbec298aa15c954aa345073f7b29e0aa7268183e81c73`
- adjacent ReviewPage.spec.tsx SHA256 `6ec6cedbea9b5aa9a8d63489cfaa2004ef997b36cdc8696cf2a22aa2f8425c5d`
Both hashes matched before review. No product changes, build, API, DB or browser.

## Findings disposition

The prior mutation-denial hole is closed in both action and decide. On 401/403/404, refreshAfterDenial removes the row, evidence, cached decision permissions and comments before issuing fresh detail and Space-membership reads. An owner→viewer downgrade can restore newly authorized content but cannot reuse cached owner controls. If either fresh read fails, no cached content is restored. Normal 5xx mutation failures continue retaining the previously loaded content and permit retry.

The existing authorization epoch still prevents older list/detail responses from reintroducing data after invalidation. Fresh background summaries invalidate earlier detail sequences, remove absent rows and permissions, and replace source projections. Scope changes/unmount abort the queued requests; refreshAfterDenial reopens the row only if the scoped read succeeds and no other item is expanded. Ordinary mutation success still refetches rather than adopting stale POST/PATCH response bodies.

No reachable new authorization-cache resurrection was found. The pending-write→independent denial→late successful write-response analysis from R2 remains applicable: new reads must pass current authorization before anything is restored.

## Independent verification

1. `pnpm exec vitest run src/features/review/ReviewPage.spec.tsx` — **73/73 passed**.
2. Created only temporary test copies under `/tmp/agentwiki-comprehensive-audit-20261007/review-r3-probe/`, importing the actual component. Two additional independent cases both passed: denied mutation → fresh detail succeeds → delayed Space-membership read fails with (a)403 or (b)500. Candidate/evidence stays removed while membership is pending and after failure; no owner controls reappear. **2/2 passed**, 73 other tests skipped. Output: `review-r3-probe/results.log`.

The approval is limited to code and targeted unit behavior for this cache invalidation fix. Root owns actual API/UI acceptance and should retain that evidence separately; this report does not assert browser acceptance or deployment.
