# Task 2 — Directory state and direct operations

Status: implementation complete, ready for independent review. No commits or subagents from this implementer. Worktree has a literal trailing space; all Git calls used explicit `--work-tree`. No CodeGraph directory. Read project AGENTS, current/spec frontend rules, approved recommendation and plan Global Constraints + Task 2.

## Exact changed files

- `agentwiki/apps/client/src/features/content-tree/ContentTree.tsx`
- `agentwiki/apps/client/src/features/content-tree/ContentTree.spec.tsx`
- `agentwiki/apps/client/src/features/space-workspace/SpaceDirectory.tsx`
- `agentwiki/apps/client/src/features/space-workspace/SpaceDirectory.spec.tsx`
- `agentwiki/apps/client/src/features/space-workspace/SpaceWorkspaceContext.tsx`
- `agentwiki/apps/client/src/features/space-workspace/SpaceWorkspace.spec.tsx`
- `agentwiki/apps/client/src/features/space-workspace/useSpaceDirectory.ts`
- `agentwiki/apps/client/src/features/space-workspace/useSpaceDirectory.spec.tsx`
- `agentwiki/apps/client/src/features/space-workspace/workspacePreferences.ts` (new)
- `agentwiki/apps/client/src/features/space-workspace/workspacePreferences.spec.tsx` (new)
- `agentwiki/apps/client/src/features/space/SpaceView.tsx`
- `agentwiki/apps/client/src/features/space/SpaceView.spec.tsx`
- `.superpowers/sdd/2026-10-06-document-workspace/task-2-report.md`

`contentTreeApi.ts` unchanged: existing folder create/rename APIs already enforce required preconditions. No Task 1/editor/package/lock files touched.

## Delivered behavior / interfaces

- Workspace preferences persist expansion, scroll, width and collapse in schema v1 keys `agentwiki.workspace.v1:<encoded-userId>:<encoded-spaceId>`. Records contain preferences only. Validation defaults malformed JSON/unknown schema, clamps width 220..420, discards malformed expansion IDs, and catches unavailable/quota storage errors. In-memory behavior remains usable when storage is unavailable.
- `SpaceWorkspaceContextValue` adds `directoryWidth` / `setDirectoryWidth`; collapse now persists with existing `setDirectoryCollapsed`. User identity changes select isolated state immediately, including returning to a previous account.
- `ContentTreeProps` adds optional `onRenameNode(node,name)`, `onCreateFolderInline(parent,name)`, `onCreatePageInline(parent,title)`, `reorderDisabled`. Existing callers retain their legacy callbacks.
- Row menu actions have visible text + accessible names. Enter/Space open/close, Up/Down/Home/End move action focus, Escape closes and restores opener. Page/folder rename and parent-scoped folder/page creation use a focused inline form with Save/Cancel/Escape and inline errors. Permission loss removes in-progress inline input and stops drag/drop. Rename retains the node snapshot/version from the start of input, rather than upgrading its expected version on refresh.
- `SpaceDirectory` adds controlled width/collapse, scoped reset key, inline root/selection creation callbacks, and current-document reveal. Desktop separator supports pointer capture and ArrowLeft/Right/Home/End with clamping. Mobile modal drawer remains available even if the desktop directory is collapsed.
- New page: explicit inline title creates the same blank page shape (`title,spaceId,folderId,expectedTreeRevision`) as existing creation, then opens edit. Separate bilingual `Templates…` button still uses `newContentHref` and existing chooser. Folder-row creation binds exact parent.
- Loaded-items filter labels coverage explicitly, filters cached authorized levels, includes ancestors of loaded matches, uses temporary expansion rather than persisting filter expansion, prevents reorder, and preserves original scroll preference when cleared. Global Search link remains.
- Reveal clears filter, expands known current-page ancestry and reloads existing ancestry/tree APIs; selected row scrolls into view once installed.
- `useSpaceDirectory` optional `identityKey` invalidates cached levels, crumbs and branch state on user changes. SpaceView re-fetches Space metadata on identity changes and prevents showing previous account metadata/tree while loading.
- Inline mutations retain Space membership checks and server-side authorization. Page rename submits `expectedUpdatedAt` and `expectedTreeRevision`; folder rename/create use existing validators/preconditions. Results from navigation/account changes do not refresh or navigate the new scope. Read/version current-page rename requests page refresh; edit retains draft and subsequent save remains subject to existing version checks.

## RED → GREEN evidence

Commands executed from `agentwiki`:

```sh
pnpm --filter @agentwiki/client exec vitest run src/features/space-workspace/workspacePreferences.spec.tsx src/features/content-tree/ContentTree.spec.tsx src/features/space-workspace/SpaceDirectory.spec.tsx
```

Initial RED (`/tmp/agentwiki-task2-red.log`):

```text
Test Files 3 failed (3)
Tests 8 failed | 13 passed (21)
```

Expected missing behaviors: persistence/width, text-menu keyboard navigation, inline rename and denial, loaded filter and accessible resize.

Further RED cycles:

