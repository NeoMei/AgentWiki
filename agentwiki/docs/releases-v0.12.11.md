# AgentWiki v0.12.11 release preparation

Status (2026-10-01): local application candidate. GitHub release, production deployment and final Q2 live acceptance are pending. This document does not declare all 20 defects and both onboarding issues closed. The item-level evidence and remaining gates are tracked in [AgentwikiQ 2 verification](verification/agentwikiq2-v01211.md).

Changes implemented and independently reviewed so far:

- Correct publisher onboarding with published Local Sync 0.10.1 and sync protocol 0.6.1. Both device bootstrap and one-time-code installation use the 16 supported scopes; the original server plan, canonical hash and strict scope integrity checks are retained. Unsupported Agent memory scopes are not granted.
- Require real Space membership for human writes, including platform administrators; keep nonmember access read-only and preserve executable Agent-grant and page/folder binding checks.
- Translate collaboration entry points, roles, review instructions and bounded error guidance; remove Git from new-source creation, refresh review/loading state, and show accurate source-run results.
- Refresh continuation instructions and permissions on collaboration reentry and bound card layout at desktop/mobile sizes.
- Measure and place knowledge-graph labels without overlapping nodes/other labels, retaining full-title selection/navigation; open accepted Markdown and protected attachment images in an accessible, bounded enlargement dialog using existing image URLs.
- Align application, server and client manifests to 0.12.11. The independently published sync packages remain Local Sync 0.10.1 / protocol 0.6.1.

Recorded validation before final release:

- Published npm package parity and fresh public-registry installation passed. Both publisher contract paths passed against real server services with bounded persistence/MCP test adapters: 16 scopes, raw server plan, and tamper rejection. These contract checks do not prove live production device authorization or host page reads.
- Isolated runtime gate: 262 passed, zero failures, one platform skip. Database gate: 59 files / 216 passed, zero failures/skips. Full isolated server gate before the final taskboard changes: 160 suites / 2737 passed tests, four existing skipped tests.
- Collaboration continuation/layout checks: 256 client tests and one local Chrome fixture passed. Graph/image checks: 137 tests and two local Chrome fixtures passed; browser API responses were fixtures, so live page authorization/external-network behavior remains pending.
- Public TLS chain repair was separately verified with Node default trust and public health 200. Official Obsidian Sync 0.5.6 assets passed 20 early public API/disk-Vault checks; this covers the original pre-deployment v2 path, not native Obsidian GUI/Windows or the final candidate.

Remaining release/deployment gates:

- Finish and independently review taskboard hierarchy/status closure, then perform a whole-branch independent review and rerun full applicable regression, typecheck, lint and build on the final candidate. The earlier full-client gate had four stale assertion failures, and the initial bundle exceeded the 550000-byte budget; follow-up work is tracked separately and no budget increase or final full-build success is claimed here.
- Stage the complete build/root dependencies before production writes and reconcile the preserved live Assist fixes. Compare deployment inputs and migration inventories; avoid unneeded migrations.
- While writers are stopped, create and verify a paired PostgreSQL/attachments rollback snapshot and manifest before activation. Retain the previous application and static assets.
- Publish the application release, deploy the reviewed candidate, and verify API/Worker/Frontend health plus real business/browser behavior for all 20+2 items. Reverify official npm device/code publisher onboarding with actual MCP page reads, and rerun the official plugin public sync checks against the deployed candidate.
- Remove only self-created fixtures after retaining nonsensitive evidence. Report implementation, local tests, public package/application publication, deployment and live acceptance separately.
