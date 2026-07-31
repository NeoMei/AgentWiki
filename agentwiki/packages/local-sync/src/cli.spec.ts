import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalSyncCommands, runCli, runDoctor, type CommandDependencies } from './cli.js';
import { formatMcpOutput } from './mcp.js';
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
    documents: [{ path: 'openwiki/project.md', content, contentHash: 'document-hash' }],
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
      envelope: { name: 'fixture', documents: [{ path: 'openwiki/project.md', contentHash: 'document-hash' }] },
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
  it('upgrades only the selected connection MCP command to an exact version', async () => {
    const home = await temporaryDirectory('agentwiki-upgrade-');
    const connection = {
      id: randomUUID(), serverUrl: 'https://wiki.test/api', agentId: 'agent-1', credentialId: 'credential-1',
      pluginVersion: '0.1.0', client: 'codex' as const, mcpName: 'agentwiki-local-test',
    };
    await saveConfig(home, { version: 1, defaultConnectionId: connection.id, connections: { [connection.id]: connection } });

    const bin = join(home, 'bin');
    const callsPath = join(home, 'calls.txt');
    await mkdir(bin);
    await writeFile(join(bin, 'codex'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${callsPath}'\n`);
    await chmod(join(bin, 'codex'), 0o700);
    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}:${originalPath ?? ''}`;
    try {
      await expect(runCli(['upgrade', '--version', '0.1.1'], home)).resolves.toMatchObject({ upgraded: true, version: '0.1.1' });
    } finally {
      process.env.PATH = originalPath;
    }
    await expect(readFile(callsPath, 'utf8')).resolves.toBe([
      `mcp remove ${connection.mcpName}`,
      `mcp add ${connection.mcpName} -- npx -y @neomei/agentwiki-local-sync@0.1.1 mcp --connection ${connection.id}`,
      '',
    ].join('\n'));
    await expect(readFile(join(home, '.agentwiki', 'local-sync.json'), 'utf8')).resolves.toContain('"pluginVersion": "0.1.1"');
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

  it('rejects a non-UUID preview ID before it can leave the previews directory', async () => {
    const home = await temporaryDirectory('agentwiki-home-');
    await saveCredentials(home, {
      version: 1,
      credentials: { escape: { apiKey: 'agk_should_not_be_read' } },
    });

    await expect(runCli(['preview', '--id', '../credentials'], home))
      .rejects.toThrow('Preview ID must be a UUID');
  });

 it('doctor checks required tool availability without invoking OpenWiki or scanning paths', async () => {
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

    const report = await runDoctor(home, connection, {
      client: client as never,
      readApiKey: async () => 'agk_doctor_secret',
      run,
    });

    expect(report.checks.filter((check) => check.status === 'pass')).toHaveLength(report.checks.length);
    expect(run).toHaveBeenCalledWith('markitdown', ['--version'], expect.anything());
    expect(run).toHaveBeenCalledWith('git', ['--version'], expect.anything());
    expect(run).toHaveBeenCalledWith('codebase-memory-mcp', ['--version'], expect.anything());
    expect(client.access).toHaveBeenCalledWith(connection, 'agk_doctor_secret');
  });
});
