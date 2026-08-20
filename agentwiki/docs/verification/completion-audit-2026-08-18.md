# AgentWiki Completion Audit — 2026-08-18

## Conclusion

Five review rounds were completed. Previously published unified MCP and guide work is complete. The automatic knowledge-graph implementation had correctness, concurrency, lifecycle-hook, review-provenance, failure-state, large-space batching, and runtime-validation gaps; those gaps were repaired locally and the final regression review found no remaining release-blocking code defect.

The remediation is not committed, pushed, migrated, or deployed by this audit. Those external actions require separate authorization.

## Review rounds

1. Task-state audit: reconciled `.codex-memory`, implementation plans, verification reports, Git state, and the current code graph.
2. Data-flow and failure-path audit: traced page mutations, ChangeSet publication, deterministic reconciliation, LLM proposal lifecycle, worker sweeps, controller validation, and settings UI failures.
3. Concurrency and regression audit: added stale-snapshot protection, rebuilt the code graph, searched production source for unfinished markers, and inspected the full diff.
4. Independent production-path review: checked soft-deleted edges, manual/LLM unique-triple races, Obsidian and revert lifecycle paths, timer failures, settings invalidation, cross-Space UI reuse, and large-Space similarity behavior.
5. Database and final-gate review: applied all 35 migrations to a disposable local PostgreSQL database, ran every runtime DB test without skips, reran the full package suites and build gates, then removed the disposable database.

## Remediation summary

- Deterministic graph reconciliation now runs atomically and is serialized per space.
- Lightweight snapshot hashes use stable `pageId + updatedAt` streaming input and are written only after a locked recheck proves the page snapshot is still current.
- Automatic relation statistics use actual inserted/deleted row counts; failed creation cannot silently proceed to stale deletion.
- Automatic relations pointing at archived pages are removed during reconciliation.
- Page create/update/restore/archive and successful ChangeSet publication enqueue graph refreshes.
- ChangeSet revert and Obsidian finalize now index affected pages and enqueue refreshes; enqueue runs after indexing, still occurs if indexing fails, and Obsidian batches indexing at a maximum concurrency of eight.
- Default-enabled spaces without an existing `SpaceGraphState` participate in sweeps.
- Manual relations can take ownership of a matching automatic relation without violating the unique triple.
- Manual takeover and `auto_llm` publication share the graph-state lock with automatic reconciliation.
- LLM proposals have a valid human author, retain `auto_llm` when published, retry malformed JSON once, process every page including `6n+1` tails, deduplicate triples, skip human-owned conflicts, and use an atomic 24-hour per-space claim.
- Deferred LLM outcomes do not incorrectly advance the sweep content hash.
- Refresh layers and similarity thresholds return explicit HTTP 400 errors when invalid.
- Similarity pairs and content hashes are deterministic regardless of database row order; spaces above 2,000 embedded pages use bounded source chunks.
- Wiki-link resolution now preserves exact-match precedence before case-insensitive and slug fallbacks.
- Periodic sweep failures are contained and logged instead of leaking unhandled rejections.
- Settings changes invalidate the sweep hash; runtime toggle types and unknown settings are rejected with HTTP 400.
- The client settings card renders loading, failure, retry, and cross-Space reset states instead of disappearing or reusing stale values.
- Client graph tests cover origin badges and filters without duplicate renders or jsdom canvas noise.
- CodeMirror Range geometry is polyfilled only in the test environment to keep expected editor renders quiet.

## Verification evidence

- Runtime scripts: 106 passed against disposable local PostgreSQL, including graph row-lock, single-winner LLM claim, automatic-conflict skip, and compiled takeover checks; 0 skipped, 0 failed.
- Server: 57 suites, 571 tests passed.
- Client: 35 files, 160 tests passed.
- Sync protocol: 5 files, 22 tests passed.
- Local sync: 42 files, 358 tests passed.
- Aggregate: 1,217 passed, 0 skipped, 0 failed.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed; the existing PageEditor chunk-size warning remains non-blocking.
- Prisma schema validation and migrate status: passed against PostgreSQL after all 35 migrations, including `20260817234000_add_space_graph_llm_run_at`, were applied successfully.
- `git diff --check`: passed.
- Browser startup from the prior round rendered the local Vite UI and protected settings routes redirected to login. Authenticated settings interaction still lacks a persistent test account; loading, failure, retry, settings mutation, refresh, and cross-Space reset behavior are covered by component interaction tests.
- Final CodeGraph sync: 470 files, 5,821 nodes, and 17,090 edges; production source search found no `TODO`, `FIXME`, `HACK`, or `XXX` markers under `apps/` and `packages/`.

## Release boundary

Before deploying this remediation, back up production, apply migration `20260817234000_add_space_graph_llm_run_at`, verify migration status, and execute authenticated graph settings/refresh smoke tests. The migration chain and database-backed tests passed locally, but no commit, push, production migration, or release action was performed during this audit. Exact similarity remains CPU-quadratic by definition; batching bounds intermediate memory, and the feature stays disabled by default for large Spaces.
