# Composite templates with AgentWiki v0.8.0: local integration verification

Date: 2026-09-06

## Immutable integration inputs

- Composite-template feature parent: `36abc59f822c844362fed39bb85116d38eaa8801`.
- Pinned v0.8.0 upstream parent: `ea56d75b2cf58b191022e84368f32b042cd38e6f`.
- Common ancestor: `711cae77277af1f79c6f4c16f998dbc66f6e2dae`.
- Integration branch: `codex/composite-page-group-agent-collaboration` in the isolated linked worktree.
- Executable integration result: merge commit `069eb126b847d88aa7d98935f11271a81dbb6ece`; any descendant created solely to strengthen this verification document changes no product or test source. The controller performs independent review before any local `master` fast-forward.

This work did not push, publish packages, deploy, migrate production data, change accounts, or replay paid models.

## Conflict resolution and bounded integration fixes

The no-commit merge produced exactly the seven expected conflicts and no others:

- `ReviewService.get()` preserves the v3 Push-session-derived `revertible` value and enriches a composite collaboration artifact Link with its Run `reviewPath`. The queue and mutation boundary remain non-revertible for published v3 ChangeSets.
- `ReviewPage` keeps linked candidates out of the ordinary review/publish controls and suppresses Revert when `revertible === false`; ordinary legacy published ChangeSets remain revertible.
- The protocol barrel exports both independent composite-template APIs and v0.8.0 content-tree limits. Composite types were not inserted into Sync wire schemas.
- The folder/collaboration migration inventory accepts the union of 55 migration SQL files plus `migration_lock.toml`, reviewed tree digest `62e0cd71551246a24494f607ed6f8483909b3688fc8600256a8afb4019d5f560`.
- The server test harness binds `DATABASE_URL`, `COLLABORATION_TEST_DATABASE_URL`, and `SYNC_V3_TEST_DATABASE_URL` to the same generated `collaboration_test_*` schema and reports that binding in its plan.
- The page-template legacy fixture now holds the named target migration and every later byte-sorted migration. It therefore no longer assumes that the composite migration is globally last after v0.8.0 added four later migrations.

The first real Chrome invocation exposed one integration-only harness defect before browser navigation: its fixture advertised Local Sync `0.7.0`, while the merged v0.8.0 server requires `0.8.0`. A focused regression failed with the literal version mismatch. The bounded fix derives the fixture version from `packages/local-sync/package.json` for child environment, installation API, and external-gateway fixture consumers.

Published migration files were not edited. Blob comparisons passed for these exact sources:

- Upstream parent: `20260904120000_add_sync_v3_attachments`, `20260905120000_expand_sync_v3_push_change_ordinal`, `20260905180000_add_attachment_blob_reference_indexes`, `20260905200000_add_attachment_cleanup_cursor`, and `20260905210000_harden_attachment_cleanup_claim`.
- Feature parent: `20260905120000_composite_templates`.

## Focused RED/GREEN evidence

All commands in this section ran from the exact working directory
`/Users/neomei/.codex/worktrees/69d8/AgentWiki /agentwiki`. During the RED runs,
Git `HEAD` was the feature parent `36abc59f822c844362fed39bb85116d38eaa8801`
and `MERGE_HEAD` was the upstream parent
`ea56d75b2cf58b191022e84368f32b042cd38e6f`. The individual RED states were
deliberately short-lived worktree resolutions and were not committed or written as
Git tree objects. Consequently, their exact complete trees cannot now be checked
out independently. The original command/output receipts remain in the local Codex
session record
`/Users/neomei/.codex/sessions/2026/09/06/rollout-2026-09-06T09-34-35-01a0745a-6119-7983-8731-f651ff8dbc7c.jsonl`;
the line references and raw excerpts below preserve what can be audited without
reconstructing or rerunning RED. No standalone RED `/tmp` logs were created, and no
later passing run is represented as original RED evidence.

### Semantic RED 1: combined ReviewService response

Source state: the combined regression was present; the protocol barrel conflict had
been mechanically resolved and built; `ReviewService.get()` temporarily used only
the upstream return `{ ...changeSet, revertible: !v3Session }`, so it omitted the
composite `reviewPath`. Receipt: JSONL line 198, command execution
`exec-fc6e26e7-d884-42a0-a813-33a5e8f414fd`, exit 1.

