import type { CompositeTemplateDefinition } from '@neomei/agentwiki-sync-protocol';
import {
  compareCompositeTemplateSiblingOrder,
  normalizeLegacyVersion,
  validateCompositeDefinition,
  validateCompositeTaskSelection,
} from './composite-template-validator';

const task = (id: string, output = `${id}-output`) => ({
  kind: 'agent_task' as const,
  id,
  name: id,
  roleSlotId: 'writer',
  objective: `Complete ${id}`,
  inputKeys: [],
  upstreamArtifacts: [],
  output: { key: output, kind: 'markdown' as const },
  evidenceRequired: [],
  humanAcceptance: true,
  leaseSeconds: 300,
  maxExecutionSeconds: 3600,
  retryBudget: 1,
  repairBudget: 1,
  skippable: false,
  todos: [{ id: 'write', name: 'Write', required: true, evidenceKinds: [] }],
});

const review = (taskId: string) => ({
  kind: 'human_review' as const,
  id: `review-${taskId}`,
  name: `Review ${taskId}`,
  artifactTaskId: taskId,
  minimumRole: 'editor' as const,
  reviewerUserIds: [],
  approvalCriteria: ['Complete'],
  revisionTaskId: taskId,
  allowTerminate: true,
});

const single = (): CompositeTemplateDefinition => ({
  schemaVersion: 1,
  kind: 'single_page',
  nodes: [{
    nodeId: 'page', parentNodeId: null, kind: 'page', order: 0,
    titleI18n: { en: 'Page' }, contentI18n: { en: '# Page' }, roleSlotKey: 'writer',
  }],
  collaboration: {
    workflow: {
      schemaVersion: 1,
      inputs: [],
      roleSlots: [{ id: 'writer', name: 'Writer', required: true, description: 'Writes' }],
      nodes: [task('draft'), review('draft')],
      dependencies: [{ from: 'draft', to: 'review-draft', mode: 'all' }],
      terminalNodeIds: ['review-draft'],
    },
    taskTargets: [{ taskNodeId: 'draft', pageNodeId: 'page' }],
  },
});

