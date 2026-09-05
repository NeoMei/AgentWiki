# Task 13a report — durable effects and rollout policy

Base: `d46a2ddff335b7fa3c59ed7cfbe8c58cd6f12ad3`

## Outcome

- Added an awaited durable `TemplateEffectsService` drain for the existing persisted `TemplateEffectJob` rows. It consumes only the existing `page_index`, `space_graph`, and `collaboration_run` kinds and their exact ID-only payloads; it does not introduce a second queue or state machine.
- Added a default-closed `TemplateFeaturePolicy` and used the same singleton policy for server write authority and catalog `capabilities.canCreate`.
- Gated every current composite mutation controller route, including Task 12 management writes, while leaving catalog/detail/preview reads, seed initialization, legacy template operations, and existing collaboration Run execution/review/conflict/resume paths ungated.
- Closed the shared-service bypass: every direct composite `PageTemplateService` write and both locked composite-create/version paths consult the policy. Legacy metadata/archive/restore additionally reject a composite record reached through the old controller, but normal legacy records remain writable.
- Made the client catalog parser require both capability booleans and fail closed at every concrete new-composite entry surface: unified New Page flow, template manager, Space tree Page/Folder binding and Folder-template save, Page editor binding, Collaboration Workspace composite creation, and legacy-to-composite upgrade. Blank Page, legacy single-page template, legacy workflow, and existing Run paths remain visible/usable.
- Added the isolated PostgreSQL/HTTP suite to the existing serialized runtime DB discovery by the `*-db.test.mjs` naming convention and an exact inventory assertion. No extra repository phase was added.

## Rollout capability and configuration contract

- Configuration key: `COMPOSITE_TEMPLATE_SPACE_ALLOWLIST`.
- Value format: one comma-separated list of exact Space IDs. Surrounding whitespace is trimmed; blank values are ignored; matching is case-sensitive; `*` is deliberately ignored rather than opening every Space.
- Default: missing, non-string, empty, whitespace-only, or wildcard-only configuration permits no Space.
- `TemplateFeaturePolicy` snapshots the allowlist in its constructor. A production rollout change therefore takes effect by starting a new API process with the new environment, not by mutating an already-constructed policy instance. The real feature-off test starts a fresh API process with an empty value.
- `capabilities.canCreate` means the Space is on the composite rollout allowlist. `capabilities.canManage` remains the independent live human authorization result. `canCreate=true` never grants management permission, and `canManage=true` cannot bypass `canCreate=false` for new composite writes.
- The server is authoritative: all 13 current composite mutation routes return `COMPOSITE_TEMPLATE_FEATURE_DISABLED` (HTTP 409) when off. Read/preview routes still work. The client capability only controls presentation and is not an authorization substitute.
- Gated mutation inventory: composite template create/metadata/version/archive/restore; Folder snapshot save; template instantiate; legacy workflow upgrade write; Page binding put/delete; Folder binding write; existing Page Run start; existing Folder Run start. Preview, catalog, detail, existing Run claim/submit/review/regenerate/adopt/resume, legacy workflow routes, and initialization seed are not gated.

## Durable queue behavior

