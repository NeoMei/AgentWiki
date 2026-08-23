import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Logger,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AddressInfo } from 'net';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { AuditService } from '../core/security/audit.service';
import { BusinessException } from '../core/filters/business-error';
import { JwtAuthGuard } from '../core/auth/jwt-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import { AllExceptionsFilter } from '../core/filters/all-exceptions.filter';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';
import { OnboardController } from './onboard.controller';
import { OnboardBootstrapService } from './onboard-bootstrap.service';
import { OnboardDeviceService } from './onboard-device.service';
import { OnboardingTokenGuard } from './onboarding-token.guard';

const NOW = new Date('2026-08-10T10:00:00.000Z');
const CAPABILITIES = [
  'bootstrap:space',
  'bootstrap:agent',
  'bootstrap:installation',
];

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    deviceCodeHash: 'd'.repeat(64),
    userCodeHash: 'u'.repeat(64),
    packageVersion: '0.6.0',
    clientType: 'codex',
    purpose: 'full-onboarding',
    requestedCapabilities: CAPABILITIES,
    status: 'pending',
    pollIntervalSeconds: 5,
    pollCount: 0,
    lastPolledAt: null,
    authorizedUserId: null,
    approvedAt: null,
    deniedAt: null,
    expiresAt: new Date(NOW.getTime() + 600_000),
    onboardingTokenHash: null,
    tokenExpiresAt: null,
    tokenConsumedAt: null,
    ...overrides,
  };
}

