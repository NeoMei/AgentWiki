# Database release gate

- Candidate: `e3bbc2012b65ccf2ccba18724c43657989614528`.
- Runtime database coverage: all 61 files, 239 effective passing tests, 0 skipped, 0 unresolved failures.
- First runtime pass: 233 pass / 1 failure / 0 skipped. The failure was the dedicated Sync Version test database name not matching its defensive `agentwiki_sync_version_test_*` requirement, before product assertions.
- Remediation: provisioned a new matching disposable database, installed pgvector, applied migrations, reran only `sync-v2-version-consistency-db.test.mjs`: 6 pass / 0 fail / 0 skipped. No source edits and no duplicate test counting.
- Shared page notes real PostgreSQL + HTTP + MCP coverage: 7 passed, included in the 239.
- Full isolated server harness: 177 suites passed, 1 suite skipped; 3163 tests passed, 4 skipped, exit 0. Skips are the 3 existing opt-in `onboard-connection.db.spec.ts` cases and 1 Windows-only OpenCode runner case on macOS.
- Cleanup: all three exclusively created PostgreSQL databases dropped and absence verified; private Redis stopped after checking PID ownership; temporary data directory removed.

Evidence: `db-gate-runtime.log`, `db-gate-sync-retry.log`, `db-gate-server.log`, `db-gate-final-receipt.json`, `db-gate-cleanup.json`.