```sh
node -e "console.log(require('./packages/sync-protocol/package.json').scripts)" && pnpm --filter @neomei/agentwiki-sync-protocol build && pnpm --filter @agentwiki/server exec jest --runInBand src/review/review.service.spec.ts -t 'returns a non-revertible v3 collaboration Link'
```

Original failure excerpt:

```text
● ReviewService collaboration Page boundary › returns a non-revertible v3 collaboration Link with the actual Run destination
- Expected  -  3
+ Received  + 14
- ObjectContaining {
-   "collaborationArtifactLink": ObjectContaining {
-     "reviewPath": "/spaces/space-1/collaboration/runs/collaboration-run-1",
+ Object {
+   "approvals": Array [],
+   "collaborationArtifactLink": Object {
+     "artifactId": "artifact-1",
+     "pageId": "page-1",
+     "runId": "collaboration-run-1",
+     "spaceId": "space-1",
+     "taskId": "task-1",
    },
+   "id": "change-set-1",
+   "items": Array [],
    "revertible": false,
+   "run": null,
+   "space": Object {},
+   "spaceId": "space-1",
+   "status": "published",
  }
Test Suites: 1 failed, 1 total
Tests:       1 failed, 108 skipped, 109 total
```

Two earlier zero-test TypeScript blockers are excluded from semantic RED. After the
combined return was restored, the exact GREEN command (JSONL line 214, exit 0) was:

```sh
pnpm --filter @neomei/agentwiki-sync-protocol build && pnpm --filter @agentwiki/server exec jest --runInBand src/review/review.service.spec.ts -t 'returns a non-revertible v3 collaboration Link'
```

It reported `1 passed, 108 skipped, 109 total`.

### Semantic RED 2: combined ReviewPage controls

Source state: the regression was present and `ReviewPage.tsx` temporarily retained
the feature-side linked Publish guard but rendered Revert for every published
ChangeSet, without the upstream `changeSet.revertible !== false` condition. The
following exact test subcommand was in the original command-bearing shell. Because
the package `test` script inserted `--`, it unintentionally ran the full client
suite; this is recorded rather than rewritten as a narrower invocation. Receipt:
JSONL line 165, command execution
`exec-30138860-9a66-4a50-9209-75a7a1b6d69c`, exit 1.

```sh
pnpm --filter @agentwiki/client test -- src/features/review/ReviewPage.spec.tsx -t 'routes a published v3 collaboration ChangeSet without exposing legacy revert'
```

Original relevant lines (the rendered button body and unrelated full-suite output
are omitted):

```text
❯ src/features/review/ReviewPage.spec.tsx (14 tests | 2 failed)
× ReviewPage detail refresh > routes a published v3 collaboration ChangeSet without exposing legacy revert
  → expect(element).not.toBeInTheDocument()
expected document not to contain element, found <button
    [... rendered Revert button body omitted ...]
> instead
× ReviewPage detail refresh > does not offer revert for an explicitly non-revertible v3 Push ChangeSet
  → expect(element).not.toBeInTheDocument()
expected document not to contain element, found <button
    [... rendered Revert button body omitted ...]
> instead
```

After combining both guards, the exact focused GREEN command (JSONL line 219, exit
0) was:

```sh
pnpm --filter @agentwiki/client exec vitest run src/features/review/ReviewPage.spec.tsx -t 'routes a published v3 collaboration ChangeSet without exposing legacy revert'
```

It reported one test passed and 13 skipped.

### Semantic RED 3: migration boundary selector

Source state: the namespace-import regression asserted an exported byte-order
selector, while `page-template-test-database.mjs` still had the feature-parent
single-`latestMigrationName` implementation and exported no selector. A preceding
named-import syntax failure was excluded. The valid assertion RED is JSONL line 308,
command execution `exec-16d49e2f-289d-4f76-97cd-c256c0e0aa3e`, exit 1:

```sh
node --test --test-name-pattern='holds the target and every later migration' scripts/page-template-schema.test.mjs
```

Original failure excerpt:

```text
✖ page-template migration fixture holds the target and every later migration
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected
+ 'undefined'
- 'function'
actual: 'undefined'
expected: 'function'
```

After adding the selector and target-plus-later holding behavior, the exact GREEN
command (JSONL line 320, exit 0) was:

```sh
node --test scripts/page-template-schema.test.mjs && node --test scripts/server-test-harness.test.mjs
```

