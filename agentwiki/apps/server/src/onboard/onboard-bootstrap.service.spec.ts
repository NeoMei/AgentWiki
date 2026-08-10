import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { LocalSyncInstallationService } from '../core/agent/local-sync-installation.service';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';
import { OnboardBootstrapService } from './onboard-bootstrap.service';
import { hashServerPlan, normalizeServerPlan, type ServerPlan } from './onboard.types';

const CAPABILITIES = [
  'bootstrap:space',
  'bootstrap:agent',
  'bootstrap:grant',
  'bootstrap:installation',
];

const context = {
  sessionId: 'device-session-12345678',
  userId: 'user-1',
  packageVersion: '0.3.0',
  purpose: 'full-onboarding',
  requestedCapabilities: CAPABILITIES,
};

const createPlan: ServerPlan = {
  space: { mode: 'create', name: '研发知识库' },
  agentName: 'Codex',
  permissionPreset: 'editor',
  approvalMode: 'always-review',
  packageVersion: '0.3.0',
};

const installation = {
  installationId: 'installation-1',
  code: 'AW-INSTALL-CODE',
  expiresAt: '2030-01-01T00:10:00.000Z',
  instructions: 'install',
};

function p2002() {
  return Object.assign(new Error('unique constraint'), { code: 'P2002' });
}

function idempotencyKeyHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('OnboardBootstrapService', () => {
  let service: OnboardBootstrapService;
  let prisma: any;
  let tx: any;
  let redis: { getStrict: jest.Mock; setStrict: jest.Mock };
  let installations: { issueForBootstrap: jest.Mock; revoke: jest.Mock };
  let bootstrapRecord: any;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    bootstrapRecord = {
      id: 'bootstrap-1',
      deviceSessionId: context.sessionId,
      idempotencyKeyHash: '',
      serverPlanHash: hashServerPlan(normalizeServerPlan(createPlan)),
      status: 'running',
      resourceIds: null,
      resultHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    tx = {
      space: {
        create: jest.fn().mockResolvedValue({
          id: 'space-1', name: '研发知识库', approvalPolicy: 'always-review',
        }),
        findFirst: jest.fn(),
      },
      agent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'agent-1', name: 'Codex', status: 'active', approvalMode: 'always-review',
        }),
      },
      agentGrant: {
        upsert: jest.fn().mockResolvedValue({
          id: 'grant-1', role: 'editor', scopes: normalizeServerPlan(createPlan).scopes,
        }),
      },
      onboardingBootstrap: {
        update: jest.fn().mockImplementation(async ({ data }: any) => {
          bootstrapRecord = { ...bootstrapRecord, ...data, updatedAt: new Date() };
          return bootstrapRecord;
        }),
      },
    };
    prisma = {
      onboardingBootstrap: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          bootstrapRecord = { ...bootstrapRecord, ...data };
          return bootstrapRecord;
        }),
        findUnique: jest.fn().mockImplementation(async () => bootstrapRecord),
        update: jest.fn().mockImplementation(async ({ data }: any) => {
          bootstrapRecord = { ...bootstrapRecord, ...data, updatedAt: new Date() };
          return bootstrapRecord;
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      onboardingDeviceSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      space: { findUnique: jest.fn() },
      agent: { findUnique: jest.fn() },
      agentGrant: { findUnique: jest.fn() },
      $transaction: jest.fn(async (callback: (client: any) => unknown) => callback(tx)),
    };
    redis = {
      getStrict: jest.fn().mockResolvedValue(null),
      setStrict: jest.fn().mockResolvedValue(undefined),
    };
    installations = {
      issueForBootstrap: jest.fn().mockResolvedValue(installation),
      revoke: jest.fn().mockResolvedValue({ success: true }),
    };
    const config = {
      get: jest.fn((key: string) => key === 'PUBLIC_API_URL'
        ? 'https://agentwiki.example/api/'
        : key === 'NODE_ENV' ? 'production' : undefined),
    };
    service = new OnboardBootstrapService(
      prisma as PrismaService,
      redis as unknown as RedisService,
      installations as unknown as LocalSyncInstallationService,
      config as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a private Space, owner membership, active Agent and editor Grant transactionally', async () => {
    const normalized = normalizeServerPlan(createPlan);
    const result = await service.bootstrap(context, 'bootstrap-key-01', createPlan, hashServerPlan(normalized));

    expect(tx.space.create).toHaveBeenCalledWith({
      data: {
        name: '研发知识库',
        slug: '研发知识库-12345678',
        visibility: 'private',
        approvalPolicy: 'always-review',
        members: { create: { userId: 'user-1', role: 'owner' } },
      },
    });
    expect(tx.agent.create).toHaveBeenCalledWith({
      data: {
        ownerId: 'user-1',
        name: 'Codex',
        approvalMode: 'always-review',
      },
    });
    expect(tx.agentGrant.upsert).toHaveBeenCalledWith({
      where: { agentId_spaceId: { agentId: 'agent-1', spaceId: 'space-1' } },
      create: { agentId: 'agent-1', spaceId: 'space-1', role: 'editor', scopes: normalized.scopes },
      update: { role: 'editor', scopes: normalized.scopes },
    });
    expect(installations.issueForBootstrap).toHaveBeenCalledWith({
      ownerId: 'user-1', agentId: 'agent-1', scopes: normalized.scopes,
      pluginVersion: '0.3.0', serverUrl: 'https://agentwiki.example/api',
    });
    expect(result).toEqual({
      space: { id: 'space-1', name: '研发知识库' },
      agent: { id: 'agent-1', name: 'Codex' },
      grant: { role: 'editor', scopes: normalized.scopes },
      installation: {
        code: installation.code,
        installationId: installation.installationId,
        expiresAt: installation.expiresAt,
      },
    });
    expect(JSON.stringify(result)).not.toContain('apiKey');
  });

  it('saves the 600-second replay response before completing and consuming the token', async () => {
    const calls: string[] = [];
    redis.setStrict.mockImplementation(async () => { calls.push('replay'); });
    prisma.onboardingBootstrap.update.mockImplementation(async ({ data }: any) => {
      if (data.status === 'completed') calls.push('completed');
      bootstrapRecord = { ...bootstrapRecord, ...data };
      return bootstrapRecord;
    });
    prisma.onboardingDeviceSession.updateMany.mockImplementation(async () => {
      calls.push('consumed');
      return { count: 1 };
    });

    await service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(normalizeServerPlan(createPlan)),
    );

    expect(redis.setStrict).toHaveBeenCalledWith(
      'onboarding:bootstrap-result:bootstrap-1',
      expect.not.stringContaining('apiKey'),
      600,
    );
    expect(calls).toEqual(['replay', 'completed', 'consumed']);
    expect(prisma.onboardingDeviceSession.updateMany).toHaveBeenCalledWith({
      where: { id: context.sessionId, tokenConsumedAt: null },
      data: { tokenConsumedAt: new Date('2030-01-01T00:00:00.000Z') },
    });
  });

  it('reuses an owned active Agent and an existing owner/admin Space without changing its policy', async () => {
    const plan: ServerPlan = {
      ...createPlan,
      space: { mode: 'existing', id: 'space-existing' },
      permissionPreset: 'full',
    };
    tx.space.findFirst.mockResolvedValue({
      id: 'space-existing', name: '已有空间', approvalPolicy: 'scoped-auto-publish',
    });
    tx.agent.findFirst.mockResolvedValue({
      id: 'agent-existing', name: 'Codex', status: 'active', approvalMode: 'always-review',
    });
    tx.agentGrant.upsert.mockResolvedValue({
      id: 'grant-existing', role: 'editor', scopes: normalizeServerPlan(plan).scopes,
    });

    const result = await service.bootstrap(
      context, 'bootstrap-key-01', plan, hashServerPlan(normalizeServerPlan(plan)),
    );

    expect(tx.space.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'space-existing', deletedAt: null,
        members: { some: { userId: 'user-1', role: { in: ['owner', 'admin'] } } },
      },
    });
    expect(tx.space.create).not.toHaveBeenCalled();
    expect(tx.agent.create).not.toHaveBeenCalled();
    expect(tx.agent.findFirst).toHaveBeenCalledWith({
      where: {
        ownerId: 'user-1', revokedAt: null, status: 'active',
        name: 'Codex', approvalMode: 'always-review',
      },
    });
    expect(result.space).toEqual({ id: 'space-existing', name: '已有空间' });
    expect(result.agent).toEqual({ id: 'agent-existing', name: 'Codex' });
  });

  it('rejects scoped auto-publish for an existing always-review Space', async () => {
    const plan: ServerPlan = {
      ...createPlan,
      space: { mode: 'existing', id: 'space-existing' },
      approvalMode: 'scoped-auto-publish',
    };
    tx.space.findFirst.mockResolvedValue({
      id: 'space-existing', name: '已有空间', approvalPolicy: 'always-review',
    });

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', plan, hashServerPlan(normalizeServerPlan(plan)),
    )).rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });
    expect(tx.agent.create).not.toHaveBeenCalled();
  });

  it.each(['', 'short-key', 'space is invalid', 'a'.repeat(129), '中文-key'])(
    'rejects missing or malformed idempotency key %p with a stable 400 business error',
    async (key) => {
      await expect(service.bootstrap(
        context, key, createPlan, hashServerPlan(normalizeServerPlan(createPlan)),
      )).rejects.toMatchObject({
        businessCode: 'ONBOARDING_IDEMPOTENCY_KEY_INVALID',
        statusCode: 400,
      });
      expect(prisma.onboardingBootstrap.create).not.toHaveBeenCalled();
    },
  );

  it('recomputes the canonical plan hash and rejects a client-supplied wrong hash', async () => {
    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, 'a'.repeat(64),
    )).rejects.toMatchObject({ businessCode: 'ONBOARDING_PLAN_HASH_MISMATCH', statusCode: 400 });
    expect(prisma.onboardingBootstrap.create).not.toHaveBeenCalled();
  });

  it.each([
    { ...context, packageVersion: '0.2.9' },
    { ...context, purpose: 'credential-only' },
    { ...context, requestedCapabilities: CAPABILITIES.slice(0, 3) },
    { ...context, requestedCapabilities: [...CAPABILITIES, 'admin'] },
  ])('rejects a narrowed or changed device-session contract %#', async (changedContext) => {
    await expect(service.bootstrap(
      changedContext, 'bootstrap-key-01', createPlan, hashServerPlan(normalizeServerPlan(createPlan)),
    )).rejects.toMatchObject({ businessCode: 'ONBOARDING_PLAN_HASH_MISMATCH' });
    expect(prisma.onboardingBootstrap.create).not.toHaveBeenCalled();
  });

  it('returns the saved response for an exact replay without recreating resources', async () => {
    const expected = {
      space: { id: 'space-1', name: '研发知识库' },
      agent: { id: 'agent-1', name: 'Codex' },
      grant: { role: 'editor' as const, scopes: normalizeServerPlan(createPlan).scopes },
      installation: {
        code: installation.code,
        installationId: installation.installationId,
        expiresAt: installation.expiresAt,
      },
    };
    prisma.onboardingBootstrap.create.mockRejectedValue(p2002());
    bootstrapRecord.status = 'completed';
    bootstrapRecord.idempotencyKeyHash = 'pending';
    redis.getStrict.mockResolvedValue(JSON.stringify(expected));

    bootstrapRecord.idempotencyKeyHash = idempotencyKeyHash('bootstrap-key-01');
    const replay = await service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(normalizeServerPlan(createPlan)),
    );

    expect(replay).toEqual(expected);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(installations.issueForBootstrap).not.toHaveBeenCalled();
  });

  it('never returns extra credential material from replay storage', async () => {
    prisma.onboardingBootstrap.create.mockRejectedValue(p2002());
    bootstrapRecord.status = 'completed';
    bootstrapRecord.idempotencyKeyHash = idempotencyKeyHash('bootstrap-key-01');
    redis.getStrict.mockResolvedValue(JSON.stringify({
      space: { id: 'space-1', name: '研发知识库', apiKey: 'agk_space' },
      agent: { id: 'agent-1', name: 'Codex', apiKey: 'agk_agent' },
      grant: { role: 'editor', scopes: normalizeServerPlan(createPlan).scopes },
      installation: {
        code: installation.code,
        installationId: installation.installationId,
        expiresAt: installation.expiresAt,
        apiKey: 'agk_installation',
      },
    }));

    const replay = await service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(normalizeServerPlan(createPlan)),
    );

    expect(JSON.stringify(replay)).not.toContain('apiKey');
    expect(JSON.stringify(replay)).not.toContain('agk_');
  });

  it.each([
    ['different-key-001', createPlan],
    ['bootstrap-key-01', { ...createPlan, agentName: 'Claude' }],
  ] as const)('rejects replay with changed key or plan', async (key, plan) => {
    prisma.onboardingBootstrap.create.mockRejectedValue(p2002());
    bootstrapRecord.status = 'completed';
    bootstrapRecord.idempotencyKeyHash = idempotencyKeyHash('bootstrap-key-01');

    await expect(service.bootstrap(
      context, key, plan, hashServerPlan(normalizeServerPlan(plan)),
    )).rejects.toMatchObject({ businessCode: 'ONBOARDING_REPLAY_MISMATCH' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lets a concurrent loser wait for and read the winner response', async () => {
    jest.useRealTimers();
    let releaseInstallation!: () => void;
    installations.issueForBootstrap.mockImplementation(() => new Promise((resolve) => {
      releaseInstallation = () => resolve(installation);
    }));
    let createCount = 0;
    prisma.onboardingBootstrap.create.mockImplementation(async ({ data }: any) => {
      createCount += 1;
      if (createCount > 1) throw p2002();
      bootstrapRecord = { ...bootstrapRecord, ...data };
      return bootstrapRecord;
    });
    redis.setStrict.mockImplementation(async (_key, value) => {
      redis.getStrict.mockResolvedValue(value);
    });

    const hash = hashServerPlan(normalizeServerPlan(createPlan));
    const winner = service.bootstrap(context, 'bootstrap-key-01', createPlan, hash);
    while (!releaseInstallation) await new Promise((resolve) => setImmediate(resolve));
    const loser = service.bootstrap(context, 'bootstrap-key-01', createPlan, hash);
    await Promise.resolve();
    releaseInstallation();

    await expect(Promise.all([winner, loser])).resolves.toEqual([
      expect.objectContaining({ space: { id: 'space-1', name: '研发知识库' } }),
      expect.objectContaining({ space: { id: 'space-1', name: '研发知识库' } }),
    ]);
    expect(tx.space.create).toHaveBeenCalledTimes(1);
    expect(tx.agent.create).toHaveBeenCalledTimes(1);
    expect(installations.issueForBootstrap).toHaveBeenCalledTimes(1);
  });

  it('marks a transaction failure retryable and does not issue or consume anything', async () => {
    prisma.$transaction.mockRejectedValue(new Error('grant write failed'));

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(normalizeServerPlan(createPlan)),
    )).rejects.toThrow('grant write failed');

    expect(prisma.onboardingBootstrap.update).toHaveBeenCalledWith({
      where: { id: 'bootstrap-1' },
      data: { status: 'failed' },
    });
    expect(installations.issueForBootstrap).not.toHaveBeenCalled();
    expect(redis.setStrict).not.toHaveBeenCalled();
    expect(prisma.onboardingDeviceSession.updateMany).not.toHaveBeenCalled();
  });

  it('recovers resource IDs after installation failure without recreating database resources', async () => {
    prisma.onboardingBootstrap.create.mockRejectedValue(p2002());
    bootstrapRecord.status = 'failed';
    bootstrapRecord.idempotencyKeyHash = idempotencyKeyHash('bootstrap-key-01');
    bootstrapRecord.resourceIds = {
      spaceId: 'space-1', agentId: 'agent-1', grantId: 'grant-1',
    };
    prisma.space.findUnique.mockResolvedValue({
      id: 'space-1', name: '研发知识库', deletedAt: null,
    });
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', name: 'Codex', status: 'active', revokedAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue({
      id: 'grant-1', agentId: 'agent-1', spaceId: 'space-1', role: 'editor',
      scopes: normalizeServerPlan(createPlan).scopes,
    });

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(normalizeServerPlan(createPlan)),
    )).resolves.toMatchObject({ installation: { code: 'AW-INSTALL-CODE' } });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(installations.issueForBootstrap).toHaveBeenCalledTimes(1);
  });

  it('revokes an issued-but-unreturned code when replay persistence fails', async () => {
    redis.setStrict.mockRejectedValue(new Error('redis unavailable'));

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(normalizeServerPlan(createPlan)),
    )).rejects.toThrow('redis unavailable');

    expect(installations.revoke).toHaveBeenCalledWith(
      'user-1', 'agent-1', 'installation-1',
    );
    expect(prisma.onboardingDeviceSession.updateMany).not.toHaveBeenCalled();
  });

  it('does not downgrade a saved completed result when final token consumption fails', async () => {
    prisma.onboardingDeviceSession.updateMany.mockRejectedValue(new Error('database unavailable'));

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(normalizeServerPlan(createPlan)),
    )).rejects.toThrow('database unavailable');

    expect(redis.setStrict).toHaveBeenCalledTimes(1);
    expect(prisma.onboardingBootstrap.update).toHaveBeenCalledWith({
      where: { id: 'bootstrap-1' },
      data: expect.objectContaining({ status: 'completed' }),
    });
    expect(prisma.onboardingBootstrap.update).not.toHaveBeenCalledWith({
      where: { id: 'bootstrap-1' },
      data: { status: 'failed' },
    });
  });
});
