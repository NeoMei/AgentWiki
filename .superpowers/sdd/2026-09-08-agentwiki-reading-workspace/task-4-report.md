# Task 4 report: editor continuity and dirty navigation

## Scope and architecture

- Worktree: `/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/reading-workspace-20260908`
- Branch: `codex/reading-workspace-20260908`
- Starting baseline: `b69241aa`
- Scope stayed in the client editor, reading-position bridge, application router wiring, translations, tests, and this report. No server, schema, dependency, authorization, sync, controller, or runtime changes were made.
- Controller-owned `.codex-memory` changes were left untouched and are excluded from this task's commit.
- The worktree contains an `agentwiki/.codegraph` directory, but the isolated worktree has no usable CodeGraph index. `codegraph explore` reported that indexing is unavailable, so repository reads used `rg`/targeted source inspection without creating an index.

`App` now uses React Router's supported data-router entry point (`createBrowserRouter` + `RouterProvider`) around the existing declarative `AppRoutes`. The Language, ErrorBoundary, Auth, workspace provider, lazy routes, redirects, and protected-route behavior remain in the same order. This is the minimum router change needed for `useBlocker` to stop navigation before the location changes.

One `NavigationGuardProvider` owns the router blocker. `PageEditor` registers its dirty state and localized message through `useDirtyNavigationGuard`; the provider therefore covers ordinary `Link`, any component's `useNavigate`, and browser POP transitions. `useBeforeUnload` supplies native close/reload protection. The editor no longer tries to resurrect a draft after navigation or intercept only its own buttons.

## Editor behavior

- The existing `handleSave` and its PATCH payload are retained. Content still sends `expectedUpdatedAt`; a title change still obtains and sends `expectedTreeRevision`. No save controller or backend contract changed.
- Save is a readable text button with Save, Saving, and Saved states. A successful save remains on `/edit`.
- Saving captures the existing `editRevision`; input made while the request is pending remains dirty after the earlier request succeeds.
- Preview and Return to reading are separate text actions. Preview renders the current local buffer in the existing `MarkdownWorkspace` and makes no page PATCH. Return to reading carries semantic position and is guarded while dirty.
- Existing attachment, template, Agent binding, collaboration presence, versions, assist streaming, permission loss, remote update, and 409 conflict paths remain mounted and conditionally available under their original rules.
- The editor content stays approximately 860px wide. The title remains at the top of that content area. Authoritative Task 2 directory crumbs and the primary editor actions now share a sticky workspace toolbar; the action row wraps at narrow widths, preserving the text Save, Preview/Return to edit, Return to reading, Versions, and Editing assist controls at 390px.
- The editor toolbar deliberately has no `backdrop-filter`, so the existing fixed-position More menu keeps viewport coordinates. Task 3's reading popovers remain body portals and are unchanged.

## Continuity interfaces

### `workspaceNavigation.ts`

```ts
interface WorkspacePosition {
  pageId: string;
  cursorOffset: number | null;
  headingId: string | null;
  headingText: string | null;
  scrollTop: number;
}

rememberWorkspacePosition(entryKey, position): void
readWorkspacePosition(entryKey, pageId): WorkspacePosition | null
captureReadingPosition(root, stickyBottom?, pageId?): WorkspacePosition
renderedHeadingText(heading): string
useDirtyNavigationGuard(active, message): void
useGuardedNavigate(): NavigateFunction
```

Reading positions are keyed by the React Router history-entry key and checked against the page ID. The reader records the last rendered heading at or above the sticky toolbar boundary, strips hidden heading-anchor text, and keeps pixels only as a final fallback. An ordinary PUSH to another page starts at the top. POP waits for the requested page body before consuming the saved entry, then restores its real heading. This avoids stale A/B page data consuming an entry during an asynchronous route load.

### `MarkdownWorkspace`

```ts
interface MarkdownWorkspacePosition {
  cursorOffset: number | null;
  headingText: string | null;
  scrollTop: number;
}

interface MarkdownWorkspaceHandle {
  // existing methods omitted
  capturePosition(): MarkdownWorkspacePosition;
  restorePosition(position: MarkdownWorkspacePosition): void;
}
```

Edit capture records the CodeMirror cursor, nearest preceding Markdown heading, and local scroll fallback. Preview capture reads the current real rendered heading against the sticky toolbar boundary rather than consulting the unmounted CodeMirror view. Restore maps a reading heading back to its Markdown source position or uses the exact saved cursor. If the imperative handle exists before CodeMirror's `onCreateEditor`, it queues the position and applies it as soon as the `EditorView` mounts. It asks CodeMirror to reveal the selection immediately and again on the next animation frame after layout. A semantic heading/cursor is never overwritten with the reading view's unrelated pixel offset. Editor preview restores the matching rendered heading; returning to edit restores the cursor.

## TDD evidence

