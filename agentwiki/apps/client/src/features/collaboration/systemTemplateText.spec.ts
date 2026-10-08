import { describe, expect, it } from 'vitest';
import { BUILT_IN_COLLABORATION_TEMPLATES } from '../../../../server/src/collaboration-workflows/template-definitions';
import { messages } from '../../i18n/messages';
import { runSystemTemplateText, systemTemplateText } from './systemTemplateText';
import type { CollaborationRun, TemplateSummary } from './types';

describe('built-in Todo presentation coverage', () => {
  it.each(BUILT_IN_COLLABORATION_TEMPLATES.map((seed) => [seed.slug, seed] as const))('translates every current %s system Todo while preserving copied/custom values', (slug, seed) => {
    const template: TemplateSummary = { id: `system-${slug}`, slug, spaceId: null, system: true, name: seed.name.en, description: seed.description.en, version: seed.seedVersion };
    const zh = (key: string) => messages['zh-CN'][key] ?? key;
    const en = (key: string) => messages.en[key] ?? key;
    const names = seed.definition.nodes.flatMap((node) => node.kind === 'agent_task' ? [node.name, node.objective, ...node.todos.map((todo) => todo.name)] : [node.name, ...node.approvalCriteria]);
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

it('preserves text-identical custom Run fields when the server explicitly denies system provenance', () => {
  const run = { systemTemplateSource: null } as CollaborationRun;
  const template = { system: true, spaceId: null, slug: 'coding' } as TemplateSummary;
  const t = (key: string) => messages['zh-CN'][key] ?? key;
  for (const value of ['需求分析 / Requirements analysis', 'Clarify scope', 'Evidence is complete']) {
    expect(runSystemTemplateText(run, template, value, t)).toBe(value);
  }
});