describe('composite template validator', () => {
  it('wraps a legacy version without mutating it', () => {
    const contentI18n = { 'zh-CN': '# 纪要', en: '# Notes' };
    const before = structuredClone(contentI18n);

    expect(normalizeLegacyVersion(contentI18n)).toEqual({
      schemaVersion: 1,
      kind: 'single_page',
      nodes: [{
        nodeId: 'page', parentNodeId: null, kind: 'page', order: 0,
        titleI18n: { 'zh-CN': '', en: '' },
        contentI18n,
        roleSlotKey: null,
      }],
      collaboration: null,
    });
    expect(contentI18n).toEqual(before);
    expect(normalizeLegacyVersion(contentI18n).nodes[0]).not.toBe(contentI18n);
  });

  it('reports stable tree issue codes and permits deterministic sibling order ties', () => {
    const base = single();
    expect(validateCompositeDefinition(base)).toEqual([]);
    expect(validateCompositeDefinition({ ...base, nodes: [base.nodes[0], base.nodes[0]] }))
      .toContainEqual({ code: 'TEMPLATE_NODE_DUPLICATE', nodeId: 'page' });

    const root = { nodeId: 'root', parentNodeId: null, kind: 'folder' as const, order: 0, nameI18n: { en: 'Root' } };
    const folder = { nodeId: 'folder', parentNodeId: 'root', kind: 'folder' as const, order: 0, nameI18n: { en: 'Folder' } };
    const page = {
      nodeId: 'page', parentNodeId: 'folder', kind: 'page' as const, order: 0,
      titleI18n: { en: 'Page' }, contentI18n: { en: '# Page' }, roleSlotKey: 'writer',
    };
    const group = { ...base, kind: 'page_group' as const, nodes: [root, folder, page] };
    expect(validateCompositeDefinition(group)).toEqual([]);
    const tied = { ...group, nodes: [root, folder, { ...page, roleSlotKey: null }, { ...page, nodeId: 'page-b', order: 0, roleSlotKey: null }] };
    expect(validateCompositeDefinition({
      ...group,
      nodes: tied.nodes,
      collaboration: null,
    })).toEqual([]);
    expect(tied.nodes.slice(2).reverse().sort(compareCompositeTemplateSiblingOrder).map((node) => node.nodeId))
      .toEqual(['page', 'page-b']);
    expect(validateCompositeDefinition({ ...group, nodes: [root, { ...folder, parentNodeId: 'folder' }, page] }))
      .toContainEqual({ code: 'TEMPLATE_TREE_CYCLE', nodeId: 'folder' });
    expect(validateCompositeDefinition({ ...group, nodes: [root, { ...folder, parentNodeId: null }, page] }))
      .toContainEqual({ code: 'TEMPLATE_ROOT_INVALID', nodeId: 'folder' });
    expect(validateCompositeDefinition({ ...group, nodes: [root, folder, { ...page, parentNodeId: 'page' }] }))
      .toContainEqual({ code: 'TEMPLATE_PARENT_NOT_FOLDER', nodeId: 'page' });
  });

  it('reports dangling targets, multiple writers, and missing human review gates', () => {
    const base = single();
    expect(validateCompositeDefinition({
      ...base,
      collaboration: { ...base.collaboration!, taskTargets: [{ taskNodeId: 'missing', pageNodeId: 'page' }] },
    })).toContainEqual({ code: 'TEMPLATE_TASK_TARGET_MISSING', nodeId: 'missing' });
    expect(validateCompositeDefinition({
      ...base,
      collaboration: { ...base.collaboration!, taskTargets: [{ taskNodeId: 'draft', pageNodeId: 'missing' }] },
    })).toContainEqual({ code: 'TEMPLATE_PAGE_TARGET_MISSING', nodeId: 'missing' });

    const second = task('second');
    expect(validateCompositeDefinition({
      ...base,
      collaboration: {
        workflow: {
          ...base.collaboration!.workflow,
          nodes: [...base.collaboration!.workflow.nodes, second],
          terminalNodeIds: ['review-draft', 'second'],
        },
        taskTargets: [
          { taskNodeId: 'draft', pageNodeId: 'page' },
          { taskNodeId: 'second', pageNodeId: 'page' },
        ],
      },
    })).toContainEqual({ code: 'TEMPLATE_PAGE_MULTIPLE_WRITERS', nodeId: 'page' });
    expect(validateCompositeDefinition({
      ...base,
      collaboration: {
        workflow: {
          ...base.collaboration!.workflow,
          nodes: [task('draft')], dependencies: [], terminalNodeIds: ['draft'],
        },
        taskTargets: [{ taskNodeId: 'draft', pageNodeId: 'page' }],
      },
    })).toContainEqual({ code: 'TEMPLATE_PAGE_REVIEW_REQUIRED', nodeId: 'page' });

    const invalidWriter = structuredClone(base);
    const writer = invalidWriter.collaboration!.workflow.nodes[0];
    if (writer.kind !== 'agent_task') throw new Error('fixture');
    writer.output.kind = 'external_reference';
    writer.humanAcceptance = false;
    expect(validateCompositeDefinition(invalidWriter)).toEqual(expect.arrayContaining([
      { code: 'TEMPLATE_PAGE_OUTPUT_NOT_MARKDOWN', nodeId: 'page' },
      { code: 'TEMPLATE_PAGE_HUMAN_ACCEPTANCE_REQUIRED', nodeId: 'page' },
    ]));

    const doubleGate = structuredClone(base);
    const extraReview = { ...review('draft'), id: 'review-draft-2' };
    doubleGate.collaboration!.workflow.nodes.push(extraReview);
    doubleGate.collaboration!.workflow.dependencies.push({ from: 'draft', to: extraReview.id, mode: 'all' });
    doubleGate.collaboration!.workflow.terminalNodeIds.push(extraReview.id);
    expect(validateCompositeDefinition(doubleGate))
      .toContainEqual({ code: 'TEMPLATE_PAGE_REVIEW_MULTIPLE', nodeId: 'page' });
  });

  it('delegates complete workflow DAG validation while allowing untargeted research tasks', () => {
    const base = single();
    const research = task('research', 'research-output');
    const broken = {
      ...base,
      collaboration: {
        workflow: {
          ...base.collaboration!.workflow,
          nodes: [research, ...base.collaboration!.workflow.nodes],
          dependencies: [
            { from: 'research', to: 'draft', mode: 'all' as const },
            { from: 'draft', to: 'research', mode: 'all' as const },
            ...base.collaboration!.workflow.dependencies,
          ],
        },
        taskTargets: base.collaboration!.taskTargets,
      },
    };
    expect(validateCompositeDefinition(broken)).toContainEqual({ code: 'DEPENDENCY_CYCLE' });

    const valid = structuredClone(base);
    valid.collaboration!.workflow.nodes.unshift(research);
    valid.collaboration!.workflow.dependencies.unshift({ from: 'research', to: 'draft', mode: 'all' });
    expect(validateCompositeDefinition(valid)).toEqual([]);
  });

  it('validates a retained task selection against the original graph without skipping dependencies', () => {
    const base = single();
    expect(validateCompositeTaskSelection(base, ['draft', 'review-draft'])).toEqual([]);
    expect(validateCompositeTaskSelection(base, ['draft'])).toEqual(expect.arrayContaining([
      { code: 'TEMPLATE_REQUIRED_TERMINAL_REMOVED', nodeId: 'review-draft' },
      { code: 'TEMPLATE_PAGE_REVIEW_REQUIRED', nodeId: 'page' },
    ]));

    const withUpstream = structuredClone(base);
    withUpstream.collaboration!.workflow.nodes.unshift(task('research'));
    withUpstream.collaboration!.workflow.dependencies.unshift({ from: 'research', to: 'draft', mode: 'all' });
    expect(validateCompositeTaskSelection(withUpstream, ['draft', 'review-draft']))
      .toContainEqual({ code: 'TEMPLATE_REQUIRED_UPSTREAM_REMOVED', nodeId: 'draft' });
  });
});
