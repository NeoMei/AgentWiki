import { z } from "zod";

export const AGENT_ACCESS_ROLES = ["reader", "editor", "publisher"] as const;
export const AgentAccessRoleSchema = z.enum(AGENT_ACCESS_ROLES);
export type AgentAccessRole = z.infer<typeof AgentAccessRoleSchema>;

const READER_SCOPES = [
  "collaboration:read", "graph:read", "pages:read", "review:read", "runs:read", "sources:read", "spaces:read",
] as const;
const EDITOR_SCOPES = [
  ...READER_SCOPES, "collaboration:execute", "graph:write", "pages:write", "runs:write", "sources:write",
].sort();
const PUBLISHER_SCOPES = [
  ...EDITOR_SCOPES, "memory:read", "memory:write", "review:auto-publish",
].sort();

export const AGENT_ACCESS_ROLE_SCOPES: Readonly<Record<AgentAccessRole, readonly string[]>> = {
  reader: [...READER_SCOPES].sort(),
  editor: EDITOR_SCOPES,
  publisher: PUBLISHER_SCOPES,
};

export function scopesForAgentAccessRole(role: AgentAccessRole): string[] {
  return [...AGENT_ACCESS_ROLE_SCOPES[role]];
}

export function agentRoleAllowsScope(role: AgentAccessRole, scope: string): boolean {
  return AGENT_ACCESS_ROLE_SCOPES[role].includes(scope);
}

export function agentRoleSpaceCapability(role: AgentAccessRole): "viewer" | "editor" {
  return role === "reader" ? "viewer" : "editor";
}