describe('OnboardDeviceService', () => {
  let service: OnboardDeviceService;
  let prisma: any;
  let redis: { incrementWithWindow: jest.Mock };
  let audit: { record: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    prisma = {
      onboardingDeviceSession: {
        create: jest.fn().mockResolvedValue(session()),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', type: 'human', lockedAt: null, deletedAt: null }) },
    };
    redis = { incrementWithWindow: jest.fn().mockResolvedValue(1) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    config = { get: jest.fn((key: string) => key === 'PUBLIC_WEB_URL' ? 'https://agentwiki.example' : undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OnboardDeviceService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: AuditService, useValue: audit },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(OnboardDeviceService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('starts a ten-minute session with 32-byte entropy, a formatted eight-character code, and only hashes persisted', async () => {
    const started = await service.start({
      packageVersion: '0.6.0', clientType: 'codex', purpose: 'full-onboarding',
    }, '127.0.0.1');

    expect(started).toEqual({
      deviceCode: expect.stringMatching(/^awd_[A-Za-z0-9_-]{43}$/),
      userCode: expect.stringMatching(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/),
      verificationUri: 'https://agentwiki.example/onboard/device',
      verificationUriComplete: expect.stringMatching(/^https:\/\/agentwiki\.example\/onboard\/device\?user_code=[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/),
      expiresIn: 600,
      interval: 5,
    });
    const data = prisma.onboardingDeviceSession.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      deviceCodeHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      userCodeHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      requestedCapabilities: CAPABILITIES,
      pollIntervalSeconds: 5,
      expiresAt: new Date(NOW.getTime() + 600_000),
    });
    expect(JSON.stringify(data)).not.toContain(started.deviceCode);
    expect(JSON.stringify(data)).not.toContain(started.userCode);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(started.deviceCode);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(started.userCode);
  });

  it('rate limits start after ten requests per IP in sixty seconds', async () => {
    redis.incrementWithWindow.mockResolvedValue(11);
    await expect(service.start({
      packageVersion: '0.6.0', clientType: 'codex', purpose: 'full-onboarding',
    }, '127.0.0.1')).rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
    expect(prisma.onboardingDeviceSession.create).not.toHaveBeenCalled();
  });

  it('uses CLIENT_URL when PUBLIC_WEB_URL is absent and never needs a request Host', async () => {
    config.get.mockImplementation((key: string) => key === 'CLIENT_URL' ? 'https://client.agentwiki.example/app' : undefined);
    const started = await service.start({
      packageVersion: '0.6.0', clientType: 'codex', purpose: 'full-onboarding',
    }, '127.0.0.1');
    expect(started).toMatchObject({
      verificationUri: 'https://client.agentwiki.example/onboard/device',
      verificationUriComplete: expect.stringMatching(/^https:\/\/client\.agentwiki\.example\/onboard\/device\?user_code=/),
    });
    expect(config.get.mock.calls.map(([key]) => key)).toEqual(['PUBLIC_WEB_URL', 'CLIENT_URL', 'NODE_ENV']);
  });

  it('enforces HTTPS for the device-authorization URL outside development even when PUBLIC_WEB_URL is an HTTP origin (DEF-001)', async () => {
    config.get.mockImplementation((key: string) => {
      if (key === 'PUBLIC_WEB_URL') return 'http://internal.agentwiki.local';
      return undefined;
    });
    const started = await service.start({
      packageVersion: '0.6.0', clientType: 'codex', purpose: 'full-onboarding',
    }, '127.0.0.1');
    expect(started.verificationUri).toBe('https://internal.agentwiki.local/onboard/device');
    expect(started.verificationUriComplete).toMatch(/^https:\/\/internal\.agentwiki\.local\/onboard\/device\?user_code=/);
  });

  it('returns committed start credentials when audit persistence is degraded without logging raw codes', async () => {
    audit.record.mockRejectedValue(new Error('both audit stores unavailable'));
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const started = await service.start({
      packageVersion: '0.6.0', clientType: 'codex', purpose: 'full-onboarding',
    }, '127.0.0.1');
    expect(started.deviceCode).toMatch(/^awd_[A-Za-z0-9_-]{43}$/);
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(started.deviceCode);
    expect(JSON.stringify(log.mock.calls)).not.toContain(started.userCode);
    log.mockRestore();
  });

  it('returns only the public session allowlist and normalizes the displayed user code', async () => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session({ authorizedUserId: 'secret-user' }));
    const result = await service.getPublicSession('abcd-efgh', '127.0.0.1');
    expect(result).toEqual({
      clientType: 'codex', purpose: 'full-onboarding', packageVersion: '0.6.0',
      status: 'pending', expiresAt: new Date(NOW.getTime() + 600_000),
    });
    expect(Object.keys(result).sort()).toEqual(['clientType', 'expiresAt', 'packageVersion', 'purpose', 'status']);
    expect(prisma.onboardingDeviceSession.findUnique).toHaveBeenCalledWith({ where: { userCodeHash: expect.stringMatching(/^[0-9a-f]{64}$/) } });
  });

  it('applies both public-session and invalid-code IP limits', async () => {
    redis.incrementWithWindow.mockImplementation(async (key: string) => key.includes('session-invalid') ? 11 : 1);
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(null);
    await expect(service.getPublicSession('ABCD-EFGH', '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });

    redis.incrementWithWindow.mockImplementation(async (key: string) => key.includes('session-rate') ? 31 : 1);
    await expect(service.getPublicSession('ABCD-EFGH', '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
  });

  it.each([
    ['approve', 'approved', 'approvedAt'],
    ['deny', 'denied', 'deniedAt'],
  ] as const)('transitions pending to %s with compare-and-swap', async (decision, status, timestampField) => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session());
    await expect(service.decide({ userCode: 'ABCD-EFGH', decision }, 'user-1', '127.0.0.1', 'test-agent'))
      .resolves.toEqual({ status });
    expect(prisma.onboardingDeviceSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', status: 'pending', expiresAt: { gt: NOW } },
      data: expect.objectContaining({ status, [timestampField]: NOW }),
    });
  });

  it('makes repeated same decisions idempotent and rejects reverse decisions', async () => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session({ status: 'approved', authorizedUserId: 'user-1' }));
    await expect(service.decide({ userCode: 'ABCD-EFGH', decision: 'approve' }, 'user-1', '127.0.0.1'))
      .resolves.toEqual({ status: 'approved' });
    await expect(service.decide({ userCode: 'ABCD-EFGH', decision: 'deny' }, 'user-1', '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });
    expect(prisma.onboardingDeviceSession.updateMany).not.toHaveBeenCalled();
  });

  it('returns a committed decision when audit persistence is degraded without logging the user code', async () => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session());
    audit.record.mockRejectedValue(new Error('both audit stores unavailable'));
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(service.decide(
      { userCode: 'ABCD-EFGH', decision: 'approve' }, 'user-1', '127.0.0.1', 'test-agent',
    )).resolves.toEqual({ status: 'approved' });
    expect(prisma.onboardingDeviceSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'approved' }),
    }));
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('ABCD-EFGH');
    log.mockRestore();
  });

  it('keeps an approval idempotent after its token has already been issued', async () => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session({ status: 'authorized', authorizedUserId: 'user-1' }));
    await expect(service.decide({ userCode: 'ABCD-EFGH', decision: 'approve' }, 'user-1', '127.0.0.1'))
      .resolves.toEqual({ status: 'approved' });
    expect(prisma.onboardingDeviceSession.updateMany).not.toHaveBeenCalled();
  });

  it('keeps approve idempotent when a decision CAS loser re-reads an already authorized session', async () => {
    prisma.onboardingDeviceSession.findUnique
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(session({ status: 'authorized', authorizedUserId: 'user-1' }));
    prisma.onboardingDeviceSession.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.decide(
      { userCode: 'ABCD-EFGH', decision: 'approve' }, 'user-1', '127.0.0.1',
    )).resolves.toEqual({ status: 'approved' });
    expect(prisma.onboardingDeviceSession.findUnique).toHaveBeenCalledTimes(2);
  });

  it.each([
    { lockedAt: NOW, deletedAt: null },
    { lockedAt: null, deletedAt: NOW },
  ])('rejects a locked or deleted approving user', async (user) => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', type: 'human', ...user });
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session());
    await expect(service.decide({ userCode: 'ABCD-EFGH', decision: 'approve' }, 'user-1', '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'AUTH_DENIED' });
    expect(prisma.onboardingDeviceSession.updateMany).not.toHaveBeenCalled();
  });

  it('rate limits decisions after ten requests per user in sixty seconds', async () => {
    redis.incrementWithWindow.mockResolvedValue(11);
    await expect(service.decide({ userCode: 'ABCD-EFGH', decision: 'approve' }, 'user-1', '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
  });

  it('returns authorization_pending and records a normal poll', async () => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session());
    await expect(service.poll({ deviceCode: `awd_${'a'.repeat(43)}` }, '127.0.0.1'))
      .resolves.toEqual({ status: 'authorization_pending' });
    expect(prisma.onboardingDeviceSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session-1', status: 'pending', lastPolledAt: null,
        pollIntervalSeconds: 5, expiresAt: { gt: NOW },
      },
      data: { lastPolledAt: NOW, pollCount: { increment: 1 } },
    });
  });

  it('re-reads a normal-poll CAS loser so only one concurrent caller returns pending', async () => {
    let current = session();
    prisma.onboardingDeviceSession.findUnique.mockImplementation(async () => ({ ...current }));
    prisma.onboardingDeviceSession.updateMany.mockImplementation(async ({ where, data }: any) => {
      const sameLastPoll = where.lastPolledAt === null
        ? current.lastPolledAt === null
        : where.lastPolledAt?.getTime() === (current.lastPolledAt as Date | null)?.getTime();
      if (where.status !== current.status || where.pollIntervalSeconds !== current.pollIntervalSeconds || !sameLastPoll) {
        return { count: 0 };
      }
      current = {
        ...current,
        lastPolledAt: data.lastPolledAt ?? current.lastPolledAt,
        pollIntervalSeconds: data.pollIntervalSeconds ?? current.pollIntervalSeconds,
        pollCount: (current.pollCount as number) + (data.pollCount?.increment || 0),
      };
      return { count: 1 };
    });
    const input = { deviceCode: `awd_${'a'.repeat(43)}` };
    const results = await Promise.all([
      service.poll(input, '127.0.0.1'), service.poll(input, '127.0.0.1'),
    ]);
    expect(results).toEqual(expect.arrayContaining([
      { status: 'authorization_pending' }, { status: 'slow_down', interval: 10 },
    ]));
    expect(results.filter((result) => result.status === 'authorization_pending')).toHaveLength(1);
    expect(current).toMatchObject({ pollCount: 1, pollIntervalSeconds: 10, lastPolledAt: NOW });
  });

  it('returns slow_down for an early poll and grows the session interval by five seconds up to thirty', async () => {
    prisma.onboardingDeviceSession.findUnique
      .mockResolvedValueOnce(session({ lastPolledAt: new Date(NOW.getTime() - 2_000), pollIntervalSeconds: 5 }))
      .mockResolvedValueOnce(session({ lastPolledAt: new Date(NOW.getTime() - 2_000), pollIntervalSeconds: 30 }));
    const code = `awd_${'a'.repeat(43)}`;
    await expect(service.poll({ deviceCode: code }, '127.0.0.1')).resolves.toEqual({ status: 'slow_down', interval: 10 });
    await expect(service.poll({ deviceCode: code }, '127.0.0.1')).resolves.toEqual({ status: 'slow_down', interval: 30 });
    expect(prisma.onboardingDeviceSession.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'session-1', status: 'pending', lastPolledAt: new Date(NOW.getTime() - 2_000),
        pollIntervalSeconds: 5, expiresAt: { gt: NOW },
      },
      data: { pollIntervalSeconds: 10 },
    });
    expect(prisma.onboardingDeviceSession.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'session-1', status: 'pending', lastPolledAt: new Date(NOW.getTime() - 2_000),
        pollIntervalSeconds: 30, expiresAt: { gt: NOW },
      },
      data: { pollIntervalSeconds: 30 },
    });
  });

  it('re-reads each concurrent early-poll CAS loser so every request adds five seconds up to the cap', async () => {
    let current = session({ lastPolledAt: new Date(NOW.getTime() - 2_000), pollIntervalSeconds: 5 });
    prisma.onboardingDeviceSession.findUnique.mockImplementation(async () => ({ ...current }));
    prisma.onboardingDeviceSession.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (where.pollIntervalSeconds !== current.pollIntervalSeconds) return { count: 0 };
      current = { ...current, pollIntervalSeconds: data.pollIntervalSeconds };
      return { count: 1 };
    });
    const input = { deviceCode: `awd_${'a'.repeat(43)}` };
    const results = await Promise.all([
      service.poll(input, '127.0.0.1'), service.poll(input, '127.0.0.1'),
    ]);
    expect(results.map((result) => result.interval).sort()).toEqual([10, 15]);
    expect(current.pollIntervalSeconds).toBe(15);
  });

  it('returns a stable retryable error when poll contention exhausts its bounded retries', async () => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session());
    prisma.onboardingDeviceSession.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.poll({ deviceCode: `awd_${'a'.repeat(43)}` }, '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });
    expect(prisma.onboardingDeviceSession.findUnique.mock.calls.length).toBeGreaterThan(1);
    expect(prisma.onboardingDeviceSession.findUnique.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it.each([
    [session({ status: 'denied' }), { status: 'denied' }],
    [session({ expiresAt: new Date(NOW.getTime() - 1) }), { status: 'expired' }],
  ])('returns terminal denied and expired statuses', async (stored, expected) => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(stored);
    await expect(service.poll({ deviceCode: `awd_${'a'.repeat(43)}` }, '127.0.0.1')).resolves.toEqual(expected);
  });

  it('returns a 32-byte onboarding token once and persists only its hash', async () => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session({ status: 'approved', authorizedUserId: 'user-1' }));
    const result = await service.poll({ deviceCode: `awd_${'a'.repeat(43)}` }, '127.0.0.1');
    expect(result).toEqual({
      status: 'authorized', onboardingToken: expect.stringMatching(/^awo_[A-Za-z0-9_-]{43}$/), expiresIn: 600,
    });
    const update = prisma.onboardingDeviceSession.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({
      id: 'session-1', status: 'approved', onboardingTokenHash: null,
      authorizedUserId: 'user-1', lastPolledAt: null, pollIntervalSeconds: 5,
      expiresAt: { gt: NOW },
    });
    expect(update.data).toMatchObject({
      status: 'authorized', onboardingTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      tokenExpiresAt: new Date(NOW.getTime() + 600_000), lastPolledAt: NOW,
      pollCount: { increment: 1 },
    });
    expect(JSON.stringify(update)).not.toContain((result as any).onboardingToken);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain((result as any).onboardingToken);
  });

  it('does not leak a generated token when another poll wins the compare-and-swap', async () => {
    prisma.onboardingDeviceSession.findUnique
      .mockResolvedValueOnce(session({ status: 'approved', authorizedUserId: 'user-1' }))
      .mockResolvedValueOnce(session({
        status: 'authorized', authorizedUserId: 'user-1', onboardingTokenHash: 't'.repeat(64),
      }));
    prisma.onboardingDeviceSession.updateMany.mockResolvedValue({ count: 0 });
    const result = await service.poll({ deviceCode: `awd_${'a'.repeat(43)}` }, '127.0.0.1');
    expect(result).toEqual({ status: 'authorization_consumed' });
    expect(result).not.toHaveProperty('onboardingToken');
    expect(audit.record).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'onboarding.device.token-issued' }));
    expect(prisma.onboardingDeviceSession.findUnique).toHaveBeenCalledTimes(2);
  });

  it('returns the committed raw onboarding token when audit persistence is degraded and never logs it', async () => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session({ status: 'approved', authorizedUserId: 'user-1' }));
    audit.record.mockRejectedValue(new Error('both audit stores unavailable'));
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const result = await service.poll({ deviceCode: `awd_${'a'.repeat(43)}` }, '127.0.0.1');
    expect(result).toEqual({
      status: 'authorized', onboardingToken: expect.stringMatching(/^awo_[A-Za-z0-9_-]{43}$/), expiresIn: 600,
    });
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain((result as any).onboardingToken);
    expect(JSON.stringify(log.mock.calls)).not.toContain(`awd_${'a'.repeat(43)}`);
    log.mockRestore();
  });

  it('never returns the onboarding token after authorization has been consumed by a prior poll', async () => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session({
      status: 'authorized', authorizedUserId: 'user-1', onboardingTokenHash: 't'.repeat(64),
      tokenExpiresAt: new Date(NOW.getTime() + 600_000),
    }));
    const result = await service.poll({ deviceCode: `awd_${'a'.repeat(43)}` }, '127.0.0.1');
    expect(result).toEqual({ status: 'authorization_consumed' });
    expect(result).not.toHaveProperty('onboardingToken');
  });

  it('returns authorization_consumed immediately even when the prior authorized poll was recent', async () => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session({
      status: 'authorized', authorizedUserId: 'user-1', onboardingTokenHash: 't'.repeat(64),
      tokenExpiresAt: new Date(NOW.getTime() + 600_000), lastPolledAt: NOW,
    }));
    await expect(service.poll({ deviceCode: `awd_${'a'.repeat(43)}` }, '127.0.0.1'))
      .resolves.toEqual({ status: 'authorization_consumed' });
  });

  it('denies token issuance if the approving user becomes locked', async () => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session({ status: 'approved', authorizedUserId: 'user-1' }));
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', type: 'human', lockedAt: NOW, deletedAt: null });
    await expect(service.poll({ deviceCode: `awd_${'a'.repeat(43)}` }, '127.0.0.1'))
      .resolves.toEqual({ status: 'denied' });
    expect(prisma.onboardingDeviceSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'session-1', status: 'approved', authorizedUserId: 'user-1',
        lastPolledAt: null, pollIntervalSeconds: 5, expiresAt: { gt: NOW },
      },
      data: { status: 'denied', deniedAt: NOW },
    });
  });

  it('rate limits polls after 120 requests per IP per sixty seconds', async () => {
    redis.incrementWithWindow.mockResolvedValue(121);
    await expect(service.poll({ deviceCode: `awd_${'a'.repeat(43)}` }, '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
  });

  it('records lastPolledAt in both the Prisma schema and its unpublished migration', () => {
    const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
    const migration = readFileSync(join(__dirname, '../../prisma/migrations/20260810000000_add_onboarding_device_sessions/migration.sql'), 'utf8');
    expect(schema).toMatch(/lastPolledAt\s+DateTime\?/);
    expect(migration).toContain('"lastPolledAt" TIMESTAMP(3)');
  });
});

