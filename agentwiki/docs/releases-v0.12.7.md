# AgentWiki v0.12.7

Fixes false `BASE_STALE` errors when Obsidian pushes a page after Pull or after choosing to keep local content.

- Page snapshots use the persisted Page version in ordinary and batch revision writers.
- Batch timestamps preserve UTC values when PostgreSQL uses a non-UTC session timezone.
- Previously published snapshots remain immutable. Their historical version tokens are accepted only while the current head and live page content, title, path, folder and timestamp still match the published state.
- Real concurrent changes continue to fail the existing optimistic concurrency checks.
- No database schema migration or sync protocol package upgrade is required. Obsidian users need AgentWiki Sync 0.5.5 or newer for the corresponding client-side version fix.

Validation:

- Server typecheck, build, targeted ESLint and whitespace checks passed.
- 4 targeted suites / 79 tests passed, including production API and Worker module compilation.
- PostgreSQL regression: 6 tests passed with `Asia/Shanghai` forced on every connection; covers ordinary and batch writers, historical drift recovery, Folder rename, and concurrent-change rejection.
- Full server suite: 2,646 passed, 10 failed, 26 skipped. The 10 failures in two MCP suites reproduce unchanged on v0.12.6 (`audit.record` mocks); this release introduces no additional full-suite failures.
- Application release version alignment check passed. Production deployment and native Obsidian acceptance are recorded separately.


Production acceptance (2026-09-25):

- Deployed v0.12.7; API, Worker, Frontend and public health checks passed. Production source hashes match the release candidate.
- In the native Obsidian NeoMei-Docs vault, resumed the confirmed keep-local upload and verified `published` / `verified`. User-selected empty content matches the server; reopening Sync shows no local or remote changes.
- The new Page and snapshot versions match exactly; the previous immutable snapshot remains unchanged.
- Detailed cross-project evidence: <https://github.com/NeoMei/agentwiki-sync/blob/main/docs/agentwiki-sync-v2-version-consistency.md>.
