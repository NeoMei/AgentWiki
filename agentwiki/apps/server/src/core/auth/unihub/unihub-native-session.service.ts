import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../../database/prisma.service';
import { UniHubClient } from './unihub-client';

export interface UniHubNativeBrowserProof {
  id: string;
  expiresAt: number;
}

export function fingerprintNativeJwt(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class UniHubNativeSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UniHubNativeSessionService.name);
  private timer?: ReturnType<typeof setInterval>;
  private flushing?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: UniHubClient,
  ) {}

  // Also used by the collaboration module without starting another delivery worker.
  static async isRevoked(prisma: PrismaService, userId: string, id: string): Promise<boolean> {
    return Boolean(await prisma.uniHubNativeBrowserSession.findUnique({
      where: { id, userId, revokedAt: { not: null } },
      select: { id: true },
    }));
  }

  onModuleInit() {
    if (!this.client.lifecycleEnabled) return;
    this.timer = setInterval(() => {
      void this.flush().catch(() => this.logger.warn('UniHub native sign-out delivery failed'));
    }, 1000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.flushing?.catch(() => undefined);
  }

  async track(userId: string, proof: UniHubNativeBrowserProof): Promise<boolean> {
    await this.prisma.uniHubNativeBrowserSession.createMany({
      data: { id: proof.id, userId, expiresAt: new Date(proof.expiresAt * 1000) },
      skipDuplicates: true,
    });
    return this.active(userId, proof.id);
  }

  async active(userId: string, id: string): Promise<boolean> {
    return Boolean(await this.prisma.uniHubNativeBrowserSession.findUnique({
      where: { id, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    }));
  }

  async revoke(userId: string, proof: UniHubNativeBrowserProof): Promise<void> {
    // Current human accounts can leave local tombstones. Tracked sessions
    // still need remote delivery after the account is removed.
    await this.prisma.$executeRaw`
      WITH observed AS (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "now")
      INSERT INTO "UniHubNativeBrowserSession" ("id", "userId", "expiresAt", "revokedAt", "deliveredAt", "availableAt")
      SELECT ${proof.id}, ${userId}, to_timestamp(${proof.expiresAt}::double precision) AT TIME ZONE 'UTC',
        "now", "now", "now" FROM observed
      WHERE EXISTS (
        SELECT 1 FROM "User"
        WHERE "id" = ${userId} AND "type" = 'human' AND "deletedAt" IS NULL
      ) OR EXISTS (
        SELECT 1 FROM "UniHubNativeBrowserSession" AS tracked
        WHERE tracked."id" = ${proof.id} AND tracked."userId" = ${userId} AND tracked."revokedAt" IS NULL
      )
      ON CONFLICT ("id") DO UPDATE SET
        "revokedAt" = EXCLUDED."revokedAt", "deliveredAt" = NULL, "availableAt" = EXCLUDED."availableAt"
      WHERE "UniHubNativeBrowserSession"."userId" = EXCLUDED."userId"
        AND "UniHubNativeBrowserSession"."revokedAt" IS NULL
    `;
  }

  async flush(): Promise<void> {
    if (!this.client.lifecycleEnabled || this.flushing) return;
    this.flushing = this.deliver();
    try {
      await this.flushing;
    } finally {
      this.flushing = undefined;
    }
  }

  private async deliver() {
    const now = new Date();
    const pending = await this.prisma.uniHubNativeBrowserSession.findMany({
      where: { revokedAt: { not: null }, deliveredAt: null, availableAt: { lte: now }, expiresAt: { gt: now } },
      select: { id: true, userId: true, expiresAt: true },
      orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    for (const row of pending) {
      try {
        const receipt = await this.client.request<void>('/source-session/revoke', {
          local_user_id: row.userId,
          native_session_id: row.id,
          expires_at: Math.floor(row.expiresAt.getTime() / 1000),
        });
        if (receipt !== undefined) throw new Error('Invalid UniHub native sign-out receipt');
      } catch {
        await this.prisma.uniHubNativeBrowserSession.updateMany({
          where: { id: row.id, deliveredAt: null },
          data: { availableAt: new Date(Date.now() + 5_000) },
        });
        continue;
      }
      await this.prisma.uniHubNativeBrowserSession.updateMany({
        where: { id: row.id, deliveredAt: null },
        data: { deliveredAt: new Date() },
      });
    }
    await this.prisma.uniHubNativeBrowserSession.deleteMany({ where: { expiresAt: { lte: now } } });
  }
}
