# Page Template Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-step new-page flow with seven bilingual system templates and versioned Space templates managed by Owner/Admin users.

**Architecture:** A new NestJS `page-templates` domain owns authoritative template metadata, immutable Markdown versions, seeding, permissions, and management APIs. `PageService` resolves an explicitly selected template version inside the existing page-create transaction, while focused React components provide template selection, settings management, and “save page as template” without changing the Markdown editor model.

**Tech Stack:** PostgreSQL, Prisma 5.22, NestJS 11, class-validator, Zod 3, React 18, React Router 7, Tailwind CSS 4, Vitest, Jest, Playwright, pnpm 11.

## Global Constraints

- Implement single-page Markdown templates only; do not create page trees, database boards, task state machines, or rich-text template blocks.
- The eight built-in choices are exactly: virtual blank page plus task list, project management, daily report, weekly report, meeting notes, decision record, and retrospective.
- System templates contain both `zh-CN` and `en`; Space templates preserve their source language and are never auto-translated.
- Only human Space Owner/Admin users manage Space templates; Editor users may use templates through existing `pages:write`; Viewer users and Agents cannot manage them.
- An Agent request containing any template source field must be rejected before ChangeSet proposal creation.
- Template versions are immutable; template updates and archives never mutate pages created from older versions.
- Continue using `ModalDialog`, `SpaceNav`, Tailwind, and the shared language context; do not add a component library or npm dependency.
- Preserve the mutually exclusive Edit/Preview Markdown workspace.
- Keep the existing `POST /pages` behavior unchanged when template fields are absent.
- Keep package versions at `0.6.1`; this feature does not change the sync protocol or local-sync package.
- Never migrate or clean PostgreSQL `public` in tests. Database integration uses only an explicit `PAGE_TEMPLATE_TEST_DATABASE_URL` with a random `page_template_test_*` schema.
- Do not push GitHub, publish npm, or deploy production without separate authorization.

## File Structure

### Server and database

- `apps/server/prisma/schema.prisma`: page-template identities, immutable versions, Page provenance relations, User/Space inverse relations.
- `apps/server/prisma/migrations/20260825150000_add_page_templates/migration.sql`: enums, tables, indexes, checks, foreign keys, and Page provenance columns.
- `scripts/page-template-schema.test.mjs`: static migration/schema contract test that runs without a database.
- `apps/server/src/page-templates/page-template.types.ts`: strict localization/category types, serializers, name normalization, content hashing.
- `apps/server/src/page-templates/page-template-definitions.ts`: seven deeply frozen and schema-parsed built-in seeds with exact bilingual Markdown.
- `apps/server/src/page-templates/page-template.dto.ts`: validated list/create/update/version/archive DTOs.
- `apps/server/src/page-templates/page-template.service.ts`: seeding, listing, exact-version resolution, Space template mutations, optimistic conflicts.
- `apps/server/src/page-templates/page-template.controller.ts`: human-only HTTP surface.
- `apps/server/src/page-templates/page-template.module.ts`: domain wiring and exported resolver.
- `apps/server/src/page-templates/*.spec.ts`: definition, DTO, service, controller tests.
- `apps/server/src/core/dto/page.dto.ts`: mutually dependent template create fields.
- `apps/server/src/core/page/page.service.ts`: resolve template content and persist provenance inside create transaction.
- `apps/server/src/core/page/page.controller.ts`: reject Agent template usage before proposal creation.
- `apps/server/src/core/filters/business-error.ts`: stable page-template business codes.
- `apps/server/src/app.module.ts` and `apps/server/src/core/page/page.module.ts`: module wiring.

### Client

- `apps/client/src/features/page-templates/pageTemplateTypes.ts`: API contracts used by all template screens.
- `apps/client/src/features/page-templates/pageTemplateApi.ts`: list/manage/create adapters only.
- `apps/client/src/features/page-templates/defaultPageTitle.ts`: local-date and ISO-week interpolation.
- `apps/client/src/features/page-templates/NewPageDialog.tsx`: accessible two-step creation flow with blank fallback.
- `apps/client/src/features/page-templates/PageTemplateManager.tsx`: search/filter/edit/version/archive/restore page.
- `apps/client/src/features/page-templates/SavePageAsTemplateDialog.tsx`: save persisted page snapshot as Space template.
- `apps/client/src/features/page-templates/*.spec.tsx`: focused UI and helper tests.
- `apps/client/src/features/space/SpaceView.tsx`: replace inline create form with `NewPageDialog`.
- `apps/client/src/features/space/SpaceSettings.tsx`: add template summary card and manager link.
- `apps/client/src/features/page/PageEditor.tsx`: load template capability and expose the saved-page action.
- `apps/client/src/App.tsx`: add the template manager route.
- `apps/client/src/i18n/messages.ts` and `apps/client/src/api/error-message.ts`: bilingual copy and stable error-code mapping.

### Acceptance and continuity

- `apps/client/e2e/page-templates.spec.ts`: real API/browser desktop, mobile, bilingual, immutability, and role acceptance.
- `docs/testing/page-template-library-acceptance.md`: reproducible local evidence and unresolved risks.
- `.codex-memory/current.md` and `.codex-memory/tasks/active/page-template-library/*`: current state, decisions, references, and completion evidence.

---

### Task 1: Add the database contract and provenance constraints

**Files:**
- Create: `agentwiki/scripts/page-template-schema.test.mjs`
- Modify: `agentwiki/apps/server/prisma/schema.prisma`
- Create: `agentwiki/apps/server/prisma/migrations/20260825150000_add_page_templates/migration.sql`

**Interfaces:**
- Consumes: existing `User`, `Space`, and `Page` Prisma models.
- Produces: Prisma delegates `pageTemplate` and `pageTemplateVersion`; Page fields `sourceTemplateId`, `sourceTemplateVersion`, `sourceTemplateLocale`; compound identity `PageTemplateVersion_templateId_version_key`.

- [ ] **Step 1: Write the failing static schema contract test**

```js
// scripts/page-template-schema.test.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

test('page templates keep immutable versions and compound Page provenance', async () => {
  const schema = await read('apps/server/prisma/schema.prisma');
  const migration = await read('apps/server/prisma/migrations/20260825150000_add_page_templates/migration.sql');
  assert.match(schema, /model PageTemplate \{/u);
  assert.match(schema, /model PageTemplateVersion \{/u);
  assert.match(schema, /@@unique\(\[templateId, version\]\)/u);
  assert.match(schema, /sourceTemplateVersion\s+Int\?/u);
  assert.match(migration, /Page_template_source_tuple_check/u);
  assert.match(migration, /FOREIGN KEY \("sourceTemplateId", "sourceTemplateVersion"\)/u);
  assert.match(migration, /REFERENCES "PageTemplateVersion"\("templateId", "version"\)/u);
  assert.match(migration, /ON DELETE RESTRICT/u);
});
```

- [ ] **Step 2: Run the contract test and verify the migration is absent**

Run: `cd agentwiki && node --test scripts/page-template-schema.test.mjs`

Expected: FAIL with `ENOENT` for `20260825150000_add_page_templates/migration.sql`.

- [ ] **Step 3: Add exact Prisma enums, models, inverse relations, and Page provenance**

Add these declarations to `schema.prisma`; add the named inverse arrays to `User`, `Space`, and `Page` rather than leaving raw foreign-key IDs:

```prisma
enum PageTemplateScope {
  system
  space
}

enum PageTemplateCategory {
  planning
  reporting
  knowledge
  other
}

model PageTemplate {
  id               String               @id @default(cuid())
  scope            PageTemplateScope
  scopeKey         String
  spaceId          String?
  stableKey        String
  category         PageTemplateCategory
  displayOrder     Int?
  nameI18n         Json
  nameKey          String?
  descriptionI18n  Json
  defaultTitleI18n Json
  sourceLocale     String?
  currentVersion   Int                  @default(1)
  createdById      String?
  updatedById      String?
  archivedAt       DateTime?
  createdAt        DateTime             @default(now())
  updatedAt        DateTime             @updatedAt

  space      Space?                @relation(fields: [spaceId], references: [id], onDelete: Cascade)
  createdBy  User?                 @relation("PageTemplateCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  updatedBy  User?                 @relation("PageTemplateUpdatedBy", fields: [updatedById], references: [id], onDelete: SetNull)
  versions   PageTemplateVersion[]

  @@unique([scopeKey, stableKey])
  @@unique([spaceId, nameKey])
  @@index([spaceId, archivedAt, updatedAt])
}

model PageTemplateVersion {
  id              String   @id @default(cuid())
  templateId      String
  version         Int
  contentI18n     Json
  sourcePageId    String?
  contentHash     String
  createdById     String?
  createdAt       DateTime @default(now())

  template   PageTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  sourcePage Page?        @relation("PageTemplateVersionSourcePage", fields: [sourcePageId], references: [id], onDelete: SetNull)
  createdBy  User?        @relation("PageTemplateVersionCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  pages      Page[]       @relation("PageSourceTemplateVersion")

  @@unique([templateId, version])
  @@index([templateId, createdAt])
  @@index([sourcePageId])
}
```

Add to `User`:

```prisma
pageTemplatesCreated        PageTemplate[]        @relation("PageTemplateCreatedBy")
pageTemplatesUpdated        PageTemplate[]        @relation("PageTemplateUpdatedBy")
pageTemplateVersionsCreated PageTemplateVersion[] @relation("PageTemplateVersionCreatedBy")
```

Add to `Space`:

```prisma
pageTemplates PageTemplate[]
```

Add to `Page`:

```prisma
sourceTemplateId      String?
sourceTemplateVersion Int?
sourceTemplateLocale  String?

sourceTemplateVersionRecord PageTemplateVersion?  @relation("PageSourceTemplateVersion", fields: [sourceTemplateId, sourceTemplateVersion], references: [templateId, version], onDelete: Restrict)
templateVersionsSourced      PageTemplateVersion[] @relation("PageTemplateVersionSourcePage")

@@index([sourceTemplateId, sourceTemplateVersion])
```

- [ ] **Step 4: Add the SQL migration with database-enforced scope and tuple checks**

Create the migration with these operations in one `BEGIN` / `COMMIT` transaction:

```sql
BEGIN;
CREATE TYPE "PageTemplateScope" AS ENUM ('system', 'space');
CREATE TYPE "PageTemplateCategory" AS ENUM ('planning', 'reporting', 'knowledge', 'other');

CREATE TABLE "PageTemplate" (
  "id" TEXT NOT NULL,
  "scope" "PageTemplateScope" NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "spaceId" TEXT,
  "stableKey" TEXT NOT NULL,
  "category" "PageTemplateCategory" NOT NULL,
  "displayOrder" INTEGER,
  "nameI18n" JSONB NOT NULL,
  "nameKey" TEXT,
  "descriptionI18n" JSONB NOT NULL,
  "defaultTitleI18n" JSONB NOT NULL,
  "sourceLocale" TEXT,
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT,
  "updatedById" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PageTemplateVersion" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "contentI18n" JSONB NOT NULL,
  "sourcePageId" TEXT,
  "contentHash" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PageTemplateVersion_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Page" ADD COLUMN "sourceTemplateId" TEXT;
ALTER TABLE "Page" ADD COLUMN "sourceTemplateVersion" INTEGER;
ALTER TABLE "Page" ADD COLUMN "sourceTemplateLocale" TEXT;

CREATE UNIQUE INDEX "PageTemplate_scopeKey_stableKey_key" ON "PageTemplate"("scopeKey", "stableKey");
CREATE UNIQUE INDEX "PageTemplate_spaceId_nameKey_key" ON "PageTemplate"("spaceId", "nameKey");
CREATE INDEX "PageTemplate_spaceId_archivedAt_updatedAt_idx" ON "PageTemplate"("spaceId", "archivedAt", "updatedAt");
CREATE UNIQUE INDEX "PageTemplateVersion_templateId_version_key" ON "PageTemplateVersion"("templateId", "version");
CREATE INDEX "PageTemplateVersion_templateId_createdAt_idx" ON "PageTemplateVersion"("templateId", "createdAt");
CREATE INDEX "PageTemplateVersion_sourcePageId_idx" ON "PageTemplateVersion"("sourcePageId");
CREATE INDEX "Page_sourceTemplateId_sourceTemplateVersion_idx" ON "Page"("sourceTemplateId", "sourceTemplateVersion");

ALTER TABLE "PageTemplate" ADD CONSTRAINT "PageTemplate_scope_check" CHECK (
  ("scope" = 'system' AND "scopeKey" = 'system' AND "spaceId" IS NULL AND "sourceLocale" IS NULL AND "nameKey" IS NULL AND "displayOrder" IS NOT NULL)
  OR
  ("scope" = 'space' AND "spaceId" IS NOT NULL AND "scopeKey" = "spaceId" AND "sourceLocale" IN ('zh-CN', 'en') AND "nameKey" IS NOT NULL)
);
ALTER TABLE "PageTemplate" ADD CONSTRAINT "PageTemplate_current_version_check" CHECK ("currentVersion" >= 1);
ALTER TABLE "PageTemplateVersion" ADD CONSTRAINT "PageTemplateVersion_version_check" CHECK ("version" >= 1);
ALTER TABLE "Page" ADD CONSTRAINT "Page_template_source_tuple_check" CHECK (
  ("sourceTemplateId" IS NULL AND "sourceTemplateVersion" IS NULL AND "sourceTemplateLocale" IS NULL)
  OR
  ("sourceTemplateId" IS NOT NULL AND "sourceTemplateVersion" IS NOT NULL AND "sourceTemplateLocale" IN ('zh-CN', 'en'))
);

ALTER TABLE "PageTemplate" ADD CONSTRAINT "PageTemplate_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageTemplate" ADD CONSTRAINT "PageTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PageTemplate" ADD CONSTRAINT "PageTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PageTemplateVersion" ADD CONSTRAINT "PageTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageTemplateVersion" ADD CONSTRAINT "PageTemplateVersion_sourcePageId_fkey" FOREIGN KEY ("sourcePageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PageTemplateVersion" ADD CONSTRAINT "PageTemplateVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_sourceTemplate_version_fkey" FOREIGN KEY ("sourceTemplateId", "sourceTemplateVersion") REFERENCES "PageTemplateVersion"("templateId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
```

- [ ] **Step 5: Format, validate, generate, and rerun the contract test**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec prisma format --schema prisma/schema.prisma
pnpm --filter @agentwiki/server exec prisma validate --schema prisma/schema.prisma
pnpm --filter @agentwiki/server exec prisma generate --schema prisma/schema.prisma
node --test scripts/page-template-schema.test.mjs
```

Expected: Prisma format/validate/generate exit 0; Node test reports `1 pass, 0 fail`.

- [ ] **Step 6: Commit the database contract**

```bash
cd agentwiki
git add apps/server/prisma/schema.prisma apps/server/prisma/migrations/20260825150000_add_page_templates/migration.sql scripts/page-template-schema.test.mjs
git commit -m "feat(page-templates): add immutable template schema"
```

---

### Task 2: Define strict localization helpers and the seven system seeds

**Files:**
- Create: `agentwiki/apps/server/src/page-templates/page-template.types.ts`
- Create: `agentwiki/apps/server/src/page-templates/page-template-definitions.ts`
- Create: `agentwiki/apps/server/src/page-templates/page-template-definitions.spec.ts`

**Interfaces:**
- Consumes: Prisma `PageTemplateCategory`; Node `crypto`.
- Produces: `PageTemplateLocale`, `LocalizedValue`, `BuiltInPageTemplate`, `normalizeTemplateName()`, `templateContentHash()`, `localizedValue()`, and `BUILT_IN_PAGE_TEMPLATES`.

- [ ] **Step 1: Write failing seed and helper tests**

```ts
// page-template-definitions.spec.ts
import { BUILT_IN_PAGE_TEMPLATES } from './page-template-definitions';
import { localizedValue, normalizeTemplateName, templateContentHash } from './page-template.types';

describe('built-in page templates', () => {
  it('defines the exact ordered bilingual catalog', () => {
    expect(BUILT_IN_PAGE_TEMPLATES.map((seed) => seed.stableKey)).toEqual([
      'task-list', 'project-management', 'daily-report', 'weekly-report',
      'meeting-notes', 'decision-record', 'retrospective',
    ]);
    for (const [index, seed] of BUILT_IN_PAGE_TEMPLATES.entries()) {
      expect(seed.displayOrder).toBe(index + 1);
      expect(seed.seedVersion).toBe(1);
      expect(seed.name['zh-CN']).not.toEqual(seed.name.en);
      expect(seed.content['zh-CN']).toContain('## ');
      expect(seed.content.en).toContain('## ');
      expect(Object.isFrozen(seed)).toBe(true);
      expect(Object.isFrozen(seed.content)).toBe(true);
    }
  });

  it('keeps report placeholders only in default titles', () => {
    const serializedContent = JSON.stringify(BUILT_IN_PAGE_TEMPLATES.map((seed) => seed.content));
    expect(serializedContent).not.toMatch(/\{date\}|\{year\}|\{week\}/u);
    expect(BUILT_IN_PAGE_TEMPLATES.find((seed) => seed.stableKey === 'daily-report')?.defaultTitle['zh-CN'])
      .toBe('日报 {date}');
  });

  it('normalizes names, localizes with an explicit fallback, and hashes deterministically', () => {
    expect(normalizeTemplateName('  Weekly   REPORT  ')).toBe('weekly report');
    expect(localizedValue({ en: 'English' }, 'zh-CN', 'en')).toBe('English');
    expect(templateContentHash('# Same')).toBe(templateContentHash('# Same'));
    expect(templateContentHash('# Same')).not.toBe(templateContentHash('# Different'));
  });
});
```

- [ ] **Step 2: Run the seed test and verify the module is missing**

Run: `cd agentwiki && pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/page-template-definitions.spec.ts`

Expected: FAIL with `Cannot find module './page-template-definitions'`.

- [ ] **Step 3: Implement strict locale helpers**

```ts
// page-template.types.ts
import { createHash } from 'crypto';
import { z } from 'zod';

export const PageTemplateLocaleSchema = z.enum(['zh-CN', 'en']);
export type PageTemplateLocale = z.infer<typeof PageTemplateLocaleSchema>;

