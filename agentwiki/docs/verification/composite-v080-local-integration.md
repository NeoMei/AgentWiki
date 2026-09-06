# Composite templates with AgentWiki v0.8.0: local integration verification

Date: 2026-09-06

## Immutable integration inputs

- Composite-template feature parent: `36abc59f822c844362fed39bb85116d38eaa8801`.
- Pinned v0.8.0 upstream parent: `ea56d75b2cf58b191022e84368f32b042cd38e6f`.
- Common ancestor: `711cae77277af1f79c6f4c16f998dbc66f6e2dae`.
- Integration branch: `codex/composite-page-group-agent-collaboration` in the isolated linked worktree.
- The result is the merge commit containing this document. The controller performs independent review before any local `master` fast-forward.

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

- Server combined contract: a linked published v3 ChangeSet must return both `revertible: false` and its collaboration `reviewPath`. Valid semantic RED was the missing `reviewPath`; focused GREEN was 1 pass with 108 skipped, followed by the complete ReviewService suite at 109/109.
- Client combined contract: a linked published v3 detail exposes neither ordinary Publish nor legacy Revert and retains the collaboration link. Feature-only temporary resolution failed because Revert remained visible; focused GREEN was 1 pass with 13 skipped, followed by ReviewPage, PageEditor, and attachment-reference suites at 73/73.
- Migration helper: an unsorted inventory must select the target and all later migration names in byte order. The valid RED observed an absent exported selector; GREEN was page-template plus server-harness tests at 12/12.
- Browser fixture version: two focused assertions failed with actual `0.7.0` versus expected `0.8.0`; GREEN was 2/2 plus syntax checks.

Focused logs are retained at:

- `/tmp/agentwiki-composite-v080-focused-protocol.log` — protocol 140/140.
- `/tmp/agentwiki-composite-v080-focused-server.log` — ReviewService 109/109.
- `/tmp/agentwiki-composite-v080-focused-client.log` — 73/73.
- `/tmp/agentwiki-composite-v080-focused-harness.log` — 12/12.
- `/tmp/agentwiki-composite-v080-focused-db.log` — eight named real DB/HTTP files, 55/55, zero skips.

## Real Chrome UI-only acceptance

The fresh merged-source run used installed real Chrome with `COMPOSITE_TEMPLATE_E2E_EXTERNAL_STAGES=none`. It exited 0 with `ACCEPTANCE_PARTIAL` and then `CLEANED`; `PARTIAL` is intentional because no external paid-model stage was authorized.

Six UI journeys passed: ordinary composite creation/edit/reload, enabled collaboration, historical Page binding, saved Folder source-CAS/template instantiation, concurrent Page conflict/regenerate/adopt, and legacy/feature-off compatibility. The run also covered 390px English keyboard/responsive behavior.

Persisted assertions included 11 nodes/7 Pages/0 Runs in collaboration-off mode; 7 tasks/2 participants with collaboration enabled; four retained Pages, one role, and seven instantiated nodes for a saved Folder; system title `日报 2026-09-06`; JSON single-page version 2 metadata/archive; and publication of an existing Page-selection Run while new composite creation was disabled.

Exactly three expected HTTP 409 responses were observed: one `SOURCE_CHANGED` and two `PAGE_VERSION_CONFLICT`. Each had a matching expected console event. Unknown console issues and page errors were both zero. Evidence: `/tmp/agentwiki-composite-v080-chrome2.log` and `/tmp/agentwiki-composite-v080-chrome2`.

This proves the merged UI-only workflow. It does not claim fresh Codex/OpenCode/other external-client model execution or production acceptance.

## Frozen full gate

The source-freeze gate used the dedicated PostgreSQL database on port 50415, dedicated Redis on port 50416, all six required database aliases, and PG16 `pg_dump`/`psql`:

```sh
pnpm typecheck && pnpm lint && pnpm build && pnpm test:full
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

## Isolation and cleanup

All database work targeted `agentwiki_composite_test` through generated task-owned schemas. After focused DB, Chrome, and the frozen full gate:

- `public` tables: 0.
- Generated collaboration/folder/markdown/page-template/sync-v3/pgvector test schemas: 0.
- Other connections to the task database: 0.
- Chrome acceptance API/web listeners on ports 60812/60813: 0.
- Protected structural inventory digest: `887e5d38ed14a3945866940b88cb74236e4f56f7636235f53d289095ba0ef73b`, unchanged.

No `.codex-memory` file belongs to or is staged by this integration. The controller-owned working-tree edit remains outside the commit.
