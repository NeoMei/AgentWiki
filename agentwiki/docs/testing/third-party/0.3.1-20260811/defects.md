# Defects

## Task 6 defects — onboarding and local synchronization

### DEF-3PT-20260812-001 — Device authorization URL is not the canonical HTTPS production URL

- Defect ID: `DEF-3PT-20260812-001`
- Severity: S2
- Title: All three clients receive a non-canonical HTTP device-authorization URL that Chrome blocks
- Case ID: ONBOARD-001, ONBOARD-007
- Discovery time: 2026-08-12T00:37:00+08:00
- Role and environment: User A; production `https://agentwiki.quukk.com`; pinned local-sync 0.3.1
- Preconditions: A fresh isolated client HOME and the exact pinned onboarding command.
- Reproduction steps: Start onboarding, provide the approved 3PT plan, and inspect the emitted authorization URL without recording its query value.
- Expected result: The URL uses `https://agentwiki.quukk.com/onboard/device` and opens directly.
- Actual result: Codex, Claude Code, and OpenCode all received the same non-HTTPS, non-canonical origin; Chrome returned a client-side block. Replacing only the origin with the canonical production origin allowed the same request to be approved.
- Reproduction rate: 3/3.
- Sanitized evidence files: `evidence/04-onboarding-sync/ONBOARD-001-verification-url-summary.json`; `evidence/04-onboarding-sync/ONBOARD-001-codex-authorization.png`; `evidence/04-onboarding-sync/ONBOARD-007-claude-authorization.png`; `evidence/04-onboarding-sync/ONBOARD-007-opencode-authorization.png`
- Affected 3PT resources: Six sanitized Device Request handles, including the separate consumed-request handle retained by ONBOARD-006 evidence, are listed in `TASK6-resource-inventory.json`.
- Containment action: Used the canonical production origin while retaining the generated user-code query only in secure process memory; no non-3PT resource was accessed.
- Retest result: PASS — RETEST2 confirmed canonical HTTPS Device Auth URLs for all three clients and Chrome loaded the AgentWiki page without a client-side block.
- Cleanup state: NOT_REQUIRED for terminal Device Requests.

### DEF-3PT-20260812-002 — Codex and Claude gateway registrations fail client verification

- Defect ID: `DEF-3PT-20260812-002`
- Severity: S2
- Title: Generated Codex and Claude Code MCP entries are present on disk but are not accepted by their clients
- Case ID: ONBOARD-003, ONBOARD-007
- Discovery time: 2026-08-12T00:51:00+08:00
- Role and environment: User A; three isolated client homes; pinned local-sync 0.3.1
- Preconditions: Complete onboarding through gateway installation for Codex, Claude Code, and OpenCode.
- Reproduction steps: Inspect each isolated configuration and run product `doctor`.
- Expected result: Exactly one `agentwiki` MCP is registered and every client-specific registration check passes.
- Actual result: All three isolated configs contained exactly one `agentwiki` entry and retained the unrelated synthetic entry. OpenCode passed all doctor checks. Codex reported an invalid transport for the generated entry, and Claude Code reported no registered `agentwiki` server; their `mcp-registration` doctor checks failed.
- Reproduction rate: Codex 1/1; Claude Code 1/1; OpenCode 0/1.
- Sanitized evidence files: `evidence/04-onboarding-sync/ONBOARD-003-config-summary.json`; `evidence/04-onboarding-sync/ONBOARD-007-doctor-summary.json`
- Affected 3PT resources: Three local connections, Agents, credentials, and grant bindings listed in `TASK6-resource-inventory.json`.
- Containment action: Continued synchronization through the package gateway in the isolated homes only; did not modify daily client configuration.
- Retest result: FAIL — RETEST2 confirmed the generated cmd/command plus args shapes, but Codex and Claude still failed doctor mcp-registration; only OpenCode passed.
- Cleanup state: PENDING until SYNC-006 uninstall verification is recorded.

### DEF-3PT-20260812-003 — Preview omits required change and upload counts

