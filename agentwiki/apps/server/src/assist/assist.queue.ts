import { BadRequestException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { OpencodeRoutingError, OpencodeRunner } from './opencode.types';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { assertAssistOutputScope, assertAssistTargetVersion, validateAssistTarget } from './assist-target';
import { AssistSessionService } from './assist-session.service';
import { AgentTurnMode, AGENT_SESSION_LIMITS as LIMIT, AGENT_OUTPUT_LIMIT_ERROR } from './assist-session.types';
import { CollaborationGateway } from '../core/collaboration/collaboration.gateway';

export type { AssistRunResult, OpencodeRunner } from './opencode.types';

interface ClaimedAssistTask {
  id: string; intent: string; pageId: string | null; spaceId: string;
  requestedByUserId: string | null; pageSnapshot: unknown; leaseExpiresAtMs?: number;
  sessionId?: string | null; mode?: AgentTurnMode;
}

@Injectable()
export class AssistQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistQueue.name);
  private timer?: NodeJS.Timeout;
  private active = 0;
  private ticking = false;
  private stopped = false;
  private workerEnabled = false;
  private readonly workerId = randomUUID();
  private lastRecoveryAt = 0;
  private readonly aborts = new Set<AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject('OPENCODE_RUNNER')
    private readonly runner: OpencodeRunner,
    private readonly collaborationGateway: CollaborationGateway,
    private readonly authorization: AuthorizationService,
    private readonly revisionWriter: SpaceRevisionWriterService,
    private readonly sessions?: AssistSessionService,
  ) {}

  async onModuleInit() {
    const role = String(this.config.get('PROCESS_ROLE') || 'api').toLowerCase();
    this.workerEnabled = role === 'worker' || role === 'all';
    if (!this.workerEnabled) return;
    await this.recoverExpiredLeases();
    this.timer = setInterval(() => void this.safeTick(), Number(this.config.get('ASSIST_QUEUE_POLL_MS') || 2_000));
    void this.safeTick();
  }

  // Re-queue tasks whose worker died mid-run (lease expired without completion).
  private async recoverExpiredLeases() {
    const now = new Date();
    const expired = await this.prisma.assistTask.findMany({
      where: {
        status: 'running',
        leaseExpiresAt: { lte: now },
      },
      select: { id: true, attempts: true, maxAttempts: true },
    });
    if (expired.length === 0) return;

    const exhaustedIds = expired
      .filter((t) => t.attempts >= t.maxAttempts)
      .map((t) => t.id);
    if (exhaustedIds.length > 0) {
      await this.prisma.assistTask.updateMany({
        where: { id: { in: exhaustedIds }, status: 'running', leaseExpiresAt: { lte: now } },
        data: {
          status: 'failed',
          error: 'Assistant retry budget exhausted',
          lockedAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: now,
        },
      });
      this.logger.warn(`Assist retry budget exhausted for ${exhaustedIds.length} task(s)`);
    }

    const retryIds = expired
      .filter((t) => t.attempts < t.maxAttempts)
      .map((t) => t.id);
    if (retryIds.length > 0) {
      // Requeue with a backoff delay so a persistently failing model does not
      // spin hot.
      await this.prisma.assistTask.updateMany({
        where: { id: { in: retryIds }, status: 'running', leaseExpiresAt: { lte: now } },
        data: {
          status: 'queued',
          lockedAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          attempts: { increment: 1 },
          nextAttemptAt: new Date(now.getTime() + 15_000),
        },
      });
      this.logger.warn(`Recovered ${retryIds.length} expired assist task(s)`);
    }
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const abort of this.aborts) abort.abort();
  }

  enqueue() { if (this.workerEnabled) void this.safeTick(); }

  private async safeTick() {
    try {
      await this.tick();
    } catch (error) {
      this.logger.error('Assist queue tick failed', error instanceof Error ? error.stack || error.message : String(error));
    }
  }

  private async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      if (Date.now() - (this.lastRecoveryAt || 0) >= Number(this.config.get('ASSIST_RECOVERY_POLL_MS') || 30_000)) {
        await this.recoverExpiredLeases();
        this.lastRecoveryAt = Date.now();
      }
      const concurrency = Number(this.config.get('ASSIST_CONCURRENCY') || 1);
      // Keep the worker lease longer than the five-minute provider budget so
      // the model can finish and the completion transaction can still commit.
      const leaseMs = Number(this.config.get('ASSIST_LEASE_MS') || 6 * 60_000);
      while (this.active < concurrency) {
        const candidate = await this.prisma.assistTask.findFirst({
          where: {
            status: 'queued',
            space: { deletedAt: null },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, intent: true, pageId: true, spaceId: true, requestedByUserId: true, pageSnapshot: true, sessionId: true, mode: true },
        });
        if (!candidate) break;
        const leaseExpiresAt = new Date(Date.now() + leaseMs);
        const claim = await this.prisma.assistTask.updateMany({
          where: { id: candidate.id, status: 'queued' },
          data: { status: 'running', lockedAt: new Date(), leaseOwner: this.workerId, leaseExpiresAt },
        });
        if (!claim.count) continue;
        this.active += 1;
        void this.processOne({ ...candidate, mode: candidate.mode as AgentTurnMode, leaseExpiresAtMs: leaseExpiresAt.getTime() }).catch(() => undefined).finally(() => {
          this.active -= 1;
          void this.safeTick();
        });
      }
    } finally {
      this.ticking = false;
    }
  }

  private async processOne(task: ClaimedAssistTask) {
    const abort = new AbortController();
    this.aborts.add(abort);
    let observing = false;
    let monitor: NodeJS.Timeout | undefined;
    let leaseTimer: NodeJS.Timeout | undefined;
    let progress = Promise.resolve();
    try {
      if (!await this.isTaskActive(task)) throw new BadRequestException('Assist authorization is no longer valid');
      const execution = task.sessionId ? await this.prisma.$transaction(tx => this.sessionContext(tx, task)) : undefined;
      if (this.stopped) abort.abort();
      if (task.leaseExpiresAtMs !== undefined) {
        leaseTimer = setTimeout(() => abort.abort(), Math.max(0, task.leaseExpiresAtMs - Date.now()));
        leaseTimer.unref();
      }
      monitor = setInterval(() => {
        if (observing || abort.signal.aborted) return;
        observing = true;
        void this.isTaskActive(task).then(active => { if (!active) abort.abort(); })
          .catch(() => abort.abort()).finally(() => { observing = false; });
      }, 500);
      monitor.unref();
      const result = await this.runner.run({
        intent: task.intent, pageSnapshot: task.pageSnapshot, mode: task.mode,
        ...execution, signal: abort.signal,
        leaseExpiresAtMs: task.leaseExpiresAtMs,
        isActive: () => this.isTaskActive(task),
        ...(task.sessionId ? {
          onAnswerText: (answer: string) => {
            if (abort.signal.aborted || !answer.trim() || answer.length > LIMIT.answer) return;
            progress = progress.then(async () => {
              if (abort.signal.aborted) return;
              const write = await this.prisma.$transaction(async tx => {
                await this.sessionContext(tx, task);
                return tx.assistTask.updateMany({ where: this.activeTaskWhere(task), data: { progressText: answer, progressVersion: { increment: 1 } } });
              });
              if (!write.count) abort.abort();
            }).catch(() => { abort.abort(); });
          },
        } : {
          onStreamChunk: (chunk: string) => {
            if (task.pageId && !abort.signal.aborted) this.collaborationGateway.emitAssistStream(task.pageId, task.id, chunk);
          },
        }),
      });
      await progress;
      if (abort.signal.aborted) throw new BadRequestException('Assist execution stopped');
      if (task.sessionId) {
        if (typeof result.summary === 'string' && (result.summary.length > LIMIT.answer || JSON.stringify({ summary: result.summary, changes: result.changes }).length > LIMIT.output)) throw new BadRequestException(AGENT_OUTPUT_LIMIT_ERROR);
        if (typeof result.summary !== 'string' || !result.summary.trim()) throw new BadRequestException('Missing assistant answer');
        if (task.mode === 'question') {
          if (result.changes !== undefined && result.changes !== '') throw new BadRequestException('Questions cannot generate changes');
          delete result.changes;
        } else if (typeof result.changes !== 'string' || !result.changes.trim()) throw new BadRequestException('Missing assistant proposal');
      }
      if (task.mode !== 'question') assertAssistOutputScope(task.pageSnapshot, result.changes);
      const completion = await this.prisma.$transaction(async (tx) => {
        if (!task.requestedByUserId) throw new BadRequestException('Assist requester is required');
        // Same User -> Space lock order as membership and Page writers, held
        // through publication. Cancellation also takes these locks.
        await this.authorization.lockLiveHumanPrincipal(tx, { userId: task.requestedByUserId });
        const lockedTx = await this.revisionWriter.lockSpace(tx, task.spaceId);
        await this.assertTaskAuthorization(lockedTx, task);
        if (abort.signal.aborted) return { count: 0 };
        return lockedTx.assistTask.updateMany({
          where: this.activeTaskWhere(task),
          data: { status: 'done', result: (task.sessionId ? { summary: result.summary, ...(result.changes ? { changes: result.changes } : {}) } : result) as unknown as Prisma.InputJsonValue,
            ...(task.sessionId ? { progressText: result.summary, progressVersion: { increment: 1 } } : {}),
            completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lockedAt: null },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      if (completion.count && task.pageId && !task.sessionId) this.collaborationGateway.emitAssistComplete(task.pageId, task.id);
    } catch (error: unknown) {
      const routing = error instanceof OpencodeRoutingError ? error : undefined;
      const outputLimit = (error instanceof BadRequestException && error.message === AGENT_OUTPUT_LIMIT_ERROR) || routing?.result.attempts?.some(attempt => attempt.errorCode === 'output_limit');
      const completion = await this.prisma.assistTask.updateMany({
        where: this.activeTaskWhere(task),
        data: {
          status: 'failed', error: task.sessionId ? (outputLimit ? AGENT_OUTPUT_LIMIT_ERROR : 'Assistant failed; retry with a new turn') : routing ? routing.message : 'Editing assistant failed',
          ...(routing && !task.sessionId ? { result: routing.result as any } : {}),
          ...(task.sessionId ? { progressText: '' } : {}),
          completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lockedAt: null,
        },
      });
      if (completion.count && task.pageId && !task.sessionId) this.collaborationGateway.emitAssistError(task.pageId, task.id, routing ? routing.message : 'Editing assistant failed');
    } finally {
      abort.abort();
      if (monitor) clearInterval(monitor);
      if (leaseTimer) clearTimeout(leaseTimer);
      this.aborts.delete(abort);
    }
  }

  private sessionContext(tx: Prisma.TransactionClient, task: ClaimedAssistTask) {
    if (!this.sessions) throw new BadRequestException('Session authorization unavailable');
    return this.sessions.executionContext(tx, { id: task.id, sessionId: task.sessionId || null, spaceId: task.spaceId, requestedByUserId: task.requestedByUserId });
  }

  private activeTaskWhere(task: ClaimedAssistTask) {
    return {
      id: task.id, status: 'running', leaseOwner: this.workerId,
      spaceId: task.spaceId, pageId: task.pageId ?? null,
      requestedByUserId: task.requestedByUserId,
      leaseExpiresAt: { gt: new Date() }, space: { deletedAt: null },
    };
  }

  private async assertTaskAuthorization(tx: Prisma.TransactionClient, task: ClaimedAssistTask) {
    if (!task.requestedByUserId || !task.spaceId) throw new BadRequestException('Assist requester is required');
    if (task.sessionId) { await this.sessionContext(tx, task); return; }
    await this.authorization.assertLiveHumanSpaceAccess(tx, { userId: task.requestedByUserId }, task.spaceId, ['owner', 'editor']);
    const target = validateAssistTarget(task.pageSnapshot);
    if (target && !task.pageId) throw new BadRequestException('Scoped Assist requires a page');
    if (task.pageId) {
      const page = await tx.page.findFirst({
        where: { id: task.pageId, spaceId: task.spaceId, deletedAt: null },
        select: { id: true, updatedAt: true },
      });
      if (!page) throw new BadRequestException('Assist page must belong to the selected Space');
      assertAssistTargetVersion(target, page.updatedAt);
    }
  }

  private async isTaskActive(task: ClaimedAssistTask): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (await tx.assistTask.count({ where: this.activeTaskWhere(task) }) !== 1) return false;
        await this.assertTaskAuthorization(tx, task);
        return true;
      });
    } catch {
      return false;
    }
  }
}