describe('OnboardingTokenGuard', () => {
  const rawToken = `awo_${'a'.repeat(43)}`;
  let prisma: any;
  let guard: OnboardingTokenGuard;

  beforeEach(async () => {
    prisma = {
      onboardingDeviceSession: { findUnique: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', type: 'human', lockedAt: null, deletedAt: null }) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [OnboardingTokenGuard, { provide: PrismaService, useValue: prisma }],
    }).compile();
    guard = moduleRef.get(OnboardingTokenGuard);
  });

  function context(token = rawToken) {
    const request: any = { headers: token ? { authorization: `Bearer ${token}` } : {} };
    return {
      request,
      execution: { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext,
    };
  }

  it('accepts only an active awo bearer and attaches the minimal onboarding principal', async () => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session({
      status: 'authorized', authorizedUserId: 'user-1',
      onboardingTokenHash: createHash('sha256').update(rawToken).digest('hex'),
      tokenExpiresAt: new Date(Date.now() + 600_000),
    }));
    const probe = context();
    await expect(guard.canActivate(probe.execution)).resolves.toBe(true);
    expect(prisma.onboardingDeviceSession.findUnique).toHaveBeenCalledWith({
      where: { onboardingTokenHash: createHash('sha256').update(rawToken).digest('hex') },
    });
    expect(JSON.stringify(prisma.onboardingDeviceSession.findUnique.mock.calls)).not.toContain(rawToken);
    expect(probe.request.onboarding).toEqual({
      sessionId: 'session-1', userId: 'user-1', packageVersion: '0.6.0',
      purpose: 'full-onboarding', requestedCapabilities: CAPABILITIES,
    });
  });

  it.each(['agk_secret', 'jwt.secret.value', '', 'awo_short'])('rejects non-awo credentials without consulting normal auth guards', async (token) => {
    const probe = context(token);
    await expect(guard.canActivate(probe.execution)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.onboardingDeviceSession.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    session({ status: 'approved', authorizedUserId: 'user-1', tokenExpiresAt: new Date(Date.now() + 600_000) }),
    session({ status: 'authorized', authorizedUserId: 'user-1', tokenExpiresAt: new Date(Date.now() - 1) }),
  ])('rejects tokens in invalid or expired state', async (stored) => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(stored);
    await expect(guard.canActivate(context().execution)).rejects.toBeDefined();
  });

  it('lets a consumed but unexpired token reach bootstrap replay handling', async () => {
    prisma.onboardingDeviceSession.findUnique.mockResolvedValue(session({
      status: 'authorized', authorizedUserId: 'user-1',
      onboardingTokenHash: createHash('sha256').update(rawToken).digest('hex'),
      tokenExpiresAt: new Date(Date.now() + 600_000), tokenConsumedAt: new Date(),
    }));
    const probe = context();

    await expect(guard.canActivate(probe.execution)).resolves.toBe(true);
    expect(probe.request.onboarding).toEqual(expect.objectContaining({
      sessionId: 'session-1', userId: 'user-1', purpose: 'full-onboarding',
    }));
  });
});

