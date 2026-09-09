import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, stat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStepReply, withStepLock, writeStepState } from './steps-store.js';
let home = '';
afterEach(async () => {
  if (home) await rm(home, { recursive: true, force: true });
});
async function fresh() {
  home = await mkdtemp(join(tmpdir(), 'aw-step-store-'));
  return home;
}
it('rejects public and symbolic-link reply files and keeps state private', async () => {
  const dir = await fresh(),
    file = join(dir, 'reply.json');
  await writeFile(file, '{}', { mode: 0o644 });
  if (process.platform !== 'win32') await expect(readStepReply(file)).rejects.toThrow(/REPLY_INVALID/);
  const state = join(dir, 'private', 'state.json');
  await writeStepState(state, { device: 'secret' });
  if (process.platform !== 'win32') expect((await stat(state)).mode & 0o777).toBe(0o600);
  const link = join(dir, 'link.json');
  await symlink(state, link);
  await expect(readStepReply(link)).rejects.toThrow();
  await expect(readStepReply('relative.json')).rejects.toThrow(/REPLY_INVALID/);
});
it('serializes mutations and reclaims a dead process lock without changing the checkpoint', async () => {
  const file = join(await fresh(), 'state.json');
  await writeStepState(file, { step: 'saved' });
  // PID beyond platform process identifier range cannot name a live process.
  await writeFile(`${file}.lock`, '2147483647');
  await withStepLock(file, async () => {
    await expect(
      withStepLock(file, async () => {
        throw new Error('should not enter');
      }),
    ).rejects.toThrow(/SESSION_BUSY/);
    expect(await readFile(file, 'utf8')).toBe('{"step":"saved"}');
  });
  await expect(readFile(`${file}.lock`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});

it('recovers when the process also crashed while reclaiming an older lock', async () => {
  const file = join(await fresh(), 'state.json');
  await writeStepState(file, { step: 'saved' });
  await writeFile(`${file}.lock`, '2147483647');
  await writeFile(`${file}.lock.reap`, '2147483647');
  await expect(withStepLock(file, async () => 'resumed')).resolves.toBe('resumed');
});
