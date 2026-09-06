import {
  CollaborationTemplateDefinitionSchema,
  CompositeTemplateDefinitionSchema,
  type CollaborationNode,
  type CollaborationTemplateDefinition,
  type CompositeTemplateDefinition,
  type TemplateNode,
} from '@neomei/agentwiki-sync-protocol';
import { BusinessException } from '../core/filters/business-error';
import { addCompositePageReviewGates } from './composite-template-definitions';
import {
  validateCompositeDefinition,
  validateCompositeTaskSelection,
} from './composite-template-validator';
import type { PageTemplateLocale } from './page-template.types';

export type FolderTemplateWorkflowSource =
  | { kind: 'structure_only' }
  | { kind: 'template'; versionId: string }
  | {
    kind: 'legacy_workflow';
    templateId: string;
    version: number;
    taskTargets: Array<{ taskNodeId: string; pageId: string }>;
  }
  | { kind: 'simple_pages' };

export type FolderTemplateSnapshotSelection = {
  excludedFolderIds: string[];
  excludedPageIds: string[];
  locale: PageTemplateLocale;
  roleSlotsByPage?: Array<{ pageId: string; roleSlotKey: string | null }>;
  source: FolderTemplateWorkflowSource;
};

export type FolderSnapshotSourceNode =
  | {
    sourceId: string;
    parentSourceId: string | null;
    kind: 'folder';
    order: number;
    createdAt?: Date;
    name: string;
  }
  | {
    sourceId: string;
    parentSourceId: string;
    kind: 'page';
    order: number;
    createdAt?: Date;
    title: string;
    content: string;
    sourceSyncPath: string;
  };

export type FolderSnapshotSource = {
  locale?: PageTemplateLocale;
  nodes: FolderSnapshotSourceNode[];
  bindings: Array<{
    pageId: string;
    hasAgent: boolean;
    roleSlotKey: string | null;
    agentId?: string;
  }>;
  workflow?: {
    definition: CollaborationTemplateDefinition;
    taskTargets: Array<{ taskNodeId: string; pageId: string }>;
  };
};

type SnapshotRoleOverride = { pageId: string; roleSlotKey: string | null };

export type FolderTemplateSourceNodeMap =
  | {
    templateNodeId: string;
    sourceNodeId: string;
    parentSourceNodeId: string | null;
    parentTemplateNodeId: string | null;
    kind: 'folder';
    name: string;
  }
  | {
    templateNodeId: string;
    sourceNodeId: string;
    parentSourceNodeId: string;
    parentTemplateNodeId: string;
    kind: 'page';
    title: string;
  };

export function snapshotDefinition(
  source: FolderSnapshotSource,
  policy: FolderTemplateWorkflowSource,
  roleSlotsByPage: readonly SnapshotRoleOverride[] = [],
): CompositeTemplateDefinition {
  return snapshotDefinitionWithSourceMap(source, policy, roleSlotsByPage).definition;
}

