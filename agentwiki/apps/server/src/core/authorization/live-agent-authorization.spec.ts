import { lockLiveAgentAuthorization } from './live-agent-authorization';

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
      findUnique: jest.fn().mockResolvedValue({ id: 'grant-1', role: 'editor' }),
    },
    space: {
      findUnique: jest.fn().mockResolvedValue({ deletedAt: null, approvalPolicy: 'review' }),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses one deterministic row-lock order before re-reading authorization state', async () => {
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
    expect(queries[2]).toContain('FROM "Space"');
    expect(queries[3]).toContain('FROM "AgentGrant"');
    expect(queries[4]).toContain('FROM "AgentCredential"');
    expect(result).toMatchObject({ grant: { id: 'grant-1', role: 'editor' } });
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
