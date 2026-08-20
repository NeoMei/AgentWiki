# Readable sync paths verification - 2026-08-20

## Result

The non-deployment repository gates are green on `codex/readable-sync-paths`. Unit/runtime coverage passes for the allocator and Web/ChangeSet integrations. Final Fix 2 extended the real PostgreSQL sync/migration gate to **32/32 with no skips or failures**, including deterministic contention proof for same-Space/same-title readable allocation between Web create and the readable-path migration. Every disposable schema from the new run was removed after verification.

No production database, production service, deployment, package publication, or Obsidian marketplace state was changed.

## Revision and runtime

- Branch: `codex/readable-sync-paths`
- Final Fix 2 verification base: `2c4be9e`; the exact implementation commit is recorded in Git history and the completion report.
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
- Node: `v24.18.0`
- pnpm: `11.9.0`

## Complete repository matrix

### `pnpm test`

Exit code: 0.

| Package/gate | Files or suites | Passed | Skipped | Failed |
|---|---:|---:|---:|---:|
| runtime scripts | 2 suites / 112 tests | 71 | 41 | 0 |
| server Jest | 57 suites | 576 | 0 | 0 |
| client Vitest | 34 files | 157 | 0 | 0 |
| sync protocol Vitest | 5 files | 22 | 0 | 0 |
| local-sync Vitest | 42 files | 358 | 0 | 0 |
| **Total tests** | | **1,184** | **41** | **0** |

The 41 runtime skips are external-database gates with no configured `DATABASE_URL`; they are not counted as passes. The same database-dependent sync/readable-path subset was then run separately with the disposable-schema connection described below.

### Other gates

- `pnpm typecheck`: PASS, exit 0.
- `pnpm lint`: PASS, exit 0.
- `pnpm build`: PASS, exit 0.
- `git diff --check`: PASS, exit 0.
- Focused readable-path regression after final review fixes: `review.service.spec.ts`, `page.service.spec.ts`, and `readable-sync-path.service.spec.ts`: 3 suites / 80 tests passed. `app.module.spec.ts` is also included in the full 576-test server pass.
- Migration runtime dependency build: sync protocol build followed by server build: PASS.
- Migration module import/no-op fake transaction check: exported function loaded and returned `{ migrated: 0, revisionId: null }`.

## Real-DB gates

Command:

```bash
node --test scripts/readable-sync-path-migration-db.test.mjs scripts/sync-v1-*.test.mjs
```

The earlier evidence used `DATABASE_URL` pointing only to `agentwiki_codex_readable_sync_20260820_01` and passed 31/31. Final Fix 2 reran the expanded command against a credential-free local PostgreSQL 16 connection with a fresh schema per test: exit 0 with **32 passed, 0 skipped, 0 failed** in 21.03 seconds. The run exercised real Prisma migrations and PostgreSQL transactions, Redis-backed HTTP flow, session/global-page-id concurrency, the 5,000-page/100 MiB bound, readable-path identity/body-hash preservation, idempotency, forced rollback, and the new readable allocator concurrency gate.

The new gate first acquired the Space advisory lock in an external PostgreSQL transaction. It then started the actual `PageService.create()` entry and actual readable-path migration through separate, uniquely named Prisma connections. Bounded condition polling of `pg_stat_activity` observed both connection names simultaneously at `wait_event_type = 'Lock'` and `wait_event = 'advisory'` before the blocker was released. Both outer transactions then committed; the exact paths were `pages/标题.md` and `pages/标题 (2).md`; no Prisma `P2002` escaped. This is distinct from the older `sync-v1-concurrency-db` coverage, which tests global page IDs and push-session idempotency rather than readable candidate allocation.

Every Final Fix 2 test used a generated disposable schema in the local `postgres` database and dropped it in `finally`; the final schema-prefix lookup returned zero rows. No production or pre-existing application schema was used. The earlier disposable database was likewise removed as recorded by the prior evidence.

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
- A title that itself matches `p-<64 hex>` is forced to a non-opaque `(2).md` path, so the second migration run is a true no-op.

## Known non-blocking output

- Client tests print existing jsdom limitations for CodeMirror `Range.getClientRects` and Canvas `getContext`; all affected tests passed.
- Vite reports the existing warning that some production chunks exceed 500 kB; build completed successfully.
- Server negative-path tests intentionally log expected 401/403/400/413 and mocked downstream failures; all suites passed.

## Remaining release gate

The isolated database gate is complete. Before merging or deploying the migration:

1. Integrate only after resolving the dirty primary AgentWiki checkout without overwriting unrelated user changes.
2. Prepare and verify a production database backup and rollback plan.
3. Seek separate authorization for merge, production migration and deployment.