export const LocalizedValueSchema = z.object({
  'zh-CN': z.string().max(200_000).optional(),
  en: z.string().max(200_000).optional(),
}).strict().refine((value) => value['zh-CN'] !== undefined || value.en !== undefined, {
  message: 'At least one localization is required',
});
export type LocalizedValue = z.infer<typeof LocalizedValueSchema>;

export function systemLocalizedValue(value: unknown): Required<LocalizedValue> {
  const parsed = LocalizedValueSchema.parse(value);
  if (parsed['zh-CN'] === undefined || parsed.en === undefined) {
    throw new TypeError('System page templates require zh-CN and en');
  }
  return { 'zh-CN': parsed['zh-CN'], en: parsed.en };
}

export function localizedValue(
  value: unknown,
  requested: PageTemplateLocale,
  fallback: PageTemplateLocale,
): string {
  const parsed = LocalizedValueSchema.parse(value);
  return parsed[requested] ?? parsed[fallback] ?? parsed.en ?? parsed['zh-CN']!;
}

export function normalizeTemplateName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

export function templateContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
```

- [ ] **Step 4: Implement the exact deeply frozen built-in seeds**

```ts
// page-template-definitions.ts
import { z } from 'zod';
import { deepFreeze, LocalizedValueSchema, systemLocalizedValue } from './page-template.types';

const SeedSchema = z.object({
  stableKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  category: z.enum(['planning', 'reporting', 'knowledge']),
  displayOrder: z.number().int().min(1),
  seedVersion: z.number().int().min(1),
  name: LocalizedValueSchema,
  description: LocalizedValueSchema,
  defaultTitle: LocalizedValueSchema,
  content: LocalizedValueSchema,
}).strict();

export type BuiltInPageTemplate = Readonly<{
  stableKey: string;
  category: 'planning' | 'reporting' | 'knowledge';
  displayOrder: number;
  seedVersion: number;
  name: Readonly<{ 'zh-CN': string; en: string }>;
  description: Readonly<{ 'zh-CN': string; en: string }>;
  defaultTitle: Readonly<{ 'zh-CN': string; en: string }>;
  content: Readonly<{ 'zh-CN': string; en: string }>;
}>;

const defineSeed = (input: unknown): BuiltInPageTemplate => {
  const parsed = SeedSchema.parse(structuredClone(input));
  return deepFreeze({
    ...parsed,
    name: systemLocalizedValue(parsed.name),
    description: systemLocalizedValue(parsed.description),
    defaultTitle: systemLocalizedValue(parsed.defaultTitle),
    content: systemLocalizedValue(parsed.content),
  });
};

export const BUILT_IN_PAGE_TEMPLATES = deepFreeze([
  defineSeed({
    stableKey: 'task-list', category: 'planning', displayOrder: 1, seedVersion: 1,
    name: { 'zh-CN': '任务清单', en: 'Task list' },
    description: { 'zh-CN': '按优先级组织待办、阻塞与已完成事项', en: 'Organize priorities, open tasks, blockers, and completed work' },
    defaultTitle: { 'zh-CN': '任务清单', en: 'Task list' },
    content: {
      'zh-CN': '# 任务清单\n\n## 工作目标\n- \n\n## 最高优先级\n- [ ] \n\n## 待办任务\n- [ ] \n\n## 等待 / 阻塞\n- \n\n## 已完成\n- [x] ',
      en: '# Task list\n\n## Objective\n- \n\n## Top priority\n- [ ] \n\n## Open tasks\n- [ ] \n\n## Waiting / blocked\n- \n\n## Completed\n- [x] ',
    },
  }),
  defineSeed({
    stableKey: 'project-management', category: 'planning', displayOrder: 2, seedVersion: 1,
    name: { 'zh-CN': '项目管理', en: 'Project management' },
    description: { 'zh-CN': '汇总项目目标、里程碑、任务、风险与决策', en: 'Track goals, milestones, tasks, risks, and decisions' },
    defaultTitle: { 'zh-CN': '项目名称', en: 'Project name' },
    content: {
      'zh-CN': '# 项目名称\n\n## 项目概况\n\n| 项目状态 | 负责人 | 开始日期 | 目标日期 |\n|---|---|---|---|\n| 规划中 | 待填写 | YYYY-MM-DD | YYYY-MM-DD |\n\n## 目标\n- \n\n## 不做\n- \n\n## 里程碑\n\n| 里程碑 | 负责人 | 截止日期 | 状态 |\n|---|---|---|---|\n|  |  |  | 未开始 |\n\n## 当前任务\n- [ ] \n\n## 风险与阻塞\n- \n\n## 关键决策\n- \n\n## 进展记录\n- YYYY-MM-DD：',
      en: '# Project name\n\n## Overview\n\n| Status | Owner | Start date | Target date |\n|---|---|---|---|\n| Planning | To assign | YYYY-MM-DD | YYYY-MM-DD |\n\n## Goals\n- \n\n## Non-goals\n- \n\n## Milestones\n\n| Milestone | Owner | Due date | Status |\n|---|---|---|---|\n|  |  |  | Not started |\n\n## Current tasks\n- [ ] \n\n## Risks and blockers\n- \n\n## Key decisions\n- \n\n## Progress log\n- YYYY-MM-DD:',
    },
  }),
  defineSeed({
    stableKey: 'daily-report', category: 'reporting', displayOrder: 3, seedVersion: 1,
    name: { 'zh-CN': '日报', en: 'Daily report' },
    description: { 'zh-CN': '记录当天成果、阻塞与明日计划', en: 'Record daily outcomes, blockers, and tomorrow plan' },
    defaultTitle: { 'zh-CN': '日报 {date}', en: 'Daily report {date}' },
    content: {
      'zh-CN': '# 日报\n\n## 今日完成\n- \n\n## 正在进行\n- \n\n## 问题与阻塞\n- \n\n## 明日计划\n- [ ] \n\n## 需要协助\n- ',
      en: '# Daily report\n\n## Completed today\n- \n\n## In progress\n- \n\n## Issues and blockers\n- \n\n## Tomorrow\'s plan\n- [ ] \n\n## Help needed\n- ',
    },
  }),
  defineSeed({
    stableKey: 'weekly-report', category: 'reporting', displayOrder: 4, seedVersion: 1,
    name: { 'zh-CN': '周报', en: 'Weekly report' },
    description: { 'zh-CN': '汇总本周进展、成果、风险和下周计划', en: 'Summarize progress, outcomes, risks, and next-week plans' },
    defaultTitle: { 'zh-CN': '周报 {year}年第{week}周', en: 'Weekly report {year}-W{week}' },
    content: {
      'zh-CN': '# 周报\n\n## 本周摘要\n- \n\n## 目标进展\n\n| 目标 | 本周进展 | 状态 |\n|---|---|---|\n|  |  | 进行中 |\n\n## 主要成果\n- \n\n## 问题与风险\n- \n\n## 下周计划\n- [ ] \n\n## 需要协调\n- ',
      en: '# Weekly report\n\n## Weekly summary\n- \n\n## Goal progress\n\n| Goal | Progress this week | Status |\n|---|---|---|\n|  |  | In progress |\n\n## Key outcomes\n- \n\n## Issues and risks\n- \n\n## Next-week plan\n- [ ] \n\n## Coordination needed\n- ',
    },
  }),
  defineSeed({
    stableKey: 'meeting-notes', category: 'reporting', displayOrder: 5, seedVersion: 1,
    name: { 'zh-CN': '会议纪要', en: 'Meeting notes' },
    description: { 'zh-CN': '沉淀议程、讨论、决定与行动项', en: 'Capture agenda, discussion, decisions, and action items' },
    defaultTitle: { 'zh-CN': '会议纪要 {date}', en: 'Meeting notes {date}' },
    content: {
      'zh-CN': '# 会议纪要\n\n## 会议信息\n\n| 日期 | 参与人 | 记录人 |\n|---|---|---|\n| YYYY-MM-DD |  |  |\n\n## 会议目标\n- \n\n## 议程\n1. \n\n## 讨论记录\n- \n\n## 已做决定\n- \n\n## 行动项\n\n| 行动项 | 负责人 | 截止日期 |\n|---|---|---|\n|  |  |  |\n\n## 待议事项\n- ',
      en: '# Meeting notes\n\n## Meeting details\n\n| Date | Attendees | Note taker |\n|---|---|---|\n| YYYY-MM-DD |  |  |\n\n## Objective\n- \n\n## Agenda\n1. \n\n## Discussion\n- \n\n## Decisions\n- \n\n## Action items\n\n| Action | Owner | Due date |\n|---|---|---|\n|  |  |  |\n\n## Parking lot\n- ',
    },
  }),
  defineSeed({
    stableKey: 'decision-record', category: 'knowledge', displayOrder: 6, seedVersion: 1,
    name: { 'zh-CN': '决策记录', en: 'Decision record' },
    description: { 'zh-CN': '记录背景、备选方案、最终决定与影响', en: 'Record context, options, the final decision, and impact' },
    defaultTitle: { 'zh-CN': '决策：主题', en: 'Decision: topic' },
    content: {
      'zh-CN': '# 决策：主题\n\n## 决策状态\n- 状态：提议中\n- 日期：YYYY-MM-DD\n- 决策人：\n\n## 背景\n- \n\n## 备选方案\n\n| 方案 | 优点 | 代价 / 风险 |\n|---|---|---|\n|  |  |  |\n\n## 最终决定\n- \n\n## 决定依据\n- \n\n## 影响\n- \n\n## 后续动作\n- [ ] ',
      en: '# Decision: topic\n\n## Decision status\n- Status: Proposed\n- Date: YYYY-MM-DD\n- Decision maker:\n\n## Context\n- \n\n## Options\n\n| Option | Benefits | Costs / risks |\n|---|---|---|\n|  |  |  |\n\n## Final decision\n- \n\n## Rationale\n- \n\n## Impact\n- \n\n## Follow-up actions\n- [ ] ',
    },
  }),
  defineSeed({
    stableKey: 'retrospective', category: 'knowledge', displayOrder: 7, seedVersion: 1,
    name: { 'zh-CN': '复盘总结', en: 'Retrospective' },
    description: { 'zh-CN': '比较目标与结果，把经验转成后续行动', en: 'Compare goals and outcomes, then turn learning into actions' },
    defaultTitle: { 'zh-CN': '复盘：主题', en: 'Retrospective: topic' },
    content: {
      'zh-CN': '# 复盘：主题\n\n## 目标与结果\n- 目标：\n- 结果：\n\n## 做得好的\n- \n\n## 可以改进的\n- \n\n## 原因与洞察\n- \n\n## 行动项\n\n| 行动项 | 负责人 | 截止日期 |\n|---|---|---|\n|  |  |  |\n\n## 后续检查日期\n- YYYY-MM-DD',
      en: '# Retrospective: topic\n\n## Goals and outcomes\n- Goal:\n- Outcome:\n\n## What went well\n- \n\n## What could improve\n- \n\n## Causes and insights\n- \n\n## Action items\n\n| Action | Owner | Due date |\n|---|---|---|\n|  |  |  |\n\n## Follow-up date\n- YYYY-MM-DD',
    },
  }),
]);
```

- [ ] **Step 5: Run the focused tests and typecheck the server**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/page-template-definitions.spec.ts
pnpm --filter @agentwiki/server typecheck
```

Expected: focused Jest suite passes; server typecheck exits 0.

- [ ] **Step 6: Commit the strict system catalog**

```bash
cd agentwiki
git add apps/server/src/page-templates/page-template.types.ts apps/server/src/page-templates/page-template-definitions.ts apps/server/src/page-templates/page-template-definitions.spec.ts
git commit -m "feat(page-templates): define bilingual system catalog"
```

---

### Task 3: Seed, list, read, and resolve authoritative template versions

**Files:**
- Create: `agentwiki/apps/server/src/page-templates/page-template.dto.ts`
- Create: `agentwiki/apps/server/src/page-templates/page-template.dto.spec.ts`
- Create: `agentwiki/apps/server/src/page-templates/page-template.service.ts`
- Create: `agentwiki/apps/server/src/page-templates/page-template.service.spec.ts`
- Modify: `agentwiki/apps/server/src/core/filters/business-error.ts`

**Interfaces:**
- Consumes: `BUILT_IN_PAGE_TEMPLATES`, Prisma delegates from Task 1, `AuthorizationService.assertSpaceAccess()`.
- Produces: `PageTemplateService.seedBuiltIns()`, `list(spaceId, query, principal)`, `get(spaceId, templateId, locale, principal)`, and `resolveVersion(tx, input)` returning `{ content, templateId, version, locale }`.

- [ ] **Step 1: Add failing read/seed/resolution tests**

Create mocked Prisma tests that assert these exact contracts:

```ts
it('seeds a new system template and version atomically', async () => {
  pageTemplate.findUnique.mockResolvedValue(null);
  await service.seedBuiltIns();
  expect(pageTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ scope: 'system', scopeKey: 'system', currentVersion: 1 }),
  }));
  expect(pageTemplateVersion.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ version: 1, sourcePageId: null }),
  }));
});

it('creates only the next immutable version for a newer seed', async () => {
  pageTemplate.findUnique.mockResolvedValue({ id: 'system-1', scope: 'system', currentVersion: 1 });
  pageTemplateVersion.findUnique.mockResolvedValue(null);
  await service.seedOne({ ...BUILT_IN_PAGE_TEMPLATES[0], seedVersion: 2 } as any);
  expect(pageTemplateVersion.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ templateId: 'system-1', version: 2 }),
  }));
  expect(pageTemplate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'system-1', scope: 'system', currentVersion: 1 },
    data: expect.objectContaining({ currentVersion: 2 }),
  }));
});

it('returns localized system summaries plus the current Space page', async () => {
  authorization.assertSpaceAccess.mockResolvedValue({ role: 'editor' });
  pageTemplate.findMany.mockResolvedValueOnce([systemRecord]).mockResolvedValueOnce([spaceRecord]);
  pageTemplate.count.mockResolvedValue(1);
  await expect(service.list('space-1', { locale: 'zh-CN', skip: 0, take: 100 }, principal))
    .resolves.toMatchObject({
      system: [expect.objectContaining({ name: '任务清单' })],
      space: [expect.objectContaining({ name: '团队周报' })],
      totalSpace: 1,
      capabilities: { canManage: false },
    });
});

it('resolves the exact requested old version without silently advancing', async () => {
  pageTemplate.findFirst.mockResolvedValue({
    id: 'space-template', scope: 'space', spaceId: 'space-1', sourceLocale: 'zh-CN', archivedAt: null,
    versions: [{ version: 2, contentI18n: { 'zh-CN': '# Version 2' } }],
  });
  await expect(service.resolveVersion(prisma, {
    spaceId: 'space-1', templateId: 'space-template', version: 2, locale: 'en',
  })).resolves.toEqual({
    content: '# Version 2', templateId: 'space-template', version: 2, locale: 'zh-CN',
  });
});

it('rejects cross-Space, archived, and missing versions with stable codes', async () => {
  pageTemplate.findFirst.mockResolvedValue(null);
  await expect(service.resolveVersion(prisma, {
    spaceId: 'space-2', templateId: 'space-template', version: 1, locale: 'en',
  })).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_NOT_FOUND' });
});
```

- [ ] **Step 2: Run the service test and verify the service is missing**

Run: `cd agentwiki && pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/page-template.service.spec.ts`

Expected: FAIL with `Cannot find module './page-template.service'`.

- [ ] **Step 3: Add exact list and mutation DTO validation**

```ts
// page-template.dto.ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class PageTemplateListQueryDto {
  @IsIn(['zh-CN', 'en']) locale!: 'zh-CN' | 'en';
  @IsOptional() @IsIn(['all', 'system', 'space']) scope?: 'all' | 'system' | 'space';
  @IsOptional() @IsIn(['active', 'archived', 'all']) archived?: 'active' | 'archived' | 'all';
  @IsOptional() @IsIn(['planning', 'reporting', 'knowledge', 'other']) category?: 'planning' | 'reporting' | 'knowledge' | 'other';
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take = 100;
}

export class CreatePageTemplateDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
  @IsIn(['planning', 'reporting', 'knowledge', 'other']) category!: 'planning' | 'reporting' | 'knowledge' | 'other';
  @IsString() @MinLength(1) @MaxLength(200) defaultTitle!: string;
  @IsIn(['zh-CN', 'en']) locale!: 'zh-CN' | 'en';
  @IsString() @MaxLength(100) sourcePageId!: string;
  @IsISO8601({ strict: true }) expectedSourceUpdatedAt!: string;
}

export class UpdatePageTemplateDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string;
  @IsIn(['planning', 'reporting', 'knowledge', 'other']) category!: 'planning' | 'reporting' | 'knowledge' | 'other';
  @IsString() @MinLength(1) @MaxLength(200) defaultTitle!: string;
  @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
}

export class CreatePageTemplateVersionDto {
  @IsString() @MaxLength(100) sourcePageId!: string;
  @IsISO8601({ strict: true }) expectedSourceUpdatedAt!: string;
  @IsInt() @Min(1) @Max(2_147_483_647) expectedCurrentVersion!: number;
}

export class PageTemplateStateDto {
  @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
}
```

- [ ] **Step 4: Add stable business error codes before compiling the service**

Add to `ERROR_CODE_MAP`:

```ts
PAGE_TEMPLATE_INVALID: { status: HttpStatus.BAD_REQUEST, message: 'Page template input is invalid' },
PAGE_TEMPLATE_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'Page template not found' },
PAGE_TEMPLATE_VERSION_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'Page template version not found' },
PAGE_TEMPLATE_ARCHIVED: { status: HttpStatus.CONFLICT, message: 'Page template is archived' },
PAGE_TEMPLATE_VERSION_CONFLICT: { status: HttpStatus.CONFLICT, message: 'Page template changed; reload before saving' },
PAGE_TEMPLATE_NAME_CONFLICT: { status: HttpStatus.CONFLICT, message: 'A Space template already uses this name' },
PAGE_TEMPLATE_QUOTA_EXCEEDED: { status: HttpStatus.TOO_MANY_REQUESTS, message: 'Space page template quota exceeded' },
PAGE_TEMPLATE_PERMISSION_DENIED: { status: HttpStatus.FORBIDDEN, message: 'This human member cannot manage page templates' },
PAGE_TEMPLATE_SOURCE_INVALID: { status: HttpStatus.BAD_REQUEST, message: 'Template source page is invalid' },
PAGE_TEMPLATE_SOURCE_STALE: { status: HttpStatus.CONFLICT, message: 'Template source page changed; reload before saving' },
PAGE_TEMPLATE_SYSTEM_IMMUTABLE: { status: HttpStatus.CONFLICT, message: 'System page templates are immutable' },
PAGE_TEMPLATE_AGENT_UNSUPPORTED: { status: HttpStatus.FORBIDDEN, message: 'Agents cannot use page template source fields' },
```

