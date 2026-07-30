import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgentService } from './agent.service';

describe('AgentService grant scope validation', () => {
  const prisma = {
    agent: { findUnique: jest.fn() },
    agentCredential: { create: jest.fn() },
    agentGrant: { findUnique: jest.fn(), upsert: jest.fn() },
    agentAuditEvent: { create: jest.fn() },
  } as any;
  const service = new AgentService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('normalizes credential scopes with the same validation used by credential creation', () => {
    expect(service.normalizeCredentialScopes([
      'sources:read',
      'sources:read',
      'sources:write',
    ])).toEqual(['sources:read', 'sources:write']);
    expect(() => service.normalizeCredentialScopes([])).toThrow(BadRequestException);
    expect(() => service.normalizeCredentialScopes(['review:decide'])).toThrow(BadRequestException);
  });

  it('uses the shared scope normalizer when creating ordinary credentials', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1',
      ownerId: 'owner-1',
      status: 'active',
      revokedAt: null,
    });
    prisma.agentCredential.create.mockResolvedValue({
      id: 'credential-1',
      scopes: ['sources:read'],
    });
    prisma.agentAuditEvent.create.mockResolvedValue({});
    const normalize = jest.spyOn(service, 'normalizeCredentialScopes');

    await service.createCredential('owner-1', 'agent-1', {
      name: 'Sync',
      scopes: ['sources:read', 'sources:read'],
    });

    expect(normalize).toHaveBeenCalledWith(['sources:read', 'sources:read']);
    expect(prisma.agentCredential.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ scopes: ['sources:read'] }),
    }));
  });

  it('returns the persisted credential when its audit write fails', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1',
      ownerId: 'owner-1',
      status: 'active',
      revokedAt: null,
    });
    prisma.agentCredential.create.mockResolvedValue({
      id: 'credential-1',
      name: 'Sync',
      prefix: 'agk_prefix',
      scopes: ['sources:read'],
      expiresAt: null,
      lastUsedAt: null,
      createdAt: new Date('2030-01-01T00:00:00.000Z'),
    });
    prisma.agentAuditEvent.create.mockRejectedValue(new Error('audit unavailable'));

    await expect(service.createCredential('owner-1', 'agent-1', {
      name: 'Sync',
      scopes: ['sources:read'],
    })).resolves.toEqual(expect.objectContaining({
      id: 'credential-1',
      apiKey: expect.stringMatching(/^agk_/),
    }));
  });

  it('rejects invalid grant scopes before persisting the grant', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue(null);

    await expect(service.upsertGrantForSpace(
      'owner-1',
      'agent-1',
      'space-1',
      'editor',
      ['pages:read', 'review:decide'],
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
  });

  it('deduplicates valid grant scopes before persisting the grant', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue(null);
    prisma.agentGrant.upsert.mockResolvedValue({ id: 'grant-1' });
    prisma.agentAuditEvent.create.mockResolvedValue({});

    await service.upsertGrantForSpace(
      'owner-1',
      'agent-1',
      'space-1',
      'editor',
      ['pages:read', 'pages:read', 'pages:write'],
    );

    expect(prisma.agentGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ scopes: ['pages:read', 'pages:write'] }),
      update: { role: 'editor', scopes: ['pages:read', 'pages:write'] },
    }));
  });

  it('rejects a missing or revoked agent before persisting a new grant', async () => {
    prisma.agent.findUnique.mockResolvedValueOnce(null);

    await expect(service.upsertGrantForSpace(
      'owner-1', 'missing', 'space-1', 'viewer', ['pages:read'],
    )).rejects.toBeInstanceOf(NotFoundException);

    prisma.agent.findUnique.mockResolvedValueOnce({
      id: 'agent-1', ownerId: 'owner-1', status: 'revoked', revokedAt: new Date(),
    });

    await expect(service.upsertGrantForSpace(
      'owner-1', 'agent-1', 'space-1', 'viewer', ['pages:read'],
    )).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
  });

  it('rejects a paused agent when creating a new grant', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'paused', revokedAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue(null);

    await expect(service.upsertGrantForSpace(
      'owner-1', 'agent-1', 'space-1', 'editor', ['pages:write'],
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
  });

  it('rejects a new grant for an agent owned by another user', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-2', status: 'active', revokedAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue(null);

    await expect(service.upsertGrantForSpace(
      'owner-1', 'agent-1', 'space-1', 'viewer', ['pages:read'],
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
  });

  it('allows a space admin to update an existing grant for another users agent', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-2', status: 'paused', revokedAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue({ id: 'grant-1' });
    prisma.agentGrant.upsert.mockResolvedValue({ id: 'grant-1' });
    prisma.agentAuditEvent.create.mockResolvedValue({});

    await service.upsertGrantForSpace(
      'admin-1', 'agent-1', 'space-1', 'viewer', ['pages:read', 'graph:read'],
    );

    expect(prisma.agentGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId_spaceId: { agentId: 'agent-1', spaceId: 'space-1' } },
    }));
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
      'owner-1', 'agent-1', 'space-1', 'viewer', ['pages:read', 'graph:read'],
    );
    await service.upsertGrantForSpace(
      'owner-1', 'agent-1', 'space-1', 'viewer', ['pages:read', 'graph:read'],
    );

    expect(prisma.agentGrant.upsert).toHaveBeenCalledTimes(2);
  });
});