export function snapshotDefinitionWithSourceMap(
  source: FolderSnapshotSource,
  policy: FolderTemplateWorkflowSource,
  roleSlotsByPage: readonly SnapshotRoleOverride[] = [],
): {
  definition: CompositeTemplateDefinition;
  sourcePageIdByTemplateNodeId: Record<string, string>;
  sourceNodes: FolderTemplateSourceNodeMap[];
} {
  const locale = source.locale ?? 'en';
  const ordered = orderSnapshotNodes(source.nodes);
  const templateIdBySource = new Map<string, string>();
  let folderNumber = 0;
  let pageNumber = 0;
  for (const node of ordered) {
    templateIdBySource.set(
      node.sourceId,
      node.kind === 'folder' ? `folder-${folderNumber += 1}` : `page-${pageNumber += 1}`,
    );
  }
  const siblingRanks = new Map<string | null, number>();
  const nodes: TemplateNode[] = ordered.map((node) => {
    const order = siblingRanks.get(node.parentSourceId) ?? 0;
    siblingRanks.set(node.parentSourceId, order + 1);
    const nodeId = templateIdBySource.get(node.sourceId)!;
    const parentNodeId = node.parentSourceId === null
      ? null
      : templateIdBySource.get(node.parentSourceId);
    if (parentNodeId === undefined) throw invalidSnapshot([{ code: 'TEMPLATE_PARENT_MISSING', nodeId }]);
    if (node.kind === 'folder') {
      return {
        nodeId, parentNodeId, kind: 'folder', order,
        nameI18n: { [locale]: node.name },
      };
    }
    return {
      nodeId, parentNodeId, kind: 'page', order,
      titleI18n: { [locale]: node.title },
      contentI18n: { [locale]: node.content },
      roleSlotKey: null,
    };
  });

  const raw: CompositeTemplateDefinition = {
    schemaVersion: 1,
    kind: 'page_group',
    nodes,
    collaboration: policy.kind === 'structure_only'
      ? null
      : policy.kind === 'simple_pages'
        ? simplePagesCollaboration(source, nodes, templateIdBySource, roleSlotsByPage)
        : workflowCollaboration(source, policy, nodes, templateIdBySource),
  };
  const parsed = CompositeTemplateDefinitionSchema.safeParse(raw);
  if (!parsed.success) throw invalidSnapshot([{ code: 'TEMPLATE_SCHEMA_INVALID' }]);
  const issues = validateCompositeDefinition(parsed.data);
  if (issues.length > 0) throw invalidSnapshot(issues);
  return {
    definition: parsed.data,
    sourcePageIdByTemplateNodeId: Object.fromEntries(source.nodes.flatMap((node) =>
      node.kind === 'page' ? [[templateIdBySource.get(node.sourceId)!, node.sourceId]] : [])),
    sourceNodes: ordered.map((node): FolderTemplateSourceNodeMap => {
      const parentTemplateNodeId = node.parentSourceId === null
        ? null
        : templateIdBySource.get(node.parentSourceId)!;
      return node.kind === 'folder'
        ? {
          templateNodeId: templateIdBySource.get(node.sourceId)!,
          sourceNodeId: node.sourceId,
          parentSourceNodeId: node.parentSourceId,
          parentTemplateNodeId,
          kind: 'folder',
          name: node.name,
        }
        : {
          templateNodeId: templateIdBySource.get(node.sourceId)!,
          sourceNodeId: node.sourceId,
          parentSourceNodeId: node.parentSourceId,
          parentTemplateNodeId: parentTemplateNodeId!,
          kind: 'page',
          title: node.title,
        };
    }),
  };
}

export function selectIndependentSimplePages(
  definition: CompositeTemplateDefinition,
  enabledTaskNodeIds: readonly string[] | undefined,
): NonNullable<CompositeTemplateDefinition['collaboration']> {
  const collaboration = definition.collaboration;
  if (!collaboration) throw new BusinessException('COLLABORATION_TEMPLATE_INVALID');
  const allTasks = collaboration.workflow.nodes.filter((node) => node.kind === 'agent_task');
  const enabled = enabledTaskNodeIds === undefined
    ? allTasks.map((task) => task.id)
    : [...enabledTaskNodeIds];
  if (enabled.length === 0 || new Set(enabled).size !== enabled.length
    || enabled.some((id) => !allTasks.some((task) => task.id === id))) {
    throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', 'Enabled task selection is invalid');
  }
  const selectedTasks = new Set(enabled);
  const retainedNodeIds = new Set(collaboration.workflow.nodes.flatMap((node) => (
    node.kind === 'agent_task'
      ? selectedTasks.has(node.id) ? [node.id] : []
      : selectedTasks.has(node.artifactTaskId) ? [node.id] : []
  )));
  const usedRoles = new Set(allTasks
    .filter((task) => selectedTasks.has(task.id))
    .map((task) => task.roleSlotId));
  const selected: NonNullable<CompositeTemplateDefinition['collaboration']> = {
    workflow: CollaborationTemplateDefinitionSchema.parse({
      ...structuredClone(collaboration.workflow),
      roleSlots: collaboration.workflow.roleSlots.filter((slot) => usedRoles.has(slot.id)),
      nodes: collaboration.workflow.nodes.filter((node) => retainedNodeIds.has(node.id)),
      dependencies: collaboration.workflow.dependencies.filter((edge) =>
        retainedNodeIds.has(edge.from) && retainedNodeIds.has(edge.to)),
      terminalNodeIds: collaboration.workflow.terminalNodeIds.filter((id) => retainedNodeIds.has(id)),
    }),
    taskTargets: collaboration.taskTargets.filter((target) => selectedTasks.has(target.taskNodeId)),
  };
  const selectedPageNodeIds = new Set(selected.taskTargets.map((target) => target.pageNodeId));
  const candidate = CompositeTemplateDefinitionSchema.parse({
    ...definition,
    nodes: definition.nodes.map((node) => node.kind === 'page' && !selectedPageNodeIds.has(node.nodeId)
      ? { ...node, roleSlotKey: null }
      : node),
    collaboration: selected,
  });
  const issues = validateCompositeDefinition(candidate);
  if (issues.length > 0) {
    throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues });
  }
  return selected;
}

