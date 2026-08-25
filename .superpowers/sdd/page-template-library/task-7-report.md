# Task 7 Report: Client page-template primitives

Date: 2026-08-25

Branch: `codex/page-template-library`

Starting commit: `992a968`

Worktree: `/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/page-template-library`

## Requirement mapping

- Added the exact page-template locale, scope, category, summary, list, detail, and save-input client contracts from the brief.
- Added typed adapters for catalog listing, template creation, metadata update, immutable version creation, archive, and restore.
- Catalog listing always supplies the fixed defaults `scope=all`, `archived=active`, `skip=0`, and `take=100`; optional category and trimmed non-empty search filters are forwarded without changing the server query contract.
- Dynamic `spaceId` and `templateId` path segments are encoded with `encodeURIComponent`; ordinary IDs retain the exact paths specified by the server contract.
- Archive uses Axios DELETE request `data` for `{ expectedUpdatedAt }`; restore and the other mutations use their specified request bodies.
- Added local-calendar `{date}` interpolation and ISO week-year `{year}` / zero-padded `{week}` interpolation. Coverage includes repeated tokens, unrecognized tokens, ISO year boundaries, and dates on daylight-saving transitions.
- Added all exact English and Simplified Chinese page-template strings to the existing flat dictionaries in `messages.ts`.
- Added all 12 stable `PAGE_TEMPLATE_*` mappings to `apiErrorMessage` with one parameterized translated-copy test.
- No Task 8 UI, server, database, package-version, release, publish, or deployment work was included.

## TDD evidence

### RED

Tests were added before production modules or mappings, then run with the brief command:

```bash
cd agentwiki
pnpm --filter @agentwiki/client test -- \
  src/features/page-templates/defaultPageTitle.spec.ts \
  src/features/page-templates/pageTemplateApi.spec.ts \
  src/api/error-message.spec.ts
```

Observed exit 1:

- `defaultPageTitle.spec.ts` failed to resolve the missing `./defaultPageTitle` module.
- `pageTemplateApi.spec.ts` failed to resolve the missing `./pageTemplateApi` module.
- All 12 page-template business-code cases returned the fallback translation `登录失败` instead of the required page-template copy.
- Overall RED result: 3 failed test files, 57 passed; 12 failed tests, 445 passed.

These failures matched the missing Task 7 behavior rather than test setup or syntax errors.

### GREEN

After the minimal implementation, the same command exited 0. Because the current package script expands to `vitest run -- <paths>`, Vitest executes the complete client suite rather than only those three files.

Fresh final result:

```text
Test Files  60 passed (60)
Tests       469 passed (469)
```

The Task 7 files specifically contribute:

- title interpolation: 4/4 passed;
- API adapters: 8/8 passed;
- error-message suite: 16/16 passed, including all 12 new mappings.

## Additional date verification

The title suite was also run under a real daylight-saving timezone:

```bash
TZ=America/New_York pnpm --filter @agentwiki/client exec vitest run \
  src/features/page-templates/defaultPageTitle.spec.ts
```

Result: 1 file passed, 4/4 tests passed. The implementation builds ISO-week arithmetic from local year/month/day values in UTC, avoiding elapsed-hour errors at DST transitions.

## Type and patch verification

```bash
cd agentwiki
pnpm --filter @agentwiki/client exec tsc --noEmit
cd ..
git diff --check
```

- Client TypeScript check: exit 0.
- `git diff --check`: exit 0, no output.

## Files

- Created `agentwiki/apps/client/src/features/page-templates/pageTemplateTypes.ts`
- Created `agentwiki/apps/client/src/features/page-templates/pageTemplateApi.ts`
- Created `agentwiki/apps/client/src/features/page-templates/pageTemplateApi.spec.ts`
- Created `agentwiki/apps/client/src/features/page-templates/defaultPageTitle.ts`
- Created `agentwiki/apps/client/src/features/page-templates/defaultPageTitle.spec.ts`
- Modified `agentwiki/apps/client/src/i18n/messages.ts`
- Modified `agentwiki/apps/client/src/api/error-message.ts`
- Modified `agentwiki/apps/client/src/api/error-message.spec.ts`
- Created `.superpowers/sdd/page-template-library/task-7-report.md`

