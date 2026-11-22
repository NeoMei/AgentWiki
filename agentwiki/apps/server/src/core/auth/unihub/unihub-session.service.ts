import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { UniHubIdentityBinding } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { UniHubClient, UniHubRuntimeError } from './unihub-client';

@Injectable()
export class UniHubSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: UniHubClient,
  ) {}

  async bind(userId: string, centralUserId: string, authVersion: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.uniHubIdentityBinding.createMany({
        data: { userId, centralUserId, syncedAuthVersion: authVersion },
        skipDuplicates: true,
      });
      if (created.count) return;
      const binding = await tx.uniHubIdentityBinding.findUnique({ where: { userId } });
      if (binding?.centralUserId !== centralUserId) {
        throw new ConflictException('UniHub identity binding conflicts');
      }
      await tx.uniHubIdentityBinding.updateMany({
        where: { userId, centralUserId, syncedAuthVersion: { lt: authVersion } },
        data: { syncedAuthVersion: authVersion },
      });
    });
  }

  findBinding(userId: string): Promise<UniHubIdentityBinding | null> {
    return this.prisma.uniHubIdentityBinding.findUnique({ where: { userId } });
  }

  async open(
    userId: string, centralUserId: string, sourceProofToken: string, expiresAt: number,
  ): Promise<{ sid: string; expiresAt: number }> {
    const expiry = new Date(expiresAt * 1_000);
    if (!sourceProofToken || !Number.isSafeInteger(expiresAt) ||
        !Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      throw new UnauthorizedException('Invalid UniHub session proof');
    }
    const binding = await this.findBinding(userId);
    if (binding?.centralUserId !== centralUserId) {
      throw new UnauthorizedException('UniHub identity binding is unavailable');
    }
    const { sid } = await this.prisma.uniHubUserSession.create({
      data: { userId, centralUserId, sourceProofToken, expiresAt: expiry },
      select: { sid: true },
    });
    return { sid, expiresAt };
  }

  async revoke(sid: string, userId: string): Promise<void> {
    await this.prisma.uniHubUserSession.updateMany({
      where: { sid, userId, revokedAt: null },
      data: { revokedAt: new Date(), sourceProofToken: '' },
    });
  }

  async verify(sid: string, userId: string): Promise<boolean> {
    if (!this.client.allowsLocalUser(userId)) return false;
    const session = await this.prisma.uniHubUserSession.findUnique({
      where: { sid, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { centralUserId: true, sourceProofToken: true },
    });
    if (!session) return false;

    try {
      await this.client.request<void>('/session/verify', {
        source_proof_token: session.sourceProofToken,
        central_user_id: session.centralUserId,
      });
    } catch (error) {
      if (error instanceof UniHubRuntimeError && error.status === 403) await this.revoke(sid, userId);
      return false;
    }

    // A logout or definitive denial can land while UniHub is responding.
    const now = new Date();
    const updated = await this.prisma.uniHubUserSession.updateMany({
      where: { sid, userId, revokedAt: null, expiresAt: { gt: now } },
      data: { lastVerifiedAt: now },
    });
    return updated.count === 1;
  }
}
