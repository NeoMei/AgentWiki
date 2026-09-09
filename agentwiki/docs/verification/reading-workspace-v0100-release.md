# AgentWiki v0.10.0 release

Status: published, deployed and publicly accepted. Immutable v0.10.0 tag targets5a4804e9. GitHub Release: https://github.com/NeoMei/AgentWiki/releases/tag/v0.10.0 (published2026-09-09T04:51:55Z). Later master commits only finalize these release records.

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

## Deployment and public acceptance

- Source7442f458 pushed to GitHub master and fast-forwarded local master; tested runtime source is eeb3f73d. Main source-byte comparison matched the fully tested candidate. An extra main client run initially failed five name-limit tests because its ignored shared-package dist was stale; rebuilding shared/protocol restored102 files/1417 passing tests. No product fix or test assertion weakening was required.
- Deployment exit0; paired verified backup `/var/backups/agentwiki/space-name-v0100.ryGZVf`, manifest SHA256 `c0cf0d0bf5609a65e34d5d5a806cdb6cfa56e8e836a830549b7c78e70de9b0a4`. Previous app `/root/agentwiki-previous-20260909124551`. No pending migrations;1326 deployed inputs/client build files match candidate, zero missing/different.
- Root/server/client report0.10.0; Local Sync0.9.1. API/worker/frontend active/running with NRestarts0. Public health all five fields ok. Both live env files byte-identical to the verified backup; all allowlists/secrets/config preserved.
- CUA public browser used existing Admin session only on this release's synthetic Space/Page. Actual three-level directory + guides, floating TOC jump, edit→save→history(v2)→return→reading→sources→browser-back passed. Editor save marker `PUBLIC-READING-RELEASE-20260909` and checkbox[x] verified by separate owner API GET, updatedAt2026-09-09T04:48:23.161Z. Preview action exercised; exact-text visible assertion was false because the saved marker was embedded in a paragraph, so do not count that assertion as proof. Persisted content/history and reading return were separately verified.
- Public desktop1280×720 and390×844 drawer/TOC screenshots retained privately; mobile scrollWidth390, no overflow. Browser console errors/warnings empty. Temporary viewport reset. Local deeper conflict, permissions, drag and restoration evidence remains separate from this bounded public smoke.
- Cleanup removed the exact release fixture account and soft-deleted its Space; independent production DB read confirmed user gone/deleted and Space deleted. No existing user content was edited. Test DB public tables and temporary schemas both0.
- All49 pre-existing untracked files preserved by hash; the two conflicting original spec/plan files are retained under private `main-originals/` while master contains the final tracked versions. All five dirty submodule status/diff hashes preserved.
- No Local Sync/npm/protocol/Obsidian release performed. Existing tags remain immutable. No disaster restore or external Agent model execution was repeated.
