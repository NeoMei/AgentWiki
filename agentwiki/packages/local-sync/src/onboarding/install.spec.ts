import { describe, expect, it, vi } from 'vitest';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';

import type { BootstrapInstallFn } from './coordinator.js';
import {
  createBootstrapInstaller,
  installExchangedGateway,
  type BootstrapInstallerDeps,
} from './install.js';

function input(): Parameters<BootstrapInstallFn>[0] {
  return {
    onboardingToken: 'awo_test',
    serverBaseUrl: 'https://wiki.test/api',
    idempotencyKey: 'idem-1',
    serverPlan: {
      space: { mode: 'create', name: 'Space' }, agentName: 'Agent', role: 'editor',
      packageVersion: '0.5.0',
    },
    serverPlanHash: 'hash-1',
    client: 'codex',
    connectionId: 'connection-1',
    home: '/tmp/home',
    expectedConfigHash: 'config-hash',
  };
}

const EDITOR_SCOPES = scopesForAgentAccessRole('editor');

function dependencies(verifyOk = true): { deps: BootstrapInstallerDeps; calls: string[]; rollback: ReturnType<typeof vi.fn> } {
  const calls: string[] = [];
  const rollback = vi.fn(async () => { calls.push('rollback-config'); });
  return {
    calls,
    rollback,
    deps: {
      bootstrap: vi.fn(async () => {
        calls.push('bootstrap');
        return {
          space: { id: 'space-1', name: 'Space' }, agent: { id: 'agent-1', name: 'Agent' },
          grant: { role: 'editor' as const, scopes: EDITOR_SCOPES },
          installation: { code: 'install-code', installationId: 'installation-1', expiresAt: '2026-08-11T01:00:00.000Z' },
        };
      }),
      loadExisting: vi.fn(async () => null),
      archive: vi.fn(async () => { calls.push('archive'); return { archivePath: '/tmp/archive', movedChildren: ['legacy'] }; }),
      initialize: vi.fn(async () => { calls.push('initialize'); }),
      exchange: vi.fn(async () => {
        calls.push('exchange');
        return {
          apiKey: 'agk_test', agentId: 'agent-1', credentialId: 'credential-1', serverUrl: 'https://wiki.test/api',
          pluginVersion: '0.5.0' as const, scopes: EDITOR_SCOPES, role: 'editor' as const, spaceId: 'space-1',
        };
      }),
      saveConnection: vi.fn(async () => { calls.push('save-connection'); }),
      installSkill: vi.fn(async () => { calls.push('install-skill'); }),
      installClient: vi.fn(async () => { calls.push('install-client'); return { backupPath: '/tmp/config-backup', rollback }; }),
      verify: vi.fn(async () => {
        calls.push('verify-gateway');
        return { ok: verifyOk, toolNames: ['onboard_status'], manifestHash: 'manifest-hash', errors: verifyOk ? [] : ['failed'] };
      }),
      verifyAccess: vi.fn(async () => { calls.push('verify-access'); }),
      revokeCredential: vi.fn(async () => { calls.push('revoke-credential'); }),
      restore: vi.fn(async () => { calls.push('restore-state'); }),
    },
  };
}