describe('OnboardController HTTP contract', () => {
  let app: INestApplication;
  let baseUrl: string;
  const devices = {
    start: jest.fn().mockResolvedValue({
      deviceCode: `awd_${'a'.repeat(43)}`, userCode: 'ABCD-EFGH',
      verificationUri: 'https://agentwiki.example/onboard/device',
      verificationUriComplete: 'https://agentwiki.example/onboard/device?user_code=ABCD-EFGH',
      expiresIn: 600, interval: 5,
    }),
    getPublicSession: jest.fn().mockResolvedValue({
      clientType: 'codex', purpose: 'full-onboarding', packageVersion: '0.6.0',
      status: 'pending', expiresAt: new Date(NOW.getTime() + 600_000),
    }),
    decide: jest.fn().mockResolvedValue({ status: 'approved' }),
    poll: jest.fn().mockResolvedValue({ status: 'authorization_pending' }),
  };
  const bootstrapService = {
    bootstrap: jest.fn().mockResolvedValue({
      space: { id: 'space-1', name: '研发知识库' },
      agent: { id: 'agent-1', name: 'Codex' },
      grant: { role: 'editor', scopes: ['pages:read'] },
      installation: {
        code: 'AW-INSTALL', installationId: 'install-1', expiresAt: NOW.toISOString(),
      },
    }),
  };

  class HumanJwtProbe implements CanActivate {
    canActivate(context: ExecutionContext) {
      const request = context.switchToHttp().getRequest();
      const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (token === 'human-token') request.user = { userId: 'user-1', type: 'human' };
      else if (token === 'agent-token') request.user = { userId: 'user-1', agentId: 'agent-1', type: 'agent' };
      else throw new UnauthorizedException();
      return true;
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OnboardController],
      providers: [
        { provide: OnboardDeviceService, useValue: devices },
        { provide: OnboardBootstrapService, useValue: bootstrapService },
        HumanOnlyGuard,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(HumanJwtProbe)
      .overrideGuard(OnboardingTokenGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest();
          request.onboarding = {
            sessionId: 'session-1', userId: 'user-1', packageVersion: '0.6.0',
            purpose: 'full-onboarding', requestedCapabilities: CAPABILITIES,
          };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useLogger(false);
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('keeps start, public session, and poll public', async () => {
    const started = await fetch(`${baseUrl}/api/onboard/device/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ packageVersion: '0.6.0', clientType: 'codex', purpose: 'full-onboarding' }),
    });
    const publicSession = await fetch(`${baseUrl}/api/onboard/device/session?userCode=ABCD-EFGH`);
    const polled = await fetch(`${baseUrl}/api/onboard/device/poll`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceCode: `awd_${'a'.repeat(43)}` }),
    });
    expect([started.status, publicSession.status, polled.status]).toEqual([201, 200, 201]);
    expect(devices.start).toHaveBeenCalledWith(expect.anything(), '127.0.0.1');
    expect(devices.getPublicSession).toHaveBeenCalledWith('ABCD-EFGH', '127.0.0.1');
    expect(devices.poll).toHaveBeenCalledWith(expect.anything(), '127.0.0.1');
  });

  it('routes bootstrap only through the onboarding principal and Idempotency-Key', async () => {
    const serverPlan = {
      space: { mode: 'create', name: '研发知识库' },
      agentName: 'Codex', role: 'editor', packageVersion: '0.6.0',
    };
    const response = await fetch(`${baseUrl}/api/onboard/bootstrap`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer awo_${'a'.repeat(43)}`,
        'idempotency-key': 'bootstrap-key-01',
      },
      body: JSON.stringify({ serverPlan, serverPlanHash: 'a'.repeat(64) }),
    });

    expect(response.status).toBe(201);
    expect(bootstrapService.bootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', userId: 'user-1' }),
      'bootstrap-key-01',
      expect.objectContaining(serverPlan),
      'a'.repeat(64),
    );
    expect(JSON.stringify(await response.json())).not.toContain('apiKey');
  });

  it('allows only a human JWT to decide', async () => {
    const body = JSON.stringify({ userCode: 'ABCD-EFGH', decision: 'approve' });
    const headers = { 'content-type': 'application/json' };
    const anonymous = await fetch(`${baseUrl}/api/onboard/device/decision`, { method: 'POST', headers, body });
    const agent = await fetch(`${baseUrl}/api/onboard/device/decision`, {
      method: 'POST', headers: { ...headers, authorization: 'Bearer agent-token' }, body,
    });
    const human = await fetch(`${baseUrl}/api/onboard/device/decision`, {
      method: 'POST', headers: { ...headers, authorization: 'Bearer human-token' }, body,
    });
    expect([anonymous.status, agent.status, human.status]).toEqual([401, 403, 201]);
    expect(devices.decide).toHaveBeenCalledTimes(1);
    expect(devices.decide).toHaveBeenCalledWith(expect.anything(), 'user-1', '127.0.0.1', expect.anything());
  });

  it('returns a stable business code for invalid public input', async () => {
    const response = await fetch(`${baseUrl}/api/onboard/device/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ packageVersion: '0.6.0', clientType: 'codex', purpose: 'full-onboarding', requestedCapabilities: ['admin'] }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('preserves stable business codes from the public endpoints', async () => {
    devices.poll.mockRejectedValueOnce(new BusinessException('AUTH_RATE_LIMITED'));
    const response = await fetch(`${baseUrl}/api/onboard/device/poll`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceCode: `awd_${'a'.repeat(43)}` }),
    });
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: 'AUTH_RATE_LIMITED' });
  });
});
