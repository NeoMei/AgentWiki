# Page template library local acceptance

Date: 2026-08-26 (Asia/Shanghai)

## 2026-08-26 repeated comprehensive audit and final acceptance

- Current state: local `master@03690b93e42ac9d7b053fad57b6efe79fd63f0d3`, with `origin/master@62ba721f74660e61a3fd431dc95b7e351ca2a902` (ahead 40, behind 0). The former `codex/page-template-library` branch no longer exists. The fixes documented in this section remain uncommitted in the local worktree.
- Three independent first-round reviews covered task/design completion, backend concurrency and authorization, and frontend recovery/UI behavior. After de-duplicating the shared conflict finding, they found no Critical issue, three Important defects, and three Minor defects. The fixes addressed add-member revocation/Space-delete races, bounded `skip`, in-place version-conflict reload while preserving edits, zero-progress pagination, retryable settings/source-page loads with contextual error copy, and stale branch/acceptance records.
- Fresh real-browser testing then exposed a seventh defect: concurrent graph-settings state initialization could raise Prisma P2002 and surface HTTP 409. The service now accepts only a genuine P2002 winner race, re-reads the winning row, and rethrows unrelated failures. A new RED/GREEN regression test covers it.
- A subsequent fresh review found two additional Minor defects. A retry after source-page page 2 failed restarted at offset 0 instead of retrying the failed offset, and the runtime catalog adapter accepted negative/fractional pagination or version zero. The client now retains the attempted offset, and the adapter rejects non-integer/out-of-range metadata; RED/GREEN tests cover both fixes. This brings the repeated-audit total to nine fixed issue classes.
- Repeated post-fix task, code-path, diff, and runtime reviews found no remaining actionable Critical, Important, or Minor issue in the requested scope. The implementation plan has no unchecked task.
- Fresh complete repository gate: runtime 104 passed / 51 skipped; server 1,213 passed / 4 skipped; client 732/732; sync-protocol 42/42; local-sync 748/748. `pnpm typecheck`, `pnpm lint`, and `pnpm build` exited 0. The build retained only the pre-existing non-blocking Vite chunk-size warning.
- A completely fresh disposable PostgreSQL 16/Redis/API/Vite stack applied all 43 migrations. The dedicated page-template database gate passed 2/2, including U+20000 Prisma persistence/readback; all `page_template_test_%` schemas were removed.
- Real Chrome passed 10/10 serial scenarios: immutable versioning, a real metadata conflict followed by in-place reload/retry with form preservation, settings/source-page 500 fault injection followed by in-place retry, a failed `skip=100` source page retried at the same offset, role boundaries, bilingual built-ins, blank provenance, source-page API behavior, and 390px/focus interaction. Intentional 409/500 probes were counted and consumed exactly once; any unexpected or unconsumed console error/warning remained fatal.
- The concurrency gate ran 20 rounds containing 40 template pairs, 40 Space pairs, 80 member-operation pairs, and 160 total explicitly ordered pairs. Every expected status ordering passed; SQL found no provenance/version orphan, active test fixture, or advisory-lock waiter.
- Cleanup succeeded: the disposable database/schema and fixtures were removed, PostgreSQL/Redis/API/Vite stopped, and ports 3000, 5173, 57033, and 57034 were free. Final evidence bundle: `/Users/neomei/.Trash/agentwiki-cdcf52c-candidate.FTXzXh-1787706478`.
- This acceptance record was completed before release authorization. The user authorized GitHub and production release afterward on 2026-08-26; package directories and versions are unchanged, so npm publication is not part of this release.

## Historical 2026-08-26 candidate convergence audit

