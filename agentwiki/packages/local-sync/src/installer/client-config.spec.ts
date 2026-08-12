import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  clientConfigPath,
  readRawConfig,
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
  if (tempHome) await rm(tempHome, { recursive: true, force: true });
  tempHome = '';
});

async function seedConfig(client: 'codex' | 'claude' | 'opencode', home: string, content: string): Promise<void> {
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
    await installGatewayEntry('opencode', 'conn-42', hash, home);
   const config = JSON.parse(await readFile(path, 'utf8')) as {
      mcp: { servers: Record<string, { command: string; args: string[] }> };
   };
    const entry = config.mcp.servers[GATEWAY_MCP_NAME];
    expect(entry.command).toBe('npx');
    expect(entry.args).toEqual([
      '--yes',
      '@neomei/agentwiki-local-sync@0.3.6',
      'gateway',
      '--connection',
      'conn-42',
    ]);
  });

  it('backs up the config at 0600', async () => {
    const home = await freshHome();
    await seedConfig('claude', home, '{"old":true}');
    const { backupPath } = await installGatewayEntry('claude', 'conn-1', hashConfig('{"old":true}'), home);
    const s = await stat(backupPath);
    expect(s.mode & 0o777).toBe(0o600);
  });

  it('resumes an identical install and keeps rollback bound to the original config', async () => {
    const home = await freshHome();
    const original = JSON.stringify({ mcpServers: { unrelated: { command: ['tool'] } } });
    await seedConfig('claude', home, original);
    const originalHash = hashConfig(original);
    await installGatewayEntry('claude', 'conn-1', originalHash, home);

    const resumed = await installGatewayEntry('claude', 'conn-1', originalHash, home);
    await resumed.rollback();

    await expect(readFile(clientConfigPath('claude', home), 'utf8')).resolves.toBe(original);
  });
});

describe('installGatewayEntry client formats', () => {
  it('writes Codex TOML with cmd string + args array (DEF-002)', async () => {
    const home = await freshHome();
    const { hash } = await analyzeConfig('codex', home);
    await installGatewayEntry('codex', 'conn-1', hash, home);
    const raw = await readFile(clientConfigPath('codex', home), 'utf8');
    expect(raw).toContain('[mcp_servers.agentwiki]');
    expect(raw).toMatch(/cmd = "npx"/);
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
      '--yes', '@neomei/agentwiki-local-sync@0.3.6', 'gateway', '--connection', 'conn-1',
    ]);
  });

  it('writes the Claude gateway to ~/.claude.json and cleans a legacy settings.json entry', async () => {
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
    expect(legacy.mcpServers['agentwiki-legacy']).toBeUndefined();
    expect(legacy.mcpServers.other).toBeDefined();
  });
});

describe('removeGatewayEntry', () => {
  it('removes the agentwiki gateway and preserves unrelated entries for all three clients (STOP-3PT-20260812-002)', async () => {
    for (const client of ['codex', 'claude', 'opencode'] as const) {
      const home = await freshHome();
      const { hash } = await analyzeConfig(client, home);
      await installGatewayEntry(client, 'conn-x', hash, home);

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
});