- Worker/all roles perform one awaited startup drain and an unref'd 1-second poll. API role does not drain or start a polling timer; per-process reentrancy shares the active drain promise.
- Each pass reads at most 25 due rows in stable oldest-first order. A compare-and-set claim includes `id`, prior `status`, `attempts`, and `lockedAt`, increments `attempts`, stamps a new `lockedAt`, and prevents two workers from dispatching the same claim.
- Completion and failure are fenced by the claimed attempt number and exact lock timestamp, so an expired claimant cannot finalize a newer attempt.
- Failed attempts return to pending with bounded exponential delay. Under the eight-attempt limit the automatic retry delays are 1s, 2s, 4s, 8s, 16s, 32s, and 64s; the formula is defensively capped at five minutes. Only stable sanitized codes are stored in `lastError`; arbitrary exception messages are never persisted.
- Attempt 8 becomes observable `failed`. A process crash after the eighth claim leaves `processing/attempts=8`; once its five-minute claim TTL expires, the next drain compare-and-set finalizes it as `failed` with `TEMPLATE_EFFECT_CLAIM_EXPIRED`, without executing a ninth attempt or stranding it behind an `attempts<8` filter. Failed rows are retained for inspection and an explicit operator-managed reset; the worker never resets them automatically.
- `page_index` first validates the exact payload and Space ownership, then awaits existing index cleanup/indexing. Missing/deleted Pages complete after cleanup. A live Page requires both lexical and semantic success; lexical-only success retries with `PAGE_INDEX_SEMANTIC_PENDING` and never rolls back the committed Page.
- `space_graph` validates exact Space scope and awaits `GraphRefreshService.refresh`. Missing/deleted Spaces are terminal no-ops. `llm_unavailable`, `rate_limited`, `proposal_pending`, and `no_author` retry as deferred; `not_enough_pages` and `no_valid_proposals` complete truthfully; a produced ChangeSet remains pending existing human review and is not auto-published.
- `collaboration_run` validates exact Run scope and awaits `CollaborationEventsService.publishCurrentRun`; missing Runs are terminal no-ops. The job payload contains only the Run ID.

## External-boundary test policy

- Ordinary Jest tests use deliberate Search, graph-refresh, and collaboration-event stubs and assert that awaited success/failure changes job state.
- The real DB duplicate-claim test uses only `collaboration_run` jobs with an explicitly stubbed publisher; it never calls embedding or graph services.
- The feature-off HTTP test starts only an API process (`PROCESS_ROLE=api`) and uses fixture Markdown plus real MCP/HTTP collaboration endpoints. It does not start a worker or invoke a paid model.
- No schema expansion or migration was needed. Tests use helper-created random schemas only, verify the protected public inventory digest, and clean only their own schemas.

## TDD evidence

### Feature policy RED

```text
pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/template-feature-policy.spec.ts
Exit 1. The focused suite failed to compile because `./template-feature-policy` did not exist (TS2307), proving the new default-closed exact-Space policy contract was absent.
```

### Feature policy GREEN

```text
pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/template-feature-policy.spec.ts
Exit 0. 1/1 suite passed; 3/3 tests passed in 1.9s.
```

### Durable effect worker RED

```text
pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/template-effects.service.spec.ts
Exit 1. The focused suite failed to compile because `./template-effects.service` did not exist (TS2307), proving drain, retry, fencing, stale-claim recovery, exact handlers, and lifecycle behavior were absent.
```

### Durable effect worker GREEN

```text
pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/template-effects.service.spec.ts
Exit 0. 1/1 suite passed; 16/16 tests passed in 2.056s.
```

### Server capability and route gate RED

```text
pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/composite-template.controller.spec.ts src/page-templates/composite-template-catalog.service.spec.ts
Exit 1. Both suites failed at compile time because the controller and catalog did not accept `TemplateFeaturePolicy` (TS2554), proving neither the mutation gate nor authoritative catalog capability was wired.
```

### Server capability and route gate GREEN

```text
pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/composite-template.controller.spec.ts src/page-templates/composite-template-catalog.service.spec.ts
Exit 0. 2/2 suites passed; 25/25 tests passed in 2.176s. This includes all 13 composite mutation methods and a real Nest HTTP disabled-write response.
```

### Production DI RED

```text
pnpm --filter @agentwiki/server exec jest --runInBand src/app.module.spec.ts src/worker.module.spec.ts
Exit 1. AppModule could not resolve `TemplateFeaturePolicy`, and WorkerModule could not find `TemplateEffectsService`; both failures were the intended missing production DI seams.
```

### Production DI GREEN

```text
pnpm --filter @agentwiki/server exec jest --runInBand src/app.module.spec.ts src/worker.module.spec.ts
Exit 0. 2/2 suites and 2/2 dependency-graph tests passed in 2.532s. WorkerModule registers the effect provider directly and does not import PageTemplateModule or HTTP controllers.
```

### Client capability contract RED

