# F7 Template preview entry focus

Confirmed product bug: NewContentPage composite single-page/group preview input has no autofocus strategy. It initially mounts disabled during previewLoading, so a plain autoFocus would not resolve the delayed case. Legacy details already focus correctly.

Implementation (only NewPageDialog.tsx + NewPageDialog.composite.spec.tsx):
- Page presentation arms one entry-focus intent on preview phase entry.
- Wait until preview exists and loading is false; consume intent before focusing title/group name.
- Any focusin during the wait cancels that intent. Leaving preview removes the listener and intent.
- Preview refreshes after title blur do not re-arm focus. Existing dialog behavior remains unchanged.
- Returning to select invalidates/aborts its pending preview and clears loading; no change to configure refresh restoration.

Related independently reproduced race: select Weekly → Next with unresolved request → Back → Weekly → Next → old request resolves. Without select-phase invalidation, loadPreview's previewLoading guard prevents the second request; the old result makes the new preview ready (and would wrongly satisfy focus readiness). Regression exercises overlapping requests and asserts old resolution keeps the new title disabled/unfocused until new response resolves.

Evidence:
- /tmp/agentwiki-comprehensive-audit-20261007/template-focus-red.log: before implementation, 3 failed / 15 passed; delayed single-page, group, re-entry missing focus.
- /tmp/agentwiki-comprehensive-audit-20261007/template-preview-invalidation-red.log: narrowly removing invalidation fails overlap regression at toBeDisabled after old response, independently reproducing the stale-preview bug.
- /tmp/agentwiki-comprehensive-audit-20261007/template-focus-green.log: NewPageDialog.composite + NewPageDialog specs 37/37 passed.
- /tmp/agentwiki-comprehensive-audit-20261007/template-focus-final-green.log: rerun after narrow mutation restored.
- pnpm --filter @agentwiki/client exec tsc --noEmit: exit 0.
- git explicit --work-tree diff --check: exit 0.

Read applicable design-rules/frontend-design-standards/frontend-page-workflow/component-reuse. This fixes behavior within the existing approved creation UI; no component, styling, copy, or E2E assertion changes. No commit, build, or runtime operation performed. Built UI acceptance remains root's gate.

Review hardening: both kind parameter cases now explicitly verify the second preview request carries Updated name, hold its response pending, assert the title is disabled and Cancel retains focus, then resolve the controlled refresh and assert the updated hierarchy renders, title enables and Cancel still retains focus. Final rerun: 37/37 PASS. All four logs are colocated in this evidence directory. Writes stopped for fixed-diff review.
