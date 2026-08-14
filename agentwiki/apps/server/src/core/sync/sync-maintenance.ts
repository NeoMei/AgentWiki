import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RevisionRetentionService } from './revision-retention.service';

const INTERVAL_MS = 60 * 60 * 1_000;

@Injectable()
export class SyncMaintenance implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly retention: RevisionRetentionService,
  ) {}

  onModuleInit() {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    await this.expirePushSessions();
    const spaces = await this.prisma.space.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    for (const space of spaces) {
      try {
        await this.retention.cleanSpace(space.id);
      } catch (error) {
        // A single space failure must not block other spaces.
      }
    }
  }

  private async expirePushSessions() {
    // Published/aborted sessions keep their persisted result; uploading and
    // ready_to_finalize sessions transition to expired once past TTL.
    await this.prisma.pushSession.updateMany({
      where: {
        status: { in: ['uploading', 'ready_to_finalize'] },
        expiresAt: { lt: new Date() },
      },
      data: { status: 'expired' },
    });
  }
}
