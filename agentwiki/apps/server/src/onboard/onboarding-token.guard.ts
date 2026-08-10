import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';

export type OnboardingPrincipal = {
  sessionId: string;
  userId: string;
  packageVersion: string;
  requestedCapabilities: string[];
};

@Injectable()
export class OnboardingTokenGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.bearerToken(request.headers?.authorization);
    if (!token || !/^awo_[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new UnauthorizedException('Invalid onboarding token');
    }

    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    const stored = await this.prisma.onboardingDeviceSession.findUnique({
      where: { onboardingTokenHash: tokenHash },
    });
    if (!stored || !stored.onboardingTokenHash || !this.sameHash(tokenHash, stored.onboardingTokenHash)) {
      throw new UnauthorizedException('Invalid onboarding token');
    }
    if (stored.status !== 'authorized' || stored.tokenConsumedAt) {
      throw new BusinessException('AUTH_EXPIRED', 'Onboarding token is no longer active');
    }
    if (!stored.tokenExpiresAt || stored.tokenExpiresAt.getTime() <= Date.now()) {
      throw new BusinessException('AUTH_EXPIRED', 'Onboarding token has expired');
    }
    if (!stored.authorizedUserId) throw new BusinessException('AUTH_DENIED');
    const user = await this.prisma.user.findUnique({
      where: { id: stored.authorizedUserId },
      select: { id: true, type: true, lockedAt: true, deletedAt: true },
    });
    if (!user || user.type !== 'human' || user.lockedAt || user.deletedAt) {
      throw new BusinessException('AUTH_DENIED', 'The authorizing user is unavailable');
    }

    request.onboarding = {
      sessionId: stored.id,
      userId: stored.authorizedUserId,
      packageVersion: stored.packageVersion,
      requestedCapabilities: [...stored.requestedCapabilities],
    } satisfies OnboardingPrincipal;
    return true;
  }

  private bearerToken(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = /^Bearer\s+([^\s]+)$/i.exec(value.trim());
    return match?.[1] || null;
  }

  private sameHash(left: string, right: string): boolean {
    if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
    return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
  }
}
