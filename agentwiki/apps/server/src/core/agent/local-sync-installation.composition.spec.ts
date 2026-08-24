import { ForbiddenException } from '@nestjs/common';
import { AgentService } from './agent.service';
import { LocalSyncInstallationService } from './local-sync-installation.service';

type MembershipRole = 'owner' | 'admin' | 'editor' | 'viewer' | null;

interface CompositionState {
  owner: {
    id: string;
    platformRole: 'user' | 'super_admin';
    deletedAt: Date | null;
    lockedAt: Date | null;
  };
  agent: {
    id: string;
    ownerId: string;
    status: string;
    revokedAt: Date | null;
  };
  space: { id: string; deletedAt: Date | null };
  membershipRole: MembershipRole;
  grant: { id: string; agentId: string; spaceId: string; role: string } | null;
  credential: {
    id: string;
    agentId: string;
    authorizationId: string;
    name: string;
    prefix: string;
    keyHash: string;
    localSyncInstallationId: string;
    revokedAt: Date | null;
  } | null;
}

function composeInstallationFlow(input?: {
  platformRole?: 'user' | 'super_admin';
  membershipRole?: MembershipRole;
}) {
  const state: CompositionState = {
    owner: {
      id: 'owner-1',
      platformRole: input?.platformRole ?? 'super_admin',
      deletedAt: null,
      lockedAt: null,
    },
    agent: { id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null },
    space: { id: 'space-1', deletedAt: null },
    membershipRole: input?.membershipRole ?? null,
    grant: null,
    credential: null,
  };
  const redisState = new Map<string, string>();
  const prisma: any = {};

  prisma.$transaction = jest.fn(async (operation: (tx: any) => Promise<unknown>) => operation(prisma));
  prisma.$queryRaw = jest.fn().mockResolvedValue([]);
  prisma.user = {
    findFirst: jest.fn(async ({ where }: any) => {
      if (
        where.id !== state.owner.id
        || (where.platformRole && where.platformRole !== state.owner.platformRole)
        || (where.deletedAt === null && state.owner.deletedAt)
        || (where.lockedAt === null && state.owner.lockedAt)
      ) return null;
      return { id: state.owner.id, platformRole: state.owner.platformRole };
    }),
  };
  prisma.agent = {
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.id !== state.agent.id) return null;
      return { ...state.agent, grants: state.grant ? [state.grant] : [], credentials: [] };
    }),
    findFirst: jest.fn(async ({ where }: any) => {
      if (
        where.id !== state.agent.id
        || where.ownerId !== state.agent.ownerId
        || (where.status && where.status !== state.agent.status)
        || (where.revokedAt === null && state.agent.revokedAt)
        || (where.owner?.deletedAt === null && state.owner.deletedAt)
        || (where.owner?.lockedAt === null && state.owner.lockedAt)
      ) return null;
      return { id: state.agent.id, status: state.agent.status };
    }),
    update: jest.fn(async ({ data }: any) => ({ ...state.agent, ...data })),
  };
  prisma.space = {
    findFirst: jest.fn(async ({ where }: any) => {
      if (where.id !== state.space.id || (where.deletedAt === null && state.space.deletedAt)) {
        return null;
      }
      const allowedRoles = where.members?.some?.role?.in as string[] | undefined;
      if (allowedRoles && (!state.membershipRole || !allowedRoles.includes(state.membershipRole))) {
        return null;
      }
      return { id: state.space.id };
    }),
  };
  prisma.agentGrant = {
    findUnique: jest.fn(async () => state.grant ? { role: state.grant.role } : null),
    upsert: jest.fn(async ({ create, update }: any) => {
      const grant = state.grant
        ? { ...state.grant, ...update }
        : { id: 'grant-1', ...create };
      state.grant = grant;
      return { id: grant.id, role: grant.role };
    }),
  };
  prisma.agentCredential = {
    upsert: jest.fn(async ({ create }: any) => {
      state.credential ??= {
        id: 'credential-1',
        ...create,
        revokedAt: null,
      };
      return state.credential;
    }),
  };
  prisma.agentAuditEvent = { create: jest.fn().mockResolvedValue({}) };

  const redis = {
    setOnce: jest.fn(async (key: string, value: string) => {
      if (redisState.has(key)) return false;
      redisState.set(key, value);
      return true;
    }),
    getStrict: jest.fn(async (key: string) => redisState.get(key) ?? null),
    setStrict: jest.fn(async (key: string, value: string) => { redisState.set(key, value); }),
    deleteStrict: jest.fn(async (key: string) => Number(redisState.delete(key))),
    deleteIfValueMatches: jest.fn(async (key: string, value: string) => {
      if (redisState.get(key) !== value) return false;
      redisState.delete(key);
      return true;
    }),
    incrementWithWindow: jest.fn().mockResolvedValue(1),
  };
  const config = {
    get: jest.fn((key: string) => key === 'LOCAL_SYNC_PACKAGE_VERSION'
      ? '0.6.1'
      : key === 'JWT_SECRET'
        ? 'composition-test-secret'
        : undefined),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const agents = new AgentService(prisma);
  const installations = new LocalSyncInstallationService(
    redis as any,
    agents,
    config as any,
    audit as any,
  );

  return { state, redisState, prisma, installations };
}

