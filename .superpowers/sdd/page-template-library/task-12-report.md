# Task 12 Report: Real-browser page-template lifecycle acceptance

Date: 2026-08-26
Branch: `codex/page-template-library`
Starting HEAD: `f4df2ad1d7520c70f709b7ef645e20bef4e02060`
Worktree: `/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/page-template-library`

## Requirement mapping

- Added one serial Playwright fixture with unique run-scoped owner, editor, viewer, Space, source
  page, custom-template name, emails, and artifact directory. Every API response is checked; the
  `afterAll` cleanup collects failures, deletes the Space and all three users in `finally`, disposes
  the request context, and fails the suite if any cleanup request failed.
- Exercised the owner custom lifecycle through the rendered UI: save a source page as a Space
  template, create a version-1 page, update the source, create template version 2, and create a
  second page. API read-back proves the old page retains version-1 content and provenance while
  the new page uses version 2 of the same template.
- Exercised owner archive/restore, editor use-without-management, viewer no-create permission,
  Chinese Daily and English Weekly system-template Markdown, and blank child creation with its
  parent preserved and all template provenance fields null.
- Added exact 390-by-844 browser geometry checks for the NewPageDialog, PageTemplateManager, and
  PageEditor More menu. Each route must have `scrollWidth === clientWidth`, and the important
  controls, cards, articles, actions, menu, and menu item must have horizontal bounding boxes
  inside the viewport.
- Added real focus checks for dialog open, Next, Back then Escape, and More-menu open then Escape.
  The tests also require the dialog/menu opener to regain focus and collect browser console errors.
- Closed the Task 10 Minor by giving the PageEditor More menu a localized accessible name matching
  its trigger, with a focused unit test and the real mobile-browser assertion.

## Interface preflight and deliberate test adaptations

- The checked Playwright configuration has one unnamed local project, uses the installed Chrome
  channel, defaults the frontend to `127.0.0.1:5173`, and retains the repository's local-target
  guard for the API. The final command therefore does not pass a non-existent project name.
- The current template manager renders accessible `article` elements rather than table rows, and
  version success is represented by the visible `v2` state rather than a `模板已更新` toast. The
  test follows the production DOM and still verifies the persisted version tuple through the API.
- A newly created page intentionally opens in edit mode. The test switches to Preview only when
  needed before checking rendered Markdown headings.
- English `Next` and `Create` locators use exact accessible names because template content may also
  contain those words.

## TDD and debugging evidence

### PageEditor More accessible name

RED: the new unit assertion could find the menu only with an empty accessible name; querying
`role=menu` with `More page actions` failed.

GREEN: the menu now has a localized `aria-label`. The related PageEditor suite passes 21/21, and
the real 390px test finds the trigger and menu by the same accessible name.

### NewPageDialog Back/Escape focus

RED: real Playwright and the added unit test showed that Back unmounted the focused button, left
focus on `body`, and therefore Escape never reached the dialog key handler.

GREEN: Back marks a one-render focus handoff; a layout effect focuses the close button after step 1
is mounted. NewPageDialog passes 13/13, and the browser proves Escape closes the dialog and restores
the New page opener.

### PageEditor More hidden-first-frame focus

RED: the real browser showed the More trigger remained active after opening. The first menu frame
is intentionally `visibility: hidden` while its fixed position is calculated, so Chrome rejects the
passive-effect focus attempt; the later position render did not re-run that unchanged effect.

GREEN: focus now occurs in a layout effect that also depends on the resolved menu position. The
real browser focuses `Save as Space template` and restores the More trigger after Escape.

### API startup P2010 root cause and minimal fix

The first disposable-database API startup failed in
`PageTemplateService.seedBuiltIns()` at the advisory-lock statement. The saved error chain was:

```text
PrismaClientKnownRequestError (P2010)
Raw query failed. Code: N/A.
Message: Failed to deserialize column of type 'void'
meta: { code: 'N/A', message: "Failed to deserialize column of type 'void'" }
leaf: apps/server/src/page-templates/page-template.service.ts:101
operation: SELECT pg_advisory_xact_lock(hashtext('agentwiki:page-template-seeds'))
```

