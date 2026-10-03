import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  claimPreview,
  connectionForSpace,
  completePreview,
  getOrCreateSourceKey,
  loadConfig,
  mergeConnection,
  loadCredentials,
  saveConfig,
  releasePreview,
  saveCredentials,
  savePreview,
} from './config.js';

const homes: string[] = [];

async function createHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'agentwiki-local-sync-'));
  homes.push(home);
  return home;
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('secure local state', () => {
  it('rejects an explicit Space when the sole legacy connection has no confirmed binding', () => {
    const config = { version: 1 as const, connections: { legacy: { id: 'legacy', serverUrl: 'https://wiki.test/api', agentId: 'agent-1', credentialId: 'cred-a', pluginVersion: '0.10.0', client: 'codex' as const, mcpName: 'agentwiki' } } };
    expect(() => connectionForSpace(config, 'space-b')).toThrow(/spaceId space-b/);
  });

  it('keeps multiple Space connections addressable without falling back across Spaces', async () => {
    const home = await createHome();
    await saveConfig(home, {
      version: 1,
      defaultConnectionId: 'space-b',
      connections: {
        'space-a': { id: 'space-a', serverUrl: 'https://wiki.test/api', agentId: 'agent-1', credentialId: 'cred-a', pluginVersion: '0.10.0', client: 'codex', mcpName: 'agentwiki', spaceId: 'space-a' },
        'space-b': { id: 'space-b', serverUrl: 'https://wiki.test/api', agentId: 'agent-1', credentialId: 'cred-b', pluginVersion: '0.10.0', client: 'codex', mcpName: 'agentwiki', spaceId: 'space-b' },
      },
    });

    const config = await loadConfig(home);
    expect(connectionForSpace(config, 'space-a')?.credentialId).toBe('cred-a');
    expect(connectionForSpace(config, 'space-b')?.credentialId).toBe('cred-b');
    expect(() => connectionForSpace(config, 'space-c')).toThrow(/spaceId space-c/);
  });

  it('merges a second Space and rolls it back without erasing the first', async () => {
    const home = await createHome();
    const common = { serverUrl: 'https://wiki.test/api', agentId: 'agent-1', pluginVersion: '0.10.0', client: 'codex' as const, mcpName: 'agentwiki' };
    await mergeConnection(home, { ...common, id: 'a', credentialId: 'cred-a', spaceId: 'space-a' }, 'key-a');
    const undo = await mergeConnection(home, { ...common, id: 'b', credentialId: 'cred-b', spaceId: 'space-b' }, 'key-b');
    expect(Object.keys((await loadConfig(home)).connections).sort()).toEqual(['a', 'b']);
    expect((await loadCredentials(home)).credentials).toEqual({ 'cred-a': { apiKey: 'key-a' }, 'cred-b': { apiKey: 'key-b' } });
    await undo();
    expect(Object.keys((await loadConfig(home)).connections)).toEqual(['a']);
    expect((await loadCredentials(home)).credentials).toEqual({ 'cred-a': { apiKey: 'key-a' } });
  });

  it('migrates v1 credentials to v2 and keeps the device credential out of public config', async () => {
    const home = await createHome();
    await saveConfig(home, {
      version: 1,
      defaultConnectionId: 'local',
      connections: {
        local: {
          id: 'local', serverUrl: 'https://wiki.test/api', agentId: 'agent-1', credentialId: 'cred-1',
          pluginVersion: '0.10.2', client: 'codex', mcpName: 'agentwiki',
        },
      },
    });
    await saveCredentials(home, {
      version: 1,
      credentials: { 'cred-1': { apiKey: 'agk_secret' } },
    });

    const migrated = await loadCredentials(home);
    migrated.credentials['cred-1']!.syncDeviceCredential = 'device-secret';
    await saveCredentials(home, migrated);

    expect(migrated.version).toBe(2);
    expect((await readFile(join(home, '.agentwiki', 'credentials.json'), 'utf8'))).toContain('device-secret');
    expect(await readFile(join(home, '.agentwiki', 'local-sync.json'), 'utf8')).not.toContain('device-secret');
  });

  it('rejects a future credential schema instead of guessing', async () => {
    const home = await createHome();
    await mkdir(join(home, '.agentwiki'), { recursive: true });
    await writeFile(join(home, '.agentwiki', 'credentials.json'), JSON.stringify({ version: 3, credentials: {} }));

    await expect(loadCredentials(home)).rejects.toThrow(/future|version/i);
  });

  it('writes credentials with POSIX mode 0600 and never into the project', async () => {
    const home = await createHome();

    await saveCredentials(home, {
      version: 1,
      credentials: { local: { apiKey: 'agk_secret' } },
    });

    const path = join(home, '.agentwiki', 'credentials.json');
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, 'utf8')).toContain('agk_secret');
  });

  it('reuses an opaque source key without exposing the path', async () => {
    const home = await createHome();

    const first = await getOrCreateSourceKey(home, '/private/project');
    const second = await getOrCreateSourceKey(home, '/private/project');

    expect(second).toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns one source key when concurrent callers use the same path', async () => {
    const home = await createHome();

    const [first, second] = await Promise.all([
      getOrCreateSourceKey(home, '/private/concurrent-project'),
      getOrCreateSourceKey(home, '/private/concurrent-project'),
    ]);

    expect(second).toBe(first);
  });

  it('stores source keys under a path hash without persisting the source path', async () => {
    const home = await createHome();
    const sourcePath = '/private/hashed-project';

    await getOrCreateSourceKey(home, sourcePath);

    const entries = await readdir(join(home, '.agentwiki', 'source-keys'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(join(home, '.agentwiki', 'source-keys', entries[0]), 'utf8')).not.toContain(sourcePath);
  });

  it('claims a preview once and completes it after upload', async () => {
    const home = await createHome();
    const previewId = randomUUID();

    await savePreview(home, {
      id: previewId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      envelopePath: '/tmp/a.okf.json',
      envelopeHash: 'abc',
    });

    await expect(claimPreview(home, previewId)).resolves.toMatchObject({ id: previewId });
    await expect(claimPreview(home, previewId)).rejects.toThrow('already in progress');
    await completePreview(home, previewId);
    await expect(claimPreview(home, previewId)).rejects.toThrow('not found or expired');
  });

  it('releases a claimed preview so it can be claimed again', async () => {
    const home = await createHome();
    const previewId = randomUUID();

    await savePreview(home, {
      id: previewId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      envelopePath: '/tmp/a.okf.json',
      envelopeHash: 'abc',
    });

    await claimPreview(home, previewId);
    await releasePreview(home, previewId);
    await expect(claimPreview(home, previewId)).resolves.toMatchObject({ id: previewId });
  });

  it('cleans up an expired inflight preview and reports it as unavailable', async () => {
    const home = await createHome();
    const previewId = randomUUID();
    const previewDirectory = join(home, '.agentwiki', 'previews');
    const inflightPath = join(previewDirectory, `${previewId}.inflight`);

    await savePreview(home, {
      id: previewId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      envelopePath: '/tmp/a.okf.json',
      envelopeHash: 'abc',
    });
    await claimPreview(home, previewId);
    await writeFile(inflightPath, JSON.stringify({
      id: previewId,
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      envelopePath: '/tmp/a.okf.json',
      envelopeHash: 'abc',
    }));

    await expect(claimPreview(home, previewId)).rejects.toThrow('not found or expired');
    await expect(stat(inflightPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

it('does not lose another Space when additions race or when an earlier addition rolls back', async () => {
  const home = await createHome();
  const common = { serverUrl: 'https://wiki.test/api', agentId: 'agent-1', pluginVersion: '0.10.0', client: 'codex' as const, mcpName: 'agentwiki' };
  const results = await Promise.allSettled([
    mergeConnection(home, { ...common, id: 'a', spaceId: 'space-a', credentialId: 'cred-a' }, 'key-a'),
    mergeConnection(home, { ...common, id: 'b', spaceId: 'space-b', credentialId: 'cred-b' }, 'key-b'),
  ]);
  // Contention may fail explicitly, but every successful addition must remain paired with its key.
  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      const id = index === 0 ? 'a' : 'b';
      expect((await loadConfig(home)).connections[id]?.credentialId).toBe(`cred-${id}`);
      expect((await loadCredentials(home)).credentials[`cred-${id}`]?.apiKey).toBe(`key-${id}`);
    }
  }
  const undo = await mergeConnection(home, { ...common, id: 'c', spaceId: 'space-c', credentialId: 'cred-c' }, 'key-c');
  await mergeConnection(home, { ...common, id: 'd', spaceId: 'space-d', credentialId: 'cred-d' }, 'key-d');
  await undo();
  expect((await loadConfig(home)).connections.d?.credentialId).toBe('cred-d');
  expect((await loadCredentials(home)).credentials['cred-d']?.apiKey).toBe('key-d');
  expect((await loadConfig(home)).connections.c).toBeUndefined();
});

it('uses the explicitly installed credential after reauthorizing the same Space', async () => {
  const home = await createHome();
  const common = { serverUrl: 'https://wiki.test/api', agentId: 'agent-1', pluginVersion: '0.10.0', client: 'codex' as const, mcpName: 'agentwiki', spaceId: 'space-a' };
  await mergeConnection(home, { ...common, id: 'old', credentialId: 'old-key' }, 'old');
  await mergeConnection(home, { ...common, id: 'new', credentialId: 'new-key' }, 'new');
  expect(connectionForSpace(await loadConfig(home), 'space-a').credentialId).toBe('new-key');
});