```text
pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/compositeTemplateApi.spec.ts --reporter=dot
Exit 1. 1/10 failed because a catalog without `capabilities.canCreate` resolved instead of failing closed.
```

### Client capability contract GREEN

```text
pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/compositeTemplateApi.spec.ts --reporter=dot
Exit 0. 1/1 file passed; 10/10 tests passed in 394ms.
```

### Client rollout fallback RED

```text
pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/NewPageDialog.composite.spec.tsx src/features/page-templates/PageTemplateManager.composite.spec.tsx --reporter=dot
Exit 1. 2/19 failed: rollout-off still rendered composite choices/management and omitted the required visible legacy fallback copy.
```

### Client rollout fallback GREEN

```text
pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/NewPageDialog.composite.spec.tsx src/features/page-templates/PageTemplateManager.composite.spec.tsx --reporter=dot
Exit 0. 2/2 files passed; 19/19 tests passed in 862ms. Rollout-off now hides composite choices, loads legacy templates, and shows zh-CN/en fallback copy.
```

## Completed verification commands

- See each section below; commands are appended immediately after completion with exit status and relevant output.
- Interim `pnpm --filter @agentwiki/client exec tsc --noEmit`: exit 0, no diagnostics after capability/fallback wiring.
- First client fallback GREEN attempt: exit 1, 18/19 passed. The remaining implementation behavior was present; the blank-page assertion used an exact accessible name while the button includes description text. The locator was narrowed to the stable name prefix before rerun.
- Fresh client fallback GREEN rerun: `pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/NewPageDialog.composite.spec.tsx src/features/page-templates/PageTemplateManager.composite.spec.tsx --reporter=dot`; exit 0, 2/2 files and 19/19 tests passed in 1.02s.
- First service-bypass RED attempt: `pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/page-template.service.spec.ts`; exit 1. The intended missing fifth policy dependency (`TS2554`) was present, alongside a test-double method-name typo (`isEnabled` vs production `canCreate`) that was corrected before accepting RED evidence.
- Service-policy DI RED: `pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/page-template.service.spec.ts`; exit 1. The suite failed only because `PageTemplateService` still accepted four dependencies (`TS2554`), proving there was no service-level rollout policy seam.
- First service-policy GREEN attempt: same focused command; exit 1 with 98/104 passing. Six pre-existing legacy tests used an incomplete current-version double, so the new pre-write kind check correctly reported `PAGE_TEMPLATE_VERSION_NOT_FOUND`; their default double was completed with `definition: null`.
- Service-policy GREEN: `pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/page-template.service.spec.ts`; exit 0, 1/1 suite and 104/104 tests passed in 2.144s. This covers all direct composite write families, both locked bypasses, and legacy metadata/archive/restore rejection for composite records while keeping ordinary legacy writes usable.
- Workspace capability RED: `pnpm --filter @agentwiki/client exec vitest run src/features/space/SpaceView.spec.tsx src/features/page/PageEditor.spec.tsx --reporter=dot`; exit 1, 2/75 failed. Both real surfaces never requested the authoritative composite catalog and still rendered binding/Folder-template entry points when `canCreate` was false.
- First Workspace capability GREEN attempt: same focused command; exit 1. `PageEditor` passed, while all 22 `SpaceView` tests exposed a missing `language` destructure in the new request identity (`ReferenceError`); corrected before rerun.
- Workspace capability GREEN: `pnpm --filter @agentwiki/client exec vitest run src/features/space/SpaceView.spec.tsx src/features/page/PageEditor.spec.tsx --reporter=dot`; exit 0, 2/2 files and 75/75 tests passed in 1.69s. `SpaceView` and `PageEditor` now fail closed on missing/false composite capability while ordinary Page creation and legacy single-page template management remain independent.
- Rejected harness experiment: `node --test scripts/repository-test-orchestration.test.mjs`; exit 1, 0/1 passed only because an initial assertion incorrectly required a second repository phase. This is not accepted TDD RED evidence. Inspection showed the existing runtime phase already auto-discovers and serializes every `*-db.test.mjs`, so the separate phase and its assertion were fully reverted.
- First real-DB attempt after inspecting the dedicated labeled PG `127.0.0.1:50415` and Redis `127.0.0.1:50416`: exit 1 before schema creation because the new compiled effect service did not yet exist in `apps/server/dist`. The server build is therefore a required precondition and no database fixture/public state was touched.
- Harness routing correction: the initial separate repository phase was removed after confirming the existing runtime phase already serially discovers every `*-db.test.mjs`. `runtime-test-harness.test.mjs` now asserts the exact new filename instead, avoiding a duplicate DB execution and leaving all repository phases unchanged.
- Harness inventory GREEN: `node --test scripts/runtime-test-harness.test.mjs scripts/repository-test-orchestration.test.mjs`; exit 0, 20/20 tests passed in 451.8ms. This proves the new DB suite is named in the serialized DB inventory and the existing repository phase order is preserved.
- Focused server regression: `pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/template-feature-policy.spec.ts src/page-templates/template-effects.service.spec.ts src/page-templates/page-template.service.spec.ts src/page-templates/composite-template.controller.spec.ts src/page-templates/composite-template-catalog.service.spec.ts src/app.module.spec.ts src/worker.module.spec.ts`; exit 0, 7/7 suites and 150/150 tests passed in 4.028s.
- Server build precondition: `pnpm --filter @agentwiki/server build`; exit 0 (`nest build`), producing the compiled service/API used by the isolated DB/HTTP test.
- First compiled real-DB/HTTP run: exit 1, 1/2 passed. PostgreSQL duplicate claim plus retry passed in random schema `page_template_test_d08cd8cd45244c8ab0874fb21c897ed6`; the HTTP API failed before listening because its fixture seed was a UUID rather than exactly 32 decoded bytes. The random schema was cleaned and the protected-public inventory guard completed; the seed fixture was corrected to base64-encoded 32 random bytes.
- Real PostgreSQL/HTTP GREEN: dedicated labeled PG `127.0.0.1:50415` and Redis `127.0.0.1:50416`, exact environment from the brief, `node --test scripts/composite-template-effects-policy-db.test.mjs`; exit 0, 2/2 passed in 11.35s. Two random `page_template_test_*` schemas proved DB uniqueness + two-client fenced claiming, first handler failure/backoff then success, a fresh production API process with an empty allowlist returning `canCreate:false` and HTTP 409 on new composite write, ordinary legacy catalog HTTP availability, seed startup compatibility, and existing composite Run resume over real HTTP. Both runs reported identical protected-public inventory digest `887e5d38ed14a3945866940b88cb74236e4f56f7636235f53d289095ba0ef73b`; schemas were dropped by the guard.
- Feature-off full-continuation acceptance RED: same dedicated PG/Redis environment and `node --test scripts/composite-template-effects-policy-db.test.mjs`; exit 1, 1/2 passed. The strengthened assertion expected one published `PageVersion` after the rollout-off API process resumed the existing composite Run, but the old fixture stopped at `running` and produced `0 !== 1`. Random schema `page_template_test_e24deb94aaa9423cb1b8d7a15554bb0f` completed the public-inventory guard and was cleaned. This proves the prior acceptance covered only resume, not claim/submit/human publication.
- Feature-off full-continuation GREEN: same exact dedicated environment and command; exit 0, 2/2 passed in 11.46s. A new API process with `COMPOSITE_TEMPLATE_SPACE_ALLOWLIST=''` denied the new composite write, then the already-created composite Run resumed, an authenticated Agent claimed its existing target-Page task through the real MCP transport, completed its Todo and submitted Markdown, and the Human approved it through the real Run review HTTP route. The Run reached `completed`, the target Page contained the submitted Markdown, and exactly one matching `PageVersion` existed. The test used only fixture Markdown and stubbed effect boundaries; it did not start a worker or call embeddings/graph LLM. Random schemas `page_template_test_c038d2ae4d734e99982fc53e03a4c3ac` and `page_template_test_0585f692d9fe4fd1a7191eb1920b3752` both reported protected-public digest `887e5d38ed14a3945866940b88cb74236e4f56f7636235f53d289095ba0ef73b` and were cleaned.
- Collaboration Workspace capability RED: `pnpm --filter @agentwiki/client exec vitest run src/features/collaboration/CollaborationWorkspace.test.tsx -t 'hides only new composite entry points' --reporter=dot`; exit 1, 1 failed / 26 skipped. The new assertion observed zero authoritative catalog calls, proving the Workspace still exposed both the unified composite-create button and legacy-to-composite upgrade without consulting `canCreate`.
- First Collaboration Workspace GREEN attempt: same command; exit 1 after the production behavior passed because the preserved legacy-create assertion used the older accessible label `Create template`. The rendered stable label is `Create legacy workflow template`; the assertion was corrected without changing behavior.
- Collaboration Workspace capability GREEN: same command; exit 0, 1 passed / 26 skipped in 535ms. The Workspace now obtains `canCreate` from the same strict catalog response, fails closed when that request fails, hides unified composite creation and legacy-to-composite upgrade when disabled, and preserves legacy Run start plus legacy template creation/edit/archive/copy paths.
- Fresh final focused client rollout regression: `pnpm --filter @agentwiki/client exec vitest run src/features/page-templates/compositeTemplateApi.spec.ts src/features/page-templates/NewPageDialog.composite.spec.tsx src/features/page-templates/PageTemplateManager.composite.spec.tsx src/features/space/SpaceView.spec.tsx src/features/page/PageEditor.spec.tsx src/features/collaboration/CollaborationWorkspace.test.tsx --reporter=dot`; exit 0, 6/6 files and 131/131 tests passed in 2.16s.
- Full server package regression with `PROCESS_ROLE=api`: `PROCESS_ROLE='api' pnpm --filter @agentwiki/server test`; exit 0, 138/140 suites passed with 2 DB-gated suites skipped; 2223/2231 tests passed with 8 skipped; 0 snapshots; 29.971s. No worker loop started. Expected negative-path Nest logs and deliberately stubbed offline embedding/graph warnings were present; no paid model boundary was invoked.
- Full client package regression: `pnpm --filter @agentwiki/client test`; exit 0, 92/92 files and 1224/1224 tests passed in 13.60s.
- Repository typecheck: `pnpm typecheck`; exit 0. Server, client, sync protocol, and local-sync TypeScript checks completed with no diagnostics.
- Repository lint: `pnpm lint`; exit 0, no ESLint findings.
- Repository build: `pnpm build`; exit 0. Shared, sync protocol ESM/CJS, Nest server, Vite client, and local-sync builds completed; client transformed 4753 modules and built in 5.71s. Only the pre-existing Vite chunk-size warning remained.
- Controller-run seven-script DB regression initially failed after 7 passes / 3 failures / 0 skips in 13.43s. All three failures were explicit test composition drift from the new required policy dependency: the instantiation RootTestModule omitted `TemplateFeaturePolicy`, and two snapshot tests constructed `PageTemplateService` without the fifth argument. Inspection also found the same stale manual constructor in `content-tree-consumers-db.test.mjs`. Production remained fail-closed; these three DB fixtures were updated with an explicit `{ canCreate: () => true }` test policy/provider.
- Server rebuild after DB fixture composition repair: `pnpm --filter @agentwiki/server build`; exit 0 (`nest build`).
- Fresh seven-script PostgreSQL regression after fixture repair: dedicated PG/Redis environment, `node --test --test-concurrency=1 scripts/composite-template-schema-db.test.mjs scripts/composite-template-catalog-db.test.mjs scripts/composite-template-instantiation-db.test.mjs scripts/page-agent-binding-db.test.mjs scripts/composite-template-snapshot-db.test.mjs scripts/collaboration-page-publication-db.test.mjs scripts/collaboration-page-conflict-db.test.mjs`; exit 0, 10/10 tests passed, 0 skipped, in 14.01s. Each helper used and cleaned its own random schema.
- Adjacent manual-constructor PostgreSQL regression: `FOLDER_TEST_DATABASE_URL=... node --test scripts/content-tree-consumers-db.test.mjs`; exit 0, 21/21 tests passed in 3.64s. The helper ended with `folder_test_schemas=0`, `sanitized_temp_dirs=0`, and equal protected-public inventory digest before/after (`887e5d38ed14a3945866940b88cb74236e4f56f7636235f53d289095ba0ef73b`).
- Final focused server verification: `pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/template-feature-policy.spec.ts src/page-templates/template-effects.service.spec.ts src/page-templates/page-template.service.spec.ts src/page-templates/composite-template.controller.spec.ts src/page-templates/composite-template-catalog.service.spec.ts src/app.module.spec.ts src/worker.module.spec.ts`; exit 0, 7/7 suites and 150/150 tests passed in 2.08s.
- Final fresh seven-script PostgreSQL verification: dedicated PG/Redis environment, `node --test --test-concurrency=1 scripts/composite-template-schema-db.test.mjs scripts/composite-template-catalog-db.test.mjs scripts/composite-template-instantiation-db.test.mjs scripts/page-agent-binding-db.test.mjs scripts/composite-template-snapshot-db.test.mjs scripts/collaboration-page-publication-db.test.mjs scripts/collaboration-page-conflict-db.test.mjs`; exit 0, 10/10 tests passed, 0 skipped, in 14.05s. This is the post-repair rerun requested after the original 7-pass/3-fail fixture-composition regression.
- Final explicit-work-tree `git diff --check`; exit 0 with no whitespace errors. The staged 38-file inventory excludes all `.codex-memory` paths.

