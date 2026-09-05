# Composite page-group template acceptance

Date: 2026-09-06
Branch: `codex/composite-page-group-agent-collaboration`
Task 13b2 base: `3375334e159050c9684b9d82f7ceba5232224388`

## Acceptance boundary

This is local, isolated acceptance for composite Page-group templates and their collaboration workflows. It does not record a release, deployment, package publication, production migration, or mutation of a real user Space. Browser evidence uses repository Playwright 1.61.1 with installed Google Chrome because the named Browser plugin was unavailable.

Every browser run uses one random `mac_e2e_*` schema in the dedicated loopback PostgreSQL database at `127.0.0.1:50415`, Redis at `127.0.0.1:50416`, and a fixture-only Space allowlist. API/worker background LLM configuration is forced offline. Screenshots, traces, and credentials stay outside the repository; exact schemas and child processes are removed before exit.

## Current browser acceptance

The current-code UI-only command is:

```sh
COMPOSITE_TEMPLATE_E2E_DATABASE_URL='postgresql://postgres@127.0.0.1:50415/agentwiki_composite_test' \
COMPOSITE_TEMPLATE_E2E_REDIS_URL='redis://127.0.0.1:50416/0' \
PG_DUMP_BIN='/opt/homebrew/opt/postgresql@16/bin/pg_dump' \
COMPOSITE_TEMPLATE_E2E_ARTIFACTS_DIR='/tmp/agentwiki-task13b2-compat12' \
COMPOSITE_TEMPLATE_E2E_EXTERNAL_STAGES='none' \
node scripts/composite-template-e2e.mjs run
```

Result: exit 0, six of six browser journeys passed, zero unexpected console issues, and cleanup completed. The command intentionally prints `ACCEPTANCE_PARTIAL`: `none` disables external model stages so selector iteration cannot manufacture same-run external-client completion.

| Journey | Real UI action | Authoritative result | Evidence |
| --- | --- | --- | --- |
| Collaboration off | Pages entry selected the project template, previewed the nested tree, created and opened the group, then edited a Page | 11-node tree, seven Pages, zero Runs, zero Page bindings, one tree-revision advance, persisted edit | `01`–`04`, trace |
| Collaboration on | Pages entry configured inputs, roles and enabled tasks, then created the group and Run | seven tasks, two deduplicated participants, frozen role/task assignments; separate group and Run destinations | `05`–`06`, trace |
| Historical Page binding | Page editor saved a durable binding, started a single-Page Run, replaced and unbound the owner | active assignee remained frozen; four immutable binding events; no AgentGrant mutation; outside bound Agent absent from participants/instructions | `13`, `14`, trace |
| Saved Folder template | Folder UI pruned a Folder descendant and one Page, abstracted roles, encountered an exact source-body conflict, refreshed and saved, then instantiated elsewhere | exact nested parent/relative-order tree and Markdown matched real Folder/Page rows; seven retained nodes, four Pages, four abstract roles; no concrete Agent IDs | `15`, `16`, trace |
| Concurrent Page conflict | Browser edited the current Page and attempted approval twice; UI chose regenerate and adopt-current | two exact `409 PAGE_VERSION_CONFLICT` responses; paused/pending/no-overwrite; generation 2 rebased; both stale candidates superseded; adopted PageVersion equals the human Page | `17`–`19`, trace |
| Compatibility and feature off | Old Page create/edit, Collaboration-entry creation, Folder subset binding/start, legacy Run start/cancel/history, fresh-off API/UI, fixture-protocol submit and browser approval | group action opened first Page while Run destination remained separate; six of seven Pages bound and five tasks selected; outside binding/audit unchanged; legacy history retained; new composite write exact 409; existing composite readable; historical `page_selection` Run completed with exact PageVersion and no count deletion | `20`–`25`, both traces |

The saved-Folder fixture has no supported attachment relation, so this run truthfully records `attachmentWarning=false`; it does not claim attachment-warning acknowledgement coverage. Attachment models, resource paths, Sync v3, and Markdown image semantics were not changed.

## Viewport, locale, keyboard, and error matrix

