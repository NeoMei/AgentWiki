# Task 2 report: persistent directory workspace

## Scope and baseline

- Worktree: `/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/reading-workspace-20260908`
- Application root: `agentwiki/`
- Starting HEAD: `4b3d70a0` (`fix(client): align editor workspace identity`)
- Scope stayed in the client. No server, schema, authorization policy, audit, sync, acceptance-fixture, dependency, or runtime changes were made.
- Controller-owned `.codex-memory` changes were left untouched and were not staged.

## Result

The core Space and page routes now render one persistent directory workspace. `SpaceWorkspace` delegates core routes to the existing `SpaceView`, and `SpaceView` remains the sole owner of create, rename, move, delete, restore, page archive, template, binding, and new-page mutations. The implementation does not duplicate CRUD handlers.

The workspace header places the Space name and existing Space navigation on one compact row. Below it, the approximately 260px directory sidebar remains sticky below the global navigation, uses the available viewport height, scrolls independently, and restores the provider-owned scroll position. Search, New page, and New folder are readable entries. Each tree row exposes one touch-clickable, keyboard-focusable actions menu instead of crowding all operation buttons into the row.

The tree supports nested expansion independently from folder selection, page selection by ID, full names through `title`, focus-visible controls, `aria-expanded`/`aria-selected`, and Enter, Space, Arrow, Home, and End navigation. Deep page routes use the page's authoritative `folderId`, paginate folder metadata only until the real `parentId` chain is complete, expand the target folder as well as its ancestors, and load only root plus the levels on that chain.

## Coherent directory reads

- `listTreeChildren()` paginates at the server's 200-item limit, rejects mixed page revisions, and retries the whole level at most twice.
- `listFolderAncestry()` paginates `GET /spaces/:spaceId/folders`, follows `parentId`, stops when the target's complete chain is known, and also retries revision drift at most twice.
- `useSpaceDirectory()` stages folders, root, and ancestor levels as one snapshot. It commits only when every level has the same `treeRevision`; one cross-level change retries the complete snapshot and repeated change exposes the existing retry entry.
- Level caches are invalidated on a new revision. A Space change uses an AbortController plus a generation check, so late responses cannot install into another Space.
- A 401/403 directory response clears every cached level and folder index. A 401/403 Space metadata response removes the Space identity that authorizes directory loading.
- Page content stays mounted while Space metadata is unresolved or fails, preventing the child identity unmount/remount request loop.

## Existing mutation ownership

The original `SpaceView` handlers retain their compare-and-swap payloads:

- folder create/rename/move use `expectedTreeRevision`; rename/move also use the selected node's `updatedAt`;
- folder delete keeps delete-impact confirmation, `expectedImpactHash`, `rootUpdatedAt`, and restore batch semantics;
- page archive keeps both page `updatedAt` and a current tree revision;
- nested tree moves find their source node across the shared directory-level cache, so sidebar moves keep the correct `expectedUpdatedAt`.

Accepted mutation revisions invalidate and refresh the shared snapshot. New-page creation receives the current folder on directory routes and the selected page's authoritative folder on page routes. `NewPageDialog` displays the resolved Space/folder breadcrumb location.

## Task 1 identity contract retained

The page identity report is extended to `(pageId, spaceId, folderId)` without changing its acceptance rules:

- `PagePreview` and `PageVersionHistory` report folder identity only from their successful existing page load.
- `PageEditor` reports it only from an accepted `pageRef`/`adoptRemotePage` baseline.
- A dirty editor does not adopt or report an unaccepted remote page. Ordinary background failures preserve the accepted identity; explicit 401/403 behavior remains unchanged.

## Public handoff APIs

### `contentTreeApi.ts`

```ts
listTreeChildren(spaceId, parentFolderId, signal?): Promise<ContentTreeListResponse>
listFolderAncestry(spaceId, targetFolderId, signal?): Promise<{
  folders: ReadonlyMap<string, FolderListItem>;
  ancestorIds: string[];
  treeRevision: string;
}>
```

### `useSpaceDirectory.ts`

```ts
interface DirectoryLevel {
  parentFolderId: string | null;
  nodes: ContentTreeNode[];
  treeRevision: string;
}

interface SpaceDirectoryState {
  levels: ReadonlyMap<string | null, DirectoryLevel>;
  folderIndex: FolderIndex;
  treeRevision: string | null;
  locating: boolean;
  error: string | null;
  crumbs: Crumb[];
  toggleFolder(folderId: string): Promise<void>;
  retry(): void;
  reloadLevel(parentFolderId: string | null): Promise<void>;
  acceptTreeRevision(treeRevision: string): void;
}
```

