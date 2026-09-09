import { validateCompositeDefinition } from './composite-template-validator';
import { BUILT_IN_COLLABORATION_TEMPLATES } from '../collaboration-workflows/template-definitions';
import { BUILT_IN_COMPOSITE_TEMPLATES } from './composite-template-definitions';

describe('built-in composite page-group templates', () => {
  it('ships the six stable bilingual page groups with real root folders', () => {
    expect(BUILT_IN_COMPOSITE_TEMPLATES.map((seed) => seed.stableKey)).toEqual([
      'project-workspace', 'coding-workspace', 'bid-workspace',
      'paper-workspace', 'video-script-workspace', 'novel-workspace',
    ]);
    for (const seed of BUILT_IN_COMPOSITE_TEMPLATES) {
      expect(seed.seedVersion).toBe(2);
      expect(seed.name['zh-CN']).toBeTruthy();
      expect(seed.name.en).toBeTruthy();
      expect(seed.definition.kind).toBe('page_group');
      const roots = seed.definition.nodes.filter((node) => node.parentNodeId === null);
      expect(roots).toHaveLength(1);
      expect(roots[0]?.kind).toBe('folder');
      for (const node of seed.definition.nodes) {
        const localized = node.kind === 'folder' ? node.nameI18n : node.titleI18n;
        expect(localized['zh-CN']).toBeTruthy();
        expect(localized.en).toBeTruthy();
      }
      expect(validateCompositeDefinition(seed.definition)).toEqual([]);
      expect(Object.isFrozen(seed.definition)).toBe(true);
    }
  });

  it('gives every document localized filling guidance, an example and a completion checklist', () => {
    const expectedCounts = [7, 8, 7, 6, 7, 6];
    for (const [index, seed] of BUILT_IN_COMPOSITE_TEMPLATES.entries()) {
      const pages = seed.definition.nodes.filter((node) => node.kind === 'page');
      expect(pages).toHaveLength(expectedCounts[index]);
      for (const node of pages) {
        for (const locale of ['zh-CN', 'en'] as const) {
          const body = node.contentI18n[locale] as string;
          const sections = locale === 'zh-CN'
            ? ['## 填写前', '## 填写示例', '## 完成检查', '## 文档衔接']
            : ['## Before you start', '## Worked example', '## Completion checklist', '## Related documents'];
          for (const section of sections) expect({ page: node.nodeId, body }).toEqual(expect.objectContaining({ body: expect.stringContaining(section) }));
          expect((body.match(/^## /gm) ?? []).length).toBeGreaterThanOrEqual(7);
          expect(body).toMatch(/\|[^\n]+\|/);
          expect((body.match(/^- \[ \]/gm) ?? []).length).toBeGreaterThanOrEqual(3);
          expect(body).toContain(locale === 'zh-CN' ? '示例' : 'example');
        }
      }
    }
  });

  it('preserves all five legacy workflows and maps every Markdown output through one human gate', () => {
    for (const legacy of BUILT_IN_COLLABORATION_TEMPLATES) {
      const composite = BUILT_IN_COMPOSITE_TEMPLATES.find((seed) =>
        seed.legacyWorkflowSlug === legacy.slug)!;
      expect(composite).toBeDefined();
      const workflow = composite.definition.collaboration!.workflow;
      const targets = composite.definition.collaboration!.taskTargets;
      expect(workflow.roleSlots).toEqual(legacy.definition.roleSlots);
      for (const original of legacy.definition.nodes) {
        const preserved = workflow.nodes.find((node) => node.id === original.id);
        expect(preserved).toBeDefined();
        if (original.kind === 'agent_task') {
          expect(preserved).toMatchObject({
            id: original.id,
            roleSlotId: original.roleSlotId,
            objective: original.objective,
            todos: original.todos,
            output: original.output,
          });
          const target = targets.find((candidate) => candidate.taskNodeId === original.id);
          if (original.output.kind === 'markdown') {
            expect(target).toBeDefined();
            expect(preserved).toMatchObject({ humanAcceptance: true });
            expect(workflow.nodes.filter((node) =>
              node.kind === 'human_review' && node.artifactTaskId === original.id)).toHaveLength(1);
          } else {
            expect(target).toBeUndefined();
          }
        }
      }
      expect(workflow.terminalNodeIds.length).toBeGreaterThan(0);
    }
  });

  it('contains the approved project workspace hierarchy and collaboration roles', () => {
    const project = BUILT_IN_COMPOSITE_TEMPLATES[0]!;
    const ids = project.definition.nodes.map((node) => node.nodeId);
    expect(ids).toEqual(expect.arrayContaining([
      'root', 'project-overview', 'planning', 'plan-milestones', 'task-list',
      'governance', 'risks-blockers', 'decision-log', 'progress', 'progress-log', 'retrospective',
    ]));
    expect(project.definition.collaboration!.workflow.roleSlots.map((slot) => slot.id)).toEqual([
      'project-owner', 'execution-owner', 'risk-reviewer',
    ]);
  });
});
