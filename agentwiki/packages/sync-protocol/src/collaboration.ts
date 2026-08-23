import { z } from "zod";

export const COLLABORATION_LIMITS = {
  inputs: 30,
  roleSlots: 20,
  nodes: 100,
  todosPerTask: 50,
  markdownBytes: 1_000_000,
  jsonBytes: 256_000,
  jsonDepth: 12,
  evidencePerTodo: 20,
  longPollSeconds: 25,
} as const;

const IdentifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
const NameSchema = z.string().trim().min(1).max(240);
const DescriptionSchema = z.string().max(8_000);
const WriteKeySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
const LeaseTokenSchema = z.string().min(32).max(512);
const JsonObjectSchema = z.record(z.string(), z.unknown());

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function jsonDepth(value: unknown, seen = new Set<object>()): number {
  if (value === null || typeof value !== "object") return 0;
  if (seen.has(value)) return Number.POSITIVE_INFINITY;
  seen.add(value);
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  const depth = 1 + children.reduce((maximum, child) => Math.max(maximum, jsonDepth(child, seen)), 0);
  seen.delete(value);
  return depth;
}

function isBoundedJson(value: unknown): boolean {
  if (jsonDepth(value) > COLLABORATION_LIMITS.jsonDepth) return false;
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && utf8Bytes(serialized) <= COLLABORATION_LIMITS.jsonBytes;
  } catch {
    return false;
  }
}

