import { ForbiddenException } from '@nestjs/common';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { createHash } from 'crypto';
import { LocalSyncInstallationService } from './local-sync-installation.service';

describe('LocalSyncInstallationService', () => {
  const redis = {
    setOnce: jest.fn(),
    getStrict: jest.fn(),
    getDel: jest.fn(),
    setStrict: jest.fn(),
    deleteStrict: jest.fn(),
    deleteIfValueMatches: jest.fn(),
    incrementWithWindow: jest.fn(),
  };
  const agents = {
    getOwned: jest.fn(),
    assertCanIssueConnection: jest.fn(),
    exchangeConnectionIntent: jest.fn(),
    assertConnectionReceipt: jest.fn(),
    listCredentials: jest.fn(),
    revokeCredential: jest.fn(),
  };
  const config = { get: jest.fn() };
  const audit = { record: jest.fn() };
  let service: LocalSyncInstallationService;
  const exchangeCode = 'AW-CODE-12345';

  const payload = {
    installationId: createHash('sha256').update(exchangeCode).digest('hex'),
    ownerId: 'owner-1',
    agentId: 'agent-1',
    spaceId: 'space-1',
    role: 'editor' as const,
    pluginVersion: '0.6.1',
    serverUrl: 'https://wiki.test/api',
    expiresAt: '2030-01-01T00:10:00.000Z',
  };
  const installationKey = `local-sync:install:${payload.installationId}`;
  const receiptKey = `local-sync:install-receipt:${payload.installationId}`;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    jest.clearAllMocks();
    config.get.mockImplementation((key: string) => (
      key === 'LOCAL_SYNC_PACKAGE_VERSION' ? '0.6.1'
        : key === 'JWT_SECRET' ? 'test-only-local-sync-receipt-secret'
          : undefined
    ));
    redis.setOnce.mockResolvedValue(true);
    redis.setStrict.mockResolvedValue(undefined);
    redis.incrementWithWindow.mockResolvedValue(1);
    redis.deleteStrict.mockResolvedValue(1);
    redis.deleteIfValueMatches.mockResolvedValue(true);
    redis.getStrict.mockImplementation(async (key: string) => (
      key === installationKey ? JSON.stringify(payload) : null
    ));
    agents.getOwned.mockResolvedValue({ id: 'agent-1', status: 'active' });
    agents.assertCanIssueConnection.mockResolvedValue(undefined);
    agents.exchangeConnectionIntent.mockResolvedValue({
      id: 'credential-1', grantId: 'grant-1', agentId: 'agent-1', role: 'editor',
      scopes: scopesForAgentAccessRole('editor'), revokedAt: null,
    });
    agents.listCredentials.mockResolvedValue([]);
    agents.revokeCredential.mockResolvedValue({ success: true });
    agents.assertConnectionReceipt.mockResolvedValue(undefined);
    audit.record.mockResolvedValue(undefined);
    service = new LocalSyncInstallationService(redis as any, agents as any, config as any, audit as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores only a hash-keyed payload long enough to identify recently expired codes', async () => {
    const result = await service.create(
      'owner-1',
      'agent-1',
      'space-1',
      'editor',
      '0.6.1',
      'https://wiki.test/api/',
    );

    expect(result.code).toMatch(/^AW-[A-Z0-9-]+$/);
    expect(result.expiresAt).toBe('2030-01-01T00:10:00.000Z');
    expect(result.installationId).toMatch(/^[a-f0-9]{64}$/);
    expect(redis.setOnce).toHaveBeenCalledWith(
      `local-sync:install:${result.installationId}`,
      expect.not.stringContaining(result.code),
      900,
    );
    const stored = JSON.parse(redis.setOnce.mock.calls[0][1]);
    expect(stored).toEqual(expect.objectContaining({
      installationId: result.installationId,
      ownerId: 'owner-1',
      agentId: 'agent-1',
      spaceId: 'space-1',
      role: 'editor',
      pluginVersion: '0.6.1',
      serverUrl: 'https://wiki.test/api',
    }));
    expect(stored).not.toHaveProperty('code');
    expect(stored).not.toHaveProperty('scopes');
    expect(result.instructions).toContain('@neomei/agentwiki-local-sync@0.6.1 onboard');
    expect(result.instructions).toContain(`--code ${result.code}`);
    expect(result.instructions).toContain('--protocol ndjson');
    expect(result.instructions).not.toMatch(/\bconnect\b/);
    expect(result.instructions).toContain(result.code);
    expect(result.instructions).toContain('doctor');
    expect(result.instructions).toContain('does not scan or sync');
    expect(result.instructions).not.toContain('agk_');
    expect(agents.assertCanIssueConnection).toHaveBeenCalledWith(
      'owner-1', 'agent-1', 'space-1',
    );
  });

  it.each([undefined, '0.2.0'])('rejects unsupported configured version %p before issuing a code', async (supported) => {
    config.get.mockReturnValue(supported);

    await expect(service.create(
      'owner-1', 'agent-1', 'space-1', 'reader', '0.6.1', 'https://wiki.test/api',
    )).rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_VERSION_UNSUPPORTED' });
    expect(redis.setOnce).not.toHaveBeenCalled();
  });

  it('retries hash collisions up to three times and fails without returning a code', async () => {
    redis.setOnce.mockResolvedValue(false);

    await expect(service.create(
      'owner-1', 'agent-1', 'space-1', 'reader', '0.6.1', 'https://wiki.test/api',
    )).rejects.toThrow('Could not issue a unique local sync installation code');
    expect(redis.setOnce).toHaveBeenCalledTimes(3);
  });

  it('rejects issuance when the owner no longer administers the Space', async () => {
    agents.assertCanIssueConnection.mockRejectedValue(new ForbiddenException('not admin'));

    await expect(service.create(
      'owner-1', 'agent-1', 'space-1', 'publisher', '0.6.1', 'https://wiki.test/api',
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(redis.setOnce).not.toHaveBeenCalled();
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
    await expect(service.exchange(exchangeCode, '127.0.0.1')).resolves.toMatchObject({
      apiKey: expect.stringMatching(/^agk_/),
      agentId: 'agent-1',
      credentialId: 'credential-1',
      serverUrl: 'https://wiki.test/api',
      spaceId: 'space-1',
      role: 'editor',
      pluginVersion: '0.6.1',
      scopes: scopesForAgentAccessRole('editor'),
    });
    expect(redis.setStrict).toHaveBeenCalledWith(
      receiptKey,
      expect.not.stringContaining('agk_secret'),
      120,
    );
    const receipt = JSON.parse(
      redis.setStrict.mock.calls.find(([key]) => key === receiptKey)?.[1],
    );
    expect(receipt).toEqual(expect.objectContaining({
      spaceId: 'space-1', role: 'editor', credentialId: 'credential-1', grantId: 'grant-1',
    }));
    expect(redis.deleteStrict).toHaveBeenCalledWith(installationKey);
    expect(agents.exchangeConnectionIntent).toHaveBeenCalledWith({
      ownerId: 'owner-1', agentId: 'agent-1', spaceId: 'space-1', role: 'editor',
      installationId: payload.installationId, rawKey: expect.stringMatching(/^agk_/),
    });
  });

  it('replays a completed exchange without creating a second credential', async () => {
    const first = await service.exchange(exchangeCode, '127.0.0.1');
    const receipt = redis.setStrict.mock.calls.find(([key]) => key === receiptKey)?.[1];
    redis.getStrict.mockImplementation(async (key: string) => (
      key === receiptKey ? receipt : null
    ));

    await expect(service.exchange(exchangeCode, '127.0.0.1')).resolves.toEqual(first);

    expect(agents.exchangeConnectionIntent).toHaveBeenCalledTimes(1);
    expect(agents.assertConnectionReceipt).toHaveBeenCalledWith({
      ownerId: 'owner-1',
      agentId: 'agent-1',
      credentialId: 'credential-1',
      grantId: 'grant-1',
      spaceId: 'space-1',
      role: 'editor',
    });
  });

  it('rejects and deletes a pre-0.6.1 replay receipt before live validation', async () => {
    await service.exchange(exchangeCode, '127.0.0.1');
    const serialized = redis.setStrict.mock.calls.find(([key]) => key === receiptKey)?.[1];
    const legacyReceipt = JSON.stringify({ ...JSON.parse(serialized), pluginVersion: '0.4.0' });
    redis.getStrict.mockImplementation(async (key: string) => (
      key === receiptKey ? legacyReceipt : null
    ));
    agents.assertConnectionReceipt.mockClear();

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_CODE_INVALID' });

    expect(agents.assertConnectionReceipt).not.toHaveBeenCalled();
    expect(redis.deleteStrict).toHaveBeenCalledWith(receiptKey);
    expect(redis.deleteStrict).toHaveBeenCalledWith('local-sync:credential-receipt:credential-1');
  });

  it('rejects a replay receipt that is not bound to its original Grant id', async () => {
    await service.exchange(exchangeCode, '127.0.0.1');
    const serialized = redis.setStrict.mock.calls.find(([key]) => key === receiptKey)?.[1];
    const unboundReceipt = JSON.parse(serialized);
    delete unboundReceipt.grantId;
    redis.getStrict.mockImplementation(async (key: string) => (
      key === receiptKey ? JSON.stringify(unboundReceipt) : null
    ));
    agents.assertConnectionReceipt.mockClear();

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_CODE_INVALID' });

    expect(agents.assertConnectionReceipt).not.toHaveBeenCalled();
    expect(redis.deleteStrict).toHaveBeenCalledWith(receiptKey);
    expect(redis.deleteStrict).toHaveBeenCalledWith('local-sync:credential-receipt:credential-1');
  });

  it('serializes concurrent exchange attempts and returns the same receipt', async () => {
    jest.useRealTimers();
    let locked = false;
    let receipt: string | null = null;
    redis.setOnce.mockImplementation(async (key: string) => {
      if (!key.startsWith('local-sync:install-lock:')) return true;
      if (locked) return false;
      locked = true;
      return true;
    });
    redis.getStrict.mockImplementation(async (key: string) => {
      if (key === receiptKey) return receipt;
      if (key === installationKey) return JSON.stringify(payload);
      return null;
    });
    redis.setStrict.mockImplementation(async (key: string, value: string) => {
      if (key === receiptKey) receipt = value;
    });
    redis.deleteIfValueMatches.mockImplementation(async () => {
      locked = false;
      return 1;
    });

    const [first, second] = await Promise.all([
      service.exchange(exchangeCode, '127.0.0.1'),
      service.exchange(exchangeCode, '127.0.0.1'),
    ]);

    expect(second).toEqual(first);
    expect(agents.exchangeConnectionIntent).toHaveBeenCalledTimes(1);
  });

  it('releases only the lock token acquired by this exchange attempt', async () => {
    await service.exchange(exchangeCode, '127.0.0.1');

    expect(redis.deleteIfValueMatches).toHaveBeenCalledWith(
      `local-sync:install-lock:${payload.installationId}`,
      expect.stringMatching(/^[a-f0-9]{32}$/),
    );
    expect(redis.deleteStrict).not.toHaveBeenCalledWith(
      `local-sync:install-lock:${payload.installationId}`,
    );
  });

  it('invalidates the exchange receipt after the installation credential is revoked', async () => {
    redis.getStrict.mockImplementation(async (key: string) => (
      key === 'local-sync:credential-receipt:credential-1' ? payload.installationId : null
    ));

    await service.revokeCredentialAndReceipts('owner-1', 'agent-1', 'credential-1');

    expect(redis.deleteStrict).toHaveBeenCalledWith(receiptKey);
    expect(redis.deleteStrict).toHaveBeenCalledWith('local-sync:credential-receipt:credential-1');
  });

  it('rejects an unknown or already-used code without a receipt', async () => {
    redis.getStrict.mockResolvedValue(null);

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_CODE_INVALID' });
    expect(agents.exchangeConnectionIntent).not.toHaveBeenCalled();
  });

  it('distinguishes an expired installation code', async () => {
    redis.getStrict.mockImplementation(async (key: string) => (
      key === installationKey
        ? JSON.stringify({ ...payload, expiresAt: '2029-12-31T23:59:59.000Z' })
        : null
    ));

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_CODE_EXPIRED' });
    expect(agents.exchangeConnectionIntent).not.toHaveBeenCalled();
  });

  it('does not persist the exchanged API key in plaintext Redis state', async () => {
    await service.exchange(exchangeCode, '127.0.0.1');

    const persistedValues = [
      ...redis.setOnce.mock.calls.map((call) => call[1]),
      ...redis.setStrict.mock.calls.map((call) => call[1]),
    ];
    expect(persistedValues.join('\n')).not.toMatch(/\bagk_/);
  });

  it('bounds receipt replay to the remaining installation lifetime', async () => {
    jest.setSystemTime(new Date('2030-01-01T00:09:00.000Z'));

    await service.exchange(exchangeCode, '127.0.0.1');

    expect(redis.setStrict).toHaveBeenCalledWith(receiptKey, expect.any(String), 60);
    expect(redis.setStrict).toHaveBeenCalledWith(
      'local-sync:credential-receipt:credential-1',
      payload.installationId,
      60,
    );
  });

  it('invalidates replay metadata when the exchanged credential was revoked elsewhere', async () => {
    await service.exchange(exchangeCode, '127.0.0.1');
    const receipt = redis.setStrict.mock.calls.find(([key]) => key === receiptKey)?.[1];
    redis.getStrict.mockImplementation(async (key: string) => (
      key === receiptKey ? receipt : null
    ));
    agents.assertConnectionReceipt.mockRejectedValue(new ForbiddenException('revoked'));

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_CODE_INVALID' });
    expect(redis.deleteStrict).toHaveBeenCalledWith(receiptKey);
    expect(redis.deleteStrict).toHaveBeenCalledWith('local-sync:credential-receipt:credential-1');
  });

  it('keeps replay metadata intact when credential validation fails transiently', async () => {
    await service.exchange(exchangeCode, '127.0.0.1');
    const receipt = redis.setStrict.mock.calls.find(([key]) => key === receiptKey)?.[1];
    redis.getStrict.mockImplementation(async (key: string) => (
      key === receiptKey ? receipt : null
    ));
    agents.assertConnectionReceipt.mockRejectedValue(new Error('database unavailable'));

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toThrow('database unavailable');
    expect(redis.deleteStrict).not.toHaveBeenCalledWith(receiptKey);
    expect(redis.deleteStrict).not.toHaveBeenCalledWith('local-sync:credential-receipt:credential-1');
  });

  it('rejects a payload whose plugin version is no longer supported', async () => {
    redis.getStrict.mockImplementation(async (key: string) => (
      key === installationKey ? JSON.stringify({ ...payload, pluginVersion: '0.0.9' }) : null
    ));

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_VERSION_UNSUPPORTED' });
    expect(agents.exchangeConnectionIntent).not.toHaveBeenCalled();
  });

  it('does not write a success receipt when the database transaction fails', async () => {
    agents.exchangeConnectionIntent.mockRejectedValue(new ForbiddenException('stale authority'));

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(redis.setStrict).not.toHaveBeenCalledWith(
      receiptKey, expect.anything(), expect.anything(),
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('cleans partial Redis success state when receipt persistence fails', async () => {
    redis.setStrict.mockImplementation(async (key: string) => {
      if (key === receiptKey) throw new Error('redis unavailable');
    });

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toThrow('redis unavailable');

    expect(redis.deleteStrict).toHaveBeenCalledWith(receiptKey);
    expect(redis.deleteStrict).toHaveBeenCalledWith(
      'local-sync:credential-receipt:credential-1',
    );
    expect(redis.deleteStrict).not.toHaveBeenCalledWith(installationKey);
  });

  it('rejects an invalid stored role before creating a credential', async () => {
    redis.getStrict.mockImplementation(async (key: string) => (
      key === installationKey ? JSON.stringify({ ...payload, role: 'owner' }) : null
    ));

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toMatchObject({ businessCode: 'LOCAL_SYNC_CODE_INVALID' });
    expect(agents.exchangeConnectionIntent).not.toHaveBeenCalled();
  });

  it('rate-limits more than ten exchange attempts per IP per minute', async () => {
    redis.incrementWithWindow.mockResolvedValue(11);

    await expect(service.exchange(exchangeCode, '192.0.2.10'))
      .rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
    expect(redis.getStrict).not.toHaveBeenCalled();
  });

  it('records credential ID in audit metadata without recording the API key', async () => {
    await service.exchange(exchangeCode, '127.0.0.1');

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'local-sync.installation.exchange',
      actorAgentId: 'agent-1',
      ipAddress: '127.0.0.1',
      metadata: expect.objectContaining({ credentialId: 'credential-1' }),
    }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('agk_secret');
  });

  it('keeps the exactly-once credential claim recoverable when exchange audit recording fails', async () => {
    audit.record.mockRejectedValue(new Error('audit unavailable'));

    await expect(service.exchange(exchangeCode, '127.0.0.1')).rejects.toThrow('audit unavailable');

    expect(agents.revokeCredential).not.toHaveBeenCalled();
    audit.record.mockResolvedValue(undefined);
    await expect(service.exchange(exchangeCode, '127.0.0.1')).resolves.toMatchObject({
      credentialId: 'credential-1',
      apiKey: expect.stringMatching(/^agk_/),
    });
  });

  it('does not revoke a credential when creation fails before persistence', async () => {
    agents.exchangeConnectionIntent.mockRejectedValue(new Error('credential constraint violation'));

    await expect(service.exchange(exchangeCode, '127.0.0.1'))
      .rejects.toThrow('credential constraint violation');

    expect(agents.listCredentials).not.toHaveBeenCalled();
    expect(agents.revokeCredential).not.toHaveBeenCalled();
  });

  it('rejects a server URL containing shell metacharacters before issuing a code', async () => {
    await expect(service.create(
      'owner-1',
      'agent-1',
      'space-1',
      'reader',
      '0.6.1',
      'https://wiki.test/api;rm -rf /',
    )).rejects.toMatchObject({
      businessCode: 'LOCAL_SYNC_VERSION_UNSUPPORTED',
      message: 'Server URL contains unsafe characters',
    });
    expect(redis.setOnce).not.toHaveBeenCalled();
  });
});
