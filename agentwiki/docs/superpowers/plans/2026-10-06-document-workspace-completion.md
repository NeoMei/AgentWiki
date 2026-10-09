# Document Workspace Completion Implementation Plan

> Use subagent-driven-development, fresh implementer plus independent task review; controller owns commits and final integrated review.

**Goal:** Complete the five audited remaining document-workspace experiences approved by the user on 2026-10-06.
**Architecture:** One raw Markdown source in CodeMirror. Add guarded source-span table editing, explicit scoped server search, and identity-scoped view preferences; no full-document Markdown serialization.
**Tech Stack:** Existing React18/TypeScript/CodeMirror6/remark-GFM/Tailwind/Vitest.
**Spec:** `agentwiki/docs/research/openknowledge-20261006/借鉴分析与改造建议.md`; approved remaining-five-item audit copied to the task refs. Baseline `f1ed2bb0d7d8b7faedb218405d87fb070ffd58f7`.

## Global Constraints

- Worktree `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ` has a literal trailing space. Every Git call uses explicit --work-tree or GIT_WORK_TREE. Never change core.worktree.
- Use current inherited p5c07ff/gpt-6-astra/ultra: fork_turns=all, no model/effort override; verify each agent latest actual turn_context. No other-account fallback.
- Single source and mutually exclusive edit/preview. Preserve raw Markdown outside the intentional edit, existing brand/components, bilingual useLanguage copy, keyboard access and 390px usability. No new dependency, CRDT or editor replacement.
- Preserve user/Space/page isolation, revoked-permission handling, treeRevision/expectedUpdatedAt, explicit candidate acceptance, isolated undo and explicit Save. No automatic source write merely opening UI.
- No production mutation, merge, push, release or deploy. Local fixtures isolated with existing folder-test-database helper and reviewed migration digest; no shared Redis/DB resets.
- Implementers only edit assigned product/test files, never commit or spawn agents. Meaningful behavior regression RED/GREEN, focused tests/typecheck/lint; controller runs appropriate full checks once. Never raise bundle budgets.

### Task 1: Selection continuity across edit and preview

Files: `apps/client/src/components/MarkdownWorkspace.tsx` + its specs; `features/page/PageEditor.tsx` + spec; optional focused selection helper in markdown-tools.

- [x] Add an optional in-memory selection bookmark to MarkdownWorkspacePosition retaining anchor/head direction and original-source validation. Avoid writing document/selection text into persisted workspace preferences.
- [x] Capture full nonempty selection. Restore it only on the same page/identity and unchanged original source; otherwise preserve existing clamped semantic cursor fallback. Example: reverse anchor8/head2 returns reverse selection after preview roundtrip, not cursor2.
- [x] PageEditor preview roundtrip carries the original bookmark only when preview remains at the originating source block; deliberate preview navigation to another paragraph wins. Clear bookmark on page/identity changes.
- [x] Tests: forward/reverse selection, empty cursor, repeated same text, source change refusal, same-block toggle, different preview block, identity/page change. Existing source unchanged and undo history unaffected. Focused MarkdownWorkspace/PageEditor suites and client tsc/eslint.

### Task 2: Current document stays visible in directory

Files: `features/space-workspace/SpaceDirectory.tsx` and spec; only if needed useSpaceDirectory + focused spec.

- [x] Distinguish initial saved-scroll restoration from a genuine selectedPageId change within the same preference scope. Preserve initial reload position and user scrolling while on the same page.
- [x] On page change, clear any local filter hiding the current page and defer nearest reveal until the current row and loaded ancestry exist. Only scroll if row is outside the visible scrollport. Do not move focus, mutate nodes, reset expansion or repeatedly snap back on unrelated rerenders.
- [x] Cover nonzero previous scroll, late child-level load, visible row no-scroll, same-page manual scrolling, identity/scope reset, active filter, collapsed/mobile drawer reopening. Keep existing manual locate action.
- [x] Run SpaceDirectory/useSpaceDirectory focused suites, client tsc/eslint. Root reproduced bottom-of-tree menu clipping in the130-page production fixture: last-row trigger y674–702, downward actions y711–811 outside720px viewport. Include a bounded same-directory menu placement/keyboard closure fix with regression; no global menu rewrite.

### Task 3: Persistent right-side panel preferences and resizing

Files: workspacePreferences/SpaceWorkspaceContext and specs; ArticleContentsPopover + specs; PageEditor + specs; PagePreview/MarkdownWorkspace only for minimal scope wiring; a focused shared PanelResizeHandle + spec; existing document CSS.

- [x] Extend backward-compatible scoped preferences with optional outlineOpen, outlineWidth, collaborationOpen, collaborationTab (assist|notes), collaborationWidth. Old records get defaults; invalid enum/nonfinite width is clamped; storage failure degrades to memory. Persist preferences only, never candidate/notes/document data.
- [x] Remember explicit outline open/close across same-Space documents and read/edit. Respect default wide-screen auto-open only until user chooses. Temporary mobile dismissal must not erase desktop preference. While Assist overlaps, preserve outline preference without overlapping both drawers.
- [x] Remember collaboration panel open/tab and width per user+Space, but suppress inaccessible notes/actions under live permissions and preserve candidate mount/lifecycle. Reopening restores only UI preference, not historical candidates or task auto-submission.
- [x] Add visible desktop resize handles to outline and collaboration panel using pointer capture and keyboard arrows/Home/End. Bound widths (outline200–360, collaboration320–520), viewport clamping and adequate document width; mobile stays a viewport-contained drawer, never persists its forced width.
- [x] Test old/malformed prefs, account/Space isolation, explicit close survives page/mode changes and viewport changes, tab/open restore, permission loss, pointer/keyboard width updates, mobile clamping. Run affected preferences/context/outline/editor suites and static checks.

