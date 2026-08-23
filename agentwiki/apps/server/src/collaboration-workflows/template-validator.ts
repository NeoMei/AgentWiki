import { createHash } from 'node:crypto';
import {
  collaborationGuaranteedPredecessors,
  CollaborationTemplateDefinitionSchema,
  type CollaborationTemplateDefinition,
} from '@neomei/agentwiki-sync-protocol';

export type TemplateValidationIssue = {
  code: string;
  path: string;
  message: string;
};

type RawNode = {
  kind?: unknown;
  id?: unknown;
  roleSlotId?: unknown;
  inputKeys?: unknown;
  upstreamArtifacts?: unknown;
  output?: unknown;
  todos?: unknown;
  skippable?: unknown;
  artifactTaskId?: unknown;
  revisionTaskId?: unknown;
};

type RawEdge = { from?: unknown; to?: unknown; mode?: unknown };

export function hashCollaborationTemplate(value: CollaborationTemplateDefinition): string {
  return createHash('sha256').update(JSON.stringify(sortObject(value))).digest('hex');
}

export function validateCollaborationTemplate(input: unknown): TemplateValidationIssue[] {
  const parsed = CollaborationTemplateDefinitionSchema.safeParse(input);
  const issues: TemplateValidationIssue[] = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({
      code: codeForSchemaIssue(issue.message),
      path: issue.path.join('.'),
      message: issue.message,
    }));

  if (!isRecord(input)) return uniqueIssues(issues);
  const nodes = Array.isArray(input.nodes) ? input.nodes.filter(isRecord) as RawNode[] : [];
  const dependencies = Array.isArray(input.dependencies) ? input.dependencies.filter(isRecord) as RawEdge[] : [];
  const terminals = Array.isArray(input.terminalNodeIds)
    ? input.terminalNodeIds.filter((value): value is string => typeof value === 'string')
    : [];
  const roleSlots = Array.isArray(input.roleSlots) ? input.roleSlots.filter(isRecord) : [];
  const inputs = Array.isArray(input.inputs) ? input.inputs.filter(isRecord) : [];
  if (!Array.isArray(input.nodes) || !Array.isArray(input.dependencies) || !Array.isArray(input.terminalNodeIds)) {
    return uniqueIssues(issues);
  }

  const nodeById = new Map<string, RawNode>();
  for (const node of nodes) {
    if (typeof node.id === 'string' && !nodeById.has(node.id)) nodeById.set(node.id, node);
  }
  const nodeIds = new Set(nodeById.keys());
  const roleIds = roleSlots.map((slot) => slot.id).filter((value): value is string => typeof value === 'string');
  const inputKeys = inputs.map((definition) => definition.key).filter((value): value is string => typeof value === 'string');
  const agentTasks = [...nodeById.values()].filter((node) => node.kind === 'agent_task');
  const outputPairs = agentTasks
    .map((node) => [isRecord(node.output) ? node.output.key : undefined, node.id] as const)
    .filter((pair): pair is readonly [string, string] => typeof pair[0] === 'string' && typeof pair[1] === 'string');
  const outputProducer = new Map(outputPairs);
  const guaranteedPredecessors = collaborationGuaranteedPredecessors(
    nodes.flatMap((node) => typeof node.id === 'string'
      ? [{
          id: node.id,
          kind: node.kind,
          artifactTaskId: node.artifactTaskId,
          skippable: node.skippable,
        }]
      : []),
    dependencies.flatMap((edge) => typeof edge.from === 'string' && typeof edge.to === 'string'
      ? [{ from: edge.from, to: edge.to, mode: edge.mode }]
      : []),
  );

  addDuplicateIssues(issues, inputKeys, 'inputs', 'input key');
  addDuplicateIssues(issues, roleIds, 'roleSlots', 'role slot id');
  addDuplicateIssues(issues, nodes.map((node) => node.id).filter((value): value is string => typeof value === 'string'), 'nodes', 'node id');
  addDuplicateIssues(issues, outputPairs.map(([key]) => key), 'nodes', 'output key');
  addDuplicateIssues(issues, terminals, 'terminalNodeIds', 'terminal node id');

  const roleIdSet = new Set(roleIds);
  const inputKeySet = new Set(inputKeys);
  for (const node of agentTasks) {
    if (typeof node.id !== 'string') continue;
    if (typeof node.roleSlotId !== 'string' || !roleIdSet.has(node.roleSlotId)) {
      issues.push(issue('ROLE_SLOT_MISSING', `nodes.${node.id}.roleSlotId`, `Unknown Role Slot: ${String(node.roleSlotId)}`));
    }
    const referencedInputs = Array.isArray(node.inputKeys)
      ? node.inputKeys.filter((value): value is string => typeof value === 'string')
      : [];
    for (const key of referencedInputs) {
      if (!inputKeySet.has(key)) issues.push(issue('INPUT_KEY_MISSING', `nodes.${node.id}.inputKeys`, key));
    }
    addDuplicateIssues(issues, referencedInputs, `nodes.${node.id}.inputKeys`, 'input key reference');
    const todos = Array.isArray(node.todos) ? node.todos.filter(isRecord) : [];
    const todoIds = todos.map((todo) => todo.id).filter((value): value is string => typeof value === 'string');
    addDuplicateIssues(issues, todoIds, `nodes.${node.id}.todos`, 'Todo id');
    if (!todos.some((todo) => todo.required === true)) {
      issues.push(issue('REQUIRED_TODO_MISSING', `nodes.${node.id}.todos`, 'At least one required Todo is required'));
    }
  }

  const outgoing = new Map<string, Set<string>>([...nodeIds].map((id) => [id, new Set()]));
  const incoming = new Map<string, { from: string; mode: string }[]>([...nodeIds].map((id) => [id, []]));
  const seenEdges = new Set<string>();
  for (const [index, edge] of dependencies.entries()) {
    if (typeof edge.from !== 'string' || typeof edge.to !== 'string') continue;
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      issues.push(issue('DEPENDENCY_NODE_MISSING', `dependencies.${index}`, `${edge.from}->${edge.to}`));
      continue;
    }
    const edgeKey = `${edge.from}\u0000${edge.to}`;
    if (seenEdges.has(edgeKey)) issues.push(issue('DEPENDENCY_DUPLICATE', `dependencies.${index}`, `${edge.from}->${edge.to}`));
    seenEdges.add(edgeKey);
    outgoing.get(edge.from)!.add(edge.to);
    incoming.get(edge.to)!.push({ from: edge.from, mode: typeof edge.mode === 'string' ? edge.mode : '' });
  }

  for (const [target, edges] of incoming) {
    if (new Set(edges.map((edge) => edge.mode)).size > 1) {
      issues.push(issue('DEPENDENCY_MODE_CONFLICT', `dependencies.${target}`, 'Incoming dependency modes must match'));
    }
  }

  const entries = [...nodeIds].filter((id) => incoming.get(id)!.length === 0).sort();
  if (entries.length === 0) issues.push(issue('ENTRY_NODE_MISSING', 'nodes', 'At least one entry node is required'));
  const validTerminals = terminals.filter((id) => nodeIds.has(id));
  if (validTerminals.length === 0) {
    issues.push(issue('TERMINAL_NODE_MISSING', 'terminalNodeIds', 'At least one valid terminal node is required'));
  }
  for (const terminal of validTerminals) {
    if (outgoing.get(terminal)!.size > 0) {
      issues.push(issue('TERMINAL_NODE_INVALID', `terminalNodeIds.${terminal}`, 'A terminal node cannot have outgoing dependencies'));
    }
  }

  const indegree = new Map([...incoming].map(([id, edges]) => [id, edges.length]));
  const queue = entries.slice();
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited += 1;
    for (const next of [...outgoing.get(id)!].sort()) {
      const remaining = indegree.get(next)! - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
    queue.sort();
  }
  if (visited !== nodeIds.size) issues.push(issue('DEPENDENCY_CYCLE', 'dependencies', 'Dependencies must be acyclic'));

  const hasPath = (from: string, to: string): boolean => {
    if (from === to) return true;
    const pending = [from];
    const seen = new Set(pending);
    while (pending.length > 0) {
      const current = pending.shift()!;
      for (const next of outgoing.get(current) ?? []) {
        if (next === to) return true;
        if (!seen.has(next)) {
          seen.add(next);
          pending.push(next);
        }
      }
    }
    return false;
  };

  for (const nodeId of nodeIds) {
    if (!validTerminals.some((terminal) => hasPath(nodeId, terminal))) {
      issues.push(issue('REQUIRED_NODE_UNREACHABLE', `nodes.${nodeId}`, 'Node cannot reach a declared terminal'));
    }
  }

  for (const node of agentTasks) {
    if (typeof node.id !== 'string') continue;
    const artifacts = Array.isArray(node.upstreamArtifacts) ? node.upstreamArtifacts.filter(isRecord) : [];
    const artifactKeys = artifacts.map((artifact) => artifact.key).filter((value): value is string => typeof value === 'string');
    addDuplicateIssues(issues, artifactKeys, `nodes.${node.id}.upstreamArtifacts`, 'upstream Artifact key');
    for (const artifact of artifacts) {
      if (typeof artifact.key !== 'string') continue;
      const producer = outputProducer.get(artifact.key);
      if (!producer || producer === node.id || !hasPath(producer, node.id)) {
        issues.push(issue('UPSTREAM_ARTIFACT_UNREACHABLE', `nodes.${node.id}.upstreamArtifacts`, artifact.key));
      } else if (artifact.required === true && !guaranteedPredecessors.get(node.id)?.has(producer)) {
        issues.push(issue('ANY_REQUIRED_ARTIFACT_UNSAFE', `nodes.${node.id}.upstreamArtifacts`, artifact.key));
      }
    }
  }

  for (const node of nodeById.values()) {
    if (node.kind !== 'human_review' || typeof node.id !== 'string') continue;
    const sourceId = typeof node.artifactTaskId === 'string' ? node.artifactTaskId : '';
    const revisionId = typeof node.revisionTaskId === 'string' ? node.revisionTaskId : '';
    if (nodeById.get(sourceId)?.kind !== 'agent_task') {
      issues.push(issue('REVIEW_SOURCE_TASK_INVALID', `nodes.${node.id}.artifactTaskId`, sourceId));
    }
    if (!incoming.get(node.id)?.some((edge) => edge.from === sourceId)) {
      issues.push(issue('REVIEW_SOURCE_EDGE_MISSING', `nodes.${node.id}.artifactTaskId`, sourceId));
    }
    if (nodeById.get(revisionId)?.kind !== 'agent_task' || !hasPath(revisionId, sourceId)) {
      issues.push(issue('REVISION_TARGET_INVALID', `nodes.${node.id}.revisionTaskId`, revisionId));
    }
  }

  return uniqueIssues(issues);
}

