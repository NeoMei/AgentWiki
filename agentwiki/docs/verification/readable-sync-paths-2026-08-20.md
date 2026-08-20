# Readable sync paths verification - 2026-08-20

## Result

The original `codex/readable-sync-paths` branch remains at `294b694`. Its Final Fix 2 evidence includes a real PostgreSQL sync/migration gate of **32/32 with no skips or failures**, including deterministic proof that Web create and the readable-path migration both stop at their first Space lock before same-title allocation. That run happened before Final Fix 3.

Final Fix 3A/3B/3C was implemented only in the temporary `codex/final-readiness-fixes` repository. Its final product candidate HEAD is `7cae89d`. The candidate has fresh non-database and non-loopback evidence, but it does **not** have an all-green full-server/real-database run in the current managed sandbox: runtime still has 41 explicit database skips, the updated 3A database fixture was skipped, and the last all-inclusive server attempt had 20 loopback-listener failures caused by `EPERM`. The temporary candidate has not been merged or copied back to the original branch.

No production database, production service, deployment, package publication, or Obsidian marketplace state was changed.

## Revision and runtime

- Original branch: `codex/readable-sync-paths`, HEAD `294b694`.
- Temporary candidate branch: `codex/final-readiness-fixes`, final product HEAD `7cae89d`.
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
- Node: `v24.18.0`
- pnpm: `11.9.0`

## Final candidate verification matrix

These are the freshest per-gate results recorded after the relevant Fix 3 follow-up. They are intentionally not summed into an all-green repository total because the database and loopback exclusions are material.

| Package/gate | Files or suites | Passed | Skipped/blocked | Failed assertions |
|---|---:|---:|---:|---:|
| production migration different-hash regression | 1 test | 1 | 0 | 0 |
| readable allocator Jest | 18 tests | 18 | 0 | 0 |
| runtime scripts | 113 tests | 72 | 41 DB skips | 0 |
| server Jest, exact four loopback files excluded | 53 suites / 533 tests | 533 | 20 loopback tests not executed in this gate | 0 |
| client Vitest | 34 files / 157 tests | 157 | 0 | 0 |
| sync protocol Vitest | 5 files / 22 tests | 22 | 0 | 0 |
| local-sync Vitest | 42 files / 358 tests | 358 | 0 | 0 |

The 41 runtime skips require `DATABASE_URL` and are not passes. The updated readable migration DB file separately reported 0 passed / 2 explicit skips / 0 failed in the current sandbox. The most recent all-inclusive server attempt was during Fix 3B: 57 suites / 577 tests, with 53 suites / 557 tests passing and four HTTP suites / 20 tests failing only because `listen 127.0.0.1` returned `EPERM`. Fix 3C subsequently added tests and reran the exact non-loopback gate at 53 suites / 533 tests; it did not rerun or claim the 20 listener-bound tests.

### Other gates

- Final Fix 3C server typecheck, full configured lint and server build: PASS.
- Client, sync protocol and local-sync typecheck/build: PASS; sync protocol ESM/CJS builds: PASS.
- Full configured server/client/local-sync lint: PASS.
- Shared, sync protocol, server, client and local-sync package builds completed through the existing local compilers. The root `pnpm build` wrapper itself stopped before compilation with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, so that wrapper invocation is not represented as green.
- `git diff --check` and staged diff check: PASS in the Fix 3 reports.
- Focused Fix 3B PageService: 30/30; adjacent Page/Search/SpaceRevisionWriter: 35/35.
- Focused Fix 3C ReviewService: 48/48; adjacent Review/Page/SpaceRevisionWriter/Search: 83/83.

## Real-DB evidence boundary

Command:

```bash
node --test scripts/readable-sync-path-migration-db.test.mjs scripts/sync-v1-*.test.mjs
```

The earlier evidence used `DATABASE_URL` pointing only to `agentwiki_codex_readable_sync_20260820_01` and passed 31/31. Final Fix 2 at the original-branch candidate then reran the expanded command against a credential-free local PostgreSQL 16 connection with a fresh schema per test: exit 0 with **32 passed, 0 skipped, 0 failed** in 27.56 seconds. The run exercised real Prisma migrations and PostgreSQL transactions, Redis-backed HTTP flow, session/global-page-id concurrency, the 5,000-page/100 MiB bound, readable-path identity/body-hash preservation, idempotency, forced rollback, and the readable allocator concurrency gate.

That 32/32 run predates `415560a`. Fix 3A changed the real-DB fixture from equal legacy/title hashes to different hashes, exposing the case where a legitimate title itself produces another strict opaque-looking path. In the current sandbox the updated DB file was explicitly skipped because there was no usable PostgreSQL connection. The same scenario passed **1/1** through the real production migration and allocator with only the transaction/revision-writer boundary replaced in memory: the first run chose `pages/p-f...f (2).md`, preserved title/body/H1, and the second run returned `{ migrated: 0, revisionId: null }`. This is direct non-DB production-logic evidence, not a substitute for rerunning the changed fixture on PostgreSQL.