export const CollaborationRunStatusSchema = z.enum([
  "draft",
  "ready",
  "running",
  "waiting_review",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export const CollaborationTaskStatusSchema = z.enum([
  "blocked",
  "ready",
  "claimed",
  "running",
  "submitted",
  "completed",
  "retry_wait",
  "failed",
  "skipped",
]);

export const CollaborationTodoStatusSchema = z.enum(["pending", "doing", "done", "failed"]);
export const CollaborationArtifactKindSchema = z.enum([
  "markdown",
  "json",
  "external_reference",
  "evidence_summary",
]);
export const CollaborationArtifactStatusSchema = z.enum(["pending", "accepted", "rejected", "superseded"]);
export const CollaborationReviewStatusSchema = z.enum(["pending", "approved", "rejected", "terminated", "superseded"]);

export const CollaborationInputDefinitionSchema = z.object({
  key: IdentifierSchema,
  label: NameSchema,
  required: z.boolean(),
  type: z.enum(["short_text", "long_text", "number", "boolean", "url"]),
}).strict();

export const CollaborationInputValueSchema = z.union([
  z.string().max(COLLABORATION_LIMITS.markdownBytes),
  z.number().finite(),
  z.boolean(),
]);

export const CollaborationInputValuesSchema = z.record(IdentifierSchema, CollaborationInputValueSchema)
  .superRefine((values, context) => {
    if (Object.keys(values).length > COLLABORATION_LIMITS.inputs) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: COLLABORATION_LIMITS.inputs,
        inclusive: true,
        type: "array",
        message: `Input values cannot exceed ${COLLABORATION_LIMITS.inputs} entries`,
      });
    }
    if (!isBoundedJson(values)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Input values cannot exceed ${COLLABORATION_LIMITS.jsonBytes} UTF-8 bytes or JSON depth ${COLLABORATION_LIMITS.jsonDepth}`,
      });
    }
  });

const CollaborationTodoDefinitionSchema = z.object({
  id: IdentifierSchema,
  name: NameSchema,
  required: z.boolean(),
  evidenceKinds: z.array(IdentifierSchema).max(10),
}).strict();

const CollaborationOutputDefinitionSchema = z.object({
  key: IdentifierSchema,
  kind: CollaborationArtifactKindSchema,
  jsonSchema: JsonObjectSchema.optional(),
}).strict().superRefine((output, context) => {
  if (output.kind === "json" && output.jsonSchema === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["jsonSchema"],
      message: "JSON outputs require a jsonSchema",
    });
  }
  if (output.kind !== "json" && output.jsonSchema !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["jsonSchema"],
      message: "jsonSchema is only valid for JSON outputs",
    });
  }
});

const CollaborationAgentTaskNodeSchema = z.object({
  kind: z.literal("agent_task"),
  id: IdentifierSchema,
  name: NameSchema,
  roleSlotId: IdentifierSchema,
  objective: z.string().trim().min(1).max(16_000),
  inputKeys: z.array(IdentifierSchema).max(COLLABORATION_LIMITS.inputs),
  upstreamArtifacts: z.array(z.object({
    key: IdentifierSchema,
    required: z.boolean(),
  }).strict()).max(COLLABORATION_LIMITS.inputs),
  output: CollaborationOutputDefinitionSchema,
  evidenceRequired: z.array(IdentifierSchema).max(20),
  humanAcceptance: z.boolean(),
  leaseSeconds: z.number().int().min(30).max(3_600),
  maxExecutionSeconds: z.number().int().min(60).max(86_400),
  retryBudget: z.number().int().min(0).max(10),
  repairBudget: z.number().int().min(0).max(10),
  skippable: z.boolean(),
  todos: z.array(CollaborationTodoDefinitionSchema).min(1).max(COLLABORATION_LIMITS.todosPerTask),
}).strict();

const CollaborationHumanReviewNodeSchema = z.object({
  kind: z.literal("human_review"),
  id: IdentifierSchema,
  name: NameSchema,
  artifactTaskId: IdentifierSchema,
  minimumRole: z.enum(["owner", "admin", "editor"]),
  reviewerUserIds: z.array(IdentifierSchema).max(20),
  approvalCriteria: z.array(z.string().trim().min(1).max(2_000)).min(1).max(30),
  revisionTaskId: IdentifierSchema,
  allowTerminate: z.boolean(),
}).strict();

export const CollaborationNodeSchema = z.discriminatedUnion("kind", [
  CollaborationAgentTaskNodeSchema,
  CollaborationHumanReviewNodeSchema,
]);

const CollaborationTemplateDefinitionBaseSchema = z.object({
  schemaVersion: z.literal(1),
  inputs: z.array(CollaborationInputDefinitionSchema).max(COLLABORATION_LIMITS.inputs),
  roleSlots: z.array(z.object({
    id: IdentifierSchema,
    name: NameSchema,
    required: z.boolean(),
    description: DescriptionSchema,
  }).strict()).min(1).max(COLLABORATION_LIMITS.roleSlots),
  nodes: z.array(CollaborationNodeSchema).min(1).max(COLLABORATION_LIMITS.nodes),
  dependencies: z.array(z.object({
    from: IdentifierSchema,
    to: IdentifierSchema,
    mode: z.enum(["all", "any"]),
  }).strict()).max(500),
  terminalNodeIds: z.array(IdentifierSchema).min(1).max(20),
}).strict();

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

type CollaborationReadinessDependency = {
  from: string;
  to: string;
  mode: unknown;
};

type CollaborationReadinessNode = {
  id: string;
  kind?: unknown;
  artifactTaskId?: unknown;
  skippable?: unknown;
};

export function collaborationGuaranteedPredecessors(
  nodes: Iterable<CollaborationReadinessNode>,
  dependencies: readonly CollaborationReadinessDependency[],
): Map<string, ReadonlySet<string>> {
  const nodeList = [...nodes];
  const ids = [...new Set(nodeList.map((node) => node.id))].sort();
  const idSet = new Set(ids);
  const skippableIds = new Set(nodeList.filter((node) => node.skippable === true).map((node) => node.id));
  const reviewSourceById = new Map(nodeList.flatMap((node) =>
    node.kind === "human_review" && typeof node.artifactTaskId === "string"
      ? [[node.id, node.artifactTaskId] as const]
      : []));
  const incoming = new Map(ids.map((id) => [id, [] as CollaborationReadinessDependency[]]));
  const outgoing = new Map(ids.map((id) => [id, new Set<string>()]));
  const seenEdges = new Set<string>();
  for (const dependency of dependencies) {
    if (!idSet.has(dependency.from) || !idSet.has(dependency.to)) continue;
    const edgeKey = `${dependency.from}\u0000${dependency.to}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    incoming.get(dependency.to)!.push(dependency);
    outgoing.get(dependency.from)!.add(dependency.to);
  }
  for (const edges of incoming.values()) {
    edges.sort((left, right) => left.from.localeCompare(right.from));
  }

  const remainingParents = new Map(ids.map((id) => [id, incoming.get(id)!.length]));
  const ready = ids.filter((id) => remainingParents.get(id) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of [...outgoing.get(id)!].sort()) {
      const remaining = remainingParents.get(next)! - 1;
      remainingParents.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
    ready.sort();
  }

  const guaranteed = new Map<string, ReadonlySet<string>>(ids.map((id) => [id, new Set<string>()]));
  for (const id of order) {
    const reviewSource = reviewSourceById.get(id);
    const reviewGuarantees = reviewSource !== undefined && idSet.has(reviewSource)
      ? new Set([reviewSource, ...(guaranteed.get(reviewSource) ?? [])])
      : new Set<string>();
    const parents = incoming.get(id)!;
    if (parents.length === 0) {
      guaranteed.set(id, reviewGuarantees);
      continue;
    }
    const releasePaths = parents.map(({ from }) => skippableIds.has(from)
      ? new Set<string>()
      : new Set([from, ...(guaranteed.get(from) ?? [])]));
    if (parents.every(({ mode }) => mode === "all")) {
      guaranteed.set(id, new Set([...reviewGuarantees, ...releasePaths.flatMap((path) => [...path])]));
      continue;
    }
    guaranteed.set(id, new Set([
      ...reviewGuarantees,
      ...[...releasePaths[0]].filter((candidate) => releasePaths.every((path) => path.has(candidate))),
    ]));
  }
  return guaranteed;
}

