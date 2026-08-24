import type { AgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import api from '../../api/client';
import { LOCAL_SYNC_VERSION } from '../../config/localSync';

export type ExecutableAgentRole = Extract<AgentAccessRole, 'editor' | 'publisher'>;

export interface AgentIdentity {
  id: string;
  name: string;
  description?: string;
  status: string;
  revokedAt?: string | null;
}

export interface OwnedAgentSummary extends AgentIdentity {
  grants: Array<{
    id: string;
    spaceId: string;
    role: AgentAccessRole;
    space: { id: string; name: string };
  }>;
}

export interface OwnedAgentCredential {
  id: string;
  revokedAt?: string | null;
  expiresAt?: string | null;
  authorization: {
    role: AgentAccessRole;
    space: { id: string; name: string };
  };
}

export interface OwnedAgentDetail extends OwnedAgentSummary {
  credentials: OwnedAgentCredential[];
}

export interface AgentInstallation {
  installationId: string;
  code: string;
  expiresAt: string;
  instructions: string;
}

export interface AgentPreparationApi {
  listAgents(): Promise<OwnedAgentSummary[]>;
  getAgent(agentId: string): Promise<OwnedAgentDetail>;
  createAgent(input: { name: string; description?: string }): Promise<AgentIdentity>;
  activateAgent(agentId: string): Promise<AgentIdentity>;
  upsertGrant(agentId: string, spaceId: string, role: ExecutableAgentRole): Promise<unknown>;
  createInstallation(
    agentId: string,
    spaceId: string,
    role: ExecutableAgentRole,
  ): Promise<AgentInstallation>;
}

export const agentPreparationApi: AgentPreparationApi = {
  listAgents: async () => (await api.get<OwnedAgentSummary[]>('/agents')).data,
  getAgent: async (agentId) => (await api.get<OwnedAgentDetail>(`/agents/${agentId}`)).data,
  createAgent: async (input) => (await api.post<AgentIdentity>('/agents', input)).data,
  activateAgent: async (agentId) => (
    await api.patch<AgentIdentity>(`/agents/${agentId}`, { status: 'active' })
  ).data,
  upsertGrant: async (agentId, spaceId, role) => (
    await api.put(`/agents/${agentId}/grants/${spaceId}`, { role })
  ).data,
  createInstallation: async (agentId, spaceId, role) => (
    await api.post<AgentInstallation>(
      `/agents/${agentId}/local-sync-installations`,
      { pluginVersion: LOCAL_SYNC_VERSION, spaceId, role },
    )
  ).data,
};

export function hasActiveSpaceCredential(
  agent: Pick<OwnedAgentDetail, 'credentials'>,
  spaceId: string,
  now = Date.now(),
): boolean {
  return agent.credentials.some((credential) => (
    credential.authorization.space.id === spaceId
    && !credential.revokedAt
    && (!credential.expiresAt || Date.parse(credential.expiresAt) > now)
  ));
}

export function apiResponseStatus(error: unknown): number | undefined {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : undefined;
}
