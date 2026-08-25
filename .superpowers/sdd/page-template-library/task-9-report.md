# Task 9 Report: Space page-template settings and management

Date: 2026-08-25

Branch: `codex/page-template-library`

Starting commit: `cd3013f3bbbd3a927d37ad85a1ea26f990e08974`

Worktree: `/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/page-template-library`

## Requirement mapping

- Added an isolated Space-settings summary card after `AutoGraphCard`. It loads only the Space template count, exposes the manager link only when `capabilities.canManage`, and keeps its loading/error/catalog identity independent from the main settings form and graph card.
- Added the lazy protected route `/spaces/:id/settings/page-templates` without changing existing route meanings or moving the wildcard ahead of static routes.
- Added a manager using the existing `SpaceNav`, `ModalDialog`, language context, Task 7 adapters, and paginated `GET /pages` contract.
- Catalog state is tagged with the complete `(spaceId, language, search, category, archived)` identity. A monotonically increasing request ID additionally prevents old reset and load-more responses from replacing the current identity. Completed old catalogs and their capabilities are synchronously hidden when identity changes.
- Search, category, archive visibility, System/Space sections, and 50-item Space pagination are supported. Accepted load-more pages are appended with ID deduplication; a stale load-more response cannot overwrite a newer reset.
- System templates are always read-only. When `capabilities.canManage` is false, no edit, content-version, archive, restore, or management-dialog controls render.
- Metadata update sends the selected catalog record's exact `updatedAt`. New content versions send the selected template's exact `currentVersion` plus the selected persisted page's exact `updatedAt`.
- Source pages are fetched through sequential 100-item `/pages` batches until the server `total` is exhausted, deduplicated, and filtered to `format === 'markdown'` before selection.
- Metadata and version dialogs retain user input after failure, reject duplicate submit, and block close, cancel, Escape, and backdrop close while submitting. Successful mutations close the dialog and issue an authoritative catalog reload; `noChange` stays in the dialog with translated feedback.
- Archive and restore require confirmation and use exact optimistic timestamps from the authoritative list record before reloading.
- The existing Task 7 API adapters already provided every required mutation/list contract, so `pageTemplateApi.ts` required no behavioral change.

## Interface preflight

- `SpaceNav` accepts the required `spaceId?: string` prop.
- `GET /pages` returns `{ data, total, page, limit }` and accepts `spaceId`, `skip`, and `take`, matching the brief's source-page pagination loop.
- No interface conflict or blocker was found.

## TDD evidence

### RED

The card, manager, settings integration, and route tests were added before production implementation. The brief-style command exited 1:

```bash
cd agentwiki
pnpm --filter @agentwiki/client test -- \
  src/features/page-templates/PageTemplateSettingsCard.spec.tsx \
  src/features/page-templates/PageTemplateManager.spec.tsx \
  src/features/space/SpaceSettings.spec.tsx \
  src/App.spec.tsx
```

Observed result:

- the two new component suites could not resolve their missing production modules;
- the Space settings integration could not find the template settings card;
- the application route test could not reach the manager heading;
- overall: 4 failed test files, 61 passed; 2 executed assertions failed and the two missing-module suites stopped at import time.

These were the expected missing-feature failures rather than syntax or fixture failures.

### GREEN

Fresh focused Task 9 and shared-modal verification:

```bash
pnpm --filter @agentwiki/client exec vitest run \
  src/features/page-templates/PageTemplateSettingsCard.spec.tsx \
  src/features/page-templates/PageTemplateManager.spec.tsx \
  src/features/space/SpaceSettings.spec.tsx \
  src/App.spec.tsx \
  src/components/ModalDialog.test.tsx
```

Result: 5 files passed, 32/32 tests passed.

Fresh complete client suite:

```bash
pnpm --filter @agentwiki/client test
```

Result: 65 files passed, 619/619 tests passed.

## Additional verification

```bash
pnpm --filter @agentwiki/client exec tsc --noEmit
pnpm --filter @agentwiki/client lint
git diff --check
```

- Client TypeScript check: exit 0.
- Client ESLint: exit 0 with no warnings.
- `git diff --check`: exit 0 with no output.

## Independent review

An independent read-only reviewer checked the brief, implementation, tests, API/page response shapes, and route ordering.

- Critical: none.
- Important: none.
- Minor: none.
- The reviewer made no file changes.

## Files

- Created `agentwiki/apps/client/src/features/page-templates/PageTemplateSettingsCard.tsx`.
- Created `agentwiki/apps/client/src/features/page-templates/PageTemplateSettingsCard.spec.tsx`.
- Created `agentwiki/apps/client/src/features/page-templates/PageTemplateManager.tsx`.
- Created `agentwiki/apps/client/src/features/page-templates/PageTemplateManager.spec.tsx`.
- Modified `agentwiki/apps/client/src/features/space/SpaceSettings.tsx`.
- Modified `agentwiki/apps/client/src/features/space/SpaceSettings.spec.tsx`.
- Modified `agentwiki/apps/client/src/App.tsx`.
- Modified `agentwiki/apps/client/src/App.spec.tsx`.
- Created `.superpowers/sdd/page-template-library/task-9-report.md`.