## Self-review

- Confirmed `messages.ts` uses the flat `Record<Language, Record<string, string>>` structure assumed by the brief; no i18n structure conflict existed.
- Compared every client contract and adapter payload with the Task 5 controller/DTO/service response shape.
- Confirmed ISO week-year behavior for both `2025-12-29 -> 2026-W01` and `2021-01-01 -> 2020-W53`.
- Confirmed blank search text is omitted, non-empty search text is trimmed, and zero-valued `skip` remains valid through nullish defaulting.
- Confirmed archive optimistic state is in the DELETE body, not query params.
- Confirmed the commit scope contains client primitives/tests/copy plus this report only; Task 8 UI remains untouched.

## Concerns

- None identified within Task 7 scope.

---

## Review follow-up: contract and mutation coverage

Review date: 2026-08-25

### Added coverage

- Title interpolation now asserts that two occurrences each of `{date}`, `{year}`, and `{week}` in one title are all replaced.
- Catalog pagination now explicitly passes `skip: 0` and `take: 0` and asserts both values reach Axios unchanged. This locks the adapter to nullish defaulting rather than truthy defaulting; server-side DTO validation remains authoritative for range validity.
- A parameterized path contract covers all six adapters. Both collection adapters and every item adapter receive Space/template identifiers containing `/`, `?`, and `#`, and assert exact `encodeURIComponent` output.
- The 12 business-error cases now use the real HTTP status from `business-error.ts`: 400, 403, 404, 409, or 429. `PAGE_TEMPLATE_QUOTA_EXCEEDED` runs at 429 and still resolves to `pageTemplate.quotaExceeded`, proving business-code translation precedes the generic rate-limit branch.
- Added a bilingual copy contract through the existing `LanguageProvider` / `useLanguage().t` API. It verifies both locale dictionaries have the same exact 50 page-template keys and asserts every one of the 100 key/value pairs from the brief.
- No production implementation changed in this follow-up.

### Mutation evidence

Each mutation was applied temporarily, its focused suite was run, and production was restored with `apply_patch` before rerunning green.

1. Replaced each `split(token).join(value)` with single `replace(token, value)`:
   - Result: title suite failed 1/5.
   - Exact failure retained the second `{date}`, `{year}`, and `{week}` occurrences.
   - After restore: 5/5 passed.
2. Replaced `skip/take ?? default` with `skip/take || default`:
   - Result: API suite failed 1/15.
   - Exact failure showed requested `take: 0` became `take: 100`.
   - After restore: 15/15 passed.
3. Replaced the shared `encodeURIComponent` segment helper with an identity function:
   - Result: API suite failed 7/15, covering the pre-existing restore case plus all six adapter rows.
   - After restore: 15/15 passed.

`git diff --quiet` confirmed both production helper files match commit `38a568e` after restoration.

### Focused and full verification

Focused command:

```bash
cd agentwiki
pnpm --filter @agentwiki/client exec vitest run \
  src/features/page-templates/defaultPageTitle.spec.ts \
  src/features/page-templates/pageTemplateApi.spec.ts \
  src/api/error-message.spec.ts \
  src/i18n/page-template-messages.spec.tsx
```

Result: 4 files passed, 137/137 tests passed.

Full client command:

```bash
pnpm --filter @agentwiki/client test
```

Result: 61 files passed, 578/578 tests passed.

Additional gates:

- Client `tsc --noEmit`: exit 0.
- ESLint over all four changed test files: exit 0.
- `git diff --check`: exit 0.

### Follow-up files

- Modified `agentwiki/apps/client/src/features/page-templates/defaultPageTitle.spec.ts`
- Modified `agentwiki/apps/client/src/features/page-templates/pageTemplateApi.spec.ts`
- Modified `agentwiki/apps/client/src/api/error-message.spec.ts`
- Created `agentwiki/apps/client/src/i18n/page-template-messages.spec.tsx`
- Modified `.superpowers/sdd/page-template-library/task-7-report.md`
