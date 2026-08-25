import { PageTemplateCategory } from '@prisma/client';
import {
  BUILT_IN_PAGE_TEMPLATES,
  BuiltInPageTemplateCategorySchema,
} from './page-template-definitions';
import { localizedValue, normalizeTemplateName, templateContentHash } from './page-template.types';

describe('built-in page templates', () => {
  it('defines the exact ordered bilingual catalog', () => {
    expect(Object.isFrozen(BUILT_IN_PAGE_TEMPLATES)).toBe(true);
    expect(BUILT_IN_PAGE_TEMPLATES.map((seed) => seed.stableKey)).toEqual([
      'task-list', 'project-management', 'daily-report', 'weekly-report',
      'meeting-notes', 'decision-record', 'retrospective',
    ]);
    for (const [index, seed] of BUILT_IN_PAGE_TEMPLATES.entries()) {
      expect(seed.displayOrder).toBe(index + 1);
      expect(seed.seedVersion).toBe(1);
      expect(seed.name['zh-CN']).not.toEqual(seed.name.en);
      expect(seed.content['zh-CN']).not.toEqual(seed.content.en);
      expect(seed.content['zh-CN']).toContain('## ');
      expect(seed.content.en).toContain('## ');
      expect(Object.isFrozen(seed)).toBe(true);
      for (const localized of [seed.name, seed.description, seed.defaultTitle, seed.content]) {
        expect(Object.isFrozen(localized)).toBe(true);
      }
    }
  });

  it('derives built-in categories from Prisma while excluding other', () => {
    expect(BuiltInPageTemplateCategorySchema.options).toEqual([
      PageTemplateCategory.planning,
      PageTemplateCategory.reporting,
      PageTemplateCategory.knowledge,
    ]);
    expect(BuiltInPageTemplateCategorySchema.safeParse(PageTemplateCategory.other).success).toBe(false);
    expect(BUILT_IN_PAGE_TEMPLATES.every((seed) => (
      BuiltInPageTemplateCategorySchema.safeParse(seed.category).success
    ))).toBe(true);
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
