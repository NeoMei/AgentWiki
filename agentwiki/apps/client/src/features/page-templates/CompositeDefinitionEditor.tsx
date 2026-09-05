import React, { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { FlowStepEditor } from '../collaboration/components/FlowStepEditor';
import type { CompositeTemplateDefinition, TemplateNode } from './compositeTemplateTypes';

export interface CompositeDefinitionIssue {
  code: string;
  nodeId?: string;
  detail?: string;
}

export const CompositeDefinitionEditor: React.FC<{
  definition: CompositeTemplateDefinition;
  locale: 'zh-CN' | 'en';
  onChange: (definition: CompositeTemplateDefinition) => void;
  workflowReadOnly?: boolean;
}> = ({ definition, locale, onChange, workflowReadOnly = false }) => {
  const { t } = useLanguage();
  const issues = useMemo(() => definitionReferenceIssues(definition), [definition]);
  const [selectedNodeId, setSelectedNodeId] = useState(definition.nodes[0]?.nodeId ?? '');
  const selected = definition.nodes.find((node) => node.nodeId === selectedNodeId) ?? definition.nodes[0];
  const folders = definition.nodes.filter((node) => node.kind === 'folder');

  const replaceNode = (node: TemplateNode) => onChange({
    ...definition,
    nodes: definition.nodes.map((item) => item.nodeId === node.nodeId ? node : item),
  });
  const addNode = (kind: 'folder' | 'page') => {
    const nodeId = nextNodeId(definition.nodes, kind);
    const parentNodeId = folders[0]?.nodeId ?? null;
    const order = definition.nodes.filter((node) => node.parentNodeId === parentNodeId).length;
    const node: TemplateNode = kind === 'folder'
      ? { nodeId, parentNodeId, kind, order, nameI18n: { [locale]: t('pageTemplate.definition.newFolder') } }
      : { nodeId, parentNodeId, kind, order, titleI18n: { [locale]: t('pageTemplate.definition.newPage') }, contentI18n: { [locale]: '' }, roleSlotKey: null };
    onChange({ ...definition, nodes: [...definition.nodes, node] });
    setSelectedNodeId(nodeId);
  };

  return <div className="space-y-4">
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(14rem,0.8fr)_minmax(0,2fr)]">
      <aside className="min-w-0 rounded-[14px] border bg-gray-50 p-3">
        <p className="text-sm font-semibold">{t('pageTemplate.definition.tree')}</p>
        <ol className="mt-3 space-y-2">{definition.nodes.map((node) => <li key={node.nodeId} style={{ paddingLeft: `${Math.max(0, nodeDepth(definition.nodes, node) - 1) * 12}px` }}>
          <button type="button" onClick={() => setSelectedNodeId(node.nodeId)} className={`w-full rounded-lg border p-3 text-left text-sm ${selected?.nodeId === node.nodeId ? 'border-blue-500 bg-blue-50' : 'bg-white'}`}>
            <span className="block truncate font-medium">{localizedNodeName(node, locale)}</span>
            <span className="mt-1 block break-all text-xs text-gray-500">{node.nodeId} · {node.parentNodeId ?? t('pageTemplate.definition.root')} · {node.order}</span>
          </button>
        </li>)}</ol>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          <button type="button" onClick={() => addNode('folder')} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border bg-white px-3 text-sm"><Plus size={14} />{t('pageTemplate.definition.addFolder')}</button>
          <button type="button" onClick={() => addNode('page')} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border bg-white px-3 text-sm"><Plus size={14} />{t('pageTemplate.definition.addPage')}</button>
        </div>
      </aside>

      {selected ? <section aria-label={t('pageTemplate.definition.selected')} className="min-w-0 space-y-4 rounded-[14px] border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="font-semibold">{localizedNodeName(selected, locale)}</p><p className="mt-1 break-all text-xs text-gray-500">{selected.nodeId}</p></div>
          <button type="button" aria-label={t('pageTemplate.definition.remove', { id: selected.nodeId })} disabled={definition.nodes.length <= 1} onClick={() => {
            const next = removeCompositeNode(definition, selected.nodeId);
            onChange(next);
            setSelectedNodeId(next.nodes[0]?.nodeId ?? '');
          }} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-red-200 px-3 text-sm text-red-700 disabled:opacity-50"><Trash2 size={14} />{t('common.delete')}</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">{t('pageTemplate.definition.parent')}<select value={selected.parentNodeId ?? ''} onChange={(event) => replaceNode({ ...selected, parentNodeId: event.target.value || null })} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal"><option value="">{t('pageTemplate.definition.root')}</option>{folders.filter((folder) => folder.nodeId !== selected.nodeId && !isDescendant(definition.nodes, folder.nodeId, selected.nodeId)).map((folder) => <option key={folder.nodeId} value={folder.nodeId}>{localizedNodeName(folder, locale)} ({folder.nodeId})</option>)}</select></label>
          <label className="text-sm font-medium">{t('pageTemplate.definition.order')}<input type="number" min={0} value={selected.order} onChange={(event) => replaceNode({ ...selected, order: Math.max(0, Number(event.target.value) || 0) })} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" /></label>
        </div>
        {selected.kind === 'folder' ? <label className="block text-sm font-medium">{t('pageTemplate.definition.folderName', { id: selected.nodeId })}<input aria-label={t('pageTemplate.definition.folderName', { id: selected.nodeId })} value={selected.nameI18n[locale] ?? ''} onChange={(event) => replaceNode({ ...selected, nameI18n: { ...selected.nameI18n, [locale]: event.target.value } })} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" /></label> : <>
          <label className="block text-sm font-medium">{t('pageTemplate.definition.pageTitle', { id: selected.nodeId })}<input aria-label={t('pageTemplate.definition.pageTitle', { id: selected.nodeId })} value={selected.titleI18n[locale] ?? ''} onChange={(event) => replaceNode({ ...selected, titleI18n: { ...selected.titleI18n, [locale]: event.target.value } })} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal" /></label>
          <label className="block text-sm font-medium">{t('pageTemplate.definition.pageMarkdown', { id: selected.nodeId })}<textarea aria-label={t('pageTemplate.definition.pageMarkdown', { id: selected.nodeId })} value={selected.contentI18n[locale] ?? ''} onChange={(event) => replaceNode({ ...selected, contentI18n: { ...selected.contentI18n, [locale]: event.target.value } })} className="mt-1 min-h-40 w-full rounded-lg border p-3 font-mono text-sm font-normal" /></label>
          <label className="block text-sm font-medium">{t('pageTemplate.definition.role')}<select value={selected.roleSlotKey ?? ''} onChange={(event) => replaceNode({ ...selected, roleSlotKey: event.target.value || null })} disabled={!definition.collaboration} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal"><option value="">{t('common.none')}</option>{definition.collaboration?.workflow.roleSlots.map((role) => <option key={role.id} value={role.id}>{role.name} ({role.id})</option>)}</select></label>
        </>}
      </section> : null}
    </div>

    {definition.collaboration ? <>
      <section className="rounded-[14px] border p-4">
        <h3 className="font-semibold">{t('pageTemplate.definition.workflow')}</h3>
        {workflowReadOnly ? <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700"><p>{t('pageTemplate.definition.workflowReadOnly')}</p><ul className="mt-2 list-disc pl-5">{definition.collaboration.workflow.nodes.map((node) => <li key={node.id}>{node.name} ({node.id})</li>)}</ul></div>
          : <div className="mt-3"><FlowStepEditor definition={definition.collaboration.workflow} onChange={(workflow) => onChange({ ...definition, collaboration: { ...definition.collaboration!, workflow } })} labels={flowLabels(t)} /></div>}
      </section>
      <TaskTargetEditor definition={definition} locale={locale} onChange={onChange} />
    </> : <p className="rounded-[14px] border bg-gray-50 p-4 text-sm text-gray-600">{t('pageTemplate.definition.noWorkflow')}</p>}

    {issues.length ? <div role="alert" className="rounded-[14px] border border-red-200 bg-red-50 p-4 text-sm text-red-700"><p className="font-medium">{t('pageTemplate.definition.referencesInvalid')}</p><ul className="mt-2 list-disc space-y-1 pl-5">{issues.map((issue, index) => <li key={`${issue.code}-${issue.nodeId ?? ''}-${index}`}>{issue.code}{issue.nodeId ? ` · ${issue.nodeId}` : ''}</li>)}</ul></div> : null}
  </div>;
};