- [ ] **Step 5: Implement seed/list/get/resolve with strict JSON parsing**

Implement `PageTemplateService` with these public signatures and invariants:

```ts
@Injectable()
export class PageTemplateService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (['api', 'all'].includes(this.config.get<string>('PROCESS_ROLE', 'api'))) {
      await this.seedBuiltIns();
    }
  }

  async seedBuiltIns(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('agentwiki:page-template-seeds'))`;
      for (const seed of BUILT_IN_PAGE_TEMPLATES) await this.seedOne(seed, tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async seedOne(seed: BuiltInPageTemplate, transaction?: Prisma.TransactionClient): Promise<void> {
    const tx = transaction ?? this.prisma;
    const current = await tx.pageTemplate.findUnique({
      where: { scopeKey_stableKey: { scopeKey: 'system', stableKey: seed.stableKey } },
    });
    const contentHash = templateContentHash(JSON.stringify(seed.content));
    if (!current) {
      const created = await tx.pageTemplate.create({ data: {
        scope: 'system', scopeKey: 'system', stableKey: seed.stableKey,
        category: seed.category, displayOrder: seed.displayOrder,
        nameI18n: seed.name as Prisma.InputJsonValue,
        descriptionI18n: seed.description as Prisma.InputJsonValue,
        defaultTitleI18n: seed.defaultTitle as Prisma.InputJsonValue,
        currentVersion: seed.seedVersion,
      }});
      await tx.pageTemplateVersion.create({ data: {
        templateId: created.id, version: seed.seedVersion,
        contentI18n: seed.content as Prisma.InputJsonValue, contentHash, sourcePageId: null,
      }});
      return;
    }
    if (current.scope !== 'system' || current.currentVersion >= seed.seedVersion) return;
    await tx.pageTemplateVersion.create({ data: {
      templateId: current.id, version: seed.seedVersion,
      contentI18n: seed.content as Prisma.InputJsonValue, contentHash, sourcePageId: null,
    }});
    const updated = await tx.pageTemplate.updateMany({
      where: { id: current.id, scope: 'system', currentVersion: current.currentVersion },
      data: {
        category: seed.category, displayOrder: seed.displayOrder,
        nameI18n: seed.name as Prisma.InputJsonValue,
        descriptionI18n: seed.description as Prisma.InputJsonValue,
        defaultTitleI18n: seed.defaultTitle as Prisma.InputJsonValue,
        currentVersion: seed.seedVersion, archivedAt: null,
      },
    });
    if (updated.count !== 1) throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
  }

  async list(spaceId: string, query: PageTemplateListQueryDto, principal: Principal) {
    const member = await this.authorization.assertSpaceAccess(
      principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
    );
    const canManage = !principal.agentId && ['owner', 'admin'].includes(member.role);
    const system = query.scope === 'space' ? [] : await this.prisma.pageTemplate.findMany({
      where: { scope: 'system', archivedAt: null, ...(query.category ? { category: query.category } : {}) },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    });
    const spaceWhere = {
      scope: 'space' as const, spaceId,
      ...(query.archived === 'archived' ? { archivedAt: { not: null } }
        : query.archived === 'all' ? {} : { archivedAt: null }),
      ...(query.category ? { category: query.category } : {}),
      ...(query.q?.trim() ? { nameKey: { contains: normalizeTemplateName(query.q) } } : {}),
    };
    const [space, totalSpace] = query.scope === 'system' ? [[], 0] : await Promise.all([
      this.prisma.pageTemplate.findMany({
        where: spaceWhere, skip: query.skip, take: query.take,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.pageTemplate.count({ where: spaceWhere }),
    ]);
    const systemSummaries = system.map((row) => this.summary(row, query.locale));
    const normalizedQuery = query.q?.trim().toLocaleLowerCase(query.locale);
    return {
      system: normalizedQuery
        ? systemSummaries.filter((row) => row.name.toLocaleLowerCase(query.locale).includes(normalizedQuery))
        : systemSummaries,
      space: space.map((row) => this.summary(row, query.locale)),
      totalSpace, skip: query.skip, take: query.take,
      capabilities: { canManage },
    };
  }

  async resolveVersion(tx: Prisma.TransactionClient, input: {
    spaceId: string; templateId: string; version: number; locale: PageTemplateLocale;
  }): Promise<{ content: string; templateId: string; version: number; locale: PageTemplateLocale }> {
    const template = await tx.pageTemplate.findFirst({
      where: {
        id: input.templateId,
        OR: [{ scope: 'system' }, { scope: 'space', spaceId: input.spaceId }],
      },
      include: { versions: { where: { version: input.version }, take: 1 } },
    });
    if (!template) throw new BusinessException('PAGE_TEMPLATE_NOT_FOUND');
    if (template.archivedAt) throw new BusinessException('PAGE_TEMPLATE_ARCHIVED');
    const version = template.versions[0];
    if (!version) throw new BusinessException('PAGE_TEMPLATE_VERSION_NOT_FOUND');
    const fallback = template.scope === 'system' ? 'en' : PageTemplateLocaleSchema.parse(template.sourceLocale);
    const locale = template.scope === 'system' ? input.locale : fallback;
    return {
      content: localizedValue(version.contentI18n, input.locale, fallback),
      templateId: template.id,
      version: version.version,
      locale,
    };
  }

  async get(spaceId: string, templateId: string, locale: PageTemplateLocale, principal: Principal) {
    await this.authorization.assertSpaceAccess(
      principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
    );
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.pageTemplate.findFirst({
        where: { id: templateId, OR: [{ scope: 'system' }, { scope: 'space', spaceId }] },
      });
      if (!template) throw new BusinessException('PAGE_TEMPLATE_NOT_FOUND');
      if (template.archivedAt) throw new BusinessException('PAGE_TEMPLATE_ARCHIVED');
      const version = await tx.pageTemplateVersion.findUnique({
        where: { templateId_version: { templateId: template.id, version: template.currentVersion } },
      });
      if (!version) throw new BusinessException('PAGE_TEMPLATE_VERSION_NOT_FOUND');
      const fallback = template.scope === 'system' ? 'en' : PageTemplateLocaleSchema.parse(template.sourceLocale);
      const contentLocale = template.scope === 'system' ? locale : fallback;
      return {
        ...this.summary(template, locale),
        content: localizedValue(version.contentI18n, locale, fallback),
        contentLocale,
        sourcePageId: version.sourcePageId,
      };
    });
  }

  private summary(template: PageTemplate, locale: PageTemplateLocale) {
    const fallback = template.scope === 'system' ? 'en' : PageTemplateLocaleSchema.parse(template.sourceLocale);
    return {
      id: template.id, scope: template.scope, stableKey: template.stableKey, category: template.category,
      name: localizedValue(template.nameI18n, locale, fallback),
      description: localizedValue(template.descriptionI18n, locale, fallback),
      defaultTitle: localizedValue(template.defaultTitleI18n, locale, fallback),
      sourceLocale: template.sourceLocale ? PageTemplateLocaleSchema.parse(template.sourceLocale) : null,
      currentVersion: template.currentVersion,
      archivedAt: template.archivedAt?.toISOString() ?? null,
      updatedAt: template.updatedAt.toISOString(),
    };
  }
}
```

The returned object must use `summary()` and `localizedValue()` exactly as above; never pass unvalidated Prisma JSON to the client.

- [ ] **Step 6: Run focused tests, DTO validation tests, and typecheck**

Add DTO tests using `validate()` for missing locale, `take=101`, invalid category, name length 81, invalid ISO timestamps, and valid bodies. Then run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/page-template-definitions.spec.ts src/page-templates/page-template.service.spec.ts src/page-templates/page-template.dto.spec.ts
pnpm --filter @agentwiki/server typecheck
```

Expected: all focused suites pass; typecheck exits 0.

- [ ] **Step 7: Commit the read and seed domain**

```bash
cd agentwiki
git add apps/server/src/page-templates apps/server/src/core/filters/business-error.ts
git commit -m "feat(page-templates): seed and resolve template versions"
```

---

### Task 4: Implement Space template management with live authorization and optimistic writes

**Files:**
- Modify: `agentwiki/apps/server/src/page-templates/page-template.service.ts`
- Modify: `agentwiki/apps/server/src/page-templates/page-template.service.spec.ts`

**Interfaces:**
- Consumes: DTOs and read service from Task 3; `AuthorizationService.assertLiveHumanSpaceAccess()`.
- Produces: `createSpaceTemplate()`, `updateMetadata()`, `createVersion()`, `archive()`, and `restore()`.

- [ ] **Step 1: Add failing management and race-safety tests**

```ts
it('creates a Space template only from the exact persisted Markdown page', async () => {
  authorization.assertLiveHumanSpaceAccess.mockResolvedValue({ role: 'owner' });
  pageTemplate.count.mockResolvedValue(0);
  page.findFirst.mockResolvedValue({
    id: 'page-1', spaceId: 'space-1', format: 'markdown', content: '# Team weekly',
    updatedAt: new Date('2026-08-25T10:00:00.000Z'),
  });
  await service.createSpaceTemplate('space-1', {
    name: ' Team Weekly ', description: 'Shared format', category: 'reporting',
    defaultTitle: 'Team weekly', locale: 'en', sourcePageId: 'page-1',
    expectedSourceUpdatedAt: '2026-08-25T10:00:00.000Z',
  }, principal);
  expect(pageTemplate.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    scope: 'space', scopeKey: 'space-1', nameKey: 'team weekly', sourceLocale: 'en',
  }) }));
  expect(pageTemplateVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    version: 1, contentI18n: { en: '# Team weekly' }, sourcePageId: 'page-1',
  }) }));
});

it.each([
  [{ format: 'html', deletedAt: null }, 'PAGE_TEMPLATE_SOURCE_INVALID'],
  [{ format: 'markdown', deletedAt: new Date() }, 'PAGE_TEMPLATE_SOURCE_INVALID'],
  [{ format: 'markdown', deletedAt: null, content: 'x'.repeat(200_001) }, 'PAGE_TEMPLATE_SOURCE_INVALID'],
  [{ format: 'markdown', deletedAt: null, updatedAt: new Date('2026-08-25T11:00:00.000Z') }, 'PAGE_TEMPLATE_SOURCE_STALE'],
])('rejects invalid or stale source pages', async (override, code) => {
  page.findFirst.mockResolvedValue({
    id: 'page-1', spaceId: 'space-1', content: '# Source',
    updatedAt: new Date('2026-08-25T10:00:00.000Z'), ...override,
  });
  await expect(service.createSpaceTemplate('space-1', validCreateBody, principal))
    .rejects.toMatchObject({ businessCode: code });
});

it('returns the current version without writing when source content is unchanged', async () => {
  const current = spaceTemplate({ currentVersion: 3, sourceLocale: 'en' });
  pageTemplate.findFirst.mockResolvedValue(current);
  pageTemplate.findUnique.mockResolvedValue(current);
  pageTemplateVersion.findUnique
    .mockResolvedValueOnce({ version: 3, contentHash: templateContentHash('# Same') })
    .mockResolvedValueOnce({ version: 3, contentHash: templateContentHash('# Same'), contentI18n: { en: '# Same' }, sourcePageId: 'page-1' });
  page.findFirst.mockResolvedValue(markdownPage({ content: '# Same' }));
  await expect(service.createVersion('space-1', 'template-1', {
    sourcePageId: 'page-1', expectedSourceUpdatedAt: sourceTimestamp, expectedCurrentVersion: 3,
  }, principal)).resolves.toMatchObject({ currentVersion: 3, noChange: true });
  expect(pageTemplateVersion.create).not.toHaveBeenCalled();
});

it('creates version N+1 and advances the pointer only from expected N', async () => {
  pageTemplate.findFirst.mockResolvedValue(spaceTemplate({ currentVersion: 3 }));
  pageTemplateVersion.findUnique.mockResolvedValue({ version: 3, contentHash: 'old' });
  page.findFirst.mockResolvedValue(markdownPage({ content: '# New' }));
  pageTemplate.updateMany.mockResolvedValue({ count: 1 });
  await service.createVersion('space-1', 'template-1', {
    sourcePageId: 'page-1', expectedSourceUpdatedAt: sourceTimestamp, expectedCurrentVersion: 3,
  }, principal);
  expect(pageTemplateVersion.create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ version: 4 }),
  }));
  expect(pageTemplate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: 'template-1', currentVersion: 3 }),
    data: expect.objectContaining({ currentVersion: 4 }),
  }));
});

it('requires live Owner/Admin authorization for every mutation', async () => {
  authorization.assertLiveHumanSpaceAccess.mockRejectedValue(
    new BusinessException('SPACE_ACCESS_DENIED'),
  );
  await expect(service.archive('space-1', 'template-1', { expectedUpdatedAt: templateTimestamp }, principal))
    .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_PERMISSION_DENIED' });
  expect(pageTemplate.updateMany).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the mutation tests and verify methods are missing**

Run: `cd agentwiki && pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/page-template.service.spec.ts`

Expected: FAIL because `createSpaceTemplate`, `createVersion`, and `archive` are undefined.

- [ ] **Step 3: Implement live management authorization and exact source loading**

```ts
private async assertCanManage(
  tx: Prisma.TransactionClient,
  principal: Principal,
  spaceId: string,
): Promise<void> {
  try {
    await this.authorization.assertLiveHumanSpaceAccess(tx, principal, spaceId, ['owner', 'admin']);
  } catch (error) {
    if (error instanceof BusinessException && error.businessCode === 'SPACE_ACCESS_DENIED') {
      throw new BusinessException('PAGE_TEMPLATE_PERMISSION_DENIED');
    }
    throw error;
  }
}

private async sourceMarkdown(
  tx: Prisma.TransactionClient,
  spaceId: string,
  pageId: string,
  expectedUpdatedAt: string,
) {
  const source = await tx.page.findFirst({
    where: { id: pageId, spaceId, deletedAt: null },
    select: { id: true, content: true, format: true, updatedAt: true },
  });
  if (!source || source.format !== 'markdown') {
    throw new BusinessException('PAGE_TEMPLATE_SOURCE_INVALID');
  }
  if (source.content.length > 200_000) {
    throw new BusinessException('PAGE_TEMPLATE_SOURCE_INVALID');
  }
  if (source.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
    throw new BusinessException('PAGE_TEMPLATE_SOURCE_STALE');
  }
  return source;
}

private async requireSpaceTemplate(tx: Prisma.TransactionClient, spaceId: string, templateId: string) {
  const template = await tx.pageTemplate.findFirst({ where: { id: templateId, spaceId, scope: 'space' } });
  if (!template) {
    const system = await tx.pageTemplate.findFirst({ where: { id: templateId, scope: 'system' }, select: { id: true } });
    throw new BusinessException(system ? 'PAGE_TEMPLATE_SYSTEM_IMMUTABLE' : 'PAGE_TEMPLATE_NOT_FOUND');
  }
  return template;
}

private async allocateStableKey(tx: Prisma.TransactionClient, spaceId: string, name: string): Promise<string> {
  const base = name.normalize('NFKC').toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 64) || 'template';
  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const stableKey = suffix === 1 ? base : `${base.slice(0, 60)}-${suffix}`;
    const used = await tx.pageTemplate.findUnique({
      where: { scopeKey_stableKey: { scopeKey: spaceId, stableKey } }, select: { id: true },
    });
    if (!used) return stableKey;
  }
  throw new BusinessException('PAGE_TEMPLATE_NAME_CONFLICT');
}

private async getManagedRecord(tx: Prisma.TransactionClient, templateId: string, locale: PageTemplateLocale) {
  const template = await tx.pageTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new BusinessException('PAGE_TEMPLATE_NOT_FOUND');
  const version = await tx.pageTemplateVersion.findUnique({
    where: { templateId_version: { templateId, version: template.currentVersion } },
  });
  if (!version) throw new BusinessException('PAGE_TEMPLATE_VERSION_NOT_FOUND');
  return {
    ...this.summary(template, locale),
    content: localizedValue(version.contentI18n, locale, locale),
    contentLocale: locale,
    sourcePageId: version.sourcePageId,
  };
}

private rethrowNameConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new BusinessException('PAGE_TEMPLATE_NAME_CONFLICT');
  }
  throw error;
}
```

- [ ] **Step 4: Implement Space template creation in a serializable transaction**

```ts
async createSpaceTemplate(
  spaceId: string,
  body: CreatePageTemplateDto,
  principal: Principal,
) {
  return this.prisma.$transaction(async (tx) => {
    await this.assertCanManage(tx, principal, spaceId);
    const activeCount = await tx.pageTemplate.count({
      where: { spaceId, scope: 'space', archivedAt: null },
    });
    if (activeCount >= 100) throw new BusinessException('PAGE_TEMPLATE_QUOTA_EXCEEDED');
    const source = await this.sourceMarkdown(tx, spaceId, body.sourcePageId, body.expectedSourceUpdatedAt);
    const name = body.name.trim().replace(/\s+/gu, ' ');
    const nameKey = normalizeTemplateName(name);
    const existing = await tx.pageTemplate.findUnique({
      where: { spaceId_nameKey: { spaceId, nameKey } },
    });
    if (existing) throw new BusinessException('PAGE_TEMPLATE_NAME_CONFLICT');
    const stableKey = await this.allocateStableKey(tx, spaceId, name);
    const localized = <T extends string>(value: T) => ({ [body.locale]: value });
    const created = await tx.pageTemplate.create({ data: {
      scope: 'space', scopeKey: spaceId, spaceId, stableKey,
      category: body.category, nameI18n: localized(name), nameKey,
      descriptionI18n: localized(body.description?.trim() ?? ''),
      defaultTitleI18n: localized(body.defaultTitle.trim()),
      sourceLocale: body.locale, currentVersion: 1,
      createdById: principal.userId, updatedById: principal.userId,
    }});
    await tx.pageTemplateVersion.create({ data: {
      templateId: created.id, version: 1,
      contentI18n: localized(source.content),
      contentHash: templateContentHash(source.content),
      sourcePageId: source.id, createdById: principal.userId,
    }});
    return this.getManagedRecord(tx, created.id, body.locale);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    .catch((error) => this.rethrowNameConflict(error));
}
```

The explicit `P2002` mapping is required because two concurrent creates can pass the friendly preflight check. It preserves a stable `PAGE_TEMPLATE_NAME_CONFLICT` contract instead of leaking a Prisma error.

- [ ] **Step 5: Implement metadata update, immutable content update, archive, and restore**

Use `updateMany` with exact optimistic predicates; never call unconditional `update` for these state changes:

```ts
async updateMetadata(spaceId: string, templateId: string, body: UpdatePageTemplateDto, principal: Principal) {
  return this.prisma.$transaction(async (tx) => {
    await this.assertCanManage(tx, principal, spaceId);
    const current = await this.requireSpaceTemplate(tx, spaceId, templateId);
    const name = body.name.trim().replace(/\s+/gu, ' ');
    const nameKey = normalizeTemplateName(name);
    const duplicate = await tx.pageTemplate.findFirst({
      where: { spaceId, nameKey, id: { not: templateId } }, select: { id: true },
    });
    if (duplicate) throw new BusinessException('PAGE_TEMPLATE_NAME_CONFLICT');
    const locale = PageTemplateLocaleSchema.parse(current.sourceLocale);
    const changed = await tx.pageTemplate.updateMany({
      where: { id: templateId, spaceId, scope: 'space', updatedAt: new Date(body.expectedUpdatedAt) },
      data: {
        nameI18n: { [locale]: name }, nameKey,
        descriptionI18n: { [locale]: body.description?.trim() ?? '' },
        defaultTitleI18n: { [locale]: body.defaultTitle.trim() },
        category: body.category, updatedById: principal.userId,
      },
    });
    if (changed.count !== 1) throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
    return this.getManagedRecord(tx, templateId, locale);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    .catch((error) => this.rethrowNameConflict(error));
}

async createVersion(spaceId: string, templateId: string, body: CreatePageTemplateVersionDto, principal: Principal) {
  return this.prisma.$transaction(async (tx) => {
    await this.assertCanManage(tx, principal, spaceId);
    const current = await this.requireSpaceTemplate(tx, spaceId, templateId);
    if (current.currentVersion !== body.expectedCurrentVersion) {
      throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
    }
    const source = await this.sourceMarkdown(tx, spaceId, body.sourcePageId, body.expectedSourceUpdatedAt);
    const hash = templateContentHash(source.content);
    const previous = await tx.pageTemplateVersion.findUnique({
      where: { templateId_version: { templateId, version: current.currentVersion } },
    });
    if (previous?.contentHash === hash) {
      return { ...(await this.getManagedRecord(tx, templateId, PageTemplateLocaleSchema.parse(current.sourceLocale))), noChange: true };
    }
    const nextVersion = current.currentVersion + 1;
    const locale = PageTemplateLocaleSchema.parse(current.sourceLocale);
    await tx.pageTemplateVersion.create({ data: {
      templateId, version: nextVersion, contentI18n: { [locale]: source.content },
      contentHash: hash, sourcePageId: source.id, createdById: principal.userId,
    }});
    const changed = await tx.pageTemplate.updateMany({
      where: { id: templateId, spaceId, scope: 'space', currentVersion: current.currentVersion, archivedAt: null },
      data: { currentVersion: nextVersion, updatedById: principal.userId },
    });
    if (changed.count !== 1) throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
    return this.getManagedRecord(tx, templateId, locale);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async archive(spaceId: string, templateId: string, body: PageTemplateStateDto, principal: Principal) {
  return this.prisma.$transaction(async (tx) => {
    await this.assertCanManage(tx, principal, spaceId);
    const current = await this.requireSpaceTemplate(tx, spaceId, templateId);
    const locale = PageTemplateLocaleSchema.parse(current.sourceLocale);
    const changed = await tx.pageTemplate.updateMany({
      where: {
        id: templateId, spaceId, scope: 'space', archivedAt: null,
        updatedAt: new Date(body.expectedUpdatedAt),
      },
      data: { archivedAt: new Date(), updatedById: principal.userId },
    });
    if (changed.count !== 1) throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
    return this.getManagedRecord(tx, templateId, locale);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async restore(spaceId: string, templateId: string, body: PageTemplateStateDto, principal: Principal) {
  return this.prisma.$transaction(async (tx) => {
    await this.assertCanManage(tx, principal, spaceId);
    const current = await this.requireSpaceTemplate(tx, spaceId, templateId);
    if (!current.archivedAt) throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
    const activeCount = await tx.pageTemplate.count({
      where: { spaceId, scope: 'space', archivedAt: null },
    });
    if (activeCount >= 100) throw new BusinessException('PAGE_TEMPLATE_QUOTA_EXCEEDED');
    const locale = PageTemplateLocaleSchema.parse(current.sourceLocale);
    const changed = await tx.pageTemplate.updateMany({
      where: {
        id: templateId, spaceId, scope: 'space', archivedAt: { not: null },
        updatedAt: new Date(body.expectedUpdatedAt),
      },
      data: { archivedAt: null, updatedById: principal.userId },
    });
    if (changed.count !== 1) throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
    return this.getManagedRecord(tx, templateId, locale);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
```

`requireSpaceTemplate()` supplies the system-ID rejection contract, while both writes use live authorization and optimistic timestamps. Keep the archived record readable to managers so `getManagedRecord()` can return the mutation result.

- [ ] **Step 6: Run focused tests and server typecheck**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/page-template.service.spec.ts
pnpm --filter @agentwiki/server typecheck
```

Expected: service suite passes, including no-op hash, stale source, live permission, quota, name uniqueness, version race, archive, and restore tests.

- [ ] **Step 7: Commit the management service**

```bash
cd agentwiki
git add apps/server/src/page-templates/page-template.service.ts apps/server/src/page-templates/page-template.service.spec.ts
git commit -m "feat(page-templates): manage Space template snapshots"
```

---

### Task 5: Expose the human-only page-template HTTP domain

**Files:**
- Create: `agentwiki/apps/server/src/page-templates/page-template.controller.ts`
- Create: `agentwiki/apps/server/src/page-templates/page-template.controller.spec.ts`
- Create: `agentwiki/apps/server/src/page-templates/page-template.module.ts`
- Modify: `agentwiki/apps/server/src/page-templates/page-template.dto.ts`
- Modify: `agentwiki/apps/server/src/app.module.ts`

**Interfaces:**
- Consumes: management methods from Task 4, `CombinedAuthGuard`, `HumanOnlyGuard`.
- Produces: `/spaces/:spaceId/page-templates` HTTP surface and exported `PageTemplateService` for PageModule.

- [ ] **Step 1: Add failing controller delegation tests**

```ts
describe('PageTemplateController', () => {
  const service = {
    list: jest.fn(), get: jest.fn(), createSpaceTemplate: jest.fn(), updateMetadata: jest.fn(),
    createVersion: jest.fn(), archive: jest.fn(), restore: jest.fn(),
  } as any;
  const controller = new PageTemplateController(service);
  const request = { user: { userId: 'user-1' } } as any;

  it('passes locale and filters to the list service', async () => {
    await controller.list(request, 'space-1', { locale: 'zh-CN', scope: 'all', skip: 0, take: 100 });
    expect(service.list).toHaveBeenCalledWith(
      'space-1', { locale: 'zh-CN', scope: 'all', skip: 0, take: 100 }, request.user,
    );
  });

  it('delegates every mutation with the request principal', async () => {
    await controller.create(request, 'space-1', createBody);
    await controller.update(request, 'space-1', 'template-1', updateBody);
    await controller.createVersion(request, 'space-1', 'template-1', versionBody);
    await controller.archive(request, 'space-1', 'template-1', stateBody);
    await controller.restore(request, 'space-1', 'template-1', stateBody);
    expect(service.createSpaceTemplate).toHaveBeenCalledWith('space-1', createBody, request.user);
    expect(service.updateMetadata).toHaveBeenCalledWith('space-1', 'template-1', updateBody, request.user);
    expect(service.createVersion).toHaveBeenCalledWith('space-1', 'template-1', versionBody, request.user);
    expect(service.archive).toHaveBeenCalledWith('space-1', 'template-1', stateBody, request.user);
    expect(service.restore).toHaveBeenCalledWith('space-1', 'template-1', stateBody, request.user);
  });
});
```

- [ ] **Step 2: Run the controller test and verify the controller is missing**

Run: `cd agentwiki && pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates/page-template.controller.spec.ts`

Expected: FAIL with `Cannot find module './page-template.controller'`.

- [ ] **Step 3: Add the locale-only detail query DTO**

```ts
export class PageTemplateLocaleQueryDto {
  @IsIn(['zh-CN', 'en']) locale!: 'zh-CN' | 'en';
}
```

- [ ] **Step 4: Implement the exact controller surface**

```ts
@Controller('spaces/:spaceId/page-templates')
@UseGuards(CombinedAuthGuard, HumanOnlyGuard)
export class PageTemplateController {
  constructor(private readonly templates: PageTemplateService) {}

  @Get()
  list(@Req() req: Request, @Param('spaceId') spaceId: string, @Query() query: PageTemplateListQueryDto) {
    return this.templates.list(spaceId, query, req.user as Principal);
  }

  @Get(':templateId')
  get(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Query() query: PageTemplateLocaleQueryDto) {
    return this.templates.get(spaceId, templateId, query.locale, req.user as Principal);
  }

  @Post()
  create(@Req() req: Request, @Param('spaceId') spaceId: string, @Body() body: CreatePageTemplateDto) {
    return this.templates.createSpaceTemplate(spaceId, body, req.user as Principal);
  }

  @Patch(':templateId')
  update(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Body() body: UpdatePageTemplateDto) {
    return this.templates.updateMetadata(spaceId, templateId, body, req.user as Principal);
  }

  @Post(':templateId/versions')
  createVersion(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Body() body: CreatePageTemplateVersionDto) {
    return this.templates.createVersion(spaceId, templateId, body, req.user as Principal);
  }

  @Delete(':templateId')
  archive(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Body() body: PageTemplateStateDto) {
    return this.templates.archive(spaceId, templateId, body, req.user as Principal);
  }

  @Post(':templateId/restore')
  restore(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('templateId') templateId: string, @Body() body: PageTemplateStateDto) {
    return this.templates.restore(spaceId, templateId, body, req.user as Principal);
  }
}
```

- [ ] **Step 5: Wire and export the domain module**

```ts
// page-template.module.ts
@Module({
  imports: [DatabaseModule, AuthorizationModule, AuthModule, ConfigModule],
  controllers: [PageTemplateController],
  providers: [PageTemplateService],
  exports: [PageTemplateService],
})
export class PageTemplateModule {}
```

Import `PageTemplateModule` once in `AppModule`. Do not import collaboration template services or expose page-template endpoints from the collaboration controller.

- [ ] **Step 6: Run controller, DTO, service, guard regression, and typecheck**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates src/core/auth/human-only.guard.spec.ts
pnpm --filter @agentwiki/server typecheck
```

Expected: page-template and HumanOnlyGuard suites pass; typecheck exits 0.

- [ ] **Step 7: Commit the HTTP domain**

```bash
cd agentwiki
git add apps/server/src/page-templates/page-template.controller.ts apps/server/src/page-templates/page-template.controller.spec.ts apps/server/src/page-templates/page-template.module.ts apps/server/src/page-templates/page-template.dto.ts apps/server/src/app.module.ts
git commit -m "feat(page-templates): expose human template API"
```

---

### Task 6: Create pages from an exact immutable version and reject Agent template fields

**Files:**
- Create: `agentwiki/apps/server/src/core/dto/page-template-create.validator.ts`
- Create: `agentwiki/apps/server/src/core/dto/page-template-create.validator.spec.ts`
- Modify: `agentwiki/apps/server/src/core/dto/page.dto.ts`
- Modify: `agentwiki/apps/server/src/core/dto/page.dto.spec.ts`
- Modify: `agentwiki/apps/server/src/core/page/page.service.ts`
- Modify: `agentwiki/apps/server/src/core/page/page.service.spec.ts`
- Modify: `agentwiki/apps/server/src/core/page/page.controller.ts`
- Modify: `agentwiki/apps/server/src/review/agent-write-boundary.spec.ts`
- Modify: `agentwiki/apps/server/src/core/page/page.module.ts`

**Interfaces:**
- Consumes: `PageTemplateService.resolveVersion()` from Task 3.
- Produces: optional create fields `templateId`, `templateVersion`, `templateLocale`; persisted Page provenance; explicit `PAGE_TEMPLATE_AGENT_UNSUPPORTED` boundary.

- [ ] **Step 1: Add failing DTO shape tests**

```ts
it.each([
  [{ title: 'Blank', spaceId: 'space-1' }, true],
  [{ title: 'Direct', spaceId: 'space-1', content: '# Direct' }, true],
  [{ title: 'From template', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'zh-CN' }, true],
  [{ title: 'Partial', spaceId: 'space-1', templateId: 'template-1' }, false],
  [{ title: 'Mixed', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'en', content: '# Forged' }, false],
  [{ title: 'Wrong format', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'en', format: 'html' }, false],
])('validates the mutually exclusive template create shape %#', async (input, valid) => {
  const errors = await validate(Object.assign(new CreatePageDto(), input));
  expect(errors.length === 0).toBe(valid);
});
```

- [ ] **Step 2: Add failing PageService and Agent boundary tests**

```ts
it('copies the exact resolved version and stores provenance in the existing transaction', async () => {
  mockTemplates.resolveVersion.mockResolvedValue({
    content: '# Weekly v2', templateId: 'template-1', version: 2, locale: 'zh-CN',
  });
  mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
  mockPrisma.page.create.mockResolvedValue({
    id: 'page-1', knowledgeKey: 'knowledge-1', title: '周报', content: '# Weekly v2',
    sourceTemplateId: 'template-1', sourceTemplateVersion: 2, sourceTemplateLocale: 'zh-CN',
  });
  await service.create({
    title: '周报', spaceId: 'space-1', templateId: 'template-1', templateVersion: 2, templateLocale: 'zh-CN',
  }, 'user-1');
  expect(mockTemplates.resolveVersion).toHaveBeenCalledWith(expect.anything(), {
    spaceId: 'space-1', templateId: 'template-1', version: 2, locale: 'zh-CN',
  });
  expect(mockPrisma.page.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    content: '# Weekly v2', format: 'markdown',
    sourceTemplateId: 'template-1', sourceTemplateVersion: 2, sourceTemplateLocale: 'zh-CN',
  }) }));
  expect(mockRevisionWriter.advance).toHaveBeenCalledWith(
    expect.anything(), 'space-1', [expect.objectContaining({ body: '# Weekly v2' })], expect.anything(),
  );
});

it('rejects Agent template fields before opening a ChangeSet', async () => {
  const controller = new PageController(pages, authorization, review);
  await expect(controller.create({
    title: 'Forged', spaceId: 'space-1', templateId: 'template-1', templateVersion: 1, templateLocale: 'en',
  } as any, { user: { userId: 'owner-1', agentId: 'agent-1' } } as any))
    .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_AGENT_UNSUPPORTED' });
  expect(review.propose).not.toHaveBeenCalled();
  expect(pages.create).not.toHaveBeenCalled();
});

```

- [ ] **Step 3: Run focused tests and verify the new behavior fails**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/core/dto/page.dto.spec.ts src/core/page/page.service.spec.ts src/review/agent-write-boundary.spec.ts
```

Expected: FAIL because template fields, resolver injection, provenance writes, and Agent rejection do not exist.

- [ ] **Step 4: Implement the class-level create-shape validator**

```ts
// page-template-create.validator.ts
import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

interface TemplateCreateShape {
  templateId?: unknown;
  templateVersion?: unknown;
  templateLocale?: unknown;
  content?: unknown;
  format?: unknown;
}

export function IsPageTemplateCreateShape(options?: ValidationOptions) {
  return (target: object, propertyName: string) => registerDecorator({
    name: 'isPageTemplateCreateShape', target: target.constructor, propertyName, options,
    validator: {
      validate(_value: unknown, args: ValidationArguments) {
        const body = args.object as TemplateCreateShape;
        const count = [body.templateId, body.templateVersion, body.templateLocale]
          .filter((value) => value !== undefined).length;
        if (count === 0) return true;
        return count === 3 && body.content === undefined && (body.format === undefined || body.format === 'markdown');
      },
      defaultMessage: () => 'templateId, templateVersion, and templateLocale must appear together without content or non-Markdown format',
    },
  });
}
```

Add its own unit test for 0/1/2/3 template fields, content mixing, and `format: html`.

- [ ] **Step 5: Extend `CreatePageDto` with validated optional template fields**

```ts
// Attach the object-shape validator to required spaceId so class-validator always runs it,
// including malformed bodies that provide templateVersion/templateLocale without templateId.
@IsString()
@MaxLength(100)
@IsPageTemplateCreateShape()
spaceId: string;

@IsOptional()
@IsString()
@MaxLength(100)
templateId?: string;

@IsOptional()
@IsInt()
@Min(1)
@Max(2_147_483_647)
templateVersion?: number;

@IsOptional()
@IsIn(['zh-CN', 'en'])
templateLocale?: 'zh-CN' | 'en';
```

Import `IsInt`, `Min`, `Max`, and the custom validator. Keep existing `content`, `format`, blank create, and direct-content validation unchanged.

- [ ] **Step 6: Resolve content inside the page-create transaction**

Inject `PageTemplateService` into `PageService`. Inside the existing transaction, immediately after `lockSpace()` and before path allocation, add:

```ts
const template = data.templateId ? await this.pageTemplates.resolveVersion(lockedTx, {
  spaceId: data.spaceId,
  templateId: data.templateId,
  version: data.templateVersion!,
  locale: data.templateLocale!,
}) : null;
const initialContent = template?.content ?? data.content ?? '';
```

Use `initialContent` in `tx.page.create()` and `advanceRevision()`. Add to the page create data:

```ts
format: template ? 'markdown' : (data.format ?? 'markdown'),
sourceTemplateId: template?.templateId,
sourceTemplateVersion: template?.version,
sourceTemplateLocale: template?.locale,
```

Add the three source fields to `PAGE_PUBLIC_FIELDS` so the created page and later reads expose provenance.

- [ ] **Step 7: Reject Agent template fields before the review branch**

Keep the existing human create authorization call exactly as `['owner', 'editor'], 'pages:write'`; the shared authorization layer already treats Human Admin as satisfying this editor-level gate, while Agent roles remain exact. Do not add a page-template-specific role override. After `assertSpaceAccess()` and before `if (user.agentId)`, add:

```ts
if (user.agentId && (dto.templateId !== undefined || dto.templateVersion !== undefined || dto.templateLocale !== undefined)) {
  throw new BusinessException('PAGE_TEMPLATE_AGENT_UNSUPPORTED');
}
```

Do not resolve a template or copy content into an Agent ChangeSet.

- [ ] **Step 8: Wire the resolver into PageModule and update test providers**

Import `PageTemplateModule` in `PageModule`. In `page.service.spec.ts`, provide:

```ts
const mockTemplates = { resolveVersion: jest.fn() };
{ provide: PageTemplateService, useValue: mockTemplates }
```

Update every direct `new PageService` construction in the test file to pass `mockTemplates` in the exact constructor position.

- [ ] **Step 9: Run page, DTO, review-boundary, and template regressions**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/server exec jest --runInBand src/core/dto/page-template-create.validator.spec.ts src/core/dto/page.dto.spec.ts src/core/page/page.service.spec.ts src/review/agent-write-boundary.spec.ts src/page-templates
pnpm --filter @agentwiki/server typecheck
```

Expected: all suites pass; existing direct page creation and Agent explicit-content proposal tests remain green.

- [ ] **Step 10: Commit exact-version page creation**

```bash
cd agentwiki
git add apps/server/src/core/dto apps/server/src/core/page apps/server/src/review/agent-write-boundary.spec.ts
git commit -m "feat(pages): create from immutable template versions"
```

---

### Task 7: Add client contracts, API adapters, title interpolation, and bilingual copy

**Files:**
- Create: `agentwiki/apps/client/src/features/page-templates/pageTemplateTypes.ts`
- Create: `agentwiki/apps/client/src/features/page-templates/pageTemplateApi.ts`
- Create: `agentwiki/apps/client/src/features/page-templates/pageTemplateApi.spec.ts`
- Create: `agentwiki/apps/client/src/features/page-templates/defaultPageTitle.ts`
- Create: `agentwiki/apps/client/src/features/page-templates/defaultPageTitle.spec.ts`
- Modify: `agentwiki/apps/client/src/i18n/messages.ts`
- Modify: `agentwiki/apps/client/src/api/error-message.ts`
- Modify: `agentwiki/apps/client/src/api/error-message.spec.ts`

**Interfaces:**
- Consumes: HTTP response shapes from Task 5.
- Produces: typed API methods and `interpolateDefaultPageTitle(template, now)` used by every client screen.

- [ ] **Step 1: Write failing date/title tests**

```ts
describe('interpolateDefaultPageTitle', () => {
  const now = new Date(2026, 7, 25, 12, 0, 0);
  it('uses local YYYY-MM-DD and ISO week tokens', () => {
    expect(interpolateDefaultPageTitle('日报 {date}', now)).toBe('日报 2026-08-25');
    expect(interpolateDefaultPageTitle('周报 {year}年第{week}周', now)).toBe('周报 2026年第35周');
    expect(interpolateDefaultPageTitle('Weekly {year}-W{week}', now)).toBe('Weekly 2026-W35');
  });
  it('leaves custom titles without recognized tokens unchanged', () => {
    expect(interpolateDefaultPageTitle('Team {name}', now)).toBe('Team {name}');
  });
});
```

- [ ] **Step 2: Write failing API adapter tests**

```ts
it('loads a localized active catalog with fixed bounds', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: catalog } as any);
  await expect(listPageTemplates('space-1', { locale: 'zh-CN' })).resolves.toEqual(catalog);
  expect(api.get).toHaveBeenCalledWith('/spaces/space-1/page-templates', {
    params: { locale: 'zh-CN', scope: 'all', archived: 'active', skip: 0, take: 100 },
  });
});

it('sends DELETE optimistic state in the request body', async () => {
  vi.mocked(api.delete).mockResolvedValue({ data: template } as any);
  await archivePageTemplate('space-1', 'template-1', '2026-08-25T10:00:00.000Z');
  expect(api.delete).toHaveBeenCalledWith('/spaces/space-1/page-templates/template-1', {
    data: { expectedUpdatedAt: '2026-08-25T10:00:00.000Z' },
  });
});
```

- [ ] **Step 3: Run client tests and verify the modules are missing**

Run: `cd agentwiki && pnpm --filter @agentwiki/client test -- src/features/page-templates/defaultPageTitle.spec.ts src/features/page-templates/pageTemplateApi.spec.ts`

Expected: FAIL with missing module errors.

- [ ] **Step 4: Add exact client contracts**

```ts
// pageTemplateTypes.ts
export type PageTemplateLocale = 'zh-CN' | 'en';
export type PageTemplateScope = 'system' | 'space';
export type PageTemplateCategory = 'planning' | 'reporting' | 'knowledge' | 'other';

export interface PageTemplateSummary {
  id: string;
  scope: PageTemplateScope;
  stableKey: string;
  category: PageTemplateCategory;
  name: string;
  description: string;
  defaultTitle: string;
  sourceLocale: PageTemplateLocale | null;
  currentVersion: number;
  archivedAt: string | null;
  updatedAt: string;
}

export interface PageTemplateListResponse {
  system: PageTemplateSummary[];
  space: PageTemplateSummary[];
  totalSpace: number;
  skip: number;
  take: number;
  capabilities: { canManage: boolean };
}

export interface PageTemplateDetail extends PageTemplateSummary {
  content: string;
  contentLocale: PageTemplateLocale;
  sourcePageId: string | null;
}

export interface SavePageTemplateInput {
  name: string;
  description?: string;
  category: PageTemplateCategory;
  defaultTitle: string;
  locale: PageTemplateLocale;
  sourcePageId: string;
  expectedSourceUpdatedAt: string;
}
```

- [ ] **Step 5: Implement local ISO-week title interpolation**

```ts
// defaultPageTitle.ts
const pad2 = (value: number) => String(value).padStart(2, '0');

const isoWeek = (source: Date) => {
  const date = new Date(Date.UTC(source.getFullYear(), source.getMonth(), source.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return { year, week };
};

export function interpolateDefaultPageTitle(template: string, now = new Date()): string {
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const { year, week } = isoWeek(now);
  return template
    .split('{date}').join(date)
    .split('{year}').join(String(year))
    .split('{week}').join(pad2(week));
}
```

- [ ] **Step 6: Implement focused API adapters**

```ts
// pageTemplateApi.ts
export async function listPageTemplates(spaceId: string, options: {
  locale: PageTemplateLocale; scope?: 'all' | 'system' | 'space'; archived?: 'active' | 'archived' | 'all';
  category?: PageTemplateCategory; q?: string; skip?: number; take?: number;
}): Promise<PageTemplateListResponse> {
  const response = await api.get(`/spaces/${spaceId}/page-templates`, { params: {
    locale: options.locale, scope: options.scope ?? 'all', archived: options.archived ?? 'active',
    skip: options.skip ?? 0, take: options.take ?? 100,
    ...(options.category ? { category: options.category } : {}),
    ...(options.q?.trim() ? { q: options.q.trim() } : {}),
  }});
  return response.data;
}

export const createPageTemplate = async (spaceId: string, input: SavePageTemplateInput) =>
  (await api.post(`/spaces/${spaceId}/page-templates`, input)).data as PageTemplateDetail;

export const updatePageTemplate = async (spaceId: string, templateId: string, input: {
  name: string; description?: string; category: PageTemplateCategory; defaultTitle: string; expectedUpdatedAt: string;
}) => (await api.patch(`/spaces/${spaceId}/page-templates/${templateId}`, input)).data as PageTemplateDetail;

export const createPageTemplateVersion = async (spaceId: string, templateId: string, input: {
  sourcePageId: string; expectedSourceUpdatedAt: string; expectedCurrentVersion: number;
}) => (await api.post(`/spaces/${spaceId}/page-templates/${templateId}/versions`, input)).data as PageTemplateDetail & { noChange?: boolean };

export const archivePageTemplate = async (spaceId: string, templateId: string, expectedUpdatedAt: string) =>
  (await api.delete(`/spaces/${spaceId}/page-templates/${templateId}`, { data: { expectedUpdatedAt } })).data;

export const restorePageTemplate = async (spaceId: string, templateId: string, expectedUpdatedAt: string) =>
  (await api.post(`/spaces/${spaceId}/page-templates/${templateId}/restore`, { expectedUpdatedAt })).data;
```

- [ ] **Step 7: Add bilingual copy and stable error mappings**

Merge these exact values into the existing flat English and Chinese dictionaries in `messages.ts`:

```ts
const pageTemplateZhCN = {
  'pageTemplate.blank.name': '空白页面',
  'pageTemplate.blank.description': '从一个完全空白的页面开始',
  'pageTemplate.filter.all': '全部',
  'pageTemplate.filter.system': '系统模板',
  'pageTemplate.filter.space': 'Space 模板',
  'pageTemplate.category': '分类',
  'pageTemplate.category.planning': '计划管理',
  'pageTemplate.category.reporting': '汇报总结',
  'pageTemplate.category.knowledge': '知识沉淀',
  'pageTemplate.category.other': '其他',
  'pageTemplate.step.choose': '选择模板',
  'pageTemplate.step.details': '填写页面信息',
  'pageTemplate.selected': '已选择',
  'pageTemplate.loadFailed': '模板加载失败，仍可创建空白页面',
  'pageTemplate.createFailed': '创建模板失败',
  'pageTemplate.retry': '重试',
  'pageTemplate.back': '上一步',
  'pageTemplate.manage': '管理模板',
  'pageTemplate.settingsTitle': 'Space 页面模板',
  'pageTemplate.settingsDescription': '管理团队可复用的页面结构',
  'pageTemplate.activeCount': '已启用 {count}/100',
  'pageTemplate.search': '搜索模板',
  'pageTemplate.showArchived': '显示已归档模板',
  'pageTemplate.saveAs': '保存为 Space 模板',
  'pageTemplate.saveTemplate': '保存模板',
  'pageTemplate.updateFromPage': '从页面更新内容',
  'pageTemplate.createVersion': '创建新版本',
  'pageTemplate.archive': '归档',
  'pageTemplate.restore': '恢复',
  'pageTemplate.name': '模板名称',
  'pageTemplate.description': '模板说明',
  'pageTemplate.defaultTitle': '默认页面标题',
  'pageTemplate.sourcePage': '源页面',
  'pageTemplate.savePageFirst': '请先保存当前页面再创建模板。',
  'pageTemplate.markdownOnly': '仅 Markdown 页面可保存为模板',
  'pageTemplate.created': '模板已创建',
  'pageTemplate.updated': '模板已更新',
  'pageTemplate.noChange': '页面内容未变化，未创建新版本',
  'pageTemplate.invalid': '页面模板输入无效',
  'pageTemplate.notFound': '模板不存在或无权访问',
  'pageTemplate.versionNotFound': '指定的模板版本不存在',
  'pageTemplate.archived': '该模板已归档，无法创建页面',
  'pageTemplate.sourceInvalid': '源页面不存在或不是 Markdown 页面',
  'pageTemplate.systemImmutable': '系统模板不可修改',
  'pageTemplate.agentUnsupported': 'Agent 不能使用页面模板来源字段',
  'pageTemplate.permissionDenied': '仅 Space 所有者或管理员可管理模板',
  'pageTemplate.nameConflict': '已有同名 Space 模板',
  'pageTemplate.versionConflict': '模板已被其他人更新，请刷新后重试',
  'pageTemplate.sourceStale': '源页面已变更，请重新打开后重试',
  'pageTemplate.quotaExceeded': 'Space 最多可启用 100 个自定义模板',
};

const pageTemplateEn = {
  'pageTemplate.blank.name': 'Blank page',
  'pageTemplate.blank.description': 'Start with a completely blank page',
  'pageTemplate.filter.all': 'All',
  'pageTemplate.filter.system': 'System templates',
  'pageTemplate.filter.space': 'Space templates',
  'pageTemplate.category': 'Category',
  'pageTemplate.category.planning': 'Planning',
  'pageTemplate.category.reporting': 'Reporting',
  'pageTemplate.category.knowledge': 'Knowledge',
  'pageTemplate.category.other': 'Other',
  'pageTemplate.step.choose': 'Choose a template',
  'pageTemplate.step.details': 'Page details',
  'pageTemplate.selected': 'Selected',
  'pageTemplate.loadFailed': 'Templates could not be loaded. You can still create a blank page.',
  'pageTemplate.createFailed': 'Could not create the template',
  'pageTemplate.retry': 'Retry',
  'pageTemplate.back': 'Back',
  'pageTemplate.manage': 'Manage templates',
  'pageTemplate.settingsTitle': 'Space page templates',
  'pageTemplate.settingsDescription': 'Manage reusable page structures for your team',
  'pageTemplate.activeCount': '{count}/100 active',
  'pageTemplate.search': 'Search templates',
  'pageTemplate.showArchived': 'Show archived templates',
  'pageTemplate.saveAs': 'Save as Space template',
  'pageTemplate.saveTemplate': 'Save template',
  'pageTemplate.updateFromPage': 'Update content from page',
  'pageTemplate.createVersion': 'Create new version',
  'pageTemplate.archive': 'Archive',
  'pageTemplate.restore': 'Restore',
  'pageTemplate.name': 'Template name',
  'pageTemplate.description': 'Template description',
  'pageTemplate.defaultTitle': 'Default page title',
  'pageTemplate.sourcePage': 'Source page',
  'pageTemplate.savePageFirst': 'Save the page before creating a template.',
  'pageTemplate.markdownOnly': 'Only Markdown pages can be saved as templates',
  'pageTemplate.created': 'Template created',
  'pageTemplate.updated': 'Template updated',
  'pageTemplate.noChange': 'The page content is unchanged; no new version was created',
  'pageTemplate.invalid': 'The page template input is invalid',
  'pageTemplate.notFound': 'The template does not exist or is not accessible',
  'pageTemplate.versionNotFound': 'The requested template version does not exist',
  'pageTemplate.archived': 'This template is archived and cannot create pages',
  'pageTemplate.sourceInvalid': 'The source page does not exist or is not a Markdown page',
  'pageTemplate.systemImmutable': 'System templates cannot be changed',
  'pageTemplate.agentUnsupported': 'Agents cannot use page template source fields',
  'pageTemplate.permissionDenied': 'Only Space owners and admins can manage templates',
  'pageTemplate.nameConflict': 'A Space template already uses this name',
  'pageTemplate.versionConflict': 'This template changed. Reload and try again.',
  'pageTemplate.sourceStale': 'The source page changed. Reopen it and try again.',
  'pageTemplate.quotaExceeded': 'A Space can have at most 100 active custom templates',
};
```

Map business codes in `api/error-message.ts`:

```ts
PAGE_TEMPLATE_INVALID: 'pageTemplate.invalid',
PAGE_TEMPLATE_NOT_FOUND: 'pageTemplate.notFound',
PAGE_TEMPLATE_VERSION_NOT_FOUND: 'pageTemplate.versionNotFound',
PAGE_TEMPLATE_ARCHIVED: 'pageTemplate.archived',
PAGE_TEMPLATE_SOURCE_INVALID: 'pageTemplate.sourceInvalid',
PAGE_TEMPLATE_SYSTEM_IMMUTABLE: 'pageTemplate.systemImmutable',
PAGE_TEMPLATE_AGENT_UNSUPPORTED: 'pageTemplate.agentUnsupported',
PAGE_TEMPLATE_PERMISSION_DENIED: 'pageTemplate.permissionDenied',
PAGE_TEMPLATE_NAME_CONFLICT: 'pageTemplate.nameConflict',
PAGE_TEMPLATE_VERSION_CONFLICT: 'pageTemplate.versionConflict',
PAGE_TEMPLATE_SOURCE_STALE: 'pageTemplate.sourceStale',
PAGE_TEMPLATE_QUOTA_EXCEEDED: 'pageTemplate.quotaExceeded',
```

Add one parameterized `apiErrorMessage` test that verifies all twelve mappings return translated copy rather than the fallback key.

- [ ] **Step 8: Run client helper/API/error tests and typecheck**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client test -- src/features/page-templates/defaultPageTitle.spec.ts src/features/page-templates/pageTemplateApi.spec.ts src/api/error-message.spec.ts
pnpm --filter @agentwiki/client exec tsc --noEmit
```

Expected: all focused tests pass; client typecheck exits 0.

- [ ] **Step 9: Commit client primitives**

```bash
cd agentwiki
git add apps/client/src/features/page-templates/pageTemplateTypes.ts apps/client/src/features/page-templates/pageTemplateApi.ts apps/client/src/features/page-templates/pageTemplateApi.spec.ts apps/client/src/features/page-templates/defaultPageTitle.ts apps/client/src/features/page-templates/defaultPageTitle.spec.ts apps/client/src/i18n/messages.ts apps/client/src/api/error-message.ts apps/client/src/api/error-message.spec.ts
git commit -m "feat(page-templates): add client template contracts"
```

---

### Task 8: Replace the inline create form with the accessible two-step dialog

**Files:**
- Create: `agentwiki/apps/client/src/features/page-templates/NewPageDialog.tsx`
- Create: `agentwiki/apps/client/src/features/page-templates/NewPageDialog.spec.tsx`
- Modify: `agentwiki/apps/client/src/features/space/SpaceView.tsx`
- Create: `agentwiki/apps/client/src/features/space/SpaceView.spec.tsx`

**Interfaces:**
- Consumes: `listPageTemplates()`, `interpolateDefaultPageTitle()`, existing `ModalDialog`, and `POST /pages`.
- Produces: `NewPageDialog({ spaceId, parentOptions, returnFocusTo, onClose, onCreated })` and preserves `SpaceView` page navigation.

- [ ] **Step 1: Write failing two-step dialog tests**

```tsx
it('defaults to blank, keeps blank available when the catalog fails, and retries', async () => {
  listPageTemplates.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(catalog);
  renderDialog();
  expect(await screen.findByRole('alert')).toHaveTextContent('模板加载失败');
  expect(screen.getByRole('button', { name: /空白页面/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByRole('button', { name: /任务清单/ })).toBeInTheDocument();
});

it('selects a system version, suggests a title, and posts only template provenance', async () => {
  listPageTemplates.mockResolvedValue(catalog);
  api.post.mockResolvedValue({ data: { id: 'page-new' } });
  renderDialog();
  fireEvent.click(await screen.findByRole('button', { name: /周报/ }));
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  expect(screen.getByLabelText('标题')).toHaveValue('周报 2026年第35周');
  fireEvent.change(screen.getByLabelText('父页面（可选）'), { target: { value: 'parent-1' } });
  fireEvent.click(screen.getByRole('button', { name: '创建' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pages', {
    title: '周报 2026年第35周', spaceId: 'space-1', parentId: 'parent-1',
    templateId: 'system-weekly', templateVersion: 1, templateLocale: 'zh-CN',
  }));
  expect(onCreated).toHaveBeenCalledWith('page-new');
});

it('creates blank pages without template fields and preserves form state after failure', async () => {
  listPageTemplates.mockRejectedValue(new Error('offline'));
  api.post.mockRejectedValue({ response: { data: { code: 'CONFLICT' } } });
  renderDialog();
  fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
  fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'My page' } });
  fireEvent.click(screen.getByRole('button', { name: '创建' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByLabelText('标题')).toHaveValue('My page');
  expect(api.post).toHaveBeenCalledWith('/pages', { title: 'My page', spaceId: 'space-1' });
});

it('keeps Space template default titles literal even when they contain system tokens', async () => {
  listPageTemplates.mockResolvedValue({
    ...catalog,
    space: [{ ...spaceTemplate, scope: 'space', defaultTitle: '团队日报 {date}' }],
  });
  renderDialog();
  fireEvent.click(await screen.findByRole('button', { name: /团队周报/ }));
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  expect(screen.getByLabelText('标题')).toHaveValue('团队日报 {date}');
});

it('returns focus to the opener and fits the keyboard flow', async () => {
  const { opener } = renderDialogWithOpener();
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(opener).toHaveFocus());
});

// SpaceView.spec.tsx
it.each([
  ['owner', true], ['admin', true], ['editor', true], ['viewer', false],
] as const)('shows the new-page trigger for %s according to live Space membership', async (role, visible) => {
  api.get.mockImplementation(async (url: string) => url === '/spaces/space-1'
    ? { data: { id: 'space-1', name: 'Role Space', members: [{ userId: 'user-1', role }] } }
    : { data: [] });
  renderSpaceView({ user: { id: 'user-1' } });
  await screen.findByRole('heading', { name: 'Role Space' });
  expect(screen.queryByRole('button', { name: '新建页面' }) !== null).toBe(visible);
});
```

Use fake timers or inject `now={new Date(2026, 7, 25, 12)}` as a test-only optional prop so date expectations are deterministic.

- [ ] **Step 2: Run the dialog test and verify the component is missing**

Run: `cd agentwiki && pnpm --filter @agentwiki/client test -- src/features/page-templates/NewPageDialog.spec.tsx`

Expected: FAIL with missing component module.

- [ ] **Step 3: Implement catalog loading, stale-request protection, and blank fallback**

```tsx
export interface NewPageDialogProps {
  spaceId: string;
  parentOptions: Array<{ id: string; title: string }>;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onCreated: (pageId: string) => void;
  now?: Date;
}

const BLANK_ID = 'blank';

export const NewPageDialog: React.FC<NewPageDialogProps> = ({
  spaceId, parentOptions, returnFocusTo, onClose, onCreated, now = new Date(),
}) => {
  const { language, t } = useLanguage();
  const [step, setStep] = useState<1 | 2>(1);
  const [catalog, setCatalog] = useState<PageTemplateListResponse | null>(null);
  const [selected, setSelected] = useState<PageTemplateSummary | null>(null);
  const [filter, setFilter] = useState<'all' | 'system' | 'space'>('all');
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setCatalogError(false);
    void listPageTemplates(spaceId, { locale: language })
      .then((result) => { if (active) setCatalog(result); })
      .catch(() => { if (active) { setCatalog(null); setCatalogError(true); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [language, reloadKey, spaceId]);

  const choose = (template: PageTemplateSummary | null) => {
    setSelected(template);
    setTitle(template
      ? template.scope === 'system' ? interpolateDefaultPageTitle(template.defaultTitle, now) : template.defaultTitle
      : '');
    setCreateError(null);
  };
```

- [ ] **Step 4: Implement exact create payload and state-preserving errors**

```tsx
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const payload = {
        title: normalizedTitle,
        spaceId,
        ...(parentId ? { parentId } : {}),
        ...(selected ? {
          templateId: selected.id,
          templateVersion: selected.currentVersion,
          templateLocale: language,
        } : {}),
      };
      const response = await api.post('/pages', payload);
      onCreated(response.data.id);
    } catch (error) {
      setCreateError(apiErrorMessage(error, t, 'page.createFailed'));
    } finally {
      setCreating(false);
    }
  };
```

Render the first step as a `role="group"` of real buttons with `aria-pressed`. Always render the blank button. Apply the filter client-side to `catalog.system` and `catalog.space`. If `catalog.capabilities.canManage`, render a link to `/spaces/${spaceId}/settings/page-templates`.

Render the second step as one form containing the selected-template summary, required title input with `data-modal-autofocus`, parent select, back/cancel/create buttons, and an inline `role="alert"`. Wrap both steps in:

```tsx
<ModalDialog
  labelledBy="new-page-dialog-title"
  onRequestClose={onClose}
  closeDisabled={creating}
  returnFocusTo={returnFocusTo}
  className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[14px] bg-white p-6 shadow-xl"
>
```

Cards use `grid-cols-1 sm:grid-cols-2`; no fixed width may exceed 390px.

- [ ] **Step 5: Replace only the inline create state and modal in `SpaceView`**

Keep fetching, hierarchy, move, delete, and navigation behavior untouched. Replace `showCreate`, title/parent/creating state, `handleCreatePage`, and the inline overlay with:

```tsx
interface SpaceMemberSummary { userId: string; role: 'owner' | 'admin' | 'editor' | 'viewer' }
interface Space { id: string; name: string; description?: string; members: SpaceMemberSummary[] }

const { user } = useAuth();
const createPageOpenerRef = useRef<HTMLButtonElement | null>(null);
const [showCreate, setShowCreate] = useState(false);
const currentRole = space?.members.find((member) => member.userId === user?.id)?.role;
const canCreatePages = user?.platformRole === 'super_admin'
  || currentRole === 'owner' || currentRole === 'editor';

{canCreatePages ? (
  <button
    ref={createPageOpenerRef}
    type="button"
    onClick={() => setShowCreate(true)}
    className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white"
  >
    <Plus size={18} />{t('page.new')}
  </button>
) : null}

{showCreate && canCreatePages ? (
  <NewPageDialog
    spaceId={id}
    parentOptions={pages.map(({ id: pageId, title }) => ({ id: pageId, title }))}
    returnFocusTo={createPageOpenerRef.current}
    onClose={() => setShowCreate(false)}
    onCreated={(pageId) => {
      setShowCreate(false);
      navigate(`/pages/${pageId}/edit`);
    }}
  />
) : null}
```

- [ ] **Step 6: Run dialog, Space tree, modal, and type tests**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client test -- src/features/page-templates/NewPageDialog.spec.tsx src/features/space/SpaceView.spec.tsx src/components/ModalDialog.test.tsx src/features/space/applyMove.spec.ts
pnpm --filter @agentwiki/client exec tsc --noEmit
```

Expected: tests pass; no changes to move/delete behavior; typecheck exits 0.

- [ ] **Step 7: Commit the two-step page flow**

```bash
cd agentwiki
git add apps/client/src/features/page-templates/NewPageDialog.tsx apps/client/src/features/page-templates/NewPageDialog.spec.tsx apps/client/src/features/space/SpaceView.tsx apps/client/src/features/space/SpaceView.spec.tsx
git commit -m "feat(pages): add two-step template creation"
```

---

### Task 9: Add the Space template settings card and management page

**Files:**
- Create: `agentwiki/apps/client/src/features/page-templates/PageTemplateSettingsCard.tsx`
- Create: `agentwiki/apps/client/src/features/page-templates/PageTemplateSettingsCard.spec.tsx`
- Create: `agentwiki/apps/client/src/features/page-templates/PageTemplateManager.tsx`
- Create: `agentwiki/apps/client/src/features/page-templates/PageTemplateManager.spec.tsx`
- Modify: `agentwiki/apps/client/src/features/page-templates/pageTemplateApi.ts`
- Modify: `agentwiki/apps/client/src/features/space/SpaceSettings.tsx`
- Modify: `agentwiki/apps/client/src/features/space/SpaceSettings.spec.tsx`
- Modify: `agentwiki/apps/client/src/App.tsx`
- Modify: `agentwiki/apps/client/src/App.spec.tsx`

**Interfaces:**
- Consumes: list/mutation adapters from Task 7, existing paginated `/pages`, `SpaceNav`, and `ModalDialog`.
- Produces: route `/spaces/:id/settings/page-templates`, settings summary card, and all Owner/Admin management actions.

- [ ] **Step 1: Write failing settings-card and routing tests**

```tsx
it('shows the active Space template count and manage link only when allowed', async () => {
  listPageTemplates.mockResolvedValue({ ...catalog, totalSpace: 3, capabilities: { canManage: true } });
  render(<MemoryRouter><PageTemplateSettingsCard spaceId="space-1" /></MemoryRouter>);
  expect(await screen.findByText('已启用 3/100')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '管理模板' })).toHaveAttribute(
    'href', '/spaces/space-1/settings/page-templates',
  );
});

it('routes the settings page to PageTemplateManager', async () => {
  window.history.replaceState({}, '', '/spaces/space-1/settings/page-templates');
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Space 页面模板' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Write failing manager mutation tests**

```tsx
it('edits metadata with the loaded optimistic timestamp', async () => {
  listPageTemplates.mockResolvedValue(ownerCatalog);
  updatePageTemplate.mockResolvedValue({ ...spaceTemplate, name: '团队周报新版' });
  renderManager();
  fireEvent.click(await screen.findByRole('button', { name: /编辑 团队周报/ }));
  fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '团队周报新版' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(updatePageTemplate).toHaveBeenCalledWith('space-1', 'space-1-template', {
    name: '团队周报新版', description: '团队格式', category: 'reporting',
    defaultTitle: '团队周报', expectedUpdatedAt: spaceTemplate.updatedAt,
  }));
});

it('creates a new content version from an exact persisted source page', async () => {
  listPageTemplates.mockResolvedValue(ownerCatalog);
  api.get.mockResolvedValue({ data: { data: [{
    id: 'page-source', title: '新版周报结构', format: 'markdown', updatedAt: '2026-08-25T12:00:00.000Z',
  }], total: 1 } });
  renderManager();
  fireEvent.click(await screen.findByRole('button', { name: /更新内容 团队周报/ }));
  fireEvent.change(screen.getByLabelText('源页面'), { target: { value: 'page-source' } });
  fireEvent.click(screen.getByRole('button', { name: '创建新版本' }));
  await waitFor(() => expect(createPageTemplateVersion).toHaveBeenCalledWith(
    'space-1', 'space-1-template', {
      sourcePageId: 'page-source', expectedSourceUpdatedAt: '2026-08-25T12:00:00.000Z',
      expectedCurrentVersion: spaceTemplate.currentVersion,
    },
  ));
});

it('archives and restores with confirmation and exact updatedAt', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  archivePageTemplate.mockResolvedValue({ ...spaceTemplate, archivedAt: '2026-08-25T13:00:00.000Z' });
  restorePageTemplate.mockResolvedValue({ ...spaceTemplate, updatedAt: '2026-08-25T14:00:00.000Z' });
  listPageTemplates
    .mockResolvedValueOnce(ownerCatalog)
    .mockResolvedValueOnce({
      ...ownerCatalog,
      space: [{ ...spaceTemplate, archivedAt: '2026-08-25T13:00:00.000Z' }],
    })
    .mockResolvedValue(ownerCatalog);
  renderManager();
  fireEvent.click(await screen.findByRole('button', { name: /归档 团队周报/ }));
  await waitFor(() => expect(archivePageTemplate).toHaveBeenCalledWith(
    'space-1', 'space-1-template', spaceTemplate.updatedAt,
  ));
  fireEvent.click(screen.getByRole('checkbox', { name: '显示已归档模板' }));
  await waitFor(() => expect(listPageTemplates).toHaveBeenLastCalledWith('space-1', expect.objectContaining({ archived: 'all' })));
  fireEvent.click(await screen.findByRole('button', { name: /恢复 团队周报/ }));
  await waitFor(() => expect(restorePageTemplate).toHaveBeenCalledWith(
    'space-1', 'space-1-template', '2026-08-25T13:00:00.000Z',
  ));
});

it('renders system templates read-only and removes all mutations without capability', async () => {
  listPageTemplates.mockResolvedValue({ ...ownerCatalog, capabilities: { canManage: false } });
  renderManager();
  expect(await screen.findByText('任务清单')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /编辑|归档|更新内容/ })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run focused tests and verify components/routes are missing**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client test -- src/features/page-templates/PageTemplateSettingsCard.spec.tsx src/features/page-templates/PageTemplateManager.spec.tsx src/App.spec.tsx
```

Expected: FAIL with missing modules and route.

- [ ] **Step 4: Implement the lightweight settings card**

```tsx
export const PageTemplateSettingsCard: React.FC<{ spaceId: string }> = ({ spaceId }) => {
  const { language, t } = useLanguage();
  const [state, setState] = useState<PageTemplateListResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void listPageTemplates(spaceId, { locale: language, scope: 'space', take: 1 })
      .then((result) => { if (active) setState(result); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [language, spaceId]);
  return (
    <section className="mt-5 rounded-[14px] border bg-white p-5">
      <h2 className="font-semibold">{t('pageTemplate.settingsTitle')}</h2>
      <p className="mt-1 text-sm text-gray-500">{t('pageTemplate.settingsDescription')}</p>
      {failed ? <p role="alert" className="mt-3 text-sm text-red-600">{t('pageTemplate.loadFailed')}</p> : null}
      {state ? <p className="mt-3 text-sm text-gray-600">{t('pageTemplate.activeCount', { count: state.totalSpace })}</p> : null}
      {state?.capabilities.canManage ? (
        <Link className="mt-4 inline-flex min-h-10 items-center rounded-lg border px-4 text-sm" to={`/spaces/${spaceId}/settings/page-templates`}>
          {t('pageTemplate.manage')}
        </Link>
      ) : null}
    </section>
  );
};
```

Render this card after `AutoGraphCard` in `SpaceSettings`; do not merge its loading/error state with the main settings form or graph card.

- [ ] **Step 5: Implement manager loading and stable stale-response guards**

`PageTemplateManager` reads `id`, language, search, category, and `showArchived`; each load captures a monotonically increasing request ID. It renders `SpaceNav`, a back link, one search input, category select, archived checkbox, system section, Space section, and load-more button when `space.length < totalSpace`.

Use this load function:

```tsx
const load = async (reset = true) => {
  const requestId = ++requestIdRef.current;
  if (reset) setLoading(true);
  setError(null);
  try {
    const result = await listPageTemplates(id!, {
      locale: language, scope: 'all', archived: showArchived ? 'all' : 'active',
      category: category || undefined, q: search || undefined,
      skip: reset ? 0 : templates.space.length, take: 50,
    });
    if (requestId !== requestIdRef.current) return;
    setTemplates((current) => reset ? result : {
      ...result, space: [...current.space, ...result.space.filter((item) => !current.space.some((old) => old.id === item.id))],
    });
  } catch (caught) {
    if (requestId === requestIdRef.current) setError(apiErrorMessage(caught, t, 'pageTemplate.loadFailed'));
  } finally {
    if (requestId === requestIdRef.current) setLoading(false);
  }
};
```

- [ ] **Step 6: Implement focused management dialogs**

Use one discriminated pending state:

```ts
type PendingDialog =
  | { type: 'metadata'; template: PageTemplateSummary }
  | { type: 'version'; template: PageTemplateSummary }
  | null;
```

Metadata submit calls `updatePageTemplate()` with the selected record's `updatedAt`. Version submit first loads Markdown pages through paginated `GET /pages?spaceId=${id}&skip=${skip}&take=100`, filters `format === 'markdown'`, and calls `createPageTemplateVersion()` with the selected page's `updatedAt` and template's `currentVersion`. Both dialogs:

- use `ModalDialog`;
- keep input after failure;
- disable close while submitting;
- show `noChange` as `pageTemplate.noChange`;
- reload the authoritative list after success.

Archive and restore require `window.confirm`, call the exact optimistic adapters, then reload. System cards have no mutation controls.

- [ ] **Step 7: Add the lazy manager route**

```tsx
const PageTemplateManager = lazy(() => import('./features/page-templates/PageTemplateManager')
  .then((module) => ({ default: module.PageTemplateManager })));

<Route
  path="/spaces/:id/settings/page-templates"
  element={<Suspense fallback={<RouteLoading />}><PageTemplateManager /></Suspense>}
/>
```

The static settings route must remain before the wildcard; no existing route changes meaning.

- [ ] **Step 8: Run manager, settings, route, modal, and type tests**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client test -- src/features/page-templates/PageTemplateSettingsCard.spec.tsx src/features/page-templates/PageTemplateManager.spec.tsx src/features/space/SpaceSettings.spec.tsx src/App.spec.tsx src/components/ModalDialog.test.tsx
pnpm --filter @agentwiki/client exec tsc --noEmit
```

Expected: focused suites pass; settings form and graph card regressions remain green; typecheck exits 0.

- [ ] **Step 9: Commit Space template management UI**

```bash
cd agentwiki
git add apps/client/src/features/page-templates/PageTemplateSettingsCard.tsx apps/client/src/features/page-templates/PageTemplateSettingsCard.spec.tsx apps/client/src/features/page-templates/PageTemplateManager.tsx apps/client/src/features/page-templates/PageTemplateManager.spec.tsx apps/client/src/features/page-templates/pageTemplateApi.ts apps/client/src/features/space/SpaceSettings.tsx apps/client/src/features/space/SpaceSettings.spec.tsx apps/client/src/App.tsx apps/client/src/App.spec.tsx
git commit -m "feat(page-templates): add Space template management"
```

---

### Task 10: Save a persisted editor page as a Space template

**Files:**
- Create: `agentwiki/apps/client/src/features/page-templates/SavePageAsTemplateDialog.tsx`
- Create: `agentwiki/apps/client/src/features/page-templates/SavePageAsTemplateDialog.spec.tsx`
- Modify: `agentwiki/apps/client/src/features/page/PageEditor.tsx`
- Modify: `agentwiki/apps/client/src/features/page/PageEditor.spec.tsx`

**Interfaces:**
- Consumes: `listPageTemplates()`, `createPageTemplate()`, current Page `id`, `spaceId`, `format`, and `updatedAt`.
- Produces: accessible “More → Save as Space template” editor action with exact persisted source version.

- [ ] **Step 1: Write failing save-dialog tests**

```tsx
it('saves the exact persisted page timestamp and source locale', async () => {
  createPageTemplate.mockResolvedValue(templateDetail);
  render(<LanguageProvider><SavePageAsTemplateDialog
    spaceId="space-1" pageId="page-1" pageTitle="Weekly source"
    pageUpdatedAt="2026-08-25T10:00:00.000Z" returnFocusTo={null}
    onClose={onClose} onSaved={onSaved}
  /></LanguageProvider>);
  fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '团队周报' } });
  fireEvent.change(screen.getByLabelText('模板说明'), { target: { value: '统一团队格式' } });
  fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'reporting' } });
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  await waitFor(() => expect(createPageTemplate).toHaveBeenCalledWith('space-1', {
    name: '团队周报', description: '统一团队格式', category: 'reporting',
    defaultTitle: 'Weekly source', locale: 'zh-CN', sourcePageId: 'page-1',
    expectedSourceUpdatedAt: '2026-08-25T10:00:00.000Z',
  }));
  expect(onSaved).toHaveBeenCalledWith(templateDetail);
});

it('keeps entered metadata after a conflict', async () => {
  createPageTemplate.mockRejectedValue({ response: { data: { code: 'PAGE_TEMPLATE_SOURCE_STALE' } } });
  renderDialog();
  fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: 'My format' } });
  fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('源页面已变更，请重新打开后重试');
  expect(screen.getByLabelText('模板名称')).toHaveValue('My format');
});
```

- [ ] **Step 2: Write failing PageEditor capability and dirty-state tests**

```tsx
it('shows Save as Space template only with server management capability', async () => {
  queuePages({ data: page() });
  listPageTemplates.mockResolvedValue({ ...catalog, capabilities: { canManage: true } });
  renderEditor();
  await screen.findByDisplayValue('Original title');
  fireEvent.click(screen.getByRole('button', { name: 'More page actions' }));
  expect(screen.getByRole('menuitem', { name: 'Save as Space template' })).toBeEnabled();
});

