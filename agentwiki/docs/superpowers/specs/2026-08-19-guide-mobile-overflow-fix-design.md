# Guide mobile overflow fix design

## Context

The production UI route smoke detected that `/guide` renders at 476 px wide in a
390 px viewport. Browser inspection traced the overflow to the Step 4 flex item
that contains `GatewayGuidePreview`: the item uses `flex-1` without `min-w-0`,
so the preview's min-content width expands the whole page.

## Selected fix

Add `min-w-0` to the Step 4 content flex item in `UsageGuide`. This allows the
existing inner package-name truncation to work within the available mobile
width. Keep the step layout, copy, spacing, and preview component unchanged.

## Boundaries

- Do not redesign or stack the numbered step layout.
- Do not change gateway behavior or copy.
- Do not modify unrelated guide sections.

## Verification

1. Add a focused component regression asserting the Step 4 content item keeps
   the shrink constraint.
2. Observe the focused test fail before changing production code, then pass
   after the minimal class change.
3. Run the client tests, typecheck, lint, build, and full repository tests.
4. Push the fix, redeploy with the existing rollback backups retained, then
   rerun production API smoke and desktop/mobile UI route smoke.
5. At 390 px, require `documentElement.scrollWidth <= clientWidth` on `/guide`.