export const CollaborationTemplateDefinitionSchema = CollaborationTemplateDefinitionBaseSchema.superRefine(
  (definition, context) => {
    const inputIds = new Set(definition.inputs.map((input) => input.key));
    const roleIds = new Set(definition.roleSlots.map((role) => role.id));
    const nodeById = new Map(definition.nodes.map((node) => [node.id, node]));
    const nodeIds = new Set(nodeById.keys());
    const agentTasks = definition.nodes.filter((node): node is z.infer<typeof CollaborationAgentTaskNodeSchema> => node.kind === "agent_task");
    const outputProducer = new Map(agentTasks.map((node) => [node.output.key, node.id]));
    const guaranteedPredecessors = collaborationGuaranteedPredecessors(definition.nodes, definition.dependencies);

    const addDuplicateIssues = (values: readonly string[], path: (string | number)[], label: string) => {
      for (const value of duplicates(values)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path, message: `Duplicate ${label}: ${value}` });
      }
    };

    addDuplicateIssues(definition.inputs.map((input) => input.key), ["inputs"], "input key");
    addDuplicateIssues(definition.roleSlots.map((role) => role.id), ["roleSlots"], "role slot id");
    addDuplicateIssues(definition.nodes.map((node) => node.id), ["nodes"], "node id");
    addDuplicateIssues(agentTasks.map((node) => node.output.key), ["nodes"], "output key");
    addDuplicateIssues(definition.terminalNodeIds, ["terminalNodeIds"], "terminal node id");

    for (const [nodeIndex, node] of definition.nodes.entries()) {
      if (node.kind === "agent_task") {
        addDuplicateIssues(node.inputKeys, ["nodes", nodeIndex, "inputKeys"], "input key reference");
        addDuplicateIssues(node.upstreamArtifacts.map((artifact) => artifact.key), ["nodes", nodeIndex, "upstreamArtifacts"], "upstream artifact key");
        addDuplicateIssues(node.todos.map((todo) => todo.id), ["nodes", nodeIndex, "todos"], "Todo id");
        if (!node.todos.some((todo) => todo.required)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["nodes", nodeIndex, "todos"],
            message: "Every Agent task requires at least one required Todo",
          });
        }
        if (!roleIds.has(node.roleSlotId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["nodes", nodeIndex, "roleSlotId"],
            message: `Unknown role slot: ${node.roleSlotId}`,
          });
        }
        for (const [inputIndex, inputKey] of node.inputKeys.entries()) {
          if (!inputIds.has(inputKey)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["nodes", nodeIndex, "inputKeys", inputIndex],
              message: `Unknown input key: ${inputKey}`,
            });
          }
        }
      }
    }

    const outgoing = new Map<string, Set<string>>([...nodeIds].map((id) => [id, new Set()]));
    const incoming = new Map<string, { from: string; mode: "all" | "any" }[]>([...nodeIds].map((id) => [id, []]));
    const edgeIds = new Set<string>();
    for (const [edgeIndex, edge] of definition.dependencies.entries()) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dependencies", edgeIndex],
          message: `Dependency references an unknown node: ${edge.from}->${edge.to}`,
        });
        continue;
      }
      if (edge.from === edge.to) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["dependencies", edgeIndex], message: "A node cannot depend on itself" });
      }
      const edgeId = `${edge.from}\u0000${edge.to}`;
      if (edgeIds.has(edgeId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["dependencies", edgeIndex], message: `Duplicate dependency: ${edge.from}->${edge.to}` });
      }
      edgeIds.add(edgeId);
      outgoing.get(edge.from)?.add(edge.to);
      incoming.get(edge.to)?.push({ from: edge.from, mode: edge.mode });
    }

    for (const [nodeId, edges] of incoming) {
      if (new Set(edges.map((edge) => edge.mode)).size > 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dependencies"],
          message: `Incoming dependency modes cannot mix for node: ${nodeId}`,
        });
      }
    }

    const indegree = new Map([...incoming].map(([id, edges]) => [id, edges.length]));
    const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id).sort();
    let visited = 0;
    while (queue.length > 0) {
      const id = queue.shift()!;
      visited += 1;
      for (const next of [...(outgoing.get(id) ?? [])].sort()) {
        const count = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, count);
        if (count === 0) queue.push(next);
      }
      queue.sort();
    }
    if (visited !== nodeIds.size) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["dependencies"], message: "Dependency graph contains a cycle" });
    }

    const hasPath = (from: string, to: string): boolean => {
      if (from === to) return true;
      const pending = [from];
      const seen = new Set<string>(pending);
      while (pending.length > 0) {
        const current = pending.shift()!;
        for (const next of outgoing.get(current) ?? []) {
          if (next === to) return true;
          if (!seen.has(next)) {
            seen.add(next);
            pending.push(next);
          }
        }
      }
      return false;
    };

    for (const [terminalIndex, terminalId] of definition.terminalNodeIds.entries()) {
      if (!nodeIds.has(terminalId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["terminalNodeIds", terminalIndex], message: `Unknown terminal node: ${terminalId}` });
      } else if ((outgoing.get(terminalId)?.size ?? 0) > 0) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["terminalNodeIds", terminalIndex], message: `Terminal node has outgoing dependencies: ${terminalId}` });
      }
    }

    const validTerminals = definition.terminalNodeIds.filter((id) => nodeIds.has(id));
    for (const nodeId of nodeIds) {
      if (!validTerminals.some((terminalId) => hasPath(nodeId, terminalId))) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["nodes"], message: `Node cannot reach a terminal: ${nodeId}` });
      }
    }

    for (const [nodeIndex, node] of definition.nodes.entries()) {
      if (node.kind === "agent_task") {
        for (const [artifactIndex, artifact] of node.upstreamArtifacts.entries()) {
          const producerId = outputProducer.get(artifact.key);
          if (producerId === undefined || producerId === node.id || !hasPath(producerId, node.id)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["nodes", nodeIndex, "upstreamArtifacts", artifactIndex],
              message: `Upstream artifact is not produced by a reachable ancestor: ${artifact.key}`,
            });
            continue;
          }
          if (artifact.required && !guaranteedPredecessors.get(node.id)?.has(producerId)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["nodes", nodeIndex, "upstreamArtifacts", artifactIndex],
              message: `Required artifact is not guaranteed before the consumer becomes ready: ${artifact.key}`,
            });
          }
        }
      } else {
        const source = nodeById.get(node.artifactTaskId);
        if (source?.kind !== "agent_task") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["nodes", nodeIndex, "artifactTaskId"],
            message: `Review artifact source must be an Agent task: ${node.artifactTaskId}`,
          });
        }
        if (!incoming.get(node.id)?.some((edge) => edge.from === node.artifactTaskId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["nodes", nodeIndex, "artifactTaskId"],
            message: `Review requires a direct source edge from: ${node.artifactTaskId}`,
          });
        }
        const revisionTarget = nodeById.get(node.revisionTaskId);
        if (revisionTarget?.kind !== "agent_task" || !hasPath(node.revisionTaskId, node.artifactTaskId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["nodes", nodeIndex, "revisionTaskId"],
            message: `Review revision target must be the source task or its Agent-task ancestor: ${node.revisionTaskId}`,
          });
        }
      }
    }
  },
);

