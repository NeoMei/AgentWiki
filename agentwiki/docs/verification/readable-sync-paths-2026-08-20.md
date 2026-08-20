# Readable sync paths verification - 2026-08-20

## Result

The clean integration branch `codex/integrate-readable-sync-paths` now combines current `origin/master` `647c7f8` with the final candidate `b09ac37`. The `ReviewService` conflicts were resolved semantically: current-master archived-source restoration/revert behavior is preserved together with readable path allocation, the shared Space lock, PageVersion snapshots, optimistic CAS, archive provenance, and fail-closed revert validation.

Fresh verification on the resolved integration tree is all green. The full repository test command passed; the server passed all 61 suites / 647 tests, and a second runtime run against local PostgreSQL executed all 41 database-backed tests successfully. Runtime therefore finished with 122 passes, one explicitly gated external CodeGraph skip, and no database skips or failures. Root typecheck, configured lint, and the complete multi-package build also passed.

No production database, production service, deployment, package publication, or Obsidian marketplace state was changed.

## Revision and runtime

- Original branch: `codex/readable-sync-paths`, HEAD `294b694`.
- Temporary candidate branch: `codex/final-readiness-fixes`, current product behavior/evidence baseline HEAD `961c8eb`.
- Clean integration branch: `codex/integrate-readable-sync-paths`; first parent/current master `647c7f8`, merged candidate `b09ac37`.
- Final Fix 2 verification base: `2c4be9e`; the original branch then advanced through `294b694`.
- Task commits:
  - `caa2f44` readable allocator
  - `cc728d8` allocator byte/uniqueness hardening
  - `7035172` PageService integration
  - `7e8e2c2` root-path/restore concurrency hardening
  - `bc2c2ca` ReviewService integration
  - `a281057` atomic opaque-path migration
  - `8675ce6` clean-runtime migration build dependencies
  - `ad4bbfe` complete first migration revision bootstrap
  - `3af5ab9` bounded migration work and preloaded path keys
  - `57314a9` opaque-looking title idempotency
- Final Fix 3 candidate commits:
  - `415560a` reject different-hash opaque migration candidates
  - `4d4101c` reject restore after a concurrent Page change
  - `b8f848e` serialize Page reorder with restore through the Space lock
  - `665e723` bulk Page reorder in one parameterized statement
  - `9f1b430` audit archive and restore provenance with PageVersion/CAS
  - `bb7143f` whitelist archive-revert fields
  - `7cae89d` validate archive-revert dates
  - `06dc57c` stop already-completed fixed migration batches before scanning Pages
  - `83a90b6` fail closed on invalid archive prior state
  - `52d4549` return the original revision ID for a completed migration retry
  - `6e7c377` exercise the real retry guard and injectable CLI aggregation path
  - `961c8eb` pluralize CLI migration summary nouns correctly
- Node: `v24.18.0`
- pnpm: `11.9.0`

## Clean integration verification matrix

These are fresh results from the resolved integration tree.

| Package/gate | Files or suites | Passed | Skipped/blocked | Failed assertions |
|---|---:|---:|---:|---:|
| merged ReviewService focused regression | 68 tests | 68 | 0 | 0 |
| Review/Page/allocator/revision/search adjacent regression | 5 suites / 121 tests | 121 | 0 | 0 |
| runtime scripts with local PostgreSQL | 123 tests | 122 | 1 external CodeGraph gate | 0 |
| server Jest | 61 suites / 647 tests | 647 | 0 | 0 |
| client Vitest | 43 files / 203 tests | 203 | 0 | 0 |
| sync protocol Vitest | 5 files / 22 tests | 22 | 0 | 0 |
| local-sync Vitest | 59 files / 718 tests | 718 | 0 | 0 |

The single runtime skip is the separately authorized external CodeGraph standard-scan acceptance. All 41 tests that had previously skipped without `DATABASE_URL` ran against the local PostgreSQL instance and passed. The test harnesses used generated schemas and removed them in `finally`; a post-run schema-prefix query returned no matching test schemas.

### Other gates

