import { BadRequestException } from '@nestjs/common';
import { AgentService } from './agent.service';

describe('AgentService grant scope validation', () => {
  const prisma = {
    agent: { findUnique: jest.fn() },
    agentCredential: { create: jest.fn() },
    agentGrant: { upsert: jest.fn() },
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
    await expect(service.upsertGrantForSpace(
      'agent-1',
      'space-1',
      'editor',
      ['pages:read', 'review:decide'],
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
  });

  it('deduplicates valid grant scopes before persisting the grant', async () => {
    prisma.agentGrant.upsert.mockResolvedValue({ id: 'grant-1' });
    prisma.agentAuditEvent.create.mockResolvedValue({});

    await service.upsertGrantForSpace(
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
});
