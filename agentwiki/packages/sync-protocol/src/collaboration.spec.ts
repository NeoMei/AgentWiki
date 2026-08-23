import { describe, expect, it } from "vitest";
import {
  COLLABORATION_LIMITS,
  CollaborationArtifactInputSchema,
  CollaborationInputValuesSchema,
  CollaborationNextActionInputSchema,
  CollaborationRunStatusSchema,
  CollaborationTaskStatusSchema,
  CollaborationTemplateDefinitionSchema,
} from "./collaboration.js";
import { scopesForAgentAccessRole } from "./agent-access-role.js";

const agentTask = (overrides: Record<string, unknown> = {}) => ({
  kind: "agent_task",
  id: "draft",
  name: "Draft",
  roleSlotId: "writer",
  objective: "Create the draft",
  inputKeys: ["topic"],
  upstreamArtifacts: [],
  output: { key: "draft", kind: "markdown" },
  evidenceRequired: [],
  humanAcceptance: true,
  leaseSeconds: 300,
  maxExecutionSeconds: 3600,
  retryBudget: 2,
  repairBudget: 2,
  skippable: false,
  todos: [{ id: "write", name: "Write", required: true, evidenceKinds: [] }],
  ...overrides,
});

const validDefinition = () => ({
  schemaVersion: 1,
  inputs: [{ key: "topic", label: "Topic", required: true, type: "short_text" }],
  roleSlots: [{ id: "writer", name: "Writer", required: true, description: "Writes" }],
  nodes: [
    agentTask(),
    {
      kind: "human_review",
      id: "review",
      name: "Review",
      artifactTaskId: "draft",
      minimumRole: "editor",
      reviewerUserIds: [],
      approvalCriteria: ["Complete"],
      revisionTaskId: "draft",
      allowTerminate: true,
    },
  ],
  dependencies: [{ from: "draft", to: "review", mode: "all" }],
  terminalNodeIds: ["review"],
});

