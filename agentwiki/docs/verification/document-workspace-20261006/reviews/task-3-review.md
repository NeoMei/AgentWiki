### Spec Compliance

- ❌ Issues found: the slash insert menu is unusable when the caret is near the bottom of the viewport. The required accessible manual insertion interaction needs the Important fix below (`agentwiki/apps/client/src/components/MarkdownWorkspace.tsx:435`, `agentwiki/apps/client/src/index.css:70`). Other inspected requirements are implemented.
- ✅ The canvas is shared across read/edit/preview (`features/page/PageEditor.tsx:1116`, `features/page/PagePreview.tsx:622`, `index.css:34`); source and preview remain mutually exclusive (`components/MarkdownWorkspace.tsx:814`). Existing Save/version/history handlers are not modified in this task's package; Task 1's isolated whole-document acceptance transaction remains intact (`components/MarkdownWorkspace.tsx:650-660`).
- ✅ Formatting and block/link insertion produce isolated transactions without changing unrelated source (`components/markdown-tools/commands.ts:11-54`); the image path adds the same isolation while retaining existing upload anchors (`components/MarkdownWorkspace.tsx:241-252`). Selection capture/validated restore and optional Assist callbacks are exposed (`components/MarkdownWorkspace.tsx:39-43,662-671`).
- ✅ Authorized page lookup follows the controller's bounded lazy-load ruling (`components/markdown-tools/useAuthorizedPageLinks.ts:14-26`), accurately labels loaded-result filtering and exposes duplicate identities (`components/markdown-tools/DocumentTools.tsx:90-105`). Permission/identity invalidation and stale-source refusal are present (`useAuthorizedPageLinks.ts:10-21`, `DocumentTools.tsx:101`).
- ✅ Shared AST headings exclude fenced code, retain duplicate slugs and UTF-16 source offsets (`components/markdown-tools/outline.ts:9-21`, `outline.spec.ts:4-16`); both modes consume the model with source-aware navigation and Assist overlay suppression (`components/MarkdownWorkspace.tsx:780-783`, `features/page/PagePreview.tsx:594`, `features/space-workspace/ArticleContentsPopover.tsx:96-103,180-190`). New user-facing tool labels have Chinese and English variants (`DocumentTools.tsx:81-105`, `MarkdownWorkspace.tsx:794-804`).
- ⚠️ Controller acceptance remains necessary for native Chinese IME, full visual width/title/body rhythm, and read/edit navigation in actual browser scroll containers. Static/source inspection and reported unit tests do not establish those outcomes.

### Strengths

- Real EditorState tests exercise selected text, empty caret, backtick delimiters, link destination, source preservation and one-step undo (`components/markdown-tools/commands.spec.ts:7-48`). Workspace tests exercise the actual CodeMirror path for selection, slash keyboard interaction, IME suppression, stale dialog offsets and image undo (`components/MarkdownWorkspace.spec.tsx:148-237`).
- Picker requests are deferred, bounded, abortable and scoped, with sanitized retryable failures; results are not cached globally (`useAuthorizedPageLinks.ts:10-26`, `DocumentTools.tsx:59-74,94-101`).
- Existing acceptance replacement still isolates undo, and image insertion now isolates undo from preceding human typing (`MarkdownWorkspace.tsx:251,657`, `MarkdownWorkspace.spec.tsx:215-228`).

### Issues

#### Critical (Must Fix)

- None found.

#### Important (Should Fix)

- **Keep the slash menu inside the viewport.** `agentwiki/apps/client/src/components/MarkdownWorkspace.tsx:435` always positions the menu below the trigger using `coords.bottom - root.top + 4`; `agentwiki/apps/client/src/index.css:70` supplies an absolute 300px maximum-height menu with no viewport-dependent limit or placement flip. At a final new block near the lower edge, the controller measured a 1280×720 viewport with menu top 718.75 and bottom 991.75 (height 273); the supplied screenshot `/tmp/agentwiki-document-workspace-ui-evidence/slash-bottom-clipped.jpg` independently confirms that `/` is visible at the lower edge while the menu choices are offscreen. Users cannot see or pointer-select the required insertion options, and keyboard navigation gives no visible selection feedback. Measure available viewport space, flip above the caret when needed, clamp both coordinates and available height, and remeasure on scroll/resize. Validate bottom-edge insertion at desktop and narrow widths, including a visible active option after Up/Down.

#### Minor (Nice to Have)

- None reported.

### Assessment

**Task quality:** Needs fixes.

**Reasoning:** Source transaction safety, scoped link retrieval and outline modeling are well supported by the diff and tests. The reproduced viewport clipping blocks a central new interaction and needs correction before this task passes.

### Review Evidence and Bounds

- Reviewed the fixed `8ddaf98a..592470e9` package, commits/stat/full diff. Initial tool output was truncated, so only undelivered ranges were recovered from the same package. No git commands, index mutations, code edits or subagents were used.
- Named risk: removal of the nested scrolling surface could break semantic position restoration. The diff omitted the middle of those functions, so the one focused outside-diff check read `MarkdownWorkspace.tsx:564-645`; semantic cursor/source restoration and `EditorView.scrollIntoView` are retained. Actual browser scroll restoration remains the controller gate above.
- Named risk: the IME guard returns `true` for composition keys. One focused dependency check inspected the installed CodeMirror `InputState` event handling (`@codemirror/view/dist/index.js:4543-4563,4635-4647`); native composition key events are ignored before these handlers. No unsupported native IME regression is claimed from the synthetic test alone.
- Controller-supplied concrete browser risk: bottom-edge slash clipping. Verified the package's positioning/CSS and viewed the supplied screenshot; did not run a competing browser session.
- Read existing final receipts: `/tmp/document-task3-final-tests.log` reports 9 suites and 265 tests passed, duration 3.10s, with no warnings; `/tmp/document-task3-final-typecheck.log` is empty, consistent with the implementer's clean typecheck claim. No tests were rerun because these results answer the source-level checks; the uncovered failure is actual viewport layout.
