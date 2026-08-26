import { SpaceService } from './space.service';
import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { SpaceRevisionWriterService } from '../sync/space-revision-writer.service';

const revisionWriter = {
  lockSpace: jest.fn(async (tx: unknown) => tx),
} as unknown as SpaceRevisionWriterService;
const authorization = {
  assertLiveHumanSpaceAccess: jest.fn(async (_tx: unknown, principal: { userId: string }, spaceId: string) => ({
    role: 'owner', userId: principal.userId, spaceId,
  })),
} as any;
const ownerPrincipal = { userId: 'owner-1' } as any;

describe('SpaceService.findAll pagination', () => {
  const prisma = {
    space: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  } as any;
  const service = new SpaceService(prisma, revisionWriter, authorization);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
  });

  it('returns the requested page in deterministic newest-first order', async () => {
    prisma.space.findMany.mockResolvedValue([{ id: 'space-new' }]);
    prisma.space.count.mockResolvedValue(25);

    await expect(service.findAll(['space-new'], 20, 20)).resolves.toMatchObject({
      data: [{ id: 'space-new' }], total: 25, page: 2, limit: 20,
    });
    expect(prisma.space.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 20,
      take: 20,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
  });

  it('keeps cursorless skip/take callers on the production options path', async () => {
    const keys = Array.from({ length: 25 }, (_, index) => ({
      id: `space-${25 - index}`,
      createdAt: new Date(Date.UTC(2026, 7, 19, 12, 0, 0) - index * 1_000),
    }));
    prisma.space.findMany
      .mockResolvedValueOnce(keys)
      .mockResolvedValueOnce(keys.slice(20));

    await expect(service.findAll(keys.map(({ id }) => id), { skip: 20, take: 20 })).resolves.toMatchObject({
      data: keys.slice(20),
      total: 25,
      page: 2,
      limit: 20,
      hasMore: false,
      nextCursor: null,
      resetRequired: false,
    });
    expect(prisma.space.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      skip: 20,
      take: 21,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
  });

  it('returns an opaque createdAt/id keyset cursor and hasMore without using an offset', async () => {
    const keys = [
      { id: 'space-3', createdAt: new Date('2026-08-19T03:00:00.000Z') },
      { id: 'space-2', createdAt: new Date('2026-08-19T02:00:00.000Z') },
      { id: 'space-1', createdAt: new Date('2026-08-19T01:00:00.000Z') },
    ];
    prisma.space.findMany
      .mockResolvedValueOnce(keys)
      .mockResolvedValueOnce(keys);

    const result = await (service as any).findAll(['space-1', 'space-2', 'space-3'], {
      take: 2,
    });

    expect(result).toMatchObject({
      data: keys.slice(0, 2),
      total: 3,
      limit: 2,
      hasMore: true,
      resetRequired: false,
      revision: expect.any(String),
      nextCursor: expect.any(String),
    });
    expect(prisma.space.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      take: 3,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
    expect(prisma.space.findMany.mock.calls[1][0]).not.toHaveProperty('skip');
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('resets to the first page when a head insertion and tail deletion keep total unchanged', async () => {
    const originalKeys = [
      { id: 'space-5', createdAt: new Date('2026-08-19T05:00:00.000Z') },
      { id: 'space-4', createdAt: new Date('2026-08-19T04:00:00.000Z') },
      { id: 'space-3', createdAt: new Date('2026-08-19T03:00:00.000Z') },
      { id: 'space-2', createdAt: new Date('2026-08-19T02:00:00.000Z') },
      { id: 'space-1', createdAt: new Date('2026-08-19T01:00:00.000Z') },
    ];
    prisma.space.findMany
      .mockResolvedValueOnce(originalKeys)
      .mockResolvedValueOnce(originalKeys.slice(0, 3));

    const first = await (service as any).findAll(originalKeys.map(({ id }) => id), { take: 2 });

    const changedKeys = [
      { id: 'space-external', createdAt: new Date('2026-08-19T06:00:00.000Z') },
      ...originalKeys.slice(0, 4),
    ];
    prisma.space.findMany
      .mockResolvedValueOnce(changedKeys)
      .mockResolvedValueOnce(changedKeys.slice(0, 3));

    const second = await (service as any).findAll(changedKeys.map(({ id }) => id), {
      take: 2,
      cursor: first.nextCursor,
    });

    expect(second).toMatchObject({
      data: changedKeys.slice(0, 2),
      total: 5,
      hasMore: true,
      resetRequired: true,
      nextCursor: expect.any(String),
    });
    expect(prisma.space.findMany.mock.calls[3][0]).not.toHaveProperty('skip');
    expect(prisma.space.findMany.mock.calls[3][0].where).not.toHaveProperty('OR');
  });

  it('continues an unchanged collection with the cursor createdAt/id boundary', async () => {
    const keys = [
      { id: 'space-b', createdAt: new Date('2026-08-19T03:00:00.000Z') },
      { id: 'space-a', createdAt: new Date('2026-08-19T03:00:00.000Z') },
      { id: 'space-2', createdAt: new Date('2026-08-19T02:00:00.000Z') },
      { id: 'space-1', createdAt: new Date('2026-08-19T01:00:00.000Z') },
    ];
    prisma.space.findMany
      .mockResolvedValueOnce(keys)
      .mockResolvedValueOnce(keys.slice(0, 3));
    const first = await (service as any).findAll(keys.map(({ id }) => id), { take: 2 });

    prisma.space.findMany
      .mockResolvedValueOnce(keys)
      .mockResolvedValueOnce(keys.slice(2));
    const second = await (service as any).findAll(keys.map(({ id }) => id), {
      take: 2,
      cursor: first.nextCursor,
    });

    expect(second).toMatchObject({
      data: keys.slice(2),
      hasMore: false,
      resetRequired: false,
      nextCursor: null,
    });
    expect(prisma.space.findMany).toHaveBeenNthCalledWith(4, expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { createdAt: { lt: keys[1].createdAt } },
          { createdAt: keys[1].createdAt, id: { lt: keys[1].id } },
        ],
      }),
      take: 3,
    }));
  });
});