describe('createBootstrapInstaller', () => {
  it('activates the confirmed gateway and verifies both MCP and remote access', async () => {
    const fixture = dependencies();
    const install = createBootstrapInstaller(fixture.deps);

    const result = await install(input());

    expect(result).toMatchObject({
      reloadRequired: false,
      configBackupPath: '/tmp/config-backup',
      manifestHash: 'manifest-hash',
      bootstrap: { space: { id: 'space-1' }, agent: { id: 'agent-1' } },
    });
    expect(fixture.calls).toEqual([
      'bootstrap', 'exchange', 'archive', 'initialize', 'save-connection', 'install-skill',
      'install-client', 'verify-gateway', 'verify-access',
    ]);
  });

  it('rolls back client config and local state when gateway verification fails', async () => {
    const fixture = dependencies(false);
    const install = createBootstrapInstaller(fixture.deps);

    await expect(install(input())).rejects.toMatchObject({ code: 'MCP_HANDSHAKE_FAILED' });
    expect(fixture.calls).toContain('rollback-config');
    expect(fixture.calls).toContain('revoke-credential');
    expect(fixture.calls).toContain('restore-state');
  });

  it('resumes after credential exchange without archiving or exchanging a second time', async () => {
    const fixture = dependencies();
    fixture.deps.loadExisting = vi.fn(async () => ({
      connection: {
        id: 'connection-1', serverUrl: 'https://wiki.test/api', agentId: 'agent-1', credentialId: 'credential-1',
        pluginVersion: '0.5.0', client: 'codex' as const, mcpName: 'agentwiki',
      },
      apiKey: 'agk_existing',
    }));
    const install = createBootstrapInstaller(fixture.deps);

    await install(input());

    expect(fixture.deps.archive).not.toHaveBeenCalled();
    expect(fixture.deps.exchange).not.toHaveBeenCalled();
    expect(fixture.deps.saveConnection).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual(['bootstrap', 'install-client', 'verify-gateway', 'verify-access']);
    expect(fixture.deps.verifyAccess).toHaveBeenCalledWith(
      expect.anything(),
      'agk_existing',
      { agentId: 'agent-1', spaceId: 'space-1', role: 'editor', scopes: EDITOR_SCOPES },
    );
  });

  it.each([
    ['spaceId', 'space-other'],
    ['role', 'reader'],
  ] as const)('rejects a fresh exchange whose %s differs from the confirmed plan', async (field, value) => {
    const fixture = dependencies();
    vi.mocked(fixture.deps.exchange).mockResolvedValue({
      apiKey: 'agk_test', agentId: 'agent-1', credentialId: 'credential-1', serverUrl: 'https://wiki.test/api',
      pluginVersion: '0.5.0', scopes: EDITOR_SCOPES, role: 'editor', spaceId: 'space-1',
      [field]: value,
    });

    await expect(createBootstrapInstaller(fixture.deps)(input()))
      .rejects.toMatchObject({ code: 'PACKAGE_INTEGRITY_FAILED' });

    expect(fixture.deps.saveConnection).not.toHaveBeenCalled();
  });

  it('rejects a replay bootstrap whose Space differs from the confirmed existing-Space plan', async () => {
    const fixture = dependencies();
    const replayInput = {
      ...input(),
      serverPlan: {
        ...input().serverPlan,
        space: { mode: 'existing' as const, id: 'space-confirmed' },
      },
    };

    await expect(createBootstrapInstaller(fixture.deps)(replayInput))
      .rejects.toMatchObject({ code: 'PACKAGE_INTEGRITY_FAILED' });

    expect(fixture.deps.loadExisting).not.toHaveBeenCalled();
    expect(fixture.deps.exchange).not.toHaveBeenCalled();
  });
});

