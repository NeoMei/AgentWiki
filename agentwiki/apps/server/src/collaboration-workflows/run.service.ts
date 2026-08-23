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

const READ_ROLES: SpaceRole[] = ['owner', 'admin', 'editor', 'viewer'];
const EDIT_ROLES: SpaceRole[] = ['owner', 'admin', 'editor'];
const MANAGE_ROLES: SpaceRole[] = ['owner', 'admin'];
const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;
type RoleBindingInput = { roleSlotId: string; agentId: string };
type Tx = Prisma.TransactionClient;

const HUMAN_RUN_SELECT = {
  id: true,
  spaceId: true,
  templateId: true,
  templateVersion: true,
  templateSnapshot: true,
  snapshotHash: true,
  name: true,
  status: true,
  version: true,
  inputs: true,
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
      outputContract: true,
      requiredEvidence: true,
      humanAcceptance: true,
      skippable: true,
      leaseSeconds: true,
      maxExecutionSeconds: true,
      retryBudget: true,
      repairBudget: true,
      nextAttemptAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      todos: {
        select: {
          id: true,
          runId: true,
          taskId: true,
          generation: true,
          templateId: true,
          ordinal: true,
          name: true,
          required: true,
          status: true,
          summary: true,
          evidence: true,
          updatedAt: true,
        },
      },
      attempts: {
        select: {
          id: true,
          runId: true,
          taskId: true,
          generation: true,
          agentId: true,
          attemptNumber: true,
          status: true,
          leaseStartedAt: true,
          leaseExpiresAt: true,
          maxExecutionAt: true,
          failureCode: true,
          repairCount: true,
          finishedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      artifacts: {
        select: {
          id: true,
          runId: true,
          taskId: true,
          attemptId: true,
          generation: true,
          version: true,
          kind: true,
          status: true,
          payload: true,
          evidence: true,
          acceptedAt: true,
          createdAt: true,
        },
      },
    },
  },
  dependencies: {
    select: { id: true, runId: true, fromNodeId: true, toNodeId: true, mode: true },
  },
  reviews: {
    select: {
      id: true,
      runId: true,
      nodeId: true,
      revision: true,
      generation: true,
      sourceTaskId: true,
      artifactId: true,
      revisionTaskId: true,
      minimumRole: true,
      reviewerUserIds: true,
      allowTerminate: true,
      status: true,
      reviewerUserId: true,
      reason: true,
      decidedAt: true,
      createdAt: true,
    },
  },
  events: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      runId: true,
      sequence: true,
      type: true,
      actorKind: true,
      actorId: true,
      operation: true,
      target: true,
      actorUserId: true,
      actorAgentId: true,
      metadata: true,
      createdAt: true,
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
  ) {}

  async createDraft(spaceId: string, body: CreateRunDraftDto, principal: Principal) {
    await this.assertHumanAccess(principal, spaceId, EDIT_ROLES);
    const result = await this.prisma.$transaction(async (tx) => {
      const template = await this.loadTemplate(tx, spaceId, body.templateId);
      const definition = parseDefinition(template.definition);
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
          inputs: toJson(body.inputs),
          startedById: principal.userId,
        },
      });
      if (bindings.length > 0) {
        await tx.collaborationRoleBinding.createMany({
          data: bindings.map((binding) => ({ runId: run.id, ...binding })),
        });
      }
      return run;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.notifications.publishCurrentRun(result.id);
    return result;
  }

  async updateDraft(spaceId: string, runId: string, body: UpdateRunDraftDto, principal: Principal) {
    await this.assertHumanAccess(principal, spaceId, EDIT_ROLES);
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.collaborationRun.findFirst({
        where: { id: runId, spaceId, status: 'draft', version: body.expectedVersion },
      });
      if (!current) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
      const template = await this.loadTemplate(tx, spaceId, current.templateId);
      const definition = parseDefinition(template.definition);
      if (body.roleBindings) {
        const bindings = this.normalizeBindings(definition, body.roleBindings);
        await tx.collaborationRoleBinding.deleteMany({ where: { runId } });
        await tx.collaborationRoleBinding.createMany({
          data: bindings.map((binding) => ({ runId, ...binding })),
        });
      }
      const updated = await tx.collaborationRun.updateMany({
        where: { id: runId, spaceId, status: 'draft', version: body.expectedVersion },
        data: {
          ...(body.name === undefined ? {} : { name: body.name.trim() }),
          ...(body.inputs === undefined ? {} : { inputs: toJson(body.inputs) }),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
      return tx.collaborationRun.findUnique({ where: { id: runId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result) await this.notifications.publishCurrentRun(runId);
    return result;
  }

  async validateDraft(
    spaceId: string,
    runId: string,
    body: ValidateRunDraftDto,
    principal: Principal,
  ) {
    await this.assertHumanAccess(principal, spaceId, EDIT_ROLES);
    const result = await this.prisma.$transaction(async (tx) => {
      const run = await tx.collaborationRun.findFirst({
        where: { id: runId, spaceId, status: 'draft', version: body.expectedVersion },
      });
      if (!run) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
      const template = await this.loadTemplate(tx, spaceId, run.templateId);
      const definition = parseDefinition(template.definition);
      const bindings = await this.loadBindings(tx, runId, run);
      this.validateInputs(definition, run.inputs);
      this.normalizeBindings(definition, bindings);
      await this.validateFreshAgents(tx, spaceId, bindings.map((binding) => binding.agentId));
      const updated = await tx.collaborationRun.updateMany({
        where: { id: runId, spaceId, status: 'draft', version: body.expectedVersion },
        data: { status: 'ready', version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
      return tx.collaborationRun.findUnique({ where: { id: runId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result) await this.notifications.publishCurrentRun(runId);
    return result;
  }

  async startRun(spaceId: string, runId: string, body: StartRunDto, principal: Principal) {
    await this.assertHumanAccess(principal, spaceId, EDIT_ROLES);
    const result = await this.prisma.$transaction(async (tx) => this.events.executeIdempotent(tx, {
      runId,
      actorKind: 'human',
      actorId: principal.userId,
      actorUserId: principal.userId,
      operation: 'start_run',
      target: runId,
      key: body.idempotencyKey,
      requestHash: canonicalRequestHash({ expectedVersion: body.expectedVersion }),
      responseForStorage: () => ({ runId }),
      replayResponse: () => this.loadHumanRun(tx, runId),
    }, async () => {
      const run = await tx.collaborationRun.findFirst({
        where: { id: runId, spaceId, status: 'ready', version: body.expectedVersion },
      });
      if (!run) throw new BusinessException('COLLABORATION_RUN_VERSION_CONFLICT');
      const template = await this.loadTemplate(tx, spaceId, run.templateId);
      const definition = parseDefinition(template.definition);
      const bindings = await this.loadBindings(tx, runId, run);
      this.validateInputs(definition, run.inputs);
      this.normalizeBindings(definition, bindings);
      await this.validateFreshAgents(tx, spaceId, bindings.map((binding) => binding.agentId));
      const snapshot = structuredClone(definition);
      await tx.collaborationRun.update({
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
      return this.loadHumanRun(tx, runId);
    }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.notifications.publishCurrentRun(runId);
    return result;
  }

  async listRuns(spaceId: string, principal: Principal) {
    await this.assertHumanAccess(principal, spaceId, READ_ROLES);
    return this.prisma.collaborationRun.findMany({
      where: { spaceId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getHumanRun(spaceId: string, runId: string, principal: Principal) {
    await this.assertHumanAccess(principal, spaceId, READ_ROLES);
    const run = await this.prisma.collaborationRun.findFirst({ where: { id: runId, spaceId } });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
    return this.loadHumanRun(this.prisma as unknown as Tx, runId);
  }

  pauseRun(runId: string, body: RunActionDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'pause_run', body, principal, false, async (tx, run) => {
      if (!['running', 'waiting_review'].includes(run.status)) throw this.runStateError(run.status);
      await this.invalidateAttempts(tx, runId, body.reason);
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
      await this.validateFreshAgents(tx, run.spaceId, [body.agentId]);
      await this.invalidateAttempts(tx, runId, body.reason, taskId);
      await tx.collaborationRunTask.update({ where: { id: taskId }, data: { assigneeAgentId: body.agentId } });
    }, taskId, expectedSpaceId);
  }

  skipTask(runId: string, taskId: string, body: RunActionDto, principal: Principal, expectedSpaceId?: string) {
    return this.mutateRun(runId, 'skip_task', body, principal, true, async (tx, run) => {
      this.assertNotTerminal(run.status);
      const task = await tx.collaborationRunTask.findFirst({ where: { id: taskId, runId } });
      if (!task) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration task not found');
      if (!task.skippable) throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'This task is not skippable');
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
    const run = await this.prisma.collaborationRun.findUnique({
      where: { id: runId },
      select: { id: true, spaceId: true, status: true, startedById: true },
    });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
    if (expectedSpaceId !== undefined && run.spaceId !== expectedSpaceId) {
      throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
    }
    const member = await this.assertHumanAccess(principal, run.spaceId, managersOnly ? MANAGE_ROLES : READ_ROLES);
    const role = member.role as SpaceRole;
    if (managersOnly && !MANAGE_ROLES.includes(role)) {
      throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    }
    if (!managersOnly && !MANAGE_ROLES.includes(role) && run.startedById !== principal.userId) {
      throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    }
    const result = await this.prisma.$transaction(async (tx) => this.events.executeIdempotent(tx, {
      runId,
      actorKind: 'human',
      actorId: principal.userId,
      actorUserId: principal.userId,
      operation,
      target,
      key: body.idempotencyKey,
      requestHash: canonicalRequestHash(body),
      metadata: { reason: body.reason },
      responseForStorage: () => ({ runId }),
      replayResponse: () => this.loadHumanRun(tx, runId),
    }, async () => {
      const current = await tx.collaborationRun.findUnique({
        where: { id: runId },
        select: { id: true, spaceId: true, status: true, startedById: true, templateSnapshot: true },
      });
      if (!current || current.spaceId !== run.spaceId) throw new BusinessException('RESOURCE_NOT_FOUND');
      await mutation(tx, current);
      return this.loadHumanRun(tx, runId);
    }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.notifications.publishCurrentRun(runId);
    return result;
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

  private validateInputs(definition: CollaborationTemplateDefinition, raw: unknown): void {
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
    const tasks = run.tasks;
    const instructions = new Map<string, { agentId: string; roleSlotIds: string[]; taskIds: string[] }>();
    for (const binding of roleBindings) {
      const current = instructions.get(binding.agentId) ?? { agentId: binding.agentId, roleSlotIds: [], taskIds: [] };
      current.roleSlotIds.push(binding.roleSlotId);
      instructions.set(binding.agentId, current);
    }
    for (const task of tasks) {
      const current = instructions.get(task.assigneeAgentId)
        ?? { agentId: task.assigneeAgentId, roleSlotIds: [], taskIds: [] };
      current.taskIds.push(task.id);
      instructions.set(task.assigneeAgentId, current);
    }
    return {
      ...run,
      joinInstructions: [...instructions.values()],
    };
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
