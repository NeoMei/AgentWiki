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

The original Task 11 environment had no dedicated URL, so its database case correctly skipped.
The controller subsequently closed that limitation with a new disposable PostgreSQL instance:

- Homebrew `initdb` created a fresh cluster under `/tmp/agentwiki-page-template-pg.*`.
- PostgreSQL listened on a randomly selected free port.
- The controller created only the `agentwiki_page_template_test` database and exported only
  `PAGE_TEMPLATE_TEST_DATABASE_URL` for the gate; it did not connect to any existing database.
- `pnpm test:e2e:page-template-db` reported `2 pass, 0 fail, 0 skipped`.
- The migration/integrity case completed in `900.983ms`; total suite duration was `942ms`.
- The temporary cluster was stopped after the gate and moved to the system Trash.

Executed gate:

```text
cd agentwiki
test -n "$PAGE_TEMPLATE_TEST_DATABASE_URL"
pnpm test:e2e:page-template-db
# 2 passed, 0 failed, 0 skipped
```

The previously pending real migration, constraint, concurrency/no-orphan, and cleanup-path evidence
for commit `c34bb8e` is therefore closed. The review remediation below expands the integration case;
those newly added assertions require the controller's next disposable-cluster rerun.

### Random-schema and `finally` cleanup evidence

- The passing database case asserted that the generated name matched
  `^page_template_test_[a-z0-9_]+$` and was not `public` before opening its scoped Prisma client.
- `withPageTemplateTestDatabase()` creates that random schema, awaits the test callback, then awaits
  `DROP SCHEMA <exact-safe-identifier> CASCADE` inside `finally` before disconnecting.
- The Node test itself awaits the whole wrapper. Therefore its reported pass proves the callback,
  awaited `finally` drop, and disconnect all returned without throwing; a drop failure would have
  failed the case rather than producing `2 pass`.
- The supplied evidence did not include a separate post-drop `pg_namespace` inventory query. This
  report does not claim one. Residual state was additionally eliminated when the entire disposable
  cluster was stopped and moved to Trash.

## Review remediation: duplicate URL parameters and database behavior

Review date: 2026-08-26

- URL validation now uses `searchParams.getAll('schema')` and rejects every repeated `schema`
  parameter, including two safe values, safe plus `public`, `public` plus safe, and an empty value
  plus a safe value. A single empty value is also rejected. No schema and exactly one safe
  `page_template_test_*` value remain accepted.
- The database case now proves `PageTemplate.currentVersion = 0` and
  `PageTemplateVersion.version = 0` are rejected by their CHECK constraints.
- The immutable-version trigger is exercised against `id`, `contentHash`, `contentI18n`, `version`,
  `templateId`, and `createdAt` mutations.
- Both provenance exceptions are exercised: non-null `sourcePageId` and `createdById` may each be
  cleared to null, while restoring either value is rejected. The created page continues to
  reference version 1, so the subsequent compound-FK deletion assertion remains intact.

### Remediation TDD evidence

RED command:

```text
cd agentwiki
env -u PAGE_TEMPLATE_TEST_DATABASE_URL node --test scripts/page-template-schema-db.test.mjs
```

Observed: URL safety failed with `Missing expected exception` on the first repeated safe-schema
case; the database case remained explicitly skipped. This isolated the `get('schema')` ambiguity.

GREEN and static verification:

```text
cd agentwiki
env -u PAGE_TEMPLATE_TEST_DATABASE_URL pnpm test:e2e:page-template-db
# 1 passed, 0 failed, 1 explicitly skipped

node --test scripts/page-template-schema.test.mjs
# 8 passed, 0 failed

pnpm --filter @agentwiki/server typecheck
# exit 0: tsc --noEmit --incremental false

node --check scripts/page-template-test-database.mjs
node --check scripts/page-template-schema-db.test.mjs
# both exit 0
```

No PostgreSQL URL was used for this remediation pass. The new CHECK/trigger/provenance assertions
are intentionally pending the controller's fresh temporary-cluster gate; the earlier `2 pass`
result predates these added assertions and is not presented as evidence for them.

## Files

- Created `agentwiki/scripts/page-template-test-database.mjs`
- Created `agentwiki/scripts/page-template-schema-db.test.mjs`
- Modified `agentwiki/package.json`
- Created `.superpowers/sdd/page-template-library/task-11-report.md`

## Scope and safety review

- Work stayed in the requested worktree and on `codex/page-template-library`.
- No existing migration or product service code was changed.
- The original subtask attempted no PostgreSQL connection because the only authorized URL was
  absent; the subsequent gate used only the newly initialized disposable cluster described above.
- No push, publish, deployment, worktree creation, or branch creation was performed.
