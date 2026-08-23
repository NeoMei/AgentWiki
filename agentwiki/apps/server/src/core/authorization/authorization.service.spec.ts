import { AuthorizationService } from './authorization.service';
import { PrismaService } from '../../database/prisma.service';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';

describe('AuthorizationService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    spaceMember: { findUnique: jest.fn(), findMany: jest.fn() },
    page: { findUnique: jest.fn() },
    knowledgeRelation: { findUnique: jest.fn() },
    agentGrant: { findUnique: jest.fn(), findMany: jest.fn() },
    space: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const service = new AuthorizationService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.space.findUnique.mockResolvedValue({ id: 'space-1', deletedAt: null });
  });

  it('denies users who are not members of a space', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue(null);
    await expect(service.assertSpaceAccess('user-1', 'space-1')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('denies viewers when an editor role is required', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue({
      role: 'viewer',
      space: { deletedAt: null },
    });
    await expect(
      service.assertSpaceAccess('user-1', 'space-1', ['owner', 'editor']),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows a member with an accepted role', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue({
      role: 'editor',
      space: { deletedAt: null },
    });
    await expect(
      service.assertSpaceAccess('user-1', 'space-1', ['owner', 'editor']),
    ).resolves.toMatchObject({ role: 'editor' });
  });

  it('lets a human admin satisfy an editor content gate', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue({ role: 'admin', space: { deletedAt: null } });
    await expect(service.assertSpaceAccess(
      { userId: 'admin-1' }, 'space-1', ['owner', 'editor'], 'pages:write',
    )).resolves.toMatchObject({ role: 'admin' });
  });

  it('does not let an Agent admin-shaped grant bypass an editor gate', async () => {
    prisma.agentGrant.findUnique.mockResolvedValue({
      id: 'grant-1', role: 'admin',
      agent: { status: 'active', revokedAt: null }, space: { deletedAt: null },
    });
    await expect(service.assertSpaceAccess(
      { userId: 'owner-1', agentId: 'agent-1', authorizationId: 'grant-1' },
      'space-1', ['owner', 'editor'], 'pages:write',
    )).rejects.toMatchObject({ statusCode: 403 });
  });

  it('keeps owner-only review gates owner-only for human admins', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue({ role: 'admin', space: { deletedAt: null } });
    await expect(service.assertSpaceAccess(
      { userId: 'admin-1' }, 'space-1', ['owner'], 'review:decide',
    )).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows a super admin to access any existing space as an owner without membership', async () => {
    prisma.spaceMember.findUnique.mockResolvedValue(null);

    await expect(
      service.assertSpaceAccess(
        { userId: 'super-admin', platformRole: 'super_admin' } as any,
        'space-1',
        ['owner'],
      ),
    ).resolves.toMatchObject({ role: 'owner', isSuperAdmin: true });
    expect(prisma.spaceMember.findUnique).not.toHaveBeenCalled();
  });

  it('reloads the live human, platform role, Space, and membership from the provided transaction', async () => {
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', type: 'human', platformRole: 'user', deletedAt: null, lockedAt: null }) },
      space: { findUnique: jest.fn().mockResolvedValue({ id: 'space-1', deletedAt: null }) },
      spaceMember: { findUnique: jest.fn().mockResolvedValue({ role: 'editor' }) },
    } as any;

    await expect(service.assertLiveHumanSpaceAccess(
      tx,
      { userId: 'user-1', platformRole: 'super_admin' },
      'space-1',
      ['owner', 'admin', 'editor'],
    )).resolves.toMatchObject({ role: 'editor', userId: 'user-1', spaceId: 'space-1' });
    expect(tx.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }));
    expect(tx.space.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'space-1' } }));
    expect(tx.spaceMember.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_spaceId: { userId: 'user-1', spaceId: 'space-1' } },
    }));
  });

  it('uses only the live platform role and fails closed for a revoked or downgraded human', async () => {
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', type: 'human', platformRole: 'user', deletedAt: null, lockedAt: null }) },
      space: { findUnique: jest.fn().mockResolvedValue({ id: 'space-1', deletedAt: null }) },
      spaceMember: { findUnique: jest.fn().mockResolvedValue({ role: 'viewer' }) },
    } as any;

    await expect(service.assertLiveHumanSpaceAccess(
      tx,
      { userId: 'user-1', platformRole: 'super_admin' },
      'space-1',
      ['owner', 'admin', 'editor'],
    )).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });

    tx.user.findUnique.mockResolvedValue({ id: 'user-1', type: 'human', platformRole: 'super_admin', deletedAt: new Date(), lockedAt: null });
    await expect(service.assertLiveHumanSpaceAccess(
      tx,
      { userId: 'user-1' },
      'space-1',
      ['owner'],
    )).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
  });

  it('uses the bound Grant role as the only Agent permission source', async () => {
    prisma.agentGrant.findUnique.mockResolvedValue({
      id: 'grant-1', role: 'editor',
      agent: { status: 'active', revokedAt: null },
      space: { deletedAt: null },
    });
    await expect(
      service.assertSpaceAccess(
        {
          userId: 'owner-1', agentId: 'agent-1', authorizationId: 'grant-1',
          agentRole: 'reader', scopes: ['pages:read'],
        },
        'space-1',
        ['owner', 'editor'],
        'pages:write',
      ),
    ).resolves.toMatchObject({ role: 'editor' });
  });

  it('denies a Credential in a different Space even when the Agent has another Grant', async () => {
    prisma.agentGrant.findUnique.mockResolvedValue({
      id: 'grant-space-b', role: 'publisher',
      agent: { status: 'active', revokedAt: null },
      space: { deletedAt: null },
    });
    await expect(service.assertSpaceAccess(
      { userId: 'owner-1', agentId: 'agent-1', authorizationId: 'grant-space-a' },
      'space-b', ['owner', 'editor'], 'pages:write',
    )).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
  });

  it.each([
    ['reader', ['owner', 'editor'], false],
    ['editor', ['owner', 'editor'], true],
    ['publisher', ['owner', 'editor'], true],
  ] as const)('maps %s to the expected write capability', async (role, allowedRoles, allowed) => {
    prisma.agentGrant.findUnique.mockResolvedValue({
      id: 'grant-1', role,
      agent: { status: 'active', revokedAt: null },
      space: { deletedAt: null },
    });
    const call = service.assertSpaceAccess({
      userId: 'owner-1',
      agentId: 'agent-1',
      authorizationId: 'grant-1',
    }, 'space-1', [...allowedRoles], 'pages:write');
    if (allowed) await expect(call).resolves.toBeDefined();
    else await expect(call).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
  });

  it('denies pages:write when the bound Grant is Reader', async () => {
    prisma.agentGrant.findUnique.mockResolvedValue({
      id: 'grant-1', role: 'reader',
      agent: { status: 'active', revokedAt: null },
      space: { deletedAt: null },
    });
    await expect(service.assertSpaceAccess({
      userId: 'owner-1',
      agentId: 'agent-1',
      authorizationId: 'grant-1',
      agentRole: 'publisher',
      scopes: scopesForAgentAccessRole('publisher'),
    }, 'space-1', ['owner', 'editor'], 'pages:write'))
      .rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
  });
});