### Task 4: Search authorized pages across the Space

Files: `components/markdown-tools/useAuthorizedPageLinks.ts`, `DocumentTools.tsx`, specs; MarkdownWorkspace callback type; PageEditor minimal type wiring if needed. Use existing server API; no backend contract change.

- [x] Extend onRequestPageLinks to accept optional query and an optional caller AbortSignal for immediate close/query/unmount cancellation (zero/one-argument callers stay compatible). Empty query may show bounded recent pages; nonempty trimmed query searches existing GET /search with q, explicit spaceId and limit50. Search has authorized server scope; extract results[].page, validate page spaceId/title/id and deduplicate by ID. Do not fetch all document bodies to work around the limit.
- [x] Debounce query300ms, abort superseded network calls; distinguish loading/error/empty and bounded results with accurate bilingual wording. Do not filter server content-search results by local title afterward. Keep provided-pages fallback for consumers without callback.
- [x] Stale query or user/Space/page/permission results never enter UI. Closing/unmounting invalidates pending UI updates. Link insertion still validates original source/selection; choosing a result is one existing undoable insertion.
- [x] Tests find a page absent from initial recent100, query races, close/reopen, failure/retry, returned wrong-Space rows, revoked permission, identity change, duplicate IDs and original-source-change refusal. Run hook/DocumentTools/MarkdownWorkspace/PageEditor affected suites and static checks.

### Task 5: Source-preserving visual GFM table editing

Files: new `components/markdown-tools/tableEditing.ts` + spec, `TableEditor.tsx` + spec; minimal MarkdownWorkspace/DocumentTools integration + specs and PageEditor live tableEditingEnabled permission wiring + focused test; existing document CSS if necessary.

- [x] Detect the top-level GFM table containing current cursor/selection using existing remark-GFM source positions. Provide discoverable Edit table action only for a supported table; unsupported nested/ambiguous tables keep normal source editing with clear reason if invoked. Bound editor to100rows/30columns and explain larger tables use source.
- [x] A keyboard-accessible dialog displays editable cells and alignment; add/remove row/column and move rows/columns via explicit controls, preserving a header row and at least one column. Escape/cancel closes with no source mutation; focus returns to editor. Inputs edit cell Markdown, label that fact; handle literal/escaped pipes correctly, preserve inline Markdown in untouched cells and reject unsupported multiline cell content rather than corrupting structure.
- [x] Opening/applying an unchanged grid produces zero document transaction. Apply computes only the intentional table source-span replacement and revalidates captured source/page identity/live editability before dispatch; changed document while dialog open refuses and asks to reopen. One isolated CodeMirror undo restores exact previous bytes. Preserve all source outside the table including YAML, rawHTML, callouts, WikiLinks, reference definitions, Unicode and newline styles.
- [x] Retain raw rows/cells where unchanged; only canonicalize structurally edited rows inside target table when necessary. Preserve LF and table trailing newline boundary in product transactions; source tables with escaped pipes, inline code, optional outer pipes and alignment survive no-op unchanged. Raw helper operations preserve CRLF, but actual UI must refuse CRLF/mixed source whenever it differs from the normalized CodeMirror document and explain the source-editing fallback before mutation. Do not change the global lineSeparator or claim production CRLF visual editing.
- [x] Tests use real EditorState transactions plus17-fixture fidelity corpus as outside-table surroundings: no-op0diff, cell-only edit, rows/columns/alignment/move, escaped pipe/code/backslash, empty cells, final newline, helper CRLF fidelity plus production CRLF refusal without mutation, unknown syntax outside, stale source guard, cancel, read-only/identity unmount, undo. Run focused helper/UI/workspace tests and static checks.

## Final acceptance

- [x] Independent per-task spec+quality reviews, then one integrated final review of new delta with named first/second-round integration risks. One consolidated final fix wave and scoped rereview if required.
- [x] Full client tests, repo typecheck/lint, production client build and unchanged bundle gate. Backend unchanged: do not rerun unrelated server suites solely to inflate totals.
- [x] Isolated real API/production browser desktop and390px: mode roundtrip selection, nonzero directory navigation, remembered/resized panel, Space search beyond100 initial pages, edit cell/add row/column/cancel/undo exact source. Screenshots+console health; fixture/provider boundary honest.
- [x] Update original-study coverage matrix so delivered/remaining/explicit exclusions/environment gates are not confused. Archive durable receipts and project handoff, cleanup own runtime/auth/scratch, keep local branch without deployment.

## Completion receipt

Final product213a2aae. All five task reviews and final integrated/scoped review complete; all four integration findings closed. Final135client suites/2006tests, static checks and production budget548576/550000 pass. Actual desktop/390px acceptance plus source/API integrity and independent cleanup pass. See `agentwiki/docs/verification/document-workspace-completion-20261006/acceptance.md`. No merge/push/release/deploy.
