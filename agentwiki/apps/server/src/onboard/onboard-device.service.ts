import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '../core/security/audit.service';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';
import type { DeviceDecisionInput, PollDeviceInput, StartDeviceInput } from './onboard.types';

export const DEVICE_TTL_SECONDS = 600;
export const ONBOARDING_TOKEN_TTL_SECONDS = 600;
export const POLL_INTERVAL_SECONDS = 5;

const MAX_POLL_INTERVAL_SECONDS = 30;
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REQUESTED_CAPABILITIES = [
  'bootstrap:space',
  'bootstrap:agent',
  'bootstrap:grant',
  'bootstrap:installation',
];

type DeviceSession = {
  id: string;
  packageVersion: string;
  clientType: string;
  purpose: string;
  requestedCapabilities: string[];
  status: string;
  pollIntervalSeconds: number;
  pollCount: number;
  lastPolledAt: Date | null;
  authorizedUserId: string | null;
  expiresAt: Date;
  onboardingTokenHash: string | null;
  tokenExpiresAt: Date | null;
  tokenConsumedAt: Date | null;
};

@Injectable()
export class OnboardDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async start(input: StartDeviceInput, ipAddress: string) {
    await this.assertRateLimit('start-rate', ipAddress, 60, 10);
    const deviceCode = `awd_${randomBytes(32).toString('base64url')}`;
    const userCode = this.generateUserCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEVICE_TTL_SECONDS * 1_000);

    await this.prisma.onboardingDeviceSession.create({
      data: {
        deviceCodeHash: this.hash(deviceCode),
        userCodeHash: this.hash(this.normalizeUserCode(userCode)!),
        packageVersion: input.packageVersion,
        clientType: input.clientType,
        purpose: input.purpose,
        requestedCapabilities: [...REQUESTED_CAPABILITIES],
        pollIntervalSeconds: POLL_INTERVAL_SECONDS,
        expiresAt,
      },
    });
    await this.audit.record({
      action: 'onboarding.device.start',
      outcome: 'success',
      ipAddress,
      metadata: {
        packageVersion: input.packageVersion,
        clientType: input.clientType,
        purpose: input.purpose,
      },
    });

    const verificationUri = this.verificationUri();
    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
      expiresIn: DEVICE_TTL_SECONDS,
      interval: POLL_INTERVAL_SECONDS,
    };
  }

  async getPublicSession(userCode: string, ipAddress: string) {
    await this.assertRateLimit('session-rate', ipAddress, 60, 30);
    const normalized = this.normalizeUserCode(userCode);
    const stored = normalized
      ? await this.prisma.onboardingDeviceSession.findUnique({ where: { userCodeHash: this.hash(normalized) } })
      : null;
    if (!stored) {
      await this.assertRateLimit('session-invalid', ipAddress, 600, 10);
      throw new BusinessException('RESOURCE_NOT_FOUND', 'Device authorization session not found');
    }

    const current = stored.expiresAt.getTime() <= Date.now() ? 'expired' : stored.status;
    if (current === 'expired' && stored.status !== 'expired') {
      await this.prisma.onboardingDeviceSession.updateMany({
        where: { id: stored.id, status: stored.status },
        data: { status: 'expired' },
      });
    }
    return {
      clientType: stored.clientType,
      purpose: stored.purpose,
      packageVersion: stored.packageVersion,
      status: current,
      expiresAt: stored.expiresAt,
    };
  }

  async decide(
    input: DeviceDecisionInput,
    userId: string,
    ipAddress: string,
    userAgent?: string,
  ): Promise<{ status: 'approved' | 'denied' }> {
    await this.assertRateLimit('decision-rate', userId, 60, 10);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, type: true, lockedAt: true, deletedAt: true },
    });
    if (!this.isActiveHuman(user)) {
      throw new BusinessException('AUTH_DENIED', 'The human account is unavailable');
    }

    const normalized = this.normalizeUserCode(input.userCode);
    const stored = normalized
      ? await this.prisma.onboardingDeviceSession.findUnique({ where: { userCodeHash: this.hash(normalized) } })
      : null;
    if (!stored) throw new BusinessException('RESOURCE_NOT_FOUND', 'Device authorization session not found');

    const desired = input.decision === 'approve' ? 'approved' : 'denied';
    if (stored.status === desired || (desired === 'approved' && stored.status === 'authorized')) {
      return { status: desired };
    }
    if (stored.expiresAt.getTime() <= Date.now() || stored.status === 'expired') {
      await this.expire(stored);
      throw new BusinessException('AUTH_EXPIRED');
    }

    if (stored.status !== 'pending') {
      throw new BusinessException('RESOURCE_CONFLICT', 'Device authorization already has a different decision');
    }

    const now = new Date();
    const data = input.decision === 'approve'
      ? { status: 'approved', authorizedUserId: userId, approvedAt: now }
      : { status: 'denied', deniedAt: now };
    const changed = await this.prisma.onboardingDeviceSession.updateMany({
      where: { id: stored.id, status: 'pending', expiresAt: { gt: now } },
      data,
    });
    if (!changed.count) {
      const latest = await this.prisma.onboardingDeviceSession.findUnique({ where: { id: stored.id } });
      if (latest?.status === desired) return { status: desired };
      if (!latest || latest.expiresAt.getTime() <= Date.now() || latest.status === 'expired') {
        throw new BusinessException('AUTH_EXPIRED');
      }
      throw new BusinessException('RESOURCE_CONFLICT', 'Device authorization already has a different decision');
    }

    await this.audit.record({
      action: `onboarding.device.${desired}`,
      outcome: input.decision === 'approve' ? 'success' : 'denied',
      actorUserId: userId,
      ipAddress,
      userAgent,
      metadata: { clientType: stored.clientType, purpose: stored.purpose },
    });
    return { status: desired };
  }

  async poll(input: PollDeviceInput, ipAddress: string): Promise<Record<string, unknown>> {
    await this.assertRateLimit('poll-rate', ipAddress, 60, 120);
    const stored = await this.prisma.onboardingDeviceSession.findUnique({
      where: { deviceCodeHash: this.hash(input.deviceCode) },
    }) as DeviceSession | null;
    if (!stored) return { status: 'expired' };
    if (stored.status === 'authorized') return { status: 'authorization_consumed' };

    const now = new Date();
    if (stored.expiresAt.getTime() <= now.getTime() || stored.status === 'expired') {
      await this.expire(stored);
      return { status: 'expired' };
    }
    if (this.isEarlyPoll(stored, now)) {
      const interval = Math.min(stored.pollIntervalSeconds + POLL_INTERVAL_SECONDS, MAX_POLL_INTERVAL_SECONDS);
      await this.prisma.onboardingDeviceSession.updateMany({
        where: { id: stored.id, pollIntervalSeconds: stored.pollIntervalSeconds },
        data: { pollIntervalSeconds: interval },
      });
      return { status: 'slow_down', interval };
    }

    if (stored.status === 'approved') return this.issueToken(stored, now, ipAddress);
    if (stored.status === 'denied') {
      await this.recordNormalPoll(stored, now);
      return { status: 'denied' };
    }
    if (stored.status !== 'pending') return { status: 'expired' };

    await this.recordNormalPoll(stored, now);
    return { status: 'authorization_pending' };
  }

  private async issueToken(stored: DeviceSession, now: Date, ipAddress: string) {
    const user = stored.authorizedUserId
      ? await this.prisma.user.findUnique({
        where: { id: stored.authorizedUserId },
        select: { id: true, type: true, lockedAt: true, deletedAt: true },
      })
      : null;
    if (!this.isActiveHuman(user)) {
      await this.prisma.onboardingDeviceSession.updateMany({
        where: { id: stored.id, status: 'approved' },
        data: { status: 'denied', deniedAt: now },
      });
      return { status: 'denied' };
    }

    const onboardingToken = `awo_${randomBytes(32).toString('base64url')}`;
    const tokenExpiresAt = new Date(now.getTime() + ONBOARDING_TOKEN_TTL_SECONDS * 1_000);
    const changed = await this.prisma.onboardingDeviceSession.updateMany({
      where: { id: stored.id, status: 'approved', onboardingTokenHash: null },
      data: {
        status: 'authorized',
        onboardingTokenHash: this.hash(onboardingToken),
        tokenExpiresAt,
        lastPolledAt: now,
        pollCount: { increment: 1 },
      },
    });
    if (!changed.count) return { status: 'authorization_consumed' };

    await this.audit.record({
      action: 'onboarding.device.token-issued',
      outcome: 'success',
      actorUserId: stored.authorizedUserId || undefined,
      ipAddress,
      metadata: { clientType: stored.clientType, purpose: stored.purpose },
    });
    return { status: 'authorized', onboardingToken, expiresIn: ONBOARDING_TOKEN_TTL_SECONDS };
  }

  private async recordNormalPoll(stored: DeviceSession, now: Date): Promise<void> {
    await this.prisma.onboardingDeviceSession.updateMany({
      where: { id: stored.id, status: stored.status, lastPolledAt: stored.lastPolledAt },
      data: { lastPolledAt: now, pollCount: { increment: 1 } },
    });
  }

  private async expire(stored: Pick<DeviceSession, 'id' | 'status'>): Promise<void> {
    if (stored.status === 'expired') return;
    await this.prisma.onboardingDeviceSession.updateMany({
      where: { id: stored.id, status: stored.status },
      data: { status: 'expired' },
    });
  }

  private isEarlyPoll(stored: DeviceSession, now: Date): boolean {
    return stored.lastPolledAt !== null
      && now.getTime() - stored.lastPolledAt.getTime() < stored.pollIntervalSeconds * 1_000;
  }

  private isActiveHuman(user: { type?: string; lockedAt?: Date | null; deletedAt?: Date | null } | null): boolean {
    return Boolean(user && user.type === 'human' && !user.lockedAt && !user.deletedAt);
  }

  private async assertRateLimit(kind: string, identity: string, windowSeconds: number, limit: number): Promise<void> {
    const bucket = Math.floor(Date.now() / (windowSeconds * 1_000));
    const identityHash = this.hash(identity || 'unknown').slice(0, 16);
    const count = await this.redis.incrementWithWindow(
      `onboarding:${kind}:${bucket}:${identityHash}`,
      windowSeconds + 1,
    );
    if (count === null || count > limit) {
      throw new BusinessException('AUTH_RATE_LIMITED', 'Too many onboarding requests');
    }
  }

  private generateUserCode(): string {
    const bytes = randomBytes(8);
    const normalized = Array.from(bytes, (byte) => USER_CODE_ALPHABET[byte & 31]).join('');
    return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
  }

  private normalizeUserCode(value: string): string | null {
    const normalized = String(value || '').toUpperCase().replace(/[\s-]/g, '');
    return /^[A-HJ-NP-Z2-9]{8}$/.test(normalized) ? normalized : null;
  }

  private verificationUri(): string {
    const configured = this.config.get<string>('PUBLIC_WEB_URL')
      || this.config.get<string>('PUBLIC_BASE_URL')
      || 'https://agentwiki.quukk.com';
    return new URL('/onboard/device', configured).toString().replace(/\/$/, '');
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