export const CollaborationJoinRunInputSchema = z.object({ runId: IdentifierSchema }).strict();
export const CollaborationNextActionInputSchema = z.object({
  runId: IdentifierSchema,
  idempotencyKey: WriteKeySchema,
  waitSeconds: z.number().int().min(0).max(COLLABORATION_LIMITS.longPollSeconds).optional(),
}).strict();
export const CollaborationHeartbeatInputSchema = z.object({
  runId: IdentifierSchema,
  attemptId: IdentifierSchema,
  leaseToken: LeaseTokenSchema,
  idempotencyKey: WriteKeySchema,
}).strict();

const EvidenceSchema = z.array(z.object({
  kind: IdentifierSchema,
  reference: z.string().trim().min(1).max(2_048),
}).strict()).max(50);

export const CollaborationUpdateTodoInputSchema = z.object({
  runId: IdentifierSchema,
  attemptId: IdentifierSchema,
  todoId: IdentifierSchema,
  leaseToken: LeaseTokenSchema,
  status: z.enum(["doing", "done", "failed"]),
  summary: z.string().max(4_000).optional(),
  evidence: EvidenceSchema.max(COLLABORATION_LIMITS.evidencePerTodo),
  idempotencyKey: WriteKeySchema,
}).strict();

const ExternalReferenceSchema = z.object({
  kind: z.enum(["workspace_path", "git_commit", "url"]),
  displayName: NameSchema,
  value: z.string().trim().min(1).max(4_096),
  version: z.string().max(256).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
}).strict().superRefine((reference, context) => {
  if ((reference.kind === "workspace_path" || reference.kind === "url") && reference.contentHash === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contentHash"],
      message: `${reference.kind} references require a contentHash`,
    });
  }
  if (reference.kind === "git_commit" && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(reference.value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "git_commit requires a full 40 or 64 character hash" });
  }
});

