import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  claimPreview,
  completePreview,
  getOrCreateSourceKey,
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
});