### Workspace integration

- `SpaceWorkspace` adds `showDirectory?: boolean` and always mounts the shared `SpaceView` for core routes when enabled.
- `SpaceView` accepts `spaceId?: string | null` and `workspaceContent?: ReactNode` so the existing mutation controller can wrap read/edit/version content without copying handlers.
- `SpaceWorkspaceContextValue` adds `selectedPageId`, `selectedPageFolderId`, `directoryCrumbs`, and `reportDirectoryCrumbs`. Task 3 can consume the real Space/folder breadcrumb chain for the article toolbar.
- `reportPageIdentity(pageId, spaceId, folderId?)` is the authoritative identity interface.
- `SpaceNav` adds `embedded?: boolean` for the compact shared header row.
- `NewPageDialog` adds `targetLocation?: string` for the explicit creation destination.

## TDD evidence

Initial RED coverage established missing coherent pagination, deep-link ancestor loading, independent tree selection/expansion, duplicate-title page identity, new-page target display, and shared directory rendering. The focused tests failed before those APIs and behaviors existed.

During browser acceptance, conditional rendering initially unmounted the page child after identity resolution. Network sampling showed roughly 48 page reads, 48 related reads, 22 Space reads, and 11 folder/tree cycles before 429. The stable child slot fix removed the loop, and a regression test now holds the successful page read at one request outside development Strict Mode.

Additional RED/GREEN coverage caught and fixed:

- deep-link target folder itself not expanded;
- mixed revisions between folder metadata, root, and ancestor levels;
- cached hierarchy retained after 403;
- directory scroll state stored but not connected to the actual scroller;
- Space metadata failure replacing already loaded page content;
- crowded row operations and missing readable sidebar create/search entries.

Fresh Task 2 and affected-core command:

```sh
pnpm --filter @agentwiki/client test \
  src/features/space-workspace/useSpaceDirectory.spec.tsx \
  src/features/space-workspace/SpaceDirectory.spec.tsx \
  src/features/content-tree/contentTreeApi.spec.ts \
  src/features/content-tree/ContentTree.spec.tsx \
  src/features/space/SpaceView.spec.tsx \
  src/features/space-workspace/SpaceWorkspace.spec.tsx \
  src/features/page-templates/NewPageDialog.spec.tsx \
  src/components/SpaceNav.spec.tsx \
  src/App.spec.tsx
```

Result: 9 files passed, 68 tests passed, 0 failed.

Affected page-identity regression command:

```sh
pnpm --filter @agentwiki/client test \
  src/features/page/PagePreview.spec.tsx \
  src/features/page/PageEditor.spec.tsx \
  src/features/page/PageVersionHistory.spec.tsx
```

Result: 3 files passed, 95 tests passed, 0 failed.

Fresh client TypeScript:

```sh
pnpm --filter @agentwiki/client exec tsc --noEmit
```

Result: exit 0, no diagnostics.

Scoped ESLint over all changed Task 2 TypeScript/TSX files exited 0 with no diagnostics. `git diff --check` exited 0.

## Browser evidence supplied by the controller

- Stable deep link after the loop fix: development Strict Mode issued page 2, related 2, Space 1, templates 1, folders 1, and content-tree 3 requests, then stopped.
- A three-level deep page expanded the target folder and its ancestors and highlighted the current article.
- Expanding/collapsing the directory kept the article and URL unchanged.
- A 205-page child level rendered completely; selecting a page wrote its real folder query and preserved service order.
- Sidebar creation opened the existing two-step dialog at `产品知识库 / 分页验收`; the created page's API `folderId` matched the real selected folder and the page appeared in the sidebar.
- The Space name and navigation now share one compact row.

## Review notes and concerns

- The latest sticky-height, readable search/create entries, and row actions-menu polish is covered by component tests and awaits the controller's final independent visual pass.
- Directory levels intentionally remain owned by the one mounted `SpaceView` controller; provider state owns expanded IDs and scroll position across core route changes. If React remounts a route subtree, levels are fetched again as one coherent bounded snapshot rather than persisted across accounts or Spaces.
- The directory reads folder metadata and content-tree summaries only. It does not recursively load page bodies.