- Defect ID: `DEF-3PT-20260812-003`
- Severity: S2
- Title: Onboarding and knowledge-sync previews report only processed/skipped files
- Case ID: ONBOARD-004, SYNC-001
- Discovery time: 2026-08-12T00:50:00+08:00
- Role and environment: User A; Codex and Claude isolated homes; production 0.3.1
- Preconditions: Prepare a synthetic Markdown/TXT bundle containing a create, update, and local deletion.
- Reproduction steps: Run `knowledge_prepare` and inspect the confirmation preview before synchronization.
- Expected result: Added, modified, deleted, skipped-file, and upload-size totals are displayed before confirmation.
- Actual result: The preview returned only `filesProcessed` and `filesSkipped`; no added, modified, deleted, or upload-size totals were available.
- Reproduction rate: 8/8 retained prepare observations returned the reduced summary shape.
- Sanitized evidence files: `evidence/04-onboarding-sync/ONBOARD-codex-until-sync.json`; `evidence/04-onboarding-sync/SYNC-001-diff-push.json`; `evidence/04-onboarding-sync/TASK6-ui-observation-summary.json`
- Affected 3PT resources: Local jobs and preview handles listed in `TASK6-resource-inventory.json`.
- Containment action: Confirmed only known synthetic fixtures and independently inspected the scoped 3PT Review diff before publication.
- Retest result: FAIL — RETEST2 onboarding first-sync previews still omitted added/modified/deleted/uploadBytes. The later gateway knowledge_prepare path did include those fields, but that does not satisfy ONBOARD-004.
- Cleanup state: PENDING with isolated-root cleanup in Task 8.

### DEF-3PT-20260812-004 — Deleting a source file does not propose a page deletion

- Defect ID: `DEF-3PT-20260812-004`
- Severity: S2
- Title: Local deletion of `obsolete.md` is omitted from preview and ChangeSet
- Case ID: SYNC-001
- Discovery time: 2026-08-12T01:02:17+08:00
- Role and environment: User A; Codex isolated home; production 0.3.1
- Preconditions: Publish the three-file baseline, Pull the authoritative Revision, modify `setup.md`, add `troubleshooting.md`, and delete only synthetic `obsolete.md`.
- Reproduction steps: Prepare, confirm, and inspect the resulting scoped Review diff.
- Expected result: One create, one update, and one delete are proposed; deletion applies only after confirmation and publication.
- Actual result: Review contained one create and one update but zero deletes. The published `obsolete` page remained present.
- Reproduction rate: 1/1.
- Sanitized evidence files: `evidence/04-onboarding-sync/SYNC-001-diff-push.json`; `evidence/04-onboarding-sync/TASK6-ui-observation-summary.json`
- Affected 3PT resources: Task 6 pages and ChangeSets listed in `TASK6-resource-inventory.json`.
- Containment action: Published only the visible create/update candidates; did not delete through an out-of-band path.
- Retest result: PASS — RETEST2 deletion of obsolete.md produced deleted=1 and an archive_page ChangeSet item.
- Cleanup state: PENDING with main 3PT Space cleanup in Task 8.

### DEF-3PT-20260812-005 — Synthetic credential marker is processed without warning or redaction

- Defect ID: `DEF-3PT-20260812-005`
- Severity: S2
- Title: Local preparation accepts and persists a fake-token fixture instead of flagging, skipping, or redacting it
- Case ID: SYNC-004
- Discovery time: 2026-08-12T01:06:22+08:00
- Role and environment: User A; Claude isolated home; production 0.3.1
- Preconditions: Add the approved literal fake marker to one synthetic Markdown file.
- Reproduction steps: Run preparation only, inspect sanitized counts, and search the isolated local-sync home without printing the marker.
- Expected result: The file or value is flagged, skipped, or redacted; the complete marker is absent from preview state.
- Actual result: Four files were processed, zero were skipped, no warning was returned, and the complete marker occurred twice in one private local preview-state JSON file. The preview was not confirmed, so the marker was not uploaded.
- Reproduction rate: 1/1.
- Sanitized evidence files: `evidence/04-onboarding-sync/SYNC-004-fake-secret-preview.json`; `evidence/04-onboarding-sync/TASK6-ui-observation-summary.json`
- Affected 3PT resources: One unconfirmed local job/preview only; no remote ChangeSet or page was created from this fixture.
- Containment action: Did not confirm the preview, removed the synthetic fixture before later syncs, and retained the isolated root for Task 8 cleanup.
- Retest result: PASS — RETEST2 skipped the approved fake-marker artifact, emitted one credential warning, and retained zero complete marker occurrences in preview state.
- Cleanup state: PENDING with isolated-root cleanup in Task 8.

