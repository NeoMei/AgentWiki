# AgentWiki v0.12.63 — bug report follow-up

This release includes `1a417a67`, the verified follow-up to the [10-20 bug report](https://agentwiki.quukk.com/pages/aa1739e9-092e-4b61-a4a1-8c63d634817a).

- Unify first-invalid-field validation in the actual ProductPage authentication entry and standalone forms, without native browser bubbles.
- Wire stale-note deletion in reading mode and prevent duplicate queued deletes from reusing a stale version.
- Reject task subtree deletion when other tasks still depend on it. Serialize board mutations with the Space lock and recheck human membership after waiting.
- Correct after-drop ordering, accept the middle of page rows as a drop target, and provide accessible Move up/down actions with read-only/filter guidance.
- Preserve task renaming and verify updates across card/detail/list views.

## Validation

The fix-level evidence is in [bug-report-20261027](../bug-report-20261027/README.md): client359, auth server18, taskboard/MCP62 including four real PostgreSQL cases, content-tree PostgreSQL38, Chrome authentication28 and directory6. Versioned build, typecheck and lint pass. The initial JavaScript budget remains unchanged at 550990/551000 bytes.

The final full repository gate passed: 8,425 checks, zero failures and five pre-existing conditional skips (runtime 319/1, PostgreSQL/Redis 244/0, server 3710/3, client 2887/0, protocol 140/0, local-sync 1125/1). All three temporary databases and the isolated Redis process were cleaned. See test-full.json. Release receipts are recorded alongside this file. A source release does not certify a production deployment; only the deployment/host/public/browser receipts establish those respective outcomes.

## Release scope

Web/API/client version: 0.12.63. No schema migration, npm package or protocol change. Local Sync remains 0.13.5; sync protocol remains 0.6.1. Existing business pages, notes, tasks and folders must be preserved; acceptance uses isolated temporary resources and cleans them afterwards.

Freeze the exact commit and use a clean detached checkout for deploy.sh, which packages working-tree files. Back up application/configuration plus database/attachments, verify an isolated restore, then deploy and verify source hashes, services, public assets and the changed browser flows.

## Publication and production acceptance

[GitHub v0.12.63](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.63) is the formal latest release, with the annotated tag resolving to `c4fe12bda31e41c355735cd0d09dbcad834c30b5`. Production Web/API/Client are 0.12.63. Independent host verification matched all 1443 source files; three services are active and all five health fields are ok. Public HTML and all five entry assets match production hashes.

The paired application/configuration/database/attachment backup is server-private at `/var/backups/agentwiki/bug-release-v01263.VaQNOfbS`. An isolated restore verified 85 public tables and 65 completed migrations, then removed the temporary database. Previous application tree: `/root/agentwiki-previous-20261027212359`; recovery must use the matching backup and account for post-backup writes.

Production Chrome acceptance passed 33/33 checks: 21 invalid authentication cases, normal temporary-user login, page/folder reorder and cross-folder moves, keyboard menu, refresh and a second independent browser context, stale-note deletion without page mutation, task renaming, cancelled deletion, dependency rejection, and confirmed subtree deletion. The first attempt omitted parentId:null from its test fixture; the second run corrected the fixture with no product change. Both attempts' temporary Spaces and accounts were deleted and read back as inaccessible. No model requests were made or existing user profile changed.

The production role was owner; readonly UI boundaries retain their local-test evidence. The independent Chrome context is not a native desktop client. These limits are retained in production-browser.json. Host/public/browser evidence, backup restore, and GitHub receipts are separate files in this directory.

The original report received the final production reply via published ChangeSet `cmvqq2sfc00fuowgd942rknqm`, with exact MCP readback and Chrome rendering confirmed. Historical report content was preserved. The temporary detached release checkout, browser sessions and task-owned SSH control connection were cleaned up.