- Root `pnpm typecheck`: PASS for server, client, sync protocol, and local-sync.
- Root configured `pnpm lint`: PASS.
- Root `pnpm build`: PASS for shared, sync protocol ESM/CJS, server, client, and local-sync. Vite emitted only its existing large-chunk warning.
- `git diff --check`, staged diff check, and conflict-marker scan: PASS.
- Independent semantic review: code findings 0 Critical / 0 Important / 0 Minor; reviewer-focused Review/Page run 98/98.

## Real-DB evidence boundary

Integration commands included:

```bash
DATABASE_URL=<local PostgreSQL> node --test scripts/*.test.mjs
```

The integration run passed 122/123 runtime tests with one external CodeGraph opt-in skip. Relative to the no-database run, all 41 PostgreSQL-backed cases executed and passed, including the updated different-hash readable migration fixture, deterministic shared-lock contention, migration-chain, rollback, concurrency, scale, and real Prisma/Redis HTTP cases. No production or pre-existing application schema was used.

The paragraphs below retain the earlier candidate evidence chronology for traceability; their prior skip limitations are superseded by the integration run above.

The earlier evidence used `DATABASE_URL` pointing only to `agentwiki_codex_readable_sync_20260820_01` and passed 31/31. Final Fix 2 at the original-branch candidate then reran the expanded command against a credential-free local PostgreSQL 16 connection with a fresh schema per test: exit 0 with **32 passed, 0 skipped, 0 failed** in 27.56 seconds. The run exercised real Prisma migrations and PostgreSQL transactions, Redis-backed HTTP flow, session/global-page-id concurrency, the 5,000-page/100 MiB bound, readable-path identity/body-hash preservation, idempotency, forced rollback, and the readable allocator concurrency gate.

That 32/32 run predates `415560a`. Fix 3A changed the real-DB fixture from equal legacy/title hashes to different hashes, exposing the case where a legitimate title itself produces another strict opaque-looking path. The temporary-candidate checkpoint could cover this only through the real production migration and allocator with the transaction/revision-writer boundary replaced in memory. The clean integration run has now executed the updated PostgreSQL fixture successfully: the first run chooses `pages/p-f...f (2).md`, preserves title/body/H1, and the completed-batch retry returns the original revision ID with `migrated: 0`. A separate first-run no-batch/no-page case returns `{ migrated: 0, revisionId: null }`.

The completed-batch coverage proves the behavior through two genuine migration calls in the first test: the first call migrates once, the second enters the real guard and returns the same revision ID with `migrated: 0`; revision and PageVersion counts remain one. The separate added-later-page case still proves `lock -> batch lookup` with no Page scan/write/`advance()`. The injectable aggregation path used by CLI `main()` covers a new revision, completed retry, and null empty-Space result, counting only one new revision. A fourth focused test proves singular output (`1 page path`, `1 space`, `1 revision`), while the mixed case proves plural output with singular revision. These non-DB regressions remain useful alongside the now-green real-PostgreSQL integration run.

Fix 3B and 3C likewise used deterministic transaction-boundary harnesses and raw-query argument inspection; no live PostgreSQL advisory-lock, rollback, bulk-SQL, archive-race, or restore-race proof was obtained for those changes in this sandbox.

The new gate first acquired the Space advisory lock in an external PostgreSQL transaction. It then started the actual `PageService.create()` entry and actual readable-path migration through separate, uniquely named Prisma connections. Bounded condition polling of `pg_stat_activity` observed both connection names simultaneously at `wait_event_type = 'Lock'` and `wait_event = 'advisory'` before the blocker was released. During that blocked state, a temporary wrapper around the actual production `ReadableSyncPathService.prototype.allocate` recorded zero calls. The wrapper delegates unchanged to the original method and is restored in `finally`. After blocker release, the unordered call record contained exactly one `page` and one `migration` invocation, both outer transactions committed, the exact paths were `pages/标题.md` and `pages/标题 (2).md`, and no Prisma `P2002` escaped. Therefore the observed waiters cannot be later re-entrant `revisionWriter.advance()` locks: both entries were proven blocked before their allocator call. This is distinct from the older `sync-v1-concurrency-db` coverage, which tests global page IDs and push-session idempotency rather than readable candidate allocation.

