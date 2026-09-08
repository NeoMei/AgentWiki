# Task 3 report: reading layout, article contents, and page information

## Scope and baseline

- Worktree: `/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/reading-workspace-20260908`
- Branch: `codex/reading-workspace-20260908`
- Starting HEAD: `3ed805ffd2514c72fd49abc5e47aed0a5303bd05`
- Scope stayed in the client reading surface and this report. No server, dependency, schema, URL, authorization, task-checkbox payload, editor dirty guard, fixture, or runtime changes were made.
- Controller-owned `.codex-memory` changes were left untouched and were not staged.

## Result

`PagePreview` now uses a centered, approximately 860px-wide white article with the real page title, author, update date, and the author's Markdown headings preserved. The previous permanent 320px source column and bordered/shadowed article card were removed. The sticky reading toolbar exposes a readable blue Edit button only when `capabilities.canEdit === true`, a conditional article-contents trigger, and on-demand page information.

The toolbar consumes `SpaceWorkspaceContext.directoryCrumbs`, which Task 2 derives from the authoritative folder ancestry. Each Space/folder crumb links through `spaceFolderHref(spaceId, crumb.id)`; no route pathname or title is used to infer a folder. Until the chain is available, the existing Space return path remains available.

Images are constrained to the article width. Code blocks and tables keep their content within the reading workspace by scrolling horizontally. Related pages use the same centered content width.

## Article contents behavior

`ArticleContentsPopover` exports:

```ts
interface OutlineItem {
  id: string;
  level: number;
  label: string;
  element: HTMLHeadingElement;
}

interface ArticleContentsPopoverProps {
  articleRootRef: React.RefObject<HTMLElement>;
  pageKey: string;
}
```

It reads only real `h1[id]` through `h6[id]` elements beneath the page Markdown root. IDs come from the existing `rehype-slug` and AgentWiki alias pipeline. The component does not parse Markdown or generate slugs. It removes the appended hidden heading-anchor text from labels, retains duplicate labels with their distinct rendered IDs, supports Chinese and inline formatting, excludes code text and embedded-page headings, and hides the trigger when there are no headings.

A scoped `MutationObserver` refreshes the outline for deferred Markdown/embed work, heading text or ID changes, and page changes. The popover is closed by default, is anchored below its trigger, uses a maximum width of 280px, scrolls internally under a viewport maximum, adds no overlay, and does not reserve article width. Its fixed position comes from the trigger's current rectangle and is clamped to 16px viewport side margins, so the adjacent Page information button cannot push it beyond a 390px screen.

Escape closes and calls `focus({ preventScroll: true })` on the trigger. Outside click closes without forcing focus. Item click scrolls the actual rendered heading and subtracts the measured sticky reading-toolbar bottom plus 12px; if no toolbar is present, it uses the 88px fallback. The active item follows the actual scroll owner discovered from the article ancestry.

## Page information behavior

`PageInfoPanel` is a right-side on-demand panel. It preserves the previous source, extraction run, candidate change, approval, latest modifier/change link, evidence quote/location/commit/files, and human-page fallback. Delete remains available only to editors and calls the unchanged `PagePreview.handleDelete`, which still fetches the content-tree revision and sends the existing page `updatedAt` plus tree revision in the DELETE body. Read-only pages show no Edit or Delete action.

The information panel adds no backdrop. Escape returns focus without scrolling, outside click closes without refocusing, and a page change remounts it closed.

## TDD evidence

The first focused run was RED for the intended reasons: both new component imports were missing, and `PagePreview` still rendered an icon-only Edit control, permanent source column, and card layout. After implementation, focused coverage passed 35/35.

Coverage includes rendered duplicate headings, Chinese headings, inline formatting, code-block hash exclusion, no-heading suppression, deferred DOM changes, page switches, current-section updates, nested scroll navigation, measured sticky offset, 390px viewport clamping, Escape/outside-click focus rules, provenance/change/evidence preservation, read-only permissions, human-page empty state, centered article styling, authoritative breadcrumb URLs, existing delete compare-and-swap, and task-checkbox behavior.

Fresh affected regression:

```sh
pnpm --filter @agentwiki/client test \
  src/features/space-workspace/ArticleContentsPopover.spec.tsx \
  src/features/space-workspace/PageInfoPanel.spec.tsx \
  src/features/page/PagePreview.spec.tsx \
  src/components/Markdown.spec.tsx \
  src/components/markdown
```

Result: the pre-mobile-fix run passed 307/307. The final run after adding the 390px viewport regression passed 308/308; see the final verification output associated with the commit.

Fresh static verification:

```sh
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client exec eslint \
  src/features/space-workspace/ArticleContentsPopover.tsx \
  src/features/space-workspace/ArticleContentsPopover.spec.tsx \
  src/features/space-workspace/PageInfoPanel.tsx \
  src/features/space-workspace/PageInfoPanel.spec.tsx \
  src/features/page/PagePreview.tsx \
  src/features/page/PagePreview.spec.tsx \
  src/i18n/messages.ts
```

Result: both exited 0; ESLint reported 0 warnings and 0 errors.

Controller browser evidence while implementation was live:

- 1440x1000: article remained 860px wide; contents opened as a 280px overlay and closed without changing layout width.
- Native click and Escape preserved `scrollY=2380.5`, proving the earlier 266px movement was the browser locator auto-scrolling the sticky trigger rather than product behavior; focus returned to the trigger.
- Clicking the sample section 12 placed the heading below the measured toolbar (`heading top 137px`, `toolbar bottom 125px`).
- Existing provenance, changes, and Delete were visible in page information; the real parent-folder breadcrumb appeared after the Task 2 chain loaded.
- A real 390x844 check exposed the earlier right-aligned popover at `left=-49px`. The new focused regression reproduced that missing clamp before the fix. The fixed anchor now comes from the trigger and is clamped to a 16px minimum margin; controller HMR recheck measured the contents navigation at `x=32px`, width `280px`, fully inside the viewport.
- Final independent controller acceptance remains the controller's responsibility after the stable commit.

## Risks and handoff

- Current-section tracking uses bounding boxes against the actual scroll owner and the measured toolbar. Browser acceptance covered the current desktop workspace; final Task 7 should also exercise long content and narrow-screen toolbar wrapping.
- The page information surface is intentionally presentation-only. Task 4 must add editor dirty-navigation guards without moving mutation ownership into these components.
- Task 2's separately discovered same-Space cross-folder cache-continuity issue is outside these files and is not claimed fixed here.
