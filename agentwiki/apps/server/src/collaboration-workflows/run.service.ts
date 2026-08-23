import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CollaborationInputValuesSchema,
  CollaborationTemplateDefinitionSchema,
  agentRoleAllowsScope,
  type CollaborationTemplateDefinition,
} from '@neomei/agentwiki-sync-protocol';
import { AuthorizationService, type Principal, type SpaceRole } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';
import type {
  CreateRunDraftDto,
  ReassignTaskDto,
  RunActionDto,
  StartRunDto,
  UpdateRunDraftDto,
  ValidateRunDraftDto,
} from './run.dto';
import { canonicalRequestHash, RunEventStore } from './run-event.store';
import { hashCollaborationTemplate } from './template-validator';
import { ProgressionService } from './progression.service';
import { CollaborationEventsService } from './collaboration-events.service';
import { HISTORY_KINDS, HistoryCursorService, type HistoryKind, type HistoryPosition, type RunListStatus } from './history-cursor.service';

const READ_ROLES: SpaceRole[] = ['owner', 'admin', 'editor', 'viewer'];
const EDIT_ROLES: SpaceRole[] = ['owner', 'admin', 'editor'];
const MANAGE_ROLES: SpaceRole[] = ['owner', 'admin'];
const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;
type RoleBindingInput = { roleSlotId: string; agentId: string };
type Tx = Prisma.TransactionClient;

const HUMAN_TODO_DETAIL_SELECT = {
  id: true, runId: true, taskId: true, generation: true, templateId: true, ordinal: true,
  name: true, required: true, status: true, summary: true, evidence: true, createdAt: true, updatedAt: true,
} satisfies Prisma.CollaborationTaskTodoSelect;

const HUMAN_TODO_PREVIEW_SELECT = {
  id: true, taskId: true, generation: true, ordinal: true, name: true, required: true, status: true,
} satisfies Prisma.CollaborationTaskTodoSelect;

