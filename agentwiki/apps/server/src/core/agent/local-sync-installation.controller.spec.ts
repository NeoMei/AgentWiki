import { InternalServerErrorException } from '@nestjs/common';
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
    expect((controller as any).createForAgent).toBeUndefined();
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

  it('uses the configured canonical public API URL without a trailing slash', async () => {
    config.get.mockImplementation((key: string) => (
      key === 'PUBLIC_API_URL' ? 'https://wiki.test/api/' : 'production'
    ));
    installations.create.mockResolvedValue({ installationId: 'install-1' });
    const request = { user: { userId: 'owner-1' } } as any;

    await controller.create(request, 'agent-1', {
      spaceId: 'space-1',
      role: 'editor',
      pluginVersion: '0.6.1',
    });

    expect(installations.create).toHaveBeenCalledWith(
      'owner-1',
      'agent-1',
      'space-1',
      'editor',
      '0.6.1',
      'https://wiki.test/api',
      false,
    );
  });

  it('forwards platform Super Admin status when creating an installation', async () => {
    config.get.mockImplementation((key: string) => (
      key === 'PUBLIC_API_URL' ? 'https://wiki.test/api' : 'production'
    ));
    const request = { user: { userId: 'owner-1', platformRole: 'super_admin' } } as any;

    await controller.create(request, 'agent-1', {
      spaceId: 'space-1', role: 'editor', pluginVersion: '0.6.1',
    });

    expect(installations.create).toHaveBeenCalledWith(
      'owner-1', 'agent-1', 'space-1', 'editor', '0.6.1',
      'https://wiki.test/api', true,
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
      spaceId: 'space-1',
      role: 'reader',
      pluginVersion: '0.6.1',
    });

    expect(installations.create).toHaveBeenCalledWith(
      'owner-1',
      'agent-1',
      'space-1',
      'reader',
      '0.6.1',
      'http://localhost:3000/api',
      false,
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
        spaceId: 'space-1', role: 'reader', pluginVersion: '0.6.1',
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
      spaceId: 'space-1', role: 'reader', pluginVersion: '0.6.1',
    })).toThrow(InternalServerErrorException);
    expect(installations.create).not.toHaveBeenCalled();
  });

  it('passes the request IP to the public exchange service', async () => {
    installations.exchange.mockResolvedValue({ credentialId: 'credential-1' });

    await controller.exchange({ ip: '192.0.2.10' } as any, { code: 'AW-CODE-12345' });

    expect(installations.exchange).toHaveBeenCalledWith('AW-CODE-12345', '192.0.2.10');
  });
});
