import { describe, expect, it } from "vitest";
import { CollaborationTemplateDefinitionSchema } from "./collaboration.js";
import { CompositeTemplateDefinitionSchema } from "./composite-template.js";

const page = (overrides: Record<string, unknown> = {}) => ({
  nodeId: "page",
  parentNodeId: null,
  kind: "page",
  order: 0,
  titleI18n: { "zh-CN": "纪要" },
  contentI18n: { "zh-CN": "# 纪要" },
  roleSlotKey: null,
  ...overrides,
});

const single = () => ({
  schemaVersion: 1,
  kind: "single_page",
  nodes: [page()],
  collaboration: null,
});

const workflow = () => CollaborationTemplateDefinitionSchema.parse({
  schemaVersion: 1,
  inputs: [],
  roleSlots: [{ id: "writer", name: "Writer", required: true, description: "Writes" }],
  nodes: [{
    kind: "agent_task",
    id: "draft",
    name: "Draft",
    roleSlotId: "writer",
    objective: "Write the page",
    inputKeys: [],
    upstreamArtifacts: [],
    output: { key: "draft", kind: "markdown" },
    evidenceRequired: [],
    humanAcceptance: true,
    leaseSeconds: 300,
    maxExecutionSeconds: 3600,
    retryBudget: 1,
    repairBudget: 1,
    skippable: false,
    todos: [{ id: "write", name: "Write", required: true, evidenceKinds: [] }],
  }],
  dependencies: [],
  terminalNodeIds: ["draft"],
});

