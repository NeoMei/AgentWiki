import { AuthorizationService } from './authorization.service';
import { PrismaService } from '../../database/prisma.service';

describe('AuthorizationService', () => {
  const prisma = {
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

  it('requires both an Agent grant and the requested scope', async () => {
    prisma.agentGrant.findUnique.mockResolvedValue({
      role: 'editor',
      agent: { status: 'active', revokedAt: null },
      space: { deletedAt: null },
    });
    await expect(
      service.assertSpaceAccess(
        { userId: 'owner-1', agentId: 'agent-1', scopes: ['pages:read'] },
        'space-1',
        ['owner', 'editor'],
        'pages:write',
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      service.assertSpaceAccess(
        { userId: 'owner-1', agentId: 'agent-1', scopes: ['pages:write'] },
        'space-1',
        ['owner', 'editor'],
        'pages:write',
      ),
    ).resolves.toMatchObject({ role: 'editor' });
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
      service.assertSpaceAccess({ userId: 'user-1', agentId: 'agent-1', scopes: ['pages:write'] }, 'MySpace', ['owner', 'editor'], 'pages:write'),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringContaining('MySpace'),
    });
    await expect(
      service.assertSpaceAccess({ userId: 'user-1', agentId: 'agent-1', scopes: ['pages:write'] }, 'MySpace', ['owner', 'editor'], 'pages:write'),
    ).rejects.toMatchObject({ message: expect.stringContaining('internal id') });
  });

  it('still returns 403 when the space exists but the agent lacks a grant', async () => {
    prisma.space.findUnique.mockResolvedValue({ id: 'space-1', deletedAt: null });
    prisma.agentGrant.findUnique.mockResolvedValue(null);
    await expect(
      service.assertSpaceAccess({ userId: 'user-1', agentId: 'agent-1', scopes: ['pages:write'] }, 'space-1', ['owner', 'editor'], 'pages:write'),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('lists accessible spaces with id, name and role for an agent', async () => {
    prisma.agentGrant.findMany.mockResolvedValue([
      { role: 'editor', space: { id: 'space-1', name: 'MySpace', deletedAt: null } },
    ]);
    const result = await service.listAccessibleSpaces({ userId: 'user-1', agentId: 'agent-1', scopes: ['spaces:read'] });
    expect(result).toEqual([{ id: 'space-1', name: 'MySpace', role: 'editor' }]);
  });

  it('lists accessible spaces for a human member', async () => {
    prisma.spaceMember.findMany.mockResolvedValue([
      { role: 'owner', space: { id: 'space-2', name: 'Team', deletedAt: null } },
    ]);
    const result = await service.listAccessibleSpaces('user-1');
    expect(result).toEqual([{ id: 'space-2', name: 'Team', role: 'owner' }]);
  });
});
