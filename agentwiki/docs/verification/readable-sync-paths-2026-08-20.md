# Readable sync paths verification - 2026-08-20

## Result

The non-deployment repository gates are green on `codex/readable-sync-paths`. Unit/runtime coverage passes for the allocator and Web/ChangeSet integrations. The real PostgreSQL migration gate is present but **not executed** because this environment has no `DATABASE_URL`; it reported explicit skips and must still run against a disposable isolated database before release/deployment.

No production database, production service, deployment, package publication, or Obsidian marketplace state was changed.

## Revision and runtime

- Branch: `codex/readable-sync-paths`
- Final verified code HEAD: `57314a9` (the verification-document-only follow-up commit is excluded from behavior)
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
| runtime scripts | 2 suites / 106 tests | 66 | 40 | 0 |
| server Jest | 57 suites | 570 | 0 | 0 |
| client Vitest | 34 files | 157 | 0 | 0 |
| sync protocol Vitest | 5 files | 22 | 0 | 0 |
| local-sync Vitest | 42 files | 358 | 0 | 0 |
| **Total tests** | | **1,173** | **40** | **0** |

The 40 runtime skips are external-database gates with no configured `DATABASE_URL`; they are not counted as passes.

### Other gates

- `pnpm typecheck`: PASS, exit 0.
- `pnpm lint`: PASS, exit 0.
- `pnpm build`: PASS, exit 0.
- `git diff --check`: PASS, exit 0.
- Focused readable-path regression after final review fixes: `review.service.spec.ts`, `page.service.spec.ts`, and `readable-sync-path.service.spec.ts`: 3 suites / 74 tests passed. `app.module.spec.ts` is also included in the full 570-test server pass.
- Migration runtime dependency build: sync protocol build followed by server build: PASS.
- Migration module import/no-op fake transaction check: exported function loaded and returned `{ migrated: 0, revisionId: null }`.

## Real-DB gates

Command:

```bash
node --test scripts/readable-sync-path-migration-db.test.mjs scripts/sync-v1-*.test.mjs
```

Result: exit 0 with **31 tests skipped, 0 passed, 0 failed**. Every skip explicitly reported `DATABASE_URL is not configured`.

The readable migration test is designed to deploy migrations into a random PostgreSQL schema, seed duplicate-title opaque pages and an unchanged custom path, verify Page/PageVersion/revision identity and body hashes, rerun idempotently, force a second-update failure, and assert total rollback. None of those real transaction assertions executed in this environment. Consequently, there is no isolated-database migration output to report and the release gate remains open.

## Behavior verified without deployment

- Safe title basenames preserve Unicode and emoji, reject/replace non-portable characters and reserved device names, and respect both 255-byte segment and 1,024-byte path limits.
- Collision allocation is casefold/NFC aware and chooses the minimum available suffix, including the `(10)` byte-budget transition.
- Web and ChangeSet creates use readable title paths unless a valid source/local path is authoritative.
- Web update/restore and ChangeSet update preserve the existing directory, including Vault root, and rename only when sanitized basenames differ.
- PageVersion captures the old path; Page and revision use the final path.
- Body content, including a matching Markdown H1, is passed through unchanged by path allocation/rename logic.
- Space lock ordering is covered before allocation and writes; restore re-reads the Page after acquiring the lock.
- The migration matches only lowercase `pages/p-<64 hex>.md`, uses stable knowledge-key order and fixed batch IDs, and performs Page/PageVersion/revision writes in one transaction.
- A legacy Space without a parent revision seeds all active Pages into its first migration revision, so unchanged custom paths remain authoritative.
- Migration allocation preloads all active and soft-deleted path keys once, avoids per-page full-Space queries, and uses a 30-minute bounded transaction timeout.
- A title that itself matches `p-<64 hex>` is forced to a non-opaque `(2).md` path, so the second migration run is a true no-op.

## Known non-blocking output

- Client tests print existing jsdom limitations for CodeMirror `Range.getClientRects` and Canvas `getContext`; all affected tests passed.
- Vite reports the existing warning that some production chunks exceed 500 kB; build completed successfully.
- Server negative-path tests intentionally log expected 401/403/400/413 and mocked downstream failures; all suites passed.

## Remaining release gate

Before merging or deploying the migration:

1. Provide a disposable PostgreSQL `DATABASE_URL` with `psql` available.
2. Re-run the 31 real-DB sync gates and require 31/31 pass (no skips).
3. Capture the isolated schema migration output and confirm the schema is removed.
4. Only then prepare a database backup/rollback plan and seek separate deployment authorization.
