import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkBuddyGatewayLaunch } from '../installer/workbuddy-runtime.js';
import { clientConfigPath } from '../installer/client-config.js';
import { staticToolNames } from '../gateway/manifest.js';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';

import type { BootstrapInstallFn } from './coordinator.js';
import {
  createBootstrapInstaller,
  gatewayVerificationCommand,
  installExchangedGateway,
  productionDependencies,
  type BootstrapInstallerDeps,
} from './install.js';

describe('gatewayVerificationCommand', () => {
  it('runs the packaged CLI with Node instead of spawning npx on Windows', () => {
    const cliFile = 'C:\\npm-cache\\agentwiki\\dist\\cli.js';

    expect(gatewayVerificationCommand('connection-1', cliFile)).toEqual([
      process.execPath,
      cliFile,
      'gateway',
      '--connection',
      'connection-1',
    ]);
  });
});

function input(): Parameters<BootstrapInstallFn>[0] {
  return {
    onboardingToken: 'awo_test',
    serverBaseUrl: 'https://wiki.test/api',
    idempotencyKey: 'idem-1',
    serverPlan: {
      space: { mode: 'create', name: 'Space' }, agentName: 'Agent', role: 'editor',
      packageVersion: '0.13.4',
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
          pluginVersion: '0.13.4' as const, scopes: EDITOR_SCOPES, role: 'editor' as const, spaceId: 'space-1',
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
        pluginVersion: '0.13.4', client: 'codex' as const, mcpName: 'agentwiki',
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
      pluginVersion: '0.13.4', scopes: EDITOR_SCOPES, role: 'editor', spaceId: 'space-1',
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

  it.each([
    ['created Space name', { space: { id: 'space-1', name: 'Different Space' } }],
    ['Agent name', { agent: { id: 'agent-1', name: 'Different Agent' } }],
  ] as const)('rejects a bootstrap whose %s differs from the confirmed plan', async (_label, mismatch) => {
    const fixture = dependencies();
    vi.mocked(fixture.deps.bootstrap).mockResolvedValue({
      space: { id: 'space-1', name: 'Space' },
      agent: { id: 'agent-1', name: 'Agent' },
      grant: { role: 'editor', scopes: EDITOR_SCOPES },
      installation: { code: 'install-code', installationId: 'installation-1', expiresAt: '2026-08-11T01:00:00.000Z' },
      ...mismatch,
    });

    await expect(createBootstrapInstaller(fixture.deps)(input()))
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
    pluginVersion: '0.13.4' as const,
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
      expectedPluginVersion: '0.13.4',
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
      expectedPluginVersion: '0.13.4',
      exchange: exchanged,
    }, fixture.deps);

    expect(result).toMatchObject({
      connection: {
        id: 'connection-1', agentId: 'agent-1', credentialId: 'credential-1',
        pluginVersion: '0.13.4', client: 'codex', mcpName: 'agentwiki',
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
        credentialId: 'credential-1', pluginVersion: '0.13.4', client: 'codex' as const,
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
      expectedPluginVersion: '0.13.4',
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
      expectedPluginVersion: '0.13.4',
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
      expectedPluginVersion: '0.13.4',
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
      expectedPluginVersion: '0.13.4',
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
        credentialId: 'credential-1', pluginVersion: '0.13.4', client: 'codex' as const,
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
      expectedPluginVersion: '0.13.4',
      exchange: exchanged,
    }, fixture.deps)).rejects.toMatchObject({
      code: 'SYNC_FAILED',
      message: expect.stringContaining('client configuration rollback'),
      nextAction: expect.stringContaining('backup'),
    });
  });
});

