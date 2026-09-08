# Task 2 sidebar scroll fix report

## Scope and baseline

- Base: `716f9429` (`fix(client): keep reading overlays viewport-bound`)
- Changed only `SpaceDirectory.tsx`, its focused component test, this report, and the Task 2 aggregate report.
- Accepted page identity, coherent directory loading, expansion cache, Task 3 reading components, backend behavior, private fixtures, and controller-owned `.codex-memory` were not changed.

## Regression and root cause

With a 206-item expanded folder, selecting page 205 loaded the correct article but recreated the sidebar at `scrollTop=0`, leaving the selected row outside the viewport.

The workspace registry did retain the prior per-Space scroll value. Page navigation temporarily makes the accepted Space identity unresolved, which unmounts the directory. When it mounts again, `SpaceDirectory` attempted to restore the saved offset before the asynchronous root level had installed. The browser clamped that offset to zero because no scrollable tree existed yet. Installing the root level did not rerun the layout effect because its dependencies were only the saved offset and drawer state. A loading-time zero scroll event could also overwrite the saved value.

## Fix and boundaries

- The layout restoration effect now also follows the installed root-level snapshot. It reapplies the unchanged persisted offset in the same layout phase after the tree content exists.
- Scroll events do not update workspace state while the directory is explicitly loading, preventing a transient empty tree from persisting the browser-clamped zero.
- On a first deep link where the persisted offset is exactly zero, installing a root snapshot reveals the actual `aria-selected` row with `scrollIntoView({ block: 'nearest' })`.
- The selected-row reveal never runs when a nonzero saved offset exists, so normal page navigation preserves the user's directory position rather than recentering selection.
- The `scrollIntoView` call checks DOM support because JSDOM does not implement it by default.

## TDD evidence

The restoration RED rendered an empty loading directory with `directoryScrollTop=245`, simulated its scroll offset being clamped to zero, then installed populated levels without changing the prop. The original implementation called the persistence callback with zero and could not replay 245. The focused first-position RED also proved that no selected-row reveal existed.

After the fix:

```text
SpaceDirectory.spec.tsx: 1 file passed, 6 tests passed, 0 failed
SpaceDirectory.spec.tsx + SpaceWorkspace.spec.tsx: 2 files passed, 13 tests passed, 0 failed
```

Client TypeScript and scoped ESLint over the two changed code/test files exited 0 without diagnostics. `git diff --check` exited 0.

## Real browser evidence

The controller separated native behavior from locator auto-scroll. A native sidebar scroll produced `scrollTop=2460`; the visible page 002 button was clicked at native coordinates; page 002 became selected and the sidebar remained exactly at `2460`, with the selected row visible at approximately `top=512`.

The earlier locator-based page 047 check changed `2115` to `2153` because the locator itself scrolled before clicking. It is not evidence of a persistence mismatch.

## Public interfaces and remaining concerns

No public interface changed. The initial selected-item reveal is intentionally limited to a zero saved position. Existing nonzero positions retain priority even if a newly selected row lies elsewhere; this preserves the user's browsing context and avoids unconditional navigation scrolling.
