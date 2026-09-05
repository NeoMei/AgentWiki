import { PageTemplateCategory, type PageTemplateCategory as PageTemplateCategoryValue } from '@prisma/client';
import {
  CollaborationTemplateDefinitionSchema,
  CompositeTemplateDefinitionSchema,
  type CollaborationNode,
  type CollaborationTemplateDefinition,
  type CompositeTemplateDefinition,
  type TemplateNode,
} from '@neomei/agentwiki-sync-protocol';
import { BUILT_IN_COLLABORATION_TEMPLATES } from '../collaboration-workflows/template-definitions';
import { deepFreeze, systemLocalizedValue } from './page-template.types';

type SystemText = Readonly<{ 'zh-CN': string; en: string }>;

export type BuiltInCompositeTemplate = Readonly<{
  stableKey: string;
  category: PageTemplateCategoryValue;
  displayOrder: number;
  seedVersion: number;
  name: SystemText;
  description: SystemText;
  defaultTitle: SystemText;
  legacyWorkflowSlug?: string;
  definition: CompositeTemplateDefinition;
}>;

type PageSpec = Readonly<{
  nodeId: string;
  parentNodeId: string;
  order: number;
  zh: string;
  en: string;
  roleSlotKey: string | null;
  taskNodeId?: string;
}>;

const localized = (zh: string, en: string): SystemText => systemLocalizedValue({ 'zh-CN': zh, en });
const folder = (nodeId: string, parentNodeId: string | null, order: number, zh: string, en: string): TemplateNode => ({
  nodeId, parentNodeId, kind: 'folder', order, nameI18n: localized(zh, en),
});
const page = (spec: PageSpec): TemplateNode => ({
  nodeId: spec.nodeId,
  parentNodeId: spec.parentNodeId,
  kind: 'page',
  order: spec.order,
  titleI18n: localized(spec.zh, spec.en),
  contentI18n: localized(`# ${spec.zh}\n`, `# ${spec.en}\n`),
  roleSlotKey: spec.roleSlotKey,
});

function splitWorkflowName(name: string): { zh: string; en: string } {
  const [zh, ...english] = name.split(' / ');
  return { zh: zh?.trim() || name, en: english.join(' / ').trim() || name };
}

export function addCompositePageReviewGates(
  input: CollaborationTemplateDefinition,
  targetedTaskIds: readonly string[],
): CollaborationTemplateDefinition {
  const workflow = structuredClone(input);
  const targets = new Set(targetedTaskIds);
  const existingReviews = new Map<string, number>();
  for (const node of workflow.nodes) {
    if (node.kind === 'human_review') {
      existingReviews.set(node.artifactTaskId, (existingReviews.get(node.artifactTaskId) ?? 0) + 1);
    }
  }
  for (const node of workflow.nodes) {
    if (node.kind === 'agent_task' && targets.has(node.id)) node.humanAcceptance = true;
  }
  for (const taskId of targetedTaskIds) {
    if ((existingReviews.get(taskId) ?? 0) !== 0) continue;
    const task = workflow.nodes.find((node) => node.kind === 'agent_task' && node.id === taskId);
    if (!task || task.kind !== 'agent_task') continue;
    const reviewId = allocateReviewId(taskId, new Set(workflow.nodes.map((node) => node.id)));
    const review: Extract<CollaborationNode, { kind: 'human_review' }> = {
      kind: 'human_review',
      id: reviewId,
      name: `页面发布审核 / Page review: ${taskId}`,
      artifactTaskId: taskId,
      minimumRole: 'editor',
      reviewerUserIds: [],
      approvalCriteria: ['正文内容已核验 / Page content is verified', '人类批准发布 / Human approves publication'],
      revisionTaskId: taskId,
      allowTerminate: true,
    };
    workflow.nodes.push(review);
    workflow.dependencies = workflow.dependencies.map((dependency) =>
      dependency.from === taskId ? { ...dependency, from: reviewId } : dependency);
    workflow.dependencies.push({ from: taskId, to: reviewId, mode: 'all' });
    workflow.terminalNodeIds = workflow.terminalNodeIds.map((terminal) =>
      terminal === taskId ? reviewId : terminal);
  }
  return CollaborationTemplateDefinitionSchema.parse(workflow);
}