function codeForSchemaIssue(message: string): string {
  if (/duplicate/i.test(message)) return 'KEY_DUPLICATE';
  if (/unknown node|dependency references/i.test(message)) return 'DEPENDENCY_NODE_MISSING';
  if (/cycle/i.test(message)) return 'DEPENDENCY_CYCLE';
  if (/unknown terminal/i.test(message)) return 'TERMINAL_NODE_MISSING';
  if (/cannot reach a terminal/i.test(message)) return 'REQUIRED_NODE_UNREACHABLE';
  if (/direct source edge/i.test(message)) return 'REVIEW_SOURCE_EDGE_MISSING';
  if (/revision target/i.test(message)) return 'REVISION_TARGET_INVALID';
  if (/upstream artifact/i.test(message)) return 'UPSTREAM_ARTIFACT_UNREACHABLE';
  if (/required artifact.*not guaranteed|any dependency/i.test(message)) return 'ANY_REQUIRED_ARTIFACT_UNSAFE';
  if (/modes cannot mix/i.test(message)) return 'DEPENDENCY_MODE_CONFLICT';
  if (/required Todo/i.test(message)) return 'REQUIRED_TODO_MISSING';
  if (/role slot/i.test(message)) return 'ROLE_SLOT_MISSING';
  if (/input key/i.test(message)) return 'INPUT_KEY_MISSING';
  if (/terminal node has outgoing/i.test(message)) return 'TERMINAL_NODE_INVALID';
  return 'SCHEMA_INVALID';
}

function addDuplicateIssues(
  issues: TemplateValidationIssue[],
  values: readonly string[],
  path: string,
  label: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) issues.push(issue('KEY_DUPLICATE', path, `Duplicate ${label}: ${value}`));
    seen.add(value);
  }
}

function issue(code: string, path: string, message: string): TemplateValidationIssue {
  return { code, path, message };
}

function uniqueIssues(issues: TemplateValidationIssue[]): TemplateValidationIssue[] {
  return [...new Map(issues.map((item) => [`${item.code}|${item.path}|${item.message}`, item])).values()]
    .sort((left, right) => `${left.code}|${left.path}|${left.message}`.localeCompare(`${right.code}|${right.path}|${right.message}`));
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
