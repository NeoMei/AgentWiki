# AgentWiki v0.12.9

Agents using project-taskboard can reuse their existing AgentWiki MCP connection to synchronize plans and report progress without another server URL or API key configuration.

- Adds `get_taskboard`, `import_taskboard_plans`, and `update_taskboard_status` using the authenticated MCP principal and existing Space permissions, claims, dependencies, concurrency checks, task events and audit trail.
- Imports up to 20 Markdown/board.json documents and 2 MB of UTF-8 content per call. Files commit independently; invalid documents return explicit per-file failures. Reimports preserve remote execution by default.
- Publishes usable tool schemas on the MCP wire and rejects malformed/oversized batches. Partial import failures are audited as failures.
- Existing Local Sync 0.10.0 gateways expose these as `wiki_*` tools with `__args`; refresh/reconnect the MCP gateway after deployment. No npm package, sync protocol or database schema update is required.
- project-taskboard skill guidance now prioritizes MCP, resolves the target Space, preserves source identities across worktrees, handles partial failure, and keeps standalone HTTP as an explicit fallback.
- Repairs stale MCP test constructor arguments left by the earlier memory-service removal, restoring the 10 previously failing MCP tests.

Validation:

- Server MCP/taskboard and production API/Worker module tests: 7 suites, 58 tests passed, including a real MCP client/server transport round trip.
- Existing Local Sync gateway integration tests: 3 passed, including taskboard argument forwarding and partial-error propagation.
- Server build, server/client typechecks, targeted ESLint and whitespace checks passed.
- project-taskboard Python tests: 21 passed. Skill behavior checks cover existing MCP, ambiguous Space, reader access, batching, missing tools, stable source identities and partial failures.

Production deployment and live MCP acceptance are recorded separately.
