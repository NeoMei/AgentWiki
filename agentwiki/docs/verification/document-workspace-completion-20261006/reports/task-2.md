# Task 2 implementation report

Status: source frozen, ready for controller commit and independent review.
Base: `f652b804eed0d1dc4471476344ef49b9086f07e2`.

## Route proof

Own thread `01a110a7-7a42-78b1-a2be-b210b155ba4e` latest actual turn context at `2026-10-06T09:59:34.653Z` reports `p5c07ff/gpt-6-astra`, effort `ultra`. Inherited through full-history fork; no override or account fallback.

## Exact edited product files

- `agentwiki/apps/client/src/features/space-workspace/SpaceDirectory.tsx`
- `agentwiki/apps/client/src/features/space-workspace/SpaceDirectory.spec.tsx`

No useSpaceDirectory, ContentTree, CSS, package, plan, memory or runtime changes. No commit, subagent or external data mutation.

## Implementation

- Treat a selected-page transition inside the same preference scope separately from first load and account/Space changes.
- Preserve initial saved scroll, including asynchronous initial tree loading and a desktop surface initially hidden by the mobile breakpoint. A normal same-page tree refresh no longer resets the user's manual scroll.
- Maintain pending reveal separately for desktop and drawer. Wait for current row, authorized loaded ancestry/expansion and a measurable surface. Reveal once with `block: nearest` only when the row crosses the scrollport bounds; leave focus, expansion and tree data unchanged.
- Clear only a filter hiding the newly selected page; preserve a matching filter. Explicit locate still requests ancestry and clears filtering, with saved unfiltered scroll restored before the reveal.
- Reset pending work when preference scope changes. Reopening collapsed desktop/mobile drawer or making desktop visible via resize completes its own pending reveal.
- Additional controller-assigned browser regression: bottom menu placement. Controller observed directory item 067's trigger at y=674..702 with menu actions extending to y=811 in a 720px viewport (`/tmp/agentwiki-completion-20261006/directory-bottom-menu-before.png`). Scoped directory event handlers now place native details action menus above or below according to available scrollport/viewport room, cap tall menu height and allow inner scrolling. Pointer/keyboard opening places before keyboard focus; existing Arrow/Home/End navigation and Escape behavior remain in ContentTree. Outside pointer, directory scroll, resize or page/scope navigation dismiss menus. No global ContentTree refactor.

## RED / GREEN evidence

1. Added selection continuity regressions before implementation: 7 failed / 14 passed at 18:03:37 (+08:00), matching missing new-page reveal with nonzero saved scroll, same-page snapback, late ancestry/expansion, filter, collapsed and mobile behavior.
2. Core implementation: 21 / 21 passed at 18:05:11.
3. Added bottom-menu regressions before menu implementation: 4 failed / 21 passed at 18:06:56, matching missing placement/height constraint, keyboard placement and outside dismissal.
4. Added hidden-layout initial restoration regression: RED at 18:09:36, expected persisted 245 but got 0 after the desktop surface became measurable. Kept initial restoration pending while hidden; final GREEN below.
5. Additional coverage protects visible-row no-scroll, repeated same-page refresh, matching filter retention, independent mobile consumption, resize visibility, manual reveal ordering and scrolling within a tall menu without dismissal.

Final commands from `.../AgentWiki /agentwiki` at 18:09:55 (+08:00):

```text
pnpm --filter @agentwiki/client exec vitest run src/features/space-workspace/SpaceDirectory.spec.tsx src/features/space-workspace/useSpaceDirectory.spec.tsx src/features/content-tree/ContentTree.spec.tsx
3 files, 51 tests passed (SpaceDirectory 29, useSpaceDirectory 11, ContentTree 11)

pnpm --filter @agentwiki/client exec tsc --noEmit
PASS

pnpm exec eslint apps/client/src/features/space-workspace/SpaceDirectory.tsx apps/client/src/features/space-workspace/SpaceDirectory.spec.tsx
PASS

git --work-tree='/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ' diff --check
PASS
```

One intermediate typecheck caught React 18 div typings rejecting `onToggleCapture`; changed that listener to native capture scoped to the two directory refs. Final checks above cover the resulting code.

## Remaining integration validation

No blocker or design ruling required. Controller should repeat the saved-scroll navigation and bottom-menu desktop/mobile interactions against the final production build; jsdom geometry regressions do not claim real browser acceptance. Existing full-build/bundle-budget and whole-branch checks remain controller-owned.