## Files changed

Production server:

- `apps/server/src/page-templates/template-effects.service.ts`
- `apps/server/src/page-templates/template-feature-policy.ts`
- `apps/server/src/page-templates/page-template.module.ts`
- `apps/server/src/page-templates/page-template.service.ts`
- `apps/server/src/page-templates/composite-template.controller.ts`
- `apps/server/src/page-templates/composite-template-catalog.service.ts`
- `apps/server/src/worker.module.ts`
- `apps/server/src/core/filters/business-error.ts`

Server tests:

- `apps/server/src/page-templates/template-effects.service.spec.ts`
- `apps/server/src/page-templates/template-feature-policy.spec.ts`
- `apps/server/src/page-templates/page-template.service.spec.ts`
- `apps/server/src/page-templates/page-template.controller.spec.ts`
- `apps/server/src/page-templates/composite-template.controller.spec.ts`
- `apps/server/src/page-templates/composite-template-catalog.service.spec.ts`
- `apps/server/src/app.module.spec.ts`
- `apps/server/src/worker.module.spec.ts`

Production client:

- `apps/client/src/api/error-message.ts`
- `apps/client/src/i18n/messages.ts`
- `apps/client/src/features/page-templates/compositeTemplateApi.ts`
- `apps/client/src/features/page-templates/compositeTemplateTypes.ts`
- `apps/client/src/features/page-templates/NewPageDialog.tsx`
- `apps/client/src/features/page-templates/PageTemplateManager.tsx`
- `apps/client/src/features/space/SpaceView.tsx`
- `apps/client/src/features/page/PageEditor.tsx`
- `apps/client/src/features/collaboration/CollaborationWorkspace.tsx`
- `apps/client/src/features/collaboration/components/TemplateCard.tsx`