### DEF-3PT-20260812-006 — NDJSON onboarding process remains open after a terminal event

- Defect ID: `DEF-3PT-20260812-006`
- Severity: S3
- Title: Onboarding emits completed/failed terminal state but does not exit
- Case ID: ONBOARD-001, ONBOARD-005, ONBOARD-006, ONBOARD-007
- Discovery time: 2026-08-12T00:50:24+08:00
- Role and environment: User A; isolated local clients; pinned local-sync 0.3.1
- Preconditions: Complete or deny an NDJSON onboarding session.
- Reproduction steps: Allow the coordinator to persist and emit a terminal event, then wait for the command to return.
- Expected result: The process exits promptly after its terminal event.
- Actual result: Completed and denied sessions remained open until the already-terminal wrapper was sent SIGTERM. Persisted checkpoints and emitted result events were complete before termination.
- Reproduction rate: 4/4 completed sessions observed so far, including the resumed Codex flow, plus 1/1 denied session.
- Sanitized evidence files: `evidence/04-onboarding-sync/ONBOARD-codex-complete.json`; `evidence/04-onboarding-sync/ONBOARD-claude-complete.json`; `evidence/04-onboarding-sync/ONBOARD-opencode-complete.json`; `evidence/04-onboarding-sync/ONBOARD-codex-denied-complete.json`
- Affected 3PT resources: No additional server resource; terminal session records are inventoried by sanitized Device Request handle.
- Containment action: Terminated only after the terminal checkpoint and result event were persisted; no active synchronization was interrupted.
- Retest result: PASS — RETEST2 completed and denied NDJSON commands exited naturally within 0.017–0.029 seconds after terminal events without SIGTERM.
- Cleanup state: NOT_REQUIRED for the process; local session files remain for Task 8 isolated-root cleanup.

### STOP-3PT-20260812-002 — Product uninstall cannot remove the isolated test gateways

- Defect ID: `STOP-3PT-20260812-002`
- Severity: S2 (production-safety cleanup stop)
- Title: All three client uninstall paths fail to restore the isolated pre-test configuration
- Case ID: SYNC-006
- Discovery time: 2026-08-12T01:18:00+08:00
- Role and environment: Three isolated client homes; pinned local-sync 0.3.1
- Preconditions: Each isolated config contains one synthetic unrelated entry and one onboarding-created `agentwiki` entry; before-config snapshots are retained privately.
- Reproduction steps: Run the documented `uninstall --agent <client>` path once per client and compare the resulting config with the private before snapshot.
- Expected result: The `agentwiki` entry is removed, the unrelated entry is byte-for-byte preserved, and the client config exactly matches its before snapshot.
- Actual result: Codex uninstall failed while loading the generated invalid transport; Claude uninstall could not find the generated user-scope server; OpenCode returned success and removed its local connection record but left the `agentwiki` config entry. All three configs still contain the test gateway and differ from the before snapshot. The unrelated entry remains present.
- Reproduction rate: 3/3.
- Sanitized evidence files: `evidence/04-onboarding-sync/CONFIG-01-before-summary.json`; `evidence/04-onboarding-sync/ONBOARD-003-config-summary.json`; `evidence/04-onboarding-sync/SYNC-006-uninstall-summary.json`
- Affected 3PT resources: Three isolated client configs; two retained local connection records; one orphaned OpenCode gateway entry. Daily client configurations were never read or modified.
- Containment action: Stopped further production write testing under Spec section 16.8. Did not manually rewrite the isolated configs or delete the isolated root; Task 8/production owner must choose the cleanup remediation while evidence is retained.
- Retest result: PASS — RETEST2 uninstall returned zero for all clients, removed gateway entries and connections, preserved unrelated entries, and restored all configs byte-for-byte.
- Cleanup state: FAIL for normal product uninstall; manual remediation is PENDING owner authorization.


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
- Retest result: NOT_RUN / PASS / FAIL / BLOCKED
- Cleanup state: NOT_REQUIRED / PENDING / PASS / FAIL
