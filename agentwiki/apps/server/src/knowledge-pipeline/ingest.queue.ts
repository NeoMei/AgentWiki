import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { SourceService } from './source.service';

@Injectable()
export class IngestQueue implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private active = 0;
  private ticking = false;
  private stopped = false;
  private workerEnabled = false;
  private readonly workerId = randomUUID();
  private lastRecoveryAt = 0;

  constructor(private prisma: PrismaService, private config: ConfigService, private sources: SourceService) {}

  async onModuleInit() {
    const role = String(this.config.get('PROCESS_ROLE') || 'api').toLowerCase();
    this.workerEnabled = role === 'worker' || role === 'all';
    if (!this.workerEnabled) return;
    await this.sources.recoverInterruptedRuns();
    this.lastRecoveryAt = Date.now();
    this.timer = setInterval(() => void this.tick(), Number(this.config.get('INGEST_QUEUE_POLL_MS') || 1_000));
    void this.tick();
  }

  enqueue() { if (this.workerEnabled) void this.tick(); }

  private async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      const recoveryInterval = Number(this.config.get('INGEST_RECOVERY_POLL_MS') || 30_000);
      if (Date.now() - this.lastRecoveryAt >= recoveryInterval) {
        await this.sources.recoverInterruptedRuns();
        this.lastRecoveryAt = Date.now();
      }
      const concurrency = Number(this.config.get('INGEST_CONCURRENCY') || 2);
      const leaseMs = Number(this.config.get('INGEST_LEASE_MS') || 5 * 60_000);
      while (this.active < concurrency) {
        const candidate = await this.prisma.ingestRun.findFirst({
          where: { status: 'queued', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!candidate) break;
        const claim = await this.prisma.ingestRun.updateMany({
          where: { id: candidate.id, status: 'queued' },
          data: {
            status: 'reserved',
            lockedAt: new Date(),
            leaseOwner: this.workerId,
            leaseExpiresAt: new Date(Date.now() + leaseMs),
          },
        });
        if (!claim.count) continue;
        this.active += 1;
        void this.sources.processRun(candidate.id, this.workerId).catch(() => undefined).finally(() => {
          this.active -= 1;
          void this.tick();
        });
      }
    } finally {
      this.ticking = false;
    }
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
}
