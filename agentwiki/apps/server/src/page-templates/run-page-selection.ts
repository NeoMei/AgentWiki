export type RunPageSelectionTask = {
  nodeId: string;
  roleSlotId: string;
  enabled: boolean;
};

export type RunPageSelectionBinding =
  | {
    kind: 'task_default';
    nodeId: string;
    roleSlotId: string;
    agentId: string;
  }
  | {
    kind: 'role_override';
    roleSlotId: string;
    agentId: string;
  };

export type RunPageAssignment = {
  nodeId: string;
  roleSlotId: string;
  agentId: string;
};

export type RunPageSelectionIssue =
  | { code: 'ROLE_BINDING_REQUIRED'; roleSlotId: string; nodeIds: string[] }
  | {
    code: 'ROLE_BINDING_CONFLICT';
    roleSlotId: string;
    nodeIds: string[];
    agentIds: string[];
  };

export function resolveParticipants(
  tasks: readonly RunPageSelectionTask[],
  bindings: readonly RunPageSelectionBinding[],
): {
  assignments: RunPageAssignment[];
  agentIds: string[];
  issues: RunPageSelectionIssue[];
} {
  const enabledTasks = tasks.filter((task) => task.enabled);
  const enabledByNode = new Map(enabledTasks.map((task) => [task.nodeId, task]));
  const nodesByRole = new Map<string, string[]>();
  for (const task of enabledTasks) {
    const nodeIds = nodesByRole.get(task.roleSlotId) ?? [];
    nodeIds.push(task.nodeId);
    nodesByRole.set(task.roleSlotId, nodeIds);
  }

  const agentsByRole = new Map<string, Set<string>>();
  for (const roleSlotId of nodesByRole.keys()) {
    const overrides = bindings.filter((binding) => (
      binding.kind === 'role_override' && binding.roleSlotId === roleSlotId
    ));
    const applicable = overrides.length > 0
      ? overrides
      : bindings.filter((binding) => {
        if (binding.kind !== 'task_default' || binding.roleSlotId !== roleSlotId) return false;
        return enabledByNode.get(binding.nodeId)?.roleSlotId === binding.roleSlotId;
      });
    agentsByRole.set(roleSlotId, new Set(applicable.map((binding) => binding.agentId)));
  }

  const issues: RunPageSelectionIssue[] = [];
  for (const roleSlotId of [...nodesByRole.keys()].sort()) {
    const nodeIds = [...nodesByRole.get(roleSlotId)!].sort();
    const agentIds = [...(agentsByRole.get(roleSlotId) ?? [])].sort();
    if (agentIds.length === 0) {
      issues.push({ code: 'ROLE_BINDING_REQUIRED', roleSlotId, nodeIds });
    } else if (agentIds.length > 1) {
      issues.push({ code: 'ROLE_BINDING_CONFLICT', roleSlotId, nodeIds, agentIds });
    }
  }

  const invalidRoles = new Set(issues.map((issue) => issue.roleSlotId));
  const assignments = enabledTasks.flatMap((task): RunPageAssignment[] => {
    if (invalidRoles.has(task.roleSlotId)) return [];
    const agentId = [...agentsByRole.get(task.roleSlotId)!][0]!;
    return [{ nodeId: task.nodeId, roleSlotId: task.roleSlotId, agentId }];
  });
  const agentIds = [...new Set(assignments.map((assignment) => assignment.agentId))];
  return { assignments, agentIds, issues };
}
