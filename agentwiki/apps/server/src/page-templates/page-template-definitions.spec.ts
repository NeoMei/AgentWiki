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
