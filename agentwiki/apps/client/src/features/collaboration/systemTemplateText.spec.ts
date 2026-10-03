import { describe, expect, it } from 'vitest';
import { BUILT_IN_COLLABORATION_TEMPLATES } from '../../../../server/src/collaboration-workflows/template-definitions';
import { messages } from '../../i18n/messages';
import { systemTemplateText } from './systemTemplateText';
import type { TemplateSummary } from './types';

describe('built-in Todo presentation coverage', () => {
  it.each(BUILT_IN_COLLABORATION_TEMPLATES.map((seed) => [seed.slug, seed] as const))('translates every current %s system Todo while preserving copied/custom values', (slug, seed) => {
    const template: TemplateSummary = { id: `system-${slug}`, slug, spaceId: null, system: true, name: seed.name.en, description: seed.description.en, version: seed.seedVersion };
    const zh = (key: string) => messages['zh-CN'][key] ?? key;
    const en = (key: string) => messages.en[key] ?? key;
    const names = seed.definition.nodes.flatMap((node) => node.kind === 'agent_task' ? node.todos.map((todo) => todo.name) : []);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(systemTemplateText(template, name, zh), name).toMatch(/[\u4e00-\u9fff]/u);
      expect(systemTemplateText(template, name, en), name).not.toMatch(/collaboration\.system/u);
      expect(systemTemplateText({ ...template, system: false, spaceId: 'custom' }, name, zh)).toBe(name);
    }
    expect(systemTemplateText(template, 'User custom Todo / 自定义', zh)).toBe('User custom Todo / 自定义');
    expect(systemTemplateText({ ...template, spaceId: 'custom' }, names[0], zh)).toBe(names[0]);
  });
});
