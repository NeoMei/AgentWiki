# Task 1 report: workspace shell and navigation context

## Scope and baseline

- Worktree: `/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/reading-workspace-20260908`
- Application root: `agentwiki/`
- Base and starting HEAD: `5466752431eb3516f065aec0eec83649f200ab0c` (`54667524 docs: record approved reading workspace design and plan`)
- Starting task worktree state: clean when inspected with `git --work-tree="$PWD" status --short --branch`. Ordinary Git status is not authoritative here because the shared `core.worktree` points at the parent checkout.
- Runtime: Node `v24.18.0`; repository engine is `>=24 <25 || >=26 <27`. pnpm `11.9.0`; repository package manager is `pnpm@11.9.0`.
- Baseline supplied by the controller: 93 client files / 1270 tests pass; shared and protocol packages were already built. This task did not rerun the full suite by instruction.

## Implementation

- Added a route-level `SpaceWorkspace` shell for `/spaces/:id`, `/pages/:id`, `/pages/:id/edit`, `/pages/:id/versions`, and existing Space subroutes. Existing `SpaceView` and existing section components remain unchanged; their current internal navigation stays in place until Task 2.
- Page routes resolve `spaceId` with a read-only `GET /pages/:pageId`. The shell ignores resolution errors so the established page component remains the owner of loading/error UI. The routed page component still performs its existing request, so this staging step currently adds one duplicate read-only page lookup on page routes.
- Added a provider-owned in-memory browsing registry. Expanded folder IDs and directory scroll position survive page/read/edit route changes within one Space. The App keys the provider by authenticated user ID, so logout/account change destroys the registry; a direct provider owner change also clears it. State does not cross Space or user boundaries.
- Folder selection is derived from the current `location.search`. `selectFolder()` navigates to `/spaces/:spaceId?folder=:folderId`; a root selection emits `/spaces/:spaceId` with no query. Browser back/forward therefore restores selection from URL state.
- `SpaceNav` accepts `activeSection` and maps page routes to `pages`. Nested collaboration and settings URLs map to their parent items. Existing labels continue to use `useLanguage().t`; no new visible copy was introduced. `LanguageContextValue` is exported for downstream typed workspace UI.
- `Layout` uses the full application width only for `/spaces/:id*` and `/pages/:id*`. Dashboard, search, profile, account and public routes keep the existing constrained container.

## Public handoff APIs

### `SpaceWorkspace.tsx`

```ts
type SpaceWorkspaceMode = 'directory' | 'read' | 'edit' | 'versions' | 'section';

interface SpaceWorkspaceProps {
  mode: SpaceWorkspaceMode;
  spaceId?: string;      // Space routes pass the real route Space ID.
  pageId?: string;       // Page routes omit spaceId and resolve it from GET /pages/:pageId.
  children: React.ReactNode;
  activeSection?: SpaceNavSection;
  showNavigation?: boolean;
}
```

Default navigation visibility is on for `read`, `edit`, and `versions`, and off for `directory` and `section` so the unchanged pre-Task-2 Space components do not render duplicate navigation.

### `SpaceWorkspaceContext.tsx`

```ts
<SpaceWorkspaceProvider userId={authenticatedUserId}>…</SpaceWorkspaceProvider>
const workspace = useSpaceWorkspace();
```

`workspace` exposes:

- identity: `userId`, `spaceId: string | null`, `mode`, `activeSection`
- URL-derived selection: `selectedFolderId`, `selectFolder(folderId | null)`
- scoped browse state: `expandedFolderIds`, `setFolderExpanded(folderId, expanded)`, `directoryScrollTop`, `setDirectoryScrollTop(scrollTop)`

While a page route identity request is pending or cannot resolve, `spaceId` is `null`, navigation is absent, and scoped state writes are no-ops. Existing page content/error behavior continues to render.

### `workspaceNavigation.ts`

- `folderIdFromSearch(search)`
- `spaceFolderHref(spaceId, folderId)`
- `isWorkspacePath(pathname)`
- `workspaceSectionFromPath(pathname)`
- `SpaceNavSection = 'pages' | 'graph' | 'sources' | 'runs' | 'collaboration' | 'members' | 'settings'`

The approved design's broad content/wide shell distinction maps here to route sizing plus finer behavior modes: directory content uses `directory`, page content uses `read`/`edit`/`versions`, and other wide Space destinations use `section`.

## TDD evidence

### RED 1: absent workspace APIs and explicit page navigation

Command:

```sh
pnpm --filter @agentwiki/client test src/features/space-workspace/SpaceWorkspace.spec.tsx src/features/space-workspace/workspaceNavigation.spec.ts src/components/SpaceNav.spec.tsx
```

Observed exit 1: the two new modules could not resolve, and the new `SpaceNav` assertion failed because Pages had no `aria-current="page"` on `/pages/page-1/edit`. The pre-existing SpaceNav test still passed.

### RED 2: real page identity and route-specific layout

Command:

```sh
pnpm --filter @agentwiki/client test src/features/space-workspace/SpaceWorkspace.spec.tsx src/components/Layout.spec.tsx
```

Observed exit 1 with two behavior failures: the page scope rendered `user-1::read` instead of `user-1:space-real:read`, and the page route retained `container mx-auto` instead of the workspace `w-full` class.

### RED 3: account lifecycle isolation

Command:

```sh
pnpm --filter @agentwiki/client test src/features/space-workspace/SpaceWorkspace.spec.tsx
```

Observed exit 1: after changing away from user 1 and returning, `folder-a` was still present. Provider clearing plus the App owner key made the same test green.

### GREEN and focused regression

Fresh final command:

```sh
pnpm --filter @agentwiki/client test src/features/space-workspace/SpaceWorkspace.spec.tsx src/features/space-workspace/workspaceNavigation.spec.ts src/components/SpaceNav.spec.tsx src/components/Layout.spec.tsx src/App.spec.tsx
```

Observed exit 0: 5 test files passed, 16 tests passed, 0 failed. Coverage includes read-to-edit navigation, same-Space state continuity, cross-Space/account isolation, scroll restoration state, URL back navigation, real page identity resolution, active section behavior, route classification, Layout sizing, and existing App route tests.

Fresh client typecheck:

```sh
pnpm --filter @agentwiki/client exec tsc --noEmit
```

Observed exit 0 with no diagnostics.

Focused ESLint over all changed TypeScript/TSX files also exited 0 with no diagnostics. `git diff --check` exited 0.

## Boundary and self-review

- No server, schema, auth policy, audit, sync, editor, version-diff, dependency or runtime-environment changes.
- No controller acceptance service or fixture was accessed.
- No existing Space/page route was removed or renamed.
- Resolution requests are abort-scoped and stale page responses cannot install another page's Space identity.
- The duplicate page identity GET is the material staging cost. Task 2 may consume the resolved identity from context to remove the child request only if it can preserve every existing page loading, refresh, permission and conflict behavior; this task deliberately leaves those owners unchanged.