- Final code candidate: `cdcf52cc010db979fcbeb138f32c33da64d3a24f` on `codex/page-template-library`.
- Four whole-branch review rounds converged after fixes `5721954`, `eb0c138`, `1ff5aae`, and `cdcf52c`. The fourth independent review reported 0 Critical, 0 Important, and 0 Minor actionable findings.
- The final code candidate passed the complete repository test command: runtime 104 passed / 51 skipped; server 1,208 passed / 4 skipped; client 708/708; sync-protocol 42/42; local-sync 748/748. `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `git diff --check origin/master..HEAD` also exited 0. The build retained only the existing non-blocking Vite chunk-size warning.
- A final fresh disposable stack applied all 43 migrations. The dedicated database gate passed 2/2 with 0 failures or skips, including a real Prisma persist/readback for U+20000. Its random schema was dropped and the final `page_template_test_%` residual count was 0.
- Real Chrome passed all 8 scenarios with 0 failures or skips. Every scenario asserted an empty console error-and-warning collection. The version-source picker called the lightweight `source-pages` endpoint successfully (HTTP 200), and desktop plus 390px geometry and focus checks passed.
- The final concurrency gate ran 20 rounds: 40 template pairs plus 40 Space pairs, for 80 explicitly ordered concurrent pairs. All passed. Archive-first rejected creation with `PAGE_TEMPLATE_ARCHIVED`; create-first created before archive; delete-first prevented transfer; transfer-first prevented the old owner from deleting. SQL found 0 provenance or template-version orphans and 0 advisory-lock waiters.
- Cleanup succeeded: test Spaces and users were inactive, the API schema was dropped, PostgreSQL/Redis/API/Vite stopped, and ports 3000, 5173, 57733, and 57734 were free.
- Final dynamic evidence bundle: `/Users/neomei/.Trash/agentwiki-cdcf52c-candidate.8Eq2bU-1787692547`.

Two discarded disposable attempts hit the isolated Redis global 300/min test limit after cumulative browser/probe/concurrency traffic. This was diagnosed as test orchestration state, not a product locking failure. The passing run reset only the one-use Redis `rate:*` test buckets at phase boundaries and after round 10; it did not alter product rate limiting.

## Accepted local candidate

- Branch: `codex/page-template-library`.
- Reviewed range: `origin/master` at `62ba721f74660e61a3fd431dc95b7e351ca2a902` through the local candidate.
- Final review-fix commits before this record: `1ce9b135ef5832c00bf44d470dd0778eede77d76`, `e7984e0`, and `2c5cd61` (each `fix(page-templates): address final review findings`).
- `git diff --stat origin/master...HEAD` before this record contained 67 files, 12,433 insertions, and 145 deletions. `git diff --check` exited 0.
- The earlier candidate range was reviewed for cross-Space access, client-trusted Markdown, Agent fallback, archived reuse, optimistic predicates, nullable provenance, list bounds, stale asynchronous work, editor dirty state, bilingual copy, and 390px layout. A subsequent final review identified 3 Important and 6 Minor findings; this remediation addresses all nine rather than preserving the earlier “none unresolved” conclusion.

The final review commits added a serialized SHA-256 lock and edge coverage for the complete bilingual system catalog, narrowed seed retries to real Prisma known-request errors, corrected Task 8 evidence wording, and added a deferred cross-Space mutation regression. The PageEditor More trigger's localized accessible name was already covered by Task 12. Independent review reported no Critical, one Important, and three Minor findings. The Important stale create-completion navigation and the actionable archived-metadata and long-name overflow Minors were reproduced and fixed through TDD.

## 2026-08-26 final-review remediation

- Corrected the Human Admin contract end to end: `SpaceView` now exposes the same new-page entry already authorized by the shared editor-level `pages:write` gate, the unit role matrix requires it, and the real E2E source now includes an authenticated Admin create/manage path.
- Kept list metadata available to Viewer but restricted the detail route containing `content` and `sourcePageId` to Owner/Admin/Editor. Server service/controller tests assert Viewer receives HTTP 403 before any template/version query, including a snapshot whose source page was soft-deleted.
- Added a stable manager search fallback target. Metadata/version dialogs pass `fallbackFocusRef`; archive/restore explicitly restore focus after their trigger is removed. Unit assertions use `toHaveFocus`, while Playwright acceptance uses `toBeFocused()` for all four success paths.
- Added a synchronous archive/restore ref lock plus pending disabled state, 200/201 Unicode default-title coverage, visible localized Selected state, localized System/Space labels, and action-specific bilingual unknown-error fallbacks.
- `PageTemplateSummary` is now a scope-discriminated union (`system => sourceLocale: null`, `space => sourceLocale: locale`); catalog adapters reject malformed runtime pairs and fixtures match the wire contract.
- The previous disposable browser result remains 7/7 evidence for the earlier candidate. A fresh disposable stack at `2878e59` subsequently executed the expanded suite 8/8, including the new Human Admin and four focus-restoration assertions.

Fresh focused verification for this remediation:

| Command | Observed result |
| --- | --- |
| `node --test scripts/page-template-schema.test.mjs` | 8 passed, 0 failed |
| focused page-template/authorization/page Jest gate | 7 suites, 196 passed, 0 failed |
| focused page-template/Space/PageEditor Vitest gate | 10 files, 235 passed, 0 failed |
| `playwright test e2e/page-templates.spec.ts` | 8 scenarios passed in real Chrome, including Human Admin and four manager focus-restoration paths; 13.9 s Playwright / 14.42 s wall |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `git diff --check` | exit 0 |

## Focused gates

All commands below were freshly invoked from `agentwiki` at the candidate above.

| Command | Observed result | Wall time |
| --- | --- | --- |
| `node --test scripts/page-template-schema.test.mjs` | 8 passed, 0 failed, 0 skipped | 0.06 s (Node 40.9 ms) |
| `pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates src/core/dto/page-template-create.validator.spec.ts src/core/dto/page.dto.spec.ts src/core/page/page.service.spec.ts src/review/agent-write-boundary.spec.ts` | 8 suites passed; 203 tests passed, 0 skipped | 2.15 s (Jest 1.79 s) |
| `pnpm --filter @agentwiki/client test -- src/features/page-templates src/features/space/SpaceSettings.spec.tsx src/features/page/PageEditor.spec.tsx src/App.spec.tsx src/components/ModalDialog.test.tsx` | the package script ran the complete client set: 66 files and 652 tests passed, 0 skipped | 20.90 s (Vitest 19.93 s) |

## Isolated PostgreSQL gate

The final successful gate used a newly initialized Homebrew PostgreSQL 16.14 cluster on loopback port 59501 and a dedicated database URL supplied only through `PAGE_TEMPLATE_TEST_DATABASE_URL`. It did not connect to an existing or remote database and did not target `public`.

```text
pnpm test:e2e:page-template-db
2 passed, 0 failed, 0 skipped
Node duration: 3978.943333 ms
wall time: 4.21 s
```

The harness generated the exact schema `page_template_test_0430b861a8f2475abbd36f9e6cf130ba`. PostgreSQL statement logging recorded its `CREATE SCHEMA` and the awaited `DROP SCHEMA ... CASCADE`; a post-gate `pg_namespace` query returned zero `page_template_test_%` schemas. The gate exercised migration checks, scope/provenance constraints, immutable version rows, compound template-version references, and concurrent version creation without an orphan.

The first disposable attempt failed before schema creation because its orchestration URL omitted the local PostgreSQL role. A completely new cluster with the explicit `neomei` role produced the passing result above. This was an environment-command defect, not a product failure.

## Real browser gate

The final browser gate ran at `2878e59e04273589f58aef271ef2077b4f9b897f` on a new disposable stack: PostgreSQL at `127.0.0.1:59611` with database `agentwiki_page_template_task13_admin_e2e` and schema `page_template_e2e_2878e59_59611`, Redis at `127.0.0.1:59612`, API at 3000, and Vite at 5173. Health reported `status`, `database`, `redis`, and `auditPersistence` all `ok`.

```text
pnpm --filter @agentwiki/client exec playwright test e2e/page-templates.spec.ts
8 passed, 0 failed, 0 skipped; 1 worker
Playwright duration: 13.9 s
wall time: 14.42 s
```

The executed scenarios covered Owner save/use and immutable versioning; archive/restore; Editor use without management; Viewer without create; Human Admin create and management access; Chinese/English system Markdown; blank child provenance; and the 390 x 844 layout/focus path. Metadata save, version creation, archive, and restore each returned focus to the template search field. The two scenarios that installed console-error collectors observed zero errors; the other six did not claim a console count.

`afterAll` asserted successful DELETE responses for the Space and all four users. SQL confirmed zero active matching Spaces and users after soft deletion. API logs recorded one Space and four user deletions. Ports 3000, 5173, 59611, and 59612 were released, and the evidence bundle was moved to `/Users/neomei/.Trash/agentwiki-task13-admin-e2e.xiaraU-1787681200`.

### Earlier 7/7 browser evidence

The real browser run used the fresh cluster above, a new Redis 8.8 instance on loopback port 59502, the local API on 3000, and Vite on 5173. All four health fields were `ok` before Playwright. The API database received all 43 migrations.

```text
pnpm --filter @agentwiki/client exec playwright test e2e/page-templates.spec.ts
7 passed, 0 failed, 0 skipped; 1 worker
Playwright duration: 13.1 s
wall time: 13.73 s
```

Observed scenarios:

1. Owner saved Markdown as a Space template and created a page from version 1.
2. Updating the source and creating version 2 left the version-1 page unchanged; stored provenance reported versions 1 and 2 against the same template.
3. Owner archived and restored the Space template.
4. Editor could use but not manage the template; Viewer had no new-page action.
5. Chinese and English system templates created locale-specific Markdown.
6. Blank child creation preserved its parent and stored all three template provenance fields as null.
7. At 390 x 844, NewPageDialog, PageTemplateManager, an 80-character unbroken template name in its card/metadata dialog, and the PageEditor More menu remained inside the viewport and restored focus.

Console-error collectors in scenarios 1 and 7 each observed 0 errors. The other scenarios did not install a console collector, so no broader console count is claimed.

Screenshots from the passing run were moved with the disposable evidence to Trash:

- `/Users/neomei/.Trash/agentwiki-task13-final4.CO5j8h-1787679963/tmp/agentwiki-page-template-qa/1787679948956-37e488c1febf2/custom-template-created.png`
- `/Users/neomei/.Trash/agentwiki-task13-final4.CO5j8h-1787679963/tmp/agentwiki-page-template-qa/1787679948956-37e488c1febf2/new-page-dialog-mobile.png`
- `/Users/neomei/.Trash/agentwiki-task13-final4.CO5j8h-1787679963/tmp/agentwiki-page-template-qa/1787679948956-37e488c1febf2/template-manager-mobile.png`
- `/Users/neomei/.Trash/agentwiki-task13-final4.CO5j8h-1787679963/tmp/agentwiki-page-template-qa/1787679948956-37e488c1febf2/page-editor-more-mobile.png`

The earlier suite's `afterAll` assertion confirmed successful cleanup HTTP responses for the Space and three users. Those endpoints soft-delete records; therefore physical row counts remain by design. The API, Vite, Redis, and PostgreSQL processes were stopped, ports 3000, 5173, 59501, and 59502 were free, and the complete disposable directory was moved to Trash.

The first long-name browser run reproduced horizontal overflow (`scrollWidth` 763 at a 390px viewport). Adding `overflow-wrap:anywhere` alone did not change flex min-content sizing and reproduced the same failure on a second new stack. The minimal final fix added deterministic `word-break: break-all` and a full-width mobile action container; the completely new final stack then passed 7/7. Both failed stacks were stopped, port-checked, and moved to Trash before the final run.

## Full repository gates

| Command | Observed result | Wall time |
| --- | --- | --- |
| `pnpm test:runtime` | 155 tests: 104 passed, 51 skipped, 0 failed; 2 suites | 6.01 s |
| `pnpm --filter @agentwiki/server test` | 90 suites: 88 passed, 2 skipped; 1,190 tests: 1,186 passed, 4 skipped, 0 failed | 14.92 s |
| `pnpm --filter @agentwiki/client test` | 66 files and 674 tests passed, 0 skipped | 9.68 s |
| `pnpm typecheck` | exit 0 | not recorded separately |
| `pnpm lint` | exit 0 | not recorded separately |
| `pnpm build` | exit 0 | not recorded separately |

The production build emitted the existing non-blocking Vite warning for chunks over 500 kB; every workspace build completed.

## Permission and integrity observations

- Catalog use: Owner, Human Admin, and Editor can create pages; Viewer cannot. Platform Super Admin retains its existing bypass, and Agent roles are not broadened.
- Space template management: Owner/Admin capabilities are returned by the server; Editor can list/use but has no management actions; Viewer cannot create a page.
- The server, not the client, resolves trusted Markdown by exact template ID/version/locale and rechecks Space access and archive state.
- Space-template mutations use optimistic timestamps/current-version predicates. Cross-Space IDs and stale operations fail without updating another Space's catalog.
- A create request started in Space A may still finish server-side after the user changes route, but its unmounted session cannot navigate or write success/error/loading state into Space B.
- Archived templates reject metadata updates before duplicate-name lookup or writes; the metadata compare-and-swap also requires `archivedAt: null`.
- Template version content/identity rows are immutable. Version 2 creation does not rewrite version 1 or pages already created from it.
- Blank page creation has an all-null provenance tuple. Template-backed creation stores the complete template ID/version/locale tuple.
- Agent-created pages do not accept template provenance fallback into an empty ChangeSet.

## Remaining risks and release boundary

- The existing Vite chunk-size warning remains a performance follow-up, not a correctness failure.
- This is local acceptance only. No GitHub push, npm publish, production migration, or deployment was authorized or performed.
- Live `origin/master` remained `62ba721f74660e61a3fd431dc95b7e351ca2a902`; the local branch is 40 commits ahead and 0 behind after the final evidence-only documentation commit.
- Workspace package versions remain root/server/client/local-sync `0.6.1` and sync-protocol `0.3.0`. Public npm `latest` remained Local Sync `0.6.1` and Sync Protocol `0.3.0`; the package diff contains no version change.
- A read-only public check returned HTTP 200 with all health fields `ok`. `GET /api/spaces/task13-readonly-probe/page-templates?locale=en` returned the route-not-installed 404, consistent with this feature not being deployed.
