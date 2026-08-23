import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AgentAccessRoleSchema, agentRoleAllowsScope } from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../database/prisma.service';
import { CollaborationEventsService } from './collaboration-events.service';
import { canonicalRequestHash, RunEventStore } from './run-event.store';

type Tx = Prisma.TransactionClient;
const BATCH_SIZE = 100;

@Injectable()
export class RecoveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecoveryWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: RunEventStore,
    private readonly notifications: CollaborationEventsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const role = String(this.config.get('PROCESS_ROLE') || 'api').toLowerCase();
    if (!['worker', 'all'].includes(role)) return;
    const intervalMs = boundedInteger(this.config.get('COLLABORATION_RECOVERY_POLL_MS'), 5_000, 500, 60_000);
    this.timer = setInterval(() => void this.safeTick(), intervalMs);
    this.timer.unref?.();
    void this.safeTick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.prisma.collaborationTaskAttempt.findMany({
        where: {
          status: { in: ['claimed', 'running'] },
          OR: [{ leaseExpiresAt: { lte: new Date() } }, { maxExecutionAt: { lte: new Date() } }],
        },
        orderBy: [{ leaseExpiresAt: 'asc' }, { id: 'asc' }],
        take: BATCH_SIZE,
        select: { id: true },
      });
      for (const attempt of expired) await this.recoverAttempt(attempt.id);
      await this.releaseDueRetries();
    } finally {
      this.running = false;
    }
  }

  private async safeTick(): Promise<void> {
    try {
      await this.tick();
    } catch (error) {
      this.logger.error(`Collaboration recovery tick failed: ${safeMessage(error)}`);
    }
  }

  private async recoverAttempt(attemptId: string): Promise<void> {
    const result = await this.prisma.$transaction(async (tx) => {
      const attempt = await tx.collaborationTaskAttempt.findUnique({
        where: { id: attemptId },
        include: { runTask: { include: { run: true } } },
      });
      const now = new Date();
      if (
        !attempt
        || !['claimed', 'running'].includes(attempt.status)
        || attempt.runTask.run.status !== 'running'
        || !['claimed', 'running'].includes(attempt.runTask.status)
        || attempt.agentId !== attempt.runTask.assigneeAgentId
        || (attempt.leaseExpiresAt > now && attempt.maxExecutionAt > now)
        || attempt.generation !== attempt.runTask.generation
      ) return null;
      return this.events.executeIdempotent(tx, {
        runId: attempt.runId,
        actorKind: 'system',
        actorId: 'system',
        operation: 'recover_expired_lease',
        target: attempt.id,
        key: `lease:${attempt.id}`,
        requestHash: canonicalRequestHash({ attemptId: attempt.id, leaseExpiresAt: attempt.leaseExpiresAt.toISOString() }),
        metadata: { attemptId: attempt.id, taskId: attempt.taskId },
      }, async () => {
        const won = await tx.collaborationTaskAttempt.updateMany({
          where: {
            id: attempt.id,
            status: { in: ['claimed', 'running'] },
            generation: attempt.generation,
            agentId: attempt.runTask.assigneeAgentId,
            OR: [{ leaseExpiresAt: { lte: now } }, { maxExecutionAt: { lte: now } }],
          },
          data: { status: 'expired', failureCode: 'lease_expired', finishedAt: new Date() },
        });
        if (won.count !== 1) return null;
        if (!await this.canExecute(tx, attempt.runTask.run.spaceId, attempt.runTask.assigneeAgentId, now)) {
          const paused = await tx.collaborationRun.updateMany({
            where: { id: attempt.runId, status: 'running' },
            data: { status: 'paused', pauseReason: 'agent_authorization_changed' },
          });
          if (paused.count !== 1) return null;
          await tx.collaborationRunTask.updateMany({
            where: {
              id: attempt.taskId, runId: attempt.runId, generation: attempt.generation,
              assigneeAgentId: attempt.runTask.assigneeAgentId, status: { in: ['claimed', 'running'] },
            },
            data: { status: 'failed', nextAttemptAt: null },
          });
          return { runId: attempt.runId, spaceId: attempt.runTask.run.spaceId };
        }
        if (attempt.attemptNumber <= attempt.runTask.retryBudget) {
          const nextAttemptAt = new Date(Date.now() + retryDelaySeconds(attempt.attemptNumber) * 1_000);
          await tx.collaborationRunTask.updateMany({
            where: {
              id: attempt.taskId, runId: attempt.runId, generation: attempt.generation,
              assigneeAgentId: attempt.runTask.assigneeAgentId, status: { in: ['claimed', 'running'] },
            },
            data: { status: 'retry_wait', nextAttemptAt },
          });
        } else {
          const paused = await tx.collaborationRun.updateMany({
            where: { id: attempt.runId, status: 'running' },
            data: { status: 'paused', pauseReason: 'retry_exhausted' },
          });
          if (paused.count !== 1) return null;
          await tx.collaborationRunTask.updateMany({
            where: {
              id: attempt.taskId, runId: attempt.runId, generation: attempt.generation,
              assigneeAgentId: attempt.runTask.assigneeAgentId, status: { in: ['claimed', 'running'] },
            },
            data: { status: 'failed', nextAttemptAt: null },
          });
        }
        return { runId: attempt.runId, spaceId: attempt.runTask.run.spaceId };
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result) await this.publishCommitted(result.spaceId, result.runId);
  }

  private async releaseDueRetries(): Promise<void> {
    const tasks = await this.prisma.collaborationRunTask.findMany({
      where: { status: 'retry_wait', nextAttemptAt: { lte: new Date() } },
      orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
      take: BATCH_SIZE,
      select: { id: true },
    });
    for (const item of tasks) {
      const result = await this.prisma.$transaction(async (tx) => {
        const task = await tx.collaborationRunTask.findUnique({
          where: { id: item.id },
          include: { run: true },
        });
        const now = new Date();
        if (
          !task || task.run.status !== 'running' || task.status !== 'retry_wait'
          || !task.nextAttemptAt || task.nextAttemptAt > now
        ) return null;
        if (!await this.canExecute(tx, task.run.spaceId, task.assigneeAgentId, now)) {
          const paused = await tx.collaborationRun.updateMany({
            where: { id: task.runId, status: 'running' },
            data: { status: 'paused', pauseReason: 'agent_authorization_changed' },
          });
          if (paused.count !== 1) return null;
          await tx.collaborationRunTask.updateMany({
            where: {
              id: task.id, runId: task.runId, generation: task.generation,
              assigneeAgentId: task.assigneeAgentId, status: 'retry_wait', nextAttemptAt: { lte: now },
            },
            data: { status: 'failed', nextAttemptAt: null },
          });
          return { runId: task.runId, spaceId: task.run.spaceId };
        }
        const released = await tx.collaborationRunTask.updateMany({
          where: {
            id: task.id, runId: task.runId, generation: task.generation,
            assigneeAgentId: task.assigneeAgentId, status: 'retry_wait', nextAttemptAt: { lte: now },
            run: { status: 'running' },
          },
          data: { status: 'ready', nextAttemptAt: null },
        });
        return released.count === 1 ? { runId: task.runId, spaceId: task.run.spaceId } : null;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (result) await this.publishCommitted(result.spaceId, result.runId);
    }
  }

  private async canExecute(tx: Tx, spaceId: string, agentId: string, now: Date): Promise<boolean> {
    const grant = await tx.agentGrant.findUnique({
      where: { agentId_spaceId: { agentId, spaceId } },
      include: {
        agent: { select: { status: true, revokedAt: true } },
        space: { select: { deletedAt: true } },
        credentials: {
          where: {
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { revokedAt: true, expiresAt: true },
          take: 1,
        },
      },
    });
    return Boolean(
      grant
      && grant.agent.status === 'active'
      && !grant.agent.revokedAt
      && !grant.space.deletedAt
      && grant.credentials?.some((credential) => !credential.revokedAt && (!credential.expiresAt || credential.expiresAt > now))
      && AgentAccessRoleSchema.safeParse(grant.role).success
      && agentRoleAllowsScope(grant.role, 'collaboration:execute'),
    );
  }

  private async publishCommitted(spaceId: string, runId: string): Promise<void> {
    const run = await this.prisma.collaborationRun.findUnique({
      where: { id: runId },
      select: { eventSequence: true },
    });
    if (run) await this.notifications.publishRunChanged(spaceId, runId, run.eventSequence);
  }
}

function retryDelaySeconds(attemptNumber: number): number {
  return Math.min(300, (2 ** Math.max(0, attemptNumber)) * 5);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
