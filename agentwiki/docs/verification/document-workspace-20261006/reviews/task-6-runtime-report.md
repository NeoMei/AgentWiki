# Task 6 runtime validation receipt

2026-10-06, local runtime support only. Worktree: `/Users/neomei/.codex/worktrees/document-workspace/AgentWiki ` (literal trailing space); commands ran from its `agentwiki` subdirectory. Recorded HEAD during the run: `b89a3f84dc5de5aa1537b44be89cd0ed8ab6d0a4`. No product files, migrations, dependencies, product branch/index, or production resources were changed. The controller's completed server suite was not repeated.

## Final result after disposable-database follow-up

The remaining 52 database gates were subsequently exercised in four newly created, individually owned disposable databases. **All passed.** Source review found no cluster/role mutation in the migration corpus: the two operations that prevented safe reuse of the shared test database were `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public` and `ALTER DATABASE current_database() SET hnsw.ef_search = 200`. These operate within the newly owned database. The readable-path contention test terminates only its own UUID-tagged backend application names.

| Additional invocation | Actual result |
| --- | --- |
| Generic/legacy/Sync v1 database files, unchanged source | 43 passed, 0 failed, 0 skipped; 46.184 seconds |
| Sync v3 schema/push/retention files, unchanged source | 9 passed, 0 failed, 0 skipped; 45.747 seconds; includes 2 already-passing control cases |
| Sync v2 version consistency, unchanged source | 6 passed, 0 failed, 0 skipped; 0.435 seconds; the formerly skipped parent expands into 5 subtests |
| Sync v3 HTTP, one Redis-address adaptation described below | 2 passed, 0 failed, 0 skipped; 9.717 seconds; includes 1 already-passing registration control |

Reconciled by case identity, the database inventory now has **216 passed, 0 unresolved failures, 0 unexecuted database gates**. With the retained parallel receipt, the runtime total is **479 passed, 0 unresolved failures, 1 opt-in CodeGraph skip**. The additional invocation counts include three repeated controls, which are excluded from the aggregate. The five newly exposed Sync version subtests explain the increase from the earlier 211-case database inventory to 216.

This does **not** claim that unmodified `AGENTWIKI_FULL_TEST=1 node scripts/runtime-test-harness.mjs run` passed in one invocation. It combines documented invocations, the earlier private-TMPDIR recovery, and one clearly scoped HTTP test environment adaptation. The sole remaining skip is `gated real CodeGraph standard scan keeps private scanner and source data local`, whose original gate requires `AGENTWIKI_CODEGRAPH_E2E=1` and a separately installed scanner. No scanner was installed or repository index created.

### Disposable-database setup and cleanup

The follow-up wrapper is retained at `/tmp/document-workspace-runtime-remaining.mjs`; exact group argument arrays and receipts are in `/tmp/document-workspace-runtime-remaining-receipt.json`. It was run with:

```sh
cd '/Users/neomei/.codex/worktrees/document-workspace/AgentWiki /agentwiki'
PG_DUMP_BIN=/opt/homebrew/bin/pg_dump node /tmp/document-workspace-runtime-remaining.mjs
```

For each group the wrapper creates a UUID-named database, installs `public.vector`, sets only that new database's `hnsw.ef_search=200`, reconnects, and captures its baseline inventory/settings. Sync version testing also applies the unchanged reviewed migration corpus to that owned database before taking the test baseline. The migration corpus digest check stays enabled. Group targets were:

- Generic: `agentwiki_runtime_test_58e7b96da304476f9ad90a85db0abc57`.
- Sync v3: `agentwiki_runtime_test_1b504c862cf84a05962de713cd90807e`.
- Sync version: `agentwiki_sync_version_test_c823eb843f0843fbb0621e1085ad9c7e`.
- HTTP: `agentwiki_runtime_test_a97f812e23c74d059823ff33ba859213`.

