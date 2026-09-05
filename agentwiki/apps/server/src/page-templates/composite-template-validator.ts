import {
  CompositeTemplateDefinitionSchema,
  type CompositeTemplateDefinition,
  type TemplateNode,
} from '@neomei/agentwiki-sync-protocol';
import { createHash } from 'crypto';
import { validateCollaborationTemplate } from '../collaboration-workflows/template-validator';
import { LocalizedValueSchema, type LocalizedValue } from './page-template.types';

export type CompositeTemplateValidationIssue = {
  code: string;
  nodeId?: string;
};

export function hashCompositeDefinition(definition: CompositeTemplateDefinition): string {
  return createHash('sha256').update(JSON.stringify(sortObject(definition)), 'utf8').digest('hex');
}

export function compareCompositeTemplateSiblingOrder(left: TemplateNode, right: TemplateNode): number {
  return left.order - right.order || (left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0);
}

type RawTemplateNode = {
  nodeId?: unknown;
  parentNodeId?: unknown;
  kind?: unknown;
  order?: unknown;
  roleSlotKey?: unknown;
};

type RawTarget = { taskNodeId?: unknown; pageNodeId?: unknown };
type RawWorkflowNode = {
  id?: unknown;
  kind?: unknown;
  artifactTaskId?: unknown;
  output?: unknown;
  humanAcceptance?: unknown;
};

/**
 * Adapts one immutable legacy PageTemplateVersion into the composite contract.
 * The empty localized title is deliberately replaced by the catalog with the
 * owning PageTemplate.defaultTitleI18n, which is not present on the version.
 */
export function normalizeLegacyVersion(contentI18n: unknown): CompositeTemplateDefinition {
  const content = structuredClone(LocalizedValueSchema.parse(contentI18n));
  const title = Object.fromEntries(
    Object.keys(content).map((locale) => [locale, '']),
  ) as LocalizedValue;
  return CompositeTemplateDefinitionSchema.parse({
    schemaVersion: 1,
    kind: 'single_page',
    nodes: [{
      nodeId: 'page',
      parentNodeId: null,
      kind: 'page',
      order: 0,
      titleI18n: title,
      contentI18n: content,
      roleSlotKey: null,
    }],
    collaboration: null,
  });
}

/**
 * Adds stable service-level issue codes around the strict protocol schema and
 * delegates all workflow graph semantics to the existing workflow validator.
 */
export function validateCompositeDefinition(
  definition: CompositeTemplateDefinition,
): CompositeTemplateValidationIssue[] {
  const raw = definition as unknown as Record<string, unknown>;
  const issues: CompositeTemplateValidationIssue[] = [];
  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes.filter(isRecord) as RawTemplateNode[]
    : [];

  const nodeById = new Map<string, RawTemplateNode>();
  for (const node of nodes) {
    if (typeof node.nodeId !== 'string') continue;
    if (nodeById.has(node.nodeId)) {
      issues.push({ code: 'TEMPLATE_NODE_DUPLICATE', nodeId: node.nodeId });
      continue;
    }
    nodeById.set(node.nodeId, node);
  }

  validateRoots(raw.kind, nodes, issues);
  for (const node of nodeById.values()) {
    if (node.parentNodeId === null) continue;
    if (typeof node.parentNodeId !== 'string' || !nodeById.has(node.parentNodeId)) {
      issues.push({ code: 'TEMPLATE_PARENT_MISSING', nodeId: stringId(node.nodeId) });
    } else if (nodeById.get(node.parentNodeId)?.kind !== 'folder') {
      issues.push({ code: 'TEMPLATE_PARENT_NOT_FOLDER', nodeId: stringId(node.nodeId) });
    }
  }
  validateTreeCycles(nodeById, issues);

  const collaboration = isRecord(raw.collaboration) ? raw.collaboration : null;
  if (collaboration) {
    validateCollaboration(collaboration, nodeById, issues);
  } else {
    for (const node of nodeById.values()) {
      if (node.kind === 'page' && node.roleSlotKey !== null) {
        issues.push({ code: 'TEMPLATE_ROLE_SLOT_WITHOUT_COLLABORATION', nodeId: stringId(node.nodeId) });
      }
    }
  }

  const parsed = CompositeTemplateDefinitionSchema.safeParse(definition);
  if (!parsed.success && issues.length === 0) {
    issues.push({ code: 'TEMPLATE_SCHEMA_INVALID' });
  }
  return uniqueIssues(issues);
}

