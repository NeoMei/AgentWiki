import {
  AGENT_ACCESS_ROLES,
  AgentAccessRoleSchema,
  agentRoleAllowsScope,
  type AgentAccessRole,
} from '@neomei/agentwiki-sync-protocol';

const ownerRoleCeilings: ReadonlyMap<string, AgentAccessRole> = new Map([
  ['viewer', 'reader'],
  ['editor', 'editor'],
  ['admin', 'publisher'],
  ['owner', 'publisher'],
]);

export function capAgentRole(
  grantRole: string,
  ownerRole: string | null | undefined,
): AgentAccessRole | null {
  const grant = AgentAccessRoleSchema.safeParse(grantRole);
  const ceiling = ownerRole == null ? undefined : ownerRoleCeilings.get(ownerRole);
  if (!grant.success || !ceiling) return null;
  return AGENT_ACCESS_ROLES[Math.min(
    AGENT_ACCESS_ROLES.indexOf(grant.data),
    AGENT_ACCESS_ROLES.indexOf(ceiling),
  )];
}

export function capAgentGrant<T extends { role: AgentAccessRole; folderScopes: string[] }>(
  grant: T,
  ownerRole: string | null | undefined,
): T | null {
  const role = capAgentRole(grant.role, ownerRole);
  if (!role) return null;
  return {
    ...grant,
    role,
    folderScopes: (grant.folderScopes ?? []).filter((scope) => agentRoleAllowsScope(role, scope)),
  };
}
