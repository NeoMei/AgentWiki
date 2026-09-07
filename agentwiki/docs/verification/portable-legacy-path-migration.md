# Portable legacy current-path migration verification

Task 3, 2026-09-07. Base: `ad8e91f07742ee3ea22424c1e068eb873999349a`.
All validation used synthetic data and isolated local PostgreSQL schemas.
Production migration, deployment, Android acceptance and plugin release are not proven here.

## Result and scope

The existing Folder migration now accepts canonical portable v1 current Page
paths outside `pages/`, allocates their destinations with the existing safe
title allocator, and records the original paths as aliases. Managed source
basenames retain their prior allocation behavior. Only the actual Folder and
legacy Page-parent graph determines hierarchy. Deleted current Pages remain
deleted; Page titles, bodies, IDs, attribution and timestamps are preserved.

One explicitly approved forward migration changes the alias CHECK:
`20260907120000_allow_portable_legacy_page_aliases`.
Its SQL SHA-256 is
`531a6edae8aa486a01a68ef6bf7bb16bf2703cb40789cb88aef00113ad32d02b`.
It removes the `pages/` restriction, retains nonempty paths/keys, and adds
the original path's 1024-byte bound plus absolute, empty-segment, dot-segment, control-character,
colon and backslash rejection. Full portable Markdown validation and canonical
casefold key matching remain application responsibilities. No previously
applied migration was edited; no dependency, package version or wire schema changed.
Full Unicode casefold keys may legitimately exceed 1024 bytes. Their SQL
requirement is nonempty, matching the public validator's derived-key contract.

Raw legacy-history verification is separated from its optional strict v2 view.
Both retain the complete five-revision resumed-batch integrity contract. The
dedicated migration writer verifies legacy history before committing a new
canonical revision. The existing first-v2 trust boundary verifies the original
legacy parent in v1 form, and readers stop v2 ancestry reconstruction at that
verified boundary. Original paths are never rewritten into a v2 projection.
Old history remains readable through the verified v1 reader; unsupported v2
projection of old paths still fails closed. Native-v3 history and attachment
bootstrap cannot be downgraded by the first-v2 migration.

## Red/green evidence

Planner RED: three `PAGE_PATH_INVALID` failures, then the title-allocation
expectation exposed the old-basename fallback. Database RED found the old SQL
alias CHECK, a missing corrupt-history rejection, new-v2 ancestry rejection,
old-v1 compatibility rejection, and mutation of the old head's `supersededAt`.
The subsequent-v2 reader regression exposed unnecessary legacy-grandparent
v2 reconstruction. A separate writer RED caught native-v3 bootstrap being
returned to the first-v2 migration. Each was fixed before final gates.

Final gates:

- Planner and migration PostgreSQL: 27 passed, zero skipped (21 planner and
  6 real database tests). The new fixture proves preflight, actual input drift,
  apply, canonical revision 6, strict v2 snapshot, public v3 list beside an
  ordinary Space, alias resolution, old-v1 reading, idempotent retry, report
  rollback, ordinary v2 revision 7, and native-v3 revision 8 snapshot/verification.
- The fixture compares old revision records, immutable Page rows, sidecars,
  extras, normalized content rows and raw legacy body rows exactly. It also
  rejects corrupt/unknown/native history, unsafe aliases and corrupt retained
  history after cutover. Existing Folder graph/collision/depth/count and alias
  retention regressions remain green.
- Five changed sync/writer/integrity suites: 172 passed, one existing skip.
- Full server harness, one run: 148 suites passed; 2561 passed and one existing
  skip (2562 total), 31.319 seconds. Negative-path warning/error logs remain.
- Server typecheck, lint and build: exit 0. Diff whitespace check: exit 0.

The initial database launch stopped before tests because `PG_DUMP_BIN` was
missing. The guarded retry supplied `/opt/homebrew/bin/pg_dump`. During fixture
development, missing live device credentials and cursor wiring caused two
fixture-only failures, and an incorrectly placed import caused one build
failure; all were corrected before the gates above.

## Reproduction

From the product `agentwiki/` directory in the isolated worktree:

```sh
PG_DUMP_BIN=/opt/homebrew/bin/pg_dump \
FOLDER_TEST_DATABASE_URL='postgresql://neomei@localhost/agentwiki_collaboration_test' \
node --test scripts/space-folder-migration.test.mjs \
  scripts/space-folder-migration-db.test.mjs scripts/folder-test-database.test.mjs

pnpm --filter @agentwiki/server exec jest --runInBand \
  src/core/sync/space-revision-writer.service.spec.ts \
  src/core/sync/revision-v2-integrity.spec.ts \
  src/integrations/obsidian/sync-revision.service.spec.ts \
  src/integrations/obsidian/sync-v2-revision.service.spec.ts \
  src/integrations/obsidian/sync-v3-revision.service.spec.ts

pnpm --filter @agentwiki/server typecheck
pnpm --filter @agentwiki/server lint
pnpm --filter @agentwiki/server build

COLLABORATION_TEST_DATABASE_URL='postgresql://neomei@localhost/agentwiki_collaboration_test' \
PG_DUMP_BIN=/opt/homebrew/bin/pg_dump node scripts/server-test-harness.mjs run
```

The new migration changes the reviewed full migration-corpus digest to
`56d7d4e6a8b1f3a904e9818f905e6129d406c398e658881b3ecd410ec8655333`.
The three existing safety-gate constants were updated to this exact digest.
The database helpers own fresh schemas and verify cleanup; no production
credentials, private content, remote writes or other worktrees were accessed.

## Whole-branch review fixes

The unpublished candidate SQL was corrected after review found that its key
budget rejected valid full Unicode casefold expansions. Actual PostgreSQL RED
showed an existing valid managed alias (812-byte path, 1212-byte key) prevented
the forward CHECK upgrade. GREEN proves that exact alias survives the actual
DDL unchanged and a new outside-path alias (810 / 1210 bytes) persists. Direct
SQL malformed aliases remain rejected; no key truncation or rewrite occurs.

The new canonical Page timestamp SQL now decodes the script's UTC ISO values
as `timestamp`, matching the current Page update and Prisma's timestamp columns.
RED showed `2026-08-28T01:02:03.123Z` becoming `09:02:03.123Z` in an explicitly
verified Asia/Shanghai session, while UTC passed. The same three focused
regressions now pass 3/3, zero skips. Both timezone tests compare plan, current
Page, immutable Page row and public snapshot timestamps exactly, and verify
generated Folder/current/immutable/snapshot millisecond values too. No global
database timezone or historical records were changed.

This wave changes only the candidate SQL, the migration script and regression
fixtures/corpus identities. The full server result above belongs to the prior
wave; it was not rerun for these SQL/script-only fixes.

Final focused planner, migration DB, Folder schema, ContentTree corpus/locking
and collaboration schema gates: **59 passed, zero skipped**, 23.173 seconds.
The helper reported zero generated Folder schemas and unchanged protected
public-schema inventory after cleanup. Changed JavaScript syntax checks and
Git whitespace checks passed. No server TypeScript changed in this wave.