The contention test has a 25-second test timeout; its test clients use 20-second interactive transaction timeouts with 10-second acquisition bounds, while condition polling has a 5-second deadline. Failure cleanup restores the allocator prototype, releases the blocker, terminates only the three random test `application_name` backends, and bounds outcome settlement and disconnects to five seconds before dropping the schema. Every Final Fix 2 test used a generated disposable schema in the local `postgres` database and dropped it in `finally`; final schema-prefix and `fix2_%` activity lookups both returned zero rows. No production or pre-existing application schema was used. The earlier disposable database was likewise removed as recorded by the prior evidence.

## Behavior verified without deployment

- Safe title basenames preserve Unicode and emoji, reject/replace non-portable characters and reserved device names, and respect both 255-byte segment and 1,024-byte path limits.
- Collision allocation is casefold/NFC aware and chooses the minimum available suffix, including the `(10)` byte-budget transition.
- The allocator is type-branded as a candidate selector: all seven production call sites consume the transaction returned after the shared Space advisory lock. It does not reserve a path or retry internally; `UNIQUE(spaceId, syncPathKey)` is the final invariant.
- Web and ChangeSet creates use readable title paths unless a valid source/local path is authoritative.
- Web update/restore and ChangeSet update preserve the existing directory, including Vault root, and rename only when sanitized basenames differ.
- PageVersion captures the old path; Page and revision use the final path.
- Body content, including a matching Markdown H1, is passed through unchanged by path allocation/rename logic.
- Space lock ordering is covered before allocation and writes; restore re-reads the Page after acquiring the lock.
- The migration matches only lowercase `pages/p-<64 hex>.md`, uses stable knowledge-key order and fixed batch IDs, and performs Page/PageVersion/revision writes in one transaction.
- A completed fixed migration batch is detected by its composite-unique revision immediately after the Space lock and before Page scanning. A real second migration call returns that original revision ID with `migrated: 0`; the injectable aggregation path used by CLI `main()` does not count it again, distinguishes all three Space outcomes, and formats page path/space/revision counts with correct singular/plural nouns.
- A legacy Space without a parent revision seeds all active Pages into its first migration revision, so unchanged custom paths remain authoritative.
- Migration allocation preloads all active and soft-deleted path keys once, avoids per-page full-Space queries, and uses a 30-minute bounded transaction timeout.
- The legacy sync-v1 backfill now holds the same transaction-scoped Space advisory lock across each Space's Page/revision mutation window; its focused real-DB rollback and fallback cases passed.
- A title that itself matches `p-<64 hex>` is forced to a non-opaque `(2).md` path even when its hash differs from the legacy path hash, so the second migration run is a true no-op. The updated Fix 3A real-PostgreSQL fixture passed in the integration run.
- Restore uses row-version CAS, while reorder joins the same Space advisory-lock protocol and performs a validated batch as one parameterized PostgreSQL statement. Reviews found and closed the same-millisecond reorder race and the initial 2,000-roundtrip timeout risk; live PostgreSQL execution remains outstanding.
- Archive publish now records pre-archive PageVersion/provenance and uses row CAS. Revert restores only five whitelisted provenance/deletion fields. It requires an own `before.deletedAt` exactly equal to `null` and pre-validates every present `lastModifiedAt`; malformed state raises stable `CHANGESET_INVALID_STATE` before transaction claim/lock/write/revision/search work, so an empty update cannot be reported as success. Live PostgreSQL rollback/race proof remains outstanding.

## Known non-blocking output

- Client tests print existing jsdom limitations for CodeMirror `Range.getClientRects` and Canvas `getContext`; all affected tests passed.
- Vite reports the existing warning that some production chunks exceed 500 kB; build completed successfully.
- Server negative-path tests intentionally log expected 401/403/400/413 and mocked downstream failures; all suites passed.

## Remaining deployment and release gate

The semantic merge is complete on the clean local integration branch. It has not been pushed, deployed, or applied to a production database. Before production deployment:

1. Decide how to land the clean integration branch without overwriting the dirty primary checkout.
2. Prepare and verify a production database backup and rollback plan for the schema migration.
3. Rebuild and re-verify the paired Obsidian plugin against the final server integration commit.
4. Seek separate authorization for push, production migration, deployment, package publication, and marketplace submission.
