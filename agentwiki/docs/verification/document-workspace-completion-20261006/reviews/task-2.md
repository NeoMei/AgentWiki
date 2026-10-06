# Task 2 independent review

## Spec Compliance

- ✅ Spec compliant for immutable delta `f652b804..83c990b7`. Only the two allowed SpaceDirectory product/spec files changed; no hook, data mutation, permissions, API or global ContentTree implementation change.
- Selection transition versus initial restoration is explicitly separated at `agentwiki/apps/client/src/features/space-workspace/SpaceDirectory.tsx:116–152`: saved initial scroll is restored per surface/scope, a genuine same-scope page change schedules one nearest reveal, and a visible row consumes its reveal without scrolling. The same-page, late-child, scope, filter and independent drawer regressions are at `SpaceDirectory.spec.tsx:268–396`.
- Manual locate remains explicit and restores the unfiltered position before consuming reveal at `SpaceDirectory.tsx:208–212`; its ordering regression is at `SpaceDirectory.spec.tsx:373–383`.
- The assigned bottom-menu fix stays local to the directory: scrollport/viewport-aware above/below placement and bounded menu scrolling at `SpaceDirectory.tsx:21–39`; capture-phase keyboard placement before action focus at `:259–271`; dismissal on directory scroll/outside pointer at `:164–168,273–275`. Behavior regressions are at `SpaceDirectory.spec.tsx:424–474`.
- ⚠️ Actual browser geometry/native focus remains the controller's integration acceptance gate. The diff's jsdom tests intentionally provide bounding rectangles; the implementer does not claim they establish production desktop/390px acceptance.

## Strengths

- `SpaceDirectory.tsx:93–95,119–136` keeps saved-scroll restoration and selection reveal as separate state, including per-surface pending work. Hidden desktop and closed drawer cannot consume each other's reveal, and ordinary same-page rerenders cannot repeatedly snap the user back.
- `SpaceDirectory.spec.tsx:268–278,335–370` checks preservation of focus/tree callbacks and delayed visible-layout reveal rather than asserting only state flags.
- `SpaceDirectory.tsx:259–271` coordinates with the existing native-details keyboard handler before it focuses a menu action, addressing the actual scroll-causing ordering risk without duplicating ContentTree navigation logic.
- `SpaceDirectory.spec.tsx:442–465` verifies keyboard opening, Escape return, outer-scroller dismissal and inner-menu scrolling separately.

## Issues

### Critical

- None.

### Important

- None.

### Minor

- None.

## Checks and bounded context

- Reviewed supplied task brief, binding constraints, implementation report and `review-f652b804..83c990b7.diff`. Did not run git or reread the changed files. A mechanical second pass over the supplied diff extracted exact new-file line numbers only.
- Named risk: capture-phase menu placement could double-toggle native details or prevent existing keyboard action navigation. Focused unchanged-code check of `agentwiki/apps/client/src/features/content-tree/ContentTree.tsx:321–354` confirms Enter/Space propagation is intentionally stopped by the directory, Arrow/Home/End remains handled by ContentTree, and Escape closes/restores summary focus. No finding.
- Named risk: pending reveal could wait forever because a selected-page ancestor never loads/expands. Focused unchanged-code check of `agentwiki/apps/client/src/features/space-workspace/useSpaceDirectory.ts:160–247` confirms authorized ancestry and levels are installed before ancestor expansion; directory reveal waits through loading and missing DOM row. No finding.
- Reported final evidence reviewed, not rerun: 3 affected suites / 51 tests passed, client `tsc --noEmit` passed, affected-file ESLint passed, diff check passed. The report records no final warnings; its intermediate TypeScript failure was corrected before the final commands.
- Own actual route verified from session `01a1109f-e226-7eb2-99df-699732669e73`: latest turn context `2026-10-06T10:10:53.434Z`, turn `01a110b1-d946-72a2-8695-381242f2b0e6`, model `p5c07ff/gpt-6-astra`, effort `ultra`. No model override/fallback, product edit, index mutation, commit or child agent.

## Assessment

**Task quality: Approved.**

The implementation satisfies the bounded behavior change and its reported regression checks. No blocking or minor defect was found; production browser acceptance remains the correctly separated controller gate.