const HUMAN_ATTEMPT_SELECT = {
  id: true, runId: true, taskId: true, generation: true, agentId: true, attemptNumber: true,
  status: true, leaseStartedAt: true, leaseExpiresAt: true, maxExecutionAt: true,
  failureCode: true, repairCount: true, finishedAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.CollaborationTaskAttemptSelect;

const HUMAN_ARTIFACT_DETAIL_SELECT = {
  id: true, runId: true, taskId: true, attemptId: true, generation: true, version: true,
  kind: true, status: true, payload: true, evidence: true, acceptedAt: true, createdAt: true,
} satisfies Prisma.CollaborationTaskArtifactSelect;

const HUMAN_ARTIFACT_PREVIEW_SELECT = {
  id: true, taskId: true, generation: true, version: true, kind: true, status: true, createdAt: true,
} satisfies Prisma.CollaborationTaskArtifactSelect;

const HUMAN_REVIEW_DETAIL_SELECT = {
  id: true, runId: true, nodeId: true, revision: true, generation: true, sourceTaskId: true,
  artifactId: true, revisionTaskId: true, minimumRole: true, reviewerUserIds: true,
  allowTerminate: true, status: true, reviewerUserId: true, reason: true, decidedAt: true,
  createdAt: true,
} satisfies Prisma.CollaborationReviewSelect;

const HUMAN_REVIEW_PREVIEW_SELECT = {
  id: true, nodeId: true, generation: true, sourceTaskId: true, artifactId: true, revisionTaskId: true,
  minimumRole: true, reviewerUserIds: true, allowTerminate: true, status: true, createdAt: true,
} satisfies Prisma.CollaborationReviewSelect;

const HUMAN_EVENT_DETAIL_SELECT = {
  id: true, runId: true, sequence: true, type: true, actorKind: true, actorId: true,
  operation: true, target: true, actorUserId: true, actorAgentId: true, metadata: true,
  createdAt: true,
} satisfies Prisma.CollaborationRunEventSelect;

const HUMAN_EVENT_PREVIEW_SELECT = {
  id: true, sequence: true, type: true, actorKind: true, operation: true, target: true, createdAt: true,
} satisfies Prisma.CollaborationRunEventSelect;

const HUMAN_RUN_MAX_SERIALIZED_BYTES = 512_000;
const HUMAN_HISTORY_MAX_SERIALIZED_BYTES = 4_000_000;
const HUMAN_TODO_PREVIEW_LIMIT = 3;
const HUMAN_EVENT_PREVIEW_LIMIT = 20;
const ACTIVE_RUN_STATUSES = ['draft', 'ready', 'running', 'waiting_review', 'paused'] as const;
const HISTORY_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;

const HUMAN_RUN_SUMMARY_SELECT = {
  id: true, name: true, status: true, templateId: true, templateVersion: true,
  createdAt: true, updatedAt: true, startedAt: true, finishedAt: true,
} satisfies Prisma.CollaborationRunSelect;

const HUMAN_RUN_SELECT = {
  id: true,
  spaceId: true,
  templateId: true,
  templateVersion: true,
  snapshotHash: true,
  name: true,
  status: true,
  version: true,
  startedById: true,
  pauseReason: true,
  eventSequence: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
  roleBindings: {
    select: { id: true, runId: true, roleSlotId: true, roleSlotName: true, agentId: true },
  },
  tasks: {
    orderBy: { ordinal: 'asc' },
    select: {
      id: true,
      runId: true,
      nodeId: true,
      ordinal: true,
      name: true,
      objective: true,
      roleSlotId: true,
      assigneeAgentId: true,
      status: true,
      generation: true,
      dependencyMode: true,
      skippable: true,
      nextAttemptAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.CollaborationRunSelect;

@Injectable()
export class RunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly events: RunEventStore,
    private readonly progression: ProgressionService,
    private readonly notifications: CollaborationEventsService,
    private readonly historyCursors: HistoryCursorService,
  ) {}

  async createDraft(spaceId: string, body: CreateRunDraftDto, principal: Principal) {
    if (principal.agentId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    const receipt = await this.prisma.$transaction(async (tx) => {
      await this.assertLiveHumanAccess(tx, principal, spaceId, EDIT_ROLES);
      const template = await this.loadTemplate(tx, spaceId, body.templateId);
      const definition = parseDefinition(template.definition);
      const inputs = this.parseInputs(definition, body.inputs);
      const bindings = this.normalizeBindings(definition, body.roleBindings, true);
      const run = await tx.collaborationRun.create({
        data: {
          spaceId,
          templateId: template.id,
          templateVersion: template.version,
          templateSnapshot: toJson({}),
          snapshotHash: hashJson({}),
          name: body.name.trim(),
          status: 'draft',
          version: 1,
          inputs: toJson(inputs),
          startedById: principal.userId,
        },
      });
      if (bindings.length > 0) {
        await tx.collaborationRoleBinding.createMany({
          data: bindings.map((binding) => ({ runId: run.id, ...binding })),
        });
      }
      return { runId: run.id, status: run.status, version: run.version };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.notifications.publishCurrentRun(receipt.runId);
    return this.loadHumanRun(this.prisma as unknown as Tx, receipt.runId);
  }

  async updateDraft(spaceId: string, runId: string, body: UpdateRunDraftDto, principal: Principal) {
    if (principal.agentId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    await this.prisma.$transaction(async (tx) => {
      await this.assertLiveHumanAccess(tx, principal, spaceId, EDIT_ROLES);
      const current = await tx.collaborationRun.findFirst({
        where: { id: runId, spaceId, status: { in: ['draft', 'ready'] }, version: body.expectedVersion },
      });
      if (!current) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
      const template = await this.loadTemplate(tx, spaceId, current.templateId);
      const definition = parseDefinition(template.definition);
      const inputs = body.inputs === undefined ? undefined : this.parseInputs(definition, body.inputs);
      if (body.roleBindings) {
        const bindings = this.normalizeBindings(definition, body.roleBindings);
        await tx.collaborationRoleBinding.deleteMany({ where: { runId } });
        await tx.collaborationRoleBinding.createMany({
          data: bindings.map((binding) => ({ runId, ...binding })),
        });
      }
      const updated = await tx.collaborationRun.updateMany({
        where: { id: runId, spaceId, status: { in: ['draft', 'ready'] }, version: body.expectedVersion },
        data: {
          status: 'draft',
          ...(body.name === undefined ? {} : { name: body.name.trim() }),
          ...(inputs === undefined ? {} : { inputs: toJson(inputs) }),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
      return { runId, status: 'draft' as const, version: body.expectedVersion + 1 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.notifications.publishCurrentRun(runId);
    return this.loadHumanRun(this.prisma as unknown as Tx, runId);
  }

  async validateDraft(
    spaceId: string,
    runId: string,
    body: ValidateRunDraftDto,
    principal: Principal,
  ) {
    if (principal.agentId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    await this.prisma.$transaction(async (tx) => {
      await this.assertLiveHumanAccess(tx, principal, spaceId, EDIT_ROLES);
      const run = await tx.collaborationRun.findFirst({
        where: { id: runId, spaceId, status: 'draft', version: body.expectedVersion },
      });
      if (!run) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
      const template = await this.loadTemplate(tx, spaceId, run.templateId);
      const definition = parseDefinition(template.definition);
      const bindings = await this.loadBindings(tx, runId, run);
      this.parseInputs(definition, run.inputs);
      this.normalizeBindings(definition, bindings);
      await this.validateFreshAgents(tx, spaceId, bindings.map((binding) => binding.agentId));
      const updated = await tx.collaborationRun.updateMany({
        where: { id: runId, spaceId, status: 'draft', version: body.expectedVersion },
        data: { status: 'ready', version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
      return { runId, status: 'ready' as const, version: body.expectedVersion + 1 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.notifications.publishCurrentRun(runId);
    return this.loadHumanRun(this.prisma as unknown as Tx, runId);
  }

  async startRun(spaceId: string, runId: string, body: StartRunDto, principal: Principal) {
    if (principal.agentId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    await this.prisma.$transaction(async (tx) => {
      await this.assertLiveHumanAccess(tx, principal, spaceId, EDIT_ROLES);
      const scopedRun = await tx.collaborationRun.findFirst({
        where: { id: runId, spaceId },
        select: { id: true },
      });
      if (!scopedRun) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
      return this.events.executeIdempotent(tx, {
        runId,
        actorKind: 'human',
        actorId: principal.userId,
        actorUserId: principal.userId,
        operation: 'start_run',
        target: runId,
        key: body.idempotencyKey,
        requestHash: canonicalRequestHash({ expectedVersion: body.expectedVersion }),
      }, async () => {
        const run = await tx.collaborationRun.findFirst({
          where: { id: runId, spaceId, status: 'ready', version: body.expectedVersion },
        });
        if (!run) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
        const template = await this.loadTemplate(tx, spaceId, run.templateId);
        const definition = parseDefinition(template.definition);
        const bindings = await this.loadBindings(tx, runId, run);
        this.parseInputs(definition, run.inputs);
        this.normalizeBindings(definition, bindings);
        await this.validateFreshAgents(tx, spaceId, bindings.map((binding) => binding.agentId));
        const snapshot = structuredClone(definition);
        const updated = await tx.collaborationRun.update({
          where: { id: runId },
          data: {
            templateVersion: template.version,
            templateSnapshot: toJson(snapshot),
            snapshotHash: hashCollaborationTemplate(snapshot),
            status: 'running',
            startedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await this.expandRun(tx, runId, definition, bindings);
        return { runId, status: updated.status, version: updated.version };
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.notifications.publishCurrentRun(runId);
    return this.loadHumanRun(this.prisma as unknown as Tx, runId);
  }

  async listRuns(
    spaceId: string,
    status: string,
    cursor: string | undefined,
    limit: string | undefined,
    principal: Principal,
  ) {
    await this.assertHumanAccess(principal, spaceId, READ_ROLES);
    const listStatus = parseRunListStatus(status);
    const pageSize = parseRunListLimit(limit ?? '100');
    const position = cursor ? this.historyCursors.decodeRunList(cursor, spaceId, listStatus) : undefined;
    const statusValues = listStatus === 'active' ? ACTIVE_RUN_STATUSES : HISTORY_RUN_STATUSES;
    const rows = await this.prisma.collaborationRun.findMany({
      where: {
        spaceId,
        status: { in: [...statusValues] },
        ...(position ? timestampKeyset('createdAt', position) : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
      select: HUMAN_RUN_SUMMARY_SELECT,
    });
    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize).map(runSummary);
    const last = hasMore ? items[items.length - 1] : undefined;
    const nextCursor = last
      ? this.historyCursors.encodeRunList({
        spaceId, status: listStatus, position: { at: new Date(last.createdAt).toISOString(), id: last.id },
      })
      : null;
    return { items, nextCursor };
  }

  async getHumanRun(spaceId: string, runId: string, principal: Principal) {
    await this.assertHumanAccess(principal, spaceId, READ_ROLES);
    const run = await this.prisma.collaborationRun.findFirst({ where: { id: runId, spaceId } });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
    return this.loadHumanRun(this.prisma as unknown as Tx, runId);
  }

  async getHumanRunDraftDetails(spaceId: string, runId: string, principal: Principal) {
    await this.assertHumanAccess(principal, spaceId, READ_ROLES);
    const run = await this.prisma.collaborationRun.findFirst({
      where: { id: runId, spaceId, status: { in: ['draft', 'ready'] } },
      select: {
        id: true, name: true, status: true, version: true, inputs: true, updatedAt: true,
        roleBindings: { select: { roleSlotId: true, roleSlotName: true, agentId: true } },
      },
    });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration draft not found');
    return run;
  }

  async getHumanRunHistory(
    spaceId: string,
    runId: string,
    kind: string,
    cursor: string | undefined,
    limit: string | undefined,
    principal: Principal,
  ) {
    await this.assertHumanAccess(principal, spaceId, READ_ROLES);
    const run = await this.prisma.collaborationRun.findFirst({
      where: { id: runId, spaceId },
      select: { id: true },
    });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
    const historyKind = parseHistoryKind(kind);
    const pageSize = parseHistoryLimit(limit ?? '50');
    const position = cursor ? this.historyCursors.decode(cursor, historyKind, runId) : undefined;
    let rows: any[];
    if (historyKind === 'events') {
      const sequence = position && 'sequence' in position ? position.sequence : undefined;
      rows = await this.prisma.collaborationRunEvent.findMany({
        where: { runId, ...(sequence === undefined ? {} : { sequence: { lt: sequence } }) },
        orderBy: { sequence: 'desc' },
        take: pageSize + 1,
        select: HUMAN_EVENT_DETAIL_SELECT,
      });
    } else {
      const timestampPosition = position && 'at' in position ? position : undefined;
      const timestampField = 'createdAt';
      const timestampWhere = timestampPosition
        ? timestampKeyset(timestampField, timestampPosition)
        : {};
      const query = {
        where: { runId, ...timestampWhere },
        orderBy: [{ [timestampField]: 'desc' as const }, { id: 'desc' as const }],
        take: pageSize + 1,
      };
      if (historyKind === 'todos') {
        rows = await this.prisma.collaborationTaskTodo.findMany({ ...query, select: HUMAN_TODO_DETAIL_SELECT } as any);
      } else if (historyKind === 'attempts') {
        rows = await this.prisma.collaborationTaskAttempt.findMany({ ...query, select: HUMAN_ATTEMPT_SELECT } as any);
      } else if (historyKind === 'artifacts') {
        rows = await this.prisma.collaborationTaskArtifact.findMany({ ...query, select: HUMAN_ARTIFACT_DETAIL_SELECT } as any);
      } else {
        rows = await this.prisma.collaborationReview.findMany({ ...query, select: HUMAN_REVIEW_DETAIL_SELECT } as any);
      }
    }
    const hasMore = rows.length > pageSize;
    const items = rows.slice(0, pageSize);
    let nextCursor: string | null = null;
    if (hasMore && items.length) {
      const last = items[items.length - 1]!;
      const nextPosition: HistoryPosition = historyKind === 'events'
        ? { sequence: last.sequence }
        : { at: new Date(last.createdAt).toISOString(), id: last.id };
      nextCursor = this.historyCursors.encode({ kind: historyKind, runId, position: nextPosition });
    }
    const page = { items, nextCursor };
    if (Buffer.byteLength(JSON.stringify(page), 'utf8') > HUMAN_HISTORY_MAX_SERIALIZED_BYTES) {
      throw new BusinessException('COLLABORATION_HISTORY_PAGE_TOO_LARGE', 'Reduce the History page limit');
    }
    return page;
  }

  pauseRun(runId: string, body: RunActionDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'pause_run', body, principal, false, async (tx, run) => {
      if (!['running', 'waiting_review'].includes(run.status)) throw this.runStateError(run.status);
      await this.invalidateAttempts(tx, runId, body.reason);
      await tx.collaborationRunTask.updateMany({
        where: { runId, status: { in: ['claimed', 'running'] } },
        data: { status: 'ready', nextAttemptAt: null },
      });
      await tx.collaborationRun.update({ where: { id: runId }, data: { status: 'paused', pauseReason: body.reason } });
    }, runId, expectedSpaceId);
  }

  resumeRun(runId: string, body: RunActionDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'resume_run', body, principal, false, async (tx, run) => {
      if (run.status !== 'paused') throw this.runStateError(run.status);
      await tx.collaborationRun.update({ where: { id: runId }, data: { status: 'running', pauseReason: null } });
      await this.progression.advanceRun(tx, runId, `human-resume:${body.idempotencyKey}`, false);
    }, runId, expectedSpaceId);
  }

  failRun(runId: string, body: RunActionDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'fail_run', body, principal, true, async (tx, run) => {
      this.assertNotTerminal(run.status);
      await this.invalidateAttempts(tx, runId, body.reason);
      await tx.collaborationRun.update({ where: { id: runId }, data: { status: 'failed', finishedAt: new Date() } });
    }, runId, expectedSpaceId);
  }

  cancelRun(runId: string, body: RunActionDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'cancel_run', body, principal, true, async (tx, run) => {
      this.assertNotTerminal(run.status);
      await this.invalidateAttempts(tx, runId, body.reason);
      await tx.collaborationRun.update({ where: { id: runId }, data: { status: 'cancelled', finishedAt: new Date() } });
    }, runId, expectedSpaceId);
  }

  retryTask(runId: string, taskId: string, body: RunActionDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'retry_task', body, principal, false, async (tx, run) => {
      this.assertNotTerminal(run.status);
      const task = await tx.collaborationRunTask.findFirst({ where: { id: taskId, runId } });
      if (!task) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration task not found');
      if (!['failed', 'retry_wait'].includes(task.status)) {
        throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Only failed or waiting-retry tasks can be retried');
      }
      await this.invalidateAttempts(tx, runId, body.reason, taskId);
      const generation = task.generation + 1;
      await tx.collaborationRunTask.update({
        where: { id: taskId },
        data: { status: 'ready', generation, nextAttemptAt: null, completedAt: null },
      });
      await tx.collaborationTaskArtifact.updateMany({
        where: { runId, taskId, generation: task.generation, status: { in: ['pending', 'accepted'] } },
        data: { status: 'superseded' },
      });
      const node = snapshotNodes(run.templateSnapshot).find((item) => item.kind === 'agent_task' && item.id === task.nodeId);
      if (!node || node.kind !== 'agent_task') throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT');
      await tx.collaborationTaskTodo.createMany({
        data: node.todos.map((todo: any, ordinal: number) => ({
          runId,
          taskId,
          generation,
          templateId: todo.id,
          ordinal,
          name: todo.name,
          required: todo.required,
          status: 'pending',
        })),
      });
      await tx.collaborationRun.update({ where: { id: runId }, data: { status: 'running', pauseReason: null } });
      await this.progression.advanceRun(tx, runId, `human-retry:${body.idempotencyKey}`, false);
    }, taskId, expectedSpaceId);
  }

  reassignTask(runId: string, taskId: string, body: ReassignTaskDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'reassign_task', body, principal, false, async (tx, run) => {
      this.assertNotTerminal(run.status);
      const task = await tx.collaborationRunTask.findFirst({ where: { id: taskId, runId } });
      if (!task) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration task not found');
      if (['submitted', 'completed', 'skipped'].includes(task.status)) {
        throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'This task can no longer be reassigned');
      }
      await this.validateFreshAgents(tx, run.spaceId, [body.agentId]);
      await this.invalidateAttempts(tx, runId, body.reason, taskId);
      const active = ['claimed', 'running'].includes(task.status);
      await tx.collaborationRunTask.update({
        where: { id: taskId },
        data: {
          assigneeAgentId: body.agentId,
          ...(active ? { status: 'ready', nextAttemptAt: null } : {}),
        },
      });
    }, taskId, expectedSpaceId);
  }

  skipTask(runId: string, taskId: string, body: RunActionDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'skip_task', body, principal, true, async (tx, run) => {
      this.assertNotTerminal(run.status);
      const task = await tx.collaborationRunTask.findFirst({ where: { id: taskId, runId } });
      if (!task) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration task not found');
      if (!task.skippable) throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'This task is not skippable');
      if (['submitted', 'completed', 'skipped'].includes(task.status)) {
        throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'This task can no longer be skipped');
      }
      await this.invalidateAttempts(tx, runId, body.reason, taskId);
      await tx.collaborationRunTask.update({ where: { id: taskId }, data: { status: 'skipped', completedAt: new Date() } });
      await this.progression.advanceRun(tx, runId, `human-skip:${body.idempotencyKey}`, false);
    }, taskId, expectedSpaceId);
  }

  private async mutateRun(
    runId: string,
    operation: string,
    body: RunActionDto,
    principal: Principal,
    managersOnly: boolean,
    mutation: (tx: Tx, run: {
      id: string; spaceId: string; status: string; startedById: string; templateSnapshot: unknown;
    }) => Promise<void>,
    target = runId,
    expectedSpaceId?: string,
  ) {
    if (principal.agentId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.collaborationRun.findUnique({
        where: { id: runId },
        select: { id: true, spaceId: true, status: true, startedById: true, templateSnapshot: true },
      });
      if (!current || (expectedSpaceId !== undefined && current.spaceId !== expectedSpaceId)) {
        throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
      }
      const member = await this.assertLiveHumanAccess(
        tx,
        principal,
        current.spaceId,
        managersOnly ? MANAGE_ROLES : READ_ROLES,
      );
      const role = member.role as SpaceRole;
      if (managersOnly && !MANAGE_ROLES.includes(role)) {
        throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
      }
      if (!managersOnly && !MANAGE_ROLES.includes(role) && current.startedById !== principal.userId) {
        throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
      }
      return this.events.executeIdempotent(tx, {
        runId,
        actorKind: 'human',
        actorId: principal.userId,
        actorUserId: principal.userId,
        operation,
        target,
        key: body.idempotencyKey,
        requestHash: canonicalRequestHash(body),
        metadata: { reason: body.reason },
      }, async () => {
        await mutation(tx, current);
        const updated = await tx.collaborationRun.findUnique({
          where: { id: runId },
          select: { id: true, status: true, version: true },
        });
        if (!updated) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
        return { runId: updated.id, status: updated.status, version: updated.version };
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.notifications.publishCurrentRun(runId);
    return this.loadHumanRun(this.prisma as unknown as Tx, runId);
  }

  private async assertHumanAccess(principal: Principal, spaceId: string, roles: SpaceRole[]) {
    if (principal.agentId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    try {
      return await this.authorization.assertSpaceAccess(principal, spaceId, roles);
    } catch (error) {
      if (error instanceof BusinessException && error.businessCode === 'SPACE_ACCESS_DENIED') {
        throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
      }
      throw error;
    }
  }

  private async assertLiveHumanAccess(tx: Tx, principal: Principal, spaceId: string, roles: SpaceRole[]) {
    try {
      return await this.authorization.assertLiveHumanSpaceAccess(tx, principal, spaceId, roles);
    } catch (error) {
      if (error instanceof BusinessException && error.businessCode === 'SPACE_ACCESS_DENIED') {
        throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
      }
      throw error;
    }
  }

  private async loadTemplate(tx: Tx, spaceId: string, templateId: string) {
    const template = await tx.collaborationTemplate.findFirst({
      where: {
        id: templateId,
        archivedAt: null,
        OR: [{ system: true, scopeKey: 'system', spaceId: null }, { system: false, spaceId, scopeKey: spaceId }],
      },
    });
    if (!template) throw new BusinessException('COLLABORATION_TEMPLATE_NOT_FOUND');
    return template;
  }

  private normalizeBindings(
    definition: CollaborationTemplateDefinition,
    input: RoleBindingInput[],
    allowMissingRequired = false,
  ) {
    const slots = new Map(definition.roleSlots.map((slot) => [slot.id, slot]));
    const seen = new Set<string>();
    const bindings = input.map((binding) => {
      const slot = slots.get(binding.roleSlotId);
      if (!slot || seen.has(binding.roleSlotId)) {
        throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', 'Role bindings do not match the template');
      }
      seen.add(binding.roleSlotId);
      return { roleSlotId: slot.id, roleSlotName: slot.name, agentId: binding.agentId };
    });
    if (!allowMissingRequired && definition.roleSlots.some((slot) => slot.required && !seen.has(slot.id))) {
      throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', 'Required role bindings are missing');
    }
    return bindings;
  }

  private parseInputs(
    definition: CollaborationTemplateDefinition,
    raw: unknown,
  ): Record<string, string | number | boolean> {
    const parsed = CollaborationInputValuesSchema.safeParse(raw);
    if (!parsed.success) throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues: parsed.error.issues });
    const definitions = new Map(definition.inputs.map((input) => [input.key, input]));
    const issues: string[] = [];
    for (const key of Object.keys(parsed.data)) if (!definitions.has(key)) issues.push(`Unknown input: ${key}`);
    for (const input of definition.inputs) {
      const value = parsed.data[input.key];
      if (input.required && value === undefined) issues.push(`Required input is missing: ${input.key}`);
      if (value === undefined) continue;
      if (input.type === 'number' && typeof value !== 'number') issues.push(`${input.key} must be a number`);
      if (input.type === 'boolean' && typeof value !== 'boolean') issues.push(`${input.key} must be a boolean`);
      if (!['number', 'boolean'].includes(input.type) && typeof value !== 'string') issues.push(`${input.key} must be text`);
      if (input.type === 'url' && (typeof value !== 'string' || !isHttpsUrl(value))) issues.push(`${input.key} must be an HTTPS URL`);
    }
    if (issues.length) throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues });
    return Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => {
      const input = definitions.get(key)!;
      if (input.type === 'url' && typeof value === 'string') return [key, new URL(value).toString()];
      return [key, value];
    }));
  }

  private async validateFreshAgents(tx: Tx, spaceId: string, agentIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(agentIds)];
    const grants = await tx.agentGrant.findMany({
      where: { spaceId, agentId: { in: uniqueIds } },
      include: {
        agent: { select: { id: true, status: true, revokedAt: true } },
        space: { select: { deletedAt: true } },
      },
    });
    const byAgent = new Map(grants.map((grant) => [grant.agentId, grant]));
    for (const agentId of uniqueIds) {
      const grant = byAgent.get(agentId);
      if (!grant) throw new BusinessException('COLLABORATION_AGENT_CANNOT_EXECUTE');
      if (grant.agent.status !== 'active' || grant.agent.revokedAt || grant.space.deletedAt) {
        throw new BusinessException('COLLABORATION_AGENT_INACTIVE');
      }
      if (!agentRoleAllowsScope(grant.role, 'collaboration:execute')) {
        throw new BusinessException('COLLABORATION_AGENT_CANNOT_EXECUTE');
      }
    }
  }

  private async loadBindings(tx: Tx, runId: string, run: unknown): Promise<RoleBindingInput[]> {
    const embedded = (run as { roleBindings?: RoleBindingInput[] }).roleBindings;
    return embedded ?? tx.collaborationRoleBinding.findMany({ where: { runId } });
  }

  private async expandRun(
    tx: Tx,
    runId: string,
    definition: CollaborationTemplateDefinition,
    bindings: RoleBindingInput[],
  ): Promise<void> {
    const agentByRole = new Map(bindings.map((binding) => [binding.roleSlotId, binding.agentId]));
    const incoming = new Set(definition.dependencies.map((dependency) => dependency.to));
    const tasks = definition.nodes.filter((node) => node.kind === 'agent_task').map((node, ordinal) => ({
      id: randomUUID(),
      runId,
      nodeId: node.id,
      ordinal,
      name: node.name,
      objective: node.objective,
      roleSlotId: node.roleSlotId,
      assigneeAgentId: agentByRole.get(node.roleSlotId)!,
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
    }));
    if (tasks.length) await tx.collaborationRunTask.createMany({ data: tasks });
    const taskByNode = new Map(tasks.map((task) => [task.nodeId, task]));
    const todos = definition.nodes.filter((node) => node.kind === 'agent_task').flatMap((node) =>
      node.todos.map((todo, ordinal) => ({
        runId,
        taskId: taskByNode.get(node.id)!.id,
        generation: 1,
        templateId: todo.id,
        ordinal,
        name: todo.name,
        required: todo.required,
        status: 'pending' as const,
      })),
    );
    if (todos.length) await tx.collaborationTaskTodo.createMany({ data: todos });
    if (definition.dependencies.length) {
      await tx.collaborationTaskDependency.createMany({
        data: definition.dependencies.map((dependency) => ({
          runId,
          fromNodeId: dependency.from,
          toNodeId: dependency.to,
          mode: dependency.mode,
        })),
      });
    }
  }

  private async invalidateAttempts(tx: Tx, runId: string, reason: string, taskId?: string): Promise<void> {
    await tx.collaborationTaskAttempt.updateMany({
      where: { runId, ...(taskId ? { taskId } : {}), status: { in: ['claimed', 'running'] } },
      data: { status: 'invalidated', failureCode: reason.slice(0, 4_000), finishedAt: new Date() },
    });
  }

  private async loadHumanRun(tx: Tx, runId: string) {
    const run = await tx.collaborationRun.findUnique({
      where: { id: runId },
      select: HUMAN_RUN_SELECT,
    });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
    const roleBindings = run.roleBindings;
    const taskGenerations = run.tasks.map((task) => ({ taskId: task.id, generation: task.generation }));
    const [todos, latestAttempts, latestArtifacts, reviews, newestEvents] = await Promise.all([
      tx.collaborationTaskTodo.findMany({
        where: { OR: taskGenerations },
        orderBy: [{ taskId: 'asc' }, { ordinal: 'asc' }],
        select: HUMAN_TODO_PREVIEW_SELECT,
      }),
      Promise.all(taskGenerations.map(({ taskId, generation }) => tx.collaborationTaskAttempt.findFirst({
        where: { taskId, generation },
        orderBy: { attemptNumber: 'desc' },
        select: HUMAN_ATTEMPT_SELECT,
      }))),
      Promise.all(taskGenerations.map(({ taskId, generation }) => tx.collaborationTaskArtifact.findFirst({
        where: { taskId, generation },
        orderBy: { version: 'desc' },
        select: HUMAN_ARTIFACT_PREVIEW_SELECT,
      }))),
      tx.collaborationReview.findMany({
        where: { OR: taskGenerations.map(({ taskId, generation }) => ({ sourceTaskId: taskId, generation })) },
        orderBy: { revision: 'desc' },
        take: 100,
        select: HUMAN_REVIEW_PREVIEW_SELECT,
      }),
      tx.collaborationRunEvent.findMany({
        where: { runId },
        orderBy: { sequence: 'desc' },
        take: HUMAN_EVENT_PREVIEW_LIMIT,
        select: HUMAN_EVENT_PREVIEW_SELECT,
      }),
    ]);
    const currentReviews = [
      ...reviews
        .reduce((latestByNode, review) => {
          if (!latestByNode.has(review.nodeId)) {
            latestByNode.set(review.nodeId, review);
          }
          return latestByNode;
        }, new Map<string, (typeof reviews)[number]>())
        .values(),
    ];
    const tasks = run.tasks.map((task, index) => {
      const currentTodos = todos.filter((todo) => todo.taskId === task.id);
      const { objective, ...taskFields } = task;
      const attempt = latestAttempts[index];
      const artifact = latestArtifacts[index];
      return {
        ...taskFields,
        objectivePreview: previewText(objective, 240),
        todoCounts: countTodoStatuses(currentTodos),
        todos: currentTodos.slice(0, HUMAN_TODO_PREVIEW_LIMIT).map(todoPreview),
        attempts: attempt ? [attemptPreview(attempt)] : [],
        artifacts: artifact ? [artifactPreview(artifact)] : [],
      };
    });
    const instructions = new Map<string, { agentId: string; roleSlotIds: string[]; taskIds: string[] }>();
    for (const binding of roleBindings) {
      const current = instructions.get(binding.agentId) ?? { agentId: binding.agentId, roleSlotIds: [], taskIds: [] };
      current.roleSlotIds.push(binding.roleSlotId);
      instructions.set(binding.agentId, current);
    }
    for (const task of tasks) {
      const existing = instructions.get(task.assigneeAgentId);
      if (!existing && ['completed', 'failed', 'skipped'].includes(task.status)) continue;
      const current = existing ?? { agentId: task.assigneeAgentId, roleSlotIds: [], taskIds: [] };
      current.taskIds.push(task.id);
      instructions.set(task.assigneeAgentId, current);
    }
    const response = {
      ...run,
      tasks,
      reviews: currentReviews,
      events: newestEvents.reverse(),
      joinInstructions: [...instructions.values()],
    };
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > HUMAN_RUN_MAX_SERIALIZED_BYTES) {
      throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Human Run summary exceeds its response budget');
    }
    return response;
  }

  private assertNotTerminal(status: string): void {
    if ((TERMINAL_RUN_STATUSES as readonly string[]).includes(status)) throw new BusinessException('COLLABORATION_RUN_TERMINAL');
  }

  private runStateError(status: string): BusinessException {
    this.assertNotTerminal(status);
    return new BusinessException('COLLABORATION_PROGRESS_INVARIANT');
  }
}

function parseDefinition(value: unknown): CollaborationTemplateDefinition {
  const result = CollaborationTemplateDefinitionSchema.safeParse(value);
  if (!result.success) throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', undefined, { issues: result.error.issues });
  return result.data;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}

function dependencyModeFor(definition: CollaborationTemplateDefinition, nodeId: string): 'all' | 'any' {
  return definition.dependencies.find((dependency) => dependency.to === nodeId)?.mode ?? 'all';
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function snapshotNodes(value: unknown): any[] {
  return value && typeof value === 'object' && Array.isArray((value as { nodes?: unknown }).nodes)
    ? (value as { nodes: any[] }).nodes
    : [];
}

function parseHistoryKind(value: string): HistoryKind {
  if (!(HISTORY_KINDS as readonly string[]).includes(value)) {
    throw new BusinessException('COLLABORATION_HISTORY_QUERY_INVALID');
  }
  return value as HistoryKind;
}

function parseHistoryLimit(value: string): number {
  if (!/^\d+$/u.test(value)) throw new BusinessException('COLLABORATION_HISTORY_QUERY_INVALID');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new BusinessException('COLLABORATION_HISTORY_QUERY_INVALID');
  }
  return parsed;
}

function parseRunListStatus(value: string): RunListStatus {
  if (value !== 'active' && value !== 'history') {
    throw new BusinessException('COLLABORATION_RUN_LIST_QUERY_INVALID');
  }
  return value;
}

function parseRunListLimit(value: string): number {
  if (!/^\d+$/u.test(value)) throw new BusinessException('COLLABORATION_RUN_LIST_QUERY_INVALID');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new BusinessException('COLLABORATION_RUN_LIST_QUERY_INVALID');
  }
  return parsed;
}

function timestampKeyset(field: 'createdAt' | 'updatedAt', position: { at: string; id: string }) {
  const at = new Date(position.at);
  return {
    OR: [
      { [field]: { lt: at } },
      { [field]: at, id: { lt: position.id } },
    ],
  };
}

function previewText(value: string | null | undefined, maximum: number): string | null {
  if (!value) return null;
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function countTodoStatuses(todos: Array<{ status: string }>) {
  const counts = { total: todos.length, pending: 0, doing: 0, done: 0, failed: 0 };
  for (const todo of todos) {
    if (todo.status === 'pending' || todo.status === 'doing' || todo.status === 'done' || todo.status === 'failed') {
      counts[todo.status] += 1;
    }
  }
  return counts;
}

function todoPreview(todo: any) {
  return {
    id: todo.id, taskId: todo.taskId, generation: todo.generation, ordinal: todo.ordinal,
    name: previewText(todo.name, 120), required: todo.required, status: todo.status,
  };
}

function attemptPreview(attempt: any) {
  return {
    id: attempt.id, taskId: attempt.taskId, generation: attempt.generation, agentId: attempt.agentId,
    attemptNumber: attempt.attemptNumber, status: attempt.status, leaseStartedAt: attempt.leaseStartedAt,
    leaseExpiresAt: attempt.leaseExpiresAt, maxExecutionAt: attempt.maxExecutionAt,
    failureCode: previewText(attempt.failureCode, 240), repairCount: attempt.repairCount,
    finishedAt: attempt.finishedAt, createdAt: attempt.createdAt, updatedAt: attempt.updatedAt,
  };
}

function artifactPreview(artifact: any) {
  return {
    id: artifact.id, taskId: artifact.taskId, generation: artifact.generation, version: artifact.version,
    kind: artifact.kind, status: artifact.status, createdAt: artifact.createdAt,
    preview: `${artifact.kind} v${artifact.version}`,
  };
}

function runSummary(run: any) {
  return {
    id: run.id, name: run.name, status: run.status, templateId: run.templateId,
    templateVersion: run.templateVersion, createdAt: run.createdAt, updatedAt: run.updatedAt,
    startedAt: run.startedAt, finishedAt: run.finishedAt,
  };
}
