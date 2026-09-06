# Sync v3 production checkpoint — 2026-09-06

## Result and scope

Server application 0.8.0 is deployed from `03703dfbf0d317f5ddd749e55eab8bc83064dda9`. This is a server deployment checkpoint, **not completed Obsidian image synchronization or a plugin release**. The plugin GitHub latest release remains 0.3.0 at this checkpoint; its v3 Push, UI integration, final review and real desktop/Android acceptance remain pending.

## Code and package gates

- Whole-branch review findings were repaired at `1ad95c8e8d562c6f44d95f6b658bf1419ed65543`; the scoped re-review found no Critical, Important or Minor issue.
- Frozen `1ad95c8` root verification: 4,818 passed, 3 expected platform/fixture skips, 0 failures. Database tests were 157/157 with no skipped database gate. Runtime: 232 passed/1 skip; server: 2,280 passed/1 Windows-only skip; client: 1,139; protocol: 133; Local Sync: 877 passed/1 skip. Typecheck, lint, build and audit passed; audit reported zero known vulnerabilities.
- The same SHA passed six real loopback browser cases. This is local browser evidence, not production UI or Obsidian device evidence.
- The final two-file deployment-entry correction `03703df` passed an actual-command RED/GREEN fixture, independent clean review, 65/65 focused tests and shell syntax verification. No runtime application behavior changed after the full gate above.
- Public `@neomei/agentwiki-sync-protocol@0.5.1` artifact parity passed.
- Public `@neomei/agentwiki-local-sync@0.8.0` propagation, exact candidate integrity and a fresh-cache official-registry install passed. Its public CLI help ran successfully with protocol 0.5.1. Integrity: `sha512-y9eYtYCNijtPTAYk+YJggE0bGJxT/cwlH9uwyrVU5fHqIJ8x11OiUfDuEfqsjEVKQ/ZW6DSqeSJgacAor4SI0g==`.

## Deployment and recovery boundary

Before migrations, API/worker writers were stopped and a coordinated PostgreSQL custom-format dump plus attachment tree was captured, hashed, copied and rehashed as one matching pair. `pg_restore --list` and the separate application archive verification passed. The effective pre-migration pair's manifest SHA-256 is `ad65ce02578f33745f6641403015397dd5844113deb1e9b966e7e26ae074e0ba`; application archive SHA-256 is `edb404608420726651e9e8c0ad93ca5aed8558aca89df9f21744ce00b40e7e60`. Backups and the previous application remain on the production host. This verifies backup capture/readability, not an executed destructive restore.

All five forward v3 migrations were applied. Initial activation encountered systemd `203/EXEC`: the configured Node executable resolved into a home directory hidden by `ProtectHome=tmpfs`. The operator explicitly approved an exact read-only bind of the resolved Node executable for API and worker. Their drop-ins preserve home isolation, strict system protection, the existing read-only application binding, private temporary directories and the worker's no-exec temporary mount. This is an operator-managed runtime exception; future Node upgrades must revalidate the exact target. No broad home bind or application-only rollback against the migrated database was performed.

API, worker and frontend subsequently became active. API/worker restart counters remained unchanged at 31 (historical failures from initial activation), rather than continuing to loop.

## Public and production checks

- Public `/api/health`: status, database, Redis, audit persistence and attachment storage all `ok`; frontend HTTP 200.
- General authenticated production business smoke: 32 checks passed; synthetic cleanup passed.
- Referenced-image API smoke: 24 checks passed, including synthetic Web upload/Page reference → v3 snapshot; authenticated fixed-Revision Blob byte/hash verification; unauthenticated denial; referenced archive rejection; stable attachment identity and exact reference preservation through rename; detach retaining the active business attachment; repeated reads not creating a Revision. Synthetic Space/user cleanup passed.
- Worker-equivalent hardened execution of the native OpenCode 1.18.12 binary passed; the actual deployed runner's model catalog probe passed.
- A synthetic authenticated Assist canary reached `queued → running → done`, returned nonempty summary and changes, and cleaned up successfully without publishing the proposed Page change. The first canary harness timed out because it expected `completed/succeeded`, while the real queue persists `done`; the corrected assertion passed on a new canary. No model-routing policy change was made to obtain this result.
- The real Chrome production Agent onboarding guide visibly displayed AgentWiki 0.8.0 and the fixed `@neomei/agentwiki-local-sync@0.8.0` command. This page check is not production image-rendering acceptance.

## Remaining release gates

1. Publish/reconcile server GitHub source and record the resulting remote SHA separately; remote `master` was still `711cae77277af1f79c6f4c16f998dbc66f6e2dae` when this checkpoint was written.
2. Complete plugin v3 Push and unified UI, scoped reviews, whole-branch review and final compatibility/fault-injection gates.
3. Execute real image flows in the isolated desktop Vault and the connected Android device. USB authorization and a passing mock are not mobile acceptance. No main Vault was modified for this checkpoint.
4. Publish immutable plugin tag `0.4.0` only after those gates, then verify release assets, attestations, community-list state and the actual installed bundle separately.

No credentials, raw database dump, user Markdown, Blob bytes or authenticated URLs are included in this report.
