# Page template library local acceptance

Date: 2026-08-26 (Asia/Shanghai)

## Accepted local candidate

- Branch: `codex/page-template-library`.
- Reviewed range: `origin/master` at `62ba721f74660e61a3fd431dc95b7e351ca2a902` through the local candidate.
- Final review-fix commits before this record: `1ce9b135ef5832c00bf44d470dd0778eede77d76`, `e7984e0`, and `2c5cd61` (each `fix(page-templates): address final review findings`).
- `git diff --stat origin/master...HEAD` before this record contained 67 files, 12,433 insertions, and 145 deletions. `git diff --check` exited 0.
- The whole range was reviewed for cross-Space access, client-trusted Markdown, Agent fallback, archived reuse, optimistic predicates, nullable provenance, list bounds, stale asynchronous work, editor dirty state, bilingual copy, and 390px layout. No unresolved Important finding remained.

The final review commits added a serialized SHA-256 lock and edge coverage for the complete bilingual system catalog, narrowed seed retries to real Prisma known-request errors, corrected Task 8 evidence wording, and added a deferred cross-Space mutation regression. The PageEditor More trigger's localized accessible name was already covered by Task 12. Independent review reported no Critical, one Important, and three Minor findings. The Important stale create-completion navigation and the actionable archived-metadata and long-name overflow Minors were reproduced and fixed through TDD. The generic mutation fallback copy remains the one deferred Minor risk described below.

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

The suite's `afterAll` assertion confirmed successful cleanup HTTP responses for the Space and three users. Those endpoints soft-delete records; therefore physical row counts remain by design. The API, Vite, Redis, and PostgreSQL processes were stopped, ports 3000, 5173, 59501, and 59502 were free, and the complete disposable directory was moved to Trash.

The first long-name browser run reproduced horizontal overflow (`scrollWidth` 763 at a 390px viewport). Adding `overflow-wrap:anywhere` alone did not change flex min-content sizing and reproduced the same failure on a second new stack. The minimal final fix added deterministic `word-break: break-all` and a full-width mobile action container; the completely new final stack then passed 7/7. Both failed stacks were stopped, port-checked, and moved to Trash before the final run.

## Full repository gates

| Command | Observed result | Wall time |
| --- | --- | --- |
| `pnpm test:runtime` | 155 tests: 104 passed, 51 skipped, 0 failed; 2 suites | 5.19 s |
| `pnpm --filter @agentwiki/server test` | 90 suites: 88 passed, 2 skipped; 1,188 tests: 1,184 passed, 4 skipped, 0 failed | 12.48 s |
| `pnpm --filter @agentwiki/client test` | 66 files and 652 tests passed, 0 skipped | 15.67 s |
| `pnpm typecheck` | exit 0 | 13.28 s |
| `pnpm lint` | exit 0 | 4.51 s |
| `pnpm build` | exit 0 | 21.09 s |

The production build emitted the existing non-blocking Vite warning for chunks over 500 kB; every workspace build completed.

## Permission and integrity observations

- Catalog use: Owner and Editor can create pages; Viewer cannot. Human Admin remains outside the existing page-write role set, while platform Super Admin retains its existing bypass.
- Space template management: Owner/Admin capabilities are returned by the server; Editor can list/use but has no management actions; Viewer cannot create a page.
- The server, not the client, resolves trusted Markdown by exact template ID/version/locale and rechecks Space access and archive state.
- Space-template mutations use optimistic timestamps/current-version predicates. Cross-Space IDs and stale operations fail without updating another Space's catalog.
- A create request started in Space A may still finish server-side after the user changes route, but its unmounted session cannot navigate or write success/error/loading state into Space B.
- Archived templates reject metadata updates before duplicate-name lookup or writes; the metadata compare-and-swap also requires `archivedAt: null`.
- Template version content/identity rows are immutable. Version 2 creation does not rewrite version 1 or pages already created from it.
- Blank page creation has an all-null provenance tuple. Template-backed creation stores the complete template ID/version/locale tuple.
- Agent-created pages do not accept template provenance fallback into an empty ChangeSet.

## Remaining risks and release boundary

- Unknown server mutation codes currently use the generic localized create-failure fallback in several manager actions. Choosing more specific product copy is deferred because it would introduce new UX wording beyond this low-risk final pass.
- The existing Vite chunk-size warning remains a performance follow-up, not a correctness failure.
- This is local acceptance only. No GitHub push, npm publish, production migration, or deployment was authorized or performed.
- Live `origin/master` remained `62ba721f74660e61a3fd431dc95b7e351ca2a902`; the local branch was 32 commits ahead and 0 behind before this evidence commit.
- Workspace package versions remain root/server/client/local-sync `0.6.1` and sync-protocol `0.3.0`. Public npm `latest` remained Local Sync `0.6.1` and Sync Protocol `0.3.0`; the package diff contains no version change.
- A read-only public check returned HTTP 200 with all health fields `ok`. `GET /api/spaces/task13-readonly-probe/page-templates?locale=en` returned the route-not-installed 404, consistent with this feature not being deployed.
