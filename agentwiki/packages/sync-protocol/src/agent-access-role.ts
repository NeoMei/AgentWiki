import { z } from "zod";

export const AGENT_ACCESS_ROLES = ["reader", "editor", "publisher"] as const;
export const AgentAccessRoleSchema = z.enum(AGENT_ACCESS_ROLES);
export type AgentAccessRole = z.infer<typeof AgentAccessRoleSchema>;

export const FOLDER_READ_SCOPES = ["folders:read"] as const;
export const FOLDER_WRITE_SCOPES = ["folders:write"] as const;
export const FOLDER_DELETE_SCOPES = ["folders:delete"] as const;
export const FOLDER_SCOPES = [
  ...FOLDER_READ_SCOPES,
  ...FOLDER_WRITE_SCOPES,
  ...FOLDER_DELETE_SCOPES,
] as const;
export type FolderScope = (typeof FOLDER_SCOPES)[number];

const READER_SCOPES = [
  "collaboration:read", ...FOLDER_READ_SCOPES, "graph:read", "pages:read", "review:read", "runs:read", "sources:read", "spaces:read",
] as const;
const EDITOR_SCOPES = [
  ...READER_SCOPES, ...FOLDER_WRITE_SCOPES, "collaboration:execute", "graph:write", "pages:write", "runs:write", "sources:write",
].sort();
const PUBLISHER_SCOPES = [
  ...EDITOR_SCOPES, ...FOLDER_DELETE_SCOPES, "memory:read", "memory:write", "review:auto-publish",
].sort();

export const AGENT_ACCESS_ROLE_SCOPES: Readonly<Record<AgentAccessRole, readonly string[]>> = {
  reader: [...READER_SCOPES].sort(),
  editor: EDITOR_SCOPES,
  publisher: PUBLISHER_SCOPES,
};

export function scopesForAgentAccessRole(role: AgentAccessRole): string[] {
  return [...AGENT_ACCESS_ROLE_SCOPES[role]];
}

export function folderScopesForAgentAccessRole(role: AgentAccessRole): FolderScope[] {
  return FOLDER_SCOPES.filter((scope) => AGENT_ACCESS_ROLE_SCOPES[role].includes(scope));
}

export function agentGrantAllowsScope(
  role: AgentAccessRole,
  folderScopes: readonly string[],
  scope: string,
): boolean {
  if (!agentRoleAllowsScope(role, scope)) return false;
  return !scope.startsWith("folders:") || folderScopes.includes(scope);
}

export function scopesForAgentGrant(
  role: AgentAccessRole,
  folderScopes: readonly string[],
): string[] {
  return scopesForAgentAccessRole(role)
    .filter((scope) => !scope.startsWith("folders:") || folderScopes.includes(scope));
}

export function agentRoleAllowsScope(role: AgentAccessRole, scope: string): boolean {
  return AGENT_ACCESS_ROLE_SCOPES[role].includes(scope);
}

export function agentRoleSpaceCapability(role: AgentAccessRole): "viewer" | "editor" {
  return role === "reader" ? "viewer" : "editor";
}
