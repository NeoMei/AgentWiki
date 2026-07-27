import { AuthorizationService } from './authorization.service';
import { PrismaService } from '../../database/prisma.service';

describe('AuthorizationService', () => {
  const prisma = {
    spaceMember: { findUnique: jest.fn(), findMany: jest.fn() },
    page: { findUnique: jest.fn() },
    knowledgeRelation: { findUnique: jest.fn() },
    agentGrant: { findUnique: jest.fn(), findMany: jest.fn() },
  };
  const service = new AuthorizationService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

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