describe("collaboration contract", () => {
  it("keeps exact run and task states", () => {
    expect(CollaborationRunStatusSchema.options).toEqual([
      "draft", "ready", "running", "waiting_review", "paused", "completed", "failed", "cancelled",
    ]);
    expect(CollaborationTaskStatusSchema.options).toEqual([
      "blocked", "ready", "claimed", "running", "submitted", "completed", "retry_wait", "failed", "skipped",
    ]);
  });

  it("rejects executable template content and oversized definitions", () => {
    expect(() => CollaborationTemplateDefinitionSchema.parse({
      ...validDefinition(),
      script: "process.env.SECRET",
    })).toThrow();
    expect(() => CollaborationTemplateDefinitionSchema.parse({
      ...validDefinition(),
      inputs: Array.from({ length: COLLABORATION_LIMITS.inputs + 1 }, (_, index) => ({
        key: `input-${index}`,
        label: `Input ${index}`,
        required: false,
        type: "short_text",
      })),
    })).toThrow();
  });

  it("requires a write idempotency key and rejects unknown MCP fields", () => {
    expect(() => CollaborationNextActionInputSchema.parse({ runId: "run-1" })).toThrow();
    expect(() => CollaborationNextActionInputSchema.parse({
      runId: "run-1", idempotencyKey: "next-00000001", unexpected: true,
    })).toThrow();
  });

  it("derives collaboration execution from access roles without review decisions", () => {
    expect(scopesForAgentAccessRole("reader")).toContain("collaboration:read");
    expect(scopesForAgentAccessRole("reader")).not.toContain("collaboration:execute");
    for (const role of ["editor", "publisher"] as const) {
      expect(scopesForAgentAccessRole(role)).toEqual(expect.arrayContaining([
        "collaboration:read", "collaboration:execute",
      ]));
      expect(scopesForAgentAccessRole(role)).not.toContain("review:decide");
    }
  });

  it("accepts a valid review workflow and rejects duplicate identities", () => {
    expect(() => CollaborationTemplateDefinitionSchema.parse(validDefinition())).not.toThrow();

    const duplicateInput = validDefinition();
    duplicateInput.inputs.push({ ...duplicateInput.inputs[0] });
    expect(() => CollaborationTemplateDefinitionSchema.parse(duplicateInput)).toThrow(/input/i);

    const duplicateTodo = validDefinition();
    duplicateTodo.nodes[0] = agentTask({
      todos: [
        { id: "write", name: "Write", required: true, evidenceKinds: [] },
        { id: "write", name: "Rewrite", required: true, evidenceKinds: [] },
      ],
    });
    expect(() => CollaborationTemplateDefinitionSchema.parse(duplicateTodo)).toThrow(/todo/i);
  });

  it("requires one required Todo and valid role, input, and terminal references", () => {
    const noRequiredTodo = validDefinition();
    noRequiredTodo.nodes[0] = agentTask({
      todos: [{ id: "write", name: "Write", required: false, evidenceKinds: [] }],
    });
    expect(() => CollaborationTemplateDefinitionSchema.parse(noRequiredTodo)).toThrow(/required Todo/i);

    const dangling = validDefinition();
    dangling.nodes[0] = agentTask({ roleSlotId: "missing", inputKeys: ["missing"] });
    dangling.terminalNodeIds = ["missing"];
    expect(() => CollaborationTemplateDefinitionSchema.parse(dangling)).toThrow();
  });

  it("requires terminal nodes to have no outgoing dependency", () => {
    const definition = validDefinition();
    definition.terminalNodeIds = ["draft"];
    expect(() => CollaborationTemplateDefinitionSchema.parse(definition)).toThrow(/terminal/i);
  });

  it("requires upstream artifacts to be produced by reachable ancestors", () => {
    const definition = validDefinition();
    definition.nodes = [
      agentTask({ humanAcceptance: false }),
      agentTask({
        id: "polish",
        name: "Polish",
        inputKeys: [],
        upstreamArtifacts: [{ key: "draft", required: true }],
        output: { key: "polished", kind: "markdown" },
      }),
    ];
    definition.dependencies = [];
    definition.terminalNodeIds = ["polish"];
    expect(() => CollaborationTemplateDefinitionSchema.parse(definition)).toThrow(/artifact/i);
  });

  it("requires review source edges and ancestor revision targets", () => {
    const missingSourceEdge = validDefinition();
    missingSourceEdge.dependencies = [];
    expect(() => CollaborationTemplateDefinitionSchema.parse(missingSourceEdge)).toThrow(/review/i);

    const invalidRevision = validDefinition();
    invalidRevision.nodes.unshift(agentTask({
      id: "unrelated",
      name: "Unrelated",
      output: { key: "unrelated", kind: "markdown" },
      humanAcceptance: false,
    }));
    (invalidRevision.nodes[2] as { revisionTaskId: string }).revisionTaskId = "unrelated";
    expect(() => CollaborationTemplateDefinitionSchema.parse(invalidRevision)).toThrow(/revision/i);
  });

  it("rejects unsafe any dependencies for required upstream artifacts", () => {
    const definition = validDefinition();
    definition.nodes = [
      agentTask({ id: "source-a", name: "A", output: { key: "a", kind: "markdown" }, humanAcceptance: false }),
      agentTask({ id: "source-b", name: "B", output: { key: "b", kind: "markdown" }, humanAcceptance: false }),
      agentTask({
        id: "merge",
        name: "Merge",
        inputKeys: [],
        upstreamArtifacts: [{ key: "a", required: true }],
        output: { key: "merged", kind: "markdown" },
        humanAcceptance: false,
      }),
    ];
    definition.dependencies = [
      { from: "source-a", to: "merge", mode: "any" },
      { from: "source-b", to: "merge", mode: "any" },
    ];
    definition.terminalNodeIds = ["merge"];
    expect(() => CollaborationTemplateDefinitionSchema.parse(definition)).toThrow(/guaranteed|required artifact/i);
  });

  it("rejects indirect and nested any paths that can release before a required artifact", () => {
    const indirect = validDefinition();
    indirect.nodes = [
      agentTask({ id: "producer", name: "Producer", output: { key: "required", kind: "markdown" }, humanAcceptance: false }),
      agentTask({ id: "relay", name: "Relay", output: { key: "relay", kind: "markdown" }, humanAcceptance: false }),
      agentTask({ id: "bypass", name: "Bypass", output: { key: "bypass", kind: "markdown" }, humanAcceptance: false }),
      agentTask({
        id: "consumer",
        name: "Consumer",
        inputKeys: [],
        upstreamArtifacts: [{ key: "required", required: true }],
        output: { key: "result", kind: "markdown" },
        humanAcceptance: false,
      }),
    ];
    indirect.dependencies = [
      { from: "producer", to: "relay", mode: "all" },
      { from: "relay", to: "consumer", mode: "any" },
      { from: "bypass", to: "consumer", mode: "any" },
    ];
    indirect.terminalNodeIds = ["consumer"];
    expect(() => CollaborationTemplateDefinitionSchema.parse(indirect)).toThrow(/guaranteed|required artifact/i);

    const nestedAny = validDefinition();
    nestedAny.nodes = [
      agentTask({ id: "producer", name: "Producer", output: { key: "required", kind: "markdown" }, humanAcceptance: false }),
      agentTask({ id: "alternate", name: "Alternate", output: { key: "alternate", kind: "markdown" }, humanAcceptance: false }),
      agentTask({ id: "inner", name: "Inner", output: { key: "inner", kind: "markdown" }, humanAcceptance: false }),
      agentTask({ id: "outer-bypass", name: "Outer bypass", output: { key: "outer-bypass", kind: "markdown" }, humanAcceptance: false }),
      agentTask({
        id: "consumer",
        name: "Consumer",
        inputKeys: [],
        upstreamArtifacts: [{ key: "required", required: true }],
        output: { key: "result", kind: "markdown" },
        humanAcceptance: false,
      }),
    ];
    nestedAny.dependencies = [
      { from: "producer", to: "inner", mode: "any" },
      { from: "alternate", to: "inner", mode: "any" },
      { from: "inner", to: "consumer", mode: "any" },
      { from: "outer-bypass", to: "consumer", mode: "any" },
    ];
    nestedAny.terminalNodeIds = ["consumer"];
    expect(() => CollaborationTemplateDefinitionSchema.parse(nestedAny)).toThrow(/guaranteed|required artifact/i);
  });

  it("accepts nested any joins when the required producer is guaranteed on every release path", () => {
    const definition = validDefinition();
    definition.nodes = [
      agentTask({ id: "producer", name: "Producer", output: { key: "required", kind: "markdown" }, humanAcceptance: false }),
      agentTask({ id: "left", name: "Left", output: { key: "left", kind: "markdown" }, humanAcceptance: false }),
      agentTask({ id: "right", name: "Right", output: { key: "right", kind: "markdown" }, humanAcceptance: false }),
      agentTask({ id: "inner", name: "Inner", output: { key: "inner", kind: "markdown" }, humanAcceptance: false }),
      agentTask({ id: "outer", name: "Outer", output: { key: "outer", kind: "markdown" }, humanAcceptance: false }),
      agentTask({
        id: "consumer",
        name: "Consumer",
        inputKeys: [],
        upstreamArtifacts: [{ key: "required", required: true }],
        output: { key: "result", kind: "markdown" },
        humanAcceptance: false,
      }),
    ];
    definition.dependencies = [
      { from: "producer", to: "left", mode: "all" },
      { from: "producer", to: "right", mode: "all" },
      { from: "left", to: "inner", mode: "any" },
      { from: "right", to: "inner", mode: "any" },
      { from: "producer", to: "outer", mode: "all" },
      { from: "inner", to: "consumer", mode: "any" },
      { from: "outer", to: "consumer", mode: "any" },
    ];
    definition.terminalNodeIds = ["consumer"];
    expect(() => CollaborationTemplateDefinitionSchema.parse(definition)).not.toThrow();
  });

  it("rejects required Artifact paths that a skippable producer or relay can bypass", () => {
    const skippableProducer = validDefinition();
    skippableProducer.nodes = [
      agentTask({
        id: "producer",
        name: "Producer",
        output: { key: "required", kind: "markdown" },
        humanAcceptance: false,
        skippable: true,
      }),
      agentTask({
        id: "consumer",
        name: "Consumer",
        inputKeys: [],
        upstreamArtifacts: [{ key: "required", required: true }],
        output: { key: "result", kind: "markdown" },
        humanAcceptance: false,
      }),
    ];
    skippableProducer.dependencies = [{ from: "producer", to: "consumer", mode: "all" }];
    skippableProducer.terminalNodeIds = ["consumer"];
    expect(() => CollaborationTemplateDefinitionSchema.parse(skippableProducer)).toThrow(/guaranteed|required artifact/i);

    const skippableRelay = validDefinition();
    skippableRelay.nodes = [
      agentTask({ id: "producer", name: "Producer", output: { key: "required", kind: "markdown" }, humanAcceptance: false }),
      agentTask({ id: "relay", name: "Relay", output: { key: "relay", kind: "markdown" }, humanAcceptance: false, skippable: true }),
      agentTask({
        id: "consumer",
        name: "Consumer",
        inputKeys: [],
        upstreamArtifacts: [{ key: "required", required: true }],
        output: { key: "result", kind: "markdown" },
        humanAcceptance: false,
      }),
    ];
    skippableRelay.dependencies = [
      { from: "producer", to: "relay", mode: "all" },
      { from: "relay", to: "consumer", mode: "all" },
    ];
    skippableRelay.terminalNodeIds = ["consumer"];
    expect(() => CollaborationTemplateDefinitionSchema.parse(skippableRelay)).toThrow(/guaranteed|required artifact/i);
  });

  it("keeps input values and artifact variants strict", () => {
    expect(CollaborationInputValuesSchema.parse({ topic: "AgentWiki", count: 3, approved: true })).toEqual({
      topic: "AgentWiki", count: 3, approved: true,
    });
    expect(() => CollaborationInputValuesSchema.parse({ topic: { executable: true } })).toThrow();
    expect(() => CollaborationArtifactInputSchema.parse({
      kind: "markdown", markdown: "ok", evidence: [], script: "run",
    })).toThrow();
  });
});