async function issueInstallation(
  composition: ReturnType<typeof composeInstallationFlow>,
  isSuperAdmin: boolean,
) {
  return composition.installations.create(
    'owner-1',
    'agent-1',
    'space-1',
    'editor',
    '0.6.1',
    'https://wiki.test/api',
    isSuperAdmin,
  );
}

describe('Local Sync installation issue/exchange composition', () => {
  it('issues and exchanges a no-membership current Super Admin intent into a Grant-bound Credential', async () => {
    const composition = composeInstallationFlow();

    const installation = await issueInstallation(composition, true);
    const storedIntent = JSON.parse(
      composition.redisState.get(`local-sync:install:${installation.installationId}`)!,
    );
    expect(storedIntent).not.toHaveProperty('isSuperAdmin');

    await expect(composition.installations.exchange(installation.code, '192.0.2.1'))
      .resolves.toMatchObject({
        agentId: 'agent-1',
        spaceId: 'space-1',
        credentialId: 'credential-1',
        role: 'editor',
      });

    expect(composition.state.grant).toMatchObject({
      id: 'grant-1', agentId: 'agent-1', spaceId: 'space-1', role: 'editor',
    });
    expect(composition.state.credential).toMatchObject({
      id: 'credential-1', agentId: 'agent-1', authorizationId: 'grant-1', revokedAt: null,
    });
    expect(composition.state.credential).not.toHaveProperty('role');
    expect(composition.state.credential).not.toHaveProperty('scopes');
    expect(composition.prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'owner-1', deletedAt: null, lockedAt: null },
      select: { id: true, platformRole: true },
    });
  });

  it.each(['owner', 'admin'] as const)(
    'keeps ordinary Space %s issue/exchange compatibility',
    async (membershipRole) => {
      const composition = composeInstallationFlow({ platformRole: 'user', membershipRole });
      const installation = await issueInstallation(composition, false);

      await expect(composition.installations.exchange(installation.code, '192.0.2.2'))
        .resolves.toMatchObject({ credentialId: 'credential-1', role: 'editor' });
    },
  );

  it('rejects a no-membership owner downgraded from Super Admin after issue', async () => {
    const composition = composeInstallationFlow();
    const installation = await issueInstallation(composition, true);
    composition.state.owner.platformRole = 'user';

    await expect(composition.installations.exchange(installation.code, '192.0.2.3'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(composition.state.grant).toBeNull();
    expect(composition.state.credential).toBeNull();
  });

  it.each(['deletedAt', 'lockedAt'] as const)(
    'rejects a Super Admin whose owner account has current %s',
    async (field) => {
      const composition = composeInstallationFlow();
      const installation = await issueInstallation(composition, true);
      composition.state.owner[field] = new Date('2030-01-01T00:00:00.000Z');

      await expect(composition.installations.exchange(installation.code, '192.0.2.4'))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(composition.state.credential).toBeNull();
    },
  );

  it.each([
    ['foreign-owned', (state: CompositionState) => { state.agent.ownerId = 'owner-2'; }],
    ['paused', (state: CompositionState) => { state.agent.status = 'paused'; }],
    ['revoked', (state: CompositionState) => {
      state.agent.status = 'revoked';
      state.agent.revokedAt = new Date('2030-01-01T00:00:00.000Z');
    }],
  ] as const)('rejects a currently %s Agent after issue', async (_case, mutate) => {
    const composition = composeInstallationFlow();
    const installation = await issueInstallation(composition, true);
    mutate(composition.state);

    await expect(composition.installations.exchange(installation.code, '192.0.2.5'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(composition.state.credential).toBeNull();
  });

  it('rejects a Space deleted after issue', async () => {
    const composition = composeInstallationFlow();
    const installation = await issueInstallation(composition, true);
    composition.state.space.deletedAt = new Date('2030-01-01T00:00:00.000Z');

    await expect(composition.installations.exchange(installation.code, '192.0.2.6'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(composition.state.credential).toBeNull();
  });
});
