# Task 6 Report: Exact-version page creation

Date: 2026-08-25

Branch: `codex/page-template-library`

Starting commit: `6192288`

Worktree: `/Users/neomei/项目/codexprojects/AgentWiki /.worktrees/page-template-library`

## Requirement mapping

- `CreatePageDto` accepts blank/direct-content creation or a complete `templateId` + `templateVersion` + `templateLocale` shape. Partial template shapes, mixed content, and non-Markdown template format are rejected by the object-shape validator attached to required `spaceId`.
- `PageService.create()` calls `PageTemplateService.resolveVersion()` after the existing Space lock and before sync-path allocation, inside the existing transaction.
- The page row and initial Space revision use the same exact resolved body. Template creates force Markdown and persist resolver-returned `templateId`, `version`, and actual `locale` as immutable provenance.
- `PAGE_PUBLIC_FIELDS` exposes all three source-template fields for create and later page reads.
- `PageController.create()` preserves the editor-level human authorization call `['owner', 'editor'], 'pages:write'`; the shared authorization layer includes Human Admin in that editor-level gate while keeping Agent roles exact. Agent template fields are rejected with `PAGE_TEMPLATE_AGENT_UNSUPPORTED` before the review/ChangeSet branch.
- Agents neither resolve templates nor copy template content into proposals.
- `PageModule` imports `PageTemplateModule`; both PageService test modules and the direct constructor receive the resolver dependency.

## Locale adjudication A

The create request test asks for `zh-CN` while the resolver returns `en`. The page row, public response, and provenance assertion all use `sourceTemplateLocale: 'en'`, proving the actual content locale is persisted rather than the requested locale.

## TDD evidence

### RED

Command:

```text
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand \
  src/core/dto/page-template-create.validator.spec.ts \
  src/core/dto/page.dto.spec.ts \
  src/core/page/page.service.spec.ts \
  src/review/agent-write-boundary.spec.ts
```

The initial run failed on the intended missing behaviors. A test-only `as any` was then added so the PageService test reached runtime instead of stopping on the not-yet-added DTO fields. The resulting RED run exited 1 with 4 failed suites and 9 failed tests:

- partial/mixed template DTO shapes were accepted;
- Agent template creation resolved instead of throwing;
- `PageTemplateService.resolveVersion()` had zero calls.

No production code was changed before this behavioral RED result.

### GREEN

After the minimal implementation, the same four suites passed with 61/61 tests. One additional existing PageService test module initially exposed a missing test provider; adding the same `PageTemplateService` mock provider restored all page-ordering regressions.

## Final verification

```text
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand \
  src/core/dto/page-template-create.validator.spec.ts \
  src/core/dto/page.dto.spec.ts \
  src/core/page/page.service.spec.ts \
  src/review/agent-write-boundary.spec.ts \
  src/page-templates
# exit 0: 8 suites passed, 154 tests passed

pnpm --filter @agentwiki/server typecheck
# exit 0: tsc --noEmit --incremental false

cd ..
git diff --check
# exit 0, no output
```

## Files

- Created `agentwiki/apps/server/src/core/dto/page-template-create.validator.ts`
- Created `agentwiki/apps/server/src/core/dto/page-template-create.validator.spec.ts`
- Modified `agentwiki/apps/server/src/core/dto/page.dto.ts`
- Modified `agentwiki/apps/server/src/core/dto/page.dto.spec.ts`
- Modified `agentwiki/apps/server/src/core/page/page.service.ts`
- Modified `agentwiki/apps/server/src/core/page/page.service.spec.ts`
- Modified `agentwiki/apps/server/src/core/page/page.controller.ts`
- Modified `agentwiki/apps/server/src/core/page/page.module.ts`
- Modified `agentwiki/apps/server/src/review/agent-write-boundary.spec.ts`
- Created `.superpowers/sdd/page-template-library/task-6-report.md`

## Self-review

- Confirmed the exact requested version is delegated to the existing resolver; PageService does not inspect template storage or advance to a current version.
- Confirmed resolver execution occurs under the existing Space lock and before path allocation.
- Confirmed direct-content and blank creates retain their prior content/format behavior.
- Confirmed page-template creation uses the existing shared page-write policy: Human Admin satisfies the editor-level gate, while Viewer and admin-shaped Agent grants do not.
- Confirmed Agent explicit-content proposals remain supported and do not receive template provenance fields.
- Confirmed no push, publish, or deployment action was performed.

## Concerns

None identified within Task 6 scope.

## Review fix: strict raw template input and service invariants

Review fix date: 2026-08-25

### Root cause

- The production `ValidationPipe` enables implicit conversion. Unlike the already-hardened Task 3 mutation DTO fields, the three new page-template fields did not preserve raw body input, so numeric/boolean/object IDs and string/boolean versions could be converted into apparently valid declared types.
- `@IsOptional()` skips both `undefined` and `null`. A complete three-field null shape therefore passed the property validators while the shape validator counted all three values as present.
- `PageService.create()` used truthiness of `templateId` rather than presence of any template field. Empty IDs and version/locale-only internal calls silently fell through to ordinary blank page creation.

### TDD evidence

The review tests were added before the production fix and run through the exact `main.ts` body-pipe configuration:

```text
whitelist: true
forbidNonWhitelisted: true
transform: true
transformOptions: { enableImplicitConversion: true }
```

RED command:

```text
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand \
  src/core/dto/page-template-create.validator.spec.ts \
  src/core/dto/page.dto.spec.ts \
  src/core/page/page.service.spec.ts \
  src/review/agent-write-boundary.spec.ts
```

Observed RED: exit 1; 2 suites failed and 20 tests failed. The failures showed raw `templateId` conversion, raw version conversion, null acceptance, and all eight invalid internal service inputs resolving instead of returning `PAGE_TEMPLATE_INVALID`.

GREEN after the minimal DTO/service fix: 4 suites passed, 99 tests passed.

### Remediation

- Applied the Task 3 `PreserveRawInput` strategy only to `templateId`, `templateVersion`, and `templateLocale`; ordinary `CreatePageDto` fields retain their existing production-pipe compatibility.
- Replaced `@IsOptional()` on those fields with `@ValidateIf(value !== undefined)`, so only raw `undefined` is absence and explicit null always reaches strict validators.
- Added non-empty/non-whitespace ID validation, strict integer bounds, and explicit string/supported-locale validation.
- Replaced the service truthy check with presence detection across all three fields. Under the existing Space lock, incomplete/invalid triples, mixed content, or non-Markdown template format now raise `PAGE_TEMPLATE_INVALID` before resolver/path/page/revision work.
- Kept the exact resolver call, actual-locale provenance, and lock -> resolve -> allocate ordering unchanged.
- Added direct controller tests for each single Agent template field plus single/all/mixed null payloads; every case stops before review and page creation.
- Added explicit blank Markdown, direct JSON, and resolver-failure zero-write coverage.

### Final review-fix verification

```text
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand \
  src/core/dto/page-template-create.validator.spec.ts \
  src/core/dto/page.dto.spec.ts \
  src/core/page/page.service.spec.ts \
  src/review/agent-write-boundary.spec.ts \
  src/page-templates
# exit 0: 8 suites passed, 196 tests passed

pnpm --filter @agentwiki/server typecheck
# exit 0: tsc --noEmit --incremental false

cd ..
git diff --check
# exit 0, no output
```

No page-specific authorization override, Agent explicit-content proposal behavior, template locale adjudication, push, publish, or deployment action was introduced.
