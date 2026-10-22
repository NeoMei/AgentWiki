# AgentWiki v0.12.57 / Local Sync 0.13.5

2026-10-23 用户明确授权发布。本轮 12 项缺陷修复及宿主识别/连接身份修复已部署至 https://agentwiki.quukk.com。

## Frozen release

- Web/API/client: 0.12.57; Local Sync: 0.13.5; protocol unchanged: 0.6.1.
- Source commit: `192315ed13e43df6d4a88dd7572076dbaca5fb19`.
- GitHub master and [v0.12.57 release](https://github.com/NeoMei/AgentWiki/releases/tag/v0.12.57) contain the frozen candidate. Release assets include the exact npm tarball and SHA256SUMS.
- Production: `root@113.249.120.24:/root/agentwiki`; root user API, worker and frontend services.
- Deployment used a clean detached checkout of the frozen candidate. Three ignored local Playwright evidence files were excluded by this clean export and preserved in the canonical worktree. The actual deploy archive matched all 1422 source-manifest entries with no extras.

## Verification

| Gate | Result |
| --- | --- |
| One uninterrupted `pnpm test:full` | 8223 passed, 5 environment skips, 0 failed |
| Build / complete typecheck / lint | Passed |
| Protocol 0.6.1 official registry parity | Identical; not republished |
| Local package install, local and registry protocol variants | Passed with Publisher contract and tamper rejection |
| Final npm pack / independent audit | 179 files, 207492 bytes, no private configs or keys |
| Official registry / isolated empty-cache install | Exact tarball bytes and SRI; package-lock sources match registry; all 179 installed files independently match |
| Coordinated production backup | Checksums, database catalog, attachment/source consistency passed; writers resumed after about 9 seconds |
| Deploy / database migrations | Exit 0; 65 migrations found, no pending migration |
| Production source / versions | All 1422 sources and 5 package versions match frozen candidate |
| Public HTML / entry assets | HTML and all 5 entry assets exactly match deployed files |
| Services / semantic health | Three user services active; status/database/redis/auditPersistence/attachmentStorage all ok |
| Public runtime guides | 14 checks passed, including pinned .4/.5 runners and invalid input rejection |
| External OpenCode | Worker-visible external 2.1.1; version/run-help/models-help probes passed |
| Browser and original report | Public guide generic/Codex/WorkBuddy tabs passed; original report has 12 release follow-ups with exact MCP readback and Chrome rendering, all 18 image elements retained |

The five test skips are independently installed CodeGraph (1), dedicated connection-authorization PostgreSQL/Redis suite (3), and Windows ACL behavior on macOS (1). Previous local Chrome regression: 17 cases. Existing Mermaid circular-dependency and large output chunk build warnings remain.

## npm publication

`@neomei/agentwiki-local-sync@0.13.5` is published and verified under `release-0-12-57`. SHA-256: `b566ae2a895e17fc4d5d22645e8184bd484d333fe5a87af330b2e897349c9e05`. Promotion to `latest` could not complete: npm's separate WebAuthn URL expired and the auth done endpoint returned E404. Registry readback still has `latest=0.13.4`; the exact 0.13.5 package and deployed app are available. Retry promotion with a fresh security-key prompt when the user is ready. See `npm-dist-tags.json`. The package was published before the app and checked before deployment; latest promotion follows successful production verification.

## Backup and recovery

Paired backup: `/var/backups/agentwiki/bugs-v01257.oap6txmn`. Previous application tree: `/root/agentwiki-previous-20261023015646`. Archive checks and `pg_restore --list` passed; no restore rehearsal was performed. Never activate the previous application as an assumed standalone rollback; any restore must consider its paired database/config/attachments and writes made after backup.

## Remaining acceptance boundary

Original billy account's 12 business scenarios remain separate manual regressions. Existing graph snapshots rebuild on the normal worker schedule (default six hours) or explicit refresh, not necessarily at deployment time. The installed-package contract uses bounded adapters and the local built server; the OpenCode probes do not issue a real model request. Actual client upgrade/restart followed by MCP reading, especially Windows/WorkBuddy, is not claimed by this release.

The original report and 18 image references were preserved. Each item received a narrow deployment follow-up without rewriting prior observations or bulk-closing its manual acceptance.
