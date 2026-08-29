import { describe, expect, it } from "vitest";
import {
  AGENT_ACCESS_ROLES,
  FOLDER_DELETE_SCOPES,
  FOLDER_READ_SCOPES,
  FOLDER_WRITE_SCOPES,
  agentGrantAllowsScope,
  agentRoleAllowsScope,
  agentRoleSpaceCapability,
  folderScopesForAgentAccessRole,
  scopesForAgentGrant,
  scopesForAgentAccessRole,
} from "./agent-access-role.js";

describe("Agent access roles", () => {
  it("expands the three exact role scope sets", () => {
    expect(AGENT_ACCESS_ROLES).toEqual(["reader", "editor", "publisher"]);
    expect(scopesForAgentAccessRole("reader")).toEqual([
      "collaboration:read", "folders:read", "graph:read", "pages:read", "review:read", "runs:read", "sources:read", "spaces:read",
    ]);
    expect(scopesForAgentAccessRole("editor")).toEqual([
      "collaboration:execute", "collaboration:read", "folders:read", "folders:write", "graph:read", "graph:write", "pages:read",
      "pages:write", "review:read", "runs:read", "runs:write", "sources:read", "sources:write", "spaces:read",
    ]);
    expect(scopesForAgentAccessRole("publisher")).toEqual([
      "collaboration:execute", "collaboration:read", "folders:delete", "folders:read", "folders:write", "graph:read", "graph:write", "memory:read",
      "memory:write", "pages:read", "pages:write", "review:auto-publish", "review:read", "runs:read",
      "runs:write", "sources:read", "sources:write", "spaces:read",
    ]);
  });

  it("never grants a human review decision", () => {
    for (const role of AGENT_ACCESS_ROLES) {
      expect(agentRoleAllowsScope(role, "review:decide")).toBe(false);
    }
  });

  it("publishes Folder scope vocabulary through new role defaults without treating legacy lists as grants", () => {
    expect(FOLDER_READ_SCOPES).toEqual(["folders:read"]);
    expect(FOLDER_WRITE_SCOPES).toEqual(["folders:write"]);
    expect(FOLDER_DELETE_SCOPES).toEqual(["folders:delete"]);
    expect(scopesForAgentAccessRole("reader")).toContain("folders:read");
    expect(scopesForAgentAccessRole("editor")).toEqual(expect.arrayContaining([
      "folders:read", "folders:write",
    ]));
    expect(scopesForAgentAccessRole("publisher")).toEqual(expect.arrayContaining([
      "folders:read", "folders:write", "folders:delete",
    ]));

    const legacyEditorScopes = [
      "collaboration:execute", "collaboration:read", "graph:read", "graph:write", "pages:read",
      "pages:write", "review:read", "runs:read", "runs:write", "sources:read", "sources:write", "spaces:read",
    ];
    expect(legacyEditorScopes).not.toContain("folders:read");
    expect(legacyEditorScopes).not.toContain("folders:write");
    expect(legacyEditorScopes).not.toContain("folders:delete");
  });

  it("maps reader to viewer capability and writers to editor capability", () => {
    expect(agentRoleSpaceCapability("reader")).toBe("viewer");
    expect(agentRoleSpaceCapability("editor")).toBe("editor");
    expect(agentRoleSpaceCapability("publisher")).toBe("editor");
  });

  it("keeps persisted Folder opt-in separate from the role ceiling", () => {
    expect(folderScopesForAgentAccessRole("reader")).toEqual(["folders:read"]);
    expect(folderScopesForAgentAccessRole("editor")).toEqual(["folders:read", "folders:write"]);
    expect(folderScopesForAgentAccessRole("publisher")).toEqual([
      "folders:read", "folders:write", "folders:delete",
    ]);

    expect(agentGrantAllowsScope("publisher", [], "pages:write")).toBe(true);
    expect(agentGrantAllowsScope("publisher", [], "folders:read")).toBe(false);
    expect(agentGrantAllowsScope("publisher", ["folders:read"], "folders:read")).toBe(true);
    expect(agentGrantAllowsScope("reader", ["folders:read", "folders:write"], "folders:write")).toBe(false);
    expect(scopesForAgentGrant("editor", [])).toEqual([
      "collaboration:execute", "collaboration:read", "graph:read", "graph:write", "pages:read",
      "pages:write", "review:read", "runs:read", "runs:write", "sources:read", "sources:write", "spaces:read",
    ]);
    expect(scopesForAgentGrant("editor", ["folders:read", "folders:write"]))
      .toEqual(scopesForAgentAccessRole("editor"));
  });
});
