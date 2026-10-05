# Task 3 implementation report

## Outcome

Reading, preview and source editing now share an 860px document canvas, title/header rhythm, body typography and paragraph spacing. The title is an unframed document title; the editing surface has no secondary card or independently constrained body width. Assist opens in an overlay drawer and does not shrink document width. Existing history, Save/version preconditions, image attachment generation/anchors, read-only preview semantics and Task 1 acceptance checks are preserved.

Manual tools apply source transactions: bold, italic, inline code (including backticks), link, headings/list/task/quote/table/fenced code, and existing image upload. The compact source toolbar remains discoverable; a nonempty selection positions it near the selected text where CodeMirror can measure it. Slash appears at the caret only at a new block's beginning, excludes code fences, supports bilingual query, Up/Down/Enter/Escape and retains literal source on cancellation. Composition events, isComposing and keyCode 229 suppress slash interception; composition completion does not open a menu for the just-committed composition.

Page-link lookup is functional from PageEditor. It calls the existing authorized `/pages` endpoint only after opening the picker, with current Space and take=100 (server parseLimit maximum). The UI says up to 100 authorized pages, filter loaded results, shows Space and each page ID, and does not claim whole-Space search. Results are filtered by returned spaceId and stored only inside the mounted picker. User/Space/page/permission changes and unmount abort and invalidate old requests; picker key changes on user/permission transition. Failures are visible, sanitized and retryable. Duplicate titles insert supported `[[pageId|label]]`; display syntax characters are removed. If the source changes while the picker has focus, insertion is refused rather than applying stale offsets.

Shared AST outline uses existing unified/remark/GFM, mdast-util-to-string and github-slugger, source from/to offsets, setext and H1-H6, stable duplicate IDs, and excludes fenced pseudo-headings. Both read and edit consume this model. Render navigation resolves by source offset before slug; embedded-page headings are excluded. Wide screens (>=1600px) show a collapsible fixed side outline; narrow screens retain anchored portal popover. Assist explicitly suppresses automatic wide outline. Editor active headings follow selection and document scroll; click moves/focuses source caret. A collapsed outline stays collapsed when the same source is edited.

No production dependencies added, no commits/subagents spawned. All Git commands used explicit work-tree `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ` with its trailing space. Nested `agentwiki/.codegraph` is a placeholder: `codegraph explore` reported no index; normal source tools were used after that check.

## Exact owned files

Relative to repo root:

- `agentwiki/apps/client/src/components/MarkdownWorkspace.tsx`
- `agentwiki/apps/client/src/components/MarkdownWorkspace.spec.tsx`
- `agentwiki/apps/client/src/features/page/PageEditor.tsx` (presentation + approved on-demand lookup only)
- `agentwiki/apps/client/src/features/page/PageEditor.spec.tsx`
- `agentwiki/apps/client/src/features/page/PagePreview.tsx`
- `agentwiki/apps/client/src/features/page/PagePreview.spec.tsx`
- `agentwiki/apps/client/src/features/space-workspace/ArticleContentsPopover.tsx`
- `agentwiki/apps/client/src/features/space-workspace/ArticleContentsPopover.spec.tsx`
- `agentwiki/apps/client/src/index.css`
- New `agentwiki/apps/client/src/components/markdown-tools/commands.ts` and `commands.spec.ts`
- New `agentwiki/apps/client/src/components/markdown-tools/outline.ts` and `outline.spec.ts`
- New `agentwiki/apps/client/src/components/markdown-tools/DocumentTools.tsx`
- New `agentwiki/apps/client/src/components/markdown-tools/useAuthorizedPageLinks.ts` and `useAuthorizedPageLinks.spec.tsx`
- `.superpowers/sdd/2026-10-06-document-workspace/task-3-report.md`

Controller `.codex-memory` updates and parallel `localDrafts` files are untouched.

## Interfaces for Task 5

