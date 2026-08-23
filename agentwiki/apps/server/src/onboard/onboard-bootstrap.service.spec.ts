import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { LocalSyncInstallationService } from '../core/agent/local-sync-installation.service';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../database/redis.service';
import { OnboardBootstrapService } from './onboard-bootstrap.service';
import { hashServerPlan, normalizeServerPlan, type ServerPlan } from './onboard.types';

const CAPABILITIES = [
  'bootstrap:space',
  'bootstrap:agent',
  'bootstrap:installation',
];

const context = {
  sessionId: 'device-session-12345678',
  userId: 'user-1',
  packageVersion: '0.6.0',
  purpose: 'full-onboarding',
  requestedCapabilities: CAPABILITIES,
};

const createPlan: ServerPlan = {
  space: { mode: 'create', name: '研发知识库' },
  agentName: 'Codex',
  role: 'editor',
  packageVersion: '0.6.0',
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
  let redis: { getStrict: jest.Mock; setStrict: jest.Mock; deleteStrict: jest.Mock };
  let installations: { issueForBootstrap: jest.Mock; revoke: jest.Mock };
  let bootstrapRecord: any;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    bootstrapRecord = {
      id: 'bootstrap-1',
      deviceSessionId: context.sessionId,
      idempotencyKeyHash: '',
      serverPlanHash: hashServerPlan(createPlan),
      status: 'running',
      executionId: 'execution-initial',
      generation: 1,
      leaseExpiresAt: new Date(Date.now() + 30_000),
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
          id: 'agent-1', name: 'Codex', status: 'active', approvalMode: 'always-review', memoryEnabled: false,
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
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          const fenceMatches = (where.executionId === undefined || where.executionId === bootstrapRecord.executionId)
            && (where.generation === undefined || where.generation === bootstrapRecord.generation)
            && (where.status === undefined || where.status === bootstrapRecord.status);
          const leaseMatches = !where.leaseExpiresAt?.gt
            || ((bootstrapRecord.leaseExpiresAt as Date | null)?.getTime() ?? -Infinity)
              > where.leaseExpiresAt.gt.getTime();
          if (!fenceMatches || !leaseMatches) return { count: 0 };
          bootstrapRecord = {
            ...bootstrapRecord,
            ...data,
            generation: data.generation?.increment
              ? bootstrapRecord.generation + data.generation.increment
              : data.generation ?? bootstrapRecord.generation,
            updatedAt: new Date(),
          };
          return { count: 1 };
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
        updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
          const fenceMatches = (where.executionId === undefined || where.executionId === bootstrapRecord.executionId)
            && (where.generation === undefined || where.generation === bootstrapRecord.generation)
            && (where.status === undefined || where.status === bootstrapRecord.status)
            && (where.leaseExpiresAt instanceof Date
              ? where.leaseExpiresAt.getTime() === (bootstrapRecord.leaseExpiresAt as Date | null)?.getTime()
              : true);
          const leaseMatches = !where.leaseExpiresAt?.gt
            || ((bootstrapRecord.leaseExpiresAt as Date | null)?.getTime() ?? -Infinity)
              > where.leaseExpiresAt.gt.getTime();
          if (!fenceMatches || !leaseMatches) return { count: 0 };
          bootstrapRecord = {
            ...bootstrapRecord,
            ...data,
            generation: data.generation?.increment
              ? bootstrapRecord.generation + data.generation.increment
              : data.generation ?? bootstrapRecord.generation,
            updatedAt: new Date(),
          };
          return { count: 1 };
        }),
      },
      onboardingDeviceSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      space: { findFirst: jest.fn() },
      agent: { findUnique: jest.fn() },
      agentGrant: { findUnique: jest.fn() },
      $transaction: jest.fn(async (callback: (client: any) => unknown) => callback(tx)),
    };
    redis = {
      getStrict: jest.fn().mockResolvedValue(null),
      setStrict: jest.fn().mockResolvedValue(undefined),
      deleteStrict: jest.fn().mockResolvedValue(1),
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

  it('creates a private always-review Space and active Agent without creating a Grant', async () => {
    const normalized = normalizeServerPlan(createPlan);
    const result = await service.bootstrap(context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan));

    expect(tx.space.create).toHaveBeenCalledWith({
      data: {
        name: '研发知识库',
        slug: '研发知识库-ba522e1d1301ce83',
        visibility: 'private',
        approvalPolicy: 'always-review',
        members: { create: { userId: 'user-1', role: 'owner' } },
      },
    });
    expect(tx.agent.create).toHaveBeenCalledWith({
      data: {
        ownerId: 'user-1',
        name: 'Codex',
        memoryEnabled: false,
        approvalMode: 'always-review',
      },
    });
    expect(tx.agentGrant.upsert).not.toHaveBeenCalled();
    expect(installations.issueForBootstrap).toHaveBeenCalledWith({
      ownerId: 'user-1', agentId: 'agent-1', spaceId: 'space-1', role: 'editor',
      pluginVersion: '0.6.0', serverUrl: 'https://agentwiki.example/api',
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

  it.each([
    ['reader', false, 'always-review'],
    ['publisher', true, 'scoped-auto-publish'],
  ] as const)('creates a new always-review Space while preserving the canonical %s package', async (role, memoryEnabled, approvalMode) => {
    const plan: ServerPlan = { ...createPlan, role };

    const result = await service.bootstrap(
      context,
      'bootstrap-key-01',
      plan,
      hashServerPlan(plan),
    );

    expect(tx.space.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      approvalPolicy: 'always-review',
    }) });
    expect(tx.agent.create).toHaveBeenCalledWith({ data: {
      ownerId: 'user-1', name: 'Codex', memoryEnabled, approvalMode,
    } });
    expect(result.grant).toEqual({ role, scopes: scopesForAgentAccessRole(role) });
    expect(installations.issueForBootstrap).toHaveBeenCalledWith(expect.objectContaining({
      role,
    }));
  });

  it('derives distinct deterministic Space slugs from the complete device session identity', async () => {
    const hash = hashServerPlan(createPlan);

    await service.bootstrap(
      { ...context, sessionId: 'device-alpha-12345678' },
      'bootstrap-key-01',
      createPlan,
      hash,
    );
    bootstrapRecord.resourceIds = null;
    bootstrapRecord.resultHash = null;
    await service.bootstrap(
      { ...context, sessionId: 'device-beta-12345678' },
      'bootstrap-key-02',
      createPlan,
      hash,
    );

    const slugs = tx.space.create.mock.calls.map((call: any[]) => call[0].data.slug);
    expect(slugs).toEqual([
      '研发知识库-05592dcfd8ef582c',
      '研发知识库-3e7eee2329a1a999',
    ]);
    expect(new Set(slugs).size).toBe(2);
  });

  it('saves the 600-second replay response before completing and consuming the token', async () => {
    const calls: string[] = [];
    redis.setStrict.mockImplementation(async () => { calls.push('replay'); });
    const updateMany = prisma.onboardingBootstrap.updateMany.getMockImplementation();
    prisma.onboardingBootstrap.updateMany.mockImplementation(async (args: any) => {
      const { data } = args;
      if (data.status === 'completed') calls.push('completed');
      return updateMany(args);
    });
    prisma.onboardingDeviceSession.updateMany.mockImplementation(async () => {
      calls.push('consumed');
      return { count: 1 };
    });

    await service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    );

    expect(redis.setStrict).toHaveBeenCalledWith(
      expect.stringMatching(/^onboarding:bootstrap-result:bootstrap-1:1:[0-9a-f-]{36}$/),
      expect.not.stringContaining('apiKey'),
      600,
    );
    expect(calls).toEqual(['replay', 'completed', 'consumed']);
    expect(prisma.onboardingDeviceSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: context.sessionId,
        tokenConsumedAt: null,
        bootstrap: {
          is: {
            executionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
            generation: 1,
            status: 'completed',
          },
        },
      },
      data: { tokenConsumedAt: new Date('2030-01-01T00:00:00.000Z') },
    });
  });

  it('creates a new Agent in an existing owner/admin Space without changing its policy', async () => {
    const plan: ServerPlan = {
      ...createPlan,
      space: { mode: 'existing', id: 'space-existing' },
      role: 'publisher',
    };
    tx.space.findFirst.mockResolvedValue({
      id: 'space-existing', name: '已有空间', approvalPolicy: 'scoped-auto-publish',
    });
    const result = await service.bootstrap(
      context, 'bootstrap-key-01', plan, hashServerPlan(plan),
    );

    expect(tx.space.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'space-existing', deletedAt: null,
        members: { some: { userId: 'user-1', role: { in: ['owner', 'admin'] } } },
      },
    });
    expect(tx.space.create).not.toHaveBeenCalled();
    expect(tx.agent.create).toHaveBeenCalledWith({
      data: { ownerId: 'user-1', name: 'Codex', memoryEnabled: true, approvalMode: 'scoped-auto-publish' },
    });
    expect(result.space).toEqual({ id: 'space-existing', name: '已有空间' });
    expect(result.agent).toEqual({ id: 'agent-1', name: 'Codex' });
  });

  it('allows publisher for an existing always-review Space without changing its policy', async () => {
    const plan: ServerPlan = {
      ...createPlan,
      space: { mode: 'existing', id: 'space-existing' },
      role: 'publisher',
    };
    tx.space.findFirst.mockResolvedValue({
      id: 'space-existing', name: '已有空间', approvalPolicy: 'always-review',
    });

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', plan, hashServerPlan(plan),
    )).resolves.toMatchObject({
      grant: { role: 'publisher', scopes: scopesForAgentAccessRole('publisher') },
    });
    expect(tx.space.create).not.toHaveBeenCalled();
    expect(tx.agent.create).toHaveBeenCalledWith({ data: {
      ownerId: 'user-1', name: 'Codex', memoryEnabled: true, approvalMode: 'scoped-auto-publish',
    } });
  });

  it.each(['', 'short-key', 'space is invalid', 'a'.repeat(129), '中文-key'])(
    'rejects missing or malformed idempotency key %p with a stable 400 business error',
    async (key) => {
      await expect(service.bootstrap(
        context, key, createPlan, hashServerPlan(createPlan),
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
    { ...context, requestedCapabilities: CAPABILITIES.slice(0, 2) },
    { ...context, requestedCapabilities: [...CAPABILITIES, 'admin'] },
  ])('rejects a narrowed or changed device-session contract %#', async (changedContext) => {
    await expect(service.bootstrap(
      changedContext, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
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
    bootstrapRecord.resultHash = createHash('sha256')
      .update(JSON.stringify(expected), 'utf8').digest('hex');
    redis.getStrict.mockResolvedValue(JSON.stringify(expected));

    bootstrapRecord.idempotencyKeyHash = idempotencyKeyHash('bootstrap-key-01');
    const replay = await service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    );

    expect(replay).toEqual(expected);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(installations.issueForBootstrap).not.toHaveBeenCalled();
  });

  it('never returns extra credential material from replay storage', async () => {
    prisma.onboardingBootstrap.create.mockRejectedValue(p2002());
    bootstrapRecord.status = 'completed';
    bootstrapRecord.idempotencyKeyHash = idempotencyKeyHash('bootstrap-key-01');
    const storedWithExtras = {
      space: { id: 'space-1', name: '研发知识库', apiKey: 'agk_space' },
      agent: { id: 'agent-1', name: 'Codex', apiKey: 'agk_agent' },
      grant: { role: 'editor', scopes: normalizeServerPlan(createPlan).scopes },
      installation: {
        code: installation.code,
        installationId: installation.installationId,
        expiresAt: installation.expiresAt,
        apiKey: 'agk_installation',
      },
    };
    const sanitized = {
      space: { id: 'space-1', name: '研发知识库' },
      agent: { id: 'agent-1', name: 'Codex' },
      grant: { role: 'editor' as const, scopes: normalizeServerPlan(createPlan).scopes },
      installation: {
        code: installation.code,
        installationId: installation.installationId,
        expiresAt: installation.expiresAt,
      },
    };
    bootstrapRecord.resultHash = createHash('sha256')
      .update(JSON.stringify(sanitized), 'utf8').digest('hex');
    redis.getStrict.mockResolvedValue(JSON.stringify(storedWithExtras));

    const replay = await service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
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
      context, key, plan, hashServerPlan(plan),
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

    const hash = hashServerPlan(createPlan);
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
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    )).rejects.toThrow('grant write failed');

    expect(prisma.onboardingBootstrap.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'bootstrap-1', status: 'running' }),
      data: { status: 'failed', leaseExpiresAt: null },
    }));
    expect(installations.issueForBootstrap).not.toHaveBeenCalled();
    expect(redis.setStrict).not.toHaveBeenCalled();
    expect(prisma.onboardingDeviceSession.updateMany).not.toHaveBeenCalled();
  });

  it('recovers resource IDs after installation failure without recreating database resources', async () => {
    prisma.onboardingBootstrap.create.mockRejectedValue(p2002());
    bootstrapRecord.status = 'failed';
    bootstrapRecord.idempotencyKeyHash = idempotencyKeyHash('bootstrap-key-01');
    bootstrapRecord.resourceIds = {
      spaceId: 'space-1', agentId: 'agent-1',
    };
    prisma.space.findFirst.mockResolvedValue({
      id: 'space-1', name: '研发知识库', deletedAt: null, approvalPolicy: 'always-review',
    });
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', name: 'Codex', ownerId: 'user-1', status: 'active', revokedAt: null,
      approvalMode: 'always-review', memoryEnabled: false,
    });

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    )).resolves.toMatchObject({ installation: { code: 'AW-INSTALL-CODE' } });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(installations.issueForBootstrap).toHaveBeenCalledTimes(1);
  });

  it('rechecks current Space administration before recovering saved resources', async () => {
    prisma.onboardingBootstrap.create.mockRejectedValue(p2002());
    bootstrapRecord.status = 'failed';
    bootstrapRecord.idempotencyKeyHash = idempotencyKeyHash('bootstrap-key-01');
    bootstrapRecord.resourceIds = {
      spaceId: 'space-1', agentId: 'agent-1',
    };
    prisma.space.findFirst.mockResolvedValue(null);
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', name: 'Codex', ownerId: 'user-1', status: 'active', revokedAt: null,
      approvalMode: 'always-review', memoryEnabled: false,
    });

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    )).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });

    expect(prisma.space.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'space-1',
        deletedAt: null,
        members: { some: { userId: 'user-1', role: { in: ['owner', 'admin'] } } },
      },
    });
    expect(installations.issueForBootstrap).not.toHaveBeenCalled();
  });

  it.each([
    ['agent owner', { ownerId: 'user-2' }],
    ['agent approval mode', { approvalMode: 'scoped-auto-publish' }],
    ['agent memory setting', { memoryEnabled: true }],
  ])('rejects recovery when the saved %s no longer matches the confirmed plan', async (
    _label,
    agentOverride,
  ) => {
    prisma.onboardingBootstrap.create.mockRejectedValue(p2002());
    bootstrapRecord.status = 'failed';
    bootstrapRecord.idempotencyKeyHash = idempotencyKeyHash('bootstrap-key-01');
    bootstrapRecord.resourceIds = {
      spaceId: 'space-1', agentId: 'agent-1',
    };
    prisma.space.findFirst.mockResolvedValue({
      id: 'space-1', name: '研发知识库', deletedAt: null, approvalPolicy: 'always-review',
    });
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', name: 'Codex', ownerId: 'user-1', status: 'active', revokedAt: null,
      approvalMode: 'always-review', memoryEnabled: false,
      ...agentOverride,
    });

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    )).rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });

    expect(installations.issueForBootstrap).not.toHaveBeenCalled();
  });

  it('revokes an issued-but-unreturned code when replay persistence fails', async () => {
    redis.setStrict.mockRejectedValue(new Error('redis unavailable'));

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    )).rejects.toThrow('Replay response was not saved');

    expect(installations.revoke).toHaveBeenCalledWith(
      'user-1', 'agent-1', 'installation-1',
    );
    expect(prisma.onboardingDeviceSession.updateMany).not.toHaveBeenCalled();
  });

  it('does not downgrade a saved completed result when final token consumption fails', async () => {
    prisma.onboardingDeviceSession.updateMany.mockRejectedValue(new Error('database unavailable'));

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    )).rejects.toThrow('database unavailable');

    expect(redis.setStrict).toHaveBeenCalledTimes(1);
    expect(prisma.onboardingBootstrap.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'bootstrap-1', status: 'running' }),
      data: expect.objectContaining({ status: 'completed' }),
    }));
    expect(prisma.onboardingBootstrap.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });

  it('declares execution fencing fields in the unpublished schema and migration', () => {
    const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
    const migration = readFileSync(join(
      __dirname,
      '../../prisma/migrations/20260810000000_add_onboarding_device_sessions/migration.sql',
    ), 'utf8');

    expect(schema).toMatch(/executionId\s+String\?/);
    expect(schema).toMatch(/generation\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/leaseExpiresAt\s+DateTime\?/);
    expect(migration).toContain('"executionId" TEXT');
    expect(migration).toContain('"generation" INTEGER NOT NULL DEFAULT 0');
    expect(migration).toContain('"leaseExpiresAt" TIMESTAMP(3)');
  });

  it('claims a random fenced execution and fences resource, completion and token writes', async () => {
    await service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    );

    const claimData = prisma.onboardingBootstrap.create.mock.calls[0][0].data;
    expect(claimData).toEqual(expect.objectContaining({
      executionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      generation: 1,
      leaseExpiresAt: expect.any(Date),
    }));
    expect(tx.onboardingBootstrap.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'bootstrap-1', executionId: claimData.executionId, generation: 1, status: 'running',
      }),
      data: expect.objectContaining({ resourceIds: expect.anything() }),
    }));
    expect(prisma.onboardingBootstrap.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'bootstrap-1', executionId: claimData.executionId, generation: 1, status: 'running',
      }),
      data: expect.objectContaining({ status: 'completed', resultHash: expect.any(String) }),
    }));
    expect(prisma.onboardingDeviceSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: context.sessionId,
        tokenConsumedAt: null,
        bootstrap: { is: { executionId: claimData.executionId, generation: 1, status: 'completed' } },
      },
      data: { tokenConsumedAt: new Date('2030-01-01T00:00:00.000Z') },
    });
  });

  it('stops a stale owner after code issuance and cannot write replay, complete or mark failed', async () => {
    const oldInstallation = { ...installation, installationId: 'installation-old', code: 'AW-OLD' };
    installations.issueForBootstrap.mockImplementation(async () => {
      bootstrapRecord = {
        ...bootstrapRecord,
        executionId: 'execution-new', generation: 2, status: 'completed',
        leaseExpiresAt: null,
      };
      return oldInstallation;
    });
    prisma.onboardingBootstrap.updateMany.mockImplementation(async ({ where, data }: any) => {
      if (
        where.executionId !== undefined
        && (where.executionId !== bootstrapRecord.executionId || where.generation !== bootstrapRecord.generation)
      ) return { count: 0 };
      bootstrapRecord = { ...bootstrapRecord, ...data };
      return { count: 1 };
    });

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    )).rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });

    expect(installations.revoke).toHaveBeenCalledWith(
      'user-1', 'agent-1', 'installation-old',
    );
    expect(redis.setStrict).not.toHaveBeenCalled();
    expect(prisma.onboardingDeviceSession.updateMany).not.toHaveBeenCalled();
    expect(bootstrapRecord).toMatchObject({
      executionId: 'execution-new', generation: 2, status: 'completed',
    });
  });

  it('leaves a fenced pending installation for takeover once its recovery state was persisted', async () => {
    const updateMany = prisma.onboardingBootstrap.updateMany.getMockImplementation();
    let renewalCount = 0;
    prisma.onboardingBootstrap.updateMany.mockImplementation(async (args: any) => {
      if (args.data.leaseExpiresAt instanceof Date) {
        renewalCount += 1;
        if (renewalCount === 4) {
          bootstrapRecord = {
            ...bootstrapRecord,
            executionId: 'execution-new', generation: 2, status: 'running',
            leaseExpiresAt: new Date(Date.now() + 30_000),
          };
          return { count: 0 };
        }
      }
      return updateMany(args);
    });

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    )).rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });

    expect(renewalCount).toBe(4);
    expect(installations.revoke).not.toHaveBeenCalled();
    expect(redis.setStrict).not.toHaveBeenCalled();
    expect(bootstrapRecord).toMatchObject({
      executionId: 'execution-new',
      generation: 2,
      status: 'running',
      resourceIds: expect.objectContaining({ pendingInstallationId: 'installation-1' }),
    });
  });

  it('verifies an ambiguous replay SET by read-back and does not revoke a code that was saved', async () => {
    let stored: string | null = null;
    redis.getStrict.mockImplementation(async () => stored);
    redis.setStrict.mockImplementation(async (_key, value) => {
      stored = value;
      throw new Error('connection reset after write');
    });

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    )).resolves.toMatchObject({ installation: { code: 'AW-INSTALL-CODE' } });

    expect(redis.getStrict).toHaveBeenCalledTimes(1);
    expect(installations.revoke).not.toHaveBeenCalled();
    expect(bootstrapRecord.status).toBe('completed');
  });

  it('keeps fenced running state when both replay SET and read-back are uncertain', async () => {
    redis.setStrict.mockRejectedValue(new Error('connection reset after write'));
    redis.getStrict.mockRejectedValue(new Error('redis read unavailable'));

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    )).rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });

    expect(installations.revoke).not.toHaveBeenCalled();
    expect(bootstrapRecord).toMatchObject({
      status: 'running',
      resourceIds: expect.objectContaining({ pendingInstallationId: 'installation-1' }),
    });
    expect(prisma.onboardingBootstrap.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });

  it('stops without revoking recoverable state when token consumption sees a newer execution', async () => {
    prisma.onboardingDeviceSession.updateMany.mockImplementation(async () => {
      bootstrapRecord = {
        ...bootstrapRecord,
        status: 'completed', executionId: 'execution-new', generation: 2,
      };
      return { count: 0 };
    });

    await expect(service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    )).rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });

    expect(installations.revoke).not.toHaveBeenCalled();
    expect(bootstrapRecord).toMatchObject({
      status: 'completed', executionId: 'execution-new', generation: 2,
    });
  });

  it('never adopts a cache attached to a failed execution', async () => {
    const stale = {
      space: { id: 'space-1', name: '研发知识库' },
      agent: { id: 'agent-1', name: 'Codex' },
      grant: { role: 'editor' as const, scopes: normalizeServerPlan(createPlan).scopes },
      installation: {
        code: 'AW-STALE', installationId: 'installation-stale', expiresAt: installation.expiresAt,
      },
    };
    prisma.onboardingBootstrap.create.mockRejectedValue(p2002());
    bootstrapRecord = {
      ...bootstrapRecord,
      status: 'failed',
      executionId: 'execution-old',
      generation: 7,
      leaseExpiresAt: null,
      idempotencyKeyHash: idempotencyKeyHash('bootstrap-key-01'),
      resourceIds: { spaceId: 'space-1', agentId: 'agent-1' },
    };
    prisma.space.findFirst.mockResolvedValue({
      id: 'space-1', name: '研发知识库', deletedAt: null, approvalPolicy: 'always-review',
    });
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', name: 'Codex', ownerId: 'user-1', status: 'active', revokedAt: null,
      approvalMode: 'always-review', memoryEnabled: false,
    });
    redis.getStrict.mockImplementation(async (key: string) => (
      key.includes(':7:execution-old') ? JSON.stringify(stale) : null
    ));

    const result = await service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    );

    expect(result.installation.code).toBe('AW-INSTALL-CODE');
    expect(redis.deleteStrict).toHaveBeenCalledWith(expect.stringContaining(':7:execution-old'));
  });

  it('adopts a valid stale running replay under the new generation without issuing again', async () => {
    const stale = {
      space: { id: 'space-1', name: '研发知识库' },
      agent: { id: 'agent-1', name: 'Codex' },
      grant: { role: 'editor' as const, scopes: normalizeServerPlan(createPlan).scopes },
      installation: {
        code: 'AW-RECOVERED', installationId: 'installation-stale', expiresAt: installation.expiresAt,
      },
    };
    prisma.onboardingBootstrap.create.mockRejectedValue(p2002());
    bootstrapRecord = {
      ...bootstrapRecord,
      status: 'running', executionId: 'execution-old', generation: 7,
      leaseExpiresAt: new Date(Date.now() - 1), updatedAt: new Date(Date.now() - 31_000),
      idempotencyKeyHash: idempotencyKeyHash('bootstrap-key-01'),
      resourceIds: {
        spaceId: 'space-1', agentId: 'agent-1',
        pendingInstallationId: 'installation-stale',
      },
    };
    prisma.space.findFirst.mockResolvedValue({
      id: 'space-1', name: '研发知识库', deletedAt: null, approvalPolicy: 'always-review',
    });
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', name: 'Codex', ownerId: 'user-1', status: 'active', revokedAt: null,
      approvalMode: 'always-review', memoryEnabled: false,
    });
    redis.getStrict.mockImplementation(async (key: string) => (
      key.includes(':7:execution-old') ? JSON.stringify(stale) : null
    ));

    const result = await service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    );

    expect(result.installation.code).toBe('AW-RECOVERED');
    expect(installations.issueForBootstrap).not.toHaveBeenCalled();
    expect(installations.revoke).not.toHaveBeenCalled();
    expect(redis.setStrict).toHaveBeenCalledWith(
      expect.stringContaining(':8:'), JSON.stringify(stale), 600,
    );
  });

  it('revokes stale pending installation state before issuing under a new generation', async () => {
    prisma.onboardingBootstrap.create.mockRejectedValue(p2002());
    bootstrapRecord = {
      ...bootstrapRecord,
      status: 'running', executionId: 'execution-old', generation: 3,
      leaseExpiresAt: new Date(Date.now() - 1), updatedAt: new Date(Date.now() - 31_000),
      idempotencyKeyHash: idempotencyKeyHash('bootstrap-key-01'),
      resourceIds: {
        spaceId: 'space-1', agentId: 'agent-1',
        pendingInstallationId: 'installation-old',
      },
    };
    prisma.space.findFirst.mockResolvedValue({
      id: 'space-1', name: '研发知识库', deletedAt: null, approvalPolicy: 'always-review',
    });
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', name: 'Codex', ownerId: 'user-1', status: 'active', revokedAt: null,
      approvalMode: 'always-review', memoryEnabled: false,
    });

    await service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    );

    expect(installations.revoke).toHaveBeenCalledWith('user-1', 'agent-1', 'installation-old');
    expect(installations.revoke.mock.invocationCallOrder[0])
      .toBeLessThan(installations.issueForBootstrap.mock.invocationCallOrder[0]);
    expect(redis.setStrict).toHaveBeenCalledWith(
      expect.stringContaining(':4:'), expect.any(String), 600,
    );
  });

  it('uses an absolute two-second loser deadline with bounded exponential backoff', async () => {
    prisma.onboardingBootstrap.create.mockRejectedValue(p2002());
    bootstrapRecord = {
      ...bootstrapRecord,
      status: 'running', executionId: 'execution-owner', generation: 2,
      leaseExpiresAt: new Date(Date.now() + 30_000),
      idempotencyKeyHash: idempotencyKeyHash('bootstrap-key-01'),
    };
    const timeoutSpy = jest.spyOn(global, 'setTimeout');
    const pending = service.bootstrap(
      context, 'bootstrap-key-01', createPlan, hashServerPlan(createPlan),
    );
    const assertion = expect(pending).rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });
    await jest.advanceTimersByTimeAsync(2_100);

    await assertion;
    const delays = timeoutSpy.mock.calls.map((call) => Number(call[1]));
    expect(delays[0]).toBe(20);
    expect(Math.max(...delays)).toBeLessThanOrEqual(200);
    expect(new Set(delays).size).toBeGreaterThan(1);
    expect(prisma.onboardingBootstrap.findUnique.mock.calls.length).toBeLessThanOrEqual(20);
  });
});