Client tests:

- `apps/client/src/features/page-templates/compositeTemplateApi.spec.ts`
- `apps/client/src/features/page-templates/NewPageDialog.composite.spec.tsx`
- `apps/client/src/features/page-templates/PageTemplateManager.composite.spec.tsx`
- `apps/client/src/features/space/SpaceView.spec.tsx`
- `apps/client/src/features/page/PageEditor.spec.tsx`
- `apps/client/src/features/collaboration/CollaborationWorkspace.test.tsx`

Database/harness and evidence:

- `scripts/composite-template-effects-policy-db.test.mjs`
- `scripts/runtime-test-harness.test.mjs`
- `scripts/composite-template-instantiation-db.test.mjs`
- `scripts/composite-template-snapshot-db.test.mjs`
- `scripts/content-tree-consumers-db.test.mjs`
- `.superpowers/sdd/2026-09-05-composite-page-group-agent-collaboration/task-13a-report.md`

## Self-review and remaining boundaries

- Re-read the complete task 13a brief plus the effect and policy notes, then traced every concrete composite client opener and every composite controller mutation. The initially missed Collaboration Workspace upgrade/create opener was found in this self-review, added with RED/GREEN coverage, and included in the final full-client run.
- Rechecked all `new PageTemplateService(...)` and `CompositeTemplateCatalogService` compositions. Production DI is required and default-closed; unit/DB fixtures that need composite writes explicitly inject an enabled test policy. No optional/fail-open production constructor fallback was added.
- Rechecked the worker boundary: `WorkerModule` registers `TemplateEffectsService` directly with database, search, graph, and collaboration-event dependencies; it does not import `PageTemplateModule` or any HTTP controller. API role does not start the effect drain loop.
- Rechecked service bypasses: composite public and locked PageTemplate writes are gated, while legacy metadata/archive/restore inspect the current stored version and reject only composite definitions. Existing collaboration execution/review/conflict/resume and legacy collaboration template operations have no policy dependency.
- Rechecked queue fences and final-attempt recovery: all terminal/update paths include attempt and lock fences; expired attempt 8 is failed without dispatch; exceptions persist only stable codes; Page semantic partial and graph deferred reasons retry without reverting creation.
- `git diff --check` was clean before this final report update and is rerun immediately before commit.
- No schema migration, public schema write, Sync v3/attachment/Markdown-image-reference change, push, npm publish, production action, destructive rollback, or controller project-memory staging is included.
- Task 13b remains separate and incomplete here: real Chrome desktop/390px zh-CN/en scenarios, actual external Agent execution/wake behavior, the repository/full acceptance document and harness, final `test:full`, and any release/deployment evidence are not claimed by this report.