it('requires saving dirty content before opening the template dialog', async () => {
  queuePages({ data: page() });
  listPageTemplates.mockResolvedValue({ ...catalog, capabilities: { canManage: true } });
  renderEditor();
  fireEvent.change(await screen.findByDisplayValue('Original title'), { target: { value: 'Dirty' } });
  fireEvent.click(screen.getByRole('button', { name: 'More page actions' }));
  expect(screen.getByRole('menuitem', { name: 'Save as Space template' })).toBeDisabled();
  expect(screen.getByText('Save the page before creating a template.')).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Save as Space template' })).not.toBeInTheDocument();
});

it('hides template actions for non-Markdown pages and capability failures', async () => {
  queuePages({ data: page({ format: 'html' }) });
  listPageTemplates.mockRejectedValue(new Error('offline'));
  renderEditor();
  await screen.findByDisplayValue('Original title');
  expect(screen.queryByRole('button', { name: 'More page actions' })).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Run focused tests and verify the dialog/action is missing**

Run: `cd agentwiki && pnpm --filter @agentwiki/client test -- src/features/page-templates/SavePageAsTemplateDialog.spec.tsx src/features/page/PageEditor.spec.tsx`

Expected: FAIL with missing component and missing editor action.

- [ ] **Step 4: Implement the save dialog**

```tsx
export const SavePageAsTemplateDialog: React.FC<{
  spaceId: string; pageId: string; pageTitle: string; pageUpdatedAt: string;
  returnFocusTo?: HTMLElement | null; onClose: () => void;
  onSaved: (template: PageTemplateDetail) => void;
}> = ({ spaceId, pageId, pageTitle, pageUpdatedAt, returnFocusTo, onClose, onSaved }) => {
  const { language, t } = useLanguage();
  const [draft, setDraft] = useState({
    name: pageTitle, description: '', category: 'other' as PageTemplateCategory, defaultTitle: pageTitle,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim() || !draft.defaultTitle.trim() || submitting) return;
    setSubmitting(true); setError(null);
    try {
      const result = await createPageTemplate(spaceId, {
        name: draft.name.trim(), description: draft.description.trim() || undefined,
        category: draft.category, defaultTitle: draft.defaultTitle.trim(), locale: language,
        sourcePageId: pageId, expectedSourceUpdatedAt: pageUpdatedAt,
      });
      onSaved(result);
    } catch (caught) {
      setError(apiErrorMessage(caught, t, 'pageTemplate.createFailed'));
    } finally { setSubmitting(false); }
  };
  return <ModalDialog
    labelledBy="save-page-template-title" onRequestClose={onClose} closeDisabled={submitting}
    returnFocusTo={returnFocusTo}
    className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-[14px] bg-white p-6 shadow-xl"
  >
    <form onSubmit={submit} className="space-y-4">
      <h2 id="save-page-template-title" className="text-xl font-semibold">{t('pageTemplate.saveAs')}</h2>
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <label htmlFor="page-template-name" className="block space-y-1 text-sm font-medium">
        <span>{t('pageTemplate.name')}</span>
        <input id="page-template-name" required maxLength={80} value={draft.name}
          onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
          className="w-full rounded-lg border border-slate-300 px-3 py-2" />
      </label>
      <label htmlFor="page-template-description" className="block space-y-1 text-sm font-medium">
        <span>{t('pageTemplate.description')}</span>
        <textarea id="page-template-description" maxLength={240} value={draft.description}
          onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))}
          className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2" />
      </label>
      <label htmlFor="page-template-category" className="block space-y-1 text-sm font-medium">
        <span>{t('pageTemplate.category')}</span>
        <select id="page-template-category" value={draft.category}
          onChange={(event) => setDraft((value) => ({ ...value, category: event.target.value as PageTemplateCategory }))}
          className="w-full rounded-lg border border-slate-300 px-3 py-2">
          {(['planning', 'reporting', 'knowledge', 'other'] as const).map((category) => (
            <option key={category} value={category}>{t(`pageTemplate.category.${category}`)}</option>
          ))}
        </select>
      </label>
      <label htmlFor="page-template-default-title" className="block space-y-1 text-sm font-medium">
        <span>{t('pageTemplate.defaultTitle')}</span>
        <input id="page-template-default-title" required maxLength={160} value={draft.defaultTitle}
          onChange={(event) => setDraft((value) => ({ ...value, defaultTitle: event.target.value }))}
          className="w-full rounded-lg border border-slate-300 px-3 py-2" />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" disabled={submitting} onClick={onClose}>{t('common.cancel')}</button>
        <button type="submit" disabled={submitting || !draft.name.trim() || !draft.defaultTitle.trim()}>{t('pageTemplate.saveTemplate')}</button>
      </div>
    </form>
  </ModalDialog>;
};
```

- [ ] **Step 5: Add a capability load that cannot disturb editor page queues or drafts**

Import `listPageTemplates` as a separate module dependency. After `page.spaceId` is known:

```tsx
const [canManageTemplates, setCanManageTemplates] = useState(false);
useEffect(() => {
  if (!page?.spaceId || page.format !== 'markdown') { setCanManageTemplates(false); return; }
  let active = true;
  void listPageTemplates(page.spaceId, { locale: language, scope: 'space', take: 1 })
    .then((result) => { if (active) setCanManageTemplates(result.capabilities.canManage); })
    .catch(() => { if (active) setCanManageTemplates(false); });
  return () => { active = false; };
}, [language, page?.format, page?.spaceId]);
```

Mock this module directly in `PageEditor.spec.tsx`; do not route its request through the existing page-detail response queue.

- [ ] **Step 6: Add the focused More menu without changing Save, History, or mode controls**

Add `Ellipsis` beside History and Save. Only render it when `canManageTemplates && page?.format === 'markdown'`. Use `aria-haspopup="menu"`, close on Escape and outside click, and return focus after dialog closure. The menu item is disabled when `isDirty || saving || remoteUpdate !== null`; directly below it render `pageTemplate.savePageFirst` while dirty.

On successful template save:

```tsx
onSaved={() => {
  setTemplateDialogOpen(false);
  setSaveStatus({ kind: 'success', text: t('pageTemplate.created') });
}}
```

Do not mark the page clean, change `updatedAt`, or alter editor content as a side effect of template creation.

- [ ] **Step 7: Run editor, dialog, remote-update, and type regressions**

Run:

```bash
cd agentwiki
pnpm --filter @agentwiki/client test -- src/features/page-templates/SavePageAsTemplateDialog.spec.tsx src/features/page/PageEditor.spec.tsx src/components/IconButton.spec.tsx src/components/ModalDialog.test.tsx
pnpm --filter @agentwiki/client exec tsc --noEmit
```

Expected: all suites pass, including existing dirty-draft and remote-update safety tests.

- [ ] **Step 8: Commit the editor-to-template path**

```bash
cd agentwiki
git add apps/client/src/features/page-templates/SavePageAsTemplateDialog.tsx apps/client/src/features/page-templates/SavePageAsTemplateDialog.spec.tsx apps/client/src/features/page/PageEditor.tsx apps/client/src/features/page/PageEditor.spec.tsx
git commit -m "feat(page-templates): save pages as Space templates"
```

---

### Task 11: Verify database constraints in an isolated PostgreSQL schema

**Files:**
- Create: `agentwiki/scripts/page-template-test-database.mjs`
- Create: `agentwiki/scripts/page-template-schema-db.test.mjs`
- Modify: `agentwiki/package.json`

**Interfaces:**
- Consumes: all Prisma migrations and generated client.
- Produces: fail-closed `PAGE_TEMPLATE_TEST_DATABASE_URL` harness and `pnpm test:e2e:page-template-db`.

- [ ] **Step 1: Write failing URL safety and database integrity tests**

```js
// page-template-schema-db.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { validatePageTemplateTestDatabaseUrl, withPageTemplateTestDatabase } from './page-template-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const baseDatabaseUrl = process.env.PAGE_TEMPLATE_TEST_DATABASE_URL;

test('page-template database URLs fail closed', () => {
  assert.throws(() => validatePageTemplateTestDatabaseUrl(undefined), /required/iu);
  assert.throws(() => validatePageTemplateTestDatabaseUrl('postgresql://localhost/agentwiki'), /test/iu);
  assert.throws(() => validatePageTemplateTestDatabaseUrl('postgresql://localhost/agentwiki_test?schema=public'), /schema/iu);
  assert.doesNotThrow(() => validatePageTemplateTestDatabaseUrl('postgresql://localhost/agentwiki_test'));
  assert.doesNotThrow(() => validatePageTemplateTestDatabaseUrl('postgresql://localhost/agentwiki_test?schema=page_template_test_existing'));
});

test('page-template migration enforces scope, provenance tuples, and immutable references', {
  skip: baseDatabaseUrl ? false : 'PAGE_TEMPLATE_TEST_DATABASE_URL is not configured', timeout: 120_000,
}, async () => {
  await withPageTemplateTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    assert.match(schemaName, /^page_template_test_[a-z0-9_]+$/u);
    assert.notEqual(schemaName, 'public');
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = schemaName.replace('page_template_test_', '');
    try {
      const constraints = await prisma.$queryRawUnsafe(
        `SELECT conname AS name FROM pg_constraint
         WHERE connamespace = $1::regnamespace AND conname IN (
           'PageTemplate_scope_check', 'PageTemplate_current_version_check',
           'PageTemplateVersion_version_check', 'Page_template_source_tuple_check',
           'Page_sourceTemplate_version_fkey'
         ) ORDER BY conname`, schemaName,
      );
      assert.deepEqual(constraints.map((row) => row.name), [
        'PageTemplateVersion_version_check', 'PageTemplate_current_version_check',
        'PageTemplate_scope_check', 'Page_sourceTemplate_version_fkey',
        'Page_template_source_tuple_check',
      ]);

      const userId = `user_${suffix}`;
      const spaceId = `space_${suffix}`;
      const sourcePageId = `source_${suffix}`;
      const createdPageId = `created_${suffix}`;
      await prisma.user.create({ data: { id: userId, email: `${userId}@page-template.test` } });
      await prisma.space.create({ data: { id: spaceId, name: 'Template Space', slug: spaceId } });
      await prisma.page.createMany({ data: [
        { id: sourcePageId, title: 'Source', slug: 'source', spaceId, authorId: userId, syncPath: 'pages/Source.md', syncPathKey: 'pages/source.md' },
        { id: createdPageId, title: 'Created', slug: 'created', spaceId, authorId: userId, syncPath: 'pages/Created.md', syncPathKey: 'pages/created.md' },
      ] });
      const template = await prisma.pageTemplate.create({ data: {
        scope: 'space', scopeKey: spaceId, spaceId, stableKey: 'weekly', category: 'reporting',
        nameI18n: { en: 'Weekly' }, nameKey: 'weekly', descriptionI18n: { en: '' },
        defaultTitleI18n: { en: 'Weekly' }, sourceLocale: 'en', createdById: userId, updatedById: userId,
      } });
      await prisma.pageTemplateVersion.create({ data: {
        templateId: template.id, version: 1, contentI18n: { en: '# Weekly' },
        contentHash: 'a'.repeat(64), sourcePageId, createdById: userId,
      } });
      await prisma.page.update({ where: { id: createdPageId }, data: {
        sourceTemplateId: template.id, sourceTemplateVersion: 1, sourceTemplateLocale: 'en',
      } });

      await assert.rejects(
        prisma.$executeRawUnsafe(
          `UPDATE "${schemaName}"."Page" SET "sourceTemplateVersion" = NULL WHERE "id" = $1`, createdPageId,
        ), /check|constraint/iu,
      );
      await assert.rejects(
        prisma.$executeRawUnsafe(
          `UPDATE "${schemaName}"."Page" SET "sourceTemplateLocale" = 'fr' WHERE "id" = $1`, createdPageId,
        ), /check|constraint/iu,
      );
      await assert.rejects(
        prisma.page.update({ where: { id: createdPageId }, data: {
          sourceTemplateId: template.id, sourceTemplateVersion: 99, sourceTemplateLocale: 'en',
        } }), /foreign key|constraint/iu,
      );
      await assert.rejects(
        prisma.pageTemplateVersion.delete({ where: {
          templateId_version: { templateId: template.id, version: 1 },
        } }), /foreign key|constraint/iu,
      );
      await assert.rejects(
        prisma.pageTemplate.create({ data: {
          scope: 'system', scopeKey: spaceId, spaceId, stableKey: 'invalid', category: 'other',
          displayOrder: 1, nameI18n: { en: 'Invalid' }, descriptionI18n: { en: '' },
          defaultTitleI18n: { en: 'Invalid' },
        } }), /check|constraint/iu,
      );
    } finally { await prisma.$disconnect(); }
  });
});
```

- [ ] **Step 2: Run the static part and verify the missing helper failure**

Run: `cd agentwiki && node --test scripts/page-template-schema-db.test.mjs`

Expected: FAIL with missing `page-template-test-database.mjs` before any database access.

- [ ] **Step 3: Implement the fail-closed isolated schema harness**

```js
// page-template-test-database.mjs
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const SAFE_SCHEMA = /^page_template_test_[a-z0-9_]+$/u;

export function validatePageTemplateTestDatabaseUrl(value) {
  if (!value) throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL is required');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL must be a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL must use PostgreSQL');
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!databaseName || !databaseName.toLowerCase().includes('test')) throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL database name must contain test');
  const schema = parsed.searchParams.get('schema');
  if (schema && !SAFE_SCHEMA.test(schema)) throw new Error('PAGE_TEMPLATE_TEST_DATABASE_URL schema must use page_template_test_ prefix');
  return parsed;
}

const quoteIdentifier = (value) => {
  if (!SAFE_SCHEMA.test(value)) throw new Error('Refusing unsafe page-template test schema identifier');
  return `"${value.replaceAll('"', '""')}"`;
};

export async function withPageTemplateTestDatabase(baseDatabaseUrl, callback) {
  const parsed = validatePageTemplateTestDatabaseUrl(baseDatabaseUrl);
  parsed.searchParams.delete('schema');
  const administrativeUrl = parsed.toString();
  const schemaName = `page_template_test_${randomUUID().replaceAll('-', '')}`;
  const schemaSql = quoteIdentifier(schemaName);
  const testUrl = new URL(administrativeUrl);
  testUrl.searchParams.set('schema', schemaName);
  const databaseUrl = testUrl.toString();
  const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl } } });
  let created = false;
  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${schemaSql}`);
    created = true;
    const migration = spawnSync('pnpm', ['--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy'], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 90_000,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    if (migration.error || migration.status !== 0) {
      throw new Error([migration.error?.message, migration.stdout, migration.stderr].filter(Boolean).join('\n'));
    }
    return await callback({ databaseUrl, schemaName });
  } finally {
    try { if (created) await prisma.$executeRawUnsafe(`DROP SCHEMA ${schemaSql} CASCADE`); }
    finally { await prisma.$disconnect(); }
  }
}
```

