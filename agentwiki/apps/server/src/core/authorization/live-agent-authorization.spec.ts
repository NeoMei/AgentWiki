import {
  lockLiveAgentAuthorization,
  lockLiveAgentAuthorizationAcrossSpaceBoundary,
} from './live-agent-authorization';

describe('lockLiveAgentAuthorization', () => {
  const validState = {
    agentCredential: {
      findFirst: jest.fn().mockResolvedValue({
        authorizationId: 'grant-1', revokedAt: null, expiresAt: null,
      }),
    },
    agent: {
      findUnique: jest.fn().mockResolvedValue({
        status: 'active', revokedAt: null, approvalMode: 'manual', memoryEnabled: false,
        owner: { deletedAt: null, lockedAt: null },
      }),
    },
    agentGrant: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'grant-1', role: 'editor', folderScopes: ['folders:read', 'folders:write'],
      }),
    },
    space: {
      findUnique: jest.fn().mockResolvedValue({ deletedAt: null, approvalPolicy: 'review' }),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the global non-Space-before-Space row-lock order before re-reading authorization state', async () => {
    const queries: string[] = [];
    const db = {
      ...validState,
      $queryRaw: jest.fn(async (query: any) => {
        queries.push(query.strings.join(' '));
        return [{ id: 'locked' }];
      }),
    } as any;

    const result = await lockLiveAgentAuthorization(db, {
      ownerId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1',
    }, 'space-1');

    expect(queries).toHaveLength(5);
    expect(queries[0]).toContain('FROM "User"');
    expect(queries[1]).toContain('FROM "Agent"');
    expect(queries[2]).toContain('FROM "AgentGrant"');
    expect(queries[3]).toContain('FROM "AgentCredential"');
    expect(queries[4]).toContain('FROM "Space"');
    expect(queries.every((query) => query.includes('FOR NO KEY UPDATE'))).toBe(true);
    expect(result).toMatchObject({
      grant: { id: 'grant-1', role: 'editor', folderScopes: ['folders:read', 'folders:write'] },
    });
    expect(db.agentGrant.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ folderScopes: true }),
    }));
  });

  it('places the Space advisory boundary before the authoritative Space row lock and revalidates policy', async () => {
    const events: string[] = [];
    const db = {
      ...validState,
      space: {
        findUnique: jest.fn()
          .mockImplementationOnce(async () => {
            events.push('space-preflight');
            return { deletedAt: null, approvalPolicy: 'scoped-auto-publish' };
          })
          .mockImplementationOnce(async () => {
            events.push('space-final');
            return { deletedAt: null, approvalPolicy: 'always-review' };
          }),
      },
      $queryRaw: jest.fn(async (query: any) => {
        const table = /FROM\s+"([^"]+)"/u.exec(query.strings.join(' '))?.[1];
        events.push(`lock:${table}`);
        return [{ id: 'locked' }];
      }),
    } as any;
    const acquireSpaceAdvisory = jest.fn(async () => {
      events.push('space-advisory');
      return 'space-lock';
    });

    const result = await lockLiveAgentAuthorizationAcrossSpaceBoundary(
      db,
      { ownerId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1' },
      'space-1',
      (state) => state.space.approvalPolicy === 'scoped-auto-publish',
      acquireSpaceAdvisory,
    );

    expect(result).toBeNull();
    expect(events.filter((event) => event.startsWith('lock:'))).toEqual([
      'lock:User', 'lock:Agent', 'lock:AgentGrant', 'lock:AgentCredential', 'lock:Space',
    ]);
    expect(events.indexOf('lock:AgentCredential')).toBeLessThan(events.indexOf('space-advisory'));
    expect(events.indexOf('space-advisory')).toBeLessThan(events.indexOf('lock:Space'));
    expect(events.indexOf('lock:Space')).toBeLessThan(events.indexOf('space-final'));
    expect(acquireSpaceAdvisory).toHaveBeenCalledTimes(1);
  });

  it('does not acquire the Space advisory lock for a preliminarily unauthorized caller', async () => {
    const db = {
      ...validState,
      agent: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'paused', revokedAt: null, approvalMode: 'manual', memoryEnabled: false,
          owner: { deletedAt: null, lockedAt: null },
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked' }]),
    } as any;
    const acquireSpaceAdvisory = jest.fn();

    const result = await lockLiveAgentAuthorizationAcrossSpaceBoundary(
      db,
      { ownerId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1' },
      'space-1',
      (state) => state.agent.status === 'active',
      acquireSpaceAdvisory,
    );

    expect(result).toBeNull();
    expect(acquireSpaceAdvisory).not.toHaveBeenCalled();
    expect(db.$queryRaw).toHaveBeenCalledTimes(4);
    expect(db.$queryRaw.mock.calls.every(([query]: any[]) => (
      !query.strings.join(' ').includes('FROM "Space"')
    ))).toBe(true);
  });

  it('stops before state reads when a required lock row no longer exists', async () => {
    const db = {
      ...validState,
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: 'owner-1' }])
        .mockResolvedValueOnce([]),
    } as any;

    await expect(lockLiveAgentAuthorization(db, {
      ownerId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1',
    }, 'space-1')).resolves.toBeNull();

    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(db.agentCredential.findFirst).not.toHaveBeenCalled();
  });
});