## Scope boundary

- No server, database, package version, npm, GitHub, production, push, publish, or deployment action was performed.
- No Task 10+ editor entry, integration database, or browser acceptance work was included.

## Concerns

- None identified within Task 9 scope.

---

## Review fix: authoritative post-mutation refresh gate

Review-fix date: 2026-08-25

Review-fix starting commit: `d49fca7842ba2576c650d11203710de89d79893b`

### Root cause

- Successful metadata, version, archive, and restore calls started an authoritative reset load while leaving the previously accepted catalog identity in place.
- If that load was slow, cards and mutation controls still carried the old `updatedAt` / `currentVersion` and could start another optimistic mutation.
- If that load failed, the old mutable catalog remained visible; the manager had an error message but no explicit retry action.

### TDD RED

Two deferred-promise tests were added before the production fix:

```bash
pnpm --filter @agentwiki/client exec vitest run \
  src/features/page-templates/PageTemplateManager.spec.tsx \
  -t "authoritative|refresh gate"
```

Observed RED: 1 test file failed, 2/2 selected tests failed.

- After a successful metadata mutation entered a pending authoritative reload, the old `团队周报` card and its mutation controls remained in the document.
- The same stale card and controls remained after a successful archive entered its pending authoritative reload.

### Remediation

- Added one shared `invalidateCatalog()` gate used by successful metadata, version, archive, and restore paths before their authoritative reset load starts.
- The gate clears the renderable catalog identity, catalog/ref contents, capabilities, and pending dialog. Old cards, mutation controls, and CAS tokens therefore disappear together.
- A failed authoritative reload leaves the catalog invalid. The manager renders the translated load error plus the existing bilingual `pageTemplate.retry` action; retry performs another invalidated reset load.
- Retry coverage proves that only the refreshed card and `v8` are displayed and that the next metadata update sends the refreshed exact `updatedAt`, never the prior token.
- An archive-specific deferred test proves the same shared gate protects a non-dialog mutation path and does not issue a duplicate archive.
- Load rejection/finalization now checks both request sequence and complete request identity, preserving the existing stale-response contract.
- Template text containers now use `min-w-0` and `break-words`; card mutation buttons use at least `min-h-10` with wrapping text for better 390px and touch behavior. Real 390px browser verification remains Task 12.

### Verification

Fresh focused Task 9 gate after the fix:

```text
Test Files  5 passed (5)
Tests       34 passed (34)
```

Fresh complete client suite after the fix:

```text
Test Files  65 passed (65)
Tests       621 passed (621)
```

Additional gates:

- Client `tsc --noEmit`: exit 0.
- Client ESLint: exit 0 with no warnings.
- `git diff --check`: exit 0.

### Backlog note

- Unknown mutation failures still use the pre-approved existing `pageTemplate.createFailed` fallback because Task 9 did not authorize new bilingual copy. Known business codes continue to resolve to their accurate existing translations. A dedicated generic page-template mutation fallback can be added in a later copy-contract task if desired.

### Concurrent filter-identity follow-up

The first review fix received an additional independent concurrency review. It identified that successful mutations still compared the entire original identity before refreshing. If search/category/archive/language changed while a mutation was pending, the success path could skip authoritative refresh even though the user remained in the same Space; calling the handler's captured `load` would also target the old filters.

A deferred archive test was added before this second production fix:

```bash
pnpm --filter @agentwiki/client exec vitest run \
  src/features/page-templates/PageTemplateManager.spec.tsx \
  -t "latest filter identity"
```

Observed RED: the selected test failed because only the initial and filter-change list requests occurred; the expected third authoritative request for the latest filter identity never started.

Remediation:

- Mutation success is discarded only when the live `spaceId` differs from the operation's Space.
- A `latestLoadRef` is updated every render. Successful metadata, version, archive, and restore operations invalidate the current catalog and call the latest reset loader, so current language/search/category/archive filters are preserved.
- The deferred test proves that an old filtered snapshot may load before the mutation commits, but mutation success immediately removes that snapshot and all controls, then issues a third request with `q: "latest filter"`, `archived: "active"`, and `skip: 0`.
- Space-level isolation remains separate: a mutation from a different Space cannot refresh or overwrite the current Space.

The same independent reviewer rechecked the remediation and reported no Critical, Important, or Minor findings. The reviewer confirmed all four mutation paths use the latest identity within the same Space and that an operation from a changed Space cannot clear or reload the new Space.

Final verification after the concurrent filter-identity fix:

```text
Focused Task 9: 5 files passed, 35/35 tests passed
Complete client: 65 files passed, 622/622 tests passed
Client tsc --noEmit: exit 0
Client ESLint: exit 0 with no warnings
git diff --check: exit 0
```