It reported 9/9 page-template tests and 3/3 server-harness tests passed.

### Fixture-version RED: two assertions

Source state: both new assertions expected `0.8.0`, while
`composite-template-e2e-support.mjs` still hard-coded `0.7.0` for the child
environment and external-gateway installation fixture. Receipt: JSONL line 461,
command execution `exec-a7ed871f-28ed-4926-90bc-0bd1e7101ef6`, exit 1.

```sh
node --test --test-name-pattern='acceptance child environment|external Agent gateway files' scripts/composite-template-e2e.test.mjs
```

The two original assertion results were (stack traces omitted):

```text
✖ acceptance child environment is bound to one generated schema, exact ports, and exact Space allowlist
  '0.7.0' !== '0.8.0'
✖ external Agent gateway files pass an explicit fixture home without repurposing HOME
  '0.7.0' !== '0.8.0'
ℹ tests 2
ℹ pass 0
ℹ fail 2
```

The exact GREEN/syntax command (JSONL line 475, exit 0) was:

```sh
sed -n '10,42p' scripts/composite-template-e2e.mjs
node --test --test-name-pattern='acceptance child environment|external Agent gateway files' scripts/composite-template-e2e.test.mjs
node --check scripts/composite-template-e2e.mjs
node --check scripts/composite-template-e2e-support.mjs
```

It reported 2/2 passed and both syntax checks exited 0.

### Focused GREEN and real DB/HTTP commands

After all bounded fixes, executable product/test source was unchanged through the
frozen gate and merge commit `069eb126b847d88aa7d98935f11271a81dbb6ece`.
The test portion of the original focused shell (JSONL line 366, exit 0) was exactly:

```sh
set -o pipefail
pnpm --filter @neomei/agentwiki-sync-protocol test 2>&1 | tee /tmp/agentwiki-composite-v080-focused-protocol.log
pnpm --filter @agentwiki/server exec jest --runInBand src/review/review.service.spec.ts 2>&1 | tee /tmp/agentwiki-composite-v080-focused-server.log
pnpm --filter @agentwiki/client exec vitest run src/features/review/ReviewPage.spec.tsx src/features/page/PageEditor.spec.tsx src/features/attachments/attachmentReference.spec.ts 2>&1 | tee /tmp/agentwiki-composite-v080-focused-client.log
node --test scripts/page-template-schema.test.mjs scripts/server-test-harness.test.mjs scripts/content-tree-limits.test.mjs 2>&1 | tee /tmp/agentwiki-composite-v080-focused-harness.log
```

Results were protocol 140/140, ReviewService 109/109, client 73/73, and
helper/harness 12/12. Each retained log reports a passing command and the enclosing
shell exited 0. The real DB/HTTP shell (JSONL line 392, exit 0) was exactly:

```sh
set -o pipefail
export DATABASE_URL='postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test'
export FOLDER_TEST_DATABASE_URL="$DATABASE_URL"
export MARKDOWN_TEST_DATABASE_URL="$DATABASE_URL"
export COLLABORATION_TEST_DATABASE_URL="$DATABASE_URL"
export PAGE_TEMPLATE_TEST_DATABASE_URL="$DATABASE_URL"
export SYNC_V3_TEST_DATABASE_URL="$DATABASE_URL"
export TEST_REDIS_URL='redis://127.0.0.1:50416/0'
export PG_DUMP_BIN='/opt/homebrew/opt/postgresql@16/bin/pg_dump'
export PSQL_BIN='/opt/homebrew/opt/postgresql@16/bin/psql'
export AGENTWIKI_PSQL_BIN="$PSQL_BIN"
node --test --test-concurrency=1 \
  scripts/collaboration-schema-db.test.mjs \
  scripts/content-tree-core-db.test.mjs \
  scripts/content-tree-consumers-db.test.mjs \
  scripts/composite-template-schema-db.test.mjs \
  scripts/collaboration-page-publication-db.test.mjs \
  scripts/collaboration-page-conflict-db.test.mjs \
  scripts/sync-v3-attachment-schema-db.test.mjs \
  scripts/sync-v3-http-db.test.mjs 2>&1 | tee /tmp/agentwiki-composite-v080-focused-db.log
```

It reported 55/55 passed, zero failed/skipped. The five focused logs named by
these commands remain at the exact `/tmp` paths shown above.

