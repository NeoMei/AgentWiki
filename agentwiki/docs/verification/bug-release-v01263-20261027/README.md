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
