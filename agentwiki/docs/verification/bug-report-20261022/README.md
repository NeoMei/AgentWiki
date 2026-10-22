# 10-22 Bug report remediation — 2026-10-23

Original: https://agentwiki.quukk.com/pages/f31ccf05-70d0-4376-95c3-f507a5bb1bce

This file preserves the local-remediation phase. The subsequent deployed v0.12.57 / published npm 0.13.5 result, production checks and remaining latest-tag authentication are recorded in [release/README.md](release/README.md).

Candidate: canonical worktree, branch `codex/agent-autochat-external-opencode`, base HEAD `cec79c4e`, release guard v0.12.56. Changes remain local and uncommitted; no release, deployment, or production bug closure is claimed. The pre-existing onboarding identity changes are preserved.

| Item | Root cause and change | Verification |
| --- | --- | --- |
| 1 | Graph extraction omitted ID lookup. Resolve IDs in authorized active same-Space pages; algorithm-version hash invalidates old snapshots once. | extraction/refresh/maintenance 51 tests; old unchanged pages refresh, subsequent sweep skips |
| 2 | Empty description serialized as omitted undefined. Send explicit empty string. | JSON round trip and real component browser reload |
| 3 | Directory passed an empty no-match label. Add localized visible status and clear action. | English/Chinese unit tests; desktop/mobile drawer, focus and restored items |
| 4 | Reset used identity transform instead of centering. Center current bounds at 100%. | real pan/zoom/reset coordinate comparison; grouped and resized viewports |
| 5 | Two graph selectors showed title only. Add canonical path, retain page ID values. | both native selectors in Chrome |
| 6 | Preview scroll offset double-counted nested scroller top; delayed scroll overwrote selected heading. Correct actual geometry and retain clicked target until subsequent scroll. | editor/preview at 1440 and 390, unique/duplicate/end headings, short docs, rapid clicks |
| 7 | Existing unique constraint is source/target/type. Filter same-direction same-type manual relations, keep reverse/other types and auto-to-manual promotion. | type changes, invalid selection, duplicate submit guard, post-create refresh |
| 8 | Search API already returned path but cards omitted it. Show path with ID fallback. | same-title different-folder cards, accurate ID navigation at 390px |
| 9 | Search default10/max100 had no range explanation; total was only returned count. Add hasMore probe and bounded expansion, state that total is unknown. | server/client boundaries, browser10-to12 expansion |
| 10 | Run search used raw English fields. Share visible safe localized diagnosis with details. | Chinese status/stage/reason and combined filters |
| 11 | Task actions ignored parent run terminal state. Hide terminal actions; label unfinished task state as historical, preserve paused recovery. | cancelled/failed/completed/paused unit tests and desktop/mobile browser resume flow |
| 12 | Bell/page had independent state and no mutation invalidation. Notify same/cross tab after successful mutation, refetch and fence stale responses. | single/all reads, failure, unread filter, stale response; real two-tab storage event before poll |

## Verified gates

- Red tests were observed before each product fix.
- Client: 169 files, 2814 tests passed.
- Local Chrome: 17 cases passed across six e2e files. Real components/DOM/pointer/storage, synthetic accounts and API transport; not production acceptance.
- Build, complete typecheck and lint passed. Existing Mermaid circular/chunk-size warnings remain. The server was rebuilt after the graph algorithm-version follow-up by test:full.
- Independent review identified one P2 old-hash upgrade issue; corrected and re-reviewed with no remaining blockers.
- First full-test run failed in the runtime database phase: 74 corpus-lock failures plus two incompatible registration fixtures. See ../migration-corpus-20261023.md. SQL/production authentication were not modified; exact-byte protection remains.
- Second full-test run reached 238/239 runtime database tests with zero skips; the remaining failure was another positive registration fixture containing whitespace. The follow-up repaired 23 names in 18 fixture files, with independent review and 78/78 focused harness tests.
- Third `pnpm test:full` passed runtime and server phases, then stopped at one existing client template-test failure. The test depended on a transient unique-text window: the selected template name also appears in the summary. Its default 1-second DOM wait also covered three asynchronous page renders. Four natural parallel reruns passed, so load as the original trigger remains an inference; a controlled 1100ms first-page response reproduced the old timeout. The final test explicitly delivers each page with `act` and queries the unique target button, preserving 100 initial cards, exact `[0,100,200]` pagination, scope/kind and selected-state assertions. No product code or timeout was changed. Independent review and the final complete client suite passed.

### Final phase results

These are aggregate phase results after repairs, not a claim that one uninterrupted `pnpm test:full` invocation exited successfully. Already-passing runtime/server phases were retained after the final test-only change; client and remaining packages were verified separately.

| Phase | Passed | Skipped |
| --- | ---: | ---: |
| Runtime non-database | 314 | 1 |
| Runtime PostgreSQL | 239 | 0 |
| Server (188 passing suites) | 3572 | 3 |
| Client (169 files, final rerun) | 2814 | 0 |
| Sync protocol (10 files) | 140 | 0 |
| Local sync (75 files) | 1123 | 1 |
| Total | 8202 | 5 |

The five existing environment-gated skips are the independently installed CodeGraph acceptance (1), dedicated connection-authorization PostgreSQL/Redis suite requiring `CONNECTION_UX_DB_TEST` and a specifically named database (3), and Windows ACL behavior on this macOS host (1). They are not counted as passed. The 17 local Chrome cases are additional to the table.

## Remaining delivery boundary

No deployment in this turn. Original billy production scenarios, including refresh/cross-tab and relation regeneration, require verification after release. Existing graph snapshots refresh on the normal worker maintenance schedule (default six hours) or an explicit refresh. Previous onboarding package changes also need a new npm version before deployment claims.

## Evidence locations

- /tmp/agentwiki-bugs-20261023-full-test.log (initial failure)
- /tmp/agentwiki-bugs-20261023-full-test-retry.log
- /tmp/agentwiki-bugs-20261023-full-test-final.log
- /tmp/agentwiki-bugs-20261023-registration-fixtures.log
- /tmp/agentwiki-bugs-20261023-client-final.log
- /tmp/agentwiki-bugs-20261023-sync-protocol.log
- /tmp/agentwiki-bugs-20261023-local-sync.log
- /tmp/agentwiki-bugs-20261023-new-content-final.log
- /tmp/agentwiki-bugs-client-tests.log
- /tmp/agentwiki-bugs-{build,typecheck,lint}.log
- /tmp/agentwiki-notification-e2e/ and /tmp/agentwiki-collaboration-terminal-e2e/
- /tmp/agentwiki-graph-browser-20261023/ and /tmp/agentwiki-page-ui-visual-results/

## Original report readback

ChangeSet `cmvjsp7z60gf6m478wp52hvxv` auto-published under the existing Space policy. Page `updatedAt` is `2026-10-22T17:08:45.930Z`. A fresh MCP read exactly matched the proposed content: 12 developer replies and 12 regression replies under the existing fields. Removing only the added reply lines yields the byte-exact original content; all 18 image references remain.

Authenticated production Chrome readback confirmed all 24 reply labels and 18 image elements rendered. This verifies report delivery only, not the unshipped product changes. HTML/accessibility evidence is `/tmp/agentwiki-bug-report-published-20261023.{html,snapshot}`; capture export is `/tmp/agentwiki-bug-report-readback-20261023.json`. Readback session `lwfq` was stopped after export. Local fixture Vite listeners on 5177, 5178 and 5189 have ended.
