import { describe, expect, it } from "vitest";
import {
  AGENT_ACCESS_ROLES,
  agentRoleAllowsScope,
  agentRoleSpaceCapability,
  scopesForAgentAccessRole,
} from "./agent-access-role.js";

describe("Agent access roles", () => {
  it("expands the three exact role scope sets", () => {
    expect(AGENT_ACCESS_ROLES).toEqual(["reader", "editor", "publisher"]);
    expect(scopesForAgentAccessRole("reader")).toEqual([
      "collaboration:read", "graph:read", "pages:read", "review:read", "runs:read", "sources:read", "spaces:read",
    ]);
    expect(scopesForAgentAccessRole("editor")).toEqual([
      "collaboration:execute", "collaboration:read", "graph:read", "graph:write", "pages:read",
      "pages:write", "review:read", "runs:read", "runs:write", "sources:read", "sources:write", "spaces:read",
    ]);
    expect(scopesForAgentAccessRole("publisher")).toEqual([
      "collaboration:execute", "collaboration:read", "graph:read", "graph:write", "memory:read",
      "memory:write", "pages:read", "pages:write", "review:auto-publish", "review:read", "runs:read",
      "runs:write", "sources:read", "sources:write", "spaces:read",
    ]);
  });

  it("never grants a human review decision", () => {
    for (const role of AGENT_ACCESS_ROLES) {
      expect(agentRoleAllowsScope(role, "review:decide")).toBe(false);
    }
  });

  it("maps reader to viewer capability and writers to editor capability", () => {
    expect(agentRoleSpaceCapability("reader")).toBe("viewer");
    expect(agentRoleSpaceCapability("editor")).toBe("editor");
    expect(agentRoleSpaceCapability("publisher")).toBe("editor");
  });
});
