# Task 3 P2 fix receipt

2026-10-06. Base `c6f68442`; fixed only the independent review's reading-mode canvas ancestry finding. Product source frozen for scoped re-review. No commit, subagent, runtime lifecycle change, scope expansion or budget change.

Actual current turn route: `/root/completion_runtime`, thread `01a1109e-9099-77c2-ab80-4b0b922e58b3`; `turn_context` at `2026-10-06T10:31:17.640Z`, model `p5c07ff/gpt-6-astra`, effort `ultra`, turn `01a110c4-875f-7c12-b2ce-33484cf2cc7f`.

## Fix

`ArticleContentsPopover.updatePosition` now resolves the document canvas from `articleRootRef.current.closest('.document-canvas')` first. The existing wrapper-ancestor lookup remains a fallback for editor mode when no preview root is mounted. `articleRootRef` is included in the callback dependency list.

The new regression reproduces the actual reading structure: a toolbar containing the trigger and a sibling article canvas containing the article root. At viewport 1280 and canvas left 600, stored width 360 displays as width/max 300; moving the canvas left edge to 650 clamps width/max to 250. Both measurements retain stored width 360. If available width falls below 200, the desktop grip disappears without changing the saved preference. After returning to enough space, End intentionally saves only the current effective max 250.

Only two assigned files changed: `ArticleContentsPopover.tsx` and its spec.

## Evidence

- Before source fix: new actual-sibling regression failed with actual width 360 versus expected 300; 17 existing outline tests passed. Log `task-3-fix-red.log`.
- After fix: `pnpm --filter @agentwiki/client exec vitest run src/features/space-workspace/ArticleContentsPopover.spec.tsx src/features/page/PagePreview.spec.tsx` — **2 suites / 52 tests passed**, 1.39s. Log `task-3-fix-focused.log`.
- Final `pnpm --filter @agentwiki/client exec tsc --noEmit` — passed, exit 0 (`task-3-fix-typecheck.log`).
- Two-file scoped ESLint — passed, exit 0 (`task-3-fix-eslint.log`).
- Explicit-work-tree `git diff --check` — passed.

No full suite or browser/build success is claimed. Ready for the controller's targeted re-review of this single finding.
