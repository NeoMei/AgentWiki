import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { LocalSyncInstallationService } from './local-sync-installation.service';

describe('LocalSyncInstallationService', () => {
  const redis = {
    setOnce: jest.fn(),
    getStrict: jest.fn(),
    getDel: jest.fn(),
    deleteStrict: jest.fn(),
    incrementWithWindow: jest.fn(),
  };
  const agents = {
    getOwned: jest.fn(),
    createCredential: jest.fn(),
    listCredentials: jest.fn(),
    revokeCredential: jest.fn(),
    normalizeCredentialScopes: jest.fn(),
    assertCredentialCanDelegate: jest.fn(),
  };
  const config = { get: jest.fn() };
  const audit = { record: jest.fn() };
  let service: LocalSyncInstallationService;
  const exchangeCode = 'AW-CODE-12345';

  const payload = {
    installationId: createHash('sha256').update(exchangeCode).digest('hex'),
    ownerId: 'owner-1',
    agentId: 'agent-1',
    scopes: ['sources:read'],
    pluginVersion: '0.1.0',
    serverUrl: 'https://wiki.test/api',
    expiresAt: '2030-01-01T00:10:00.000Z',
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    jest.clearAllMocks();
    config.get.mockImplementation((key: string) => (
      key === 'LOCAL_SYNC_PACKAGE_VERSION' ? '0.1.0' : undefined
    ));
    redis.setOnce.mockResolvedValue(true);
    redis.incrementWithWindow.mockResolvedValue(1);
    redis.deleteStrict.mockResolvedValue(1);
    redis.getStrict.mockResolvedValue(JSON.stringify(payload));
    agents.getOwned.mockResolvedValue({ id: 'agent-1', status: 'active' });
    agents.normalizeCredentialScopes.mockImplementation((scopes: string[]) => [...new Set(scopes)]);
    agents.createCredential.mockResolvedValue({ id: 'credential-1', apiKey: 'agk_secret' });
    agents.listCredentials.mockResolvedValue([]);
    agents.revokeCredential.mockResolvedValue({ success: true });
    agents.assertCredentialCanDelegate.mockResolvedValue(undefined);
    audit.record.mockResolvedValue(undefined);
    service = new LocalSyncInstallationService(redis as any, agents as any, config as any, audit as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores only a hash-keyed, 600-second one-time payload', async () => {
    const result = await service.create(
      'owner-1',
      'agent-1',
      ['sources:read'],
      '0.1.0',
      'https://wiki.test/api/',
    );

    expect(result.code).toMatch(/^AW-[A-Z0-9-]+$/);
    expect(result.expiresAt).toBe('2030-01-01T00:10:00.000Z');
    expect(result.installationId).toMatch(/^[a-f0-9]{64}$/);
    expect(redis.setOnce).toHaveBeenCalledWith(
      `local-sync:install:${result.installationId}`,
      expect.not.stringContaining(result.code),
      600,
    );
    const stored = JSON.parse(redis.setOnce.mock.calls[0][1]);
    expect(stored).toEqual(expect.objectContaining({
      installationId: result.installationId,
      ownerId: 'owner-1',
      agentId: 'agent-1',
      scopes: ['sources:read'],
      pluginVersion: '0.1.0',
      serverUrl: 'https://wiki.test/api',
    }));
    expect(stored).not.toHaveProperty('code');
    expect(result.instructions).toContain('@neomei/agentwiki-local-sync@0.1.0 connect');
    expect(result.instructions).toContain(result.code);
    expect(result.instructions).toContain('doctor');
    expect(result.instructions).toContain('does not scan or sync');
    expect(result.instructions).not.toContain('agk_');
    expect(agents.getOwned).toHaveBeenCalledWith('owner-1', 'agent-1');
    expect(agents.normalizeCredentialScopes).toHaveBeenCalledWith(['sources:read']);
  });

  it('issues a bootstrap code through the same validation and ten-minute storage path', async () => {
    const result = await service.issueForBootstrap({
      ownerId: 'owner-1',
      agentId: 'agent-1',
      scopes: ['sources:read', 'sources:read'],
      pluginVersion: '0.1.0',
      serverUrl: 'https://wiki.test/api/',
    });

    expect(result.expiresAt).toBe('2030-01-01T00:10:00.000Z');
    expect(agents.getOwned).toHaveBeenCalledWith('owner-1', 'agent-1');
    expect(agents.normalizeCredentialScopes).toHaveBeenCalledWith([
      'sources:read', 'sources:read',
    ]);
    expect(redis.setOnce).toHaveBeenCalledWith(
      `local-sync:install:${result.installationId}`,
      expect.stringContaining('"scopes":["sources:read"]'),
      600,
    );
  });

  it('keeps bootstrap issuance closed for unsupported versions, unsafe URLs and inactive Agents', async () => {
    await expect(service.issueForBootstrap({
      ownerId: 'owner-1', agentId: 'agent-1', scopes: ['sources:read'],
      pluginVersion: '0.2.0', serverUrl: 'https://wiki.test/api',
    })).rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_VERSION_UNSUPPORTED' });

    agents.getOwned.mockResolvedValue({ id: 'agent-1', status: 'paused' });
    await expect(service.issueForBootstrap({
      ownerId: 'owner-1', agentId: 'agent-1', scopes: ['sources:read'],
      pluginVersion: '0.1.0', serverUrl: 'https://wiki.test/api',
    })).rejects.toThrow('Agent must be active');

    agents.getOwned.mockResolvedValue({ id: 'agent-1', status: 'active' });
    await expect(service.issueForBootstrap({
      ownerId: 'owner-1', agentId: 'agent-1', scopes: ['sources:read'],
      pluginVersion: '0.1.0', serverUrl: 'https://wiki.test/api;bad',
    })).rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_VERSION_UNSUPPORTED' });
  });

  it.each([undefined, '0.2.0'])('rejects unsupported configured version %p before issuing a code', async (supported) => {
    config.get.mockReturnValue(supported);

    await expect(service.create(
      'owner-1', 'agent-1', ['sources:read'], '0.1.0', 'https://wiki.test/api',
    )).rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_VERSION_UNSUPPORTED' });
    expect(redis.setOnce).not.toHaveBeenCalled();
  });

  it('retries hash collisions up to three times and fails without returning a code', async () => {
    redis.setOnce.mockResolvedValue(false);

    await expect(service.create(
      'owner-1', 'agent-1', ['sources:read'], '0.1.0', 'https://wiki.test/api',
    )).rejects.toThrow('Could not issue a unique local sync installation code');
    expect(redis.setOnce).toHaveBeenCalledTimes(3);
  });

  it('rejects invalid scopes before writing any installation state', async () => {
    agents.normalizeCredentialScopes.mockImplementation(() => {
      throw new BadRequestException('invalid scopes');
    });

    await expect(service.create(
      'owner-1', 'agent-1', ['review:decide'], '0.1.0', 'https://wiki.test/api',
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(redis.setOnce).not.toHaveBeenCalled();
  });

  it('rejects an Agent-originated installation that expands the issuing credential scopes', async () => {
    await expect(service.create(
      'owner-1', 'agent-1', ['pages:write'], '0.1.0', 'https://wiki.test/api',
      { credentialId: 'credential-read', scopes: ['pages:read'] },
    )).rejects.toThrow('Agent install scopes cannot exceed the issuing credential');
    expect(redis.setOnce).not.toHaveBeenCalled();
  });

  it('revalidates the issuing credential when an Agent-originated code is exchanged', async () => {
    redis.getDel.mockResolvedValue(JSON.stringify({ ...payload, issuerCredentialId: 'credential-read' }));

    await service.exchange(exchangeCode, '127.0.0.1');

    expect(agents.assertCredentialCanDelegate).toHaveBeenCalledWith(
      'owner-1', 'agent-1', 'credential-read', ['sources:read'],
    );
  });

  it('revokes an owned installation using its direct hash key', async () => {
    await expect(service.revoke('owner-1', 'agent-1', payload.installationId)).resolves.toEqual({
      success: true,
    });

    expect(agents.getOwned).toHaveBeenCalledWith('owner-1', 'agent-1');
    expect(redis.getStrict).toHaveBeenCalledWith(
      `local-sync:install:${payload.installationId}`,
    );
    expect(redis.deleteStrict).toHaveBeenCalledWith(
      `local-sync:install:${payload.installationId}`,
    );
  });

  it('does not revoke an installation belonging to a different owner or Agent', async () => {
    redis.getStrict.mockResolvedValue(JSON.stringify({
      ...payload,
      ownerId: 'owner-2',
      agentId: 'agent-2',
    }));

    await expect(service.revoke('owner-1', 'agent-1', payload.installationId)).rejects.toThrow(
      'Local sync installation not found',
    );
    expect(redis.deleteStrict).not.toHaveBeenCalled();
  });

  it('consumes the code once and returns a newly issued credential once', async () => {
    redis.getDel.mockResolvedValue(JSON.stringify(payload));

    await expect(service.exchange(exchangeCode, '127.0.0.1')).resolves.toMatchObject({
      apiKey: 'agk_secret',
      agentId: 'agent-1',
      credentialId: 'credential-1',
      serverUrl: 'https://wiki.test/api',
      pluginVersion: '0.1.0',
      scopes: ['sources:read'],
    });
    expect(redis.getDel).toHaveBeenCalledTimes(1);
    expect(agents.createCredential).toHaveBeenCalledWith('owner-1', 'agent-1', {
      name: 'Local sync plugin',
      scopes: ['sources:read'],
    });
  });

  it('allows only one concurrent redemption of a code', async () => {
    redis.getDel
      .mockResolvedValueOnce(JSON.stringify(payload))
      .mockResolvedValueOnce(null);

    const results = await Promise.allSettled([
      service.exchange(exchangeCode, '127.0.0.1'),
      service.exchange(exchangeCode, '127.0.0.1'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(agents.createCredential).toHaveBeenCalledTimes(1);
  });

  it.each([null, JSON.stringify({ ...payload, expiresAt: '2029-12-31T23:59:59.000Z' })])(
    'rejects expired or already-used installation state %p',
    async (stored) => {
      redis.getDel.mockResolvedValue(stored);

      await expect(service.exchange(exchangeCode, '127.0.0.1'))
        .rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_CODE_INVALID' });
      expect(agents.createCredential).not.toHaveBeenCalled();
    },
  );

  it('rejects a payload whose plugin version is no longer supported', async () => {
    redis.getDel.mockResolvedValue(JSON.stringify({ ...payload, pluginVersion: '0.0.9' }));

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_VERSION_UNSUPPORTED' });
    expect(agents.createCredential).not.toHaveBeenCalled();
  });

  it.each(['paused', 'revoked'])('rejects a %s Agent after consuming the code', async (status) => {
    redis.getDel.mockResolvedValue(JSON.stringify(payload));
    agents.getOwned.mockResolvedValue({ id: 'agent-1', status });

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(agents.createCredential).not.toHaveBeenCalled();
  });

  it('rejects invalid stored scopes before creating a credential', async () => {
    redis.getDel.mockResolvedValue(JSON.stringify({ ...payload, scopes: ['review:decide'] }));
    agents.normalizeCredentialScopes.mockImplementation(() => {
      throw new BadRequestException('invalid scopes');
    });

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(agents.createCredential).not.toHaveBeenCalled();
  });

  it('rate-limits more than ten exchange attempts per IP per minute', async () => {
    redis.incrementWithWindow.mockResolvedValue(11);

    await expect(service.exchange(exchangeCode, '192.0.2.10'))
      .rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
    expect(redis.getDel).not.toHaveBeenCalled();
  });

  it('records credential ID in audit metadata without recording the API key', async () => {
    redis.getDel.mockResolvedValue(JSON.stringify(payload));

    await service.exchange(exchangeCode, '127.0.0.1');

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'local-sync.installation.exchange',
      actorAgentId: 'agent-1',
      ipAddress: '127.0.0.1',
      metadata: expect.objectContaining({ credentialId: 'credential-1' }),
    }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('agk_secret');
  });

  it('revokes the created credential when installation audit recording fails', async () => {
    redis.getDel.mockResolvedValue(JSON.stringify(payload));
    audit.record.mockRejectedValue(new Error('audit unavailable'));

    await expect(service.exchange(exchangeCode, '127.0.0.1')).rejects.toThrow('audit unavailable');

    expect(agents.revokeCredential).toHaveBeenCalledWith(
      'owner-1',
      'agent-1',
      'credential-1',
    );
  });

  it('does not revoke a credential when creation fails before persistence', async () => {
    redis.getDel.mockResolvedValue(JSON.stringify(payload));
    agents.createCredential.mockRejectedValue(new Error('credential constraint violation'));

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toThrow('credential constraint violation');

    expect(agents.listCredentials).not.toHaveBeenCalled();
    expect(agents.revokeCredential).not.toHaveBeenCalled();
  });

  it('rejects a server URL containing shell metacharacters before issuing a code', async () => {
    await expect(service.create(
      'owner-1',
      'agent-1',
      ['sources:read'],
      '0.1.0',
      'https://wiki.test/api;rm -rf /',
    )).rejects.toMatchObject({
      businessCode: 'LOCAL_SYNC_VERSION_UNSUPPORTED',
      message: 'Server URL contains unsafe characters',
    });
    expect(redis.setOnce).not.toHaveBeenCalled();
  });
});
