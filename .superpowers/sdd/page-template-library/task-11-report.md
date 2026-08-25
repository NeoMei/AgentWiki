# Task 11 Report: Isolated PostgreSQL page-template integrity harness

Date: 2026-08-26
Branch: `codex/page-template-library`
Starting HEAD: `50d2ca2d1fca3dd2ee205f3e57b66fc1241bb823`
Worktree: `/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/page-template-library`

## Requirement mapping

- Added `PAGE_TEMPLATE_TEST_DATABASE_URL` validation that fails closed unless the URL uses
  PostgreSQL, its database name contains `test`, and any supplied schema has the
  `page_template_test_` safety prefix.
- Added an isolated harness that always replaces any supplied safe schema with a fresh random
  `page_template_test_<uuid>` schema, applies every Prisma migration with only that schema in
  `DATABASE_URL`, and drops the exact quoted schema in `finally`.
- Added a real-database test for the page-template scope, current-version, version-number,
  provenance tuple, and compound provenance foreign-key constraints.
- Added real mutation checks for partial provenance, unsupported provenance locale, missing
  template version, referenced version deletion, and invalid system scope tuples.
- Added the Task 3/Task 4 deferred database concurrency check: two Serializable transactions
  compete to create version 2 and advance the same version-1 pointer. The test requires exactly
  one commit and one database rejection, then asserts the persisted state contains only versions
  1 and 2 with `currentVersion = 2`, proving the losing transaction leaves no orphan version.
- Added `pnpm test:e2e:page-template-db` to the repository root package scripts.
- Did not read or use `DATABASE_URL` or `COLLABORATION_TEST_DATABASE_URL`, and did not migrate or
  clean `public`.

## TDD evidence

### RED

Command:

```text
cd agentwiki
node --test scripts/page-template-schema-db.test.mjs
```

Observed: exit 1 before database access with `ERR_MODULE_NOT_FOUND` for
`scripts/page-template-test-database.mjs`. This was the expected missing-helper failure.

### GREEN without a dedicated database URL

Command:

```text
cd agentwiki
pnpm test:e2e:page-template-db
```

Observed: exit 0; URL safety passed, database integration was explicitly skipped with
`PAGE_TEMPLATE_TEST_DATABASE_URL is not configured` (`1 pass, 0 fail, 1 skipped`).

## Verification evidence

The environment check reported:

```text
PAGE_TEMPLATE_TEST_DATABASE_URL=UNSET
DATABASE_URL=UNSET
COLLABORATION_TEST_DATABASE_URL=UNSET
```

Fresh commands run before the report was written:

```text
cd agentwiki
node --test scripts/page-template-schema-db.test.mjs
# exit 0: 1 passed, 1 explicitly skipped

pnpm test:e2e:page-template-db
# exit 0: 1 passed, 1 explicitly skipped

node --test scripts/page-template-schema.test.mjs
# exit 0: 8 passed

pnpm --filter @agentwiki/server typecheck
# exit 0: tsc --noEmit --incremental false

cd ..
git diff --check
# exit 0, no output
```

## Dedicated PostgreSQL gate status

No `PAGE_TEMPLATE_TEST_DATABASE_URL` was configured in this task environment. Per the fail-closed
brief, no fallback URL was discovered or derived, and neither the real migration/constraint test
nor the concurrency/no-orphan assertion was executed. Consequently, actual random-schema creation,
migration compatibility, constraint behavior, concurrency behavior, and post-test schema cleanup
remain pending a run where the caller explicitly exports a dedicated test database URL.

Required follow-up command:

```text
cd agentwiki
test -n "$PAGE_TEMPLATE_TEST_DATABASE_URL"
pnpm test:e2e:page-template-db
```

Expected dedicated-environment result: `2 pass, 0 fail, 0 skipped`, followed by a read-only schema
inventory check confirming no generated `page_template_test_*` schema remains.

## Files

- Created `agentwiki/scripts/page-template-test-database.mjs`
- Created `agentwiki/scripts/page-template-schema-db.test.mjs`
- Modified `agentwiki/package.json`
- Created `.superpowers/sdd/page-template-library/task-11-report.md`

## Scope and safety review

- Work stayed in the requested worktree and on `codex/page-template-library`.
- No existing migration or product service code was changed.
- No PostgreSQL connection was attempted because the only authorized URL was absent.
- No push, publish, deployment, worktree creation, or branch creation was performed.
