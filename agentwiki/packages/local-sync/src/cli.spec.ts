import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '', error: undefined })),
  };
});

import { spawnSync } from 'node:child_process';
import { isSupportedNodeVersion, runCli, runDoctor, runner, CLI_USAGE } from './cli.js';
import { formatMcpOutput } from './gateway/output.js';
import { loadConfig, loadCredentials, saveConfig, saveCredentials } from './config.js';

const temporaryPaths: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryPaths.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('local sync command orchestration', () => {
  it.each([
    ['v24.0.0', true],
    ['v25.0.0', false],
    ['v26.0.0', true],
    ['v27.0.0', false],
  ])('supports only the published Node lines for %s', (version, expected) => {
    expect(isSupportedNodeVersion(version)).toBe(expected);
  });

  it('returns usage for --help without requiring a connection', async () => {
    const home = await temporaryDirectory('agentwiki-help-');

    await expect(runCli(['--help'], home)).resolves.toMatch(
      /^Usage: agentwiki-local-sync /,
    );
  });

  it('returns the package version for --version without requiring a connection', async () => {
    const home = await temporaryDirectory('agentwiki-version-');

    await expect(runCli(['--version'], home)).resolves.toEqual({ version: '0.6.1' });
  });

  it('redacts secrets in MCP output before serializing it', () => {
    const output = formatMcpOutput({ apiKey: 'agk_mcp_secret', nested: { token: 'awk_nested_secret' } });

    expect(output).not.toContain('agk_mcp_secret');
    expect(output).not.toContain('awk_nested_secret');
    expect(output).toContain('[REDACTED]');
  });

 
  it('exposes onboard and gateway in the CLI usage string', () => {
    expect(CLI_USAGE).toContain('onboard');
    expect(CLI_USAGE).toContain('gateway');
    expect(CLI_USAGE).toContain('doctor');
    expect(CLI_USAGE).toContain('uninstall');
    expect(CLI_USAGE).toContain('--source-path');
  });

  it('rejects --source-path outside doctor before onboarding side effects', async () => {
    const home = await temporaryDirectory('agentwiki-source-path-scope-');
    const onboard = vi.fn();

    await expect(runCli(['onboard', '--source-path', '/repo'], home, { onboard })).rejects.toThrow(CLI_USAGE);
    expect(onboard).not.toHaveBeenCalled();
  });

  it('rejects non-onboard positionals before uninstall, gateway, or doctor side effects', async () => {
    const home = await temporaryDirectory('agentwiki-positional-scope-');
    const connection = {
      id: randomUUID(), serverUrl: 'https://wiki.test/api', agentId: 'agent-1', credentialId: 'credential-1',
      pluginVersion: '0.1.0', client: 'codex' as const, mcpName: 'agentwiki-local-test',
    };
    await saveConfig(home, { version: 1, defaultConnectionId: connection.id, connections: { [connection.id]: connection } });
    await saveCredentials(home, { version: 1, credentials: { [connection.credentialId]: { apiKey: 'agk_keep_me' } } });
    const gateway = vi.fn();
    const spawnMock = vi.mocked(spawnSync);
    spawnMock.mockClear();

    await expect(runCli(['uninstall', 'stray'], home)).rejects.toThrow(CLI_USAGE);
    await expect(runCli(['gateway', 'stray'], home, { gateway })).rejects.toThrow(CLI_USAGE);
    await expect(runCli(['doctor', 'stray'], await temporaryDirectory('agentwiki-doctor-positional-'))).rejects.toThrow(CLI_USAGE);

    expect((await loadConfig(home)).connections).toEqual({ [connection.id]: connection });
    expect((await loadCredentials(home)).credentials[connection.credentialId]?.apiKey).toBe('agk_keep_me');
    expect(gateway).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('onboard returns structured action metadata', async () => {
    const home = await temporaryDirectory('agentwiki-onboard-');
    const onboard = vi.fn().mockResolvedValue({ sessionId: 'sess-1', report: { completed: true } });
    try {
      const result = await runCli(
        ['onboard', '--server', 'https://example.test/api', '--protocol', 'ndjson'],
        home,
        { onboard },
      );
      expect(result).toEqual({ sessionId: 'sess-1', report: { completed: true } });
      expect(onboard).toHaveBeenCalledWith({
        home,
        protocol: 'ndjson',
        serverBaseUrl: 'https://example.test/api',
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('onboard defaults to the production server and ndjson protocol', async () => {
    const home = await temporaryDirectory('agentwiki-onboard-');
    const onboard = vi.fn().mockResolvedValue({ sessionId: 'sess-2', report: {} });
    try {
      await runCli(['onboard'], home, { onboard });
      expect(onboard).toHaveBeenCalledWith({
        home,
        protocol: 'ndjson',
        serverBaseUrl: 'https://agentwiki.quukk.com/api',
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('onboard resume executes the saved session', async () => {
    const home = await temporaryDirectory('agentwiki-onboard-');
    const onboard = vi.fn().mockResolvedValue({ sessionId: 'sess-123', report: {} });
    try {
      await runCli(['onboard', 'resume', '--id', 'sess-123'], home, { onboard });
      expect(onboard).toHaveBeenCalledWith({
        home,
        protocol: 'ndjson',
        serverBaseUrl: 'https://agentwiki.quukk.com/api',
        sessionId: 'sess-123',
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('routes onboard --code to existing-Agent attachment without starting full onboarding', async () => {
    const home = await temporaryDirectory('agentwiki-attach-');
    const onboard = vi.fn();
    const attach = vi.fn().mockResolvedValue({ connectionId: 'connection-1', mcpName: 'agentwiki' });

    await runCli([
      'onboard', '--server', 'https://wiki.test/api', '--code', 'AW-TEST-CODE',
      '--protocol', 'ndjson', '--agent', 'codex',
    ], home, { onboard, attach } as never);

    expect(attach).toHaveBeenCalledWith({
      home,
      protocol: 'ndjson',
      serverBaseUrl: 'https://wiki.test/api',
      code: 'AW-TEST-CODE',
      requestedClient: 'codex',
    });
    expect(onboard).not.toHaveBeenCalled();
  });

  it('rejects combining a saved onboarding resume with an installation code', async () => {
    const home = await temporaryDirectory('agentwiki-attach-resume-');

    await expect(runCli([
      'onboard', 'resume', '--id', 'sess-1', '--code', 'AW-TEST-CODE',
    ], home, { onboard: vi.fn() })).rejects.toThrow(CLI_USAGE);
  });

  it.each(['connect', 'mcp', 'start', 'work', 'preview', 'preview-job', 'push-job', 'pull', 'scan', 'sync', 'upgrade']) (
    'rejects the retired public command %s',
    async (command) => {
      const home = await temporaryDirectory('agentwiki-retired-command-');
      await expect(runCli([command], home, { onboard: vi.fn() })).rejects.toThrow(CLI_USAGE);
    },
  );

  it('gateway requires --connection or a default', async () => {
    const home = await temporaryDirectory('agentwiki-gateway-');
    try {
      await expect(runCli(['gateway'], home)).rejects.toThrow();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

it('doctor checks required tool availability without invoking remote model providers or scanning paths', async () => {
    const home = await temporaryDirectory('agentwiki-doctor-');
    const connection = {
      id: randomUUID(), serverUrl: 'https://wiki.test/api', agentId: 'agent-1', credentialId: 'credential-1',
      pluginVersion: '0.1.0', client: 'codex' as const, mcpName: 'agentwiki-local-test',
    };
    await saveConfig(home, { version: 1, defaultConnectionId: connection.id, connections: { [connection.id]: connection } });
    await saveCredentials(home, { version: 1, credentials: { [connection.credentialId]: { apiKey: 'agk_doctor_secret' } } });
    const run = vi.fn((command: string) => ({
      status: 0,
      stdout: command === 'markitdown' ? 'markitdown 0.1.0\n'
        : `${command} 1.0.0\n`,
      stderr: '',
    }));
    const client = {
      access: vi.fn().mockResolvedValue({
        access: [{
          id: connection.agentId,
          name: 'Local agent',
          status: 'active',
          grants: [{ role: 'editor', space: { id: 'space-1', name: 'Space' } }],
          credentials: [{
            id: connection.credentialId,
            authorization: { id: 'grant-1', role: 'editor', scopes: ['knowledge:write'], space: { id: 'space-1', name: 'Space' } },
            active: true,
          }],
        }],
      }),
    };
    const codeGraph = {
      diagnose: vi.fn().mockResolvedValue({
        available: true,
        detectedVersion: 'codegraph 1.5.0',
        capabilities: {
          required: { 'index.status': true, 'index.sync': true, 'files.list': true },
          optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false },
        },
      }),
    };

    const originalCodexHome = process.env.CODEX_HOME;
    const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CODEX_HOME = '/wrong/codex-home';
    process.env.CLAUDE_CONFIG_DIR = '/wrong/claude-config';
    let report;
    try {
      report = await runDoctor(home, connection, {
        client: client as never,
        readApiKey: async () => 'agk_doctor_secret',
        run,
        codeGraph,
      });
      await runDoctor(home, { ...connection, client: 'claude' }, {
        client: client as never,
        readApiKey: async () => 'agk_doctor_secret',
        run,
        codeGraph,
      });
    } finally {
      if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = originalCodexHome;
      if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
    }

    expect(report.checks.filter((check) => check.status === 'pass')).toHaveLength(report.checks.length);
    expect(run).toHaveBeenCalledWith('markitdown', ['--version'], expect.anything());
    expect(run).toHaveBeenCalledWith('git', ['--version'], expect.anything());
    expect(run.mock.calls.map(([command]) => command)).toEqual([
      'markitdown', 'git', 'codex', 'markitdown', 'git', 'claude',
    ]);
    expect(run).toHaveBeenCalledWith('codex', ['mcp', 'get', connection.mcpName], expect.objectContaining({
      env: expect.objectContaining({ HOME: home, USERPROFILE: home }),
    }));
    expect(run).toHaveBeenCalledWith('claude', ['mcp', 'get', connection.mcpName], expect.objectContaining({
      env: expect.objectContaining({ HOME: home, USERPROFILE: home }),
    }));
    const mcpCalls = run.mock.calls as unknown as Array<[string, string[], { env?: NodeJS.ProcessEnv }?]>;
    for (const [, , options] of mcpCalls.filter(([, args]) => args[0] === 'mcp')) {
      expect(options?.env).not.toHaveProperty('CODEX_HOME');
      expect(options?.env).not.toHaveProperty('CLAUDE_CONFIG_DIR');
    }
    expect(client.access).toHaveBeenCalledWith(connection, 'agk_doctor_secret');
  });

  it('doctor reaches the real spawn with an isolated HOME and strips client overrides', async () => {
    const home = await temporaryDirectory('agentwiki-doctor-real-spawn-');
    const connection = {
      id: randomUUID(), serverUrl: 'https://wiki.test/api', agentId: 'agent-1', credentialId: 'credential-1',
      pluginVersion: '0.1.0', client: 'codex' as const, mcpName: 'agentwiki-local-test',
    };
    await saveConfig(home, { version: 1, defaultConnectionId: connection.id, connections: { [connection.id]: connection } });
    await saveCredentials(home, { version: 1, credentials: { [connection.credentialId]: { apiKey: 'agk_doctor_secret' } } });

    const originalCodexHome = process.env.CODEX_HOME;
    const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CODEX_HOME = '/wrong/codex-home';
    process.env.CLAUDE_CONFIG_DIR = '/wrong/claude-config';
    const spawnMock = vi.mocked(spawnSync);
    spawnMock.mockClear();
    try {
      await runDoctor(home, connection, {
        client: { access: vi.fn().mockResolvedValue({ access: [] }) } as never,
        readApiKey: async () => 'agk_doctor_secret',
        run: runner,
      });
    } finally {
      if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = originalCodexHome;
      if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
    }

    const mcpCalls = spawnMock.mock.calls.filter(([, args]) => args?.[0] === 'mcp');
    expect(mcpCalls.length).toBeGreaterThan(0);
    for (const [, , options] of mcpCalls) {
      const env = options?.env as NodeJS.ProcessEnv | undefined;
      expect(env).toBeDefined();
      expect(env).toMatchObject({ HOME: home, USERPROFILE: home });
      expect(env).not.toHaveProperty('CODEX_HOME');
      expect(env).not.toHaveProperty('CLAUDE_CONFIG_DIR');
    }
  });

  it('doctor separates required CodeGraph failures from optional degradation and exposes a source index status', async () => {
    const home = await temporaryDirectory('agentwiki-doctor-codegraph-');
    const connection = {
      id: randomUUID(), serverUrl: 'https://wiki.test/api', agentId: 'agent-1', credentialId: 'credential-1',
      pluginVersion: '0.1.0', client: 'codex' as const, mcpName: 'agentwiki-local-test',
    };
    const client = { access: vi.fn().mockResolvedValue({ access: [] }) };
    const report = await runDoctor(home, connection, {
      client: client as never,
      readApiKey: async () => 'agk_doctor_secret',
      run: vi.fn(() => ({ status: 0, stdout: 'tool 1.0.0', stderr: '' })),
      codeGraph: {
        diagnose: vi.fn().mockResolvedValue({
          available: true,
          detectedVersion: 'CodeGraph v999.1.0-ci',
          capabilities: {
            required: { 'index.status': true, 'index.sync': true, 'files.list': true },
            optional: { 'symbols.list': false, 'relations.read': true, 'semantic.explore': false, 'impact.read': false, 'routes.read': false },
          },
          source: { indexState: 'stale', estimatedFiles: 12 },
        }),
      },
    }, '/repo');

    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'codegraph', status: 'pass', detail: expect.stringContaining('codegraph v999.1.0-ci') }));
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'codegraph-optional-capabilities', status: 'pass', detail: expect.stringContaining('degraded') }));
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'codegraph-index', status: 'pass', detail: expect.stringContaining('stale') }));
  });

  it.each([
    ['missing CodeGraph', { available: false, code: 'CODEGRAPH_NOT_FOUND' }, 'CodeGraph is unavailable'],
    ['a required capability failure', {
      available: true,
      detectedVersion: 'codegraph 99.1.2',
      capabilities: {
        required: { 'index.status': true, 'index.sync': false, 'files.list': true },
        optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false },
      },
    }, 'Required CodeGraph capabilities unavailable: index.sync'],
  ])('doctor reports %s with CodeGraph-owned repair guidance', async (_name, diagnosis, expectedDetail) => {
    const home = await temporaryDirectory('agentwiki-doctor-codegraph-failure-');
    const connection = {
      id: randomUUID(), serverUrl: 'https://wiki.test/api', agentId: 'agent-1', credentialId: 'credential-1',
      pluginVersion: '0.1.0', client: 'codex' as const, mcpName: 'agentwiki-local-test',
    };
    const report = await runDoctor(home, connection, {
      client: { access: vi.fn().mockResolvedValue({ access: [] }) } as never,
      readApiKey: async () => 'agk_doctor_secret',
      run: vi.fn(() => ({ status: 0, stdout: 'tool 1.0.0', stderr: '' })),
      codeGraph: { diagnose: vi.fn().mockResolvedValue(diagnosis) },
    });

    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'codegraph', status: 'fail', detail: expect.stringContaining(expectedDetail) }));
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'codegraph', detail: expect.stringContaining('AgentWiki does not install or upgrade it') }));
  });

  it('doctor never echoes an unsafe CodeGraph diagnostic version', async () => {
    const home = await temporaryDirectory('agentwiki-doctor-codegraph-version-');
    const unsafe = 'codegraph 1.5.0\n/private/diagnostic-token';
    const connection = {
      id: randomUUID(), serverUrl: 'https://wiki.test/api', agentId: 'agent-1', credentialId: 'credential-1',
      pluginVersion: '0.1.0', client: 'codex' as const, mcpName: 'agentwiki-local-test',
    };
    const report = await runDoctor(home, connection, {
      client: { access: vi.fn().mockResolvedValue({ access: [] }) } as never,
      readApiKey: async () => 'agk_doctor_secret',
      run: vi.fn(() => ({ status: 0, stdout: 'tool 1.0.0', stderr: '' })),
      codeGraph: { diagnose: vi.fn().mockResolvedValue({
        available: true,
        detectedVersion: unsafe,
        capabilities: { required: { 'index.status': true, 'index.sync': true, 'files.list': true }, optional: {} },
      }) },
    });

    const detail = report.checks.find((entry) => entry.name === 'codegraph')?.detail ?? '';
    expect(detail).toContain('version unavailable');
    expect(detail).not.toContain('/private/diagnostic-token');
  });
});