- [ ] **Step 4: Add and run the isolated database command**

Add to root scripts:

```json
"test:e2e:page-template-db": "node --test scripts/page-template-schema-db.test.mjs"
```

Run without the env first:

`cd agentwiki && pnpm test:e2e:page-template-db`

Expected: URL safety test passes and database test is explicitly skipped.

Then run only when a dedicated database URL is configured:

```bash
cd agentwiki
test -n "$PAGE_TEMPLATE_TEST_DATABASE_URL"
pnpm test:e2e:page-template-db
```

Expected: the first command proves the caller explicitly exported the dedicated test URL; the suite reports `2 pass, 0 fail, 0 skipped`; the random schema is dropped in `finally`.

- [ ] **Step 5: Commit the real database guard**

```bash
cd agentwiki
git add scripts/page-template-test-database.mjs scripts/page-template-schema-db.test.mjs package.json
git commit -m "test(page-templates): verify database integrity guards"
```

---

### Task 12: Exercise the complete owner/editor/viewer flow in a real browser

**Files:**
- Create: `agentwiki/apps/client/e2e/page-templates.spec.ts`

**Interfaces:**
- Consumes: running local API and frontend, real PostgreSQL, all feature routes.
- Produces: Playwright evidence for bilingual system templates, custom template lifecycle, immutable old pages, roles, focus, and 390px layout.