const BoundedJsonSchema = z.unknown().refine(isBoundedJson, {
  message: `JSON artifacts must be serializable, at most ${COLLABORATION_LIMITS.jsonBytes} bytes, and at most ${COLLABORATION_LIMITS.jsonDepth} levels deep`,
});

export const CollaborationArtifactInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("markdown"),
    markdown: z.string().refine((value) => utf8Bytes(value) <= COLLABORATION_LIMITS.markdownBytes, "Markdown artifact is too large"),
    evidence: EvidenceSchema,
  }).strict(),
  z.object({ kind: z.literal("json"), json: BoundedJsonSchema, evidence: EvidenceSchema }).strict(),
  z.object({ kind: z.literal("external_reference"), externalReference: ExternalReferenceSchema, evidence: EvidenceSchema }).strict(),
  z.object({
    kind: z.literal("evidence_summary"),
    summary: z.string().refine((value) => utf8Bytes(value) <= COLLABORATION_LIMITS.markdownBytes, "Evidence summary is too large"),
    evidence: EvidenceSchema,
  }).strict(),
]);

export const CollaborationSubmitResultInputSchema = z.object({
  runId: IdentifierSchema,
  attemptId: IdentifierSchema,
  leaseToken: LeaseTokenSchema,
  artifact: CollaborationArtifactInputSchema,
  idempotencyKey: WriteKeySchema,
}).strict();
export const CollaborationGetRunInputSchema = z.object({ runId: IdentifierSchema }).strict();

const RoleSlotSummarySchema = z.object({ id: IdentifierSchema, name: NameSchema }).strict();
const TodoViewSchema = z.object({
  id: IdentifierSchema,
  ordinal: z.number().int().min(0),
  name: NameSchema,
  required: z.boolean(),
  status: CollaborationTodoStatusSchema,
}).strict();
const AcceptedArtifactViewSchema = z.object({
  taskId: IdentifierSchema,
  version: z.number().int().min(1),
  kind: CollaborationArtifactKindSchema,
  payload: z.unknown(),
}).strict();
const AgentTaskViewSchema = z.object({
  id: IdentifierSchema,
  nodeId: IdentifierSchema,
  name: NameSchema,
  objective: z.string(),
  todos: z.array(TodoViewSchema),
  inputs: CollaborationInputValuesSchema,
  acceptedArtifacts: z.array(AcceptedArtifactViewSchema),
}).strict();

