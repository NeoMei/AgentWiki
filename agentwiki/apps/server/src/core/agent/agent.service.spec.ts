import { BadRequestException, NotFoundException } from '@nestjs/common';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { AgentService } from './agent.service';

describe('AgentService grant scope validation', () => {
  const prisma = {
    agent: { findUnique: jest.fn(), update: jest.fn() },
    agentCredential: { create: jest.fn(), findUnique: jest.fn() },
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
  it('expands a wildcard credential scope to all valid scopes', () => {
    const full = service.normalizeCredentialScopes(['*']);
    expect(full).toContain('pages:read');
    expect(full).toContain('pages:write');
    expect(full).toContain('spaces:read');
    expect(full).toContain('review:auto-publish');
    expect(full.length).toBeGreaterThan(5);
  });


  it('derives ordinary credential scopes from its role', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1',
      ownerId: 'owner-1',
      status: 'active',
      revokedAt: null,
    });
    prisma.agentCredential.create.mockResolvedValue({
      id: 'credential-1',
      role: 'editor',
    });
    prisma.agentAuditEvent.create.mockResolvedValue({});

    await service.createCredential('owner-1', 'agent-1', {
      name: 'Sync',
      role: 'editor',
    });

    expect(prisma.agentCredential.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        role: 'editor',
        scopes: scopesForAgentAccessRole('editor'),
      }),
    }));
  });

  it('enables publisher switches without letting lower credential roles turn them off', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    prisma.agentCredential.create.mockResolvedValue({ id: 'credential-1', role: 'publisher' });
    prisma.agent.update.mockResolvedValue({});
    prisma.agentAuditEvent.create.mockResolvedValue({});

    await service.createCredential('owner-1', 'agent-1', {
      name: 'Publisher API', role: 'publisher',
    });
    expect(prisma.agent.update).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: { memoryEnabled: true, approvalMode: 'scoped-auto-publish' },
    });

    prisma.agent.update.mockClear();
    await service.createCredential('owner-1', 'agent-1', {
      name: 'Reader API', role: 'reader',
    });
    expect(prisma.agent.update).not.toHaveBeenCalled();
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
      role: 'reader',
    })).resolves.toEqual(expect.objectContaining({
      id: 'credential-1',
      apiKey: expect.stringMatching(/^agk_/),
    }));
  });

  it('claims one credential per local-sync installation and reuses it after a retry', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    prisma.agentCredential.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'credential-1', agentId: 'agent-1',
        keyHash: '58f5ceceff4ed07826c298f6b62e3fdb2cebfec07f946843c538fd45819e87ac',
        scopes: ['sources:read'], revokedAt: null,
      });
    prisma.agentCredential.create.mockResolvedValue({
      id: 'credential-1', agentId: 'agent-1',
      keyHash: '58f5ceceff4ed07826c298f6b62e3fdb2cebfec07f946843c538fd45819e87ac',
      scopes: ['sources:read'], revokedAt: null,
    });
    prisma.agentAuditEvent.create.mockResolvedValue({});

    const first = await service.createInstallationCredential(
      'owner-1', 'agent-1', 'installation-1', 'agk_deterministic', ['sources:read'],
    );
    const replay = await service.createInstallationCredential(
      'owner-1', 'agent-1', 'installation-1', 'agk_deterministic', ['sources:read'],
    );

    expect(first).toMatchObject({ id: 'credential-1', created: true, apiKey: 'agk_deterministic' });
    expect(replay).toMatchObject({ id: 'credential-1', created: false, apiKey: 'agk_deterministic' });
    expect(prisma.agentCredential.create).toHaveBeenCalledTimes(1);
    expect(prisma.agentCredential.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ localSyncInstallationId: 'installation-1' }),
    }));
  });

  it('recovers the uniquely claimed installation credential after a concurrent create', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    const claimed = {
      id: 'credential-1', agentId: 'agent-1',
      keyHash: '58f5ceceff4ed07826c298f6b62e3fdb2cebfec07f946843c538fd45819e87ac',
      scopes: ['sources:read'], revokedAt: null,
    };
    prisma.agentCredential.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(claimed);
    prisma.agentCredential.create.mockRejectedValue(new Error('unique constraint'));

    await expect(service.createInstallationCredential(
      'owner-1', 'agent-1', 'installation-1', 'agk_deterministic', ['sources:read'],
    )).resolves.toMatchObject({ id: 'credential-1', created: false });
  });

  it('surfaces the original create error when the recovery lookup also fails', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    prisma.agentCredential.findUnique
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('lookup unavailable'));
    prisma.agentCredential.create.mockRejectedValue(new Error('credential constraint violation'));

    await expect(service.createInstallationCredential(
      'owner-1', 'agent-1', 'installation-1', 'agk_deterministic', ['sources:read'],
    )).rejects.toThrow('credential constraint violation');
  });

  it('derives a grant ceiling from its role', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue(null);
    prisma.agentGrant.upsert.mockResolvedValue({ id: 'grant-1', role: 'publisher' });
    prisma.agentAuditEvent.create.mockResolvedValue({});

    await service.upsertGrantForSpace('owner-1', 'agent-1', 'space-1', 'publisher');

    expect(prisma.agentGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        role: 'publisher',
        scopes: scopesForAgentAccessRole('publisher'),
      }),
      update: { role: 'publisher', scopes: scopesForAgentAccessRole('publisher') },
    }));
    expect(prisma.agentAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: { oldRole: null, newRole: 'publisher', spaceId: 'space-1' },
      }),
    });
  });

  it('enables publisher switches without letting lower grant roles turn them off', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'active', revokedAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue(null);
    prisma.agentGrant.upsert.mockResolvedValue({ id: 'grant-1', role: 'publisher' });
    prisma.agent.update.mockResolvedValue({});
    prisma.agentAuditEvent.create.mockResolvedValue({});

    await service.upsertGrantForSpace('owner-1', 'agent-1', 'space-1', 'publisher');
    expect(prisma.agent.update).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: { memoryEnabled: true, approvalMode: 'scoped-auto-publish' },
    });

    prisma.agent.update.mockClear();
    prisma.agentGrant.findUnique.mockResolvedValue({ id: 'grant-1', role: 'publisher' });
    await service.upsertGrantForSpace('owner-1', 'agent-1', 'space-1', 'editor');
    expect(prisma.agent.update).not.toHaveBeenCalled();
  });


  it('rejects a missing or revoked agent before persisting a new grant', async () => {
    prisma.agent.findUnique.mockResolvedValueOnce(null);

    await expect(service.upsertGrantForSpace(
      'owner-1', 'missing', 'space-1', 'reader',
    )).rejects.toBeInstanceOf(NotFoundException);

    prisma.agent.findUnique.mockResolvedValueOnce({
      id: 'agent-1', ownerId: 'owner-1', status: 'revoked', revokedAt: new Date(),
    });

    await expect(service.upsertGrantForSpace(
      'owner-1', 'agent-1', 'space-1', 'reader',
    )).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
  });

  it('rejects a paused agent when creating a new grant', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-1', status: 'paused', revokedAt: null,
    });
    prisma.agentGrant.findUnique.mockResolvedValue(null);

    await expect(service.upsertGrantForSpace(
      'owner-1', 'agent-1', 'space-1', 'editor',
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
  });

  it('does not let a Space admin change another owners Agent role', async () => {
    prisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1', ownerId: 'owner-2', status: 'active', revokedAt: null,
    });

    await expect(service.upsertGrantForSpace(
      'admin-1', 'agent-1', 'space-1', 'publisher',
    )).rejects.toThrow('You do not own this agent');
    expect(prisma.agentGrant.upsert).not.toHaveBeenCalled();
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
      'owner-1', 'agent-1', 'space-1', 'reader',
    );
    await service.upsertGrantForSpace(
      'owner-1', 'agent-1', 'space-1', 'reader',
    );

    expect(prisma.agentGrant.upsert).toHaveBeenCalledTimes(2);
  });
});