describe("composite template definition", () => {
  it("counts exactly 5 MiB of UTF-8 string values without JSON property names", () => {
    // Values outside the bodies: page_group (10), root/folder/R (11), and
    // 30 pages each with pNN/root/page/T (12) = 381 bytes. Keys are structural.
    const budget = 5 * 1024 * 1024;
    const bodies = Array.from({ length: 30 }, (_, i) => i === 29
      ? "x".repeat(budget - 381 - 29 * 180_000)
      : "x".repeat(180_000));
    const value = {
      schemaVersion: 1, kind: "page_group", collaboration: null,
      nodes: [
        { nodeId: "root", parentNodeId: null, kind: "folder", order: 0, nameI18n: { en: "R" } },
        ...bodies.map((body, i) => page({ nodeId: `p${String(i).padStart(2, "0")}`, parentNodeId: "root", titleI18n: { en: "T" }, contentI18n: { en: body } })),
      ],
    };
    expect(CompositeTemplateDefinitionSchema.safeParse(value).success).toBe(true);
    const last = value.nodes.at(-1)! as { contentI18n: Record<string, string> };
    last.contentI18n = { en: bodies[29] + "x" };
    expect(CompositeTemplateDefinitionSchema.safeParse(value).success).toBe(false);
    last.contentI18n = { en: bodies[29].slice(0, -3) + "中" };
    expect(CompositeTemplateDefinitionSchema.safeParse(value).success).toBe(true);
  });
  it("accepts a strict single-page definition", () => {
    expect(CompositeTemplateDefinitionSchema.safeParse(single()).success).toBe(true);
    expect(CompositeTemplateDefinitionSchema.safeParse({ ...single(), agentId: "secret" }).success).toBe(false);
    expect(CompositeTemplateDefinitionSchema.safeParse({
      ...single(),
      nodes: [page({ agentId: "secret" })],
    }).success).toBe(false);
    expect(CompositeTemplateDefinitionSchema.safeParse({
      ...single(),
      nodes: [page({ titleI18n: { fr: "Secret" } })],
    }).success).toBe(false);
  });

  it("requires exactly one root page for single-page templates", () => {
    expect(CompositeTemplateDefinitionSchema.safeParse({
      ...single(),
      nodes: [page(), page({ nodeId: "second", order: 1 })],
    }).success).toBe(false);
    expect(CompositeTemplateDefinitionSchema.safeParse({
      ...single(),
      nodes: [{
        nodeId: "folder", parentNodeId: null, kind: "folder", order: 0,
        nameI18n: { en: "Folder" },
      }],
    }).success).toBe(false);
  });

  it("requires one rooted, depth-bounded page-group tree and permits stable order ties", () => {
    const valid = {
      schemaVersion: 1,
      kind: "page_group",
      nodes: [
        { nodeId: "root", parentNodeId: null, kind: "folder", order: 0, nameI18n: { en: "Root" } },
        { nodeId: "notes", parentNodeId: "root", kind: "folder", order: 0, nameI18n: { en: "Notes" } },
        page({ nodeId: "meeting", parentNodeId: "notes", order: 0 }),
      ],
      collaboration: null,
    };
    expect(CompositeTemplateDefinitionSchema.safeParse(valid).success).toBe(true);
    expect(CompositeTemplateDefinitionSchema.safeParse({
      ...valid,
      nodes: [...valid.nodes, page({ nodeId: "orphan", parentNodeId: "missing", order: 1 })],
    }).success).toBe(false);
    expect(CompositeTemplateDefinitionSchema.safeParse({
      ...valid,
      nodes: [...valid.nodes, page({ nodeId: "duplicate-order", parentNodeId: "notes", order: 0 })],
    }).success).toBe(true);
    expect(CompositeTemplateDefinitionSchema.safeParse({
      ...valid,
      nodes: Array.from({ length: 9 }, (_, index) => index === 8
        ? page({ nodeId: `node-${index}`, parentNodeId: `node-${index - 1}` })
        : {
          nodeId: `node-${index}`,
          parentNodeId: index === 0 ? null : `node-${index - 1}`,
          kind: "folder",
          order: 0,
          nameI18n: { en: `Node ${index}` },
        }),
    }).success).toBe(false);
  });

  it("bounds node counts and markdown by UTF-8 bytes", () => {
    const root = { nodeId: "root", parentNodeId: null, kind: "folder", order: 0, nameI18n: { en: "Root" } };
    expect(CompositeTemplateDefinitionSchema.safeParse({
      schemaVersion: 1,
      kind: "page_group",
      nodes: [
        root,
        ...Array.from({ length: 99 }, (_, index) => ({
          nodeId: `folder-${index}`,
          parentNodeId: "root",
          kind: "folder",
          order: index,
          nameI18n: { en: `Folder ${index}` },
        })),
        page({ nodeId: "over-limit-page", parentNodeId: "root", order: 100 }),
      ],
      collaboration: null,
    }).success).toBe(false);
    expect(CompositeTemplateDefinitionSchema.safeParse({
      schemaVersion: 1,
      kind: "page_group",
      nodes: [root, ...Array.from({ length: 51 }, (_, index) => page({
        nodeId: `page-${index}`,
        parentNodeId: "root",
        order: index,
      }))],
      collaboration: null,
    }).success).toBe(false);
    expect(CompositeTemplateDefinitionSchema.safeParse({
      ...single(),
      nodes: [page({ contentI18n: { "zh-CN": "汉".repeat(333_334) } })],
    }).success).toBe(false);
    expect(CompositeTemplateDefinitionSchema.safeParse({
      ...single(),
      nodes: [page({ contentI18n: { en: "a".repeat(200_001) } })],
    }).success).toBe(false);
    expect(CompositeTemplateDefinitionSchema.safeParse({
      ...single(),
      nodes: [page({ contentI18n: { "zh-CN": "汉".repeat(200_000) } })],
    }).success).toBe(true);
    expect(CompositeTemplateDefinitionSchema.safeParse({
      schemaVersion: 1,
      kind: "page_group",
      nodes: [root, ...Array.from({ length: 27 }, (_, index) => page({
        nodeId: `large-page-${index}`,
        parentNodeId: "root",
        order: index,
        contentI18n: { en: "a".repeat(200_000) },
      }))],
      collaboration: null,
    }).success).toBe(false);
  });

  it("requires collaboration task targets to reference workflow tasks and distinct pages", () => {
    const collaborative = {
      ...single(),
      nodes: [page({ roleSlotKey: "writer" })],
      collaboration: {
        workflow: workflow(),
        taskTargets: [{ taskNodeId: "draft", pageNodeId: "page" }],
      },
    };
    expect(CompositeTemplateDefinitionSchema.safeParse(collaborative).success).toBe(true);
    expect(CompositeTemplateDefinitionSchema.safeParse({
      ...collaborative,
      collaboration: { ...collaborative.collaboration, taskTargets: [
        { taskNodeId: "draft", pageNodeId: "page" },
        { taskNodeId: "draft", pageNodeId: "page" },
      ] },
    }).success).toBe(false);
    expect(CompositeTemplateDefinitionSchema.safeParse({
      ...collaborative,
      collaboration: { ...collaborative.collaboration, taskTargets: [
        { taskNodeId: "missing", pageNodeId: "page" },
      ] },
    }).success).toBe(false);
  });
});