## Real Chrome UI-only acceptance

Both browser commands ran from
`/Users/neomei/.codex/worktrees/69d8/AgentWiki /agentwiki` against the dedicated
PostgreSQL and Redis services. Attempt 1 used the resolved merged product source but
the pre-fix fixture state that still advertised Local Sync `0.7.0`:

```sh
set -o pipefail
export COMPOSITE_TEMPLATE_E2E_DATABASE_URL='postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test'
export COMPOSITE_TEMPLATE_E2E_REDIS_URL='redis://127.0.0.1:50416/0'
export PG_DUMP_BIN='/opt/homebrew/opt/postgresql@16/bin/pg_dump'
export PSQL_BIN='/opt/homebrew/opt/postgresql@16/bin/psql'
export COMPOSITE_TEMPLATE_E2E_ARTIFACTS_DIR='/tmp/agentwiki-composite-v080-chrome1'
export COMPOSITE_TEMPLATE_E2E_EXTERNAL_STAGES='none'
node scripts/composite-template-e2e.mjs run 2>&1 | tee /tmp/agentwiki-composite-v080-chrome1.log
```

The command receipt is JSONL line 415, command execution
`exec-130cd6c6-6680-4b80-be4c-1f0289a954e7`, exit 1. The retained log's failure is:

```text
Error: POST /agents/cmtp5jvcj001lwrnfmjd6tz53/local-sync-installations failed with 400: {"statusCode":400,"message":"pluginVersion must match /^0\\.8\\.0$/ regular expression","error":"Bad Request","timestamp":"2026-09-06T01:47:57.434Z","path":"/api/agents/cmtp5jvcj001lwrnfmjd6tz53/local-sync-installations","code":"BAD_REQUEST","requestId":"1d6d8625-3c55-47c1-860f-59cf30351dd2"}
```

It failed during fixture preparation before browser navigation. The fixture-version
RED/GREEN above isolated and corrected that integration defect. Attempt 2 used the
same merged executable source later committed at `069eb126...`, including the
package-derived fixture version:

```sh
set -o pipefail
export COMPOSITE_TEMPLATE_E2E_DATABASE_URL='postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test'
export COMPOSITE_TEMPLATE_E2E_REDIS_URL='redis://127.0.0.1:50416/0'
export PG_DUMP_BIN='/opt/homebrew/opt/postgresql@16/bin/pg_dump'
export PSQL_BIN='/opt/homebrew/opt/postgresql@16/bin/psql'
export COMPOSITE_TEMPLATE_E2E_ARTIFACTS_DIR='/tmp/agentwiki-composite-v080-chrome2'
export COMPOSITE_TEMPLATE_E2E_EXTERNAL_STAGES='none'
node scripts/composite-template-e2e.mjs run 2>&1 | tee /tmp/agentwiki-composite-v080-chrome2.log
```

The command receipt is JSONL line 490, command execution
`exec-1d24fc10-a001-418d-b37b-eac1a61b9ab1`, exit 0. The retained log is
`/tmp/agentwiki-composite-v080-chrome2.log` and the artifact directory is
`/tmp/agentwiki-composite-v080-chrome2`. It emitted `ACCEPTANCE_PARTIAL` followed by
`CLEANED`; `PARTIAL` is intentional because no external paid-model stage was
authorized.

Six UI journeys passed: ordinary composite creation/edit/reload, enabled collaboration, historical Page binding, saved Folder source-CAS/template instantiation, concurrent Page conflict/regenerate/adopt, and legacy/feature-off compatibility. The run also covered 390px English keyboard/responsive behavior.

Persisted assertions included 11 nodes/7 Pages/0 Runs in collaboration-off mode; 7 tasks/2 participants with collaboration enabled; four retained Pages, one role, and seven instantiated nodes for a saved Folder; system title `日报 2026-09-06`; JSON single-page version 2 metadata/archive; and publication of an existing Page-selection Run while new composite creation was disabled.

Exactly three expected HTTP 409 responses were observed: one `SOURCE_CHANGED` and two `PAGE_VERSION_CONFLICT`. Each had a matching expected console event. Unknown console issues and page errors were both zero. Evidence: `/tmp/agentwiki-composite-v080-chrome2.log` and `/tmp/agentwiki-composite-v080-chrome2`.

This proves the merged UI-only workflow. It does not claim fresh Codex/OpenCode/other external-client model execution or production acceptance.

