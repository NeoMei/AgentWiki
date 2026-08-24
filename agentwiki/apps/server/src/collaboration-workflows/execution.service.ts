import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  CollaborationGetRunInputSchema,
  CollaborationHeartbeatInputSchema,
  CollaborationNextActionInputSchema,
  CollaborationSubmitResultInputSchema,
  CollaborationUpdateTodoInputSchema,
  AgentAccessRoleSchema,
  agentRoleAllowsScope,
  type CollaborationHeartbeatInput,
  type CollaborationNextActionInput,
  type CollaborationSubmitResultInput,
  type CollaborationUpdateTodoInput,
} from '@neomei/agentwiki-sync-protocol';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';
import { ArtifactValidator, type ArtifactOutputContract } from './artifact-validator';
import { canonicalRequestHash, RunEventStore } from './run-event.store';
import { ProgressionService } from './progression.service';
import { CollaborationEventsService } from './collaboration-events.service';
import { isCollaborationSerializationConflict, withCollaborationSerializableRetry } from './serializable-retry';

type Tx = Prisma.TransactionClient;
type AgentRun = { run: any; agentId: string };
type AttemptWithTask = {
  id: string;
  runId: string;
  taskId: string;
  generation: number;
  agentId: string;
  attemptNumber: number;
  status: string;
  claimIdempotencyKey: string;
  leaseTokenHash: string;
  leaseExpiresAt: Date;
  maxExecutionAt: Date;
  repairCount: number;
  task: {
    id: string;
    runId: string;
    nodeId: string;
    generation: number;
    status: string;
    leaseSeconds: number;
    retryBudget: number;
    repairBudget: number;
    outputContract: unknown;
    requiredEvidence: unknown;
  };
};

