# Task 2 continuity fix report

## Scope and baseline

- Base: `5a1eb7ff` (`feat(client): redesign page reading workspace`)
- Scope: `useSpaceDirectory` snapshot continuity only, plus focused tests and this report.
- No Task 1 identity acceptance rule, Task 3 reading UI, backend behavior, controller-owned `.codex-memory`, private fixture, dependency, or runtime file was changed.

## Observed regression and root cause

The controller reproduced `main page -> deep page -> sibling -> main page`: the provider still held three expanded folder IDs, but a previously visible deep page disappeared and its expanded parent stayed empty.

`useSpaceDirectory` clears its level cache whenever `targetFolderId` or `spaceId` changes. Its replacement snapshot previously loaded only the root and the current target's ancestry. Expanded IDs live in the workspace registry across those transitions, but `toggleFolder` only lazy-loads when a folder changes from collapsed to expanded. A folder that remained expanded therefore had no later event that could restore its discarded level.

The temporary `spaceId=null` state while a page identity is unresolved reaches the same cache-reset path. This state remains required by Task 1's accepted-page identity contract and was not relaxed.

## Fix

Each snapshot now captures the current expanded-folder set without making it an effect dependency. After loading root and the current target chain, it discovers expanded folder nodes from already loaded levels and reads only those reachable expanded branches. Newly loaded levels can reveal deeper expanded children, which join the same finite queue. IDs that are stale, unreachable, or under a collapsed branch are not requested.

These reads are part of the original staged snapshot. They use the same AbortSignal and generation guard, and every response must match the snapshot revision. Revision drift in a preserved expanded branch retries the complete snapshot within the existing two-attempt bound. Nothing is installed until all required levels agree.

## TDD and verification

The new target-switch regression failed on the original implementation with `expected [null] to equal [null, 'a', 'b', 'c']`. After the fix, the snapshot retains root plus the three reachable expanded levels.

Added coverage also proves:

- recovery from an initial/transient unresolved Space identity;
- no read of a visible collapsed branch or an unreachable stale expanded ID;
- full bounded retry when revision drift occurs inside a preserved expanded branch.

Focused hook result:

```text
1 file passed, 9 tests passed, 0 failed
```

Focused integration result:

```text
useSpaceDirectory.spec.tsx + SpaceWorkspace.spec.tsx + SpaceView.spec.tsx
3 files passed, 38 tests passed, 0 failed
```

Client TypeScript (`pnpm --filter @agentwiki/client exec tsc --noEmit`) and scoped ESLint over the two changed source/test files both exited 0 without diagnostics. `git diff --check` exited 0.

## Public interfaces and concerns

No public interface changed. The provider continues to own expansion and scroll state; `SpaceView` continues to own mutations; `useSpaceDirectory` returns the same state and callbacks.

The controller's real-browser revalidation passed `main -> deep -> sibling -> main`: the old deep page remained visible. Navigating onward to another same-title page under `项目文档` retained both the old deep branch and the Markdown sibling while the article showed the correct same-title page. Sidebar scroll restoration remains for the controller's final check.