- `MarkdownWorkspaceHandle.captureSelection(): {from:number,to:number,text:string}` reads the current CodeMirror main range.
- `restoreSelection(selection): boolean` checks bounds and exact quoted source, restores/focuses, false if no editor or mismatch.
- Optional `onSelectionChange(selection)` callback fires on actual editor selection/document updates; `onRequestAssist(selection)` adds an Ask Agent action for nonempty selections. Controller can wire scoped Assist through these without altering manual commands.
- Optional `onRequestPageLinks(): Promise<PageLinkTarget[]>`, `pageLinksIdentity?:string` and `outlineOverlay?:boolean` support authorized lookup and panel layout.
- Preserved `replaceDocument(next):boolean` remains one isolated whole-document undo transaction.
- Manual formatting/insertion/page-link commands expose real TransactionSpec. Image upload insertion now also uses isolateHistory(full), fixing previously merged human+image undo, while preserving upload anchors and async generation checks.

## RED/GREEN and verification receipts

Commands from repository `agentwiki` directory, using `pnpm --filter @agentwiki/client exec vitest run ...`:

1. `/tmp/document-task3-tools-red.log`: 2 suites,12 failed against intentionally empty command/outline implementations; real EditorState changes, caret, undo and AST contracts absent. First GREEN exposed two incorrect hand-counted outline fixture offsets; corrected expected UTF-16 source positions 21..24 and quote29 (not production logic).
2. `/tmp/document-task3-workspace-red.log`:5 failed,59 passed, missing format/selection/slash/picker/edit outline features. IME test initially exposed CodeMirror's default Enter insertion during synthetic composing event; handler now consumes composition-key shortcuts without generating a tool command.
3. `/tmp/document-task3-outline-red.log`:2 failed,8 passed, missing shared source navigation and wide side outline.
4. `/tmp/document-task3-entry-red.log`:2 failed,86 passed, actual PageEditor missing lookup/results and visible retrieval failure.
5. `/tmp/document-task3-links-red.log`:first hook assertion failed missing response behavior; second had an unresolved stub setup error and is NOT counted as valid RED. Final hook GREEN verifies no eager fetch, exact bounded request, returned Space filtering, aborted identity/permission delayed results and permission refusal.
6. `/tmp/document-task3-boundary-red.log`:3 failed,75 passed; active edit outline was not updated with no preview root, collapse reopened on edits, image undo merged prior typing. `/tmp/document-task3-boundary-green.log`:2 suites78passed after fixes.
7. Final `/tmp/document-task3-final-tests.log`: **9 suites,265 tests passed**,3.10seconds,exit0. Suites: MarkdownWorkspace, Markdown, commands, outline, useAuthorizedPageLinks, PageEditor, PagePreview, ArticleContentsPopover, workspaceNavigation.spec.ts. Includes all legacy image MIME/upload anchor/async cases, position restore/checklist/version tests and Task1 acceptance guards in editor suite.
8. `pnpm --filter @agentwiki/client exec tsc --noEmit`: `/tmp/document-task3-final-typecheck.log`, **exit0**,empty output.
9. `git --work-tree='/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ' diff --check`: **exit0**.

PagePreview tests' obsolete exact Tailwind-class checks were replaced with real article content containment; deferred embed test now locates the shared document-body rather than old prose style class. Visual layout is not asserted through class snapshots.

## Review and remaining limits

- Independent review, controller browser desktop/narrow acceptance, Chinese native IME acceptance, exact commit and whole-branch validation remain controller gates; tests are not a claim of native/browser visual acceptance or live provider generation.
- Page picker intentionally bounded to most-recent100 returned authorized pages. No complete Space search/pagination added.
- Source remains the current Markdown/CodeMirror interaction; table row/column rich editing remains the separate visual-editor feasibility task.
- Formatting modifies current main selection; it does not silently normalize other source or switch engines. Dialog insertion uses conservative exact full-source baseline to reject concurrent source movement.
- Wide outline opens only at1600px where canvas has room; narrower screen/Assist use overlays, preserving central canvas width.

## Independent review 1 correction — slash viewport placement

