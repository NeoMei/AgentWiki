# Composite template final-review corrections

Scope: one consolidated correction wave after implementation baseline `f4432eae1917b191657c16f319f02763d0b41878`. No merge, deployment, production changes, Sync v3 wire changes, or fresh paid-model execution.

## Contracts corrected

- New Page approval validates the actual `Link -> Artifact -> Attempt -> Agent`, its live owner, editor-or-higher Space Grant and usable credential inside the publishing transaction. A replacement assignee/default binding cannot supply this authority. Denial preserves the pending candidate and unpublished Page.
- Completed adopt-current retries resolve stable Run/task and live human access, then return the exact actor/operation/task/key/hash receipt before mutable pending Review/Artifact/Link checks. Lost post-commit notifications do not destroy retryability; changed bodies remain conflicts.
- Newly captured source trees use the authoritative content-tree ordering: folders first, then within each kind sortOrder, createdAt and ID. Definitions save deterministic sibling ranks; historical versions are unchanged.
- Duty payloads always derive from retained Pages, including after ancestor pruning, editing and refresh. Excluded drafts remain local for re-inclusion. Empty duties explicitly map to null to remove inferred defaults. Ordinary reference Pages are valid and create no tasks/participants.
- The composite definition 5 MiB budget counts string values, not JSON property names. System single-page date/year/week title interpolation works with both catalogs. Management follows actual definition versus legacy-content storage, including JSON-backed single Pages.

## Authority lock and retry order

Page approval locks reviewer and submitting Agent owner User rows in sorted-ID order, then uses the existing authorization helper's Owner -> Agent -> Grant -> Credential -> content-tree Space advisory -> Space prefix, followed by the existing Run event lock. This is compatible with actual `AgentService.revoke` (Owner -> Agent -> Credentials/Agent mutation) and grant mutations (Owner -> Agent -> Grant -> Space). Direct credential mutations conflict with the credential row lock. Non-Page review behavior is unchanged.

Attempts do not persist credential identity. Approval requires a currently usable credential of the submitting Agent and its live Space Grant, not an unrelated assignee's credential. Existing successful approval receipts replay before fresh Agent publication authorization; live human access remains checked.

The real two-client DB concurrency regression observes `pg_blocking_pids`, not just elapsed time: revoke-first holds the shared authority prefix, commits, then approval rejects; approve-first holds all publication authority, commits the Page, then revocation proceeds. Both outcomes have explicit persisted Page/Review assertions.

## Focused verification

Original behavioral RED was observed for authority loss, completed-adoption replay, duplicate-order expansion, duty pruning/null handling, byte boundary, title interpolation and JSON single-page management. Subsequent focused evidence:

- Page publication/conflict DB: 6 passed, no skips; actual revoke/approve concurrency: 1 passed, no skips.
- Source snapshot/real instantiation DB: 4 passed, no skips. Eleven duplicate-order Pages with reversed lexical IDs and different creation times plus a mixed Folder compare source -> saved definition -> real instance against an independently enumerated expected sequence.
- Mixed-duty DB fixture retains two Pages, including one with an existing default binding explicitly cleared, and creates exactly one task and one Agent participant.
- Final focused server snapshot/catalog: 28 passed; browser proof helpers: 22 passed with relationship/error negatives retained; final duty/manager client suite: 27 passed, including exact English/Chinese optional-duty help.
- Protocol byte-boundary suite: 6 passed, including exact 5 MiB ASCII/multibyte values and one-byte-over rejection. Broader focused server/client suites also passed before the final copy assertions.

All real DB checks use random schemas in task-owned PostgreSQL at `127.0.0.1:50415/agentwiki_composite_test`, Redis at `127.0.0.1:50416/0`; no shared public migrations or cleanup.

## Final browser and repository gates

Final Chrome replay `/tmp/agentwiki-final-fix-chrome4.log` exited 0 with `ACCEPTANCE_PARTIAL` and `CLEANED`: six journeys, three exact expected HTTP conflicts, three correctly attributed console entries, zero unknown console entries and zero Page errors. All context Pages remain observed (two primary, one feature-off). Saved-folder persistence proves four retained Pages, one role and seven real instantiated nodes. JSON single-page metadata edit, v2 content and archive are database-verified after real UI actions; the system default title is `日报 2026-09-06`.

Screenshot `15-folder-source-change-recovered.png` was visually checked on the final code: optional duties, explicit clear semantics and short no-responsibility controls agree. Untouched blank drafts still preserve the existing default-inference model; only an explicit clear/no-responsibility action sends null.

An intermediate Chrome2 run exposed an existing event-order race: all three HTTP and console conflicts existed in the trace, but response headers finished the action before delayed console events. The final barrier waits for the exact Page/full-URL console event and response, with a 15-second limit. No counts or unknown-error checks were relaxed. The focused response-before-console/incorrect-URL regression passes in the 23-test browser-proof suite; Chrome3 and final Chrome4 both pass the original strict 3/3 gate.

Final browser public inventory digest remains `887e5d38ed14a3945866940b88cb74236e4f56f7636235f53d289095ba0ef73b`; its random schema and processes were cleaned. Artifacts are retained at `/tmp/agentwiki-final-fix-chrome4`.

Final sequential `pnpm typecheck && pnpm lint && pnpm build && pnpm test:full` exited 0. All six DB aliases (`DATABASE_URL`, `FOLDER_TEST_DATABASE_URL`, `MARKDOWN_TEST_DATABASE_URL`, `COLLABORATION_TEST_DATABASE_URL`, `PAGE_TEMPLATE_TEST_DATABASE_URL`, `SYNC_V3_TEST_DATABASE_URL`) explicitly used the dedicated PostgreSQL URL, with dedicated `TEST_REDIS_URL` and PG16 dump/psql paths. Logs: `/tmp/agentwiki-final-fix-{typecheck,lint,build,full}.log`.

| Phase | Passed | Skipped |
| --- | ---: | ---: |
| Runtime | 235 | 1 |
| Isolated database | 167 | 0 |
| Server (140 suites) | 2233 | 1 |
| Client (92 files) | 1246 | 0 |
| Sync protocol (10 files) | 103 | 0 |
| Local sync (61 files) | 877 | 1 |
| Total | 4861 | 3 |

The skips are the opt-in independently installed CodeGraph acceptance, Windows-only bundled OpenCode launch, and Windows-only ACL claim test. No DB test skipped. Build retains the existing Vite large-chunk warning; server log exceptions are passing negative-case assertions (upload size, injected audit failure, permission/protocol/CAS rejection), not failed tests.

After the final suite: zero public tables, zero non-system random test schemas, zero other connections in the dedicated database; final browser ports 63500/63501 have no listeners and no acceptance/repository-test child remains. Task PostgreSQL/Redis containers are intentionally retained. Whole-branch `git diff --check 711cae77277af1f79c6f4c16f998dbc66f6e2dae` passes.

Earlier external Codex/OpenCode acceptance evidence remains historical and separate; UI-only `ACCEPTANCE_PARTIAL` must not be promoted to fresh external-Agent acceptance. Independent scoped final review belongs to the controller after this fix commit; merge/push/release remain unperformed.