function allocateReviewId(taskId: string, occupied: Set<string>): string {
  const stem = `${taskId.slice(0, 110)}-page-review`;
  if (!occupied.has(stem)) return stem;
  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${stem.slice(0, 128 - tail.length)}${tail}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate Page review id for ${taskId}`);
}

function workflowDefinition(slug: string, root: SystemText): CompositeTemplateDefinition {
  const legacy = BUILT_IN_COLLABORATION_TEMPLATES.find((seed) => seed.slug === slug);
  if (!legacy) throw new Error(`Missing collaboration seed: ${slug}`);
  const tasks = legacy.definition.nodes.filter((node): node is Extract<CollaborationNode, { kind: 'agent_task' }> =>
    node.kind === 'agent_task' && node.output.kind === 'markdown');
  const pages: PageSpec[] = tasks.map((task, index) => {
    const title = splitWorkflowName(task.name);
    return {
      nodeId: task.id,
      parentNodeId: 'root',
      order: index,
      zh: title.zh,
      en: title.en,
      roleSlotKey: task.roleSlotId,
      taskNodeId: task.id,
    };
  });
  return CompositeTemplateDefinitionSchema.parse({
    schemaVersion: 1,
    kind: 'page_group',
    nodes: [folder('root', null, 0, root['zh-CN'], root.en), ...pages.map(page)],
    collaboration: {
      workflow: addCompositePageReviewGates(legacy.definition, pages.map((item) => item.taskNodeId!)),
      taskTargets: pages.map((item) => ({ taskNodeId: item.taskNodeId!, pageNodeId: item.nodeId })),
    },
  });
}

function projectDefinition(): CompositeTemplateDefinition {
  const pages: PageSpec[] = [
    { nodeId: 'project-overview', parentNodeId: 'root', order: 0, zh: '项目概况', en: 'Project overview', roleSlotKey: 'project-owner', taskNodeId: 'write-project-overview' },
    { nodeId: 'plan-milestones', parentNodeId: 'planning', order: 0, zh: '计划与里程碑', en: 'Plan and milestones', roleSlotKey: 'project-owner', taskNodeId: 'write-plan-milestones' },
    { nodeId: 'task-list', parentNodeId: 'planning', order: 1, zh: '任务清单', en: 'Task list', roleSlotKey: 'execution-owner', taskNodeId: 'write-task-list' },
    { nodeId: 'risks-blockers', parentNodeId: 'governance', order: 0, zh: '风险与阻塞', en: 'Risks and blockers', roleSlotKey: 'risk-reviewer', taskNodeId: 'write-risks-blockers' },
    { nodeId: 'decision-log', parentNodeId: 'governance', order: 1, zh: '决策记录', en: 'Decision log', roleSlotKey: 'project-owner', taskNodeId: 'write-decision-log' },
    { nodeId: 'progress-log', parentNodeId: 'progress', order: 0, zh: '进展记录', en: 'Progress log', roleSlotKey: 'execution-owner', taskNodeId: 'write-progress-log' },
    { nodeId: 'retrospective', parentNodeId: 'progress', order: 1, zh: '项目复盘', en: 'Project retrospective', roleSlotKey: 'risk-reviewer', taskNodeId: 'write-retrospective' },
  ];
  const taskNodes: CollaborationNode[] = pages.map((item) => ({
    kind: 'agent_task',
    id: item.taskNodeId!,
    name: `${item.zh} / ${item.en}`,
    roleSlotId: item.roleSlotKey!,
    objective: `Maintain the ${item.en.toLowerCase()} as auditable Markdown.`,
    inputKeys: ['project-brief'],
    upstreamArtifacts: [],
    output: { key: `${item.nodeId}-content`, kind: 'markdown' },
    evidenceRequired: [],
    humanAcceptance: true,
    leaseSeconds: 600,
    maxExecutionSeconds: 14_400,
    retryBudget: 2,
    repairBudget: 2,
    skippable: false,
    todos: [{ id: 'maintain-page', name: `Maintain ${item.en}`, required: true, evidenceKinds: [] }],
  }));
  const base: CollaborationTemplateDefinition = {
    schemaVersion: 1,
    inputs: [{ key: 'project-brief', label: '项目目标 / Project brief', required: true, type: 'long_text' }],
    roleSlots: [
      { id: 'project-owner', name: '项目负责人 / Project owner', required: true, description: 'Owns scope, plans, and decisions' },
      { id: 'execution-owner', name: '执行负责人 / Execution owner', required: true, description: 'Owns tasks and progress' },
      { id: 'risk-reviewer', name: '风险审查 / Risk reviewer', required: true, description: 'Owns risk and retrospective review' },
    ],
    nodes: taskNodes,
    dependencies: taskNodes.slice(0, -1).map((node, index) => ({ from: node.id, to: taskNodes[index + 1]!.id, mode: 'all' })),
    terminalNodeIds: [taskNodes[taskNodes.length - 1]!.id],
  };
  const workflow = addCompositePageReviewGates(base, pages.map((item) => item.taskNodeId!));
  return CompositeTemplateDefinitionSchema.parse({
    schemaVersion: 1,
    kind: 'page_group',
    nodes: [
      folder('root', null, 0, '项目管理工作区', 'Project management workspace'),
      page(pages[0]!),
      folder('planning', 'root', 1, '计划', 'Planning'), page(pages[1]!), page(pages[2]!),
      folder('governance', 'root', 2, '治理', 'Governance'), page(pages[3]!), page(pages[4]!),
      folder('progress', 'root', 3, '进展', 'Progress'), page(pages[5]!), page(pages[6]!),
    ],
    collaboration: {
      workflow,
      taskTargets: pages.map((item) => ({ taskNodeId: item.taskNodeId!, pageNodeId: item.nodeId })),
    },
  });
}

function defineSeed(seed: Omit<BuiltInCompositeTemplate, 'definition'> & { definition: CompositeTemplateDefinition }): BuiltInCompositeTemplate {
  return deepFreeze({
    ...seed,
    name: systemLocalizedValue(seed.name),
    description: systemLocalizedValue(seed.description),
    defaultTitle: systemLocalizedValue(seed.defaultTitle),
    definition: CompositeTemplateDefinitionSchema.parse(structuredClone(seed.definition)),
  });
}

export const BUILT_IN_COMPOSITE_TEMPLATES = deepFreeze([
  defineSeed({
    stableKey: 'project-workspace', category: PageTemplateCategory.planning, displayOrder: 101, seedVersion: 1,
    name: localized('项目管理工作区', 'Project management workspace'),
    description: localized('项目概况、计划、治理和进展的一体化工作区', 'Workspace for project overview, planning, governance, and progress'),
    defaultTitle: localized('项目工作区', 'Project workspace'), definition: projectDefinition(),
  }),
  defineSeed({
    stableKey: 'coding-workspace', category: PageTemplateCategory.planning, displayOrder: 102, seedVersion: 1,
    name: localized('编码协作工作区', 'Coding collaboration workspace'),
    description: localized('从需求到发布审阅的协作页面组', 'Collaborative page group from requirements to release review'),
    defaultTitle: localized('编码工作区', 'Coding workspace'), legacyWorkflowSlug: 'coding',
    definition: workflowDefinition('coding', localized('编码协作', 'Coding collaboration')),
  }),
  defineSeed({
    stableKey: 'bid-workspace', category: PageTemplateCategory.knowledge, displayOrder: 103, seedVersion: 1,
    name: localized('标书撰写工作区', 'Bid writing workspace'),
    description: localized('招标资料、章节稿、合规审核和交付页面组', 'Tender materials, drafts, compliance review, and delivery pages'),
    defaultTitle: localized('标书工作区', 'Bid workspace'), legacyWorkflowSlug: 'bid-writing',
    definition: workflowDefinition('bid-writing', localized('标书撰写', 'Bid writing')),
  }),
  defineSeed({
    stableKey: 'paper-workspace', category: PageTemplateCategory.knowledge, displayOrder: 104, seedVersion: 1,
    name: localized('论文撰写工作区', 'Paper writing workspace'),
    description: localized('研究、文献、方法、章节和审校页面组', 'Research, literature, method, drafting, and review pages'),
    defaultTitle: localized('论文工作区', 'Paper workspace'), legacyWorkflowSlug: 'paper-writing',
    definition: workflowDefinition('paper-writing', localized('论文撰写', 'Paper writing')),
  }),
  defineSeed({
    stableKey: 'video-script-workspace', category: PageTemplateCategory.knowledge, displayOrder: 105, seedVersion: 1,
    name: localized('视频脚本工作区', 'Video script workspace'),
    description: localized('创意、资料、分镜、脚本和审校页面组', 'Creative, research, storyboard, script, and review pages'),
    defaultTitle: localized('视频脚本工作区', 'Video script workspace'), legacyWorkflowSlug: 'video-script-writing',
    definition: workflowDefinition('video-script-writing', localized('视频脚本', 'Video script')),
  }),
  defineSeed({
    stableKey: 'novel-workspace', category: PageTemplateCategory.knowledge, displayOrder: 106, seedVersion: 1,
    name: localized('小说撰写工作区', 'Novel writing workspace'),
    description: localized('世界观、人物、情节、章节和连续性页面组', 'World, character, plot, chapter, and continuity pages'),
    defaultTitle: localized('小说工作区', 'Novel workspace'), legacyWorkflowSlug: 'novel-writing',
    definition: workflowDefinition('novel-writing', localized('小说撰写', 'Novel writing')),
  }),
]);