- [ ] **Step 1: Add a serial fixture with owner, editor, viewer, Space, and source pages**

```ts
import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import { mkdir } from 'node:fs/promises';
import { resolveE2ETarget } from '../src/config/localTargets';

const apiBaseUrl = resolveE2ETarget({
  configured: process.env.AGENTWIKI_API_URL,
  fallback: 'http://127.0.0.1:3000/api/',
  allowRemote: process.env.ALLOW_REMOTE_E2E,
  label: 'Playwright API target',
});
const artifacts = path.join(os.tmpdir(), 'agentwiki-page-template-qa');
let api: APIRequestContext;
let spaceId = '';
let sourcePageId = '';
let firstCreatedPageId = '';
let owner: any;
let editor: any;
let viewer: any;

const register = async (suffix: string, name: string) => {
  const response = await api.post('auth/register', { data: {
    email: `${suffix}@page-template.test`, password: 'AgentWiki9Test', name,
  }});
  expect(response.ok()).toBeTruthy();
  return response.json();
};

test.describe.serial('page template library', () => {
  test.beforeAll(async () => {
    await mkdir(artifacts, { recursive: true });
    api = await playwrightRequest.newContext({ baseURL: `${apiBaseUrl.replace(/\/+$/u, '')}/` });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    owner = await register(`owner-${suffix}`, 'Template Owner');
    editor = await register(`editor-${suffix}`, 'Template Editor');
    viewer = await register(`viewer-${suffix}`, 'Template Viewer');
    const ownerHeaders = { Authorization: `Bearer ${owner.access_token}` };
    const createdSpace = await api.post('spaces', { headers: ownerHeaders, data: { name: 'Page Template QA' } });
    expect(createdSpace.ok()).toBeTruthy();
    spaceId = (await createdSpace.json()).id;
    for (const [email, role] of [[editor.user.email, 'editor'], [viewer.user.email, 'viewer']] as const) {
      expect((await api.post(`spaces/${spaceId}/members`, { headers: ownerHeaders, data: { email, role } })).ok()).toBeTruthy();
    }
    const source = await api.post('pages', { headers: ownerHeaders, data: {
      spaceId, title: 'Team source', content: '# Team source\n\n## Shared section\n- [ ] First version',
    }});
    expect(source.ok()).toBeTruthy();
    sourcePageId = (await source.json()).id;
  });

  test.afterAll(async () => {
    if (api) {
      const headers = owner?.access_token ? { Authorization: `Bearer ${owner.access_token}` } : undefined;
      if (headers && spaceId) await api.delete(`spaces/${spaceId}`, { headers });
      for (const account of [owner, editor, viewer]) {
        if (account?.access_token && account?.user?.id) {
          await api.delete(`users/${account.user.id}`, {
            headers: { Authorization: `Bearer ${account.access_token}` },
          });
        }
      }
      await api.dispose();
    }
  });
```