describe('SpaceService.create ownership', () => {
  const prisma = {
    space: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  } as any;
  const service = new SpaceService(prisma, revisionWriter, authorization);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.space.findUnique.mockResolvedValue(null);
  });

  it('creates the human caller as the Space owner in the same write', async () => {
    prisma.space.create.mockResolvedValue({ id: 'space-new', name: '新空间' });

    await expect(service.create({ name: '新空间' } as any, 'admin-1')).resolves.toMatchObject({
      id: 'space-new',
    });
    expect(prisma.space.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: '新空间',
        members: { create: { userId: 'admin-1', role: 'owner' } },
      }),
    }));
  });
});

describe('SpaceService.listMembers includes agents', () => {
  const prisma = {
    space: { findUnique: jest.fn().mockResolvedValue({ id: 'space-1', deletedAt: null }) },
    spaceMember: { findMany: jest.fn() },
    agentGrant: { findMany: jest.fn() },
  } as any;
  const service = new SpaceService(prisma, revisionWriter, authorization);

  beforeEach(() => jest.clearAllMocks());

  it('returns human members and agent grants, each tagged with a type', async () => {
    prisma.spaceMember.findMany.mockResolvedValue([
      { id: 'm1', role: 'owner', userId: 'u1', spaceId: 'space-1', createdAt: new Date('2026-01-01'), user: { id: 'u1', email: 'a@x.com', name: 'Alice', type: 'human' } },
    ]);
    prisma.agentGrant.findMany.mockResolvedValue([
      { id: 'g1', role: 'editor', agentId: 'ag1', spaceId: 'space-1', createdAt: new Date('2026-01-02'), agent: { id: 'ag1', name: 'MyBot', status: 'active', revokedAt: null, ownerId: 'u1' } },
    ]);
    const result: any[] = await service.listMembers('space-1', 'u1', true);
    const humans = result.filter((m) => m.type === 'human');
    const agents = result.filter((m) => m.type === 'agent');
    expect(humans).toHaveLength(1);
    expect(agents).toHaveLength(1);
    expect(agents[0].agent.name).toBe('MyBot');
    expect(agents[0].role).toBe('editor');
    expect(agents[0].canManageRole).toBe(true);
    expect(agents[0].agent).not.toHaveProperty('ownerId');
  });

  it('marks only the current Space admin own Agent grant as manageable', async () => {
    prisma.spaceMember.findMany.mockResolvedValue([]);
    prisma.agentGrant.findMany.mockResolvedValue([
      { id: 'own', role: 'editor', agentId: 'ag-own', spaceId: 'space-1', createdAt: new Date(), agent: { id: 'ag-own', name: 'Own', status: 'active', revokedAt: null, ownerId: 'u1' } },
      { id: 'other', role: 'publisher', agentId: 'ag-other', spaceId: 'space-1', createdAt: new Date(), agent: { id: 'ag-other', name: 'Other', status: 'active', revokedAt: null, ownerId: 'u2' } },
    ]);

    const result: any[] = await service.listMembers('space-1', 'u1', true);

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: 'ag-own', canManageRole: true }),
      expect.objectContaining({ agentId: 'ag-other', canManageRole: false }),
    ]));
  });

  it('reports only a live Space credential as connected without exposing credentials', async () => {
    prisma.spaceMember.findMany.mockResolvedValue([]);
    prisma.agentGrant.findMany.mockResolvedValue([
      {
        id: 'connected', role: 'editor', agentId: 'ag-connected', spaceId: 'space-1', createdAt: new Date(),
        agent: { id: 'ag-connected', name: 'Connected', status: 'active', revokedAt: null, ownerId: 'u1' },
        credentials: [{ id: 'credential-live' }],
      },
      {
        id: 'pending', role: 'publisher', agentId: 'ag-pending', spaceId: 'space-1', createdAt: new Date(),
        agent: { id: 'ag-pending', name: 'Pending', status: 'active', revokedAt: null, ownerId: 'u1' },
        credentials: [],
      },
    ]);

    const result: any[] = await service.listMembers('space-1', 'u1', true);

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentId: 'ag-connected', agent: expect.objectContaining({ connected: true }) }),
      expect.objectContaining({ agentId: 'ag-pending', agent: expect.objectContaining({ connected: false }) }),
    ]));
    expect(result).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ credentials: expect.anything() }),
    ]));
    expect(prisma.agentGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        credentials: expect.objectContaining({
          where: {
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
          },
          select: { id: true },
          take: 1,
        }),
      }),
    }));
  });

  it('does not mark an owned Agent manageable for a non-admin Space member', async () => {
    prisma.spaceMember.findMany.mockResolvedValue([]);
    prisma.agentGrant.findMany.mockResolvedValue([
      { id: 'own', role: 'editor', agentId: 'ag-own', spaceId: 'space-1', createdAt: new Date(), agent: { id: 'ag-own', name: 'Own', status: 'active', revokedAt: null, ownerId: 'u1' } },
    ]);

    await expect(service.listMembers('space-1', 'u1', false)).resolves.toEqual([
      expect.objectContaining({ agentId: 'ag-own', canManageRole: false }),
    ]);
  });

  it('excludes revoked agents from the member list', async () => {
    prisma.spaceMember.findMany.mockResolvedValue([]);
    prisma.agentGrant.findMany.mockResolvedValue([]);
    await service.listMembers('space-1', 'u1', true);
    expect(prisma.agentGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ agent: { revokedAt: null } }),
    }));
  });
});

