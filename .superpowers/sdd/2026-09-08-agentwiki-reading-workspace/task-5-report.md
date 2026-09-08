# Task 5 report: history and dialog continuity

## Scope and result

- Worktree: `/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/reading-workspace-20260908`
- Branch baseline: `8b163746`
- Scope remained in the client history, reading/editor navigation handoff, workspace presentation state, existing create/folder dialogs, translations, and focused tests.
- No server, schema, permission source, CAS payload, sync, restore destination, dependency, runtime, or data changes were made.
- Controller-owned `.codex-memory` files and `agentwiki/docs/verification/reading-workspace-acceptance.md` were left untouched and excluded from the commit.

History opened from the reader or editor now records only a same-page `read` or `edit` source plus the existing semantic workspace position. The history return button restores that source; missing, malformed, cross-page, or arbitrary URL state falls back to the existing same-page editor destination. Editor navigation still passes through the Task 4 dirty guard, so a cancelled transition does not commit the source route state.

The history page displays the authoritative Space/folder crumbs and loaded page title. It can temporarily hide the shared directory without changing the provider-owned expanded-folder set or saved scroll position. Changing route mode or Space clears only the temporary hidden state. Existing version loading, Markdown preview modal, permission-controlled restore action, confirmation, tree-revision CAS lookup, restore request, and successful `/pages/:id/edit` navigation are unchanged.

The reading Page info panel exposes version history when the existing edit capability allows the management actions and captures the current rendered position before navigation. New-page selection now shows the resolved Space/folder destination from its first phase, including the real Space root. Folder create, rename, and delete dialogs show the full breadcrumb supplied by `SpaceView`. `SpaceView` derives these labels from the authoritative folder index, keeps real folder IDs in every mutation, records each opener for modal focus return, and supplies the deleted folder's connected parent or Space heading as the existing modal fallback. Drag/drop move retains Task 2's visible source/target rows and unchanged object-ID/CAS request.

## Interfaces and decisions

- History route state is `{ pageHistorySource: { pageId, mode, workspacePosition } }`, where `mode` is only `read | edit` and `workspacePosition` must pass the complete existing `WorkspacePosition` shape for the same `pageId`.
- `PageInfoPanel` adds `onOpenHistory(): void` and uses the existing `canEdit` fact; it does not fetch or invent another permission.
- `SpaceWorkspaceContextValue` adds local `directoryCollapsed` and `setDirectoryCollapsed`. Expanded IDs and directory scroll remain in the existing per-Space browsing registry.
- `FolderDialog` and `FolderDeleteDialog` accept presentation-only `targetLocation`; the latter also accepts the existing modal's fallback-focus target.
- `SpaceView` is still the sole create/rename/move/delete/restore owner. Breadcrumb strings are built only from `crumbsForFolder(folderIndex, actualFolderId, space.name)`.
- No comparison page or alternate restore path was added.

## TDD and automated verification

The pre-change required baseline was 4 files / 48 tests passing. New RED cases covered read/edit source return, cross-page/untrusted fallback, temporary directory collapse without losing expanded IDs, root new-page destination, full folder object paths, and opener focus. They failed on the missing route state, controls, labels, or focus target before the corresponding implementation was added.

The new dirty-confirm integration test initially produced 1 failure out of 179 affected tests because Node 24's native `Request` rejected jsdom's cross-realm `AbortSignal`. This is the same test-environment issue documented by Task 4. Reusing Task 4's minimal test-only `Request` shim made that focused test pass (1 passed, 67 skipped); production keeps the browser-native Request/AbortSignal pair.

Required command:

```sh
pnpm --filter @agentwiki/client test \
  src/features/page/PageVersionHistory.spec.tsx \
  src/features/page-templates/NewPageDialog.spec.tsx \
  src/features/page-templates/NewPageDialog.composite.spec.tsx \
  src/features/content-tree/FolderDialog.spec.tsx
```

Result: 4 files passed, 54 tests passed, 0 failed.

Affected navigation/presentation regression command:

