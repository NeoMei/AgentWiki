# Task 3 independent review

## Spec Compliance

- ❌ Issues found: desktop reading-mode outline resizing does not apply the required document-area clamp. See Important P2 below. Other task-scoped preference, authorization, lifecycle and resize requirements are implemented in the reviewed diff.
- ⚠️ Actual desktop/390px interaction, integrated build/bundle gates and full-branch review remain controller gates; no browser or build success is asserted by this review.

## Strengths

- `agentwiki/apps/client/src/features/space-workspace/workspacePreferences.ts:20` reads old v1 records with automatic outline choice and bounded defaults; `:40` explicitly serializes known preferences rather than arbitrary payloads. `SpaceWorkspaceContext.tsx:45` keys the memory registry by user and Space, preserving the existing storage-failure fallback.
- `agentwiki/apps/client/src/features/space-workspace/ArticleContentsPopover.tsx:98` separates persisted desktop choice, temporary mobile visibility and collaboration suppression. The related tests cover explicit collapse across page/mode remount, missing headings, mobile dismissal, and suppression without erasing the preference.
- `agentwiki/apps/client/src/features/page/PageEditor.tsx:198` checks the active user/Space before restoring scoped state; `:204` gates actual visibility on live authorization. `:654` clears per-page request/mount state and `:1317` keys the candidate component by user/Space/page, while the mounted component survives close/tab changes. No new submission or source-write path is tied to preference restoration.
- `agentwiki/apps/client/src/features/space-workspace/PanelResizeHandle.tsx:16` handles keyboard direction/bounds; `:21` captures the pointer and `:36` stops cancelled/lost drags. The actual outline/collaboration tests verify display clamping does not overwrite the stored width.

## Issues

### Critical

None found.

### Important

- **P2 — Reading-mode outline measures the wrong ancestor.** `agentwiki/apps/client/src/features/space-workspace/ArticleContentsPopover.tsx:127-130` locates the canvas only with `wrapperRef.current.closest('.document-canvas')`. In production reading mode the trigger is in the toolbar (`agentwiki/apps/client/src/features/page/PagePreview.tsx:552,594`) and the article canvas is its sibling (`:621`), so that lookup is always null and the clamp computes with left=0. On a narrow desktop with an expanded directory this still advertises a 360px resize maximum instead of reducing the panel or hiding the grip when insufficient document space remains. The current `ScopedHarness` puts the trigger inside the canvas, so its clamp assertion does not cover the production reading structure. Resolve the canvas through `articleRootRef.current.closest('.document-canvas')` (with an appropriate editor fallback), and include that actual DOM relationship in the regression test.
  - **Minimal regression:** render a toolbar containing the outline and a sibling `article.document-canvas` containing `articleRootRef`; use viewport 1024 and canvas left 420. With stored width 360, expect effective width/max 224, stored width still 360, and End to respect 224. Add the same structure with available width below 200 to assert no desktop grip. Run only the affected outline suite plus scoped static checks; controller owns broader validation.

### Minor

None found.

## Assessment

**Task quality: Needs fixes.** One concrete reading/editing integration mismatch remains; the preference model and candidate lifecycle are otherwise appropriately bounded and supported by behavioral tests.

## Checks and scope

- Reviewed immutable package `review-83c990b7..c6f68442.diff` once, BASE `83c990b7`, HEAD `c6f68442`; no Git/index/HEAD/product/test mutations and no subagents.
- Actual reviewer route: latest own `turn_context` 2026-10-06T10:28:33.936Z, `p5c07ff/gpt-6-astra`, `ultra`, thread `01a110c2-04b8-7633-b265-3444434da9bd`; no override/fallback.
- Named focused risk checks outside diff: (1) scope restoration versus registry identity — `SpaceWorkspaceContext.tsx:42-59`; (2) outline reading placement/observer ancestor — `ArticleContentsPopover.tsx:37-51` and `PagePreview.tsx:550-636`, confirming the P2; (3) reopened candidate lifecycle — `PageEditor.tsx:644-681` and unchanged `AgentAssistPanel.tsx:161-204,405-408`, confirming identity/permission guards and that autosubmit remains tied to an explicit notes request, not a display preference.
- Read supplied validation evidence without rerunning suites: `task-3-focused.log` reports 6 suites/266 passed, final affected outline log 17/17 passed, final typecheck/eslint logs are clean. Earlier intentional RED/intermediate errors were separately recorded and resolved; no noise in final evidence. No additional tests run because the remaining issue follows directly from production DOM ancestry.