export const CollaborationJoinRunOutputSchema = z.object({
  runId: IdentifierSchema,
  status: CollaborationRunStatusSchema,
  roleSlots: z.array(RoleSlotSummarySchema),
  protocol: z.object({
    nextActionTool: z.literal("wiki_collaboration_next_action"),
    stopOn: z.array(z.enum(["waiting_human", "paused", "completed", "failed", "cancelled"])),
  }).strict(),
}).strict();

export const CollaborationNextActionOutputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("execute_task"),
    attemptId: IdentifierSchema,
    leaseToken: LeaseTokenSchema,
    leaseExpiresAt: z.string().datetime(),
    task: AgentTaskViewSchema,
  }).strict(),
  z.object({ action: z.literal("waiting_dependency"), retryAfterSeconds: z.number().int().min(1).max(60) }).strict(),
  z.object({ action: z.literal("waiting_human"), resumeRequired: z.literal(true), message: z.string() }).strict(),
  z.object({ action: z.literal("paused"), message: z.string() }).strict(),
  z.object({ action: z.literal("completed"), message: z.string() }).strict(),
  z.object({ action: z.literal("failed"), message: z.string() }).strict(),
  z.object({ action: z.literal("cancelled"), message: z.string() }).strict(),
]);

export const CollaborationHeartbeatOutputSchema = z.object({
  attemptId: IdentifierSchema,
  leaseExpiresAt: z.string().datetime(),
  replayed: z.boolean(),
}).strict();
export const CollaborationUpdateTodoOutputSchema = z.object({
  todo: TodoViewSchema,
  taskStatus: CollaborationTaskStatusSchema,
  replayed: z.boolean(),
}).strict();
export const CollaborationSubmitResultOutputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("submitted"),
    artifactId: IdentifierSchema,
    version: z.number().int().min(1),
    artifactStatus: CollaborationArtifactStatusSchema,
    taskStatus: CollaborationTaskStatusSchema,
    runStatus: CollaborationRunStatusSchema,
    replayed: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("repair_result"),
    issues: z.array(z.object({ code: IdentifierSchema, path: z.string(), message: z.string() }).strict()),
    repairsRemaining: z.number().int().min(0),
    replayed: z.boolean(),
  }).strict(),
]);
export const CollaborationGetRunOutputSchema = z.object({
  runId: IdentifierSchema,
  status: CollaborationRunStatusSchema,
  roleSlots: z.array(RoleSlotSummarySchema),
  assignedTasks: z.array(AgentTaskViewSchema),
  waitingReason: z.string().optional(),
}).strict();

export type CollaborationTemplateDefinition = z.infer<typeof CollaborationTemplateDefinitionSchema>;
export type CollaborationNode = z.infer<typeof CollaborationNodeSchema>;
export type CollaborationRunStatus = z.infer<typeof CollaborationRunStatusSchema>;
export type CollaborationTaskStatus = z.infer<typeof CollaborationTaskStatusSchema>;
export type CollaborationArtifactInput = z.infer<typeof CollaborationArtifactInputSchema>;
export type CollaborationInputValues = z.infer<typeof CollaborationInputValuesSchema>;
export type CollaborationJoinRunInput = z.infer<typeof CollaborationJoinRunInputSchema>;
export type CollaborationNextActionInput = z.infer<typeof CollaborationNextActionInputSchema>;
export type CollaborationHeartbeatInput = z.infer<typeof CollaborationHeartbeatInputSchema>;
export type CollaborationUpdateTodoInput = z.infer<typeof CollaborationUpdateTodoInputSchema>;
export type CollaborationSubmitResultInput = z.infer<typeof CollaborationSubmitResultInputSchema>;
export type CollaborationGetRunInput = z.infer<typeof CollaborationGetRunInputSchema>;
