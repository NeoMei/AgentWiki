import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { OpencodeRoutingError, OpencodeRunner } from './opencode.types';

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
    await this.prisma.assistTask.updateMany({
      where: { status: 'running', leaseExpiresAt: { lte: new Date() } },
      data: { status: 'queued', lockedAt: null, leaseOwner: null, leaseExpiresAt: null, attempts: { increment: 1 } },
    });
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
          select: { id: true, intent: true, pageSnapshot: true },
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

  private async processOne(task: { id: string; intent: string; pageSnapshot: unknown; leaseExpiresAtMs?: number }) {
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
      });
      const completion = await this.prisma.assistTask.updateMany({
        where: { id: task.id, status: 'running', leaseOwner: this.workerId },
        data: { status: 'done', result: result as any, completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
      });
      if (completion.count === 0) return;
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
    }
  }
}
