import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, lstat, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import {
  clientConfigPath,
  clientSetupInstructions,
  readRawConfig,
  readWorkBuddyGatewayLaunch,
  installGatewayEntry,
  removeGatewayEntry,
  analyzeConfig,
} from './client-config.js';
import { GATEWAY_MCP_NAME, hashConfig } from './plan.js';

let tempHome = '';
async function freshHome(): Promise<string> {
  tempHome = await mkdtemp(join(tmpdir(), 'aw-cfg-'));
  return tempHome;
}
afterEach(async () => {
  vi.useRealTimers();
  if (tempHome) await rm(tempHome, { recursive: true, force: true });
  tempHome = '';
});

async function seedConfig(client: 'codex' | 'claude' | 'opencode' | 'workbuddy' | 'generic', home: string, content: string): Promise<void> {
  const path = clientConfigPath(client, home);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

describe('client-config paths', () => {
  it('locates each client config under an isolated home', async () => {
    const home = await freshHome();
    expect(clientConfigPath('codex', home)).toBe(join(home, '.codex', 'config.toml'));
    expect(clientConfigPath('claude', home)).toBe(join(home, '.claude.json'));
    expect(clientConfigPath('opencode', home)).toBe(join(home, '.config', 'opencode', 'opencode.json'));
  });
});

describe('readRawConfig', () => {
  it('returns null when absent', async () => {
    const home = await freshHome();
    expect(await readRawConfig('claude', home)).toBeNull();
  });
});

describe('analyzeConfig', () => {
  it.each(['claude', 'opencode'] as const)('rejects malformed %s JSON before confirmation', async (client) => {
    const home = await freshHome();
    await seedConfig(client, home, '{broken');

    await expect(analyzeConfig(client, home)).rejects.toThrow('CONFIG_NOT_WRITABLE');
  });

  it('rejects invalid JSON config containers before confirmation', async () => {
    const home = await freshHome();
    await seedConfig('claude', home, JSON.stringify({ mcpServers: [] }));

    await expect(analyzeConfig('claude', home)).rejects.toThrow('CONFIG_NOT_WRITABLE');
  });

  it('detects old AgentWiki entries in claude settings', async () => {
    const home = await freshHome();
    await seedConfig('claude', home, JSON.stringify({
      mcpServers: {
        'agentwiki-local': { command: ['npx', 'agentwiki-local-sync', 'mcp'] },
        'unrelated-tool': { command: ['npx', 'unrelated'] },
      },
    }));
    const analysis = await analyzeConfig('claude', home);
    expect(analysis.oldEntries).toContain('agentwiki-local');
    expect(analysis.oldEntries).not.toContain('unrelated-tool');
    expect(analysis.hasConflict).toBe(false);
  });

  it('flags an unknown agentwiki conflict', async () => {
    const home = await freshHome();
    await seedConfig('claude', home, JSON.stringify({
      mcpServers: {
        agentwiki: { command: ['npx', 'some-other-tool'] },
      },
    }));
    const analysis = await analyzeConfig('claude', home);
    expect(analysis.hasConflict).toBe(true);
  });

  it('migrates the current remote endpoint but preserves a similarly named third-party helper', async () => {
    const home = await freshHome();
    await seedConfig('claude', home, JSON.stringify({
      mcpServers: {
        'agentwiki-a1b2c3d4': { url: 'https://wiki.test/api/mcp' },
        'my-agentwiki-helper': { command: 'npx', args: ['@example/helper'] },
      },
    }));

    const analysis = await analyzeConfig('claude', home, 'https://wiki.test/api');

    expect(analysis.oldEntries).toEqual(['agentwiki-a1b2c3d4']);
    expect(analysis.oldEntries).not.toContain('my-agentwiki-helper');
  });

  it('analyzes OpenCode 1.x top-level MCP entries', async () => {
    const home = await freshHome();
    await seedConfig('opencode', home, JSON.stringify({
      mcp: {
        'agentwiki-local': { type: 'local', command: ['npx', 'agentwiki-local-sync', 'mcp'] },
        unrelated: { type: 'local', command: ['other-tool'] },
      },
    }));

    const analysis = await analyzeConfig('opencode', home);

    expect(analysis.oldEntries).toEqual(['agentwiki-local']);
    expect(analysis.hasConflict).toBe(false);
  });
});

describe('installGatewayEntry', () => {
  it('writes the gateway entry and produces a working rollback', async () => {
    const home = await freshHome();
    // Start with an old entry.
    await seedConfig('claude', home, JSON.stringify({ mcpServers: { 'agentwiki-local': { command: ['x'] } } }));
    const path = clientConfigPath('claude', home);
    const before = await readRawConfig('claude', home);
    const expectedHash = hashConfig(before!);

    const { rollback } = await installGatewayEntry('claude', 'conn-1', expectedHash, home);
    const after = JSON.parse(await readFile(path, 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(after.mcpServers[GATEWAY_MCP_NAME]).toBeDefined();
    expect(after.mcpServers['agentwiki-local']).toBeUndefined(); // old entry removed

    await rollback();
    const restored = await readFile(path, 'utf8');
    expect(restored).toBe(before);
  });

  it('aborts with CONFIG_CONFLICT on concurrent modification', async () => {
    const home = await freshHome();
    await seedConfig('claude', home, '{}');
    const staleHash = hashConfig('{}');

    // Simulate concurrent change.
    await seedConfig('claude', home, JSON.stringify({ other: true }));

    await expect(installGatewayEntry('claude', 'conn-1', staleHash, home)).rejects.toThrow(
      'CONFIG_CONFLICT',
    );
  });

  it('writes the exact pinned gateway command', async () => {
    const home = await freshHome();
    const path = clientConfigPath('opencode', home);
    const { hash } = await analyzeConfig('opencode', home);
    await installGatewayEntry('opencode', 'conn-42', hash, home, undefined, 1);
   const config = JSON.parse(await readFile(path, 'utf8')) as {
      mcp: Record<string, { type: string; command: string[]; enabled: boolean; timeout: number }>;
   };
    const entry = config.mcp[GATEWAY_MCP_NAME];
    expect(entry.command).toEqual([
      'npx',
      '--yes',
      '@neomei/agentwiki-local-sync@0.13.5',
      'gateway',
      '--connection',
      'conn-42',
    ]);
    expect(entry).toMatchObject({ type: 'local', enabled: true, timeout: 1_800_000 });
  });

  it('writes the OpenCode 2.x nested gateway shape', async () => {
    const home = await freshHome();
    const path = clientConfigPath('opencode', home);
    await seedConfig('opencode', home, JSON.stringify({
      mcp: {
        telemetry: { enabled: false },
        servers: { unrelated: { type: 'local', command: ['other-tool'] } },
      },
    }));
    const { hash } = await analyzeConfig('opencode', home);

    await installGatewayEntry('opencode', 'conn-v2', hash, home, undefined, 2);

    const config = JSON.parse(await readFile(path, 'utf8')) as {
      mcp: {
        telemetry?: { enabled: boolean };
        servers: Record<string, { command: string[]; disabled: boolean; timeout: { execution: number } }>;
      };
    };
    expect(config.mcp.servers.agentwiki).toEqual({
      type: 'local',
      command: ['npx', '--yes', '@neomei/agentwiki-local-sync@0.13.5', 'gateway', '--connection', 'conn-v2'],
      disabled: false,
      timeout: { execution: 1_800_000 },
    });
    expect(config.mcp).toMatchObject({ telemetry: { enabled: false } });
    expect(config.mcp.servers.unrelated).toBeDefined();
  });

  it('backs up the config at 0600', async () => {
    const home = await freshHome();
    await seedConfig('claude', home, '{"old":true}');
    const { backupPath } = await installGatewayEntry('claude', 'conn-1', hashConfig('{"old":true}'), home);
    const s = await stat(backupPath);
    if (process.platform !== 'win32') expect(s.mode & 0o777).toBe(0o600);
  });

  it('uses a no-op rollback when an identical gateway is already installed', async () => {
    const home = await freshHome();
    const original = JSON.stringify({ mcpServers: { unrelated: { command: ['tool'] } } });
    await seedConfig('claude', home, original);
    const originalHash = hashConfig(original);
    await installGatewayEntry('claude', 'conn-1', originalHash, home);
    const installed = await readFile(clientConfigPath('claude', home), 'utf8');

    const resumed = await installGatewayEntry('claude', 'conn-1', originalHash, home);
    await resumed.rollback();

    await expect(readFile(clientConfigPath('claude', home), 'utf8')).resolves.toBe(installed);
  });

  it('replaces the current direct MCP and preserves a similarly named helper', async () => {
    const home = await freshHome();
    const original = JSON.stringify({
      mcpServers: {
        'agentwiki-a1b2c3d4': { url: 'https://wiki.test/api/mcp' },
        'my-agentwiki-helper': { command: 'npx', args: ['@example/helper'] },
      },
    });
    await seedConfig('claude', home, original);

    await installGatewayEntry(
      'claude', 'conn-1', hashConfig(original), home, 'https://wiki.test/api',
    );

    const config = JSON.parse(await readFile(clientConfigPath('claude', home), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(config.mcpServers['agentwiki-a1b2c3d4']).toBeUndefined();
    expect(config.mcpServers['my-agentwiki-helper']).toBeDefined();
    expect(config.mcpServers.agentwiki).toBeDefined();
  });

  it('preserves a similarly named Codex TOML block while migrating the direct endpoint', async () => {
    const home = await freshHome();
    const original = [
      '[mcp_servers.my-agentwiki-helper]',
      'cmd = "helper"',
      '',
      '[mcp_servers.agentwiki-a1b2c3d4]',
      'url = "https://wiki.test/api/mcp"',
      '',
    ].join('\n');
    await seedConfig('codex', home, original);

    await installGatewayEntry(
      'codex', 'conn-1', hashConfig(original), home, 'https://wiki.test/api',
    );

    const config = await readFile(clientConfigPath('codex', home), 'utf8');
    expect(config).toContain('[mcp_servers.my-agentwiki-helper]');
    expect(config).not.toContain('[mcp_servers.agentwiki-a1b2c3d4]');
    expect(config).toContain('[mcp_servers.agentwiki]');
  });

  it('preserves non-MCP Codex sections that follow a migrated MCP block', async () => {
    const home = await freshHome();
    const original = [
      '[mcp_servers.agentwiki-old]',
      'url = "https://wiki.test/api/mcp"',
      '',
      '[projects."/workspace"]',
      'trust_level = "trusted"',
      '',
    ].join('\n');
    await seedConfig('codex', home, original);

    await installGatewayEntry(
      'codex', 'conn-1', hashConfig(original), home, 'https://wiki.test/api',
    );

    const config = await readFile(clientConfigPath('codex', home), 'utf8');
    expect(config).not.toContain('[mcp_servers.agentwiki-old]');
    expect(config).toContain('[projects."/workspace"]');
    expect(config).toContain('trust_level = "trusted"');
  });
});

describe('installGatewayEntry client formats', () => {
  it('writes Codex TOML with command string + args array', async () => {
    const home = await freshHome();
    const { hash } = await analyzeConfig('codex', home);
    await installGatewayEntry('codex', 'conn-1', hash, home);
    const raw = await readFile(clientConfigPath('codex', home), 'utf8');
    expect(raw).toContain('[mcp_servers.agentwiki]');
    expect(raw).toMatch(/command = "npx"/);
    expect(raw).not.toMatch(/\ncmd =/);
    expect(raw).toMatch(/args = \[/);
    expect(raw).toContain('"--yes"');
    expect(raw).toContain('"gateway"');
    expect(raw).toContain('"--connection"');
    expect(raw).toContain('"conn-1"');
  });

  it('writes Claude JSON with command string + args array (DEF-002)', async () => {
    const home = await freshHome();
    const { hash } = await analyzeConfig('claude', home);
    await installGatewayEntry('claude', 'conn-1', hash, home);
    const config = JSON.parse(await readFile(clientConfigPath('claude', home), 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    const entry = config.mcpServers[GATEWAY_MCP_NAME];
    expect(entry.command).toBe('npx');
    expect(entry.args).toEqual([
      '--yes', '@neomei/agentwiki-local-sync@0.13.5', 'gateway', '--connection', 'conn-1',
    ]);
  });

  it('writes the Claude gateway to ~/.claude.json without mutating untracked legacy settings', async () => {
    const home = await freshHome();
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({
      mcpServers: {
        'agentwiki-legacy': { command: 'npx', args: ['agentwiki-local-sync@0.3.6', 'mcp'] },
        other: { command: 'echo', args: ['ok'] },
      },
    }));
    const { hash } = await analyzeConfig('claude', home);
    await installGatewayEntry('claude', 'conn-1', hash, home);

    expect(clientConfigPath('claude', home)).toBe(join(home, '.claude.json'));
    const main = JSON.parse(await readFile(clientConfigPath('claude', home), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(main.mcpServers[GATEWAY_MCP_NAME]).toBeDefined();

    const legacy = JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(legacy.mcpServers['agentwiki-legacy']).toBeDefined();
    expect(legacy.mcpServers.other).toBeDefined();
  });
});

describe('removeGatewayEntry', () => {
  it('removes the agentwiki gateway and preserves unrelated entries for all three clients (STOP-3PT-20260812-002)', async () => {
    for (const client of ['codex', 'claude', 'opencode'] as const) {
      const home = await freshHome();
      const { hash } = await analyzeConfig(client, home);
      await installGatewayEntry(
        client, 'conn-x', hash, home, undefined, client === 'opencode' ? 1 : undefined,
      );

      // Install should have added the gateway entry.
      const before = await readRawConfig(client, home);
      expect(before).not.toBeNull();
      expect(before!).toContain('agentwiki');

      const result = await removeGatewayEntry(client, home);
      expect(result.removed).toBe(true);

      // Gateway entry is gone; the file no longer references the gateway.
      const after = await readRawConfig(client, home);
      expect(after).not.toBeNull();
      expect(after!.toLowerCase()).not.toContain('agentwiki-local-sync');
    }
  });

  it('preserves an unrelated MCP entry through install and uninstall round-trip', async () => {
    const home = await freshHome();
    const original = JSON.stringify({ mcpServers: { other: { command: 'tool', args: ['-x'] } } });
    await seedConfig('claude', home, original);

    await installGatewayEntry('claude', 'conn-1', hashConfig(original), home);
    const withGateway = JSON.parse(await readFile(clientConfigPath('claude', home), 'utf8')) as Record<string, unknown>;
    expect((withGateway.mcpServers as Record<string, unknown>).other).toBeDefined();
    expect((withGateway.mcpServers as Record<string, unknown>).agentwiki).toBeDefined();

    await removeGatewayEntry('claude', home);
    const restored = JSON.parse(await readFile(clientConfigPath('claude', home), 'utf8')) as Record<string, unknown>;
    expect((restored.mcpServers as Record<string, unknown>).other).toBeDefined();
    expect((restored.mcpServers as Record<string, unknown>).agentwiki).toBeUndefined();
  });

  it('returns removed=false when the config is absent', async () => {
    const home = await freshHome();
    const result = await removeGatewayEntry('claude', home);
    expect(result.removed).toBe(false);
  });

  it('does not uninstall an unknown command that later occupies the agentwiki name', async () => {
    const home = await freshHome();
    const original = JSON.stringify({
      mcpServers: { agentwiki: { command: 'npx', args: ['@example/unrelated'] } },
    });
    await seedConfig('claude', home, original);

    const result = await removeGatewayEntry('claude', home);

    expect(result.removed).toBe(false);
    await expect(readFile(clientConfigPath('claude', home), 'utf8')).resolves.toBe(original);
  });

  it('removes only the owned gateway and preserves legacy entries during uninstall', async () => {
    const home = await freshHome();
    await seedConfig('claude', home, JSON.stringify({
      mcpServers: {
        agentwiki: { command: 'npx', args: ['@neomei/agentwiki-local-sync@0.4.0', 'gateway'] },
        'agentwiki-legacy': { command: 'npx', args: ['agentwiki-local-sync@0.3.6', 'mcp'] },
      },
    }));

    await removeGatewayEntry('claude', home);

    const config = JSON.parse(await readFile(clientConfigPath('claude', home), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(config.mcpServers.agentwiki).toBeUndefined();
    expect(config.mcpServers['agentwiki-legacy']).toBeDefined();
  });

  it('uninstalls an owned OpenCode 1.x gateway without removing other entries', async () => {
    const home = await freshHome();
    await seedConfig('opencode', home, JSON.stringify({
      mcp: {
        agentwiki: { type: 'local', command: ['npx', '@neomei/agentwiki-local-sync@0.4.0', 'gateway'] },
        other: { type: 'local', command: ['other-tool'] },
      },
    }));

    await removeGatewayEntry('opencode', home);

    const config = JSON.parse(await readFile(clientConfigPath('opencode', home), 'utf8')) as {
      mcp: Record<string, unknown>;
    };
    expect(config.mcp.agentwiki).toBeUndefined();
    expect(config.mcp.other).toBeDefined();
  });
});


describe('standard MCP host integration', () => {
  it.each(['workbuddy', 'generic'] as const)('writes and backs up %s standard stdio config while preserving unrelated entries', async (client) => {
    const home = await freshHome();
    const expectedPath = client === 'workbuddy'
      ? join(home, '.workbuddy', 'mcp.json')
      : join(home, '.config', 'agentwiki', 'mcp.json');
    expect(clientConfigPath(client, home)).toBe(expectedPath);
    const original = JSON.stringify({ theme: 'dark', mcpServers: { unrelated: { command: 'other-tool', args: ['--safe'] } } });
    await seedConfig(client, home, original);
    const analysis = await analyzeConfig(client, home);
    const installed = await installGatewayEntry(client, 'conn-standard', analysis.hash, home);
    const config = JSON.parse(await readFile(expectedPath, 'utf8'));
    expect(config.theme).toBe('dark');
    expect(config.mcpServers.unrelated).toEqual({ command: 'other-tool', args: ['--safe'] });
    if (client === 'workbuddy') {
      expect(config.mcpServers.agentwiki.command).toBe(process.execPath);
      expect(config.mcpServers.agentwiki.args.slice(-5)).toEqual(['--yes', '@neomei/agentwiki-local-sync@0.13.5', 'gateway', '--connection', 'conn-standard']);
      expect(config.mcpServers.agentwiki.args[3]).toBe('--cache');
      expect(config.mcpServers.agentwiki.env.PATH.startsWith(`${dirname(process.execPath)}${delimiter}`)).toBe(true);
      await rm(config.mcpServers.agentwiki.args[4], { recursive: true });
    } else {
      expect(config.mcpServers.agentwiki).toEqual({ command: 'npx', args: ['--yes', '@neomei/agentwiki-local-sync@0.13.5', 'gateway', '--connection', 'conn-standard'] });
    }
    expect(await readFile(installed.backupPath, 'utf8')).toBe(original);
    if (process.platform !== 'win32') expect((await stat(expectedPath)).mode & 0o777).toBe(0o600);
    expect(await removeGatewayEntry(client, home)).toEqual({ removed: true });
    expect(JSON.parse(await readFile(expectedPath, 'utf8'))).toEqual(JSON.parse(original));
    await installed.rollback();
    expect(await readFile(expectedPath, 'utf8')).toBe(original);
  });

  it.each(['workbuddy', 'generic'] as const)('detects conflicts and invalid %s configuration before mutation', async (client) => {
    const home = await freshHome();
    await seedConfig(client, home, JSON.stringify({ mcpServers: { agentwiki: { command: 'other-tool' } } }));
    expect((await analyzeConfig(client, home)).hasConflict).toBe(true);
    await seedConfig(client, home, JSON.stringify({ mcpServers: [] }));
    await expect(analyzeConfig(client, home)).rejects.toThrow('CONFIG_NOT_WRITABLE');
  });

  it('labels generic configuration as an export requiring import, permission and host activation', async () => {
    const home = await freshHome();
    expect(clientSetupInstructions('generic', home)).toMatchObject({
      configPath: join(home, '.config', 'agentwiki', 'mcp.json'),
      configurationMode: 'manual-import',
      hostActivationRequired: true,
    });
    expect(clientSetupInstructions('generic', home).hostActivationSteps.join(' ')).toMatch(/导入/);
    expect(clientSetupInstructions('generic', home).hostActivationSteps.join(' ')).toMatch(/授权/);
    expect(clientSetupInstructions('generic', home).hostActivationSteps.join(' ')).toMatch(/重启/);
    const activation = clientSetupInstructions('generic', home).hostActivationSteps.join(' ');
    expect(activation).toContain('onboard_status');
    expect(activation).toContain('gateway');
    expect(activation).toContain('wiki_list_spaces');
    expect(activation).toContain('wiki_get_page');
    expect(activation).not.toContain('wiki_identity');
    expect(activation).toContain('历史安装记录');
    expect(clientSetupInstructions('workbuddy', home)).toMatchObject({ configurationMode: 'host-config', hostActivationRequired: true });
    expect(clientSetupInstructions('workbuddy', home).hostActivationSteps[0]).toContain('启动命令更新后');
    expect(clientSetupInstructions('workbuddy', home).hostActivationSteps[0]).toContain('自定义连接器');
  });
});


describe('gateway name ownership at commit', () => {
  it.each(['codex', 'claude', 'opencode', 'workbuddy', 'generic'] as const)('rejects an unrelated same-name %s server even with a confirmed current config hash', async (client) => {
    const home = await freshHome();
    const original = client === 'codex'
      ? '[mcp_servers.agentwiki]\ncommand = "unrelated-tool"\nargs = ["--serve"]\n'
      : JSON.stringify(client === 'opencode'
        ? { mcp: { agentwiki: { type: 'local', command: ['unrelated-tool', '--serve'] } } }
        : { mcpServers: { agentwiki: { command: 'unrelated-tool', args: ['--serve'] } } });
    await seedConfig(client, home, original);
    await expect(installGatewayEntry(client, 'conn-1', hashConfig(original), home, undefined, client === 'opencode' ? 1 : undefined)).rejects.toThrow('CONFIG_CONFLICT');
    expect(await readRawConfig(client, home)).toBe(original);
  });
});


describe('WorkBuddy retry runtime contract', () => {
  it('rejects an environment change when reading back the launch for verification', async () => {
    const home = await freshHome();
    await installGatewayEntry('workbuddy', 'conn-1', hashConfig(''), home);
    const config = JSON.parse((await readRawConfig('workbuddy', home))!);
    const cache = config.mcpServers.agentwiki.args[4];
    config.mcpServers.agentwiki.env.NODE_OPTIONS = '--require /unconfirmed.cjs';
    await seedConfig('workbuddy', home, JSON.stringify(config));
    try {
      await expect(readWorkBuddyGatewayLaunch(home, 'conn-1')).rejects.toThrow('CONFIG_CONFLICT');
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });

  it.each(['NODE_OPTIONS', 'CUSTOM_SETTING', 'entry', 'other-server'] as const)('rejects an unconfirmed %s change on a stale-hash retry without executing it', async (change) => {
    const home = await freshHome();
    const installed = await installGatewayEntry('workbuddy', 'conn-1', hashConfig(''), home);
    const config = JSON.parse((await readRawConfig('workbuddy', home))!);
    const cache = config.mcpServers.agentwiki.args[4];
    const marker = join(home, 'unconfirmed-options-ran');
    const preload = join(home, 'new-options.cjs');
    await writeFile(preload, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`);
    if (change === 'entry') config.mcpServers.agentwiki.disabled = true;
    else if (change === 'other-server') config.mcpServers.other = { command: 'other-tool' };
    else config.mcpServers.agentwiki.env[change] = change === 'NODE_OPTIONS' ? `--require ${JSON.stringify(preload)}` : 'unconfirmed';
    const changed = JSON.stringify(config);
    await seedConfig('workbuddy', home, changed);
    try {
      await expect(installGatewayEntry('workbuddy', 'conn-1', hashConfig(''), home)).rejects.toThrow('CONFIG_CONFLICT');
      expect(await readRawConfig('workbuddy', home)).toBe(changed);
      expect(await readFile(installed.backupPath, 'utf8')).toBe('');
      await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });

  it('binds retry to the matching confirmed hash and original backup rather than the oldest archive', async () => {
    const home = await freshHome();
    await mkdir(join(home, '.agentwiki-archive'));
    await writeFile(join(home, '.agentwiki-archive', 'workbuddy-000-old'), '{"old":true}');
    const original = '{"theme":"dark"}';
    await seedConfig('workbuddy', home, original);
    const installed = await installGatewayEntry('workbuddy', 'conn-1', hashConfig(original), home);
    const saved = (await readRawConfig('workbuddy', home))!;
    const cache = JSON.parse(saved).mcpServers.agentwiki.args[4];
    try {
      await expect(installGatewayEntry('workbuddy', 'conn-1', hashConfig('unconfirmed'), home)).rejects.toThrow('CONFIG_CONFLICT');
      const retry = await installGatewayEntry('workbuddy', 'conn-1', hashConfig(original), home);
      expect(retry.backupPath).toBe(installed.backupPath);
      await writeFile(installed.backupPath, '{"backup":"changed"}');
      await expect(installGatewayEntry('workbuddy', 'conn-1', hashConfig(original), home)).rejects.toThrow('CONFIG_CONFLICT');
      expect(await readRawConfig('workbuddy', home)).toBe(saved);
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });

  it('does not write the client config when the private installation receipt cannot be written', async () => {
    const home = await freshHome();
    const original = JSON.stringify({ mcpServers: { agentwiki: {
      command: 'npx', args: ['@neomei/agentwiki-local-sync@0.13.5', 'gateway'], env: { TMPDIR: home, TMP: home, TEMP: home },
    } } });
    await seedConfig('workbuddy', home, original);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T00:00:00.000Z'));
    const receipt = join(home, '.agentwiki-archive', 'workbuddy-2026-10-19T000000000Z.gateway-install.json');
    await mkdir(receipt, { recursive: true });
    await expect(installGatewayEntry('workbuddy', 'conn-1', hashConfig(original), home)).rejects.toThrow();
    expect(await readRawConfig('workbuddy', home)).toBe(original);
  });

  it('does not accept the old bare-npx command as an already completed installation', async () => {
    const home = await freshHome();
    await seedConfig('workbuddy', home, JSON.stringify({ mcpServers: { agentwiki: {
      command: 'npx', args: ['--yes', '@neomei/agentwiki-local-sync@0.13.5', 'gateway', '--connection', 'conn-1'],
    } } }));
    await mkdir(join(home, '.agentwiki-archive'));
    await writeFile(join(home, '.agentwiki-archive', 'workbuddy-original'), '{}');
    await expect(installGatewayEntry('workbuddy', 'conn-1', hashConfig('{}'), home)).rejects.toThrow('CONFIG_CONFLICT');
  });

  it.skipIf(process.platform === 'win32')('does not execute a changed unconfirmed command while checking a retry', async () => {
    const home = await freshHome();
    await installGatewayEntry('workbuddy', 'conn-1', hashConfig(''), home);
    const entry = JSON.parse((await readRawConfig('workbuddy', home))!).mcpServers.agentwiki;
    const cache = entry.args[4];
    const marker = join(home, 'unconfirmed-command-ran');
    const malicious = join(home, 'node');
    await writeFile(malicious, `#!/bin/sh\ntouch '${marker}'\necho v24.18.0\n`, { mode: 0o755 });
    entry.command = malicious;
    entry.env.PATH = `${home}${delimiter}${process.env.PATH}`;
    await seedConfig('workbuddy', home, JSON.stringify({ mcpServers: { agentwiki: entry } }));
    await expect(installGatewayEntry('workbuddy', 'conn-1', hashConfig(''), home)).rejects.toThrow('CONFIG_CONFLICT');
    await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(cache, { recursive: true });
  });

  it('checks a stale-hash retry without recreating or writing the saved disposable cache', async () => {
    const home = await freshHome();
    await installGatewayEntry('workbuddy', 'conn-1', hashConfig(''), home);
    const entry = JSON.parse((await readRawConfig('workbuddy', home))!).mcpServers.agentwiki;
    const cache = entry.args[4];
    await rm(cache, { recursive: true });
    await installGatewayEntry('workbuddy', 'conn-1', hashConfig(''), home);
    await expect(lstat(cache)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves existing entry environment and reuses the exact saved runtime and original backup', async () => {
    const home = await freshHome();
    const original = JSON.stringify({ mcpServers: { agentwiki: {
      command: 'npx', args: ['--yes', '@neomei/agentwiki-local-sync@0.13.5', 'gateway', '--connection', 'conn-1'],
      env: { CUSTOM_SETTING: 'keep me', NODE_OPTIONS: '--no-warnings', PATH: '/custom/bin' },
    } } });
    await seedConfig('workbuddy', home, original);
    const installed = await installGatewayEntry('workbuddy', 'conn-1', hashConfig(original), home);
    const saved = (await readRawConfig('workbuddy', home))!;
    const entry = JSON.parse(saved).mcpServers.agentwiki;
    expect(entry.env).toEqual({ CUSTOM_SETTING: 'keep me', NODE_OPTIONS: '--no-warnings', PATH: `${dirname(process.execPath)}${delimiter}/custom/bin` });
    const retry = await installGatewayEntry('workbuddy', 'conn-1', hashConfig(original), home);
    expect(retry.backupPath).toBe(installed.backupPath);
    await retry.rollback();
    expect(await readRawConfig('workbuddy', home)).toBe(saved);
    expect(await readFile(installed.backupPath, 'utf8')).toBe(original);
    await installed.rollback();
    expect(await readRawConfig('workbuddy', home)).toBe(original);
    await rm(entry.args[4], { recursive: true });
  });
});
