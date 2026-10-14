import { AuthorizationService } from './authorization.service';
import { AuthService } from '../auth/auth.service';

describe('one Agent identity across live Space grants', () => {
  const principal = { userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1' };
  const grants = new Map<string, any>();
  const prisma: any = {
    space: { findUnique: jest.fn(async ({ where }) => ({ id: where.id, deletedAt: null })) },
    agentGrant: {
      findUnique: jest.fn(async ({ where }) => grants.get(where.agentId_spaceId.spaceId) ?? null),
      findMany: jest.fn(async ({ where }) => [...grants.values()].filter(g => !where.id || g.id === where.id)),
    },
  };
  const authorization = new AuthorizationService(prisma);
  beforeEach(() => {
    grants.clear();
    for (const [spaceId, role] of [['space-a', 'reader'], ['space-b', 'publisher']]) grants.set(spaceId, {
      id: `grant-${spaceId}`, spaceId, role, folderScopes: [],
      agent: { status: 'active', revokedAt: null }, space: { id: spaceId, name: spaceId, deletedAt: null },
    });
  });
  it('discovers all current grants using the same identity credential', async () => {
    await expect(authorization.listAccessibleSpaces(principal)).resolves.toEqual([
      { id: 'space-a', name: 'space-a', role: 'reader' },
      { id: 'space-b', name: 'space-b', role: 'publisher' },
    ]);
    await expect(authorization.getAccessibleSpaceIds(principal)).resolves.toEqual(['space-a', 'space-b']);
  });
  it('uses the destination role, observes addition/removal immediately, and does not reuse a role from another Space', async () => {
    await expect(authorization.assertSpaceAccess(principal, 'space-b', ['editor'], 'pages:write')).resolves.toMatchObject({ role: 'publisher' });
    await expect(authorization.assertSpaceAccess(principal, 'space-a', ['editor'], 'pages:write')).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    grants.delete('space-a');
    await expect(authorization.assertSpaceAccess(principal, 'space-a')).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    await expect(authorization.assertSpaceAccess(principal, 'space-b', ['editor'], 'pages:write')).resolves.toMatchObject({ role: 'publisher' });
    grants.set('space-c', { ...grants.get('space-b'), id: 'grant-c', spaceId: 'space-c' });
    await expect(authorization.assertSpaceAccess(principal, 'space-c')).resolves.toMatchObject({ id: 'grant-c' });
  });
  it('authenticates an identity without depending on any Space grant', async () => {
    const db: any = {
      apiKeyCredential: { findUnique: jest.fn(async () => null) },
      agentCredential: {
        findUnique: jest.fn(async () => ({ id: 'credential-1', agentId: 'agent-1', expiresAt: null, revokedAt: null,
          agent: { ownerId: 'owner-1', status: 'active', revokedAt: null, owner: { email: 'owner@example.test', deletedAt: null, lockedAt: null } } })),
        update: jest.fn(async () => ({})),
      },
    };
    const result = await new AuthService({} as any, db).validateApiKey('agk_identity');
    expect(result).toMatchObject(principal);
    expect(result).not.toHaveProperty('authorizationId');
    expect(result).not.toHaveProperty('agentRole');
    expect(result?.scopes).toEqual([]);
  });
});