## Fix round 1 — semantic completion truth and Redis harness isolation

### Semantic-index completion RED

```text
pnpm --filter @agentwiki/server exec jest --runInBand \
  src/core/search/search.service.spec.ts \
  src/page-templates/template-effects.service.spec.ts

Exit 1. SearchService rejected the new two-argument contract with TS2554, and the
effect suite observed `indexPage("page-1")` rather than the required
`indexPage("page-1", { requireSemanticWrite: true })`. This proves an effect retry
could still use the unproven hash-plus-vector shortcut, and a CAS-zero vector write
was not exposed as incomplete.
```

### Redis harness isolation RED

```text
node --test scripts/e2e-safety.test.mjs

Exit 1. 22/24 passed and the two new entrypoint checks failed because
`composite-template-effects-policy-db.test.mjs` exited 0 both without an explicit
test Redis URL and with an unavailable loopback URL. The script therefore still
accepted its hard-coded 6379 fallback instead of failing before migrations/children.
```

### Authoritative Page-snapshot fence RED

```text
pnpm --filter @agentwiki/server exec jest --runInBand \
  src/core/search/search.service.spec.ts \
  -t 'guards the vector write against a concurrent newer index run'

Exit 1. The inspected vector-update SQL contained only the lexical-document content
hash fence; it did not contain Page title/content predicates or their captured
values. A Page edit that landed before another indexer updated the lexical document
could therefore still accept the old embedding.
```

