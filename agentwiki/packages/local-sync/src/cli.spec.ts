import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { runCli, runDoctor, runner, CLI_USAGE } from './cli.js';
import { createLocalSyncCommands, type CommandDependencies } from './mcp.js';
import { formatMcpOutput } from './gateway/output.js';
import { saveConfig, saveCredentials } from './config.js';

const temporaryPaths: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryPaths.push(path);
  return path;
}

function envelopeBytes(content = '# Generated knowledge\n'): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    okfVersion: '0.1',
    documents: [{ path: 'agentwiki/project.md', content, contentHash: 'document-hash' }],
  }));
}

function dependencies(overrides: Partial<CommandDependencies> = {}): {
  deps: CommandDependencies;
  client: { getSyncState: ReturnType<typeof vi.fn>; upload: ReturnType<typeof vi.fn> };
  previews: Map<string, { id: string; expiresAt: string; envelopePath: string; envelopeHash: string; spaceId?: string }>;
  completed: string[];
  released: string[];
} {
  const previews = new Map<string, { id: string; expiresAt: string; envelopePath: string; envelopeHash: string; spaceId?: string }>();
  const client = {
    getSyncState: vi.fn().mockResolvedValue({ exists: false, documents: [] }),
    upload: vi.fn().mockResolvedValue({ status: 'queued', sourceId: 'source-1', sourceVersionId: 'version-1', runId: 'run-1' }),
  };
  const completed: string[] = [];
  const released: string[] = [];
  const home = join(tmpdir(), `agentwiki-local-sync-${randomUUID()}`);
  const now = () => new Date('2026-07-29T08:00:00.000Z');
  const deps: CommandDependencies = {
    home,
    connection: {
      id: 'connection-1', serverUrl: 'https://wiki.test/api', agentId: 'agent-1', credentialId: 'credential-1',
      pluginVersion: '0.1.0', client: 'codex', mcpName: 'agentwiki-local-connection-1',
    },
    readApiKey: async () => 'agk_test_key',
    client: client as never,
    inspectLocalSource: vi.fn().mockResolvedValue({ displayName: 'fixture', provider: { provider: 'ollama', local: true } }) as never,
    prepareKnowledgeSync: vi.fn().mockResolvedValue({
      envelope: { name: 'fixture', documents: [{ path: 'agentwiki/project.md', contentHash: 'document-hash' }] },
      envelopeBytes: envelopeBytes(), sourceKey: 'source-key', processedFiles: 1, skippedFiles: [], provider: { provider: 'ollama', local: true },
    }) as never,
    savePreview: vi.fn(async (_home, preview) => { previews.set(preview.id, preview); }) as never,
    claimPreview: vi.fn(async (_home, id) => {
      const preview = previews.get(id);
      if (!preview) throw new Error(`Preview ${id} was not found or expired`);
      return preview;
    }) as never,
    releasePreview: vi.fn(async (_home, id) => { released.push(id); }) as never,
    completePreview: vi.fn(async (_home, id) => { completed.push(id); previews.delete(id); }) as never,
    now,
    ...overrides,
  };
  return { deps, client, previews, completed, released };
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('local sync command orchestration', () => {
  it('returns usage for --help without requiring a connection', async () => {
    const home = await temporaryDirectory('agentwiki-help-');

    await expect(runCli(['--help'], home)).resolves.toMatch(
      /^Usage: agentwiki-local-sync /,
    );
  });

  it('returns the package version for --version without requiring a connection', async () => {
    const home = await temporaryDirectory('agentwiki-version-');

    await expect(runCli(['--version'], home)).resolves.toEqual({ version: '0.3.6' });
  });

  it('prepare returns a diff and saves an upload-free preview', async () => {
    const { deps, client, previews } = dependencies();
    const commands = createLocalSyncCommands(deps);

    const result = await commands.prepare({ path: '/fixture', spaceId: 'space-1', allowRemoteModel: true });

    expect(result).toMatchObject({
      displayName: 'fixture', spaceId: 'space-1', added: 1, updated: 0, deleted: 0, unchanged: 0,
      processedFiles: 1, uploadBytes: envelopeBytes().byteLength,
    });
    expect(result.previewId).toEqual(expect.any(String));
    expect(client.getSyncState).toHaveBeenCalledWith(expect.anything(), 'agk_test_key', 'space-1', 'source-key');
    expect(client.upload).not.toHaveBeenCalled();
    expect(previews.get(result.previewId)).toMatchObject({ id: result.previewId, envelopeHash: expect.any(String) });
    expect([...await readFile(previews.get(result.previewId)!.envelopePath)]).toEqual([...envelopeBytes()]);
  });

  it('requires an explicit true confirmation before it claims or uploads a preview', async () => {
    const { deps, client } = dependencies();
    const commands = createLocalSyncCommands(deps);

    await expect(commands.sync({ previewId: randomUUID(), confirmed: false as never }))
      .rejects.toThrow('Explicit user confirmation is required');
    expect(deps.claimPreview).not.toHaveBeenCalled();
    expect(client.upload).not.toHaveBeenCalled();
  });

  it('rejects a preview whose saved envelope no longer matches its hash', async () => {
    const directory = await temporaryDirectory('agentwiki-preview-');
    const path = join(directory, 'knowledge.okf.json');
    await writeFile(path, envelopeBytes('original'));
    const previewId = randomUUID();
    const { deps, client, previews, completed, released } = dependencies();
    previews.set(previewId, {
      id: previewId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      envelopePath: path,
      envelopeHash: createHash('sha256').update(envelopeBytes('original')).digest('hex'),
      spaceId: 'space-1',
    });
    await writeFile(path, envelopeBytes('changed'));

    await expect(createLocalSyncCommands(deps).sync({ previewId, confirmed: true }))
      .rejects.toThrow('Prepared knowledge changed; generate a new preview');
    expect(client.upload).not.toHaveBeenCalled();
    expect(released).toEqual([previewId]);
    expect(completed).toEqual([]);
  });

  it.each(['queued', 'noop'] as const)('uploads a matching preview once and reports %s without approving a ChangeSet', async (status) => {
    const directory = await temporaryDirectory('agentwiki-preview-');
    const path = join(directory, 'knowledge.okf.json');
    const bytes = envelopeBytes();
    await writeFile(path, bytes);
    const previewId = randomUUID();
    const { deps, client, previews, completed } = dependencies();
    previews.set(previewId, {
      id: previewId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      envelopePath: path,
      envelopeHash: createHash('sha256').update(bytes).digest('hex'),
      spaceId: 'space-1',
    });
    client.upload.mockResolvedValueOnce({ status, sourceId: 'source-1', sourceVersionId: 'version-1', runId: status === 'queued' ? 'run-1' : null });

    const result = await createLocalSyncCommands(deps).sync({ previewId, confirmed: true });

    expect(result).toEqual({ status, sourceId: 'source-1', sourceVersionId: 'version-1', runId: status === 'queued' ? 'run-1' : null });
    expect(client.upload).toHaveBeenCalledTimes(1);
    const [, apiKey, spaceId, uploadedBytes, idempotencyKey] = client.upload.mock.calls[0];
    expect(apiKey).toBe('agk_test_key');
    expect(spaceId).toBe('space-1');
    expect([...uploadedBytes as Uint8Array]).toEqual([...bytes]);
    expect(idempotencyKey).toBe(previewId);
    expect(completed).toEqual([previewId]);
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.stringify(result)).not.toContain('ChangeSet');
  });

  it('releases a claimed preview after every upload failure so it can be retried', async () => {
    const directory = await temporaryDirectory('agentwiki-preview-');
    const path = join(directory, 'knowledge.okf.json');
    const bytes = envelopeBytes();
    await writeFile(path, bytes);
    const previewId = randomUUID();
    const { deps, client, previews, completed, released } = dependencies();
    previews.set(previewId, {
      id: previewId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      envelopePath: path,
      envelopeHash: createHash('sha256').update(bytes).digest('hex'),
      spaceId: 'space-1',
    });
    client.upload.mockRejectedValueOnce(new Error('validation failed'));

    await expect(createLocalSyncCommands(deps).sync({ previewId, confirmed: true }))
      .rejects.toThrow('validation failed');
    expect(released).toEqual([previewId]);
    expect(completed).toEqual([]);
    expect([...await readFile(path)]).toEqual([...bytes]);
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
          credentials: [{ id: connection.credentialId, scopes: ['knowledge:write'], active: true }],
        }],
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
      });
      await runDoctor(home, { ...connection, client: 'claude' }, {
        client: client as never,
        readApiKey: async () => 'agk_doctor_secret',
        run,
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
    expect(run).toHaveBeenCalledWith('codebase-memory-mcp', ['--version'], expect.anything());
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
});
