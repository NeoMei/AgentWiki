# Defects

## Task 5 acceptance note — no new defect

- SOURCE-001, SOURCE-002, REVIEW-001..005, and SPACE-006 completed without a new product defect.
- The two failed invalid-URL Runs in SOURCE-002 were the expected bounded negative-path result; both stopped after the configured three attempts and a single controlled retry produced only one additional Run.
- REVIEW-005 returned HTTP 401 after the dedicated requester was locked, left the ChangeSet in `pending_review`, and did not publish the synthetic candidate. The requester was then unlocked and its dedicated test login was restored.
- All retained Task 5 resources remain limited to the `3PT-20260811-CODEX-` Space and are inventoried for Task 8 cleanup.

## STOP-3PT-20260811-001 — Dedicated test super_admin automatically received non-3PT Space links

- Defect ID: `STOP-3PT-20260811-001`
- Severity: S1 (production safety stop / metadata disclosure concern)
- Title: Dedicated test super_admin Dashboard automatically rendered non-3PT Space links after login
- Case ID: AUTH-004. At discovery it blocked AUTH-004..006, SPACE-002..006, PAGE-001..006, SEARCH-001..002, and GRAPH-001. After owner-authorized boundary revision, SPACE-006 resumed and passed in Task 5; the other previously blocked cases retain their recorded status until explicitly rerun.
- Discovery time: 2026-08-11T22:39:49+08:00
- Role and environment: Admin D, dedicated test `super_admin`; production `https://agentwiki.quukk.com`
- Preconditions: Approved production window active; only dedicated 3PT test identities were used; AUTH-003 and SPACE-001 had completed. AUTH-001 and AUTH-002 are not treated as PASS.
- Reproduction steps:
  1. Open the public login UI in Chrome.
  2. Log in as dedicated Admin D.
  3. Allow the post-login Dashboard to render; perform no Space interaction.
- Expected result: Under the approved third-party isolation boundary, the dedicated test administrator must not automatically receive metadata for entities outside the `3PT-` test scope.
- Actual result: The Dashboard rendered 40 link elements, deduplicated to 20 distinct href/Space references, whose visible labels did not begin with `3PT-`. Titles and descriptions were not copied into repository evidence or records. No link was opened and no entity was modified. The ten retained hashes are an intentional privacy-minimized sample, not complete coverage.
- Reproduction rate: 1/1; not retried because the first observation triggered the mandatory stop condition.
- Sanitized evidence files: `evidence/02-auth-space-page/STOP-3PT-20260811-001-admin-context-crop.png`; `evidence/02-auth-space-page/STOP-3PT-20260811-001-sanitized-dom-summary.json`
- Affected 3PT resources: none observed; `3PT-20260811-CODEX-MAIN` was not modified by the stop-triggering step.
- Containment action: Immediately stopped all production writes and additional case execution; closed the controlled browser tab; did not reset passwords, change permissions, open non-3PT links, or run cleanup.
- Owner disposition: Expected `super_admin` global metadata visibility was accepted for continuation; opening or mutating non-3PT resources remained prohibited.
- Retest result: NOT_RUN for the original passive metadata observation; SPACE-006 resumed separately and passed without opening or modifying non-3PT resources.
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
