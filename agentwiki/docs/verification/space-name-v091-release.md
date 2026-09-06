# AgentWiki v0.9.1 release — 2026-09-06

Status: **published, deployed and publicly accepted**.

Source and immutable `v0.9.1` tag target: `072a93c0`. GitHub Release: https://github.com/NeoMei/AgentWiki/releases/tag/v0.9.1 . Local master was fast-forwarded, and source/tag were pushed. Unrelated main-worktree files and submodules were preserved.

## Released behavior

- Space creation and renaming trim names and enforce 1–32 validator.js units, including surrogate-pair and variation-selector handling. Invalid input is rejected without silent truncation.
- Existing longer names remain intact. Saving other settings omits an unchanged name; an actual rename follows the new limit.
- Dashboard, Space headings and breadcrumbs fit narrow viewports; Chinese and English validation messages are available.
- Local Sync validates names before authorization and plan confirmation. The server stores the trimmed name while preserving the raw confirmed plan/hash and raw bootstrap/replay name for existing CLI compatibility.
- App/server/client and Local Sync are 0.9.1. Protocol remains published 0.6.0. Both Local Sync 0.9.0 and 0.9.1 are supported; installation instructions and exchange receipts retain the requested version.

## Local source and package evidence

The final functional source is `8784acd2`, with reviewed README correction `6dc3fb4b` and release handoff documentation `072a93c0`. Source and operational review both closed at C0/I0/M0.

| Stage | Passed | Skipped |
| --- | ---: | ---: |
| Runtime | 258 | 1 |
| Database | 175 | 0 |
| Server | 2548 | 1 |
| Client (all 93 files) | 1270 | 0 |
| Protocol | 140 | 0 |
| Local Sync | 886 | 1 |
| Total | 5277 | 3 |

Typecheck, lint, complete build, registry collision and protocol registry parity passed. Database cleanup left zero public tables, temporary test schemas or extra connections. A 1,282-file hash inventory confirmed no functional-source change during the final regression; the only later difference was the reviewed README correction.

The first fresh regression attempt omitted the required `PG_DUMP_BIN`: runtime passed, while the DB stage had 63 passes and 71 failures. The corrected complete staged run above uses explicit PostgreSQL 16 paths and isolated PostgreSQL50415/Redis50416. Failed logs remain in private evidence; this is not a claim that the initial command passed. Earlier 6e677804 testing also retained its separate PageEditor timeout/recheck evidence.

Published Local Sync tarball:
- SHA-1 `94276ff8aef119b947a907f78314b61b7e4ca638`
- SHA-256 `e202ecd5011ef68973fac7492642c0f8cafa4691f09bea23e00f7706d95f4ac4`
- 153 files, 171,920 bytes

npm initially required browser authentication; the authenticated publish exited 0. Registry propagation initially returned E404. After availability, the exact public artifact hash matched, and a fresh directory/cache install verified Local Sync0.9.1, exact protocol0.6.0 dependency and CLI help. An initial metadata checker expected an object rather than npm's single-item array; it was corrected before the successful install verification. Protocol0.6.0 was not republished.

## Production deployment and recovery

Target: `root@113.249.120.24:/root/agentwiki`; public site https://agentwiki.quukk.com . Authenticated preflight confirmed PostgreSQL16.14, database agentwiki, schema public, role agentwiki, the same cluster and extension ownership, 55 successful migrations with exact source checksums, and zero pending or unresolved migrations.

- Reviewed deployment wrapper SHA-256: `9831184fefe1841d828b2fe5c450c6cda2f4fa60bc4b084d8ee818f46231dd5b`.
- Recovery core SHA-256 unchanged: `888ff26aadb00bf787fa515f52663c1131d9f75d82681af8d8abd73260c5d4d6`.
- Private helpers and recovery instructions: `/root/agentwiki-release-tools-v091/`.
- Staged build and OpenCode runtime preflight passed before maintenance. All three writers stopped before the paired database, attachment, application and systemd backup.
- Verified backup: `/var/backups/agentwiki/space-name-v091.qj7XtW`.
- Backup manifest SHA-256: `02304cdd72dbf8ed97b1ab25dc601b2c5f09b8c5c9b6ce69c9731e056c0b56b8`.
- Previous application: `/root/agentwiki-previous-20260906205927`.
- Deployment exited0, with no pending migration. The 1,032 deployed input files exactly matched the release candidate.
- Both production env files changed only LOCAL_SYNC_PACKAGE_VERSION to0.9.1. Other config/secrets and exact composite allowlist `cmt024s4808nm3gmnko5v9gj5` were preserved.
- API, worker and frontend are active with NRestarts0. Public health reports status, database, Redis, audit persistence and attachment storage all ok.

The backup references do not authorize discarding later production writes. No disaster restore was executed.

## Real public acceptance

Chrome via the reviewed repository Playwright acceptance script used the actual public API, without HTTP mocks, at390×844 and1440×900. API smoke passed32 checks.

| Journey | Result |
| --- | --- |
| Old69-character Space before upgrade | Preserved; mobile dashboard/Space/breadcrumbs fit390px |
| New33-character name | UI submission disabled and API400 |
| Trimmed32-emoji name | Created; reload and API readback agree |
| Legacy-name settings save | Description persists without renaming the legacy Space |
| Rename | Invalid33 rejected; valid trimmed name persists after reload/API readback |
| Languages | Chinese and English errors verified |
| Manual installation | Both0.9.0 and0.9.1 issued/exchanged exact requested version |
| Device approval and bootstrap | Both versions passed, stored name trimmed, raw response name and exact replay preserved |
| Unsupported version |0.9.2 start rejected with API400 |
| Browser errors | None |

Four fixture Agents were revoked, four Spaces soft-deleted, and the fixture user deleted. The resumable per-resource cleanup ledger passed and destroyed retained fixture credentials. Independent production read-only DB verification found zero active fixture users, Spaces or Agents. The initial cleanup DB probe used the wrong Agent field `deletedAt`; the corrected probe uses `revokedAt` and passed. Only exact release-owned IDs were targeted; normal audit/soft-delete retention remains.

Private candidate, logs, screenshots, reviews, scripts and cleanup receipts are retained under `/Users/neomei/.codex/recovery/agentwiki-v091-release-20260906/`. Earlier localhost browser evidence used fixtures and remains separate from the successful public run.

Boundary: this patch acceptance does not repeat external-model multi-client execution or a disaster-restore drill.