describe('admin role and member management', () => {
  const prisma = {
    space: { findUnique: jest.fn().mockResolvedValue({ id: 'space-1', deletedAt: null }) },
    spaceMember: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
    user: { findFirst: jest.fn() },
    agentGrant: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  } as any;
  const service = new SpaceService(prisma, revisionWriter, authorization);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
  });

  it('allows adding a member with the admin role', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u2', email: 'b@x.com', type: 'human' });
    prisma.spaceMember.findUnique.mockResolvedValue(null);
    prisma.spaceMember.create.mockResolvedValue({ id: 'm2', role: 'admin' });
    const result = await (service.addMember as any)('space-1', 'b@x.com', 'admin', ownerPrincipal);
    expect(prisma.spaceMember.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'admin' }),
    }));
    expect(result.role).toBe('admin');
  });

  it('requires ownership to be transferred to an existing member instead of inviting a second owner', async () => {
    await expect((service.addMember as any)('space-1', 'b@x.com', 'owner', ownerPrincipal))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('locks and live-reauthorizes the caller before adding a member', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u2', email: 'b@x.com', type: 'human' });
    prisma.spaceMember.findUnique.mockResolvedValue(null);
    prisma.spaceMember.create.mockResolvedValue({ id: 'm2', role: 'viewer' });

    await (service.addMember as any)('space-1', 'b@x.com', 'viewer', ownerPrincipal);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    expect(revisionWriter.lockSpace).toHaveBeenCalledWith(prisma, 'space-1');
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledWith(
      prisma, ownerPrincipal, 'space-1', ['owner', 'admin'],
    );
    expect((revisionWriter.lockSpace as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      authorization.assertLiveHumanSpaceAccess.mock.invocationCallOrder[0],
    );
    expect(authorization.assertLiveHumanSpaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.user.findFirst.mock.invocationCallOrder[0],
    );
  });

  it('rejects an admin changing another owner or granting owner', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue({ id: 'm1', role: 'owner' });
    authorization.assertLiveHumanSpaceAccess.mockResolvedValueOnce({
      role: 'admin', userId: 'admin-1', spaceId: 'space-1',
    });
    await expect(
      service.updateMemberRoleAs('space-1', 'u1', 'editor', { userId: 'admin-1' }),
    ).rejects.toThrow();
  });

  it('uses ReadCommitted after the Space lock so owner updates see post-wait state', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue({ id: 'm1', role: 'owner' });
    prisma.spaceMember.count.mockResolvedValue(2);
    prisma.spaceMember.update.mockResolvedValue({ id: 'm1', role: 'editor' });

    await service.updateMemberRoleAs('space-1', 'u1', 'editor', { userId: 'u1' });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    expect(prisma.spaceMember.count).toHaveBeenCalledWith({ where: { spaceId: 'space-1', role: 'owner' } });
    expect(prisma.spaceMember.update).toHaveBeenCalled();
  });

  it('transfers ownership atomically and demotes the acting owner to admin', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue({ id: 'm2', userId: 'u2', role: 'admin' });
    prisma.spaceMember.update
      .mockResolvedValueOnce({ id: 'm2', userId: 'u2', role: 'owner' });
    prisma.spaceMember.updateMany.mockResolvedValue({ count: 1 });

    await service.updateMemberRoleAs('space-1', 'u2', 'owner', { userId: 'u1' });

    expect(prisma.spaceMember.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { userId_spaceId: { userId: 'u2', spaceId: 'space-1' } },
      data: { role: 'owner' },
    }));
    expect(prisma.spaceMember.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', spaceId: 'space-1', role: 'owner' },
      data: { role: 'admin' },
    }));
  });

  it('uses ReadCommitted after the Space lock so owner removal sees post-wait state', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue({ id: 'm1', role: 'owner' });
    prisma.spaceMember.count.mockResolvedValue(2);
    prisma.spaceMember.delete.mockResolvedValue({ id: 'm1', role: 'owner' });

    await service.removeMemberAs('space-1', 'u1', { userId: 'u1' });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    expect(prisma.spaceMember.count).toHaveBeenCalledWith({ where: { spaceId: 'space-1', role: 'owner' } });
    expect(prisma.spaceMember.delete).toHaveBeenCalled();
  });

  it('locks and live-reauthorizes the caller before removing an owner', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue({ id: 'm2', userId: 'u2', role: 'owner' });
    prisma.spaceMember.count.mockResolvedValue(2);
    prisma.spaceMember.delete.mockResolvedValue({ id: 'm2', userId: 'u2', role: 'owner' });

    await (service.removeMemberAs as any)('space-1', 'u2', ownerPrincipal);

    expect(revisionWriter.lockSpace).toHaveBeenCalledWith(prisma, 'space-1');
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledWith(
      prisma, ownerPrincipal, 'space-1', ['owner', 'admin'],
    );
    expect((revisionWriter.lockSpace as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      authorization.assertLiveHumanSpaceAccess.mock.invocationCallOrder[0],
    );
    expect(authorization.assertLiveHumanSpaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.spaceMember.findUnique.mock.invocationCallOrder[0],
    );
  });
});

