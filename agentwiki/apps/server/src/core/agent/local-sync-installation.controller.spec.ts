import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { HumanOnlyGuard } from '../auth/human-only.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LocalSyncInstallationController } from './local-sync-installation.controller';

describe('LocalSyncInstallationController', () => {
  const installations = {
    create: jest.fn(),
    revoke: jest.fn(),
  revokeCredentialAndReceipts: jest.fn(),
    exchange: jest.fn(),
  };
  const config = { get: jest.fn() };
  let controller: LocalSyncInstallationController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new LocalSyncInstallationController(installations as any, config as any);
  });

  it('guards creation and revocation with human JWT while leaving exchange public', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.create)).toEqual([
      JwtAuthGuard,
      HumanOnlyGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.revoke)).toEqual([
      JwtAuthGuard,
      HumanOnlyGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.exchange)).toBeUndefined();
  });

  it('allows an agent to create an install code for itself using CombinedAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.createForAgent)).toEqual([
      CombinedAuthGuard,
    ]);
  });

  it('allows an agent credential to revoke itself after a failed local install', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.revokeCurrentCredential)).toEqual([
      CombinedAuthGuard,
    ]);
    installations.revokeCredentialAndReceipts.mockResolvedValue({ success: true });
    const request = { user: { userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1' } } as any;
    await expect(controller.revokeCurrentCredential(request)).resolves.toEqual({ success: true });
    expect(installations.revokeCredentialAndReceipts).toHaveBeenCalledWith('owner-1', 'agent-1', 'credential-1');
  });

  it('creates an install code with the ownerId and agentId from the authenticated principal', async () => {
    config.get.mockImplementation((key: string) => (
      key === 'PUBLIC_API_URL' ? 'https://wiki.test/api' : 'production'
    ));
    installations.create.mockResolvedValue({ installationId: 'install-self' });
    const request = {
      user: {
        userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1', scopes: ['pages:read'],
      },
    } as any;

    const result = await controller.createForAgent(request, 'agent-1', {
      scopes: ['pages:read'],
      pluginVersion: '0.2.3',
    });

    expect(result).toEqual({ installationId: 'install-self' });
    expect(installations.create).toHaveBeenCalledWith(
      'owner-1',
      'agent-1',
      ['pages:read'],
      '0.2.3',
      'https://wiki.test/api',
      { credentialId: 'credential-1', scopes: ['pages:read'] },
    );
  });

  it('forbids an agent from creating install codes for a different agent', () => {
    const request = { user: { userId: 'owner-1', agentId: 'agent-2' } } as any;

    expect(() => controller.createForAgent(request, 'agent-1', {
      scopes: ['pages:read'],
      pluginVersion: '0.2.3',
    })).toThrow(ForbiddenException);
    expect(installations.create).not.toHaveBeenCalled();
  });

  it('uses the configured canonical public API URL without a trailing slash', async () => {
    config.get.mockImplementation((key: string) => (
      key === 'PUBLIC_API_URL' ? 'https://wiki.test/api/' : 'production'
    ));
    installations.create.mockResolvedValue({ installationId: 'install-1' });
    const request = { user: { userId: 'owner-1' } } as any;

    await controller.create(request, 'agent-1', {
      scopes: ['sources:read'],
      pluginVersion: '0.1.0',
    });

    expect(installations.create).toHaveBeenCalledWith(
      'owner-1',
      'agent-1',
      ['sources:read'],
      '0.1.0',
      'https://wiki.test/api',
    );
  });

  it('allows a request-derived API origin only outside production', async () => {
    config.get.mockImplementation((key: string) => (
      key === 'NODE_ENV' ? 'development' : undefined
    ));
    const request = {
      user: { userId: 'owner-1' },
      protocol: 'http',
      get: jest.fn().mockReturnValue('localhost:3000'),
    } as any;

    await controller.create(request, 'agent-1', {
      scopes: ['sources:read'],
      pluginVersion: '0.1.0',
    });

    expect(installations.create).toHaveBeenCalledWith(
      'owner-1',
      'agent-1',
      ['sources:read'],
      '0.1.0',
      'http://localhost:3000/api',
    );
  });

  it.each(['production', 'staging', undefined])(
    'fails closed when PUBLIC_API_URL is absent in %p',
    (environment) => {
      config.get.mockImplementation((key: string) => (
        key === 'NODE_ENV' ? environment : undefined
      ));
      const request = { user: { userId: 'owner-1' } } as any;

      expect(() => controller.create(request, 'agent-1', {
        scopes: ['sources:read'],
        pluginVersion: '0.1.0',
      })).toThrow(InternalServerErrorException);
      expect(installations.create).not.toHaveBeenCalled();
    },
  );

  it('rejects a configured public API URL that is not absolute HTTP(S)', () => {
    config.get.mockImplementation((key: string) => (
      key === 'PUBLIC_API_URL' ? 'javascript:alert(1)' : 'production'
    ));
    const request = { user: { userId: 'owner-1' } } as any;

    expect(() => controller.create(request, 'agent-1', {
      scopes: ['sources:read'],
      pluginVersion: '0.1.0',
    })).toThrow(InternalServerErrorException);
    expect(installations.create).not.toHaveBeenCalled();
  });

  it('passes the request IP to the public exchange service', async () => {
    installations.exchange.mockResolvedValue({ credentialId: 'credential-1' });

    await controller.exchange({ ip: '192.0.2.10' } as any, { code: 'AW-CODE-12345' });

    expect(installations.exchange).toHaveBeenCalledWith('AW-CODE-12345', '192.0.2.10');
  });
});