Fix 3B and 3C likewise used deterministic transaction-boundary harnesses and raw-query argument inspection; no live PostgreSQL advisory-lock, rollback, bulk-SQL, archive-race, or restore-race proof was obtained for those changes in this sandbox.

The new gate first acquired the Space advisory lock in an external PostgreSQL transaction. It then started the actual `PageService.create()` entry and actual readable-path migration through separate, uniquely named Prisma connections. Bounded condition polling of `pg_stat_activity` observed both connection names simultaneously at `wait_event_type = 'Lock'` and `wait_event = 'advisory'` before the blocker was released. During that blocked state, a temporary wrapper around the actual production `ReadableSyncPathService.prototype.allocate` recorded zero calls. The wrapper delegates unchanged to the original method and is restored in `finally`. After blocker release, the unordered call record contained exactly one `page` and one `migration` invocation, both outer transactions committed, the exact paths were `pages/标题.md` and `pages/标题 (2).md`, and no Prisma `P2002` escaped. Therefore the observed waiters cannot be later re-entrant `revisionWriter.advance()` locks: both entries were proven blocked before their allocator call. This is distinct from the older `sync-v1-concurrency-db` coverage, which tests global page IDs and push-session idempotency rather than readable candidate allocation.

The contention test has a 25-second test timeout; its test clients use 20-second interactive transaction timeouts with 10-second acquisition bounds, while condition polling has a 5-second deadline. Failure cleanup restores the allocator prototype, releases the blocker, terminates only the three random test `application_name` backends, and bounds outcome settlement and disconnects to five seconds before dropping the schema. Every Final Fix 2 test used a generated disposable schema in the local `postgres` database and dropped it in `finally`; final schema-prefix and `fix2_%` activity lookups both returned zero rows. No production or pre-existing application schema was used. The earlier disposable database was likewise removed as recorded by the prior evidence.

## Behavior verified without deployment

- Safe title basenames preserve Unicode and emoji, reject/replace non-portable characters and reserved device names, and respect both 255-byte segment and 1,024-byte path limits.
- Collision allocation is casefold/NFC aware and chooses the minimum available suffix, including the `(10)` byte-budget transition.
- The allocator is type-branded as a candidate selector: all six production callers must consume the transaction returned after the shared Space advisory lock. It does not reserve a path or retry internally; `UNIQUE(spaceId, syncPathKey)` is the final invariant.
- Web and ChangeSet creates use readable title paths unless a valid source/local path is authoritative.
- Web update/restore and ChangeSet update preserve the existing directory, including Vault root, and rename only when sanitized basenames differ.
- PageVersion captures the old path; Page and revision use the final path.
- Body content, including a matching Markdown H1, is passed through unchanged by path allocation/rename logic.
- Space lock ordering is covered before allocation and writes; restore re-reads the Page after acquiring the lock.
- The migration matches only lowercase `pages/p-<64 hex>.md`, uses stable knowledge-key order and fixed batch IDs, and performs Page/PageVersion/revision writes in one transaction.
- A legacy Space without a parent revision seeds all active Pages into its first migration revision, so unchanged custom paths remain authoritative.
- Migration allocation preloads all active and soft-deleted path keys once, avoids per-page full-Space queries, and uses a 30-minute bounded transaction timeout.
- The legacy sync-v1 backfill now holds the same transaction-scoped Space advisory lock across each Space's Page/revision mutation window; its focused real-DB rollback and fallback cases passed.
- A title that itself matches `p-<64 hex>` is forced to a non-opaque `(2).md` path even when its hash differs from the legacy path hash, so the second migration run is a true no-op. This Fix 3A claim has 1/1 production-logic regression coverage; its updated real-DB fixture remains unexecuted here.
- Restore uses row-version CAS, while reorder joins the same Space advisory-lock protocol and performs a validated batch as one parameterized PostgreSQL statement. Reviews found and closed the same-millisecond reorder race and the initial 2,000-roundtrip timeout risk; live PostgreSQL execution remains outstanding.
- Archive publish now records pre-archive PageVersion/provenance and uses row CAS. Revert restores only five whitelisted provenance/deletion fields and validates nullable/non-null date inputs. Review follow-ups closed the crafted-payload field-spread and invalid-date cases; live PostgreSQL rollback/race proof remains outstanding.

## Known non-blocking output

- Client tests print existing jsdom limitations for CodeMirror `Range.getClientRects` and Canvas `getContext`; all affected tests passed.
- Vite reports the existing warning that some production chunks exceed 500 kB; build completed successfully.
- Server negative-path tests intentionally log expected 401/403/400/413 and mocked downstream failures; all suites passed.

## Remaining release gate

The original branch is still `294b694`, and the temporary `7cae89d` product candidate has not been backported. Before merging or deploying:

1. Rerun the updated Fix 3A different-hash fixture plus the Fix 3B/3C database-sensitive cases on a disposable real PostgreSQL environment.
2. Rerun the four HTTP suites in an environment that permits loopback listeners; do not count the 20 `EPERM` cases as passes.
3. Integrate only after resolving the dirty primary AgentWiki checkout without overwriting unrelated user changes.
4. Prepare and verify a production database backup and rollback plan.
5. Seek separate authorization for merge, production migration and deployment.