Every group's protected public inventory and database settings matched its baseline. The first, second, and fourth groups' full namespace lists changed during raw migration/test execution; no claim is made that those in-database namespace lists were identical. Their **entire owned databases were removed in `finally`**, and the cluster database catalog was independently checked afterward: zero of the four owned databases remained. The shared `agentwiki_folder_test` inventory/schema list remained unchanged for every group. Existing cluster database metadata, database/role settings, role-attribute digest, and server-setting digest were identical before and after each group and the overall run.

The follow-up used a private `TMPDIR`, Redis PID `57475` on random loopback port `64570`, AOF enabled, and no provider credentials. That Redis was stopped and its owned scratch tree (including the temporary loader) removed; independent probes confirmed its PID and directory were absent. No shared Redis command or flush was issued. Browser harness `34134` remained running throughout; its database, Redis and fixture were not used as test targets. Final proxied health readback returned HTTP 200 / `status: ok`.

### One-line Sync v3 HTTP environment adaptation

`scripts/sync-v3-http-db.test.mjs:89` overwrites `REDIS_URL` with a hardcoded `redis://127.0.0.1:6379`; setting outer `TEST_REDIS_URL` cannot isolate this case. Controller authorization permitted an ephemeral Node `registerHooks` loader to replace exactly one literal at module load time:

```diff
- REDIS_URL: 'redis://127.0.0.1:6379',
+ REDIS_URL: process.env.AW_OWNED_REDIS_URL,
```

`AW_OWNED_REDIS_URL` pointed at the owned Redis above. The loader rejects source drift or a replacement count other than one, checks loopback/non-6379 routing, and changes no assertion or product module. The tracked test file was not written. Runtime adapter receipt and a post-run source hash check confirmed:

| Check | SHA-256 |
| --- | --- |
| Original tracked HTTP test | `dbf1217d660576ac0055880f9bb95201451225371f075da36227663179a8350e` |
| Adapted loaded test | `9b38572d130b68767a8d917504f6da907105a6b11fd590ed253577302ae29140` |
| Entire unchanged remainder, after removing that one literal | `d80985ad27e1ff895d23bf1b5d21affb9e2340bb5e0e4fceeb3ab6002b8b5bf2` |

The HTTP lifecycle therefore has an **adapted environment acceptance receipt**, while the other 51 formerly unavailable parent gates ran from original test sources. Evidence is retained in `/tmp/document-workspace-runtime-remaining.log` and `/tmp/document-workspace-runtime-remaining-receipt.json` (mode `0600`). No authentication secret is included in this report.

## Initial isolated-schema result (superseded by follow-up above)

All exercised runtime cases pass after isolating two tests' temporary-directory accounting. The full zero-skip runtime gate is **not closed**: 52 database cases require legacy migration or separate whole-database environments that were deliberately not enabled against the shared local test database.

| Evidence | Result |
| --- | --- |
| Controller's initial parallel phase, verified from `/tmp/document-workspace-runtime.log` | 264 tests: 263 passed, 0 failed, 1 skipped |
| Database runtime inventory with protected-helper environments | 210 tests: 152 passed, 2 failed, 56 skipped; 134.396 seconds |
| Consumer/operation cleanup retry in a private `TMPDIR`, plus real-client harness serve/start/stop | 63 passed, 0 failed, 0 skipped; 29.614 seconds |
| Separate pgvector suite through its reviewed migration helper | 4 passed, 0 failed, 0 skipped; 2.670 seconds |
| Database cases reconciled by identity after retry | **159 passed, 0 unresolved failures, 52 not enabled** |
| Parallel + database cases reconciled by identity | **422 passed, 0 unresolved failures, 53 skipped/not enabled** |

The retry count overlaps already-passing cases and must not be added directly to the first run. The first run's name filter omitted the real-client serve case entirely; it was subsequently executed successfully. The four pgvector cases initially skipped for absent generic `DATABASE_URL` were subsequently executed successfully in their own protected-helper invocation.

