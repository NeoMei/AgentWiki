# AgentWiki v0.12.2

Concurrent-write fix found by production stress test (8 parallel status reports: 4 failed with COLLABORATION_PROGRESS_INVARIANT).

- High-frequency board mutations (create/status/upsert/patch) now run at READ COMMITTED isolation: each writer touches its own task row, and the board event sequence is allocated atomically by the board-row lock, so concurrent agents no longer trip serializability retries.
- Whole-board plan import keeps SERIALIZABLE (rare, human/agent-triggered).
- Verified after fix: 8 parallel in_progress reports all return 200 and the event stream stays gapless.
- Local Sync and sync protocol versions remain 0.10.0 and 0.6.0.
