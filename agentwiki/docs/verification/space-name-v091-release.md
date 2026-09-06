# Space name v0.9.1 release

Status: **release preparation in progress; not published or deployed**.

User authorized release on 2026-09-06. Baseline remote master is `9e6dc9a9` (v0.9.0 release evidence); the name fix is committed as `6e677804` in the isolated `codex/composite-page-group-agent-collaboration` worktree.

## Release behavior

- Newly created and renamed Space names are trimmed and limited to 32 validator.js units, including surrogate-pair and variation-selector handling. Inputs are never silently truncated.
- Existing longer names remain intact. Saving other Space settings omits the unchanged name; an actual rename must satisfy the new limit.
- Dashboard, Space heading and breadcrumbs fit narrow viewports; the limit and errors are localized in Chinese and English.
- Onboarding keeps the raw confirmed plan/hash and raw bootstrap/replay name for published old-CLI compatibility, while storing the trimmed name. The new CLI validates before authorization and confirmation.
- This patch releases app/server/client and Local Sync 0.9.1, retains published sync-protocol 0.6.0, and accepts both Local Sync 0.9.0 and 0.9.1. Installation instructions and exchange receipts must match the requested supported version.

## Local evidence

The earlier name-fix validation on `6e677804` passed 5,265 tests across stages with three explicit non-DB skips. This was not a single first-attempt full-suite pass: the unchanged PageEditor test had a one-second lookup timeout; its isolated file and the complete controlled-concurrency client suite subsequently passed. Prior browser validation used local production-build HTTP fixtures, not the public API.

Frozen release preparation commit: `8784acd29e03f1a3c9275732e8cb06f7ae1756c9`.

Fresh focused checks passed: server 199, client 79, Local Sync 886 with one explicit skip, runtime contract 33 and registry gate 14. Typecheck, lint and complete build exited 0. The public registry collision check confirms Local Sync 0.9.1 is available. Protocol 0.6.0 byte parity and candidate clean install using the actual public protocol passed.

Exact Local Sync candidate SHA-256:
`e202ecd5011ef68973fac7492642c0f8cafa4691f09bea23e00f7706d95f4ac4`.
SHA-1: `94276ff8aef119b947a907f78314b61b7e4ca638`.

The first fresh full-regression attempt passed runtime 258 tests with one skip but its database stage failed because the controller omitted the required `PG_DUMP_BIN` environment setting (63 passed, 71 failed). This is not a passing full run. The failed log is retained; the corrected run uses explicit PostgreSQL 16 tool paths and the isolated 50415 PostgreSQL / 50416 Redis targets.

The corrected run passed every repository phase: runtime 258 with one skip; database 175 with zero skips; server 2,548 with one skip; client 1,270; protocol 140; Local Sync 886 with one skip. Total: **5,277 passed, three explicit skips**. Client ran all 93 files with bounded worker concurrency. This is a complete staged regression run, not a claim that the earlier failed command passed.

After tests, the dedicated database had zero public tables, zero extra test schemas and zero extra connections. The frozen 1,282-file source hash inventory changed only `README.md` for reviewed documentation correction `6dc3fb4b`; source/artifact bytes were unchanged.

Task-level independent review is clean (C0/I0/M0) after correcting README to describe the actual fail-closed registry metadata gate. Whole-branch source review from `9e6dc9a9` through `6dc3fb4b` also passed C0/I0/M0.

Operational review identified non-resumable fixture cleanup. The private script now writes an atomic per-resource ledger and verifies exact fixture ownership before deletion. Five local HTTP stub tests pass, including lost responses, expired-token recovery and identity-mismatch rejection. The generated fixture credential is kept privately until cleanup passes; reauthentication is bound to the exact fixture user and credentials are then destroyed. A 401 never proves deletion: the final resource remains unresolved until independent evidence is available. Final scoped operational review passed C0/I0/M0; prior findings are closed. Bash/Node checks and two recovery-core tests passed. The reviewed deployment wrapper SHA-256 is `9831184fefe1841d828b2fe5c450c6cda2f4fa60bc4b084d8ee818f46231dd5b`. No disaster restore was executed.

## Operational boundary

- Target: `root@113.249.120.24:/root/agentwiki`, public `https://agentwiki.quukk.com`.
- Require actual target/database/service verification and paired PostgreSQL, attachments, application and systemd backup before deployment. No pending migration is expected; reject drift.
- Preserve both production env files and existing composite Space allowlist. No temporary fixture allowlisting is needed for this patch.
- The prior SSH control connection has expired; direct BatchMode authentication is denied. npm and GitHub authentication were confirmed. Restoring server login is an environmental prerequisite; release authorization is already granted.
- No npm publication, source push/tag, production fixture, backup, restart or deployment has occurred in this patch release preparation yet.

Private operational scripts, preservation snapshot, reports and real API/browser acceptance script are under `.superpowers/sdd/2026-09-06-space-name-v091-release/`. Do not confuse the prepared acceptance script with a successful production run.

## Ready candidate, environmental hold

All local source/package/regression/review gates are complete. Actual release remains blocked on the expired production SSH login. Rechecked npm latest is 0.9.0, remote master is 9e6dc9a9 and no v0.9.1 tag exists. Main worktree status, 47 untracked-file hashes and five submodule states match their preservation snapshot exactly. No public fixture was created.