function orderSnapshotNodes(nodes: readonly FolderSnapshotSourceNode[]): FolderSnapshotSourceNode[] {
  const roots = nodes.filter((node) => node.parentSourceId === null);
  if (roots.length !== 1 || roots[0]?.kind !== 'folder') {
    throw invalidSnapshot([{ code: 'TEMPLATE_ROOT_INVALID' }]);
  }
  const children = new Map<string | null, FolderSnapshotSourceNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentSourceId) ?? [];
    siblings.push(node);
    children.set(node.parentSourceId, siblings);
  }
  for (const siblings of children.values()) {
    // ContentTreeService.listChildren: folders first, then order/createdAt/id
    // within each kind. Persist ranks so generated IDs cannot reorder ties.
    siblings.sort((left, right) => (left.kind === right.kind ? 0 : left.kind === 'folder' ? -1 : 1)
      || left.order - right.order
      || (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0)
      || left.sourceId.localeCompare(right.sourceId));
  }
  const ordered: FolderSnapshotSourceNode[] = [];
  const visited = new Set<string>();
  const visit = (node: FolderSnapshotSourceNode): void => {
    if (visited.has(node.sourceId)) throw invalidSnapshot([{ code: 'TEMPLATE_TREE_CYCLE' }]);
    visited.add(node.sourceId);
    ordered.push(node);
    if (node.kind === 'folder') {
      for (const child of children.get(node.sourceId) ?? []) visit(child);
    }
  };
  visit(roots[0]!);
  if (ordered.length !== nodes.length) throw invalidSnapshot([{ code: 'TEMPLATE_PARENT_MISSING' }]);
  return ordered;
}