- `/tmp/agentwiki-task2-integration-red.log`: 3 failed | 24 passed; no integrated page rename, parent-inline folder creation, or denial behavior.
- `/tmp/agentwiki-task2-keyboard-red.log`: 1 failed | 9 passed; summary Enter/Space activation absent in test harness.
- `/tmp/agentwiki-task2-create-red.log`: 1 failed | 27 passed; page title inline creation absent.
- `/tmp/agentwiki-task2-isolation-red.log`: 2 failed | 21 passed; identity cache retained and filtered scroll overwrote original preference.
- `/tmp/agentwiki-task2-version-red.log`: 1 failed | 10 passed; refresh replaced original rename node precondition.

Final focused GREEN (`/tmp/agentwiki-task2-green.log`):

```sh
pnpm --filter @agentwiki/client exec vitest run src/features/space-workspace/workspacePreferences.spec.tsx src/features/content-tree/ContentTree.spec.tsx src/features/space-workspace/SpaceDirectory.spec.tsx src/features/space/SpaceView.spec.tsx src/features/space-workspace/useSpaceDirectory.spec.tsx src/features/content-tree/contentTreeApi.spec.ts src/features/space-workspace/SpaceWorkspace.spec.tsx
```

```text
Test Files 7 passed (7)
Tests 84 passed (84)
Start at 05:53:01
Duration 2.56s
```

`pnpm --filter @agentwiki/client exec tsc --noEmit`: exit 0, no diagnostics (`/tmp/agentwiki-task2-tsc.log`). Early concurrent tsc had Task 1's `lineDiff.spec.ts .at()` / `AgentAssistPanel.tsx status` errors; final run clean, no changes to those files by this agent.

`git --work-tree='<literal path>' diff --check` on owned scope: exit 0.

Tests exercise behavior and identity/API preconditions, not new styling class assertions. Existing SpaceWorkspace test was updated to expect returning user restores their own preferences (previous test expected loss); test storage resets prevent cross-test persistent state.

## Self-review and limitations

- Filter never loads all Space branches or claims whole-Space search. It searches cached tree levels, not only expanded visible rows. Existing API surface has no tree search contract reused here.
- Failed mutation never optimistically rewrites source nodes; inline form displays translated API error and original page stays mounted. Remote permission revocation is still authoritative at server request time.
- Reading/version page rename refreshes current page metadata. Renaming while editing intentionally keeps human draft; save may conflict against the changed server page version instead of overwriting it.
- localStorage is synchronous; preference writes remain small, but storage quota/blocking does not show a false persisted-success message. Cross-tab live synchronization is not included.
- User-visible new copy selects Chinese/English through shared `useLanguage`, existing strings use `t`; no new locale file outside ownership was needed.
- Browser acceptance (resize hit area, clipping, focus, Chinese IME, desktop/narrow and cold read/edit navigation) is controller gate. Controller observed a transient HMR hook-order error during ongoing hook changes; cold reload recovered. No cold browser acceptance claimed by this implementer.
- No production writes, publication, deployment, or visual editor adoption claimed.

## Independent review repair — pending inline completion navigation

Review base/head: `33c5547f..c268fd83`. Important finding reproduced: a pending POST completion navigated away after explicit document navigation within the same Space, including A→B→A (ABA).

Repair changed exactly:

- `agentwiki/apps/client/src/features/space/SpaceView.tsx`
- `agentwiki/apps/client/src/features/space/SpaceView.spec.tsx`
- `agentwiki/apps/client/src/features/content-tree/ContentTree.tsx`
- `agentwiki/apps/client/src/features/space-workspace/SpaceDirectory.tsx`
- this report

SpaceView now tracks a navigation generation keyed by router location key/path/query/hash, user, Space, selected page/folder and workspace mode. Each committed context change advances the generation; inline mutations capture it alongside Space/user/revision and check it after await before navigation, page/tree refresh, expansion or displaying a failure. Router location keys plus monotonic generation reject returning to equal route/identity. Successful server writes may finish; stale completion produces no navigation or mutation UI update in the newer context.

`ContentTree` adds optional `mutationScopeKey` and keys row instances by it so stale inline forms unmount when context changes. SpaceDirectory keys root create forms by the same scope and closes creation on context changes; their active-session check prevents stale promise completion closing/showing errors in a new input. Existing non-workspace callers need not supply the optional prop.

Exact focused command from `agentwiki`, RED and GREEN:

```sh
pnpm --filter @agentwiki/client exec vitest run src/features/space/SpaceView.spec.tsx src/features/space-workspace/useSpaceDirectory.spec.tsx
```

RED `/tmp/agentwiki-task2-navigation-red.log`:

```text
Test Files 1 failed | 1 passed (2)
Tests 2 failed | 39 passed (41)
Start at 05:59:28
Duration 1.16s
```

GREEN `/tmp/agentwiki-task2-navigation-green.log`:

```text
Test Files 2 passed (2)
Tests 41 passed (41)
Start at 06:00:03
Duration 1.05s
```

Deferred POST regressions exercise current document A→B and A→B→A in a persistent same-Space shell and assert the chosen route survives old creation completion. Scoped `git diff --check`: exit 0. No full suite/typecheck rerun requested for this review repair. No editor/server/package files touched, no commits/subagents. Product/browser acceptance remains the controller gate.