### Semantic-index completion GREEN

```text
pnpm --filter @agentwiki/server exec jest --runInBand \
  src/core/search/search.service.spec.ts \
  src/page-templates/template-effects.service.spec.ts

Exit 0. 2/2 suites and 27/27 tests passed in 2.13s. A CAS-zero vector write now
returns `{ lexicalIndexed: true, semanticIndexed: false, superseded: true }`;
the SQL also fences the captured live Page title/content and deletion state. Effect
delivery calls `indexPage(pageId, { requireSemanticWrite: true })`, so its retry
cannot accept an old vector solely because the new lexical hash already exists.
```

### Redis harness isolation GREEN

```text
node --test scripts/e2e-safety.test.mjs

Exit 0. 24/24 tests passed in 1.49s. The effects-policy DB entrypoint now rejects
both missing and unavailable Redis targets before database migration or child API
startup. It accepts only an explicit `PAGE_TEMPLATE_TEST_REDIS_URL` or the full
runner's explicit `TEST_REDIS_URL`, validates loopback syntax and availability with
the shared safety helper, and passes that normalized exact URL to the API child.
```

- Fix round 1 server build: `pnpm --filter @agentwiki/server build`; exit 0 (`nest build`).
- First fix-round real DB/HTTP run: the feature-off continuation test passed, while the semantic concurrency fixture failed before exercising SearchService because its manual stale-vector setup used unqualified `::halfvec`; PostgreSQL random-schema search paths expose the extension type as `public.halfvec` (`42704: type "halfvec" does not exist`). The helper cleaned both random schemas and preserved the public inventory. Inspection also found the production index-write cast was unqualified, unlike the existing migration and pgvector DB fixtures; both the production write and controlled setup now use the schema-qualified extension type without changing database search paths or global state.
- Server rebuild after schema-qualifying the pgvector write: `pnpm --filter @agentwiki/server build`; exit 0 (`nest build`).
- Fix-round real PostgreSQL/HTTP GREEN: explicit PG `127.0.0.1:50415` and Redis `127.0.0.1:50416`, `node --test scripts/composite-template-effects-policy-db.test.mjs`; exit 0, 2/2 tests passed in 11.38s. The real SearchService sequence started with an old stored vector, paused the old-content embedding, committed newer Page title/content, let the newer lexical index fail its isolated fake embedding, then released the old writer. The old vector CAS returned zero/`superseded`; the forced retry bypassed the new-hash/old-vector shortcut and wrote the current embedding. The separate default-closed API process again denied creation and completed the existing Run through MCP claim/submit and human Page publication. Both random schemas reported the unchanged protected-public digest `887e5d38ed14a3945866940b88cb74236e4f56f7636235f53d289095ba0ef73b` and were cleaned.
- Final fix-round focused regression: server Search/effects/AppModule/WorkerModule 4/4 suites and 29/29 tests passed in 4.36s; `scripts/e2e-safety.test.mjs` passed 24/24 in 1.57s.
- Fix-round server typecheck: `pnpm --filter @agentwiki/server typecheck`; exit 0, no diagnostics.
- Fix-round server lint: `pnpm --filter @agentwiki/server lint`; exit 0, no ESLint findings.
- Final fix-round server build: `pnpm --filter @agentwiki/server build`; exit 0 (`nest build`).