function simplePagesCollaboration(
  source: FolderSnapshotSource,
  nodes: TemplateNode[],
  templateIdBySource: ReadonlyMap<string, string>,
  roleSlotsByPage: readonly SnapshotRoleOverride[],
): CompositeTemplateDefinition['collaboration'] {
  const overrides = new Map(roleSlotsByPage.map((item) => [item.pageId, item.roleSlotKey]));
  const bindings = new Map(source.bindings.map((item) => [item.pageId, item]));
  const pages = source.nodes.filter((node): node is Extract<FolderSnapshotSourceNode, { kind: 'page' }> =>
    node.kind === 'page');
  const assigned = pages.flatMap((page) => {
    const binding = bindings.get(page.sourceId);
    const hasOverride = overrides.has(page.sourceId);
    const requestedRole = hasOverride
      ? overrides.get(page.sourceId) ?? null
      : binding?.hasAgent
        ? binding.roleSlotKey ?? 'owner'
        : null;
    if (requestedRole === null) return [];
    const pageNodeId = templateIdBySource.get(page.sourceId)!;
    const roleSlotId = `${pageNodeId}-${identifierStem(requestedRole)}`;
    return [{ page, pageNodeId, roleSlotId, roleName: requestedRole }];
  });
  if (assigned.length === 0) return null;
  const tasks: Array<Extract<CollaborationNode, { kind: 'agent_task' }>> = assigned.map((item) => ({
    kind: 'agent_task',
    id: `write-${item.pageNodeId}`,
    name: `Maintain ${item.page.title}`,
    roleSlotId: item.roleSlotId,
    objective: `Maintain ${item.page.title} as auditable Markdown.`,
    inputKeys: [],
    upstreamArtifacts: [],
    output: { key: `${item.pageNodeId}-markdown`, kind: 'markdown' },
    evidenceRequired: [],
    humanAcceptance: true,
    leaseSeconds: 600,
    maxExecutionSeconds: 14_400,
    retryBudget: 2,
    repairBudget: 2,
    skippable: false,
    todos: [{ id: 'maintain-page', name: `Maintain ${item.page.title}`, required: true, evidenceKinds: [] }],
  }));
  const base: CollaborationTemplateDefinition = {
    schemaVersion: 1,
    inputs: [],
    roleSlots: assigned.map((item) => ({
      id: item.roleSlotId,
      name: item.roleName,
      required: true,
      description: `Responsible for ${item.page.title}`,
    })),
    nodes: tasks,
    dependencies: [],
    terminalNodeIds: tasks.map((task) => task.id),
  };
  const workflow = addCompositePageReviewGates(base, tasks.map((task) => task.id));
  for (const item of assigned) {
    const node = nodes.find((candidate) => candidate.nodeId === item.pageNodeId);
    if (node?.kind === 'page') node.roleSlotKey = item.roleSlotId;
  }
  return {
    workflow,
    taskTargets: assigned.map((item, index) => ({
      taskNodeId: tasks[index]!.id,
      pageNodeId: item.pageNodeId,
    })),
  };
}

function workflowCollaboration(
  source: FolderSnapshotSource,
  policy: Extract<FolderTemplateWorkflowSource, { kind: 'template' | 'legacy_workflow' }>,
  nodes: TemplateNode[],
  templateIdBySource: ReadonlyMap<string, string>,
): CompositeTemplateDefinition['collaboration'] {
  if (!source.workflow) throw new BusinessException('SOURCE_INVALID');
  const targetSource = policy.kind === 'legacy_workflow'
    ? policy.taskTargets
    : source.workflow.taskTargets;
  if (policy.kind === 'legacy_workflow' && !sameTargets(targetSource, source.workflow.taskTargets)) {
    throw new BusinessException('SOURCE_INVALID');
  }
  const selectedTargets = targetSource.flatMap((target) => {
    const pageNodeId = templateIdBySource.get(target.pageId);
    return pageNodeId ? [{ taskNodeId: target.taskNodeId, pageNodeId }] : [];
  });
  if (policy.kind === 'legacy_workflow' && selectedTargets.length !== targetSource.length) {
    throw invalidSnapshot([{ code: 'TEMPLATE_PAGE_TARGET_MISSING' }]);
  }
  const removedTargetTasks = new Set(targetSource
    .filter((target) => !templateIdBySource.has(target.pageId))
    .map((target) => target.taskNodeId));
  const workflowWithGates = policy.kind === 'legacy_workflow'
    ? addCompositePageReviewGates(
        CollaborationTemplateDefinitionSchema.parse(structuredClone(source.workflow.definition)),
        targetSource.map((target) => target.taskNodeId),
      )
    : CollaborationTemplateDefinitionSchema.parse(structuredClone(source.workflow.definition));
  const removedNodeIds = new Set(removedTargetTasks);
  for (const node of workflowWithGates.nodes) {
    if (node.kind === 'human_review' && removedTargetTasks.has(node.artifactTaskId)) {
      removedNodeIds.add(node.id);
    }
  }
  const retainedWorkflowNodeIds = workflowWithGates.nodes
    .filter((node) => !removedNodeIds.has(node.id))
    .map((node) => node.id);
  const selectionIssues = validateCompositeTaskSelection(
    selectionValidationDefinition(workflowWithGates, targetSource),
    retainedWorkflowNodeIds,
  );
  if (selectionIssues.length > 0) throw invalidSnapshot(selectionIssues);
  const workflow = CollaborationTemplateDefinitionSchema.parse({
    ...workflowWithGates,
    nodes: workflowWithGates.nodes.filter((node) => !removedNodeIds.has(node.id)),
    dependencies: workflowWithGates.dependencies.filter((edge) =>
      !removedNodeIds.has(edge.from) && !removedNodeIds.has(edge.to)),
    terminalNodeIds: workflowWithGates.terminalNodeIds.filter((id) => !removedNodeIds.has(id)),
  });
  const taskById = new Map(workflow.nodes.flatMap((node) =>
    node.kind === 'agent_task' ? [[node.id, node] as const] : []));
  for (const target of selectedTargets) {
    const page = nodes.find((node) => node.nodeId === target.pageNodeId);
    const task = taskById.get(target.taskNodeId);
    if (!page || page.kind !== 'page' || !task || task.output.kind !== 'markdown') {
      throw invalidSnapshot([{ code: 'TEMPLATE_TASK_TARGET_MISSING', nodeId: target.taskNodeId }]);
    }
    page.roleSlotKey = task.roleSlotId;
  }
  return { workflow, taskTargets: selectedTargets };
}