describe('OnboardBootstrapService multi-Agent account isolation', () => {
  it('creates one independent Agent per device session and replays only within that session', async () => {
    const bootstraps: any[] = [];
    const agents: any[] = [];
    const grants: any[] = [];
    const replay = new Map<string, string>();
    let installationCount = 0;

    function updateBootstrap({ where, data }: any) {
      const row = bootstraps.find((item) => item.id === where.id);
      if (!row) return { count: 0 };
      const exactLease = where.leaseExpiresAt instanceof Date
        ? row.leaseExpiresAt?.getTime() === where.leaseExpiresAt.getTime()
        : true;
      const activeLease = where.leaseExpiresAt?.gt
        ? row.leaseExpiresAt?.getTime() > where.leaseExpiresAt.gt.getTime()
        : true;
      if (
        !exactLease || !activeLease
        || (where.status !== undefined && row.status !== where.status)
        || (where.executionId !== undefined && row.executionId !== where.executionId)
        || (where.generation !== undefined && row.generation !== where.generation)
      ) return { count: 0 };
      Object.assign(row, data, {
        generation: data.generation?.increment
          ? row.generation + data.generation.increment
          : data.generation ?? row.generation,
        updatedAt: new Date(),
      });
      return { count: 1 };
    }

    const prisma: any = {
      onboardingBootstrap: {
        create: jest.fn(async ({ data }) => {
          if (bootstraps.some((row) => row.deviceSessionId === data.deviceSessionId)) throw p2002();
          const row = {
            id: `bootstrap-${data.deviceSessionId}`,
            ...data,
            resourceIds: null,
            resultHash: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          bootstraps.push(row);
          return row;
        }),
        findUnique: jest.fn(async ({ where }) => (
          bootstraps.find((row) => row.deviceSessionId === where.deviceSessionId) || null
        )),
        updateMany: jest.fn(async (args) => updateBootstrap(args)),
      },
      onboardingDeviceSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      space: { findFirst: jest.fn() },
      agent: { findUnique: jest.fn() },
      agentGrant: { findUnique: jest.fn() },
    };
    const tx: any = {
      space: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'space-existing', name: '共享空间', approvalPolicy: 'always-review', deletedAt: null,
        }),
      },
      agent: {
        findFirst: jest.fn(async ({ where }) => agents.find((agent) => (
          agent.ownerId === where.ownerId
          && agent.revokedAt === where.revokedAt
          && agent.status === where.status
          && (where.name === undefined || agent.name === where.name)
          && (where.approvalMode === undefined || agent.approvalMode === where.approvalMode)
        )) || null),
        create: jest.fn(async ({ data }) => {
          const agent = {
            id: `agent-${agents.length + 1}`,
            ...data,
            status: 'active',
            revokedAt: null,
          };
          agents.push(agent);
          return agent;
        }),
      },
      agentGrant: {
        upsert: jest.fn(async ({ create, update }) => {
          const existing = grants.find((grant) => (
            grant.agentId === create.agentId && grant.spaceId === create.spaceId
          ));
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const grant = { id: `grant-${grants.length + 1}`, ...create };
          grants.push(grant);
          return grant;
        }),
      },
      onboardingBootstrap: { updateMany: jest.fn(async (args) => updateBootstrap(args)) },
    };
    prisma.$transaction = jest.fn(async (callback) => callback(tx));
    const redis = {
      getStrict: jest.fn(async (key: string) => replay.get(key) || null),
      setStrict: jest.fn(async (key: string, value: string) => { replay.set(key, value); }),
      deleteStrict: jest.fn(async (key: string) => Number(replay.delete(key))),
    };
    const installations = {
      issueForBootstrap: jest.fn(async () => {
        installationCount += 1;
        return {
          installationId: `installation-${installationCount}`,
          code: `AW-CODE-${installationCount}`,
          expiresAt: '2030-01-01T00:10:00.000Z',
          instructions: 'install',
        };
      }),
      revoke: jest.fn(),
    };
    const config = {
      get: jest.fn((key: string) => key === 'PUBLIC_API_URL'
        ? 'https://agentwiki.example/api'
        : 'production'),
    };
    const service = new OnboardBootstrapService(prisma, redis as any, installations as any, config as any);
    const plan = (agentName: string): ServerPlan => ({
      ...createPlan,
      space: { mode: 'existing', id: 'space-existing' },
      agentName,
    });
    const run = (sessionId: string, key: string, agentName: string) => {
      const selected = plan(agentName);
      return service.bootstrap(
        { ...context, sessionId },
        key,
        selected,
        hashServerPlan(selected),
      );
    };

    const first = await run('device-session-alpha', 'multi-agent-key-01', 'Alpha');
    const second = await run('device-session-beta', 'multi-agent-key-02', 'Beta');
    const third = await run('device-session-alpha-2', 'multi-agent-key-03', 'Alpha');
    const firstReplay = await run('device-session-alpha', 'multi-agent-key-01', 'Alpha');

    expect(first.agent.id).not.toBe(second.agent.id);
    expect(third.agent.id).not.toBe(first.agent.id);
    expect(third.agent.id).not.toBe(second.agent.id);
    expect(firstReplay.agent.id).toBe(first.agent.id);
    expect(firstReplay).toEqual(first);
    expect(agents.map((agent) => agent.name)).toEqual(['Alpha', 'Beta', 'Alpha']);
    expect(grants).toEqual([]);
    expect([
      first.installation.installationId,
      second.installation.installationId,
      third.installation.installationId,
    ]).toEqual(['installation-1', 'installation-2', 'installation-3']);
    expect(bootstraps.map((row) => row.deviceSessionId)).toEqual([
      'device-session-alpha', 'device-session-beta', 'device-session-alpha-2',
    ]);
    expect(tx.agent.create).toHaveBeenCalledTimes(3);
    expect(tx.agentGrant.upsert).not.toHaveBeenCalled();
    expect(installations.issueForBootstrap).toHaveBeenCalledTimes(3);
    expect(replay.size).toBe(3);
    expect([...replay.keys()]).toEqual(expect.arrayContaining([
      expect.stringContaining('bootstrap-device-session-alpha:'),
      expect.stringContaining('bootstrap-device-session-beta:'),
      expect.stringContaining('bootstrap-device-session-alpha-2:'),
    ]));
  });
});