- [ ] **Step 2: Add an authentication helper and owner custom-template flow**

```ts
const authenticate = async (page: Page, account: any, language: 'zh-CN' | 'en') => {
  await page.addInitScript(({ token, user, locale }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('agentwiki.language.v1', locale);
  }, { token: account.access_token, user: account.user, locale: language });
};

test('Owner saves a page as a Space template and creates from it', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await authenticate(page, owner, 'zh-CN');
  await page.goto(`/pages/${sourcePageId}/edit`);
  await page.getByRole('button', { name: '更多页面操作' }).click();
  await page.getByRole('menuitem', { name: '保存为 Space 模板' }).click();
  await page.getByLabel('模板名称').fill('团队任务模板');
  await page.getByLabel('模板说明').fill('团队统一任务结构');
  await page.getByLabel('分类').selectOption('planning');
  await page.getByLabel('默认页面标题').fill('团队任务');
  await page.getByRole('button', { name: '保存模板' }).click();
  await expect(page.getByText('模板已创建')).toBeVisible();

  await page.goto(`/spaces/${spaceId}`);
  const opener = page.getByRole('button', { name: '新建页面' });
  await opener.click();
  await page.getByRole('button', { name: /团队任务模板/ }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByLabel('标题').fill('团队任务实例一');
  await page.getByRole('button', { name: '创建' }).click();
  await page.waitForURL(/\/pages\/[^/]+\/edit$/u);
  firstCreatedPageId = new URL(page.url()).pathname.split('/').at(-2)!;
  await expect(page.getByRole('heading', { name: 'Shared section' })).toBeVisible();
  await page.screenshot({ path: path.join(artifacts, 'custom-template-created.png'), fullPage: true });
  expect(consoleErrors).toEqual([]);
});
```

- [ ] **Step 3: Add immutable-version and role tests**

Add this exact owner test after the create test. It updates the source with optimistic concurrency, creates version 2 through the manager, creates a second page, and reads both pages back from the API:

```ts
test('A new template version never mutates pages created from version 1', async ({ page }) => {
  const headers = { Authorization: `Bearer ${owner.access_token}` };
  const sourceResponse = await api.get(`pages/${sourcePageId}`, { headers });
  expect(sourceResponse.ok()).toBeTruthy();
  const source = await sourceResponse.json();
  const updatedSource = await api.patch(`pages/${sourcePageId}`, { headers, data: {
    title: source.title,
    content: '# Team source\n\n## Shared section\n- [ ] Second version',
    expectedUpdatedAt: source.updatedAt,
  }});
  expect(updatedSource.ok()).toBeTruthy();

  await authenticate(page, owner, 'zh-CN');
  await page.goto(`/spaces/${spaceId}/settings/page-templates`);
  const row = page.getByRole('row', { name: /团队任务模板/ });
  await row.getByRole('button', { name: '从页面更新内容' }).click();
  await page.getByLabel('源页面').selectOption(sourcePageId);
  await page.getByRole('button', { name: '创建新版本' }).click();
  await expect(page.getByText('模板已更新')).toBeVisible();

  await page.goto(`/spaces/${spaceId}`);
  await page.getByRole('button', { name: '新建页面' }).click();
  await page.getByRole('button', { name: /团队任务模板/ }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByLabel('标题').fill('团队任务实例二');
  await page.getByRole('button', { name: '创建' }).click();
  await page.waitForURL(/\/pages\/[^/]+\/edit$/u);
  const secondCreatedPageId = new URL(page.url()).pathname.split('/').at(-2)!;

  const [firstResponse, secondResponse] = await Promise.all([
    api.get(`pages/${firstCreatedPageId}`, { headers }),
    api.get(`pages/${secondCreatedPageId}`, { headers }),
  ]);
  expect(firstResponse.ok()).toBeTruthy();
  expect(secondResponse.ok()).toBeTruthy();
  const firstPage = await firstResponse.json();
  const secondPage = await secondResponse.json();
  expect(firstPage.content).toContain('First version');
  expect(firstPage.content).not.toContain('Second version');
  expect(secondPage.content).toContain('Second version');
  expect(firstPage.sourceTemplateVersion).toBe(1);
  expect(secondPage.sourceTemplateVersion).toBe(2);
});

test('Owner archives and restores the Space template from settings', async ({ page }) => {
  await authenticate(page, owner, 'zh-CN');
  await page.goto(`/spaces/${spaceId}/settings/page-templates`);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('row', { name: /团队任务模板/ })
    .getByRole('button', { name: /归档/ }).click();
  await page.getByRole('checkbox', { name: '显示已归档模板' }).check();
  const archivedRow = page.getByRole('row', { name: /团队任务模板/ });
  await expect(archivedRow.getByRole('button', { name: /恢复/ })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await archivedRow.getByRole('button', { name: /恢复/ }).click();
  await expect(page.getByText('模板已更新')).toBeVisible();
});
```

Then add the exact permission test:

```ts
test('Editor can use but cannot manage; Viewer cannot create', async ({ browser }) => {
  const editorPage = await browser.newPage();
  await authenticate(editorPage, editor, 'en');
  await editorPage.goto(`/spaces/${spaceId}`);
  await expect(editorPage.getByRole('button', { name: 'New page' })).toBeVisible();
  await editorPage.getByRole('button', { name: 'New page' }).click();
  await expect(editorPage.getByRole('link', { name: 'Manage templates' })).toHaveCount(0);
  await editorPage.getByRole('button', { name: /团队任务模板/ }).click();
  await editorPage.getByRole('button', { name: 'Next' }).click();
  await editorPage.getByLabel('Title').fill('Editor custom-template page');
  await editorPage.getByRole('button', { name: 'Create' }).click();
  await editorPage.waitForURL(/\/pages\/[^/]+\/edit$/u);
  await expect(editorPage.getByRole('heading', { name: 'Shared section' })).toBeVisible();
  await editorPage.goto(`/spaces/${spaceId}/settings/page-templates`);
  await expect(editorPage.getByText('团队任务模板')).toBeVisible();
  await expect(editorPage.getByRole('button', { name: /Edit|Archive|Update content/ })).toHaveCount(0);

  const viewerPage = await browser.newPage();
  await authenticate(viewerPage, viewer, 'en');
  await viewerPage.goto(`/spaces/${spaceId}`);
  await expect(viewerPage.getByRole('button', { name: 'New page' })).toHaveCount(0);
});
```

The Chinese assertion in the English UI is deliberate: custom templates retain their authoring language and are not auto-translated.

- [ ] **Step 4: Add bilingual system-template and 390px overflow/focus tests**

```ts
test('Chinese and English system templates create localized Markdown', async ({ browser }) => {
  for (const scenario of [
    { locale: 'zh-CN' as const, template: /日报/, title: '中文日报验收', heading: '今日完成' },
    { locale: 'en' as const, template: /Weekly report/, title: 'English weekly acceptance', heading: 'Weekly summary' },
  ]) {
    const localizedPage = await browser.newPage();
    await authenticate(localizedPage, owner, scenario.locale);
    await localizedPage.goto(`/spaces/${spaceId}`);
    await localizedPage.getByRole('button', { name: scenario.locale === 'zh-CN' ? '新建页面' : 'New page' }).click();
    await localizedPage.getByRole('button', { name: scenario.template }).click();
    await localizedPage.getByRole('button', { name: scenario.locale === 'zh-CN' ? '下一步' : 'Next' }).click();
    await localizedPage.getByLabel(scenario.locale === 'zh-CN' ? '标题' : 'Title').fill(scenario.title);
    await localizedPage.getByRole('button', { name: scenario.locale === 'zh-CN' ? '创建' : 'Create' }).click();
    await localizedPage.waitForURL(/\/pages\/[^/]+\/edit$/u);
    await expect(localizedPage.getByRole('heading', { name: scenario.heading })).toBeVisible();
    await localizedPage.close();
  }
});

test('Blank creation keeps the parent-page behavior and no template provenance', async ({ page }) => {
  const headers = { Authorization: `Bearer ${owner.access_token}` };
  await authenticate(page, owner, 'zh-CN');
  await page.goto(`/spaces/${spaceId}`);
  await page.getByRole('button', { name: '新建页面' }).click();
  await expect(page.getByRole('button', { name: /空白页面/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByLabel('标题').fill('空白子页面');
  await page.getByLabel('父页面（可选）').selectOption(sourcePageId);
  await page.getByRole('button', { name: '创建' }).click();
  await page.waitForURL(/\/pages\/[^/]+\/edit$/u);
  const blankPageId = new URL(page.url()).pathname.split('/').at(-2)!;
  const response = await api.get(`pages/${blankPageId}`, { headers });
  expect(response.ok()).toBeTruthy();
  const blankPage = await response.json();
  expect(blankPage).toMatchObject({
    parentId: sourcePageId, content: '',
    sourceTemplateId: null, sourceTemplateVersion: null, sourceTemplateLocale: null,
  });
});

test('English system template and mobile dialog are usable without overflow', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await authenticate(page, owner, 'en');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/spaces/${spaceId}`);
  const opener = page.getByRole('button', { name: 'New page' });
  await opener.click();
  await expect(page.getByRole('button', { name: /Weekly report/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.getByRole('button', { name: /Weekly report/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel('Title')).toHaveValue(/Weekly report \d{4}-W\d{2}/u);
  await page.getByRole('button', { name: 'Back' }).click();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await page.screenshot({ path: path.join(artifacts, 'template-dialog-mobile.png'), fullPage: true });
  expect(consoleErrors).toEqual([]);
});
```

- [ ] **Step 5: Run the real browser suite against local services**

Start the local API and frontend with a disposable local development database, then run:

`cd agentwiki && pnpm --filter @agentwiki/client exec playwright test e2e/page-templates.spec.ts`

Expected: owner lifecycle, immutable versions, Editor/Viewer permissions, bilingual system template, mobile overflow, focus, and console assertions all pass.

- [ ] **Step 6: Commit browser acceptance**

```bash
cd agentwiki
git add apps/client/e2e/page-templates.spec.ts
git commit -m "test(page-templates): cover browser template lifecycle"
```

---

### Task 13: Run full verification, review the diff, and record evidence

**Files:**
- Create: `agentwiki/docs/testing/page-template-library-acceptance.md`
- Modify: `.codex-memory/current.md`
- Modify: `.codex-memory/tasks/active/page-template-library/brief.md`
- Modify: `.codex-memory/tasks/active/page-template-library/decisions.md`
- Modify: `.codex-memory/tasks/active/page-template-library/refs.md`

**Interfaces:**
- Consumes: all implementation tasks and real database/browser configuration.
- Produces: independently reviewable evidence, current project state, and a release boundary that does not imply push/publish/deploy.

- [ ] **Step 1: Run all focused suites from a clean command invocation**

```bash
cd agentwiki
node --test scripts/page-template-schema.test.mjs
pnpm --filter @agentwiki/server exec jest --runInBand src/page-templates src/core/dto/page-template-create.validator.spec.ts src/core/dto/page.dto.spec.ts src/core/page/page.service.spec.ts src/review/agent-write-boundary.spec.ts
pnpm --filter @agentwiki/client test -- src/features/page-templates src/features/space/SpaceSettings.spec.tsx src/features/page/PageEditor.spec.tsx src/App.spec.tsx src/components/ModalDialog.test.tsx
```

Expected: every named suite exits 0 with no skipped focused test.

- [ ] **Step 2: Run the required real database and browser gates**

```bash
cd agentwiki
test -n "$PAGE_TEMPLATE_TEST_DATABASE_URL"
pnpm test:e2e:page-template-db
pnpm --filter @agentwiki/client exec playwright test e2e/page-templates.spec.ts
```

Expected: database reports `2 pass, 0 fail, 0 skipped`; Playwright passes all scenarios. Do not replace the database command with `DATABASE_URL`, and do not continue to a completion claim if the dedicated database gate was skipped.

- [ ] **Step 3: Run full repository quality gates**

```bash
cd agentwiki
pnpm test:runtime
pnpm --filter @agentwiki/server test
pnpm --filter @agentwiki/client test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: every command exits 0. Record exact pass/skip counts from Jest, Vitest, and Node test output.

- [ ] **Step 4: Perform a fresh diff review before claiming completion**

Run:

```bash
git diff --check
git status --short --branch
git diff --stat origin/master...HEAD
git diff origin/master...HEAD -- apps/server/src/page-templates apps/server/src/core/page apps/server/src/core/dto apps/client/src/features/page-templates apps/client/src/features/space/SpaceView.tsx apps/client/src/features/page/PageEditor.tsx apps/server/prisma
```

Review every changed path for:

- client-trusted Markdown or cross-Space template access;
- Agent template-field fallback into empty ChangeSets;
- unconditional template updates or archived-template reuse;
- missing optimistic predicates;
- nullable provenance fields escaping the tuple check;
- unbounded list responses;
- stale async responses changing another Space or page;
- dirty editor state being marked clean;
- English/Chinese copy gaps and 390px overflow.

Resolve every actionable finding with a failing regression test, minimal fix, focused rerun, and a separate `fix(page-templates): address final review findings` commit.

- [ ] **Step 5: Use the required review and verification skills**

Invoke `superpowers:requesting-code-review` for an independent code-path review, address findings through `superpowers:receiving-code-review`, then invoke `superpowers:verification-before-completion` and rerun the commands it requires. A focused-green implementation is not completion evidence without this fresh review.

- [ ] **Step 6: Write the acceptance record with observed evidence only**

Create `docs/testing/page-template-library-acceptance.md` containing:

- commit range and local branch;
- exact database schema name pattern and confirmation it was dropped;
- focused and full test commands with observed pass/skip counts;
- browser scenarios, viewport sizes, screenshots, and console counts;
- verified permission matrix and immutable-version observations;
- remaining risks;
- explicit release state: local only, GitHub not pushed, npm unchanged, production not deployed.

Do not include unchecked boxes, template text, planned counts, or unobserved claims.

- [ ] **Step 7: Update structured project memory**

Update `.codex-memory/current.md` to the actual implementation state. Update the active task brief with implementation commits, tests, database/browser evidence, and remaining release work; add any durable decision discovered during implementation to `decisions.md`; add exact evidence paths to `refs.md`. Keep the task active unless all locally requested work and any separately authorized release work are complete.

- [ ] **Step 8: Commit verification evidence and memory**

```bash
cd agentwiki
git add docs/testing/page-template-library-acceptance.md ../.codex-memory/current.md ../.codex-memory/tasks/active/page-template-library
git commit -m "docs: verify page template library"
```

- [ ] **Step 9: Report boundaries separately**

Report local branch/commit, `origin/master`, npm versions, and production state as four separate facts. Do not push, publish, or deploy as part of this plan without a new explicit user authorization.
