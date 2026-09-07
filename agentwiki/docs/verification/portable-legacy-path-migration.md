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
`081058ca51f075242eab32c20108675feb883fa0e002ca0775c28fb184d27716`.
It removes the `pages/` restriction, retains nonempty paths/keys, and adds
1024-byte bounds plus absolute, empty-segment, dot-segment, control-character,
colon and backslash rejection. Full portable Markdown validation and canonical
casefold key matching remain application responsibilities. No previously
applied migration was edited; no dependency, package version or wire schema changed.

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
`7f5189fbd80ecd3972a97624afa247b1557200f8073cdc41dd3fe5b34dffdadc`.
The three existing safety-gate constants were updated to this exact digest.
The database helpers own fresh schemas and verify cleanup; no production
credentials, private content, remote writes or other worktrees were accessed.