The first dirty-navigation RED failed because the provider/hooks did not exist. GREEN proves a cancelled Link, plain `useNavigate`, and POP remain on the editor route and keep the changed textarea value. A separate confirmed-leave case proves the pending transition proceeds only after confirmation. PageEditor integration repeats cancellation for parent directory, Space graph, Versions, Return to reading, and browser back while preserving the CodeMirror buffer.

Additional RED/GREEN passes covered:

- missing distinct Return to reading and readable Save/Preview actions;
- missing CodeMirror position handle;
- editor preview writing or failing to show the local buffer;
- reading headings polluted by the hidden anchor marker;
- heading-text restore falling back to unrelated pixels;
- an ordinary PUSH retaining the previous page's scroll;
- A -> B -> POP -> A consuming the history entry before A finished loading;
- a semantic CodeMirror cursor being overwritten by the reader's pixel offset;
- the PageEditor layout restore running before CodeMirror supplied its `EditorView`;
- preview Return to reading reading an already unmounted CodeMirror view instead of the visible rendered heading;
- missing authoritative crumbs/sticky primary editor toolbar.

Fresh required command:

```sh
pnpm --filter @agentwiki/client test \
  src/features/page/PageEditor.spec.tsx \
  src/features/page/AgentAssistPanel.spec.tsx \
  src/features/space-workspace/workspaceNavigation.spec.ts
```

Result: 3 files passed, 79 tests passed, 0 failed.

Fresh affected-router/editor/workspace command:

```sh
pnpm --filter @agentwiki/client test \
  src/App.spec.tsx \
  src/features/page/PageEditor.spec.tsx \
  src/features/page/PagePreview.spec.tsx \
  src/features/page/PageVersionHistory.spec.tsx \
  src/features/page/AgentAssistPanel.spec.tsx \
  src/components/MarkdownWorkspace.spec.tsx \
  src/features/space-workspace/workspaceNavigation.spec.ts \
  src/features/space-workspace/SpaceWorkspace.spec.tsx \
  src/features/space-workspace/SpaceDirectory.spec.tsx
```

Result: 9 files passed, 197 tests passed, 0 failed.

`pnpm --filter @agentwiki/client exec tsc --noEmit` exited 0. Scoped ESLint over all Task 4 TypeScript/TSX changes exited 0 with no diagnostics. `git diff --check` exited 0.

## Controller real-browser and API evidence

The controller exercised the real client at port 5188 against the real API at port 53088:

- A dirty tree page click opened the browser confirmation. Dismissing it kept `/edit`, the local draft, dirty state, and selected directory item.
- Space Settings, Versions, and Return to reading each opened the same protection; cancellation retained `/edit` and the draft.
- A real SPA history entry was established by reading -> editing. Browser Back opened confirmation; dismissing it retained `/edit`, the `POP-DRAFT` buffer, and selected directory item. This separates the supported POP flow from an earlier direct-entry check that had no prior SPA entry.
- Reading heading `示例段落 12` -> native Edit restored the CodeMirror active line to `### 示例段落 12`. The editor window was at 47px, `.cm-scroller` at 1343.5px, and the active line at 620.5px inside the viewport instead of the first heading. The sticky authoritative crumbs and action toolbar rendered normally in the same real layout.
- The complete semantic round trip passed in the real layout: reading `示例段落 12` -> native Edit kept active line 12 -> Preview placed rendered heading 12 at 178px -> Return to reading restored window scroll to 2381.5px and heading 12 to 136px, directly below the 125px toolbar.
- Preview displayed the unsaved buffer. Network observation recorded zero PATCH requests during preview, and a GET before Save still returned the old empty content and old `updatedAt`.
- Save produced a real PATCH whose subsequent GET contained the marker and a newer `updatedAt`. The editor stayed on `/edit` and Save became disabled.
- With the real PATCH paused, text entered after Save began stayed in the editor and remained dirty after the earlier payload succeeded. The server GET contained only `SAVE-FIRST-20260908`, not `NEW-TYPING-DURING-SAVE-20260908`.
- A deliberately stale real PATCH returned 409 after a separate current-CAS remote update. The editor exposed the remote-update actions, retained the local draft and dirty state, and disabled Save while the conflict was present. Keep local dismissed the prompt without changing the baseline, so another Save correctly conflicted again. Accept remote adopted the server content, cleared dirty state, and disabled Save.
- Confirming Return to reading discarded only the local test draft; the server's accepted remote content remained unchanged.
- At a 390px viewport, Return to reading, Save, and Preview all remained inside the viewport and `document.scrollWidth` stayed 390px. With an unsaved `MOBILE-DRAFT`, opening the directory drawer and dismissing a sibling-page navigation confirmation kept the drawer open, retained `/edit`, and preserved the draft. The controller then closed the drawer and confirmed Return to reading to discard only that test draft; no server save occurred. The viewport was restored to 1440px afterward.

