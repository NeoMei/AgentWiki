import { describe, expect, it, vi } from 'vitest';

import type { BootstrapInstallFn } from './coordinator.js';
import { createBootstrapInstaller, type BootstrapInstallerDeps } from './install.js';

function input(): Parameters<BootstrapInstallFn>[0] {
  return {
    onboardingToken: 'awo_test',
    serverBaseUrl: 'https://wiki.test/api',
    idempotencyKey: 'idem-1',
    serverPlan: {
      space: { mode: 'create', name: 'Space' }, agentName: 'Agent', permissionPreset: 'editor',
      approvalMode: 'always-review', packageVersion: '0.3.0',
    },
    serverPlanHash: 'hash-1',
    client: 'codex',
    connectionId: 'connection-1',
    home: '/tmp/home',
    expectedConfigHash: 'config-hash',
  };
}

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
          grant: { role: 'editor', scopes: ['pages:read'] },
          installation: { code: 'install-code', installationId: 'installation-1', expiresAt: '2026-08-11T01:00:00.000Z' },
        };
      }),
      archive: vi.fn(async () => { calls.push('archive'); return { archivePath: '/tmp/archive', movedChildren: ['legacy'] }; }),
      initialize: vi.fn(async () => { calls.push('initialize'); }),
      exchange: vi.fn(async () => {
        calls.push('exchange');
        return {
          apiKey: 'agk_test', agentId: 'agent-1', credentialId: 'credential-1', serverUrl: 'https://wiki.test/api',
          pluginVersion: '0.3.0', scopes: ['pages:read'],
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
      'bootstrap', 'archive', 'initialize', 'exchange', 'save-connection', 'install-skill',
      'install-client', 'verify-gateway', 'verify-access',
    ]);
  });

  it('rolls back client config and local state when gateway verification fails', async () => {
    const fixture = dependencies(false);
    const install = createBootstrapInstaller(fixture.deps);

    await expect(install(input())).rejects.toMatchObject({ code: 'MCP_HANDSHAKE_FAILED' });
    expect(fixture.calls).toContain('rollback-config');
    expect(fixture.calls).toContain('restore-state');
  });
});