export function validateCompositeTaskSelection(
  definition: CompositeTemplateDefinition,
  retainedWorkflowNodeIds: readonly string[],
): CompositeTemplateValidationIssue[] {
  const baseIssues = validateCompositeDefinition(definition);
  if (baseIssues.length > 0 || !definition.collaboration) return baseIssues;
  const retained = new Set(retainedWorkflowNodeIds);
  const original = definition.collaboration.workflow;
  const issues: CompositeTemplateValidationIssue[] = [];
  for (const dependency of original.dependencies) {
    if (retained.has(dependency.to) && !retained.has(dependency.from)) {
      issues.push({ code: 'TEMPLATE_REQUIRED_UPSTREAM_REMOVED', nodeId: dependency.to });
    }
  }
  for (const terminal of original.terminalNodeIds) {
    if (!retained.has(terminal)) {
      issues.push({ code: 'TEMPLATE_REQUIRED_TERMINAL_REMOVED', nodeId: terminal });
    }
  }
  const pruned: CompositeTemplateDefinition = structuredClone(definition);
  pruned.collaboration!.workflow.nodes = original.nodes.filter((node) => retained.has(node.id));
  pruned.collaboration!.workflow.dependencies = original.dependencies.filter((edge) =>
    retained.has(edge.from) && retained.has(edge.to));
  pruned.collaboration!.workflow.terminalNodeIds = original.terminalNodeIds.filter((id) => retained.has(id));
  pruned.collaboration!.taskTargets = definition.collaboration.taskTargets.filter((target) =>
    retained.has(target.taskNodeId));
  return uniqueIssues([...issues, ...validateCompositeDefinition(pruned)]);
}

function validateRoots(
  kind: unknown,
  nodes: RawTemplateNode[],
  issues: CompositeTemplateValidationIssue[],
): void {
  const roots = nodes.filter((node) => node.parentNodeId === null);
  if (kind === 'single_page') {
    if (roots.length === 1 && roots[0]?.kind === 'page' && nodes.length === 1) return;
    const invalid = roots.find((node, index) => index > 0 || node.kind !== 'page') ?? nodes[1] ?? nodes[0];
    issues.push({ code: 'TEMPLATE_ROOT_INVALID', nodeId: stringId(invalid?.nodeId) });
    return;
  }
  if (kind === 'page_group') {
    const rootFolders = roots.filter((node) => node.kind === 'folder');
    if (roots.length === 1 && rootFolders.length === 1) return;
    const invalid = roots.find((node, index) => index > 0 || node.kind !== 'folder') ?? roots[0];
    issues.push({ code: 'TEMPLATE_ROOT_INVALID', nodeId: stringId(invalid?.nodeId) });
  }
}

function validateTreeCycles(
  nodeById: Map<string, RawTemplateNode>,
  issues: CompositeTemplateValidationIssue[],
): void {
  const colors = new Map<string, 'visiting' | 'visited'>();
  const visit = (nodeId: string): void => {
    const color = colors.get(nodeId);
    if (color === 'visited') return;
    if (color === 'visiting') {
      issues.push({ code: 'TEMPLATE_TREE_CYCLE', nodeId });
      return;
    }
    colors.set(nodeId, 'visiting');
    const parentId = nodeById.get(nodeId)?.parentNodeId;
    if (typeof parentId === 'string' && nodeById.has(parentId)) visit(parentId);
    colors.set(nodeId, 'visited');
  };
  for (const nodeId of [...nodeById.keys()].sort()) visit(nodeId);
}

