import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { AgentService } from './agent.service';

describe('AgentService grant scope validation', () => {
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    agent: { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    space: { findFirst: jest.fn() },
    user: { findFirst: jest.fn() },
    agentCredential: {
      create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    agentGrant: { findUnique: jest.fn(), findFirst: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    agentAuditEvent: { create: jest.fn(), findMany: jest.fn() },
  } as any;
  const service = new AgentService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (operation: any) => operation(prisma));
    prisma.$queryRaw.mockResolvedValue([{ id: 'locked' }]);
    prisma.agent.findFirst.mockResolvedValue({ id: 'agent-1', status: 'active' });
    prisma.space.findFirst.mockResolvedValue({ id: 'space-1' });
    prisma.user.findFirst.mockResolvedValue({ id: 'owner-1', platformRole: 'user' });
  });

  it('replays one atomic Agent create for the same owner idempotency key', async () => {
    let persisted: any;
    prisma.agent.create.mockImplementation(async ({ data }: any) => {
      if (persisted) {
        throw new Prisma.PrismaClientKnownRequestError('duplicate Agent create', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['id'] },
        });
      }
      persisted = {
        ...data,
        status: 'active',
        revokedAt: null,
        createdAt: new Date('2026-08-25T00:00:00.000Z'),
        updatedAt: new Date('2026-08-25T00:00:00.000Z'),
      };
      return persisted;
    });
    prisma.agent.findUnique.mockImplementation(async ({ where }: any) => (
      where.id === persisted?.id ? persisted : null
    ));
    prisma.agentAuditEvent.create.mockResolvedValue({ id: 'audit-1' });
    const input = {
      name: 'Writer',
      description: null,
      memoryEnabled: false,
      idempotencyKey: 'create-agent-attempt-0001',
    } as any;

    const first = await service.create('owner-1', input);
    const replay = await service.create('owner-1', input);

    expect(replay).toEqual(first);
    expect(first.id).toMatch(/^agent_[a-f0-9]{32}$/u);
    expect(prisma.agent.create).toHaveBeenCalledTimes(2);
    expect(prisma.agentAuditEvent.create).toHaveBeenCalledTimes(1);
    await expect(service.create('owner-1', {
      ...input,
      name: 'Different payload',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows an owned Agent connection for a platform Super Admin without Space membership', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', revokedAt: null, grants: [], credentials: [], status: 'active',
    });
    prisma.space.findFirst.mockResolvedValue({ id: 'space-1' });

    await expect(service.assertCanIssueConnection(
      'owner-1', 'agent-1', 'space-1', true,
    )).resolves.toBeUndefined();

    expect(prisma.space.findFirst).toHaveBeenCalledWith({
      where: { id: 'space-1', deletedAt: null },
      select: { id: true },
    });
  });

  it('does not bypass Agent ownership for a platform Super Admin', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-2', revokedAt: null, grants: [], credentials: [], status: 'active',
    });

    await expect(service.assertCanIssueConnection(
      'owner-1', 'agent-1', 'space-1', true,
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.space.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['paused', {
      id: 'agent-1', ownerId: 'owner-1', revokedAt: null, grants: [], credentials: [], status: 'paused',
    }, BadRequestException],
    ['revoked', {
      id: 'agent-1', ownerId: 'owner-1', revokedAt: new Date('2030-01-01T00:00:00.000Z'),
      grants: [], credentials: [], status: 'revoked',
    }, NotFoundException],
  ])('does not allow a %s Agent connection for a platform Super Admin', async (_status, agent, errorType) => {
    prisma.agent.findUnique.mockResolvedValue(agent);

    await expect(service.assertCanIssueConnection(
      'owner-1', 'agent-1', 'space-1', true,
    )).rejects.toBeInstanceOf(errorType);

    expect(prisma.space.findFirst).not.toHaveBeenCalled();
  });

  it('does not bypass a missing Space for a platform Super Admin', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', revokedAt: null, grants: [], credentials: [], status: 'active',
    });
    prisma.space.findFirst.mockResolvedValue(null);

    await expect(service.assertCanIssueConnection(
      'owner-1', 'agent-1', 'space-missing', true,
    )).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not bypass a deleted Space for a platform Super Admin', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', revokedAt: null, grants: [], credentials: [], status: 'active',
    });
    prisma.space.findFirst.mockImplementation(async ({ where }: any) => (
      where.deletedAt === null ? null : { id: 'space-deleted' }
    ));

    await expect(service.assertCanIssueConnection(
      'owner-1', 'agent-1', 'space-deleted', true,
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.space.findFirst).toHaveBeenCalledWith({
      where: { id: 'space-deleted', deletedAt: null },
      select: { id: true },
    });
  });

  it('reports a credential as an identity bound to one authorization record', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', revokedAt: null, grants: [],
      credentials: [{
        id: 'credential-1', name: 'Connection', prefix: 'agk_preview',
        authorizationId: 'grant-1', expiresAt: null, lastUsedAt: null,
        createdAt: new Date('2026-08-23T00:00:00.000Z'),
        authorization: { role: 'editor', space: { id: 'space-1', name: 'Space' } },
      }],
    });

    const agent = await service.getOwned('owner-1', 'agent-1');

    expect(agent.credentials[0]).toMatchObject({
      id: 'credential-1',
      authorization: {
        id: 'grant-1', role: 'editor', space: { id: 'space-1', name: 'Space' },
        scopes: scopesForAgentAccessRole('editor'),
      },
    });
    expect(agent.credentials[0]).not.toHaveProperty('role');
    expect(agent.credentials[0]).not.toHaveProperty('scopes');
  });

  it('locks the owner before the Agent and credentials when revoking an Agent', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', revokedAt: null, grants: [], credentials: [],
    });
    prisma.agent.findFirst.mockResolvedValue({ id: 'agent-1' });
    prisma.agentCredential.updateMany.mockResolvedValue({ count: 1 });
    prisma.agent.update.mockResolvedValue({ id: 'agent-1' });
    prisma.agentAuditEvent.create.mockResolvedValue({});

    await service.revoke('owner-1', 'agent-1');

    const lockedTables = prisma.$queryRaw.mock.calls.map(([query]: any[]) =>
      query.strings.join(' '),
    );
    expect(lockedTables[0]).toContain('FROM "User"');
    expect(lockedTables[1]).toContain('FROM "Agent"');
    expect(prisma.agentCredential.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.agent.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'agent-1' },
      data: expect.objectContaining({ status: 'revoked' }),
    }));
  });

  it('does not revoke credentials when Agent ownership changes before the transaction', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', revokedAt: null, grants: [], credentials: [],
    });
    prisma.agent.findFirst.mockResolvedValue(null);

    await expect(service.revoke('owner-1', 'agent-1')).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.agentCredential.updateMany).not.toHaveBeenCalled();
    expect(prisma.agent.update).not.toHaveBeenCalled();
  });

  it('limits Agent integration diagnostics to the current bound authorization', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', revokedAt: null, grants: [], credentials: [],
    });
    prisma.agent.findMany.mockResolvedValue([]);

    await service.integrationAccess('owner-1', 'agent-1', 'grant-1');

    expect(prisma.agent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'agent-1' }),
      select: expect.objectContaining({
        grants: expect.objectContaining({ where: { id: 'grant-1' } }),
        credentials: expect.objectContaining({
          where: { revokedAt: null, authorizationId: 'grant-1' },
        }),
      }),
    }));
  });

  it('limits Agent MCP audit diagnostics to the current credential', async () => {
    prisma.agentAuditEvent.findMany.mockResolvedValue([]);

    await service.recentMcpCalls('owner-1', 'agent-1', 'credential-1');

    expect(prisma.agentAuditEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agentId: 'agent-1',
        metadata: { path: ['credentialId'], equals: 'credential-1' },
      }),
    }));
  });

  it('creates the Grant authorization before an identity-only bound Credential', async () => {
    prisma.agent.findFirst.mockResolvedValue({ id: 'agent-1' });
    prisma.space.findFirst.mockResolvedValue({ id: 'space-1' });
    prisma.agentCredential.upsert.mockResolvedValue({
      id: 'credential-1', agentId: 'agent-1', authorizationId: 'grant-1',
      keyHash: '58f5ceceff4ed07826c298f6b62e3fdb2cebfec07f946843c538fd45819e87ac',
      revokedAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue({ role: 'reader' });
    prisma.agentGrant.upsert.mockResolvedValue({ id: 'grant-1', role: 'editor' });
    prisma.agentAuditEvent.create.mockResolvedValue({});

    const result = await service.exchangeConnectionIntent({
      ownerId: 'owner-1', agentId: 'agent-1', spaceId: 'space-1', role: 'editor',
      installationId: 'installation-1', rawKey: 'agk_deterministic',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.agentGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ role: 'editor' }),
      update: { role: 'editor' },
    }));
    const credentialWrite = prisma.agentCredential.upsert.mock.calls[0][0];
    expect(credentialWrite.create).toEqual(expect.objectContaining({ authorizationId: 'grant-1' }));
    expect(credentialWrite.create).not.toHaveProperty('role');
    expect(credentialWrite.create).not.toHaveProperty('scopes');
    expect(prisma.agentAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'connection.authorize' }),
    }));
    expect(result).toEqual(expect.objectContaining({
      grantId: 'grant-1', role: 'editor', scopes: scopesForAgentAccessRole('editor'),
    }));
  });

  it('binds receipt validation to the original Grant identity', async () => {
    prisma.agentCredential.findFirst.mockResolvedValue({ id: 'credential-1', authorizationId: 'grant-original' });
    prisma.agentGrant.findFirst.mockResolvedValue(null);

    await expect(service.assertConnectionReceipt({
      ownerId: 'owner-1',
      agentId: 'agent-1',
      credentialId: 'credential-1',
      grantId: 'grant-original',
      spaceId: 'space-1',
      role: 'editor',
    })).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.agentGrant.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'grant-original',
        agentId: 'agent-1',
        spaceId: 'space-1',
        role: 'editor',
      },
      select: { id: true, role: true, space: { select: { deletedAt: true } } },
    });

    prisma.agentGrant.findFirst.mockResolvedValue({ id: 'grant-recreated', role: 'editor', space: { deletedAt: null } });
    await expect(service.assertConnectionReceipt({
      ownerId: 'owner-1',
      agentId: 'agent-1',
      credentialId: 'credential-1',
      grantId: 'grant-original',
      spaceId: 'space-1',
      role: 'editor',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a connection receipt after its Space is deleted', async () => {
    prisma.agentCredential.findFirst.mockResolvedValue({ id: 'credential-1', authorizationId: 'grant-1' });
    prisma.agentGrant.findFirst.mockResolvedValue({
      id: 'grant-1',
      role: 'editor',
      space: { deletedAt: new Date('2030-01-01T00:00:00.000Z') },
    });

    await expect(service.assertConnectionReceipt({
      ownerId: 'owner-1',
      agentId: 'agent-1',
      credentialId: 'credential-1',
      grantId: 'grant-1',
      spaceId: 'space-1',
      role: 'editor',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails the connection transaction when ownership or Space administration changed', async () => {
    prisma.agent.findFirst.mockResolvedValue({ id: 'agent-1' });
    prisma.space.findFirst.mockResolvedValue(null);

    await expect(service.exchangeConnectionIntent({
      ownerId: 'owner-1', agentId: 'agent-1', spaceId: 'space-1', role: 'editor',
      installationId: 'installation-1', rawKey: 'agk_deterministic',
    })).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.agentCredential.upsert).not.toHaveBeenCalled();
    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
    expect(prisma.agentAuditEvent.create).not.toHaveBeenCalled();
  });

  it('enables publisher switches in the transaction while lower roles never turn them off', async () => {
    prisma.agent.findFirst.mockResolvedValue({ id: 'agent-1' });
    prisma.space.findFirst.mockResolvedValue({ id: 'space-1' });
    prisma.agentGrant.findUnique.mockResolvedValue(null);
    prisma.agentCredential.upsert.mockImplementation(async ({ create }: any) => ({
      id: 'credential-1', agentId: create.agentId, authorizationId: create.authorizationId,
      keyHash: create.keyHash, revokedAt: null,
    }));
    prisma.agentGrant.upsert.mockImplementation(async ({ create }: any) => ({ id: 'grant-1', role: create.role }));
    prisma.agentAuditEvent.create.mockResolvedValue({});
    prisma.agent.update.mockResolvedValue({});

    await service.exchangeConnectionIntent({
      ownerId: 'owner-1', agentId: 'agent-1', spaceId: 'space-1', role: 'publisher',
      installationId: 'installation-publisher', rawKey: 'agk_publisher',
    });
    expect(prisma.agent.update).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: { memoryEnabled: true, approvalMode: 'scoped-auto-publish' },
    });

    prisma.agent.update.mockClear();
    await service.exchangeConnectionIntent({
      ownerId: 'owner-1', agentId: 'agent-1', spaceId: 'space-1', role: 'reader',
      installationId: 'installation-reader', rawKey: 'agk_reader',
    });
    expect(prisma.agent.update).not.toHaveBeenCalled();
  });

  it('derives a grant ceiling from its role', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue(null);
    prisma.agentGrant.upsert.mockResolvedValue({ id: 'grant-1', role: 'publisher' });
    prisma.agentAuditEvent.create.mockResolvedValue({});

    await service.upsertGrantForSpace('owner-1', 'agent-1', 'space-1', 'publisher');

    expect(prisma.agentGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        role: 'publisher',
      }),
      update: { role: 'publisher' },
    }));
    expect(prisma.agentAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: { oldRole: null, newRole: 'publisher', spaceId: 'space-1' },
      }),
    });
  });

  it('locks an existing Grant before Space for every Grant mutation', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue(null);
    prisma.agentGrant.upsert.mockResolvedValue({ id: 'grant-1', role: 'editor' });
    prisma.agentAuditEvent.create.mockResolvedValue({});

    await service.upsertGrantForSpace('owner-1', 'agent-1', 'space-1', 'editor');

    const lockedTables = prisma.$queryRaw.mock.calls.map(([query]: any[]) => (
      /FROM\s+"([^"]+)"/u.exec(query.strings.join(' '))?.[1]
    ));
    expect(lockedTables).toEqual([
      'User', 'Agent', 'AgentGrant', 'Space', 'SpaceMember',
    ]);
  });

  it('enables publisher switches without letting lower grant roles turn them off', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue(null);
    prisma.agentGrant.upsert.mockResolvedValue({ id: 'grant-1', role: 'publisher' });
    prisma.agent.update.mockResolvedValue({});
    prisma.agentAuditEvent.create.mockResolvedValue({});

    await service.upsertGrantForSpace('owner-1', 'agent-1', 'space-1', 'publisher');
    expect(prisma.agent.update).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: { memoryEnabled: true, approvalMode: 'scoped-auto-publish' },
    });

    prisma.agent.update.mockClear();
    prisma.agentGrant.findUnique.mockResolvedValue({ id: 'grant-1', role: 'publisher' });
    await service.upsertGrantForSpace('owner-1', 'agent-1', 'space-1', 'editor');
    expect(prisma.agent.update).not.toHaveBeenCalled();
  });

  it('persists a publisher Grant and its required Agent switches in one transaction', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue(null);
    prisma.agentGrant.upsert.mockResolvedValue({ id: 'partial-grant' });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked' }]),
      agentGrant: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'grant-1', role: 'publisher' }),
      },
      agent: {
        findFirst: jest.fn().mockResolvedValue({ id: 'agent-1', status: 'active' }),
        update: jest.fn().mockResolvedValue({}),
      },
      space: { findFirst: jest.fn().mockResolvedValue({ id: 'space-1' }) },
      agentAuditEvent: { create: jest.fn().mockResolvedValue({}) },
    } as any;
    prisma.$transaction.mockImplementationOnce(async (operation: any) => operation(tx));
    prisma.agentAuditEvent.create.mockResolvedValue({});

    await service.upsertGrantForSpace('owner-1', 'agent-1', 'space-1', 'publisher');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.agentGrant.upsert).toHaveBeenCalledTimes(1);
    expect(tx.agent.update).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: { memoryEnabled: true, approvalMode: 'scoped-auto-publish' },
    });
    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
  });

  it('revalidates Agent ownership and Space administration in the Grant write transaction', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked' }]),
      agent: { findFirst: jest.fn().mockResolvedValue({ id: 'agent-1', status: 'active' }), update: jest.fn() },
      space: { findFirst: jest.fn().mockResolvedValue(null) },
      agentGrant: { findUnique: jest.fn(), upsert: jest.fn() },
    } as any;
    prisma.$transaction.mockImplementationOnce(async (operation: any) => operation(tx));

    await expect(service.upsertGrantForSpace(
      'owner-1', 'agent-1', 'space-1', 'editor',
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.agentGrant.upsert).not.toHaveBeenCalled();
    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
  });

  it('revalidates Agent ownership and Space administration in the Grant removal transaction', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked' }]),
      agent: { findFirst: jest.fn().mockResolvedValue({ id: 'agent-1' }) },
      space: { findFirst: jest.fn().mockResolvedValue(null) },
      agentGrant: { deleteMany: jest.fn() },
    } as any;
    prisma.$transaction.mockImplementationOnce(async (operation: any) => operation(tx));

    await expect(service.removeGrant(
      'owner-1', 'agent-1', 'space-1',
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.agentGrant.deleteMany).not.toHaveBeenCalled();
    expect(prisma.agentGrant.deleteMany).not.toHaveBeenCalled();
  });

  it('revalidates a platform administrator override in the Grant transaction', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'admin-1', status: 'active', revokedAt: null,
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked' }]),
      agent: { findFirst: jest.fn().mockResolvedValue({ id: 'agent-1', status: 'active' }), update: jest.fn() },
      space: { findFirst: jest.fn().mockResolvedValue({ id: 'space-1' }) },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      agentGrant: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      agentAuditEvent: { create: jest.fn() },
    } as any;
    prisma.$transaction.mockImplementationOnce(async (operation: any) => operation(tx));

    await expect(service.upsertGrantForSpace(
      'admin-1', 'agent-1', 'space-1', 'editor', true,
    )).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.agentGrant.upsert).not.toHaveBeenCalled();
  });


  it('rejects a missing or revoked agent before persisting a new grant', async () => {
    prisma.agent.findUnique.mockResolvedValueOnce(null);

    await expect(service.upsertGrantForSpace(
      'owner-1', 'missing', 'space-1', 'reader',
    )).rejects.toBeInstanceOf(NotFoundException);

    prisma.agent.findUnique.mockResolvedValueOnce({
      id: 'agent-1', ownerId: 'owner-1', status: 'revoked', revokedAt: new Date(),
    });

    await expect(service.upsertGrantForSpace(
      'owner-1', 'agent-1', 'space-1', 'reader',
    )).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
  });

  it('rejects a paused agent when creating a new grant', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'paused', revokedAt: null,
    });
    prisma.agent.findFirst.mockResolvedValue({ id: 'agent-1', status: 'paused' });
    prisma.agentGrant.findUnique.mockResolvedValue(null);

    await expect(service.upsertGrantForSpace(
      'owner-1', 'agent-1', 'space-1', 'editor',
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
  });

  it('does not let a Space admin change another owners Agent role', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-2', status: 'active', revokedAt: null,
    });

    await expect(service.upsertGrantForSpace(
      'admin-1', 'agent-1', 'space-1', 'publisher',
    )).rejects.toThrow('You do not own this agent');
    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
  });

  it('upserts an active owned agent grant idempotently', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    prisma.agentGrant.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'grant-1' });
    prisma.agentGrant.upsert.mockResolvedValue({ id: 'grant-1' });
    prisma.agentAuditEvent.create.mockResolvedValue({});

    await service.upsertGrantForSpace(
      'owner-1', 'agent-1', 'space-1', 'reader',
    );
    await service.upsertGrantForSpace(
      'owner-1', 'agent-1', 'space-1', 'reader',
    );

    expect(prisma.agentGrant.upsert).toHaveBeenCalledTimes(2);
  });
});
