import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  detectClient,
  installSkill,
  registerMcp,
  removeMcp,
  type CommandResult,
  type CommandRunner,
} from './agent-clients.js';

const homes: string[] = [];
type OpenCodeConfig = {
  theme?: string;
  mcp: Record<string, unknown> & { servers?: Record<string, unknown> };
};

async function createHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'agentwiki-local-sync-agent-'));
  homes.push(home);
  return home;
}

async function writeOpenCodeConfig(home: string, contents: string): Promise<string> {
  const path = join(home, '.config', 'opencode', 'opencode.json');
  await mkdir(join(home, '.config', 'opencode'), { recursive: true });
  await writeFile(path, contents);
  return path;
}

function result(stdout = '', status = 0): CommandResult {
  return { status, stdout, stderr: '' };
}

function runnerWithOpenCodeVersion(version: string): ReturnType<typeof vi.fn<CommandRunner>> {
  return vi.fn<CommandRunner>((command, args) => (
    command === 'opencode' && args[0] === '--version' ? result(version) : result()
  ));
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('agent client adapters', () => {
  it('uses exact-version Codex stdio commands without credentials', async () => {
    const home = await createHome();
    const runner = vi.fn<CommandRunner>(() => result());

    await registerMcp('codex', 'agentwiki-local-a1', 'connection-1', '0.1.0', runner, home);

    expect(runner).toHaveBeenCalledWith('codex', [
      'mcp', 'add', 'agentwiki-local-a1', '--', 'npx', '-y',
      '@neomei/agentwiki-local-sync@0.1.0', 'mcp', '--connection', 'connection-1', '--orchestrator',
    ], { stdio: 'pipe' });
    expect(JSON.stringify(runner.mock.calls)).not.toContain('agk_');
  });

  it('uses Claude user scope', async () => {
    const home = await createHome();
    const runner = vi.fn<CommandRunner>(() => result());

    await registerMcp('claude', 'agentwiki-local-a1', 'connection-1', '0.1.0', runner, home);

    expect(runner).toHaveBeenCalledWith('claude', expect.arrayContaining(['--scope', 'user']), expect.anything());
  });

  it('uses Claude user scope when removing an MCP connection', async () => {
    const home = await createHome();
    const runner = vi.fn<CommandRunner>(() => result());

    await removeMcp('claude', 'agentwiki-local-a1', runner, home);

    expect(runner).toHaveBeenCalledWith(
      'claude',
      ['mcp', 'remove', '--scope', 'user', 'agentwiki-local-a1'],
      expect.anything(),
    );
  });

  it('patches only its OpenCode v1 MCP entry and preserves unrelated config', async () => {
    const home = await createHome();
    const runner = runnerWithOpenCodeVersion('1.18.7');
    const configPath = await writeOpenCodeConfig(home, JSON.stringify({
      theme: 'system',
      mcp: { other: { type: 'remote', url: 'https://mcp.test' } },
    }));

    await registerMcp('opencode', 'agentwiki-local-a1', 'connection-1', '0.1.0', runner, home);

    const config = JSON.parse(await readFile(configPath, 'utf8')) as OpenCodeConfig;
    expect(config.theme).toBe('system');
    expect(config.mcp.other).toBeTruthy();
    expect(config.mcp['agentwiki-local-a1']).toEqual({
      type: 'local',
      command: ['npx', '-y', '@neomei/agentwiki-local-sync@0.1.0', 'mcp', '--connection', 'connection-1', '--orchestrator'],
      enabled: true,
      timeout: 1_800_000,
    });
  });

  it('uses the OpenCode v2 servers layout and disabled false', async () => {
    const home = await createHome();
    const runner = runnerWithOpenCodeVersion('2.0.0');
    const configPath = await writeOpenCodeConfig(home, JSON.stringify({ mcp: { servers: {} } }));

    await registerMcp('opencode', 'agentwiki-local-a1', 'connection-1', '0.1.0', runner, home);

    const config = JSON.parse(await readFile(configPath, 'utf8')) as OpenCodeConfig;
    expect(config.mcp.servers?.['agentwiki-local-a1']).toEqual({
      type: 'local',
      command: ['npx', '-y', '@neomei/agentwiki-local-sync@0.1.0', 'mcp', '--connection', 'connection-1', '--orchestrator'],
      disabled: false,
      timeout: { execution: 1_800_000 },
    });
  });

  it('rejects ambiguous auto detection with the installed choices instead of guessing', () => {
    const runner = vi.fn<CommandRunner>(() => result());

    expect(() => detectClient('auto', runner)).toThrow(/codex.*claude/i);
  });

  it('does not invoke a second command for an identical OpenCode registration', async () => {
    const home = await createHome();
    const runner = runnerWithOpenCodeVersion('1.18.7');
    await writeOpenCodeConfig(home, JSON.stringify({
      mcp: {
        'agentwiki-local-a1': {
          type: 'local',
          command: ['npx', '-y', '@neomei/agentwiki-local-sync@0.1.0', 'mcp', '--connection', 'connection-1', '--orchestrator'],
          enabled: true,
          timeout: 1_800_000,
        },
      },
    }));

    await registerMcp('opencode', 'agentwiki-local-a1', 'connection-1', '0.1.0', runner, home);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith('opencode', ['--version'], expect.anything());
  });

  it('aborts instead of overwriting a conflicting same-name OpenCode entry', async () => {
    const home = await createHome();
    const runner = runnerWithOpenCodeVersion('1.18.7');
    const configPath = await writeOpenCodeConfig(home, JSON.stringify({
      mcp: { 'agentwiki-local-a1': { type: 'local', command: ['other'] } },
    }));

    await expect(registerMcp('opencode', 'agentwiki-local-a1', 'connection-1', '0.1.0', runner, home))
      .rejects.toThrow(/already exists/i);
    expect(await readFile(configPath, 'utf8')).toBe(JSON.stringify({
      mcp: { 'agentwiki-local-a1': { type: 'local', command: ['other'] } },
    }));
  });

  it('removes only its OpenCode entry', async () => {
    const home = await createHome();
    const runner = runnerWithOpenCodeVersion('1.18.7');
    const configPath = await writeOpenCodeConfig(home, JSON.stringify({
      theme: 'system',
      mcp: {
        other: { type: 'remote', url: 'https://mcp.test' },
        'agentwiki-local-a1': { type: 'local', command: ['npx'], enabled: true },
      },
    }));

    await removeMcp('opencode', 'agentwiki-local-a1', runner, home);

    const config = JSON.parse(await readFile(configPath, 'utf8')) as OpenCodeConfig;
    expect(config.theme).toBe('system');
    expect(config.mcp.other).toBeTruthy();
    expect(config.mcp['agentwiki-local-a1']).toBeUndefined();
  });

  it('does not overwrite invalid OpenCode JSON', async () => {
    const home = await createHome();
    const runner = runnerWithOpenCodeVersion('1.18.7');
    const configPath = await writeOpenCodeConfig(home, '{ // JSONC is unsupported\n }');

    await expect(registerMcp('opencode', 'agentwiki-local-a1', 'connection-1', '0.1.0', runner, home))
      .rejects.toThrow(SyntaxError);
    expect(await readFile(configPath, 'utf8')).toBe('{ // JSONC is unsupported\n }');
  });

  it('installs the same shared skill in the compatible global paths', async () => {
    const home = await createHome();
    const source = join(home, 'source-SKILL.md');
    await writeFile(source, '# AgentWiki Local Sync\n');

    const paths = await installSkill(home, source, 'claude');

    expect(paths).toEqual([
      join(home, '.agents', 'skills', 'agentwiki-local-sync', 'SKILL.md'),
      join(home, '.claude', 'skills', 'agentwiki-local-sync', 'SKILL.md'),
    ]);
    await expect(Promise.all(paths.map((path) => readFile(path, 'utf8'))))
      .resolves.toEqual(['# AgentWiki Local Sync\n', '# AgentWiki Local Sync\n']);
  });
});
