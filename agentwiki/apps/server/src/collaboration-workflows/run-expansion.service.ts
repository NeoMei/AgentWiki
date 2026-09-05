import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CollaborationTemplateDefinitionSchema,
  type CollaborationTemplateDefinition,
} from '@neomei/agentwiki-sync-protocol';
import type { Principal } from '../core/authorization/authorization.service';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { ContentTreeService } from '../content-tree/content-tree.service';
import { ContentTreeConflict } from '../content-tree/content-tree.types';
import { PrismaService } from '../database/prisma.service';
import type { RunPageSelectionBinding } from '../page-templates/run-page-selection';
import { resolveParticipants } from '../page-templates/run-page-selection';
import { reviewerMemberIssues } from './reviewer-members';
import { hashCollaborationTemplate } from './template-validator';
import { CollaborationEventsService } from './collaboration-events.service';
import { canonicalRequestHash, RunEventStore } from './run-event.store';
import { withCollaborationSerializableRetry } from './serializable-retry';
import { assertCollaborationAgentsReady } from './agent-readiness';
import { parseCollaborationInputs } from './run-input-validation';
import { canonicalPageContentHash } from './page-baseline';

type Tx = Prisma.TransactionClient;

export type RunExpansionSource =
  | { kind: 'legacy'; templateId: string; templateVersion: number }
  | {
    kind: 'composite';
    compositeTemplateVersionId: string;
    templateInstantiationId: string | null;
    templateVersion: number;
  }
  | { kind: 'page_selection'; templateVersion: number };

export type CreateStartedRunInput = {
  spaceId: string;
  name: string;
  source: RunExpansionSource;
  definition: CollaborationTemplateDefinition;
  inputs: Record<string, unknown>;
  bindings: RunPageSelectionBinding[];
  taskPageIds: Record<string, string>;
};

@Injectable()
export class RunExpansionService {
  private readonly logger = new Logger(RunExpansionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly contentTree: ContentTreeService,
    private readonly notifications: CollaborationEventsService,
    private readonly events: RunEventStore,
  ) {}

