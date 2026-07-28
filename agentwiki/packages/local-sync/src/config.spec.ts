import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  claimPreview,
  completePreview,
  getOrCreateSourceKey,
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
  it('writes credentials with POSIX mode 0600 and never into the project', async () => {
    const home = await createHome();

    await saveCredentials(home, {
      version: 1,
      credentials: { local: { apiKey: 'agk_secret' } },
    });

    const path = join(home, '.agentwiki', 'credentials.json');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
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

    await savePreview(home, {
      id: 'preview-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      envelopePath: '/tmp/a.okf.json',
      envelopeHash: 'abc',
    });

    await expect(claimPreview(home, 'preview-1')).resolves.toMatchObject({ id: 'preview-1' });
    await expect(claimPreview(home, 'preview-1')).rejects.toThrow('already in progress');
    await completePreview(home, 'preview-1');
    await expect(claimPreview(home, 'preview-1')).rejects.toThrow('not found or expired');
  });

  it('releases a claimed preview so it can be claimed again', async () => {
    const home = await createHome();

    await savePreview(home, {
      id: 'preview-release',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      envelopePath: '/tmp/a.okf.json',
      envelopeHash: 'abc',
    });

    await claimPreview(home, 'preview-release');
    await releasePreview(home, 'preview-release');
    await expect(claimPreview(home, 'preview-release')).resolves.toMatchObject({ id: 'preview-release' });
  });

  it('cleans up an expired inflight preview and reports it as unavailable', async () => {
    const home = await createHome();
    const previewId = 'preview-expired-inflight';
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
