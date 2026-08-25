import { PageTemplateCategory } from '@prisma/client';
import {
  BUILT_IN_PAGE_TEMPLATES,
  BuiltInPageTemplateCategorySchema,
} from './page-template-definitions';
import {
  LocalizedValueSchema,
  localizedValue,
  normalizeTemplateName,
  resolveLocalizedValue,
  systemLocalizedValue,
  templateContentHash,
} from './page-template.types';

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
    expect(templateContentHash(JSON.stringify(BUILT_IN_PAGE_TEMPLATES))).toBe(
      'f183f3a46cbf3d73f31f910899c0a26a0ee3627d254444a80343019760d9d9a9',
    );
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
    expect(normalizeTemplateName('\uff37\uff45\uff45\uff4b\uff4c\uff59\u00a0\n\tREPORT')).toBe('weekly report');
    expect(localizedValue({ en: 'English' }, 'zh-CN', 'en')).toBe('English');
    expect(localizedValue({ 'zh-CN': '中文' }, 'en', 'zh-CN')).toBe('中文');
    expect(localizedValue({ 'zh-CN': '中文' }, 'en', 'en')).toBe('中文');
    expect(templateContentHash('# Same')).toBe(templateContentHash('# Same'));
    expect(templateContentHash('# Same')).not.toBe(templateContentHash('# Different'));
    expect(templateContentHash('中文')).toBe(
      '72726d8818f693066ceb69afa364218b692e62ea92b385782363780f47529c21',
    );
    expect(templateContentHash('# Same\n')).not.toBe(templateContentHash('# Same'));
  });

  it('rejects malformed localized helper inputs at every boundary', () => {
    expect(LocalizedValueSchema.safeParse({}).success).toBe(false);
    expect(LocalizedValueSchema.safeParse({ en: 'English', fr: 'Français' }).success).toBe(false);
    expect(LocalizedValueSchema.safeParse({ en: 'x'.repeat(200_001) }).success).toBe(false);
    expect(() => systemLocalizedValue({ en: 'English' })).toThrow(
      'System page templates require zh-CN and en',
    );
    expect(systemLocalizedValue({ 'zh-CN': '中文', en: 'English' })).toEqual({
      'zh-CN': '中文', en: 'English',
    });
  });

  it('returns the requested system value with its actual locale', () => {
    expect(resolveLocalizedValue(
      { 'zh-CN': '中文', en: 'English' }, { scope: 'system', requested: 'zh-CN' },
    )).toEqual({ value: '中文', locale: 'zh-CN' });
  });

  it('returns the English system fallback with locale en', () => {
    expect(resolveLocalizedValue(
      { en: 'English' }, { scope: 'system', requested: 'zh-CN' },
    )).toEqual({ value: 'English', locale: 'en' });
  });

  it('returns only the strict Space source locale', () => {
    expect(resolveLocalizedValue(
      { 'zh-CN': '中文', en: 'English' }, { scope: 'space', sourceLocale: 'zh-CN' },
    )).toEqual({ value: '中文', locale: 'zh-CN' });
  });

  it('rejects Space content missing its source locale', () => {
    expect(() => resolveLocalizedValue(
      { en: 'English' }, { scope: 'space', sourceLocale: 'zh-CN' },
    )).toThrow();
  });
});