  async createPageSelection(
    input: {
      spaceId: string;
      name: string;
      pageIds: string[];
      expectedTreeRevision: bigint;
      idempotencyKey: string;
    },
    principal: Principal,
  ): Promise<string> {
    if (input.pageIds.length !== 1 || new Set(input.pageIds).size !== 1 || !input.pageIds[0]?.trim()) {
      throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', 'Page selection requires exactly one Page');
    }
    const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
    const operation = 'create_page_selection';
    const target = `${input.spaceId}:page-selection`;
    const requestHash = canonicalRequestHash({
      spaceId: input.spaceId,
      name: input.name.trim(),
      pageIds: input.pageIds,
    });
    const receipt = await withCollaborationSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      const lockedTx = await this.contentTree.lockPageMutationSpace(
        tx, input.spaceId,
      );
      await this.authorization.assertLiveHumanSpaceAccess(
        lockedTx, principal, input.spaceId, ['owner', 'editor'],
      );
      const existing = await lockedTx.collaborationRunEvent.findFirst({
        where: {
          run: { spaceId: input.spaceId },
          actorKind: 'human',
          actorId: principal.userId,
          operation,
          idempotencyKey,
        },
        select: { runId: true },
        orderBy: { createdAt: 'asc' },
      });
      if (existing) {
        return this.events.findReplay<{ runId: string }>(lockedTx, {
          runId: existing.runId,
          actorKind: 'human',
          actorId: principal.userId,
          actorUserId: principal.userId,
          operation,
          target,
          key: idempotencyKey,
          requestHash,
        });
      }
      if (lockedTx.contentTreeRevision !== input.expectedTreeRevision) {
        throw new ContentTreeConflict(input.expectedTreeRevision, lockedTx.contentTreeRevision);
      }
      const pages = await lockedTx.page.findMany({
        where: { id: { in: input.pageIds }, spaceId: input.spaceId, deletedAt: null },
        select: { id: true },
      });
      const bindings = await lockedTx.pageAgentBinding.findMany({
        where: { spaceId: input.spaceId, pageId: { in: input.pageIds } },
        select: { pageId: true, agentId: true, roleSlotKey: true },
      });
      if (pages.length !== 1 || bindings.length !== 1) {
        throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', 'The selected Page needs one current Agent binding');
      }
      const binding = bindings[0];
      const roleSlotId = binding.roleSlotKey ?? 'writer';
      const runId = await this.createStarted(lockedTx, {
        spaceId: input.spaceId,
        name: input.name,
        source: { kind: 'page_selection', templateVersion: 1 },
        definition: createSinglePageWorkflow(roleSlotId),
        inputs: {},
        bindings: [{
          kind: 'task_default', nodeId: 'write-page', roleSlotId, agentId: binding.agentId,
        }],
        taskPageIds: { 'write-page': pages[0].id },
      }, principal);
      return this.events.executeIdempotent(lockedTx, {
        runId,
        actorKind: 'human',
        actorId: principal.userId,
        actorUserId: principal.userId,
        operation,
        target,
        key: idempotencyKey,
        requestHash,
        metadata: { pageIds: input.pageIds },
      }, async () => ({ runId }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    if (!receipt) throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT');
    try {
      await this.notifications.publishCurrentRun(receipt.runId);
    } catch {
      this.logger.warn({ code: 'COLLABORATION_NOTIFICATION_FAILED', runId: receipt.runId });
    }
    return receipt.runId;
  }

  async createStarted(tx: Tx, input: CreateStartedRunInput, principal: Principal): Promise<string> {
    if (principal.agentId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    const definition = parseDefinition(input.definition);
    const values = parseCollaborationInputs(definition, input.inputs);
    const tasks = definition.nodes.filter((node) => node.kind === 'agent_task');
    const participants = resolveParticipants(
      tasks.map((task) => ({ nodeId: task.id, roleSlotId: task.roleSlotId, enabled: true })),
      input.bindings,
    );
    if (participants.issues.length > 0) {
      throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues: participants.issues });
    }
    await assertReviewerMembers(tx, input.spaceId, definition);
    await assertCollaborationAgentsReady(tx, input.spaceId, participants.agentIds);
    const pageBaselines = await loadPageBaselines(tx, input.spaceId, tasks, input.taskPageIds);
    const snapshot = structuredClone(definition);
    const run = await tx.collaborationRun.create({ data: {
      spaceId: input.spaceId,
      sourceKind: input.source.kind,
      templateId: input.source.kind === 'legacy' ? input.source.templateId : null,
      compositeTemplateVersionId: input.source.kind === 'composite'
        ? input.source.compositeTemplateVersionId : null,
      templateInstantiationId: input.source.kind === 'composite'
        ? input.source.templateInstantiationId : null,
      templateVersion: input.source.templateVersion,
      templateSnapshot: toJson(snapshot),
      snapshotHash: hashCollaborationTemplate(snapshot),
      name: input.name.trim(),
      status: 'running',
      version: 1,
      inputs: toJson(values),
      startedById: principal.userId,
      startedAt: new Date(),
    } });
    const assignments = new Map(participants.assignments.map((item) => [item.nodeId, item]));
    const roleSlots = new Map(definition.roleSlots.map((slot) => [slot.id, slot]));
    const usedRoles = [...new Set(participants.assignments.map((item) => item.roleSlotId))];
    if (usedRoles.length > 0) {
      await tx.collaborationRoleBinding.createMany({ data: usedRoles.map((roleSlotId) => {
        const assignment = participants.assignments.find((item) => item.roleSlotId === roleSlotId)!;
        return {
          runId: run.id,
          roleSlotId,
          roleSlotName: roleSlots.get(roleSlotId)!.name,
          agentId: assignment.agentId,
        };
      }) });
    }
    await this.expand(tx, run.id, definition, assignments, pageBaselines);
    return run.id;
  }

  async expand(
    tx: Tx,
    runId: string,
    definition: CollaborationTemplateDefinition,
    assignments: ReadonlyMap<string, { agentId: string }>,
    pageBaselines: ReadonlyMap<string, PageBaseline> = new Map(),
  ): Promise<void> {
    const incoming = new Set(definition.dependencies.map((dependency) => dependency.to));
    const taskNodes = definition.nodes.filter((node) => node.kind === 'agent_task');
    const tasks = taskNodes.map((node, ordinal) => {
      const baseline = pageBaselines.get(node.id);
      return {
        id: randomUUID(),
        runId,
        nodeId: node.id,
        ordinal,
        name: node.name,
        objective: node.objective,
        roleSlotId: node.roleSlotId,
        assigneeAgentId: assignments.get(node.id)!.agentId,
        status: incoming.has(node.id) ? 'blocked' as const : 'ready' as const,
        generation: 1,
        dependencyMode: dependencyModeFor(definition, node.id),
        outputContract: toJson(node.output),
        requiredEvidence: toJson(node.evidenceRequired),
        humanAcceptance: node.humanAcceptance,
        skippable: node.skippable,
        leaseSeconds: node.leaseSeconds,
        maxExecutionSeconds: node.maxExecutionSeconds,
        retryBudget: node.retryBudget,
        repairBudget: node.repairBudget,
        targetPageId: baseline?.pageId ?? null,
        targetSpaceId: baseline ? baseline.spaceId : null,
        basePageVersionId: baseline?.pageVersionId ?? null,
        basePageUpdatedAt: baseline?.updatedAt ?? null,
        baseContentHash: baseline?.contentHash ?? null,
      };
    });
    if (tasks.length > 0) await tx.collaborationRunTask.createMany({ data: tasks });
    const taskByNode = new Map(tasks.map((task) => [task.nodeId, task]));
    const todos = taskNodes.flatMap((node) => node.todos.map((todo, ordinal) => ({
      runId,
      taskId: taskByNode.get(node.id)!.id,
      generation: 1,
      templateId: todo.id,
      ordinal,
      name: todo.name,
      required: todo.required,
      status: 'pending' as const,
    })));
    if (todos.length > 0) await tx.collaborationTaskTodo.createMany({ data: todos });
    if (definition.dependencies.length > 0) {
      await tx.collaborationTaskDependency.createMany({ data: definition.dependencies.map((dependency) => ({
        runId,
        fromNodeId: dependency.from,
        toNodeId: dependency.to,
        mode: dependency.mode,
      })) });
    }
  }
}

export function createSinglePageWorkflow(roleSlotId: string): CollaborationTemplateDefinition {
  return CollaborationTemplateDefinitionSchema.parse({
    schemaVersion: 1,
    inputs: [],
    roleSlots: [{
      id: roleSlotId,
      name: roleSlotId === 'writer' ? 'Writer' : roleSlotId,
      required: true,
      description: 'Writes the target Page',
    }],
    nodes: [
      {
        kind: 'agent_task', id: 'write-page', name: 'Write Page', roleSlotId,
        objective: 'Produce the complete Markdown content for the target Page',
        inputKeys: [], upstreamArtifacts: [], output: { key: 'page-markdown', kind: 'markdown' },
        evidenceRequired: [], humanAcceptance: true, leaseSeconds: 300, maxExecutionSeconds: 3_600,
        retryBudget: 1, repairBudget: 1, skippable: false,
        todos: [{ id: 'write', name: 'Write the target Page', required: true, evidenceKinds: [] }],
      },
      {
        kind: 'human_review', id: 'review-page', name: 'Review Page', artifactTaskId: 'write-page',
        minimumRole: 'editor', reviewerUserIds: [],
        approvalCriteria: ['The Markdown is complete and suitable for the target Page'],
        revisionTaskId: 'write-page', allowTerminate: true,
      },
    ],
    dependencies: [{ from: 'write-page', to: 'review-page', mode: 'all' }],
    terminalNodeIds: ['review-page'],
  });
}

type PageBaseline = {
  pageId: string;
  spaceId: string;
  pageVersionId: string | null;
  updatedAt: Date;
  contentHash: string;
};

async function loadPageBaselines(
  tx: Tx,
  spaceId: string,
  tasks: readonly { id: string }[],
  taskPageIds: Record<string, string>,
): Promise<Map<string, PageBaseline>> {
  const taskIds = new Set(tasks.map((task) => task.id));
  if (Object.keys(taskPageIds).some((taskId) => !taskIds.has(taskId))) {
    throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', 'A Page target references an unknown task');
  }
  const pageIds = [...new Set(Object.values(taskPageIds))];
  const pages = pageIds.length > 0 ? await tx.page.findMany({
    where: { id: { in: pageIds }, spaceId, deletedAt: null },
    select: { id: true, spaceId: true, title: true, content: true, updatedAt: true },
  }) : [];
  const pageById = new Map(pages.map((page) => [page.id, page]));
  if (pageById.size !== pageIds.length) throw new BusinessException('RESOURCE_NOT_FOUND');
  const baselines = new Map<string, PageBaseline>();
  for (const [taskId, pageId] of Object.entries(taskPageIds)) {
    const page = pageById.get(pageId)!;
    const version = await tx.pageVersion.findFirst({
      where: { pageId, title: page.title, content: page.content },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    baselines.set(taskId, {
      pageId,
      spaceId,
      pageVersionId: version?.id ?? null,
      updatedAt: page.updatedAt,
      contentHash: canonicalPageContentHash(page.content),
    });
  }
  return baselines;
}

async function assertReviewerMembers(tx: Tx, spaceId: string, definition: CollaborationTemplateDefinition): Promise<void> {
  const issues = await reviewerMemberIssues(tx, spaceId, definition);
  if (issues.length > 0) throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues });
}

function parseDefinition(value: unknown): CollaborationTemplateDefinition {
  const parsed = CollaborationTemplateDefinitionSchema.safeParse(value);
  if (!parsed.success) throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues: parsed.error.issues });
  return parsed.data;
}

function dependencyModeFor(definition: CollaborationTemplateDefinition, nodeId: string): 'all' | 'any' {
  return definition.dependencies.find((dependency) => dependency.to === nodeId)?.mode ?? 'all';
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}

function normalizeIdempotencyKey(value: string): string {
  if (typeof value !== 'string') throw new BusinessException('COLLABORATION_TEMPLATE_INVALID');
  const normalized = value.normalize('NFC').trim();
  if (normalized.length < 1 || normalized.length > 128) {
    throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', 'Idempotency key must contain 1 through 128 characters');
  }
  return normalized;
}
