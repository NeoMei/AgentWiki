import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceLock } from './source-lock.js';

const directories: string[] = [];
async function temporaryDirectory() { const directory = await mkdtemp(join(tmpdir(), 'agentwiki-lock-')); directories.push(directory); return directory; }
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('source locks', () => {
  it('serializes the same source key while allowing different keys to proceed', async () => {
    const root = await temporaryDirectory();
    const lock = new SourceLock({ root, retryMs: 2, timeoutMs: 500 });
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = lock.withLock('a'.repeat(64), async () => { events.push('first:start'); await gate; events.push('first:end'); });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = lock.withLock('a'.repeat(64), async () => { events.push('second'); });
    const other = lock.withLock('b'.repeat(64), async () => { events.push('other'); });
    await other;
    expect(events).toContain('other');
    expect(events).not.toContain('second');
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'other', 'first:end', 'second']);
  });

  it('recovers only an old lock owned by a dead PID', async () => {
    const root = await temporaryDirectory();
    const lock = new SourceLock({ root, retryMs: 2, timeoutMs: 100, staleAfterMs: 1, isProcessAlive: () => false });
    await lock.createForTest('a'.repeat(64), { pid: 999_999, createdAt: new Date(Date.now() - 10_000).toISOString() });
    await expect(lock.withLock('a'.repeat(64), async () => 'recovered')).resolves.toBe('recovered');
  });

  it('does not delete a live lock swapped in while stale recovery is quarantining', async () => {
    const root = await temporaryDirectory();
    const sourceKey = 'c'.repeat(64);
    let lock!: SourceLock;
    lock = new SourceLock({
      root,
      retryMs: 2,
      timeoutMs: 25,
      staleAfterMs: 1,
      isProcessAlive: (pid) => pid === process.pid,
      beforeQuarantine: async (path) => {
        await rm(path, { recursive: true, force: true });
        await lock.createForTest(sourceKey, { pid: process.pid, createdAt: new Date().toISOString(), token: 'live-owner' });
      },
    });
    await lock.createForTest(sourceKey, { pid: 999_999, createdAt: new Date(Date.now() - 10_000).toISOString(), token: 'stale-owner' });

    await expect(lock.withLock(sourceKey, async () => 'must not run')).rejects.toThrow(/Timed out/u);
    expect(await lock.readForTest(sourceKey)).toMatchObject({ pid: process.pid, token: 'live-owner' });
  });

  it.each(['missing', 'corrupt'])('recovers an aged %s legacy owner but not a fresh one', async (kind) => {
    const root = await temporaryDirectory();
    const sourceKey = 'd'.repeat(64);
    const path = join(root, `.codegraph-${sourceKey}.lock`);
    await mkdir(path, { recursive: true });
    if (kind === 'corrupt') await writeFile(join(path, 'owner.json'), '{bad json');
    await utimes(path, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));
    const old = new SourceLock({ root, retryMs: 2, timeoutMs: 100, staleAfterMs: 1, isProcessAlive: () => false });
    await expect(old.withLock(sourceKey, async () => 'recovered')).resolves.toBe('recovered');

    await mkdir(path, { recursive: true });
    if (kind === 'corrupt') await writeFile(join(path, 'owner.json'), '{bad json');
    const fresh = new SourceLock({ root, retryMs: 2, timeoutMs: 20, staleAfterMs: 60_000, isProcessAlive: () => false });
    await expect(fresh.withLock(sourceKey, async () => 'must not run')).rejects.toThrow(/Timed out/u);
    if (kind === 'corrupt') expect(await readFile(join(path, 'owner.json'), 'utf8')).toBe('{bad json');
  });

  it('does not remove a different owner that appears before unlock', async () => {
    const root = await temporaryDirectory();
    const sourceKey = 'e'.repeat(64);
    const path = join(root, `.codegraph-${sourceKey}.lock`);
    const lock = new SourceLock({ root });
    await lock.withLock(sourceKey, async () => {
      await rm(path, { force: true });
      await lock.createForTest(sourceKey, { pid: process.pid, createdAt: new Date().toISOString(), token: 'replacement-owner' });
    });
    expect(await lock.readForTest(sourceKey)).toMatchObject({ token: 'replacement-owner' });
  });

  it('fences a stale-recovery mismatch so a third claimant cannot enter beside the replacement owner', async () => {
    const root = await temporaryDirectory();
    const sourceKey = 'f'.repeat(64);
    const events: string[] = [];
    let releaseRestore!: () => void;
    const restoreGate = new Promise<void>((resolve) => { releaseRestore = resolve; });
    let reachedRestore!: () => void;
    const restoreReached = new Promise<void>((resolve) => { reachedRestore = resolve; });
    const lock = new SourceLock({
      root, retryMs: 2, timeoutMs: 40, staleAfterMs: 1,
      isProcessAlive: (pid) => pid === process.pid,
      beforeQuarantine: async (path) => {
        // Simulate Y replacing stale S with a valid F after X observed S.
        await rm(path, { force: true, recursive: true });
        await lock.createForTest(sourceKey, { pid: process.pid, createdAt: new Date().toISOString(), token: 'replacement-f' });
        events.push('F:protected');
      },
      beforeRestore: async () => { reachedRestore(); await restoreGate; },
    });
    await lock.createForTest(sourceKey, { pid: 999_999, createdAt: new Date(Date.now() - 10_000).toISOString(), token: 'stale-s' });
    const recovering = lock.withLock(sourceKey, async () => { events.push('X:work'); });
    await restoreReached;
    const third = lock.withLock(sourceKey, async () => { events.push('G:work'); });
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(events).toEqual(['F:protected']);
    releaseRestore();
    await expect(Promise.all([recovering, third])).rejects.toThrow(/Timed out/u);
    expect(await lock.readForTest(sourceKey)).toMatchObject({ token: 'replacement-f' });
  });

  it('reclaims only aged dead candidate and quarantine residues', async () => {
    const root = await temporaryDirectory();
    const sourceKey = '9'.repeat(64);
    const lock = new SourceLock({ root, staleAfterMs: 1, isProcessAlive: () => false });
    await lock.createResidueForTest(sourceKey, 'candidate', { pid: 999_999, createdAt: new Date(Date.now() - 10_000).toISOString(), token: 'old-candidate' });
    await lock.createResidueForTest(sourceKey, 'quarantine', { pid: 999_999, createdAt: new Date(Date.now() - 10_000).toISOString(), token: 'old-quarantine' });
    await lock.cleanupResiduesForTest(sourceKey);
    expect(await lock.residuesForTest(sourceKey)).toEqual([]);
  });

  it('recovers an aged dead recovery fence without deleting another owner', async () => {
    const root = await temporaryDirectory();
    const sourceKey = '8'.repeat(64);
    const fence = join(root, `.codegraph-${sourceKey}.lock.recovery-fence`);
    await writeFile(fence, JSON.stringify({ pid: 999_999, createdAt: new Date(Date.now() - 10_000).toISOString(), token: 'dead-fence' }));
    await utimes(fence, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));
    const lock = new SourceLock({ root, staleAfterMs: 1, isProcessAlive: () => false });
    await expect(lock.withLock(sourceKey, async () => 'recovered')).resolves.toBe('recovered');
  });
});