### Fix round 1 files and self-review

- Changed `apps/server/src/core/search/search.service.ts` and `.spec.ts`, `apps/server/src/page-templates/template-effects.service.ts` and `.spec.ts`, `scripts/composite-template-effects-policy-db.test.mjs`, `scripts/e2e-safety.test.mjs`, and this report.
- Replayed both review findings against the final diff. A live effect can complete semantic indexing only after a current Page snapshot wins the vector CAS; CAS-zero and provider failure remain retryable. The effect-specific forced write is the smallest safe bypass of the legacy cache optimization and ordinary index callers retain that optimization.
- The real concurrency test covers both distinct races: Page content changes before the old vector write, and a newer lexical document coexists with an old vector after its embedding fails. The first is rejected by authoritative Page title/content/deletion predicates; the second cannot short-circuit the forced retry.
- Redis selection has no default endpoint. The page-specific variable takes precedence over the full runner's explicit shared variable, both paths pass through the same loopback/URL/database validation and availability probe, and the normalized selected URL is the only value given to the API child.
- The `public.halfvec` qualification matches the existing migration/test contract and avoids mutating random-schema or global search paths. No schema, Sync, attachment, Markdown-resource, client, authorization, rollout, or Task 13b behavior changed in this fix round.
- Final explicit-work-tree unstaged and staged `git diff --check` commands both exited 0; the seven staged fix/report paths contain no `.codex-memory` entry.