function validateCollaboration(
  collaboration: Record<string, unknown>,
  nodeById: Map<string, RawTemplateNode>,
  issues: CompositeTemplateValidationIssue[],
): void {
  const workflow = isRecord(collaboration.workflow) ? collaboration.workflow : null;
  if (!workflow) {
    issues.push({ code: 'TEMPLATE_COLLABORATION_INVALID' });
    return;
  }
  for (const issue of validateCollaborationTemplate(workflow)) {
    issues.push({ code: issue.code });
  }

  const workflowNodes = Array.isArray(workflow.nodes)
    ? workflow.nodes.filter(isRecord) as RawWorkflowNode[]
    : [];
  const tasks = new Set(workflowNodes.flatMap((node) =>
    node.kind === 'agent_task' && typeof node.id === 'string' ? [node.id] : []));
  const reviewsByTask = new Map<string, number>();
  for (const node of workflowNodes) {
    if (node.kind !== 'human_review' || typeof node.artifactTaskId !== 'string') continue;
    reviewsByTask.set(node.artifactTaskId, (reviewsByTask.get(node.artifactTaskId) ?? 0) + 1);
  }
  const taskById = new Map(workflowNodes.flatMap((node) =>
    node.kind === 'agent_task' && typeof node.id === 'string' ? [[node.id, node] as const] : []));
  const pages = new Set([...nodeById.values()].flatMap((node) =>
    node.kind === 'page' && typeof node.nodeId === 'string' ? [node.nodeId] : []));
  const targets = Array.isArray(collaboration.taskTargets)
    ? collaboration.taskTargets.filter(isRecord) as RawTarget[]
    : [];
  const writersByPage = new Map<string, Set<string>>();

  for (const target of targets) {
    const taskNodeId = typeof target.taskNodeId === 'string' ? target.taskNodeId : '';
    const pageNodeId = typeof target.pageNodeId === 'string' ? target.pageNodeId : '';
    if (!tasks.has(taskNodeId)) {
      issues.push({ code: 'TEMPLATE_TASK_TARGET_MISSING', nodeId: taskNodeId || undefined });
    }
    if (!pages.has(pageNodeId)) {
      issues.push({ code: 'TEMPLATE_PAGE_TARGET_MISSING', nodeId: pageNodeId || undefined });
    }
    if (tasks.has(taskNodeId) && pages.has(pageNodeId)) {
      const writers = writersByPage.get(pageNodeId) ?? new Set<string>();
      writers.add(taskNodeId);
      writersByPage.set(pageNodeId, writers);
      const gateCount = reviewsByTask.get(taskNodeId) ?? 0;
      if (gateCount === 0) {
        issues.push({ code: 'TEMPLATE_PAGE_REVIEW_REQUIRED', nodeId: pageNodeId });
      } else if (gateCount > 1) {
        issues.push({ code: 'TEMPLATE_PAGE_REVIEW_MULTIPLE', nodeId: pageNodeId });
      }
      const writer = taskById.get(taskNodeId);
      if (!isRecord(writer?.output) || writer.output.kind !== 'markdown') {
        issues.push({ code: 'TEMPLATE_PAGE_OUTPUT_NOT_MARKDOWN', nodeId: pageNodeId });
      }
      if (writer?.humanAcceptance !== true) {
        issues.push({ code: 'TEMPLATE_PAGE_HUMAN_ACCEPTANCE_REQUIRED', nodeId: pageNodeId });
      }
    }
  }
  for (const [pageNodeId, writers] of writersByPage) {
    if (writers.size > 1) {
      issues.push({ code: 'TEMPLATE_PAGE_MULTIPLE_WRITERS', nodeId: pageNodeId });
    }
  }
}

function uniqueIssues(issues: CompositeTemplateValidationIssue[]): CompositeTemplateValidationIssue[] {
  return [...new Map(issues.map((issue) => [`${issue.code}|${issue.nodeId ?? ''}`, issue])).values()]
    .sort((left, right) => `${left.code}|${left.nodeId ?? ''}`.localeCompare(`${right.code}|${right.nodeId ?? ''}`));
}

function stringId(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (isRecord(value)) {
    return Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortObject(value[key]);
      return result;
    }, {});
  }
  return value;
}
