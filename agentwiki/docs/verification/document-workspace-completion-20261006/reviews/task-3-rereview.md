# Task 3 scoped fix re-review

## Finding Verdicts

- **P2 — Reading-mode outline measures the wrong ancestor: ADDRESSED.** `agentwiki/apps/client/src/features/space-workspace/ArticleContentsPopover.tsx:128-129` now resolves the actual article canvas through `articleRootRef` first; the wrapper lookup remains an editor fallback. This removes the reading toolbar/sibling null-ancestor path. `:146` includes the new ref dependency. `ArticleContentsPopover.spec.tsx:156-179` reproduces the production sibling structure and checks effective width/max 300 then 250, unchanged stored width 360, absent grip below the minimum available area, and intentional End persistence to 250.

## New Breakage in the Fix Diff

None found. The two-line lookup change preserves editor fallback and leaves visibility, authorization, persistence and source behavior unchanged.

## Out-of-Scope Observations

None.

## Verdict

**Fix round: All findings addressed, no new Critical/Important breakage.** Task 3 spec compliance is now ✅ for the reviewed scope; task quality is Approved. Integrated browser/build/full-branch gates remain with the controller.

## Checks

- Reviewed only fix package `review-c6f68442..24fe9c0b.diff`, FIX_BASE `c6f68442`, HEAD `24fe9c0b`, and its receipt. No fresh broad review, Git commands, source/index/HEAD edits or subagents.
- Read final logs: focused outline+PagePreview run reports 2 suites / 52 tests passed; typecheck and scoped ESLint logs are clean. No suite rerun was needed.
- Own latest `turn_context`: 2026-10-06T10:34:14.318Z; `p5c07ff/gpt-6-astra`, `ultra`, thread `01a110c2-04b8-7633-b265-3444434da9bd`; no override/fallback.