- Desktop: 1440x900, zh-CN, all six journeys, page title `AgentWiki`, nonblank DOM, no framework overlay, no unexpected console warnings/errors.
- Mobile: 390x844, English, keyboard-opened template dialog; Escape returned focus; keyboard selected `Project management workspace`; the nested preview tree rendered; Space enabled collaboration; Enter reached configuration; three roles, seven task checkboxes, retained Project brief/roles/tasks after refresh, one deduplicated participant, and natural Escape after async refresh returned focus to the opener.
- Horizontal overflow: both document and dialog-local width/bounds checks passed at selection, preview, and configuration.
- Expected browser resource errors are classified only when correlated to one exact Folder `POST .../templates/from-folder -> 409 SOURCE_CHANGED` or either exact review-decision `POST -> 409 PAGE_VERSION_CONFLICT`. Extra 409s, another URL/domain code, and 500s remain failures.
- Current mobile evidence: `/tmp/agentwiki-task13b2-compat12/26-mobile-en-select.png`, `27-mobile-en-preview.png`, and `28-mobile-en-configured.png`.
- Current feature-off publication evidence: `/tmp/agentwiki-task13b2-compat12/25-feature-off-existing-run-published.png`; Completed, Approved, the accepted artifact, and localized existing-group creation event are visible without fixed-navigation overlap.

## External Agent evidence provenance

External-client execution is preserved from reviewed Task 13b1 evidence and is deliberately not replayed for Task 13b2 UI work:

- Codex used one fixture Run for its actual initial stage plus explicit post-review resume. Saved receipts are `/tmp/agentwiki-task13b-evidence-real4/codex-codex-initial-receipt.jsonl` and `codex-codex-resume-after-review-1-receipt.jsonl`.
- OpenCode used a separate fresh fixture Run, not the Codex Run. Its saved receipt is `/tmp/agentwiki-task13b-evidence-opencode3/opencode-opencode-initial-receipt.jsonl`; its actual Chrome publication evidence remains in that artifact directory.
- Each saved receipt was reparsed by the current support code as exactly six requested calls matched one-to-one with six successful calls: join, next action, Todo doing/done, submit, and final `waiting_human`.
- Persisted Artifact, ChangeSet, Approval and before/after PageVersion evidence was recorded for both client fixtures. A human browser, never an Agent, performed approval.
- Claude returned HTTP 401 and OAuth fallback did not establish access. Those attempts are failure history, not a passing third client and not an account/configuration change.

The Codex and OpenCode results therefore prove two actual client types across distinct fresh fixtures. They are combined with the current browser evidence only as explicitly named immutable-code evidence; no old receipt metadata is injected into the compat12 Run, whose `ACCEPTANCE_PARTIAL` status remains truthful. The external routes and receipt parser are unchanged from Task 13b1 base `3375334`; the compat12 browser content is represented by product commit `64c9952` and harness commit `97f201f` (with later commits documentation-only).

## Compatibility interpretation

Feature-off evidence separates two facts:

1. The existing composite-source Run remains readable/reviewable and its data remains present while new composite creation is disabled.
2. A pre-existing historical single-Page `page_selection` Run is actually executed through deterministic MCP fixture transport and published by the browser under feature-off.

Full existing `source=composite` execution/publication is covered independently by the effects-policy database gate. The browser result must not be described as executing the composite Run when it executed the single-Page Run.

## Final verification

On the final implementation content, `pnpm typecheck`, `pnpm lint`, and `pnpm build` exited 0. `pnpm test:full` also exited 0: runtime 233 passed / one explicitly gated CodeGraph E2E skip, database 163/163 with zero skips, server 2231 passed / one Windows-only skip, client 1236/1236, protocol 102/102, and local-sync 877 passed / one Windows-only skip. The nine named composite database files passed 14/14 with zero skips, including isolated migration preservation and startup cleanup. The protected public inventory digest remained `887e5d38ed14a3945866940b88cb74236e4f56f7636235f53d289095ba0ef73b`; no `mac_e2e_*` schema or acceptance child process remained. Exact commands, log paths, skip names, migration evidence, and cleanup queries are recorded in the Task 13b2 implementation report.

## Non-goals and unchanged surfaces

- No production/public schema write, release, deployment, npm publication, push, account change, user configuration change, or bypass flag.
- No replay of paid external models during UI debugging.
- No change to Sync v3, attachment/resource, or Markdown reference source.
- Background embedding/semantic work remains intentionally offline and may fail or defer truthfully without invalidating the committed Page/Run transaction.
