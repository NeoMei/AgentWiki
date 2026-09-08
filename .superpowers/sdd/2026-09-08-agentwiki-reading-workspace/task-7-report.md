# Task 7 known frontend gaps report

## Scope and result

- Worktree: `/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/reading-workspace-20260908`
- Baseline: `7f18c42c64b29b3528b5db39290f0c5571df466e`
- Changed only client Page loading and the existing reading-workspace move handoff. No server, schema, protocol, dependency, permission source, move payload, or editor behavior changed.
- Controller-owned `.codex-memory`, plan, and `agentwiki/docs/verification/reading-workspace-acceptance.md` changes were preserved and excluded from this task commit.

## Fixes

`PagePreview` now shows the existing translated `common.retry` action after `GET /pages/:id` fails and retries that exact endpoint in place. Route generation, mounted-state checks, and a new per-load sequence reject obsolete page responses. A transient refresh failure retains an already accepted Space identity so the workspace remains navigable; a 401/403 still clears that identity. Initial unresolved direct links do not infer a Space from the URL.

When `SpaceView` receives a successful current-Page move response, it requests a refresh only if the still-mounted workspace is reading that same Page. The signal is emitted after `moveTreeNode` resolves and is ignored in edit mode or after the current Page changes. `PagePreview` then accepts the full Page through the existing GET, including its authoritative `folderId` and `updatedAt`. This relocates the selected Page and breadcrumb to the real new parent, expands its ancestry, and gives the next checklist PATCH the post-move compare-and-swap token. A same-Page refresh preserves queued checklist operations by rebasing them onto the accepted Page snapshot.

## TDD evidence

Initial RED before production edits:

```text
pnpm --filter @agentwiki/client test \
  src/features/page/PagePreview.spec.tsx \
  src/features/space-workspace/SpaceWorkspace.spec.tsx

Test Files  2 failed (2)
Tests       2 failed | 39 passed (41)
```

The retry test failed because the error state exposed only `Back to Dashboard`; the move test failed because Page GET remained at one call after the accepted move.

The added integration coverage verifies:

- transient failure -> translated Retry -> real Page data;
- an accepted known Space survives a transient refresh, while a later 403 clears it;
- a late same-Page response cannot overwrite the newer accepted refresh;
- no Page refresh occurs before move success;
- successful current-Page drag/drop causes an authoritative Page GET, new-parent breadcrumb and selected tree location;
- the first checklist PATCH after the move uses the refreshed `updatedAt`.

## Fresh verification

```text
pnpm --filter @agentwiki/client test \
  src/features/page/PagePreview.spec.tsx \
  src/features/page/PageEditor.spec.tsx \
  src/features/space/SpaceView.spec.tsx \
  src/features/space-workspace/SpaceWorkspace.spec.tsx \
  src/features/space-workspace/useSpaceDirectory.spec.tsx \
  src/features/space-workspace/SpaceDirectory.spec.tsx \
  src/features/content-tree/ContentTree.spec.tsx \
  src/features/content-tree/contentTreeState.spec.ts

Test Files  8 passed (8)
Tests       163 passed (163)
Exit status 0
```

Focused tests were also rerun serially: `PagePreview.spec.tsx` passed 32/32 and `SpaceWorkspace.spec.tsx` passed 11/11.

```text
pnpm --filter @agentwiki/client exec tsc --noEmit
Exit status 0; no diagnostics
```

```text
pnpm --filter @agentwiki/client exec eslint \
  src/features/page/PagePreview.tsx \
  src/features/page/PagePreview.spec.tsx \
  src/features/page/PageEditor.spec.tsx \
  src/features/space/SpaceView.tsx \
  src/features/space-workspace/SpaceWorkspace.tsx \
  src/features/space-workspace/SpaceWorkspaceContext.tsx \
  src/features/space-workspace/SpaceWorkspace.spec.tsx

Exit status 0; no diagnostics
```

`git --work-tree="$PWD" diff --check` exited 0.

## Self-review and remaining boundary

- The move write remains the original API and CAS payload; refresh is a read after confirmed success.
- `PageEditor` does not consume the refresh signal, so dirty content, remote-update handling, save baseline adoption, and 409 behavior remain unchanged.
- Page and Space request guards remain active across route changes, same-Page overlap, unmount, and user-scoped remount.
- The controller owns the full client suite, build, repository typecheck, real browser move/network retry, final acceptance document, and whole-branch review. At report time the unit/integration UI is stable; browser drag automation had not yet emitted a move request after HMR and was being retried from a stable refresh, so this report does not claim that real browser result.