## Review boundary

- Native close/reload prompts are browser-controlled and cannot expose custom text; the code installs the standard `beforeunload` contract while dirty.
- Position storage is intentionally in-memory and scoped to the current application lifetime. Refresh does not persist the editor cursor or reading position across sessions.
- The data-router confirmation continuation test uses a minimal test-only Request shim because Node 24's native `Request` rejects jsdom's cross-realm `AbortSignal`. Production uses the browser's native same-realm Request/AbortSignal and the controller verified real Link, programmatic, and POP blocking.

## Review fix round 1

Independent review found three Important position-continuity gaps. The fixes retain the same router guard and save path:

- The existing Markdown pipeline now copies remark/rehype's own `node.position.start.offset` onto real rendered block elements. Reading capture selects the block nearest the sticky reading boundary, while editor capture parses the same source with the existing remark parser and records the cursor's enclosing block offset. Reading, edit, preview, and POP records carry this `sourceOffset`; headings and pixels remain fallbacks. A block just below the sticky boundary is selected when it is closer than the preceding block, preventing a one-paragraph regression at the preview boundary.
- `MarkdownWorkspacePosition` also carries the real `headingId` produced by the existing `rehype-slug` pipeline. No new slugger or renderer exists. A repeated-heading restore uses the source block first and the real ID second, so the second duplicate does not fall back to the first equal label.
- Ctrl/Cmd+E now calls the same capture-and-toggle function as the visible Preview/Return to edit button. Returning directly from the preview keeps the exact editor cursor while changing the preview position still maps through the visible Markdown block.

RED evidence before implementation: four expected failures across three test files showed missing `sourceOffset`, second repeated-heading restore receiving the first heading offset, and Ctrl/Cmd+E returning cursor `0` instead of the non-top cursor `36`.

GREEN coverage added:

- a 20-paragraph section round-trips paragraph 12 through editor and rendered preview using the Markdown AST source offset;
- a block 12px below the sticky boundary wins over the farther previous paragraph;
- Ctrl+E into preview and Cmd+E back to edit retain a non-top cursor;
- the second of two `Repeat` headings stays the second occurrence across reading -> edit -> preview -> reading;
- PagePreview restores a long-section paragraph from source offset before heading or pixels.

Focused round-1 verification after the sticky-boundary fixes:

- `pnpm --filter @agentwiki/client test src/features/space-workspace/workspaceNavigation.spec.ts src/components/MarkdownWorkspace.spec.tsx src/features/page/PageEditor.spec.tsx src/features/page/PagePreview.spec.tsx`: 4 files passed, 166 tests passed, 0 failed.
- `pnpm --filter @agentwiki/client exec tsc --noEmit`: exited 0.
- scoped ESLint over the nine round-1 source/test files: exited 0 with no diagnostics.
- `git diff --check`: exited 0.

The final boundary correction keeps the pre-preview editor cursor when Ctrl/Cmd+E returns to edit, so a paragraph exactly below the preview toolbar cannot select its preceding block. Return-to-reading then offsets `scrollIntoView` upward by the actual sticky-toolbar overlap; this keeps a restored duplicate heading below the toolbar instead of hidden under it. Hash targets remain owned by the existing hash effect, preventing the semantic restore effect from issuing a second scroll.

The controller then repeated the real browser flow against the prepared long-section/duplicate-heading fixture. A paragraph near the end of the long section stayed on that paragraph through Edit -> Meta+E preview -> Meta+E edit, with the preview block at 178px. The second `同名标题` (`id="同名标题-1"`) restored to the second Markdown occurrence in edit, stayed the second rendered heading in preview, and returned to reading at 185px while the first duplicate remained at 93px. The restored second heading was below the sticky toolbar and was not replaced by the first equal label.

## Review fix round 2

The first fix round always copied the pre-preview editor cursor over the visible preview capture. That preserved exact cursor position when preview had not moved, but incorrectly returned to the old block after a user scrolled the preview. PageEditor now retains the exact cursor only when the preview and editor captures have the same Markdown `sourceOffset`. When they differ, it clears `cursorOffset`, allowing the existing MarkdownWorkspace source-offset restore to select the newly visible preview block.

The PageEditor integration test first failed with the editor returning to paragraph A at offset 20 after preview moved to paragraph B at offset 30. It passes after the conditional merge. The existing Ctrl/Cmd+E test still proves that an unchanged preview block restores its non-top cursor at offset 36.

Fresh scoped verification:

- `pnpm --filter @agentwiki/client test src/features/page/PageEditor.spec.tsx src/components/MarkdownWorkspace.spec.tsx`: 2 files passed, 125 tests passed, 0 failed.
- `pnpm --filter @agentwiki/client exec tsc --noEmit`: exited 0.
- scoped ESLint over PageEditor and MarkdownWorkspace source/tests: exited 0 with no diagnostics.
