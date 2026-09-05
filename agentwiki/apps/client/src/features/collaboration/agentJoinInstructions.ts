import type { AgentInstruction, RoleBinding, RunJoinInstruction } from './types';

/**
 * Builds one complete, copyable prompt per authoritative Run participant.
 * Server joinInstructions own participant scope; role bindings are only the
 * compatibility fallback for Runs created before that response field existed.
 */
export function buildAgentJoinInstructions(run: {
  id: string;
  roleBindings: RoleBinding[];
  joinInstructions?: RunJoinInstruction[];
}): AgentInstruction[] {
  if (run.joinInstructions !== undefined) {
    return run.joinInstructions.map((instruction) => {
      const roleSlots = instruction.roleSlotIds.map((roleSlotId) =>
        run.roleBindings.find((binding) => binding.roleSlotId === roleSlotId)?.roleSlotName || roleSlotId);
      return toAgentInstruction(run.id, instruction.agentId, roleSlots);
    });
  }
  const byAgent = new Map<string, string[]>();
  for (const binding of run.roleBindings) {
    const name = binding.roleSlotName || binding.roleSlotId;
    byAgent.set(binding.agentId, [...(byAgent.get(binding.agentId) ?? []), name]);
  }
  return [...byAgent.entries()].map(([agentId, roleSlots]) => toAgentInstruction(run.id, agentId, roleSlots));
}

function toAgentInstruction(runId: string, agentId: string, roleSlots: string[]): AgentInstruction {
  const roleSummary = roleSlots.length ? ` Roles: ${roleSlots.join(', ')}.` : '';
  return {
    agentId,
    roleSlots,
    text: `Run ${runId}.${roleSummary} Use the existing AgentWiki MCP connection. Call wiki_collaboration_join_run with runId ${runId}, then call wiki_collaboration_next_action and follow each action until waiting_human, paused, completed, failed, or cancelled. Never invent or request a new connection secret.`,
  };
}