@Injectable()
export class ExecutionService {
  private readonly leaseSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    config: ConfigService,
    private readonly events: RunEventStore,
    private readonly artifacts: ArtifactValidator,
    private readonly progression: ProgressionService,
    private readonly notifications: CollaborationEventsService,
  ) {
    this.leaseSecret = String(config.get('JWT_SECRET') || '');
    if (!this.leaseSecret) throw new Error('JWT_SECRET is required for collaboration task leases');
  }

  async joinRun(runId: string, principal: Principal) {
    const { run, agentId } = await this.authorizeParticipant(this.prisma as unknown as Tx, runId, principal);
    const bindings = await this.prisma.collaborationRoleBinding.findMany({
      where: { runId, agentId },
      orderBy: { roleSlotId: 'asc' },
    });
    return {
      runId,
      status: run.status,
      roleSlots: bindings.map((binding) => ({ id: binding.roleSlotId, name: binding.roleSlotName })),
      protocol: {
        nextActionTool: 'wiki_collaboration_next_action' as const,
        stopOn: ['waiting_human', 'paused', 'completed', 'failed', 'cancelled'] as const,
      },
    };
  }

  async nextAction(inputRaw: CollaborationNextActionInput, principal: Principal) {
    const input = CollaborationNextActionInputSchema.parse(inputRaw);
    const participant = await this.authorizeParticipant(this.prisma as unknown as Tx, input.runId, principal);
    const immediate = this.immediateRunAction(participant.run.status);
    if (immediate) return immediate;
    if (input.waitSeconds) await this.waitForActionAvailability(input.runId, participant.agentId, input.waitSeconds);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          const current = await this.authorizeParticipant(tx, input.runId, principal);
          const stopped = this.immediateRunAction(current.run.status);
          if (stopped) return stopped;
          const scope = this.agentScope(input.runId, current.agentId, 'next_action', input.runId, input.idempotencyKey, {
            waitSeconds: input.waitSeconds ?? 0,
          });
          const replay = await this.events.findReplay<Record<string, unknown>>(tx, scope);
          if (replay) return this.restoreClaimToken(tx, input.runId, current.agentId, replay);
          const response = await this.events.executeIdempotent<Record<string, unknown>>(tx, {
            ...scope,
            responseForStorage: redactLeaseToken,
          }, async () => this.claimReadyTask(tx, current, input.idempotencyKey));
          return this.restoreClaimToken(tx, input.runId, current.agentId, response);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        await this.notifications.publishCurrentRun(input.runId);
        if (result.action !== 'waiting_dependency' || !input.waitSeconds) return result;
        return result;
      } catch (error) {
        if (isClaimConflict(error)) {
          if (attempt < 2) continue;
          throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Task claim conflicted repeatedly');
        }
        throw error;
      }
    }
    throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Unable to claim a task after concurrent updates');
  }

  async heartbeat(inputRaw: CollaborationHeartbeatInput, principal: Principal) {
    const input = CollaborationHeartbeatInputSchema.parse(inputRaw);
    const result = await withCollaborationSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const participant = await this.authorizeParticipant(tx, input.runId, principal);
      this.assertRunMutable(participant.run.status);
      const scope = this.agentScope(input.runId, participant.agentId, 'heartbeat', input.attemptId, input.idempotencyKey, {
          attemptId: input.attemptId,
          leaseTokenHash: sha256(input.leaseToken),
        });
      const replay = await this.events.findReplay<Record<string, unknown>>(tx, scope);
      if (replay) {
        await this.loadLiveAttempt(tx, input, participant.agentId);
        return replay;
      }
      return this.events.executeIdempotent(tx, scope, async () => {
        const attempt = await this.loadLiveAttempt(tx, input, participant.agentId);
        const now = new Date();
        const leaseExpiresAt = new Date(Math.min(
          attempt.maxExecutionAt.getTime(),
          now.getTime() + attempt.task.leaseSeconds * 1_000,
        ));
        const updated = await tx.collaborationTaskAttempt.updateMany({
          where: { id: attempt.id, status: { in: ['claimed', 'running'] }, leaseExpiresAt: { gt: now } },
          data: { leaseExpiresAt },
        });
        if (updated.count !== 1) throw new BusinessException('COLLABORATION_LEASE_EXPIRED');
        return { attemptId: attempt.id, leaseExpiresAt: leaseExpiresAt.toISOString(), replayed: false };
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    await this.notifications.publishCurrentRun(input.runId);
    return result;
  }

  async updateTodo(inputRaw: CollaborationUpdateTodoInput, principal: Principal) {
    const input = CollaborationUpdateTodoInputSchema.parse(inputRaw);
    const result = await withCollaborationSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const participant = await this.authorizeParticipant(tx, input.runId, principal);
      this.assertRunMutable(participant.run.status);
      const scope = {
        ...this.agentScope(input.runId, participant.agentId, 'update_todo', input.todoId, input.idempotencyKey, {
          attemptId: input.attemptId,
          todoId: input.todoId,
          status: input.status,
          summary: input.summary,
          evidence: input.evidence,
          leaseTokenHash: sha256(input.leaseToken),
        }),
        metadata: {
          todoId: input.todoId,
          status: input.status,
          summary: input.summary,
          evidence: input.evidence,
        },
      };
      const replay = await this.events.findReplay<Record<string, unknown>>(tx, scope);
      if (replay) {
        await this.loadLiveAttempt(tx, input, participant.agentId);
        return replay;
      }
      return this.events.executeIdempotent(tx, scope, async () => {
        const attempt = await this.loadLiveAttempt(tx, input, participant.agentId);
        const todos = await tx.collaborationTaskTodo.findMany({
          where: { taskId: attempt.taskId, generation: attempt.generation },
          orderBy: { ordinal: 'asc' },
        });
        const targetIndex = todos.findIndex((todo) => todo.id === input.todoId);
        if (targetIndex < 0) throw new BusinessException('COLLABORATION_TODO_NOT_FOUND');
        if (todos.slice(0, targetIndex).some((todo) => todo.required && todo.status !== 'done')) {
          throw new BusinessException('COLLABORATION_TODO_OUT_OF_ORDER');
        }
        const target = todos[targetIndex];
        if (!todoTransitionAllowed(target.status, input.status)) {
          throw new BusinessException('COLLABORATION_TODO_TRANSITION_INVALID');
        }
        const todo = await tx.collaborationTaskTodo.update({
          where: { id: target.id },
          data: {
            status: input.status,
            summary: input.summary,
            evidence: toJson(input.evidence),
          },
        });
        let taskStatus = input.status === 'doing' ? 'running' : attempt.task.status;
        if (input.status === 'doing') {
          await tx.collaborationTaskAttempt.updateMany({ where: { id: attempt.id, status: 'claimed' }, data: { status: 'running' } });
          await tx.collaborationRunTask.updateMany({ where: { id: attempt.taskId, status: 'claimed' }, data: { status: 'running' } });
        } else if (input.status === 'failed') {
          await tx.collaborationTaskAttempt.updateMany({
            where: { id: attempt.id, status: { in: ['claimed', 'running'] } },
            data: { status: 'failed', failureCode: 'todo_failed', finishedAt: new Date() },
          });
          if (attempt.attemptNumber <= attempt.task.retryBudget) {
            taskStatus = 'retry_wait';
            await tx.collaborationRunTask.update({
              where: { id: attempt.taskId },
              data: { status: 'retry_wait', nextAttemptAt: new Date(Date.now() + retryDelayMs(attempt.attemptNumber)) },
            });
          } else {
            taskStatus = 'failed';
            await tx.collaborationRunTask.update({ where: { id: attempt.taskId }, data: { status: 'failed' } });
            await tx.collaborationRun.update({
              where: { id: input.runId },
              data: { status: 'paused', pauseReason: `Todo failed: ${target.name}` },
            });
          }
        }
        return {
          todo: {
            id: todo.id,
            ordinal: todo.ordinal,
            name: todo.name,
            required: todo.required,
            status: todo.status,
          },
          taskStatus,
          replayed: false,
        };
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    await this.notifications.publishCurrentRun(input.runId);
    return result;
  }

  async submitResult(inputRaw: CollaborationSubmitResultInput, principal: Principal) {
    const input = CollaborationSubmitResultInputSchema.parse(inputRaw);
    const result = await withCollaborationSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const access = await this.authorizeAgentRun(tx, input.runId, principal, 'collaboration:execute');
      const scope = this.agentScope(input.runId, access.agentId, 'submit_result', input.attemptId, input.idempotencyKey, {
          attemptId: input.attemptId,
          artifact: input.artifact,
          leaseTokenHash: sha256(input.leaseToken),
        });
      const replay = await this.events.findReplay<Record<string, unknown>>(tx, scope);
      if (replay) {
        await this.verifySubmitReplayAttempt(tx, input, access.agentId, replay);
        if (replay.action !== 'submitted') this.assertRunMutable(access.run.status);
        return replay;
      }
      this.assertRunMutable(access.run.status);
      await this.assertCurrentParticipation(tx, input.runId, access.agentId);
      const participant = access;
      return this.events.executeIdempotent(tx, {
        ...scope,
        responseForStorage: redactLeaseToken,
      }, async () => {
        const attempt = await this.loadLiveAttempt(tx, input, participant.agentId);
        const todos = await tx.collaborationTaskTodo.findMany({
          where: { taskId: attempt.taskId, generation: attempt.generation },
          orderBy: { ordinal: 'asc' },
        });
        if (todos.some((todo) => todo.required && todo.status !== 'done')) {
          throw new BusinessException('COLLABORATION_TODO_OUT_OF_ORDER', 'All required Todo items must be done before submission');
        }
        const validation = this.artifacts.validate(
          input.artifact,
          attempt.task.outputContract as unknown as ArtifactOutputContract,
          stringArray(attempt.task.requiredEvidence),
        );
        if (!validation.valid || !validation.normalizedArtifact) {
          return this.recordRepairFailure(tx, participant.run, attempt, validation.issues);
        }
        const previous = await tx.collaborationTaskArtifact.findFirst({
          where: { taskId: attempt.taskId, generation: attempt.generation },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const requiresReview = templateNodes(participant.run.templateSnapshot).some((node) =>
          node.kind === 'human_review' && node.artifactTaskId === attempt.task.nodeId);
        const artifactStatus = requiresReview ? 'pending' : 'accepted';
        const taskStatus = requiresReview ? 'submitted' : 'completed';
        const normalized = validation.normalizedArtifact;
        const artifact = await tx.collaborationTaskArtifact.create({
          data: {
            runId: input.runId,
            taskId: attempt.taskId,
            attemptId: attempt.id,
            generation: attempt.generation,
            version: (previous?.version ?? 0) + 1,
            kind: normalized.kind,
            status: artifactStatus,
            payload: toJson(artifactPayload(normalized)),
            evidence: toJson(normalized.evidence),
            acceptedAt: requiresReview ? null : new Date(),
          },
        });
        await tx.collaborationTaskAttempt.updateMany({
          where: { id: attempt.id, status: { in: ['claimed', 'running'] } },
          data: { status: 'completed', finishedAt: new Date() },
        });
        await tx.collaborationRunTask.update({
          where: { id: attempt.taskId },
          data: { status: taskStatus, ...(requiresReview ? {} : { completedAt: new Date() }) },
        });
        await this.progression.advanceRun(tx, input.runId, `artifact-submitted:${artifact.id}`, false);
        const progressedRun = await tx.collaborationRun.findUnique({ where: { id: input.runId } });
        if (!progressedRun) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
        return {
          action: 'submitted' as const,
          artifactId: artifact.id,
          version: artifact.version,
          artifactStatus,
          taskStatus,
          runStatus: progressedRun.status,
          replayed: false,
        };
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    await this.notifications.publishCurrentRun(input.runId);
    return result;
  }

  async getAgentRun(inputRaw: { runId: string }, principal: Principal) {
    const input = CollaborationGetRunInputSchema.parse(inputRaw);
    const participant = await this.authorizeParticipant(
      this.prisma as unknown as Tx,
      input.runId,
      principal,
      'collaboration:read',
    );
    const bindings = await this.prisma.collaborationRoleBinding.findMany({
      where: { runId: input.runId, agentId: participant.agentId },
      orderBy: { roleSlotId: 'asc' },
    });
    const tasks = await this.prisma.collaborationRunTask.findMany({
      where: { runId: input.runId, assigneeAgentId: participant.agentId },
      orderBy: { ordinal: 'asc' },
    });
    return {
      runId: input.runId,
      status: participant.run.status,
      roleSlots: bindings.map((binding) => ({ id: binding.roleSlotId, name: binding.roleSlotName })),
      assignedTasks: await Promise.all(tasks.map((task) => this.loadTaskContext(this.prisma as unknown as Tx, participant.run, task))),
      ...(participant.run.status === 'waiting_review' ? { waitingReason: 'Human review is required' } : {}),
    };
  }

  private async claimReadyTask(tx: Tx, participant: AgentRun, key: string): Promise<Record<string, unknown>> {
    const activeRow = await tx.collaborationTaskAttempt.findFirst({
      where: { runId: participant.run.id, agentId: participant.agentId, status: { in: ['claimed', 'running'] } },
      include: { runTask: true },
    });
    const active = activeRow
      ? { ...activeRow, task: (activeRow as any).runTask ?? (activeRow as any).task }
      : null;
    if (active) {
      if (
        active.generation !== active.task.generation
        || active.leaseExpiresAt.getTime() <= Date.now()
        || active.maxExecutionAt.getTime() <= Date.now()
      ) throw new BusinessException('COLLABORATION_LEASE_EXPIRED');
      return this.attemptResponse(tx, participant.run, active, true);
    }
    const task = await tx.collaborationRunTask.findFirst({
      where: { runId: participant.run.id, assigneeAgentId: participant.agentId, status: 'ready' },
      orderBy: [{ ordinal: 'asc' }, { id: 'asc' }],
    });
    if (!task) return { action: 'waiting_dependency', retryAfterSeconds: 3 };
    const lastAttempt = await tx.collaborationTaskAttempt.findFirst({
      where: { taskId: task.id, generation: task.generation },
      orderBy: { attemptNumber: 'desc' },
      select: { attemptNumber: true },
    });
    const claimed = await tx.collaborationRunTask.updateMany({
      where: { id: task.id, runId: participant.run.id, generation: task.generation, status: 'ready' },
      data: { status: 'claimed' },
    });
    if (claimed.count !== 1) throw new RetryableClaimConflict();
    const attemptId = randomUUID();
    const leaseToken = this.leaseTokenFor(attemptId, participant.run.id, participant.agentId, key);
    const now = new Date();
    const maxExecutionAt = new Date(now.getTime() + task.maxExecutionSeconds * 1_000);
    const leaseExpiresAt = new Date(Math.min(maxExecutionAt.getTime(), now.getTime() + task.leaseSeconds * 1_000));
    const attempt = await tx.collaborationTaskAttempt.create({
      data: {
        id: attemptId,
        runId: participant.run.id,
        taskId: task.id,
        generation: task.generation,
        agentId: participant.agentId,
        attemptNumber: (lastAttempt?.attemptNumber ?? 0) + 1,
        status: 'claimed',
        claimIdempotencyKey: key,
        leaseTokenHash: sha256(leaseToken),
        leaseStartedAt: now,
        leaseExpiresAt,
        maxExecutionAt,
      },
    });
    return {
      action: 'execute_task',
      attemptId: attempt.id,
      leaseToken,
      leaseExpiresAt: attempt.leaseExpiresAt.toISOString(),
      task: await this.loadTaskContext(tx, participant.run, task),
    };
  }

  private async restoreClaimToken(
    tx: Tx,
    runId: string,
    agentId: string,
    response: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (response.action !== 'execute_task' || typeof response.attemptId !== 'string' || response.leaseToken) return response;
    const attempt = await tx.collaborationTaskAttempt.findUnique({
      where: { id: response.attemptId },
      include: { runTask: true },
    });
    if (
      !attempt
      || attempt.runId !== runId
      || attempt.agentId !== agentId
      || !['claimed', 'running'].includes(attempt.status)
      || attempt.generation !== attempt.runTask.generation
      || attempt.leaseExpiresAt.getTime() <= Date.now()
      || attempt.maxExecutionAt.getTime() <= Date.now()
    ) {
      throw new BusinessException('COLLABORATION_AGENT_NOT_BOUND');
    }
    const leaseToken = this.leaseTokenFor(attempt.id, runId, agentId, attempt.claimIdempotencyKey);
    if (!secureHashEquals(attempt.leaseTokenHash, sha256(leaseToken))) {
      throw new BusinessException('COLLABORATION_LEASE_EXPIRED');
    }
    return { ...response, leaseToken };
  }

  private async attemptResponse(tx: Tx, run: AgentRun['run'], attempt: any, _replayed: boolean) {
    return {
      action: 'execute_task',
      attemptId: attempt.id,
      leaseToken: this.leaseTokenFor(attempt.id, run.id, attempt.agentId, attempt.claimIdempotencyKey),
      leaseExpiresAt: attempt.leaseExpiresAt.toISOString(),
      task: await this.loadTaskContext(tx, run, attempt.task),
    };
  }

  private async loadTaskContext(tx: Tx, run: any, task: any) {
    const todos = await tx.collaborationTaskTodo.findMany({
      where: { taskId: task.id, generation: task.generation },
      orderBy: { ordinal: 'asc' },
    });
    const taskNode = templateNodes(run.templateSnapshot).find((node) => node.kind === 'agent_task' && node.id === task.nodeId);
    const inputs = Object.fromEntries(
      stringArray(taskNode?.inputKeys)
        .filter((key) => Object.prototype.hasOwnProperty.call(run.inputs ?? {}, key))
        .map((key) => [key, run.inputs[key]]),
    );
    const upstreamKeys = new Set(Array.isArray(taskNode?.upstreamArtifacts)
      ? taskNode.upstreamArtifacts.map((artifact: any) => artifact.key)
      : []);
    const producerNodeIds = templateNodes(run.templateSnapshot)
      .filter((node) => node.kind === 'agent_task' && upstreamKeys.has(node.output?.key))
      .map((node) => node.id);
    const upstreamTasks = producerNodeIds.length
      ? await tx.collaborationRunTask.findMany({ where: { runId: run.id, nodeId: { in: producerNodeIds } } })
      : [];
    const acceptedArtifacts = upstreamTasks.length ? await tx.collaborationTaskArtifact.findMany({
      where: {
        runId: run.id,
        status: 'accepted',
        OR: upstreamTasks.map((upstream) => ({ taskId: upstream.id, generation: upstream.generation })),
      },
      orderBy: [{ taskId: 'asc' }, { version: 'desc' }],
    }) : [];
    return {
      id: task.id,
      nodeId: task.nodeId,
      name: task.name,
      objective: task.objective,
      todos: todos.map((todo) => ({
        id: todo.id, ordinal: todo.ordinal, name: todo.name, required: todo.required, status: todo.status,
      })),
      inputs,
      acceptedArtifacts: acceptedArtifacts.map((artifact) => ({
        taskId: artifact.taskId, version: artifact.version, kind: artifact.kind, payload: artifact.payload,
      })),
    };
  }

  private async loadLiveAttempt(
    tx: Tx,
    input: { runId: string; attemptId: string; leaseToken: string },
    agentId: string,
  ): Promise<AttemptWithTask> {
    const attemptRow = await tx.collaborationTaskAttempt.findUnique({
      where: { id: input.attemptId },
      include: { runTask: true },
    });
    const attempt = attemptRow
      ? { ...attemptRow, task: (attemptRow as any).runTask ?? (attemptRow as any).task } as unknown as AttemptWithTask
      : null;
    if (
      !attempt
      || attempt.runId !== input.runId
      || attempt.agentId !== agentId
      || attempt.generation !== attempt.task.generation
      || !['claimed', 'running'].includes(attempt.status)
    ) throw new BusinessException('COLLABORATION_LEASE_EXPIRED');
    const now = Date.now();
    if (attempt.leaseExpiresAt.getTime() <= now || attempt.maxExecutionAt.getTime() <= now) {
      throw new BusinessException('COLLABORATION_LEASE_EXPIRED');
    }
    if (!secureHashEquals(attempt.leaseTokenHash, sha256(input.leaseToken))) {
      throw new BusinessException('COLLABORATION_LEASE_EXPIRED');
    }
    return { ...attempt, repairCount: attempt.repairCount ?? 0 };
  }

  private async verifySubmitReplayAttempt(
    tx: Tx,
    input: { runId: string; attemptId: string; leaseToken: string },
    agentId: string,
    replay: Record<string, unknown>,
  ): Promise<void> {
    if (replay.action !== 'submitted') {
      await this.loadLiveAttempt(tx, input, agentId);
      return;
    }
    const attempt = await tx.collaborationTaskAttempt.findUnique({
      where: { id: input.attemptId },
      include: { runTask: true },
    });
    if (
      !attempt
      || attempt.runId !== input.runId
      || attempt.agentId !== agentId
      || attempt.status !== 'completed'
      || attempt.generation !== attempt.runTask.generation
      || !secureHashEquals(attempt.leaseTokenHash, sha256(input.leaseToken))
    ) throw new BusinessException('COLLABORATION_LEASE_EXPIRED');
  }

  private async authorizeParticipant(
    tx: Tx,
    runId: string,
    principal: Principal,
    requiredScope: 'collaboration:read' | 'collaboration:execute' = 'collaboration:execute',
  ) {
    const access = await this.authorizeAgentRun(tx, runId, principal, requiredScope);
    await this.assertCurrentParticipation(tx, runId, access.agentId);
    return access;
  }

  private async authorizeAgentRun(
    tx: Tx,
    runId: string,
    principal: Principal,
    requiredScope: 'collaboration:read' | 'collaboration:execute',
  ): Promise<AgentRun> {
    const agentId = principal.agentId;
    if (!agentId) throw new BusinessException('COLLABORATION_AGENT_NOT_BOUND');
    const run = await tx.collaborationRun.findUnique({ where: { id: runId } });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
    if (requiredScope === 'collaboration:execute') {
      await this.authorization.assertLiveAgentWriteAccess(tx, principal, run.spaceId, ['collaboration:execute']);
    } else {
      await this.authorization.assertSpaceAccess(principal, run.spaceId, ['owner', 'admin', 'editor', 'viewer'], requiredScope);
    }
    const grant = await tx.agentGrant.findUnique({
      where: { agentId_spaceId: { agentId, spaceId: run.spaceId } },
      include: {
        agent: { select: { status: true, revokedAt: true } },
        space: { select: { deletedAt: true } },
      },
    });
    if (
      !grant
      || grant.id !== principal.authorizationId
      || grant.agent.status !== 'active'
      || grant.agent.revokedAt
      || grant.space.deletedAt
      || !AgentAccessRoleSchema.safeParse(grant.role).success
      || !agentRoleAllowsScope(grant.role, requiredScope)
    ) throw new BusinessException('COLLABORATION_AGENT_CANNOT_EXECUTE');
    return { run, agentId };
  }

  private async assertCurrentParticipation(tx: Tx, runId: string, agentId: string): Promise<void> {
    const binding = await tx.collaborationRoleBinding.findFirst({ where: { runId, agentId } });
    const assignment = binding ? null : await tx.collaborationRunTask.findFirst({
      where: { runId, assigneeAgentId: agentId, status: { notIn: ['completed', 'failed', 'skipped'] } },
    });
    if (!binding && !assignment) throw new BusinessException('COLLABORATION_AGENT_NOT_BOUND');
  }

  private immediateRunAction(status: string): Record<string, unknown> | undefined {
    if (status === 'waiting_review') return { action: 'waiting_human', resumeRequired: true, message: 'Human review is required' };
    if (status === 'paused') return { action: 'paused', message: 'The run is paused' };
    if (['completed', 'failed', 'cancelled'].includes(status)) return { action: status, message: `The run is ${status}` };
    return undefined;
  }

  private assertRunMutable(status: string): void {
    if (['completed', 'failed', 'cancelled'].includes(status)) {
      throw new BusinessException('COLLABORATION_RUN_TERMINAL');
    }
    if (['paused', 'waiting_review'].includes(status)) throw new BusinessException('COLLABORATION_LEASE_EXPIRED');
  }

  private async waitForActionAvailability(runId: string, agentId: string, waitSeconds: number): Promise<void> {
    const deadline = Date.now() + Math.min(25, Math.max(0, waitSeconds)) * 1_000;
    while (Date.now() < deadline) {
      const [run, attempt, task] = await Promise.all([
        this.prisma.collaborationRun.findUnique({ where: { id: runId }, select: { status: true } }),
        this.prisma.collaborationTaskAttempt.findFirst({
          where: { runId, agentId, status: { in: ['claimed', 'running'] } },
          select: { id: true },
        }),
        this.prisma.collaborationRunTask.findFirst({
          where: { runId, assigneeAgentId: agentId, status: 'ready' },
          select: { id: true },
        }),
      ]);
      if (!run || this.immediateRunAction(run.status) || attempt || task) return;
      await delay(Math.min(500, Math.max(0, deadline - Date.now())));
    }
  }

  private agentScope(
    runId: string,
    agentId: string,
    operation: string,
    target: string,
    key: string,
    request: unknown,
  ) {
    return {
      runId,
      actorKind: 'agent' as const,
      actorId: agentId,
      actorAgentId: agentId,
      operation,
      target,
      key,
      requestHash: canonicalRequestHash(request),
    };
  }

  private leaseTokenFor(attemptId: string, runId: string, agentId: string, key: string): string {
    return createHmac('sha256', this.leaseSecret)
      .update(`collaboration-lease-v1\0${attemptId}\0${runId}\0${agentId}\0${key}`)
      .digest('hex');
  }

  private async recordRepairFailure(tx: Tx, run: any, attempt: AttemptWithTask, issues: any[]) {
    const repairCount = attempt.repairCount + 1;
    await tx.collaborationTaskAttempt.update({ where: { id: attempt.id }, data: { repairCount } });
    if (repairCount <= attempt.task.repairBudget) {
      return {
        action: 'repair_result' as const,
        issues: issues.slice(0, 50),
        repairsRemaining: attempt.task.repairBudget - repairCount,
        replayed: false,
      };
    }
    await tx.collaborationTaskAttempt.update({
      where: { id: attempt.id },
      data: { status: 'invalidated', failureCode: 'repair_budget_exhausted', finishedAt: new Date() },
    });
    await tx.collaborationRunTask.update({ where: { id: attempt.taskId }, data: { status: 'failed' } });
    await tx.collaborationRun.update({
      where: { id: run.id },
      data: { status: 'paused', pauseReason: 'Artifact repair budget exhausted' },
    });
    return {
      action: 'repair_result' as const,
      issues: issues.slice(0, 50),
      repairsRemaining: 0,
      replayed: false,
    };
  }

}

class RetryableClaimConflict extends Error {}

function isClaimConflict(error: unknown): boolean {
  return error instanceof RetryableClaimConflict
    || errorCode(error) === 'P2002'
    || isCollaborationSerializationConflict(error);
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function redactLeaseToken(response: unknown): unknown {
  if (!response || typeof response !== 'object') return response;
  const { leaseToken: _leaseToken, ...safe } = response as Record<string, unknown>;
  return safe;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function secureHashEquals(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(left) || !/^[a-f0-9]{64}$/u.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function todoTransitionAllowed(current: string, next: string): boolean {
  return (current === 'pending' && ['doing', 'done', 'failed'].includes(next))
    || (current === 'doing' && ['done', 'failed'].includes(next));
}

function retryDelayMs(attemptNumber: number): number {
  return Math.min(60_000, 1_000 * (2 ** Math.max(0, attemptNumber - 1)));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}

function templateNodes(value: unknown): any[] {
  return value && typeof value === 'object' && Array.isArray((value as { nodes?: unknown }).nodes)
    ? (value as { nodes: any[] }).nodes
    : [];
}

function artifactPayload(artifact: any): unknown {
  if (artifact.kind === 'markdown') return { markdown: artifact.markdown };
  if (artifact.kind === 'json') return { json: artifact.json };
  if (artifact.kind === 'external_reference') return { externalReference: artifact.externalReference };
  return { summary: artifact.summary };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