```sh
pnpm --filter @agentwiki/client test \
  src/features/page/PageEditor.spec.tsx \
  src/features/page/PagePreview.spec.tsx \
  src/features/space-workspace/PageInfoPanel.spec.tsx \
  src/features/space/SpaceView.spec.tsx
```

Result: 4 files passed, 125 tests passed, 0 failed.

`pnpm --filter @agentwiki/client exec tsc --noEmit` exited 0 with no diagnostics. Scoped ESLint over all changed Task 5 TS/TSX files exited 0 with no diagnostics. `git diff --check` exited 0.

## Controller real-browser evidence

- Reading Page info -> history showed `返回阅读` and the real Space / paginated nested folder / page path. Collapsing the directory removed it; previewing real v3 rendered the stored `SAVE-FIRST` content; Escape closed the preview and returned focus to the v3 preview trigger; returning restored the original read URL and directory state.
- Edit -> history returned to the editor source.
- Restoring real v3 for page `73314404-e63e-464e-ac69-b5ecf55c3def` ended at `/edit`; a subsequent GET returned 200, updated at `17:41:47.017`, length 31, matched `SAVE-FIRST`, and no longer contained the previous `REMOTE` content. The automation did not separately capture the confirmation click, so this evidence proves the restore terminal state and server result rather than a fully recorded confirmation interaction.
- Existing real folder CRUD created, renamed, deleted, restored, and GET-verified the same folder ID, name, and parent. The new dialogs showed `产品知识库 / 分页验收`; Escape closed the folder dialog and returned focus to `新建文件夹`. New page selection displayed the same destination while preserving the composite-feature unavailable message.
- At 390px, the history route stayed within `scrollWidth=390`; source return and directory-control behavior passed. The history-level directory button is visible on mobile even though the shared directory is already presented as a drawer; this is redundant presentation, not a navigation or data issue.

## Remaining concerns

- The successful restore confirmation click was not independently captured in browser automation, although the unchanged confirmation/CAS code, focused tests, final `/edit` route, and GET result were verified.
- Cancel/Escape focus return and connected-parent fallback are covered by component behavior, and controller verified create-dialog focus. A real-browser assertion specifically sampling focus after successful folder deletion was not recorded.

## Fix round 1: successful-delete parent focus

Independent review and controller validation reproduced the remaining focus concern: after a nested folder DELETE succeeded, the modal closed while its trigger and saved parent DOM nodes were still from the old directory snapshot. The asynchronous refresh later removed them and left `document.activeElement` at `BODY`.

The fix keeps the mutation contract unchanged. `SpaceView` records the deleted folder's real `parentId` and the level that contains that parent before mutation. After the existing DELETE and `acceptTreeRevision`, it awaits that real level refresh before allowing the success close. `FolderDeleteDialog` distinguishes success from cancel, and `ModalDialog` resolves the success return target during its existing cleanup microtask. It selects the refreshed connected parent by the saved real ID, falling back to the stable Space root only when no connected parent exists. Cancel and Escape still return to the original trigger. CAS fields, delete impact, restore batch, reload implementation, and restore behavior are unchanged.

RED used a nested parent/child tree with the post-delete level response deliberately held. After the dialog closed and the refreshed parent replaced the old nodes, the expected connected parent was present but `document.activeElement` was `BODY` (1 failed, 22 skipped). GREEN keeps the dialog mounted until the held refresh installs, removes the deleted child, and focuses the refreshed `content-node-parent` (1 passed, 22 skipped).

Fresh affected command:

```sh
pnpm --filter @agentwiki/client test \
  src/features/space/SpaceView.spec.tsx \
  src/features/content-tree/FolderDialog.spec.tsx \
  src/components/ModalDialog.test.tsx
```

Result: 3 files passed, 27 tests passed, 0 failed. `pnpm --filter @agentwiki/client exec tsc --noEmit`, scoped ESLint over the four fix-round files, and `git diff --check` each exited 0 with no diagnostics.

Controller real-browser validation of this fix is pending on the same delete/restore fixture.