Initial controller failures were missing `PAGE_TEMPLATE_TEST_DATABASE_URL` / `COMPOSITE_TEMPLATE_E2E_DATABASE_URL` guards, not established business failures. The safe rerun enabled real PostgreSQL checks for collaboration publication/conflict, templates, folder/content-tree operations, Markdown attachment/resource handling, revision retention, and folder migration. The startup-only composite harness exercised API/worker/Vite startup and cleanup without its external model stages. The real-client serve test prepares disposable fixture runs and verifies private state cleanup; it does not execute Codex/Claude/model clients.

## Two failures diagnosed and resolved without product edits

`scripts/content-tree-consumers-db.test.mjs:1997` and `scripts/content-tree-operations-db.test.mjs:1129` both count **all** `agentwiki-folder-migrations-*` directories in `os.tmpdir()` and assert zero. Their business subtests passed. The active browser harness legitimately holds one such reviewed migration directory until its callback ends, so the global cleanup assertions saw `1 !== 0`.

Both suites passed unchanged when their child processes used a fresh private `TMPDIR`. No directory belonging to the browser harness was removed. The consumer suite, content-tree lifecycle suite, and real-client harness file together returned 63/63 passed.

## Isolation and environment

- Existing loopback PostgreSQL 16.14 test target: `postgresql://neomei@127.0.0.1:5432/agentwiki_folder_test`; local passwordless role access was already verified. No production URL or credentials were loaded.
- `PG_DUMP_BIN=/opt/homebrew/bin/pg_dump` (16.14), `AGENTWIKI_PSQL_BIN=/opt/homebrew/bin/psql`.
- Enabled only `FOLDER_TEST_DATABASE_URL`, `MARKDOWN_TEST_DATABASE_URL`, `COLLABORATION_TEST_DATABASE_URL`, `PAGE_TEMPLATE_TEST_DATABASE_URL`, and `COMPOSITE_TEMPLATE_E2E_DATABASE_URL` against that target. Their reviewed helpers create/drop random schemas and compare protected public inventory.
- Reviewed migration corpus remained enabled: 60 files, digest `4fa1e4a38a70ea63e2e7c62d24913edfb3f9fa499bb98d43463bc639acd11767`.
- Generic `DATABASE_URL`, `SYNC_V3_TEST_DATABASE_URL`, `SYNC_VERSION_TEST_DATABASE_URL`, and `AGENTWIKI_FULL_TEST` were absent in the inventory run. Generic `DATABASE_URL` was set only for the independently inspected `pgvector-semantic-search-db.test.mjs`, which uses `withPgvectorTestDatabase` and the reviewed temporary migration bundle.
- Each orchestration used its own loopback Redis process, random port and fresh data directory, with `--save '' --appendonly yes --appendfsync everysec`. `TEST_REDIS_URL`, `PAGE_TEMPLATE_TEST_REDIS_URL`, `COLLABORATION_TEST_REDIS_URL`, and `COMPOSITE_TEMPLATE_E2E_REDIS_URL` pointed only to that owned process. No shared or live-browser Redis was flushed or altered.
- Child environment was limited to needed local process settings and the explicit test values. `COMPOSITE_TEMPLATE_E2E_EXTERNAL_STAGES=none`, `OPENROUTER_API_KEY=''`, and `ASSIST_OPENCODE_ALLOW_PAID_FALLBACK=false`. No external model/provider phase was run.
- `ATTACHMENT_STORAGE_PATH` used a fresh `agentwiki-attachment-test-*` direct child of the corresponding process `os.tmpdir()`. The retry's private `TMPDIR` was a fresh owned directory, with its attachment fixture beneath it.
- The page-template safety tests intentionally create their own random `aw_page_global_test_*` databases, test database-level inventory protections there, and remove those databases. They do not modify database settings in `agentwiki_folder_test`.

## Commands and reproduction

The controller's unchanged parallel phase is retained as evidence rather than rerun. The first database command was generated from the repository's authoritative runtime inventory:

