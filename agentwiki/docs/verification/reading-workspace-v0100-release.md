# AgentWiki v0.10.0 release

Status: release preparation and production preflight passed; deployment/public acceptance pending.

User authorized integration, version preparation, backup, release, deployment and public acceptance on 2026-09-09. Functional release candidate eeb3f73d includes master cffe52aa and reading workspace a76b9971. Root/server/client are0.10.0; Local Sync0.9.1, protocol0.6.0 and independently released Obsidian0.4.0 remain unchanged. Relative image and legacy synchronization fixes on master are retained. No new server runtime, migration, protocol, npm package or authorization rule changes.

## Verification

- Runtime260 pass /1 skip; database181 pass /0 skip; server2570 pass /1 skip; client1417 pass /0 skip; protocol140 pass /0 skip; Local Sync886 pass /1 skip. Total5454 pass /3 platform-related skips, zero failures.
- Whole repository build/lint/typecheck passed. Existing Vite large-chunk warning retained.
- Integration/version review and private operations review each C0/I0/M0. Recovery helper tests2/2 pass; shell syntax check passed.
- First runtime attempt exposed an old assertion tying application version to Local Sync0.9.1. eeb3f73d removes only the application manifest from that sync-string list; application0.10.0 and independent sync versions are explicitly asserted. Failed log retained; full staged suite rerun passed.
- Earlier accepted real local reading/edit/save/history/conflict/permission/mobile flows are documented in reading-workspace-acceptance.md. Directory guides also passed actual desktop/drawer expansion and12 focused tests.

## Production preflight

- Authenticated root@113.249.120.24:/root/agentwiki, root user systemd API/worker/frontend active, public health all five fields ok. Live app version0.9.1. Backup filesystem324GiB available.
- PostgreSQL16.14, databaseagentwiki, schemapublic, roleagentwiki; attachment root/var/lib/agentwiki/attachments.56 applied migrations exactly match candidate, zero pending/unresolved. Two historical rolled-back attempt rows preserved; the first overly strict controller assertion counting all58 rows was corrected to applied/unresolved semantics. No data changes.
- Same-cluster/socket and extension recovery preflight passed.1036 deployed input files match cffe52aa exactly, zero missing/drift.
- Private v0.10.0 operations retain prior reviewed paired DB/attachment/application/systemd backup, migration parity and environment/allowlist preservation. No production migration expected.

Private evidence: /Users/neomei/.codex/recovery/agentwiki-v0100-release-20260909/. Secrets and fixture credentials excluded from Git. Main untracked49 files and five dirty submodules have pre-integration integrity inventories. Main pre-existing design/plan copies will be preserved before fast-forward integration.
