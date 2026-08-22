export interface AgentOption {
  id: string;
  name: string;
  status: string;
  revokedAt?: string | null;
}

export function filterAvailableAgents(
  agents: AgentOption[],
  existingAgentIds: string[],
): AgentOption[] {
  const existing = new Set(existingAgentIds);
  return agents.filter((agent) => (
    agent.status === 'active' && !agent.revokedAt && !existing.has(agent.id)
  ));
}