describe('SpaceService.remove', () => {
  const tx = {
    assistTask: { updateMany: jest.fn() },
    pageSearchDocument: { deleteMany: jest.fn() },
    page: { updateMany: jest.fn() },
    space: {
      findUnique: jest.fn().mockResolvedValue({ id: 'space-1' }),
      update: jest.fn().mockResolvedValue({ id: 'space-1' }),
    },
  };
  const prisma = {
    space: { findUnique: jest.fn().mockResolvedValue({ id: 'space-1', deletedAt: null }) },
    $transaction: jest.fn(async (callback: any) => callback(tx)),
  } as any;
  const service = new SpaceService(prisma, revisionWriter, authorization);

  beforeEach(() => {
    jest.clearAllMocks();
    (revisionWriter.lockSpace as jest.Mock).mockImplementation(async (transaction: unknown) => transaction);
    tx.space.findUnique.mockResolvedValue({ id: 'space-1' });
    tx.space.update.mockResolvedValue({ id: 'space-1' });
  });

  it('fails queued and running assistant tasks before soft-deleting the space', async () => {
    await service.remove('space-1', ownerPrincipal);

    expect(tx.assistTask.updateMany).toHaveBeenCalledWith({
      where: { spaceId: 'space-1', status: { in: ['queued', 'running'] } },
      data: expect.objectContaining({
        status: 'failed',
        error: 'space deleted',
        lockedAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      }),
    });
  });

  it('takes the shared Space lock before soft-deleting live pages and the Space', async () => {
    tx.space.update.mockResolvedValue({ id: 'space-1', deletedAt: new Date() });

    await service.remove('space-1', ownerPrincipal);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    expect(revisionWriter.lockSpace).toHaveBeenCalledWith(tx, 'space-1');
    expect((revisionWriter.lockSpace as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      tx.page.updateMany.mock.invocationCallOrder[0],
    );
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { spaceId: 'space-1', deletedAt: null },
    }));
    expect(tx.space.update).toHaveBeenCalledWith({
      where: { id: 'space-1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
