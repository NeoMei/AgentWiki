import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes } from 'crypto';
import { AuditService } from '../core/security/audit.service';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';
import type { ObsidianIntegrationService } from '../integrations/obsidian/obsidian-integration.service';
import type { DeviceDecisionInput, PollDeviceInput, StartDeviceInput, StartObsidianDeviceInput } from './onboard.types';

export const DEVICE_TTL_SECONDS = 600;
export const ONBOARDING_TOKEN_TTL_SECONDS = 600;
export const POLL_INTERVAL_SECONDS = 5;

const MAX_POLL_INTERVAL_SECONDS = 30;
const MAX_POLL_CAS_ATTEMPTS = 6;
const POLL_CAS_RETRY = Symbol('poll-cas-retry');
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REQUESTED_CAPABILITIES = [
  'bootstrap:space',
  'bootstrap:agent',
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
  private readonly logger = new Logger(OnboardDeviceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async start(input: StartDeviceInput | StartObsidianDeviceInput, ipAddress: string) {
    await this.assertRateLimit('start-rate', ipAddress, 60, 10);
    const deviceCode = `awd_${randomBytes(32).toString('base64url')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEVICE_TTL_SECONDS * 1_000);

    const userCode = input.purpose === 'agent-connect'
      ? this.renewalUserCode(deviceCode, expiresAt) : this.generateUserCode();

    await this.prisma.onboardingDeviceSession.create({
      data: {
        deviceCodeHash: this.hash(deviceCode),
        userCodeHash: this.hash(this.normalizeUserCode(userCode)!),
        packageVersion: input.packageVersion,
        clientType: input.clientType,
        purpose: input.purpose,
        requestedCapabilities: input.purpose === 'obsidian-connect' ? [] : [...REQUESTED_CAPABILITIES],
        pollIntervalSeconds: POLL_INTERVAL_SECONDS,
        expiresAt,
      },
    });
    await this.recordAuditBestEffort({
      action: 'onboarding.device.start',
      outcome: 'success',
      ipAddress,
      metadata: {
        packageVersion: input.packageVersion,
        clientType: input.clientType,
        purpose: input.purpose,
      },
    }, 'device session creation');

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
        where: { id: stored.id, status: stored.status, expiresAt: stored.expiresAt },
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

    if (stored.authorizedUserId && stored.authorizedUserId !== userId) {
      throw new BusinessException('AUTH_DENIED', 'Authorization belongs to a different account');
    }
    const desired = input.decision === 'approve' ? 'approved' : 'denied';
    if (stored.expiresAt.getTime() <= Date.now() || stored.status === 'expired') {
      await this.expire(stored);
      throw new BusinessException('AUTH_EXPIRED');
    }

    if (this.isEquivalentDecision(stored.status, desired)) return { status: desired };
    if (stored.status !== 'pending') {
      throw new BusinessException('RESOURCE_CONFLICT', 'Device authorization already has a different decision');
    }

    const now = new Date();
    const data = input.decision === 'approve'
      ? { status: 'approved', authorizedUserId: userId, approvedAt: now }
      : { status: 'denied', deniedAt: now };
    const changed = await this.prisma.onboardingDeviceSession.updateMany({
      where: { id: stored.id, status: 'pending', userCodeHash: stored.userCodeHash,
        authorizedUserId: stored.authorizedUserId, expiresAt: stored.expiresAt, AND: { expiresAt: { gt: now } } },
      data,
    });
    if (!changed.count) {
      const latest = await this.prisma.onboardingDeviceSession.findUnique({ where: { id: stored.id } });
      if (latest && this.isEquivalentDecision(latest.status, desired)
        && latest.userCodeHash === stored.userCodeHash && latest.expiresAt.getTime() === stored.expiresAt.getTime()
        && (!latest.authorizedUserId || latest.authorizedUserId === userId)
        && latest.expiresAt.getTime() > Date.now()) return { status: desired };
      if (!latest || latest.expiresAt.getTime() <= Date.now() || latest.status === 'expired') {
        throw new BusinessException('AUTH_EXPIRED');
      }
      throw new BusinessException('RESOURCE_CONFLICT', 'Device authorization already has a different decision');
    }

    await this.recordAuditBestEffort({
      action: `onboarding.device.${desired}`,
      outcome: input.decision === 'approve' ? 'success' : 'denied',
      actorUserId: userId,
      ipAddress,
      userAgent,
      metadata: { clientType: stored.clientType, purpose: stored.purpose },
    }, 'device decision');
    return { status: desired };
  }

  async poll(input: PollDeviceInput, ipAddress: string): Promise<Record<string, unknown>> {
    await this.assertRateLimit('poll-rate', ipAddress, 60, 120);
    const deviceCodeHash = this.hash(input.deviceCode);
    const now = new Date();
    for (let attempt = 0; attempt < MAX_POLL_CAS_ATTEMPTS; attempt += 1) {
      const stored = await this.prisma.onboardingDeviceSession.findUnique({
        where: { deviceCodeHash },
      }) as DeviceSession | null;
      if (!stored || !['full-onboarding', 'agent-connect'].includes(stored.purpose)) return { status: 'expired' };
      const result = stored.purpose === 'agent-connect'
        ? await this.pollAgentConnection(stored, input.deviceCode, now, ipAddress)
        : await this.evaluatePoll(stored, now, ipAddress);
      if (result !== POLL_CAS_RETRY) return result;
    }
    throw new BusinessException('RESOURCE_CONFLICT', 'Concurrent onboarding update; retry poll');
  }

  /** Replay secrets are derived from the client-only 256-bit device secret, never its stored hash.
   * Domain, session and authorization expiry bind each value to one purpose and renewal. */
  private connectionSecret(deviceCode: string, domain: string, stored: Pick<DeviceSession, 'id' | 'expiresAt'>): string {
    return createHmac('sha256', deviceCode).update(domain).update('\0')
      .update(stored.id).update('\0').update(stored.expiresAt.toISOString()).digest('base64url');
  }

  private async pollAgentConnection(stored: DeviceSession, deviceCode: string, now: Date, ipAddress: string) {
    if (stored.expiresAt <= now || stored.status === 'expired') return { status: 'expired' };
    if (stored.status !== 'approved' && stored.status !== 'authorized') return this.evaluatePoll(stored, now, ipAddress);
    const user = stored.authorizedUserId ? await this.prisma.user.findUnique({ where: {id: stored.authorizedUserId} }) : null;
    if (!this.isActiveHuman(user)) return {status: 'denied'};
    const onboardingToken = `awo_${this.connectionSecret(deviceCode, 'agent-connect-token-v1', stored)}`;
    if (stored.status === 'authorized') {
      if (!stored.tokenExpiresAt || stored.tokenExpiresAt <= now || stored.onboardingTokenHash !== this.hash(onboardingToken)) return {status: 'expired'};
    } else {
      const changed = await this.prisma.onboardingDeviceSession.updateMany({
        where: {id: stored.id, status: 'approved', purpose: 'agent-connect', authorizedUserId: stored.authorizedUserId, expiresAt: stored.expiresAt},
        data: {status: 'authorized', onboardingTokenHash: this.hash(onboardingToken), tokenExpiresAt: stored.expiresAt, lastPolledAt: now, pollCount: {increment: 1}},
      });
      if (!changed.count) return POLL_CAS_RETRY;
      await this.recordAuditBestEffort({action: 'onboarding.device.token-issued', outcome: 'success', actorUserId: stored.authorizedUserId!, ipAddress, metadata: {purpose: stored.purpose}}, 'Agent connection authorization');
    }
    return {status: 'authorized', onboardingToken, expiresIn: Math.max(0, Math.min(DEVICE_TTL_SECONDS, Math.ceil((stored.expiresAt.getTime() - now.getTime()) / 1000)))};
  }

  async pollObsidian(input: PollDeviceInput, ipAddress: string, installations: ObsidianIntegrationService): Promise<Record<string, unknown>> {
    await this.assertRateLimit('poll-rate', ipAddress, 60, 120);
    for (let attempt = 0; attempt < MAX_POLL_CAS_ATTEMPTS; attempt++) {
      const result = await this.prisma.$transaction(async tx => {
        const stored = await tx.onboardingDeviceSession.findUnique({where: {deviceCodeHash: this.hash(input.deviceCode)}});
        const now = new Date();
        if (!stored || stored.purpose !== 'obsidian-connect' || stored.clientType !== 'obsidian' || stored.expiresAt <= now || stored.status === 'expired') return {status: 'expired'};
        if (stored.status === 'denied') return {status: 'denied'};
        if (stored.status === 'pending') {
          const early = this.isEarlyPoll(stored, now);
          const interval = Math.min(stored.pollIntervalSeconds + POLL_INTERVAL_SECONDS, MAX_POLL_INTERVAL_SECONDS);
          const changed = await tx.onboardingDeviceSession.updateMany({
            where: {id: stored.id, status: 'pending', expiresAt: stored.expiresAt, lastPolledAt: stored.lastPolledAt, pollIntervalSeconds: stored.pollIntervalSeconds},
            data: early ? {pollIntervalSeconds: interval} : {lastPolledAt: now, pollCount: {increment: 1}},
          });
          if (!changed.count) return POLL_CAS_RETRY;
          return early ? {status: 'slow_down', interval} : {status: 'authorization_pending'};
        }
        if (!['approved', 'authorized'].includes(stored.status)) return {status: 'expired'};
        const user = stored.authorizedUserId ? await tx.user.findUnique({where: {id: stored.authorizedUserId}}) : null;
        if (!this.isActiveHuman(user)) return {status: 'denied'};
        const code = this.connectionSecret(input.deviceCode, 'obsidian-installation-v1', stored);
        if (stored.status === 'approved') {
          const changed = await tx.onboardingDeviceSession.updateMany({
            where: {id: stored.id, status: 'approved', purpose: 'obsidian-connect', authorizedUserId: stored.authorizedUserId, expiresAt: stored.expiresAt},
            data: {status: 'authorized', lastPolledAt: now, pollCount: {increment: 1}},
          });
          if (!changed.count) return POLL_CAS_RETRY;
          await installations.issueForDevice(tx, {code, userId: stored.authorizedUserId!, expiresAt: stored.expiresAt});
        } else if (!await installations.canReplayDeviceCode(tx, code, stored.authorizedUserId!)) return {status: 'expired'};
        return {status: 'authorized', code, expiresIn: Math.max(0, Math.min(DEVICE_TTL_SECONDS, Math.ceil((stored.expiresAt.getTime() - now.getTime()) / 1000)))};
      });
      if (result !== POLL_CAS_RETRY) {
        if (result.status === 'authorized') await this.recordAuditBestEffort({action: 'onboarding.device.obsidian-authorized', outcome: 'success', ipAddress, metadata: {purpose: 'obsidian-connect'}}, 'Obsidian connection authorization');
        return result;
      }
    }
    throw new BusinessException('RESOURCE_CONFLICT', 'Concurrent connection update; retry poll');
  }

  async renew(input: PollDeviceInput, ipAddress: string) {
    await this.assertRateLimit('renew-rate', ipAddress, 60, 10);
    for (let attempt = 0; attempt < MAX_POLL_CAS_ATTEMPTS; attempt++) {
      const stored = await this.prisma.onboardingDeviceSession.findUnique({where: {deviceCodeHash: this.hash(input.deviceCode)}});
      if (!stored || stored.purpose !== 'agent-connect') throw new BusinessException('AUTH_DENIED');
      if (stored.authorizedUserId) {
        const user = await this.prisma.user.findUnique({where: {id: stored.authorizedUserId}});
        if (!this.isActiveHuman(user)) throw new BusinessException('AUTH_DENIED');
      }
      const now = new Date();
      if (stored.status === 'pending' && stored.expiresAt > now) return this.renewalResponse(input.deviceCode, stored.expiresAt);
      if (stored.expiresAt > now && ['approved', 'authorized'].includes(stored.status) && (!stored.tokenExpiresAt || stored.tokenExpiresAt > now)) throw new BusinessException('RESOURCE_CONFLICT', 'Authorization is still active');
      const expiresAt = new Date(Math.max(now.getTime() + DEVICE_TTL_SECONDS * 1000, stored.expiresAt.getTime() + 1));
      const userCode = this.renewalUserCode(input.deviceCode, expiresAt);
      const changed = await this.prisma.onboardingDeviceSession.updateMany({
        where: {id: stored.id, status: stored.status, expiresAt: stored.expiresAt, authorizedUserId: stored.authorizedUserId},
        data: {status: 'pending', userCodeHash: this.hash(this.normalizeUserCode(userCode)!), expiresAt, onboardingTokenHash: null, tokenExpiresAt: null, approvedAt: null, deniedAt: null, lastPolledAt: null, pollIntervalSeconds: POLL_INTERVAL_SECONDS},
      });
      if (!changed.count) continue;
      await this.recordAuditBestEffort({action: 'onboarding.device.renew', outcome: 'success', actorUserId: stored.authorizedUserId || undefined, ipAddress, metadata: {purpose: stored.purpose}}, 'authorization renewal');
      return this.renewalResponse(input.deviceCode, expiresAt);
    }
    throw new BusinessException('RESOURCE_CONFLICT', 'Concurrent authorization renewal; retry');
  }

  private renewalUserCode(deviceCode: string, expiresAt: Date): string {
    const bytes = createHmac('sha256', deviceCode).update('agent-connect-user-code-v1\0').update(expiresAt.toISOString()).digest();
    const code = Array.from(bytes.subarray(0, 8), byte => USER_CODE_ALPHABET[byte & 31]).join('');
    return `${code.slice(0, 4)}-${code.slice(4)}`;
  }

  private renewalResponse(deviceCode: string, expiresAt: Date) {
    const userCode = this.renewalUserCode(deviceCode, expiresAt);
    const verificationUri = this.verificationUri();
    return {deviceCode, userCode, verificationUri, verificationUriComplete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`, expiresIn: Math.max(0, Math.min(DEVICE_TTL_SECONDS, Math.ceil((expiresAt.getTime() - Date.now()) / 1000))), interval: POLL_INTERVAL_SECONDS};
  }

  private async evaluatePoll(
    stored: DeviceSession,
    now: Date,
    ipAddress: string,
  ): Promise<Record<string, unknown> | typeof POLL_CAS_RETRY> {
    if (stored.status === 'authorized') return { status: 'authorization_consumed' };
    if (stored.status === 'expired') return { status: 'expired' };
    if (stored.expiresAt.getTime() <= now.getTime()) {
      const changed = await this.prisma.onboardingDeviceSession.updateMany({
        where: { id: stored.id, status: stored.status, expiresAt: stored.expiresAt },
        data: { status: 'expired' },
      });
      return changed.count ? { status: 'expired' } : POLL_CAS_RETRY;
    }
    if (this.isEarlyPoll(stored, now)) {
      const interval = Math.min(stored.pollIntervalSeconds + POLL_INTERVAL_SECONDS, MAX_POLL_INTERVAL_SECONDS);
      const changed = await this.prisma.onboardingDeviceSession.updateMany({
        where: {
          id: stored.id,
          status: stored.status,
          lastPolledAt: stored.lastPolledAt,
          pollIntervalSeconds: stored.pollIntervalSeconds,
          expiresAt: { equals: stored.expiresAt, gt: now },
        },
        data: { pollIntervalSeconds: interval },
      });
      return changed.count ? { status: 'slow_down', interval } : POLL_CAS_RETRY;
    }
    if (stored.status === 'approved') return this.tryIssueToken(stored, now, ipAddress);
    if (stored.status !== 'pending' && stored.status !== 'denied') return { status: 'expired' };

    const changed = await this.recordNormalPoll(stored, now);
    if (!changed) return POLL_CAS_RETRY;
    return { status: stored.status === 'pending' ? 'authorization_pending' : 'denied' };
  }

  private async tryIssueToken(
    stored: DeviceSession,
    now: Date,
    ipAddress: string,
  ): Promise<Record<string, unknown> | typeof POLL_CAS_RETRY> {
    const user = stored.authorizedUserId
      ? await this.prisma.user.findUnique({
        where: { id: stored.authorizedUserId },
        select: { id: true, type: true, lockedAt: true, deletedAt: true },
      })
      : null;
    if (!this.isActiveHuman(user)) {
      const changed = await this.prisma.onboardingDeviceSession.updateMany({
        where: {
          id: stored.id,
          status: 'approved',
          authorizedUserId: stored.authorizedUserId,
          lastPolledAt: stored.lastPolledAt,
          pollIntervalSeconds: stored.pollIntervalSeconds,
          expiresAt: { gt: now },
        },
        data: { status: 'denied', deniedAt: now },
      });
      return changed.count ? { status: 'denied' } : POLL_CAS_RETRY;
    }

    const onboardingToken = `awo_${randomBytes(32).toString('base64url')}`;
    const tokenExpiresAt = new Date(now.getTime() + ONBOARDING_TOKEN_TTL_SECONDS * 1_000);
    const changed = await this.prisma.onboardingDeviceSession.updateMany({
      where: {
        id: stored.id,
        status: 'approved',
        onboardingTokenHash: null,
        authorizedUserId: stored.authorizedUserId,
        lastPolledAt: stored.lastPolledAt,
        pollIntervalSeconds: stored.pollIntervalSeconds,
        expiresAt: { gt: now },
      },
      data: {
        status: 'authorized',
        onboardingTokenHash: this.hash(onboardingToken),
        tokenExpiresAt,
        lastPolledAt: now,
        pollCount: { increment: 1 },
      },
    });
    if (!changed.count) return POLL_CAS_RETRY;

    await this.recordAuditBestEffort({
      action: 'onboarding.device.token-issued',
      outcome: 'success',
      actorUserId: stored.authorizedUserId || undefined,
      ipAddress,
      metadata: { clientType: stored.clientType, purpose: stored.purpose },
    }, 'onboarding token issuance');
    return { status: 'authorized', onboardingToken, expiresIn: ONBOARDING_TOKEN_TTL_SECONDS };
  }

  private async recordNormalPoll(stored: DeviceSession, now: Date): Promise<boolean> {
    const changed = await this.prisma.onboardingDeviceSession.updateMany({
      where: {
        id: stored.id,
        status: stored.status,
        lastPolledAt: stored.lastPolledAt,
        pollIntervalSeconds: stored.pollIntervalSeconds,
        expiresAt: { equals: stored.expiresAt, gt: now },
      },
      data: { lastPolledAt: now, pollCount: { increment: 1 } },
    });
    return changed.count > 0;
  }

  private async expire(stored: Pick<DeviceSession, 'id' | 'status' | 'expiresAt'>): Promise<void> {
    if (stored.status === 'expired') return;
    await this.prisma.onboardingDeviceSession.updateMany({
      where: { id: stored.id, status: stored.status, expiresAt: stored.expiresAt },
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

  private isEquivalentDecision(status: string, desired: 'approved' | 'denied'): boolean {
    return status === desired || (desired === 'approved' && status === 'authorized');
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
      || this.config.get<string>('CLIENT_URL')
      || this.config.get<string>('PUBLIC_BASE_URL')
      || 'https://agentwiki.quukk.com';
    const enforced = this.enforceHttpsOrigin(configured);
    return new URL('/onboard/device', enforced).toString().replace(/\/$/, '');
  }

  /**
   * Outside development the device-authorization URL must be HTTPS. A
   * misconfigured internal HTTP origin is silently upgraded so Chrome does not
   * block the page and the user code is never sent over plaintext.
   */
  private enforceHttpsOrigin(origin: string): string {
    if (this.config.get<string>('NODE_ENV') === 'development') return origin;
    return origin.replace(/^http:\/\//i, 'https://');
  }

  private hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private async recordAuditBestEffort(
    event: Parameters<AuditService['record']>[0],
    committedAction: string,
  ): Promise<void> {
    try {
      await this.audit.record(event);
    } catch {
      this.logger.error(
        `Onboarding audit persistence degraded after ${committedAction}; committed result returned`,
      );
    }
  }
}