## Frozen full gate

The source-freeze gate ran from the same exact working directory. Its complete shell
and environment (JSONL line 643, exit 0) were:

```sh
set -o pipefail
export DATABASE_URL='postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test'
export FOLDER_TEST_DATABASE_URL="$DATABASE_URL"
export MARKDOWN_TEST_DATABASE_URL="$DATABASE_URL"
export COLLABORATION_TEST_DATABASE_URL="$DATABASE_URL"
export PAGE_TEMPLATE_TEST_DATABASE_URL="$DATABASE_URL"
export SYNC_V3_TEST_DATABASE_URL="$DATABASE_URL"
export TEST_REDIS_URL='redis://127.0.0.1:50416/0'
export PG_DUMP_BIN='/opt/homebrew/opt/postgresql@16/bin/pg_dump'
export PSQL_BIN='/opt/homebrew/opt/postgresql@16/bin/psql'
export AGENTWIKI_PSQL_BIN="$PSQL_BIN"
pnpm typecheck 2>&1 | tee /tmp/agentwiki-composite-v080-typecheck.log &&
pnpm lint 2>&1 | tee /tmp/agentwiki-composite-v080-lint.log &&
pnpm build 2>&1 | tee /tmp/agentwiki-composite-v080-build.log &&
pnpm test:full 2>&1 | tee /tmp/agentwiki-composite-v080-full.log
```

The combined command exited 0. Typecheck, lint, and all package builds passed. The only build advisory was Vite's existing large-chunk warning.

`test:full` results:

- Repository Node/TAP phase: 258 tests, 257 passed, one explicitly gated non-DB CodeGraph E2E skip.
- Real sequential DB phase: 175/175 passed, zero failed and zero skipped.
- Server Jest: 146/146 suites, 2499 passed, one macOS-inapplicable Windows-only test skipped.
- Client Vitest: 93/93 files, 1264/1264 passed.
- Sync protocol: 10/10 files, 140/140 passed.
- Local Sync: 61/61 files, 877 passed, one macOS-inapplicable Windows ACL test skipped.

Aggregate across the reported phases: 5212 passed, zero failed, and three explicitly explained non-DB/platform skips.

Logs: `/tmp/agentwiki-composite-v080-typecheck.log`, `/tmp/agentwiki-composite-v080-lint.log`, `/tmp/agentwiki-composite-v080-build.log`, and `/tmp/agentwiki-composite-v080-full.log`.

The WARN/ERROR-looking lines in the passing aggregate log are expected negative-path
and fault-injection observations, not unclassified gate failures:

- Lines 458-459: `SearchService` is given an isolated embedding failure, then a
  concurrent content change; the durable-effect test asserts retry and the semantic
  fence that lets the newer indexing run own the vector.
- Lines 1361-1363: `RevisionRetentionService` receives PostgreSQL `P0001: forced
  content GC failure`; the immediately enclosing retention subtest passes because
  deferred GC and fail-closed retention are the asserted behavior.
- Lines 1654 and 1661-1662: the real Sync v3 suite deliberately injects a finalize
  failure (`500: Sync v3 request failed safely`) and an unavailable post-finalize
  graph refresh. The lifecycle and atomic-finalize subtests both pass, establishing
  the requested rollback/idempotency and best-effort graph behavior.
- Other server unit/HTTP negative-path output deliberately exercises validation,
  authentication, authorization, conflict, gone, payload-limit, rate-limit, and
  fail-safe internal-error mappings (`400/401/403/404/409/410/413/429/500`), plus
  mocked offline embedding/graph/audit services. The final suite summaries report
  zero failed tests; these classes are expected only inside the named passing tests.

## Isolation and cleanup

All database work targeted `agentwiki_composite_test` through generated task-owned schemas. After focused DB, Chrome, and the frozen full gate:

- `public` tables: 0.
- Generated collaboration/folder/markdown/page-template/sync-v3/pgvector test schemas: 0.
- Other connections to the task database: 0.
- Chrome acceptance API/web listeners on ports 60812/60813: 0.
- Protected structural inventory digest: `887e5d38ed14a3945866940b88cb74236e4f56f7636235f53d289095ba0ef73b`, unchanged.

No `.codex-memory` file belongs to or is staged by this integration. The controller-owned working-tree edit remains outside the commit.
