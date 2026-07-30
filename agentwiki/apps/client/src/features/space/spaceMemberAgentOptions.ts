export type AgentMemberRole = 'viewer' | 'editor';

export interface AgentOption {
  id: string;
  name: string;
  status: string;
  revokedAt?: string | null;
}

export const AGENT_ROLE_SCOPES: Record<AgentMemberRole, string[]> = {
  viewer: ['pages:read', 'graph:read'],
  editor: ['pages:read', 'pages:write', 'sources:read', 'graph:read', 'graph:write'],
};

export function filterAvailableAgents(
  agents: AgentOption[],
  existingAgentIds: string[],
): AgentOption[] {
  const existing = new Set(existingAgentIds);
  return agents.filter((agent) => (
    agent.status === 'active' && !agent.revokedAt && !existing.has(agent.id)
  ));
}