const TaskTargetEditor: React.FC<{
  definition: CompositeTemplateDefinition;
  locale: 'zh-CN' | 'en';
  onChange: (definition: CompositeTemplateDefinition) => void;
}> = ({ definition, locale, onChange }) => {
  const { t } = useLanguage();
  const collaboration = definition.collaboration!;
  const pages = definition.nodes.filter((node) => node.kind === 'page');
  const tasks = collaboration.workflow.nodes.filter((node) => node.kind === 'agent_task' && node.output.kind === 'markdown');
  const targets = new Map(collaboration.taskTargets.map((target) => [target.taskNodeId, target.pageNodeId]));
  const setTarget = (taskNodeId: string, pageNodeId: string) => onChange({
    ...definition,
    collaboration: {
      ...collaboration,
      taskTargets: [
        ...collaboration.taskTargets.filter((target) => target.taskNodeId !== taskNodeId),
        ...(pageNodeId ? [{ taskNodeId, pageNodeId }] : []),
      ],
    },
  });
  return <section className="rounded-[14px] border p-4"><h3 className="font-semibold">{t('pageTemplate.definition.taskTargets')}</h3><p className="mt-1 text-sm text-gray-600">{t('pageTemplate.definition.taskTargetsHelp')}</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{tasks.map((task) => <label key={task.id} className="text-sm font-medium">{t('pageTemplate.definition.targetFor', { name: task.name })}<select aria-label={t('pageTemplate.definition.targetFor', { name: task.name })} value={targets.get(task.id) ?? ''} onChange={(event) => setTarget(task.id, event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3 font-normal"><option value="">{t('common.none')}</option>{pages.map((page) => <option key={page.nodeId} value={page.nodeId}>{localizedNodeName(page, locale)} ({page.nodeId})</option>)}</select></label>)}</div></section>;
};

export function removeCompositeNode(
  definition: CompositeTemplateDefinition,
  nodeId: string,
): CompositeTemplateDefinition {
  const removed = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of definition.nodes) {
      if (node.parentNodeId && removed.has(node.parentNodeId) && !removed.has(node.nodeId)) {
        removed.add(node.nodeId);
        changed = true;
      }
    }
  }
  return { ...definition, nodes: definition.nodes.filter((node) => !removed.has(node.nodeId)) };
}

export function definitionReferenceIssues(definition: CompositeTemplateDefinition): CompositeDefinitionIssue[] {
  const issues: CompositeDefinitionIssue[] = [];
  const nodes = new Map(definition.nodes.map((node) => [node.nodeId, node]));
  for (const node of definition.nodes) {
    if (node.parentNodeId && !nodes.has(node.parentNodeId)) issues.push({ code: 'TEMPLATE_PARENT_MISSING', nodeId: node.nodeId });
  }
  const collaboration = definition.collaboration;
  if (!collaboration) return issues;
  const workflowNodes = new Map(collaboration.workflow.nodes.map((node) => [node.id, node]));
  const taskOutputs = new Set(collaboration.workflow.nodes.flatMap((node) => node.kind === 'agent_task' ? [node.output.key] : []));
  for (const edge of collaboration.workflow.dependencies) {
    if (!workflowNodes.has(edge.from) || !workflowNodes.has(edge.to)) issues.push({ code: 'WORKFLOW_DEPENDENCY_MISSING', nodeId: edge.to });
  }
  for (const node of collaboration.workflow.nodes) {
    if (node.kind === 'human_review' && (!workflowNodes.has(node.artifactTaskId) || !workflowNodes.has(node.revisionTaskId))) {
      issues.push({ code: 'WORKFLOW_REVIEW_REFERENCE_MISSING', nodeId: node.id });
    }
    if (node.kind === 'agent_task' && node.upstreamArtifacts.some((item) => !taskOutputs.has(item.key))) {
      issues.push({ code: 'WORKFLOW_UPSTREAM_ARTIFACT_MISSING', nodeId: node.id });
    }
  }
  for (const terminal of collaboration.workflow.terminalNodeIds) {
    if (!workflowNodes.has(terminal)) issues.push({ code: 'WORKFLOW_TERMINAL_MISSING', nodeId: terminal });
  }
  for (const target of collaboration.taskTargets) {
    if (workflowNodes.get(target.taskNodeId)?.kind !== 'agent_task') issues.push({ code: 'TEMPLATE_TASK_TARGET_MISSING', nodeId: target.taskNodeId });
    if (nodes.get(target.pageNodeId)?.kind !== 'page') issues.push({ code: 'TEMPLATE_PAGE_TARGET_MISSING', nodeId: target.taskNodeId });
  }
  return uniqueIssues(issues);
}

function localizedNodeName(node: TemplateNode, locale: 'zh-CN' | 'en'): string {
  return node.kind === 'folder'
    ? node.nameI18n[locale] ?? node.nameI18n.en ?? node.nameI18n['zh-CN'] ?? node.nodeId
    : node.titleI18n[locale] ?? node.titleI18n.en ?? node.titleI18n['zh-CN'] ?? node.nodeId;
}

function nodeDepth(nodes: TemplateNode[], node: TemplateNode): number {
  const byId = new Map(nodes.map((item) => [item.nodeId, item]));
  let depth = 1;
  let parent = node.parentNodeId;
  const seen = new Set<string>();
  while (parent && byId.has(parent) && !seen.has(parent)) {
    seen.add(parent); depth += 1; parent = byId.get(parent)!.parentNodeId;
  }
  return depth;
}

function isDescendant(nodes: TemplateNode[], nodeId: string, ancestorId: string): boolean {
  const byId = new Map(nodes.map((item) => [item.nodeId, item]));
  let parent = byId.get(nodeId)?.parentNodeId;
  const seen = new Set<string>();
  while (parent && !seen.has(parent)) {
    if (parent === ancestorId) return true;
    seen.add(parent); parent = byId.get(parent)?.parentNodeId;
  }
  return false;
}

function nextNodeId(nodes: TemplateNode[], kind: 'folder' | 'page'): string {
  let index = 1;
  while (nodes.some((node) => node.nodeId === `${kind}-${index}`)) index += 1;
  return `${kind}-${index}`;
}

function uniqueIssues(issues: CompositeDefinitionIssue[]): CompositeDefinitionIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}\u0000${issue.nodeId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function flowLabels(t: (key: string) => string): Record<string, string> {
  const keys = ['newTask', 'completeTask', 'newReview', 'acceptanceCriterion', 'agentTask', 'humanReview', 'addTask', 'addReview', 'moveUp', 'moveDown', 'removeStep', 'stepName', 'role', 'objective', 'runInputs', 'runInput', 'noRunInputs', 'upstreamArtifacts', 'upstreamArtifact', 'requireUpstreamArtifact', 'outputKey', 'outputKind', 'outputMarkdown', 'outputJson', 'outputExternalReference', 'outputEvidenceSummary', 'todo', 'todoName', 'required', 'removeTodo', 'newTodo', 'addTodo', 'artifactTask', 'revisionTask', 'minimumRole', 'roleEditor', 'roleAdmin', 'roleOwner', 'reviewerUserIds', 'reviewerUserIdsHelp', 'removedReviewer', 'criteria', 'allowTerminate', 'dependencies', 'dependency', 'dependencyMode', 'dependencyAll', 'dependencyAny', 'removeDependency', 'addDependency'];
  return Object.fromEntries(keys.map((key) => [key, t(`collaboration.editor.${key}`)]));
}
