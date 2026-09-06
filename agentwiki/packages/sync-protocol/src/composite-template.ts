import { z } from "zod";
import {
  COLLABORATION_LIMITS,
  CollaborationTemplateDefinitionSchema,
} from "./collaboration.js";

export const COMPOSITE_TEMPLATE_LIMITS = {
  depth: 8,
  nodes: 100,
  pages: 50,
  totalTextBytes: 5 * 1024 * 1024,
} as const;

const IdentifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
const LocalizedTextSchema = z.object({
  "zh-CN": z.string().max(COMPOSITE_TEMPLATE_LIMITS.totalTextBytes).optional(),
  en: z.string().max(COMPOSITE_TEMPLATE_LIMITS.totalTextBytes).optional(),
}).strict().refine(
  (value) => value["zh-CN"] !== undefined || value.en !== undefined,
  "Localized text requires at least one locale",
);

const TemplateFolderNodeSchema = z.object({
  nodeId: IdentifierSchema,
  parentNodeId: IdentifierSchema.nullable(),
  kind: z.literal("folder"),
  order: z.number().int().min(0),
  nameI18n: LocalizedTextSchema,
}).strict();

const TemplatePageNodeSchema = z.object({
  nodeId: IdentifierSchema,
  parentNodeId: IdentifierSchema.nullable(),
  kind: z.literal("page"),
  order: z.number().int().min(0),
  titleI18n: LocalizedTextSchema,
  contentI18n: LocalizedTextSchema.superRefine((content, context) => {
    for (const [locale, markdown] of Object.entries(content)) {
      if (hasMoreThanCodePoints(markdown, 200_000)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [locale],
          message: "Page Markdown cannot exceed 200000 Unicode code points",
        });
      }
      if (utf8Bytes(markdown) > COLLABORATION_LIMITS.markdownBytes) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [locale],
          message: `Page Markdown cannot exceed ${COLLABORATION_LIMITS.markdownBytes} UTF-8 bytes`,
        });
      }
    }
  }),
  roleSlotKey: IdentifierSchema.nullable(),
}).strict();

export const TemplateNodeSchema = z.discriminatedUnion("kind", [
  TemplateFolderNodeSchema,
  TemplatePageNodeSchema,
]);

const CollaborationTargetSchema = z.object({
  taskNodeId: IdentifierSchema,
  pageNodeId: IdentifierSchema,
}).strict();

const CompositeCollaborationSchema = z.object({
  workflow: CollaborationTemplateDefinitionSchema,
  taskTargets: z.array(CollaborationTargetSchema).max(COLLABORATION_LIMITS.nodes),
}).strict();

const CompositeTemplateDefinitionBaseSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.enum(["single_page", "page_group"]),
  nodes: z.array(TemplateNodeSchema).min(1).max(COMPOSITE_TEMPLATE_LIMITS.nodes),
  collaboration: CompositeCollaborationSchema.nullable(),
}).strict();

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasMoreThanCodePoints(value: string, maximum: number): boolean {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > maximum) return true;
  }
  return false;
}

function totalTextBytes(value: unknown): number {
  if (typeof value === "string") return utf8Bytes(value);
  if (Array.isArray(value)) return value.reduce((total, item) => total + totalTextBytes(item), 0);
  if (value !== null && typeof value === "object") {
    return Object.values(value).reduce(
      (total: number, item) => total + totalTextBytes(item),
      0,
    );
  }
  return 0;
}

