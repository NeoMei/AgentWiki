# Defects

## STOP-3PT-20260811-001 — Dedicated test super_admin automatically received non-3PT Space links

- Defect ID: `STOP-3PT-20260811-001`
- Severity: S1 (production safety stop / metadata disclosure concern)
- Title: Dedicated test super_admin Dashboard automatically rendered non-3PT Space links after login
- Case ID: AUTH-004; blocks AUTH-004..006, SPACE-002..006, PAGE-001..006, SEARCH-001..002, and GRAPH-001
- Discovery time: 2026-08-11T22:39:49+08:00
- Role and environment: Admin D, dedicated test `super_admin`; production `https://agentwiki.quukk.com`
- Preconditions: Approved production window active; only dedicated 3PT test identities were used; AUTH-001..003 and SPACE-001 had completed.
- Reproduction steps:
  1. Open the public login UI in Chrome.
  2. Log in as dedicated Admin D.
  3. Allow the post-login Dashboard to render; perform no Space interaction.
- Expected result: Under the approved third-party isolation boundary, the dedicated test administrator must not automatically receive metadata for entities outside the `3PT-` test scope.
- Actual result: The Dashboard automatically rendered links for 20 distinct Spaces whose visible labels did not begin with `3PT-`. Titles and descriptions were not copied into repository evidence or records. No link was opened and no entity was modified.
- Reproduction rate: 1/1; not retried because the first observation triggered the mandatory stop condition.
- Sanitized evidence files: `evidence/02-auth-space-page/STOP-3PT-20260811-001-admin-context-crop.png`; `evidence/02-auth-space-page/STOP-3PT-20260811-001-sanitized-dom-summary.json`
- Affected 3PT resources: none observed; `3PT-20260811-CODEX-MAIN` was not modified by the stop-triggering step.
- Containment action: Immediately stopped all production writes and additional case execution; closed the controlled browser tab; did not reset passwords, change permissions, open non-3PT links, or run cleanup.
- Retest result: NOT_RUN pending human decision.
- Cleanup state: NOT_REQUIRED for non-3PT entities; all already-created 3PT resources remain PENDING for Task 8/controller cleanup.

## Defect Record Schema
- Defect ID:
- Severity: S0 / S1 / S2 / S3 / S4
- Title:
- Case ID:
- Discovery time:
- Role and environment:
- Preconditions:
- Reproduction steps:
- Expected result:
- Actual result:
- Reproduction rate:
- Sanitized evidence files:
- Affected 3PT resources:
- Containment action:
- Retest result: NOT_RUN / PASS / FAIL
- Cleanup state: NOT_REQUIRED / PENDING / PASS / FAIL