A minimal `$queryRawUnsafe` reproduction against the same disposable PostgreSQL cluster returned
the same P2010/meta before the API could listen. PostgreSQL advisory-lock functions return `void`;
`$queryRaw` asks Prisma to deserialize that result column. The repository's working advisory-lock
call sites in the revision writer, retention service, and writer DB test all use `$executeRaw`.

Single hypothesis: execute this side-effect-only statement with `$executeRaw`, so Prisma returns an
affected-row count instead of deserializing the `void` column.

RED: the seed test was changed first to require `$executeRaw` and forbid `$queryRaw`; it failed with
one expected execute call and zero actual calls.

GREEN: the production change is one token-level query-mode change from `$queryRaw` to
`$executeRaw`. The service suite passes 63/63, server typecheck passes, the real
`$executeRawUnsafe` reproduction returned row count 1, and a fresh real API startup completed seed
and returned all-green health. No lock key, transaction, retry, or seed behavior changed.

The next startup attempt exposed only missing required test environment values for
`AGENTWIKI_SERVER_PEPPER` and the deployment seed. Supplying disposable, non-production values
allowed normal startup; this was configuration, not a second product defect.

## Isolated real-service evidence

- Initialized a new Homebrew PostgreSQL 16 cluster under a fresh `/tmp` directory, listening only
  on `127.0.0.1:55433`, and created only the disposable `agentwiki_page_template_e2e` database.
- Applied all 43 repository migrations to that database. No existing `DATABASE_URL`, remote target,
  or existing database was read, migrated, or cleaned.
- Started a dedicated Redis instance on `127.0.0.1:56380`, the built API on port 3000, and Vite on
  `127.0.0.1:5173` with test-only secrets.
- Before the final suite, `/api/health` returned `status`, `database`, `redis`, and
  `auditPersistence` all `ok`.
- Final browser command:

```text
pnpm --filter @agentwiki/client exec playwright test e2e/page-templates.spec.ts
# 7 passed in 9.0s, 1 worker
```

The final run included the cleanup-response assertion and passed all seven cases. The API log then
showed removal of the Space and all three run-scoped users. API, frontend, Redis, and PostgreSQL
were stopped; ports 3000, 5173, 55433, and 56380 had no listeners afterward. The disposable
cluster, screenshots, and generated Playwright results were moved to the system Trash.

## Final verification

```text
pnpm --filter @agentwiki/client exec vitest run \
  src/features/page-templates/NewPageDialog.spec.tsx \
  src/features/page/PageEditor.spec.tsx
# 2 files passed, 34 tests passed

pnpm --filter @agentwiki/server exec jest --runInBand \
  src/page-templates/page-template.service.spec.ts
# 1 suite passed, 63 tests passed

pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/server exec tsc --noEmit
# both exit 0

pnpm --filter @agentwiki/client exec eslint \
  e2e/page-templates.spec.ts \
  src/features/page/PageEditor.tsx \
  src/features/page/PageEditor.spec.tsx \
  src/features/page-templates/NewPageDialog.tsx \
  src/features/page-templates/NewPageDialog.spec.tsx

pnpm --filter @agentwiki/server exec eslint \
  src/page-templates/page-template.service.ts \
  src/page-templates/page-template.service.spec.ts

git diff --check
# all exit 0
```

## Files

- Created `agentwiki/apps/client/e2e/page-templates.spec.ts`
- Modified `agentwiki/apps/client/src/features/page-templates/NewPageDialog.tsx`
- Modified `agentwiki/apps/client/src/features/page-templates/NewPageDialog.spec.tsx`
- Modified `agentwiki/apps/client/src/features/page/PageEditor.tsx`
- Modified `agentwiki/apps/client/src/features/page/PageEditor.spec.tsx`
- Modified `agentwiki/apps/server/src/page-templates/page-template.service.ts`
- Modified `agentwiki/apps/server/src/page-templates/page-template.service.spec.ts`
- Created `.superpowers/sdd/page-template-library/task-12-report.md`

## Scope and safety review

- Work stayed in the requested worktree and on `codex/page-template-library`.
- The pre-existing Task 11 report modification was preserved and excluded from this Task 12 commit.
- No remote target, existing database, push, publish, deployment, new worktree, or new branch was
  used.
