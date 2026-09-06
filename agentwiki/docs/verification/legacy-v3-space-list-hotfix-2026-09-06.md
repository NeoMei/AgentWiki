# Legacy v3 Space-list hotfix — 2026-09-06

## Outcome

The public legacy-folder list500 is fixed and deployed. Candidate `4a824e74d69b7c149a608db08b943f28149f38c3` was merged through [PR #9](https://github.com/NeoMei/AgentWiki/pull/9) at `ef9f20dae4937941e5ba9579dccd0091657ca02b`; candidate and merge runtime trees match. Server stays0.8.0, protocol0.5.1 and Local Sync0.8.0; no npm publication or schema change was needed.

## Diagnosis and local proof

`listSpaces` used nullish fallback between persisted/live folder shapes, losing persisted root null, and passed Prisma Date directly to the strict canonical folder schema. Replacing the permissive test inspection stub with the real writer produced RED on undefined parent and Date-vs-string. The fix selects parent by actual source shape and calls `toISOString()`.

Mixed native, persisted legacy root/nested, no-revision live root/nested and empty cases now validate exact modes, revisions, permissions, counts/bytes and no writes. Focused23PASS/1conditional skip; affected89PASS/3conditional skips; fresh complete server126suites/2280PASS/1Windows-only skip; typecheck/lint/shared+protocol+server buildPASS; real isolated HTTP database lifecycle2/2PASS/0skip. Task and whole-hotfix reviews C0/I0, one nonblocking existing negative-test-log observation. Database suites used helper-owned random schemas in a loopback test database; production was not a test DB.

## Deployment and rollback evidence

Production target and migration preflight verified PostgreSQL16, all54 migration names matching deployed files,0unresolved; schema and lockfile matched candidate. The existing deployment script was wrapped only to insert target preflight and the coordinated backup after staged build, before unit replacement. API, worker and frontend writers were stopped before backup.

Custom PostgreSQL dump readability, source/captured attachment manifest equality and rehash, application archive readability, unit files and existing exact-runtime drop-ins were verified before switch. Pair-manifest SHA-256: `d5d0ca8b164401365063ff6e97c42ebab14ee4369381693287fefe92c25612da`; application archive SHA-256: `adc2449595614097ecb71a97f010ab373ae315a6674ef8e8ce32a8c7fa8cb814`. Private backup and previous application remain on the host. This proves capture/readability, not an executed destructive restore.

Migration deploy reported no pending migrations. Staged build and OpenCode runtime preflight passed. All three services returned active and remained at NRestarts0 after business checks; exact Node runtime drop-ins retained. Deployed changed-source SHA-256 `aa3cf629b5d1acac0b8987e0b5d81f14c9aeae90d0b7fd74516dc51b953a54cc` equals frozen candidate. Public health checks all ok, frontend200, authenticated business smoke32PASS.

## Public contract reproof

New controller-owned populated and empty legacy fixtures reproduced list500 before switch. The same fixtures returned strict list200 after switch, preserving source Revision IDs and legacy modes. Reads did not publish.

Plugin strict U1 verifier at40db5bc:4/4PASS, exit0. Populated R sequence4 became exactly one R3 sequence5; empty R0 became exactly one R3 sequence1. Candidate/fixed hashes respectively `af365f4ef81e6eef196a50b2c68093e27303dbce2c984c44beb0b6bfc3e0f277` and `b60db33064a60cb6bcf621e4e2b6e267610e5b71c2dc67ccfc0cb1a699a72203`. Exact full tree, Page/folder metadata, attachment metadata and downloaded PNG bytes passed. Seven owned U1 fixtures across historical attempts remain preserved; no main Vault or business Space was altered.

This unblocks plugin U2–U7, not completed plugin implementation/release or desktop/Android acceptance. Android was absent from ADB at this checkpoint. Plugin0.4.0 remains unreleased.