function selectionValidationDefinition(
  workflow: CollaborationTemplateDefinition,
  targets: ReadonlyArray<{ taskNodeId: string; pageId: string }>,
): CompositeTemplateDefinition {
  const taskById = new Map(workflow.nodes.flatMap((node) =>
    node.kind === 'agent_task' ? [[node.id, node] as const] : []));
  const pageNodeIdBySource = new Map<string, string>();
  for (const target of targets) {
    if (!pageNodeIdBySource.has(target.pageId)) {
      pageNodeIdBySource.set(target.pageId, `selection-page-${pageNodeIdBySource.size + 1}`);
    }
  }
  const nodes: TemplateNode[] = [
    {
      nodeId: 'selection-root', parentNodeId: null, kind: 'folder', order: 0,
      nameI18n: { en: 'Selection' },
    },
    ...[...pageNodeIdBySource.entries()].map(([pageId, nodeId], index) => {
      const target = targets.find((item) => item.pageId === pageId);
      const task = target ? taskById.get(target.taskNodeId) : undefined;
      return {
        nodeId, parentNodeId: 'selection-root', kind: 'page' as const, order: index,
        titleI18n: { en: `Page ${index + 1}` }, contentI18n: { en: '' },
        roleSlotKey: task?.roleSlotId ?? null,
      };
    }),
  ];
  return {
    schemaVersion: 1,
    kind: 'page_group',
    nodes,
    collaboration: {
      workflow,
      taskTargets: targets.map((target) => ({
        taskNodeId: target.taskNodeId,
        pageNodeId: pageNodeIdBySource.get(target.pageId)!,
      })),
    },
  };
}

function sameTargets(
  left: ReadonlyArray<{ taskNodeId: string; pageId: string }>,
  right: ReadonlyArray<{ taskNodeId: string; pageId: string }>,
): boolean {
  const normalize = (items: ReadonlyArray<{ taskNodeId: string; pageId: string }>) => items
    .map((item) => `${item.taskNodeId}\u0000${item.pageId}`).sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function identifierStem(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9._:-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80) || 'owner';
}

function invalidSnapshot(issues: Array<{ code: string; nodeId?: string }>): BusinessException {
  return new BusinessException('PAGE_TEMPLATE_INVALID', undefined, { issues });
}
