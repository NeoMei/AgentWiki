import { SpaceService } from './space.service';
import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

describe('SpaceService.findAll pagination', () => {
  const prisma = {
    space: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  } as any;
  const service = new SpaceService(prisma);

  beforeEach(() => jest.clearAllMocks());

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
});

describe('SpaceService.create ownership', () => {
  const prisma = {
    space: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  } as any;
  const service = new SpaceService(prisma);

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
  const service = new SpaceService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('returns human members and agent grants, each tagged with a type', async () => {
    prisma.spaceMember.findMany.mockResolvedValue([
      { id: 'm1', role: 'owner', userId: 'u1', spaceId: 'space-1', createdAt: new Date('2026-01-01'), user: { id: 'u1', email: 'a@x.com', name: 'Alice', type: 'human' } },
    ]);
    prisma.agentGrant.findMany.mockResolvedValue([
      { id: 'g1', role: 'editor', agentId: 'ag1', spaceId: 'space-1', createdAt: new Date('2026-01-02'), agent: { id: 'ag1', name: 'MyBot', status: 'active', revokedAt: null } },
    ]);
    const result: any[] = await service.listMembers('space-1');
    const humans = result.filter((m) => m.type === 'human');
    const agents = result.filter((m) => m.type === 'agent');
    expect(humans).toHaveLength(1);
    expect(agents).toHaveLength(1);
    expect(agents[0].agent.name).toBe('MyBot');
    expect(agents[0].role).toBe('editor');
  });

  it('excludes revoked agents from the member list', async () => {
    prisma.spaceMember.findMany.mockResolvedValue([]);
    prisma.agentGrant.findMany.mockResolvedValue([]);
    await service.listMembers('space-1');
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
  const service = new SpaceService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: any) => callback(prisma));
  });

  it('allows adding a member with the admin role', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u2', email: 'b@x.com', type: 'human' });
    prisma.spaceMember.findUnique.mockResolvedValue(null);
    prisma.spaceMember.create.mockResolvedValue({ id: 'm2', role: 'admin' });
    const result = await service.addMember('space-1', 'b@x.com', 'admin' as any);
    expect(prisma.spaceMember.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'admin' }),
    }));
    expect(result.role).toBe('admin');
  });

  it('requires ownership to be transferred to an existing member instead of inviting a second owner', async () => {
    await expect(service.addMember('space-1', 'b@x.com', 'owner' as any))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an admin changing another owner or granting owner', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue({ id: 'm1', role: 'owner' });
    await expect(
      service.updateMemberRoleAs('space-1', 'u1', 'editor', 'admin'),
    ).rejects.toThrow();
  });

  it('checks and updates the last owner in one serializable transaction', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue({ id: 'm1', role: 'owner' });
    prisma.spaceMember.count.mockResolvedValue(2);
    prisma.spaceMember.update.mockResolvedValue({ id: 'm1', role: 'editor' });

    await service.updateMemberRoleAs('space-1', 'u1', 'editor', 'owner');

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(prisma.spaceMember.count).toHaveBeenCalledWith({ where: { spaceId: 'space-1', role: 'owner' } });
    expect(prisma.spaceMember.update).toHaveBeenCalled();
  });

  it('transfers ownership atomically and demotes the acting owner to admin', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue({ id: 'm2', userId: 'u2', role: 'admin' });
    prisma.spaceMember.update
      .mockResolvedValueOnce({ id: 'm2', userId: 'u2', role: 'owner' });
    prisma.spaceMember.updateMany.mockResolvedValue({ count: 1 });

    await service.updateMemberRoleAs('space-1', 'u2', 'owner', 'owner', 'u1');

    expect(prisma.spaceMember.update).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { userId_spaceId: { userId: 'u2', spaceId: 'space-1' } },
      data: { role: 'owner' },
    }));
    expect(prisma.spaceMember.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', spaceId: 'space-1', role: 'owner' },
      data: { role: 'admin' },
    }));
  });

  it('checks and removes an owner in one serializable transaction', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue({ id: 'm1', role: 'owner' });
    prisma.spaceMember.count.mockResolvedValue(2);
    prisma.spaceMember.delete.mockResolvedValue({ id: 'm1', role: 'owner' });

    await service.removeMemberAs('space-1', 'u1', 'owner');

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(prisma.spaceMember.count).toHaveBeenCalledWith({ where: { spaceId: 'space-1', role: 'owner' } });
    expect(prisma.spaceMember.delete).toHaveBeenCalled();
  });
});

describe('SpaceService.remove', () => {
  const tx = {
    assistTask: { updateMany: jest.fn() },
    pageSearchDocument: { deleteMany: jest.fn() },
    page: { updateMany: jest.fn() },
    space: { update: jest.fn().mockResolvedValue({ id: 'space-1' }) },
  };
  const prisma = {
    space: { findUnique: jest.fn().mockResolvedValue({ id: 'space-1', deletedAt: null }) },
    $transaction: jest.fn(async (callback: any) => callback(tx)),
  } as any;
  const service = new SpaceService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('fails queued and running assistant tasks before soft-deleting the space', async () => {
    await service.remove('space-1');

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
});
