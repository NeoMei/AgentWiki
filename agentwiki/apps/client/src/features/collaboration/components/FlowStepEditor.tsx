import React, { useEffect, useState } from 'react';
import type { CollaborationTemplateDefinition } from '@neomei/agentwiki-sync-protocol';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { SpaceMemberSummary } from '../types';

type Node = CollaborationTemplateDefinition['nodes'][number];
type AgentTask = Extract<Node, { kind: 'agent_task' }>;

export const FlowStepEditor: React.FC<{
  definition: CollaborationTemplateDefinition;
  onChange: (definition: CollaborationTemplateDefinition) => void;
  labels: Record<string, string>;
  reviewers?: SpaceMemberSummary[];
}> = ({ definition, onChange, labels, reviewers = [] }) => {
  const [selectedId, setSelectedId] = useState(definition.nodes[0]?.id ?? '');
  useEffect(() => {
    if (!definition.nodes.some((node) => node.id === selectedId)) setSelectedId(definition.nodes[0]?.id ?? '');
  }, [definition.nodes, selectedId]);
  const selected = definition.nodes.find((node) => node.id === selectedId);

  const replaceNode = (node: Node) => onChange({
    ...definition,
    nodes: definition.nodes.map((item) => item.id === selectedId ? node : item),
  });
  const moveNode = (offset: number) => {
    const index = definition.nodes.findIndex((node) => node.id === selectedId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= definition.nodes.length) return;
    const nodes = [...definition.nodes];
    [nodes[index], nodes[target]] = [nodes[target], nodes[index]];
    onChange({ ...definition, nodes });
  };
  const addTask = () => {
    const suffix = nextSuffix(definition.nodes.map((node) => node.id), 'task');
    const roleSlotId = definition.roleSlots[0]?.id ?? 'role';
    const node: AgentTask = {
      kind: 'agent_task', id: `task-${suffix}`, name: labels.newTask, roleSlotId, objective: labels.newTask,
      inputKeys: [], upstreamArtifacts: [], output: { key: `output-${suffix}`, kind: 'markdown' },
      evidenceRequired: [], humanAcceptance: false, leaseSeconds: 600, maxExecutionSeconds: 3600,
      retryBudget: 2, repairBudget: 2, skippable: false,
      todos: [{ id: 'complete', name: labels.completeTask, required: true, evidenceKinds: [] }],
    };
    onChange({ ...definition, nodes: [...definition.nodes, node], terminalNodeIds: [node.id] });
    setSelectedId(node.id);
  };
  const addReview = () => {
    const task = [...definition.nodes].reverse().find((node): node is AgentTask => node.kind === 'agent_task');
    if (!task) return;
    const suffix = nextSuffix(definition.nodes.map((node) => node.id), 'review');
    const node: Node = {
      kind: 'human_review', id: `review-${suffix}`, name: labels.newReview, artifactTaskId: task.id,
      minimumRole: 'editor', reviewerUserIds: [], approvalCriteria: [labels.acceptanceCriterion],
      revisionTaskId: task.id, allowTerminate: true,
    };
    onChange({
      ...definition,
      nodes: [...definition.nodes, node],
      dependencies: [...definition.dependencies, { from: task.id, to: node.id, mode: 'all' }],
      terminalNodeIds: [node.id],
    });
    setSelectedId(node.id);
  };
  const removeSelected = () => {
    if (!selected || definition.nodes.length <= 1) return;
    const nodes = definition.nodes.filter((node) => node.id !== selected.id);
    onChange({
      ...definition,
      nodes,
      dependencies: definition.dependencies.filter((edge) => edge.from !== selected.id && edge.to !== selected.id),
      terminalNodeIds: definition.terminalNodeIds.filter((id) => id !== selected.id).length
        ? definition.terminalNodeIds.filter((id) => id !== selected.id)
        : [nodes[nodes.length - 1].id],
    });
  };

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(13rem,0.8fr)_minmax(0,2fr)]">
      <aside className="min-w-0 rounded-xl border bg-gray-50 p-3">
        <ol className="space-y-2">
          {definition.nodes.map((node, index) => (
            <li key={node.id}>
              <button type="button" onClick={() => setSelectedId(node.id)} className={`w-full rounded-lg border p-3 text-left text-sm ${selectedId === node.id ? 'border-blue-500 bg-blue-50' : 'bg-white'}`}>
                <span className="block text-xs text-gray-500">{index + 1}. {node.kind === 'agent_task' ? labels.agentTask : labels.humanReview}</span>
                <span className="mt-1 block truncate font-medium">{node.name}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-3 grid gap-2">
          <button type="button" onClick={addTask} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border bg-white px-3 text-sm"><Plus size={14} />{labels.addTask}</button>
          <button type="button" onClick={addReview} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border bg-white px-3 text-sm"><Plus size={14} />{labels.addReview}</button>
        </div>
      </aside>
      {selected ? (
        <div className="min-w-0 space-y-4 rounded-xl border bg-white p-4">
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex gap-2">
              <button type="button" aria-label={labels.moveUp} onClick={() => moveNode(-1)} className="rounded-lg border p-2"><ArrowUp size={15} /></button>
              <button type="button" aria-label={labels.moveDown} onClick={() => moveNode(1)} className="rounded-lg border p-2"><ArrowDown size={15} /></button>
            </div>
            <button type="button" aria-label={labels.removeStep} onClick={removeSelected} className="rounded-lg border border-red-200 p-2 text-red-700"><Trash2 size={15} /></button>
          </div>
          <label className="block text-sm font-medium">{labels.stepName}<input value={selected.name} onChange={(event) => replaceNode({ ...selected, name: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
          {selected.kind === 'agent_task' ? (
            <AgentTaskForm task={selected} definition={definition} onChange={replaceNode} onDefinitionChange={onChange} labels={labels} />
          ) : (
            <ReviewForm node={selected} definition={definition} onChange={replaceNode} labels={labels} reviewers={reviewers} />
          )}
          <DependencyEditor selected={selected} definition={definition} onChange={onChange} labels={labels} />
        </div>
      ) : null}
    </div>
  );
};

const AgentTaskForm: React.FC<{ task: AgentTask; definition: CollaborationTemplateDefinition; onChange: (node: Node) => void; onDefinitionChange: (definition: CollaborationTemplateDefinition) => void; labels: Record<string, string> }> = ({ task, definition, onChange, onDefinitionChange, labels }) => {
  const updateTodo = (index: number, value: Partial<AgentTask['todos'][number]>) => onChange({ ...task, todos: task.todos.map((todo, todoIndex) => todoIndex === index ? { ...todo, ...value } : todo) });
  const moveTodo = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= task.todos.length) return;
    const todos = [...task.todos];
    [todos[index], todos[target]] = [todos[target], todos[index]];
    onChange({ ...task, todos });
  };
  return <>
    <label className="block text-sm font-medium">{labels.role}<select value={task.roleSlotId} onChange={(event) => onChange({ ...task, roleSlotId: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3">{definition.roleSlots.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
    <label className="block text-sm font-medium">{labels.objective}<textarea value={task.objective} onChange={(event) => onChange({ ...task, objective: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border p-3" /></label>
    <fieldset className="rounded-lg border p-3"><legend className="px-1 text-sm font-medium">{labels.runInputs}</legend>
      <div className="space-y-2">{definition.inputs.length ? definition.inputs.map((input) => <label key={input.key} className="block text-sm"><input aria-label={`${labels.runInput} ${input.label}`} type="checkbox" checked={task.inputKeys.includes(input.key)} onChange={(event) => onChange({ ...task, inputKeys: event.target.checked ? [...new Set([...task.inputKeys, input.key])] : task.inputKeys.filter((key) => key !== input.key) })} /> {input.label}</label>) : <p className="text-xs text-gray-500">{labels.noRunInputs}</p>}</div>
    </fieldset>
    <fieldset className="rounded-lg border p-3"><legend className="px-1 text-sm font-medium">{labels.upstreamArtifacts}</legend>
      <div className="space-y-3">{definition.nodes.filter((node): node is AgentTask => node.kind === 'agent_task' && node.id !== task.id).map((producer) => {
        const current = task.upstreamArtifacts.find((artifact) => artifact.key === producer.output.key);
        const name = `${producer.name} (${producer.output.key})`;
        return <div key={producer.id} className="flex flex-wrap items-center justify-between gap-2"><label className="text-sm"><input aria-label={`${labels.upstreamArtifact} ${name}`} type="checkbox" checked={!!current} onChange={(event) => onChange({ ...task, upstreamArtifacts: event.target.checked ? [...task.upstreamArtifacts, { key: producer.output.key, required: true }] : task.upstreamArtifacts.filter((artifact) => artifact.key !== producer.output.key) })} /> {name}</label>{current ? <label className="text-xs"><input aria-label={`${labels.requireUpstreamArtifact} ${name}`} type="checkbox" checked={current.required} onChange={(event) => onChange({ ...task, upstreamArtifacts: task.upstreamArtifacts.map((artifact) => artifact.key === producer.output.key ? { ...artifact, required: event.target.checked } : artifact) })} /> {labels.required}</label> : null}</div>;
      })}</div>
    </fieldset>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm font-medium">{labels.outputKey}<input value={task.output.key} onChange={(event) => {
        const oldKey = task.output.key;
        const nextKey = event.target.value;
        if (nextKey !== oldKey && definition.nodes.some((node) =>
          node.kind === 'agent_task' && node.id !== task.id && node.output.key === nextKey)) return;
        onDefinitionChange({
          ...definition,
          nodes: definition.nodes.map((node) => node.id === task.id
            ? { ...task, output: { ...task.output, key: nextKey } }
            : node.kind === 'agent_task'
              ? { ...node, upstreamArtifacts: node.upstreamArtifacts.map((artifact) => artifact.key === oldKey ? { ...artifact, key: nextKey } : artifact) }
              : node),
        });
      }} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
      <label className="block text-sm font-medium">{labels.outputKind}<select value={task.output.kind} onChange={(event) => onChange({ ...task, output: { key: task.output.key, kind: event.target.value as AgentTask['output']['kind'], ...(event.target.value === 'json' ? { jsonSchema: { type: 'object' } } : {}) } })} className="mt-1 h-10 w-full rounded-lg border px-3"><option value="markdown">{labels.outputMarkdown}</option><option value="json">{labels.outputJson}</option><option value="external_reference">{labels.outputExternalReference}</option><option value="evidence_summary">{labels.outputEvidenceSummary}</option></select></label>
    </div>
    <fieldset className="rounded-lg border p-3"><legend className="px-1 text-sm font-medium">{labels.todo}</legend>
      <div className="space-y-2">{task.todos.map((todo, index) => <div key={`${todo.id}-${index}`} className="flex min-w-0 items-center gap-2"><input aria-label={`${labels.todoName} ${index + 1}`} value={todo.name} onChange={(event) => updateTodo(index, { name: event.target.value })} className="h-9 min-w-0 flex-1 rounded-lg border px-2 text-sm" /><label className="text-xs"><input type="checkbox" checked={todo.required} onChange={(event) => updateTodo(index, { required: event.target.checked })} /> {labels.required}</label><button type="button" aria-label={`${labels.moveUp} Todo ${index + 1}`} onClick={() => moveTodo(index, -1)}><ArrowUp size={14} /></button><button type="button" aria-label={`${labels.moveDown} Todo ${index + 1}`} onClick={() => moveTodo(index, 1)}><ArrowDown size={14} /></button>{task.todos.length > 1 ? <button type="button" aria-label={`${labels.removeTodo} ${index + 1}`} onClick={() => onChange({ ...task, todos: task.todos.filter((_, todoIndex) => todoIndex !== index) })}><Trash2 size={14} /></button> : null}</div>)}</div>
      <button type="button" onClick={() => onChange({ ...task, todos: [...task.todos, { id: `todo-${task.todos.length + 1}`, name: labels.newTodo, required: true, evidenceKinds: [] }] })} className="mt-3 inline-flex items-center gap-1 text-sm text-blue-700"><Plus size={14} />{labels.addTodo}</button>
    </fieldset>
  </>;
};

const ReviewForm: React.FC<{ node: Extract<Node, { kind: 'human_review' }>; definition: CollaborationTemplateDefinition; onChange: (node: Node) => void; labels: Record<string, string>; reviewers: SpaceMemberSummary[] }> = ({ node, definition, onChange, labels, reviewers }) => {
  const tasks = definition.nodes.filter((item): item is AgentTask => item.kind === 'agent_task');
  const roleLevel: Record<string, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
  const reviewerOptions = [
    ...reviewers,
    ...node.reviewerUserIds.filter((userId) => !reviewers.some((member) => member.userId === userId)).map((userId) => ({
      type: 'human' as const, userId, role: 'unknown', user: undefined,
    })),
  ];
  return <>
    <label className="block text-sm font-medium">{labels.artifactTask}<select value={node.artifactTaskId} onChange={(event) => onChange({ ...node, artifactTaskId: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3">{tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}</select></label>
    <label className="block text-sm font-medium">{labels.revisionTask}<select value={node.revisionTaskId} onChange={(event) => onChange({ ...node, revisionTaskId: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3">{tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}</select></label>
    <label className="block text-sm font-medium">{labels.minimumRole}<select value={node.minimumRole} onChange={(event) => {
      const minimumRole = event.target.value as typeof node.minimumRole;
      const membersById = new Map(reviewers.map((member) => [member.userId, member]));
      onChange({
        ...node,
        minimumRole,
        reviewerUserIds: node.reviewerUserIds.filter((userId) => {
          const member = membersById.get(userId);
          return !member || (roleLevel[member.role] ?? -1) >= roleLevel[minimumRole];
        }),
      });
    }} className="mt-1 h-10 w-full rounded-lg border px-3"><option value="editor">{labels.roleEditor}</option><option value="admin">{labels.roleAdmin}</option><option value="owner">{labels.roleOwner}</option></select></label>
    <fieldset className="rounded-lg border p-3"><legend className="px-1 text-sm font-medium">{labels.reviewerUserIds}</legend><p className="mb-2 text-xs text-gray-500">{labels.reviewerUserIdsHelp}</p><div className="space-y-2">{reviewerOptions.map((member) => {
      const selected = !!member.userId && node.reviewerUserIds.includes(member.userId);
      const eligible = (roleLevel[member.role] ?? -1) >= roleLevel[node.minimumRole];
      return <label key={member.userId} className="block text-sm"><input type="checkbox" disabled={!eligible && !selected} checked={selected} onChange={(event) => member.userId && onChange({ ...node, reviewerUserIds: event.target.checked ? [...new Set([...node.reviewerUserIds, member.userId])] : node.reviewerUserIds.filter((id) => id !== member.userId) })} /> {member.user?.name || member.user?.email || member.userId}{member.role === 'unknown' ? ` — ${labels.removedReviewer}` : ` (${member.role})`}</label>;
    })}</div></fieldset>
    <label className="block text-sm font-medium">{labels.criteria}<textarea value={node.approvalCriteria.join('\n')} onChange={(event) => onChange({ ...node, approvalCriteria: event.target.value.split('\n').filter(Boolean) })} className="mt-1 min-h-20 w-full rounded-lg border p-3" /></label>
    <label className="text-sm"><input type="checkbox" checked={node.allowTerminate} onChange={(event) => onChange({ ...node, allowTerminate: event.target.checked })} /> {labels.allowTerminate}</label>
  </>;
};

const DependencyEditor: React.FC<{ selected: Node; definition: CollaborationTemplateDefinition; onChange: (definition: CollaborationTemplateDefinition) => void; labels: Record<string, string> }> = ({ selected, definition, onChange, labels }) => {
  const incoming = definition.dependencies.filter((edge) => edge.to === selected.id);
  const candidates = definition.nodes.filter((node) => node.id !== selected.id);
  return <fieldset className="rounded-lg border p-3"><legend className="px-1 text-sm font-medium">{labels.dependencies}</legend>
    <div className="space-y-2">{incoming.map((edge, index) => <div key={`${edge.from}-${edge.to}`} className="flex gap-2"><select aria-label={`${labels.dependency} ${index + 1}`} value={edge.from} onChange={(event) => onChange({ ...definition, dependencies: definition.dependencies.map((item) => item === edge ? { ...item, from: event.target.value } : item) })} className="h-9 min-w-0 flex-1 rounded-lg border px-2 text-sm">{candidates.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select><select aria-label={`${labels.dependencyMode} ${index + 1}`} value={edge.mode} onChange={(event) => onChange({ ...definition, dependencies: definition.dependencies.map((item) => item === edge ? { ...item, mode: event.target.value as 'all' | 'any' } : item) })} className="h-9 rounded-lg border px-2 text-sm"><option value="all">{labels.dependencyAll}</option><option value="any">{labels.dependencyAny}</option></select><button type="button" aria-label={`${labels.removeDependency} ${index + 1}`} onClick={() => onChange({ ...definition, dependencies: definition.dependencies.filter((item) => item !== edge) })}><Trash2 size={14} /></button></div>)}</div>
    {candidates.length ? <button type="button" onClick={() => onChange({ ...definition, dependencies: [...definition.dependencies, { from: candidates[0].id, to: selected.id, mode: 'all' }] })} className="mt-3 inline-flex items-center gap-1 text-sm text-blue-700"><Plus size={14} />{labels.addDependency}</button> : null}
  </fieldset>;
};

function nextSuffix(ids: string[], prefix: string): number {
  let value = 1;
  while (ids.includes(`${prefix}-${value}`)) value += 1;
  return value;
}