export const CompositeTemplateDefinitionSchema = CompositeTemplateDefinitionBaseSchema.superRefine(
  (definition, context) => {
    if (totalTextBytes(definition) > COMPOSITE_TEMPLATE_LIMITS.totalTextBytes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Composite template text cannot exceed ${COMPOSITE_TEMPLATE_LIMITS.totalTextBytes} UTF-8 bytes`,
      });
    }

    const nodeById = new Map<string, TemplateNode>();
    for (const [index, node] of definition.nodes.entries()) {
      if (nodeById.has(node.nodeId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "nodeId"], message: `Duplicate nodeId: ${node.nodeId}` });
      }
      nodeById.set(node.nodeId, node);
    }

    const pages = definition.nodes.filter((node): node is z.infer<typeof TemplatePageNodeSchema> => node.kind === "page");
    const folders = definition.nodes.filter((node): node is z.infer<typeof TemplateFolderNodeSchema> => node.kind === "folder");
    if (pages.length > COMPOSITE_TEMPLATE_LIMITS.pages) {
      context.addIssue({ code: z.ZodIssueCode.too_big, maximum: COMPOSITE_TEMPLATE_LIMITS.pages, inclusive: true, type: "array", path: ["nodes"], message: `Page count cannot exceed ${COMPOSITE_TEMPLATE_LIMITS.pages}` });
    }

    if (definition.kind === "single_page") {
      if (pages.length !== 1 || folders.length !== 0 || pages[0]?.parentNodeId !== null) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes"], message: "single_page requires exactly one root Page node" });
      }
    } else {
      const roots = definition.nodes.filter((node) => node.parentNodeId === null);
      if (roots.length !== 1 || roots[0]?.kind !== "folder") {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes"], message: "page_group requires exactly one root Folder node" });
      }
      if (pages.length === 0) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes"], message: "page_group requires at least one Page node" });
      }
    }

    for (const [index, node] of definition.nodes.entries()) {
      if (node.parentNodeId !== null) {
        const parent = nodeById.get(node.parentNodeId);
        if (!parent) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "parentNodeId"], message: `Unknown parent node: ${node.parentNodeId}` });
        } else if (parent.kind !== "folder") {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "parentNodeId"], message: "Only Folder nodes may be parents" });
        }
      }

      const visited = new Set<string>();
      let current: TemplateNode | undefined = node;
      let depth = 0;
      while (current) {
        if (visited.has(current.nodeId)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "parentNodeId"], message: "Template tree cannot contain a cycle" });
          break;
        }
        visited.add(current.nodeId);
        depth += 1;
        if (depth > COMPOSITE_TEMPLATE_LIMITS.depth) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index], message: `Template tree depth cannot exceed ${COMPOSITE_TEMPLATE_LIMITS.depth}` });
          break;
        }
        current = current.parentNodeId === null ? undefined : nodeById.get(current.parentNodeId);
      }
    }

    const collaboration = definition.collaboration;
    if (!collaboration) {
      for (const [index, node] of pages.entries()) {
        if (node.roleSlotKey !== null) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "roleSlotKey"], message: "roleSlotKey requires collaboration" });
        }
      }
      return;
    }

    const roleSlots = new Set(collaboration.workflow.roleSlots.map((role) => role.id));
    for (const [index, node] of definition.nodes.entries()) {
      if (node.kind === "page" && node.roleSlotKey !== null && !roleSlots.has(node.roleSlotKey)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes", index, "roleSlotKey"], message: `Unknown role slot: ${node.roleSlotKey}` });
      }
    }
    const taskIds = new Set(collaboration.workflow.nodes
      .filter((node) => node.kind === "agent_task")
      .map((node) => node.id));
    const pageIds = new Set(pages.map((node) => node.nodeId));
    const targetedTasks = new Set<string>();
    const targetedPages = new Set<string>();
    for (const [index, target] of collaboration.taskTargets.entries()) {
      if (!taskIds.has(target.taskNodeId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["collaboration", "taskTargets", index, "taskNodeId"], message: `Unknown Agent task: ${target.taskNodeId}` });
      }
      if (!pageIds.has(target.pageNodeId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["collaboration", "taskTargets", index, "pageNodeId"], message: `Unknown Page node: ${target.pageNodeId}` });
      }
      if (targetedTasks.has(target.taskNodeId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["collaboration", "taskTargets", index, "taskNodeId"], message: `Task may target only one Page: ${target.taskNodeId}` });
      }
      if (targetedPages.has(target.pageNodeId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["collaboration", "taskTargets", index, "pageNodeId"], message: `Page may have only one direct writing task: ${target.pageNodeId}` });
      }
      targetedTasks.add(target.taskNodeId);
      targetedPages.add(target.pageNodeId);
    }
  },
);

export type CompositeTemplateDefinition = z.infer<typeof CompositeTemplateDefinitionSchema>;
export type TemplateNode = z.infer<typeof TemplateNodeSchema>;