describe('resumable connection installation', () => {
  it('retains configured credentials on verification failure and records the configured checkpoint', async () => {
    const fixture = dependencies(false);
    const configured = vi.fn(async () => undefined);
    const exchange = await fixture.deps.exchange('https://wiki.test/api','install-code');
    await expect(installExchangedGateway({home:'/tmp/home',client:'codex',connectionId:'connection-1',expectedConfigHash:'hash',expectedAgentId:'agent-1',expectedSpaceId:'space-1',expectedRole:'editor',expectedScopes:EDITOR_SCOPES,expectedPluginVersion:'0.13.4',exchange,retainOnFailure:true,onConfigured:configured},fixture.deps)).rejects.toMatchObject({code:'MCP_HANDSHAKE_FAILED'});
    expect(configured).toHaveBeenCalledOnce();
    expect(fixture.calls).not.toContain('revoke-credential');
    expect(fixture.calls).not.toContain('restore-state');
    expect(fixture.calls).not.toContain('rollback-config');
  });
});


it.each(['workbuddy', 'generic'] as const)('requires host reload for %s after independent gateway verification', async (client) => {
  const fixture = dependencies();
  const result = await createBootstrapInstaller(fixture.deps)({ ...input(), client });
  expect(result.reloadRequired).toBe(true);
});


it('verifies the saved WorkBuddy runtime, npm arguments and env rather than bypassing npm with the current CLI', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aw-workbuddy-verifier-'));
  let cache: string | undefined;
  let initialCache: string | undefined;
  const deadlines = vi.spyOn(globalThis, 'setTimeout');
  try {
    const launch = await createWorkBuddyGatewayLaunch('conn-installed', { env: {
      CAPTURE_FILE: join(home, 'captured.json'), NODE_OPTIONS: '--no-warnings', CUSTOM_SETTING: 'retained',
    } });
    initialCache = launch.args[4];
    // Substitute only the external npm boundary; the saved Node/inline command, argv and env run for real.
    const preload = join(home, 'npm-boundary.cjs');
    await writeFile(preload, `
      const Module = require('node:module');
      const original = Module._load;
      Module._load = function(request, ...args) {
        if (request !== ${JSON.stringify(launch.args[2])} || !process.argv.includes('gateway')) return original.call(this, request, ...args);
        require('node:fs').writeFileSync(process.env.CAPTURE_FILE, JSON.stringify({ args: process.argv.slice(2), nodeOptions: process.env.NODE_OPTIONS, custom: process.env.CUSTOM_SETTING, path: process.env.PATH, home: process.env.HOME }));
        require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
          const request = JSON.parse(line);
          if (request.method === 'tools/list') console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: ${JSON.stringify(staticToolNames().map((name) => ({ name })))} } }));
        });
      };
    `);
    launch.env.NODE_OPTIONS += ` --require ${JSON.stringify(preload)}`;
    await mkdir(join(home, '.workbuddy'));
    const confirmed = JSON.stringify({ mcpServers: { agentwiki: launch } });
    await writeFile(clientConfigPath('workbuddy', home), confirmed);
    const { installGatewayEntry } = await import('../installer/client-config.js');
    const { hashConfig } = await import('../installer/plan.js');
    await installGatewayEntry('workbuddy', 'conn-installed', hashConfig(confirmed), home);
    const saved = JSON.parse(await readFile(clientConfigPath('workbuddy', home), 'utf8')).mcpServers.agentwiki;
    cache = saved.args[4];

    const result = await productionDependencies().verify('conn-installed', home, 'workbuddy');

    expect(result.ok).toBe(true);
    expect(deadlines).toHaveBeenCalledWith(expect.any(Function), 180_000);
    expect(JSON.parse(await readFile(join(home, 'captured.json'), 'utf8'))).toEqual({
      args: ['--cache', cache, '--yes', '@neomei/agentwiki-local-sync@0.13.4', 'gateway', '--connection', 'conn-installed'],
      nodeOptions: saved.env.NODE_OPTIONS, custom: 'retained', path: saved.env.PATH, home,
    });
  } finally {
    deadlines.mockRestore();
    await rm(home, { recursive: true, force: true });
    if (cache) await rm(cache, { recursive: true, force: true });
    if (initialCache) await rm(initialCache, { recursive: true, force: true });
  }
});
