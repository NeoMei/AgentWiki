import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { OpencodeRoutingError, OpencodeRunner } from './opencode.types';
import { CollaborationGateway } from '../core/collaboration/collaboration.gateway';

export type { AssistRunResult, OpencodeRunner } from './opencode.types';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject('OPENCODE_RUNNER')
    private readonly runner: OpencodeRunner,
    private readonly collaborationGateway: CollaborationGateway,
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
        where: { id: { in: exhaustedIds } },
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
        where: { id: { in: retryIds } },
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
      const leaseMs = Number(this.config.get('ASSIST_LEASE_MS') || 5 * 60_000);
      while (this.active < concurrency) {
        const candidate = await this.prisma.assistTask.findFirst({
          where: {
            status: 'queued',
            space: { deletedAt: null },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, intent: true, pageId: true, pageSnapshot: true },
        });
        if (!candidate) break;
        const leaseExpiresAt = new Date(Date.now() + leaseMs);
        const claim = await this.prisma.assistTask.updateMany({
          where: { id: candidate.id, status: 'queued' },
          data: { status: 'running', lockedAt: new Date(), leaseOwner: this.workerId, leaseExpiresAt },
        });
        if (!claim.count) continue;
        this.active += 1;
        void this.processOne({ ...candidate, leaseExpiresAtMs: leaseExpiresAt.getTime() }).catch(() => undefined).finally(() => {
          this.active -= 1;
          void this.safeTick();
        });
      }
    } finally {
      this.ticking = false;
    }
  }

  private async processOne(task: { id: string; intent: string; pageId: string | null; pageSnapshot: unknown; leaseExpiresAtMs?: number }) {
    try {
      const result = await this.runner.run({
        intent: task.intent,
        pageSnapshot: task.pageSnapshot,
        leaseExpiresAtMs: task.leaseExpiresAtMs,
        isActive: async () => (await this.prisma.assistTask.count({
          where: {
            id: task.id,
            status: 'running',
            leaseOwner: this.workerId,
            space: { deletedAt: null },
          },
        })) === 1,
        onStreamChunk: (chunk) => {
          if (task.pageId) {
            this.collaborationGateway.emitAssistStream(task.pageId, task.id, chunk);
          }
        },
      });
      const completion = await this.prisma.assistTask.updateMany({
        where: { id: task.id, status: 'running', leaseOwner: this.workerId },
        data: { status: 'done', result: result as any, completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
      });
      if (completion.count === 0) return;
      if (task.pageId) {
        this.collaborationGateway.emitAssistComplete(task.pageId, task.id);
      }
    } catch (error: unknown) {
      const routing = error instanceof OpencodeRoutingError ? error : undefined;
      const completion = await this.prisma.assistTask.updateMany({
        where: { id: task.id, status: 'running', leaseOwner: this.workerId },
        data: {
          status: 'failed',
          error: routing ? routing.message : 'Editing assistant failed',
          ...(routing ? { result: routing.result as any } : {}),
          completedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      if (completion.count === 0) return;
      if (task.pageId) {
        this.collaborationGateway.emitAssistError(task.pageId, task.id, routing ? routing.message : 'Editing assistant failed');
      }
    }
  }
}
