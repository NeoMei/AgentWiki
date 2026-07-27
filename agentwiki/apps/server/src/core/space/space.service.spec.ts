import { SpaceService } from './space.service';

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