describe('installExchangedGateway', () => {
  const exchanged = {
    apiKey: 'agk_attach_secret',
    agentId: 'agent-1',
    credentialId: 'credential-1',
    serverUrl: 'https://wiki.test/api',
    pluginVersion: '0.5.0' as const,
    scopes: EDITOR_SCOPES,
    role: 'editor' as const,
    spaceId: 'space-1',
  };

  it.each([
    ['spaceId', 'space-other'],
    ['role', 'reader'],
    ['scopes', scopesForAgentAccessRole('reader')],
  ] as const)('rejects an exchanged package with mismatched %s before local mutation', async (field, value) => {
    const fixture = dependencies();

    await expect(installExchangedGateway({
      home: '/tmp/home',
      client: 'codex',
      connectionId: 'connection-1',
      expectedConfigHash: 'config-hash',
      expectedAgentId: 'agent-1',
      expectedSpaceId: 'space-1',
      expectedRole: 'editor',
      expectedScopes: EDITOR_SCOPES,
      expectedPluginVersion: '0.5.0',
      exchange: { ...exchanged, [field]: value },
    }, fixture.deps)).rejects.toMatchObject({ code: 'PACKAGE_INTEGRITY_FAILED' });

    expect(fixture.deps.archive).not.toHaveBeenCalled();
  });

  it('persists and verifies the exchanged credential behind one agentwiki gateway', async () => {
    const fixture = dependencies();

    const result = await installExchangedGateway({
      home: '/tmp/home',
      client: 'codex',
      connectionId: 'connection-1',
      expectedConfigHash: 'config-hash',
      expectedAgentId: 'agent-1',
      expectedSpaceId: 'space-1',
      expectedRole: 'editor',
      expectedScopes: EDITOR_SCOPES,
      expectedPluginVersion: '0.5.0',
      exchange: exchanged,
    }, fixture.deps);

    expect(result).toMatchObject({
      connection: {
        id: 'connection-1', agentId: 'agent-1', credentialId: 'credential-1',
        pluginVersion: '0.5.0', client: 'codex', mcpName: 'agentwiki',
      },
      configBackupPath: '/tmp/config-backup',
      manifestHash: 'manifest-hash',
    });
    expect(fixture.calls).toEqual([
      'archive', 'initialize', 'save-connection', 'install-skill',
      'install-client', 'verify-gateway', 'verify-access',
    ]);
  });

  it('replays an exchanged installation without archiving or replacing active local state', async () => {
    const fixture = dependencies();
    fixture.deps.loadExisting = vi.fn(async () => ({
      connection: {
        id: 'connection-1', serverUrl: 'https://wiki.test/api', agentId: 'agent-1',
        credentialId: 'credential-1', pluginVersion: '0.5.0', client: 'codex' as const,
        mcpName: 'agentwiki',
      },
      apiKey: 'agk_attach_secret',
    }));

    await installExchangedGateway({
      home: '/tmp/home',
      client: 'codex',
      connectionId: 'connection-1',
      expectedConfigHash: 'config-hash',
      expectedAgentId: 'agent-1',
      expectedSpaceId: 'space-1',
      expectedRole: 'editor',
      expectedScopes: EDITOR_SCOPES,
      expectedPluginVersion: '0.5.0',
      exchange: exchanged,
    }, fixture.deps);

    expect(fixture.deps.archive).not.toHaveBeenCalled();
    expect(fixture.deps.initialize).not.toHaveBeenCalled();
    expect(fixture.deps.saveConnection).not.toHaveBeenCalled();
    expect(fixture.deps.installSkill).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual(['install-client', 'verify-gateway', 'verify-access']);
  });

  it('restores config and local state and revokes the credential when verification fails', async () => {
    const fixture = dependencies(false);

    await expect(installExchangedGateway({
      home: '/tmp/home',
      client: 'codex',
      connectionId: 'connection-1',
      expectedConfigHash: 'config-hash',
      expectedAgentId: 'agent-1',
      expectedSpaceId: 'space-1',
      expectedRole: 'editor',
      expectedScopes: EDITOR_SCOPES,
      expectedPluginVersion: '0.5.0',
      exchange: exchanged,
    }, fixture.deps)).rejects.toMatchObject({ code: 'MCP_HANDSHAKE_FAILED' });

    expect(fixture.calls).toContain('rollback-config');
    expect(fixture.calls).toContain('revoke-credential');
    expect(fixture.calls).toContain('restore-state');
  });

  it('reports the credential id when rollback cannot revoke it', async () => {
    const fixture = dependencies(false);
    vi.mocked(fixture.deps.revokeCredential).mockRejectedValue(new Error('network unavailable'));

    await expect(installExchangedGateway({
      home: '/tmp/home',
      client: 'codex',
      connectionId: 'connection-1',
      expectedConfigHash: 'config-hash',
      expectedAgentId: 'agent-1',
      expectedSpaceId: 'space-1',
      expectedRole: 'editor',
      expectedScopes: EDITOR_SCOPES,
      expectedPluginVersion: '0.5.0',
      exchange: exchanged,
    }, fixture.deps)).rejects.toMatchObject({
      code: 'SYNC_FAILED',
      nextAction: expect.stringContaining('credential-1'),
      message: expect.stringContaining('credential-1'),
    });

    expect(fixture.calls).toContain('restore-state');
  });

  it('reports configuration and local-state cleanup failures explicitly', async () => {
    const fixture = dependencies(false);
    fixture.rollback.mockRejectedValue(new Error('rollback unavailable'));
    vi.mocked(fixture.deps.restore).mockRejectedValue(new Error('restore unavailable'));

    await expect(installExchangedGateway({
      home: '/tmp/home',
      client: 'codex',
      connectionId: 'connection-1',
      expectedConfigHash: 'config-hash',
      expectedAgentId: 'agent-1',
      expectedSpaceId: 'space-1',
      expectedRole: 'editor',
      expectedScopes: EDITOR_SCOPES,
      expectedPluginVersion: '0.5.0',
      exchange: exchanged,
    }, fixture.deps)).rejects.toMatchObject({
      code: 'SYNC_FAILED',
      message: expect.stringContaining('client configuration rollback'),
      nextAction: expect.stringContaining('local state restore'),
    });
  });

  it('reports a replay rollback failure instead of swallowing it', async () => {
    const fixture = dependencies();
    fixture.deps.loadExisting = vi.fn(async () => ({
      connection: {
        id: 'connection-1', serverUrl: 'https://wiki.test/api', agentId: 'agent-1',
        credentialId: 'credential-1', pluginVersion: '0.5.0', client: 'codex' as const,
        mcpName: 'agentwiki',
      },
      apiKey: 'agk_attach_secret',
    }));
    fixture.deps.verify = vi.fn(async () => ({
      ok: false, toolNames: [], manifestHash: 'manifest-hash', errors: ['failed'],
    }));
    fixture.rollback.mockRejectedValue(new Error('rollback unavailable'));

    await expect(installExchangedGateway({
      home: '/tmp/home',
      client: 'codex',
      connectionId: 'connection-1',
      expectedConfigHash: 'config-hash',
      expectedAgentId: 'agent-1',
      expectedSpaceId: 'space-1',
      expectedRole: 'editor',
      expectedScopes: EDITOR_SCOPES,
      expectedPluginVersion: '0.5.0',
      exchange: exchanged,
    }, fixture.deps)).rejects.toMatchObject({
      code: 'SYNC_FAILED',
      message: expect.stringContaining('client configuration rollback'),
      nextAction: expect.stringContaining('backup'),
    });
  });
});