```js
// Run from the worktree's agentwiki directory after starting an owned Redis.
// env contains only the explicit isolated test values described above.
const plan = JSON.parse(spawnSync(process.execPath,
  ['scripts/runtime-test-harness.mjs', 'plan'],
  { cwd: root, env, encoding: 'utf8' }).stdout);
const args = [
  ...plan.databaseArgs.slice(0, 3),
  '--test-skip-pattern=^serve mode prepares all five real-client runs',
  ...plan.databaseArgs.slice(3),
];
spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', logFd, logFd] });
```

The temporary real-client name filter above was superseded by the successful retry below after the controller clarified that commits in the test's own disposable fixture repository are authorized. For a future run, omit that filter and set a private `TMPDIR` from the beginning.

Exact follow-up Node arguments:

```sh
# Only this invocation receives DATABASE_URL; its helper is protected.
node --test --test-concurrency=1 --test-reporter=tap scripts/pgvector-semantic-search-db.test.mjs

# Private TMPDIR, own Redis, only Folder/Collaboration dedicated DB variables.
node --test --test-concurrency=1 --test-reporter=tap \
  scripts/content-tree-consumers-db.test.mjs \
  scripts/content-tree-operations-db.test.mjs \
  scripts/collaboration-real-agent-harness.test.mjs
```

Both orchestration wrappers captured `captureFolderDatabaseSafetyInventory`, the sorted `pg_namespace` list, and sorted `pg_database` list before and after tests; `finally` stopped only their Redis PID and removed their owned fixture directories. Do not point these commands at the running browser harness Redis or bypass the reviewed migration helpers.

## Initial remaining environment gates (subsequently closed above)

After replacing the four pgvector skips with actual results, the remaining 52 database skips are:

- 34 cases reporting generic `DATABASE_URL is not configured`.
- 9 legacy migration cases reporting `DATABASE_URL is not configured for local migration tests`.
- 8 Sync v3 cases requiring `SYNC_V3_TEST_DATABASE_URL`.
- 1 Sync version case requiring a separately migrated database named `agentwiki_sync_version_test_*` through `SYNC_VERSION_TEST_DATABASE_URL`.

The generic legacy migration suites and `sync-v3-test-database.mjs` copy/run the original migration chain without the reviewed bundle's removal of global extension/database-setting fragments. They were not enabled on the shared test database. The Sync version case explicitly requires a separate whole disposable database. Closing these gates needs an appropriately isolated complete database setup; this support task intentionally did not broaden database or dependency setup. No success claim is made for these skipped cases or the full `AGENTWIKI_FULL_TEST=1` gate.

## Cleanup and live-browser preservation

Both orchestration receipts confirm protected inventory unchanged, schema list unchanged, database list unchanged, no new schemas/databases left, owned Redis stopped, and owned scratch/attachment paths removed.

The protected inventory digest was `e447573064bbbfc1fbeae49340e519e8b40478a9992ccfaf92e35cfbc93350c0` before and after both runs. Independent final probes confirmed both owned Redis PIDs absent and both scratch directories absent. The live browser's proxied `/api/health` returned HTTP 200 / `status: ok`; its private runtime remained `ready`, parent `34134`, file mode `0600`. A scoped Git comparison found no server/script source differences between reviewed server commit `c773037f` and the recorded HEAD.

- First run Redis: PID `47241`, port `56931`; stopped.
- Retry Redis: PID `51576`, port `59560`; stopped.
- Browser harness parent `34134` at `http://127.0.0.1:59105` was preserved throughout. Its fixture page is `41c40a23-499f-44bc-9c76-60e52a66dec2`; Space is `cmuvt41cb001g67i3o38rg8b4`.
- Private evidence: `/tmp/document-workspace-runtime-safe.log`, `/tmp/document-workspace-runtime-safe-receipt.json`, `/tmp/document-workspace-runtime-retry.log`, `/tmp/document-workspace-runtime-retry-receipt.json`. Files were created with mode `0600`; no tokens/passwords were printed into this report.

This is runtime/database evidence. It does not replace the controller's integrated client, actual browser interaction, final branch review, or release/deployment gates.
