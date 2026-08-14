import { createHmac } from 'crypto';
import { ObsidianIntegrationService } from './obsidian-integration.service';
import { exchangeRequestHash } from '@neomei/agentwiki-sync-protocol';

describe('ObsidianIntegrationService', () => {
  const prisma = {
    obsidianInstallation: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    humanDeviceCredential: {
      create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
    },
    humanDeviceCredentialFamily: { create: jest.fn(), findUnique: jest.fn() },
    serverInstanceIdentity: { findFirst: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(),
  };
  const crypto = {
    newCode: jest.fn(() => 'A'.repeat(43)),
    installationCodeHash: jest.fn((code: string) => code),
    credentialHash: jest.fn((credential: string) => `h:${credential}`),
    getServerInstanceId: jest.fn(() => Promise.resolve('instance-1')),
  };
  const audit = { record: jest.fn(() => Promise.resolve()) };
  const redis = { incrementWithWindow: jest.fn(() => Promise.resolve(1)) };
  let service: ObsidianIntegrationService;

  beforeEach(() => {
    jest.clearAllMocks();
    crypto.newCode.mockReturnValue('A'.repeat(43));
    crypto.installationCodeHash.mockImplementation((code: string) => `codeHash:${code}`);
    crypto.credentialHash.mockImplementation((credential: string) => `credHash:${credential}`);
    crypto.getServerInstanceId.mockResolvedValue('instance-1');
    service = new ObsidianIntegrationService(prisma as any, crypto as any, audit as any, redis as any);
  });

  it('creates a single-use installation code', async () => {
    const created = { id: 'install-1', expiresAt: new Date('2030-01-01T00:10:00.000Z') };
    prisma.obsidianInstallation.create.mockResolvedValue(created);

    const result = await service.createInstallation('user-1', '1.2.3.4');

    expect(result.code).toBe('A'.repeat(43));
    expect(result.installationId).toBe('install-1');
    expect(prisma.obsidianInstallation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 'user-1',
        codeHash: expect.any(String),
      }),
    }));
  });

  it('rejects revoking an already exchanged installation', async () => {
    prisma.obsidianInstallation.findUnique.mockResolvedValue({
      id: 'install-1', userId: 'user-1', status: 'exchanged',
    });

    await expect(service.revokeInstallation('user-1', 'install-1')).rejects.toMatchObject({
      syncCode: 'INSTALLATION_ALREADY_EXCHANGED',
    });
  });

  it('lists credentials without exposing hashes', async () => {
    prisma.humanDeviceCredential.findMany.mockResolvedValue([{
      id: 'cred-1', deviceId: 'device-1', vaultId: 'vault-1', deviceName: 'Mac',
      status: 'active', provisionalExpiresAt: null, createdAt: new Date('2030-01-01T00:00:00.000Z'),
      lastUsedAt: null, revokedAt: null,
    }]);

    const result = await service.listCredentials('user-1');

    expect(result).toEqual([expect.objectContaining({ credentialId: 'cred-1', status: 'active' })]);
    expect(JSON.stringify(result)).not.toContain('credentialHash');
  });

  it('returns the same provisional metadata for an exact exchange replay', async () => {
    const request = {
      code: 'C'.repeat(43),
      exchangeId: '11111111-1111-4111-8111-111111111111',
      credential: 'D'.repeat(43),
      deviceId: '22222222-2222-4222-8222-222222222222',
      deviceName: 'Mac',
      vaultId: '33333333-3333-4333-8333-333333333333',
      pluginVersion: '1.0.0',
      supportedProtocolVersions: ['1'] as [string, ...string[]],
    };
    const hash = await exchangeRequestHash(request);
    const installation = {
      id: 'install-1',
      status: 'exchanged',
      exchangeId: request.exchangeId,
      requestHash: hash,
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      user: { id: 'user-1', name: 'User', deletedAt: null, lockedAt: null, type: 'human' },
    };
    const credential = {
      id: 'cred-1',
      provisionalExpiresAt: new Date('2030-01-01T00:10:00.000Z'),
    };
    prisma.obsidianInstallation.findUnique.mockResolvedValue(installation);
    prisma.humanDeviceCredential.findFirst.mockResolvedValue(credential);
    crypto.installationCodeHash.mockImplementation(() => 'codeHash:C');

    const result = await service.exchange(request as any, '1.2.3.4');

    expect(result.credentialId).toBe('cred-1');
    expect(result.credentialStatus).toBe('provisional');
  });
});