describe('space discovery and self-describing errors', () => {
  const prisma = {
    spaceMember: { findUnique: jest.fn(), findMany: jest.fn() },
    page: { findUnique: jest.fn() },
    knowledgeRelation: { findUnique: jest.fn() },
    agentGrant: { findUnique: jest.fn(), findMany: jest.fn() },
    space: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const service = new AuthorizationService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('returns 404 semantics with a self-describing message when the space id does not exist', async () => {
    prisma.space.findUnique.mockResolvedValue(null);
    await expect(
      service.assertSpaceAccess({ userId: 'user-1', agentId: 'agent-1', agentRole: 'editor', scopes: ['pages:write'] }, 'MySpace', ['owner', 'editor'], 'pages:write'),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining('MySpace'),
    });
    await expect(
      service.assertSpaceAccess({ userId: 'user-1', agentId: 'agent-1', agentRole: 'editor', scopes: ['pages:write'] }, 'MySpace', ['owner', 'editor'], 'pages:write'),
    ).rejects.toMatchObject({ message: expect.stringContaining('internal id') });
  });

  it('still returns 403 when the space exists but the agent lacks a grant', async () => {
    prisma.space.findUnique.mockResolvedValue({ id: 'space-1', deletedAt: null });
    prisma.agentGrant.findUnique.mockResolvedValue(null);
    await expect(
      service.assertSpaceAccess({ userId: 'user-1', agentId: 'agent-1', agentRole: 'editor', scopes: ['pages:write'] }, 'space-1', ['owner', 'editor'], 'pages:write'),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('lists accessible spaces with id, name and role for an agent', async () => {
    prisma.agentGrant.findMany.mockResolvedValue([
      { role: 'editor', space: { id: 'space-1', name: 'MySpace', deletedAt: null } },
    ]);
    const result = await service.listAccessibleSpaces({
      userId: 'user-1', agentId: 'agent-1', authorizationId: 'grant-1',
    });
    expect(result).toEqual([{ id: 'space-1', name: 'MySpace', role: 'editor' }]);
    expect(prisma.agentGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'grant-1',
        agentId: 'agent-1',
      }),
    }));
  });

  it('returns only the Credential-bound accessible Space id', async () => {
    prisma.agentGrant.findMany.mockResolvedValue([{ spaceId: 'space-1', role: 'editor' }]);

    await expect(service.getAccessibleSpaceIds(
      { userId: 'user-1', agentId: 'agent-1', authorizationId: 'grant-1' },
      'pages:read',
    )).resolves.toEqual(['space-1']);
    expect(prisma.agentGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'grant-1',
        agentId: 'agent-1',
      }),
    }));
  });

  it('lists accessible spaces for a human member', async () => {
    prisma.spaceMember.findMany.mockResolvedValue([
      { role: 'owner', space: { id: 'space-2', name: 'Team', deletedAt: null } },
    ]);
    const result = await service.listAccessibleSpaces('user-1');
    expect(result).toEqual([{ id: 'space-2', name: 'Team', role: 'owner' }]);
  });

  it('lists every active space for a super admin', async () => {
    prisma.space.findMany.mockResolvedValue([
      { id: 'space-1', name: 'One', deletedAt: null },
      { id: 'space-2', name: 'Two', deletedAt: null },
    ]);

    await expect(service.getAccessibleSpaceIds(
      { userId: 'super-admin', platformRole: 'super_admin' } as any,
    )).resolves.toEqual(['space-1', 'space-2']);
    await expect(service.listAccessibleSpaces(
      { userId: 'super-admin', platformRole: 'super_admin' } as any,
    )).resolves.toEqual([
      { id: 'space-1', name: 'One', role: 'owner' },
      { id: 'space-2', name: 'Two', role: 'owner' },
    ]);
    expect(prisma.spaceMember.findMany).not.toHaveBeenCalled();
  });
});