Review baseline `592470e9`; controller reproduced 1280×720 bottom caret706 with menu top718.75,bottom991.75,height273. Fixed only Task3 menu positioning files, no commit or sibling task modifications.

- Slash menu is now a fixed body portal, avoiding article/scroll-parent clipping and transformation context.
- `markdown-tools/menuPosition.ts` consumes real caret rectangle, measured menu width/natural scrollHeight plus border, and current viewport. It keeps a fitting measured menu below, flips above when more room exists, clamps left/top/width, and constrains height to available space. It does not assume a menu height from a guessed constant.
- Workspace measures in layout effect and remeasures on document/window scroll, window resize, menu ResizeObserver, query/result count and language changes. Available options remain scrollable when height is limited.
- Keyboard active option is scrolled inside the menu by actual option offsetTop/offsetHeight and menu clientHeight. Source insertion, Escape source preservation, focus return and existing composition guards are unchanged.

Exact repair files: `agentwiki/apps/client/src/components/MarkdownWorkspace.tsx`, `MarkdownWorkspace.spec.tsx`, `agentwiki/apps/client/src/index.css`, new `agentwiki/apps/client/src/components/markdown-tools/menuPosition.ts`, `menuPosition.spec.ts`, and this report.

RED: `/tmp/document-task3-menu-red.log`, **6failed67passed**,2suites. Failures cover actual controller273px bottom flip, short menu below, narrow oversize menu and offscreen anchor clamping, real mounted menu measurement/portal/scroll/resize, and keyboard active option visibility. One first GREEN failure exposed window-scroll events were not covered by document capture in jsdom; added explicit passive window scroll listener, both listeners clean up.

Final scoped command: `pnpm --filter @agentwiki/client exec vitest run src/components/markdown-tools/menuPosition.spec.ts src/components/markdown-tools/commands.spec.ts src/components/MarkdownWorkspace.spec.tsx`. `/tmp/document-task3-menu-verified.log`: **3suites83passed**,2.14seconds,exit0. Includes IME guard, slash source/keyboard/undo, image upload anchors and command transactions. Exact repair diff-check exit0.

`pnpm --filter @agentwiki/client exec tsc --noEmit` initially found a sibling Task5 `assistTargets.ts:21` `.at` ES target error; reported to controller/owner without editing it. Final typecheck receipt is `/tmp/document-task3-menu-final-typecheck.log`; consult its actual output for concurrent tree state. Controller browser bottom-edge desktop/narrow acceptance and scoped independent re-review remain required. Files are frozen after this report.

## Browser wide-layout correction — preserve toolbar access

Controller reproduced1680×1000 auto outline at top140 overlapping the PageEditor action toolbar y162..222 and hiding Assist, while canvas/outline columns themselves did not overlap. Scoped correction changes only `agentwiki/apps/client/src/features/space-workspace/ArticleContentsPopover.tsx`, its spec, and this report; PageEditor/Task4 files untouched.

The outline now finds the toolbar in its own ancestor workspace (reading trigger's closest toolbar or editor toolbar in enclosing workspace), measures the toolbar bottom and places wide outline at max(140,ceil(bottom)+12). Its viewport maxHeight follows that safe top. Existing scroll/resize placement updates remain, and a ResizeObserver remeasures if the toolbar's own dimensions change; cleanup disconnects it. Narrow anchored popover, heading offsets, collapse/focus and canvas dimensions are retained.

RED `/tmp/document-task3-wide-toolbar-red.log`:1failed11passed, asserting supplied toolbar bottom222 yields top234 and height750, then follows resize bottom280→top292 and scrolled bottom128→top140. GREEN `/tmp/document-task3-wide-toolbar-green.log`:1suite12passed,516ms,exit0. Typecheck `/tmp/document-task3-wide-toolbar-typecheck.log`:exit0,empty output. Exact two-file `git --work-tree=... diff --check` exit0. Controller real wide toolbar access acceptance remains the browser gate. Files are frozen for exact scoped commit/review.
