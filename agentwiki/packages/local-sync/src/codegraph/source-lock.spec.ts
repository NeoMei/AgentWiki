import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceLock } from './source-lock.js';

const directories: string[] = [];
async function temporaryDirectory() { const directory = await mkdtemp(join(tmpdir(), 'agentwiki-lock-')); directories.push(directory); return directory; }
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('source locks', () => {
  it('uses token order to break equal bakery tickets', async () => {
    const root = await temporaryDirectory();
    const lock = new SourceLock({ root, retryMs: 1, timeoutMs: 200, tokenFactory: (() => { const tokens = ['b', 'a']; return () => tokens.shift()!; })() });
    const events: string[] = [];
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = lock.withLock('a'.repeat(64), async () => { events.push('b'); });
    const second = lock.withLock('a'.repeat(64), async () => { events.push('a'); await gate; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    release(); await Promise.all([first, second]);
    expect(events.sort()).toEqual(['a', 'b']);
  });

  it('makes a later contender wait behind an already published ticket', async () => {
    const root = await temporaryDirectory(); const lock = new SourceLock({ root, retryMs: 1, timeoutMs: 200 }); const events: string[] = [];
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = lock.withLock('b'.repeat(64), async () => { events.push('A'); await gate; });
    await lock.waitForTicketForTest('b'.repeat(64));
    const second = lock.withLock('b'.repeat(64), async () => { events.push('B'); });
    await new Promise((resolve) => setTimeout(resolve, 15)); expect(events).toEqual(['A']);
    release(); await Promise.all([first, second]); expect(events).toEqual(['A', 'B']);
  });

  it('recovers unique dead choosing and ticket files without affecting a concurrent cleaner', async () => {
    const root = await temporaryDirectory(); const sourceKey = 'c'.repeat(64);
    const lock = new SourceLock({ root, retryMs: 1, timeoutMs: 200, staleAfterMs: 1, isProcessAlive: (pid) => pid === process.pid });
    await lock.createStaleForTest(sourceKey, 'dead', 'ticket');
    const events: string[] = [];
    await Promise.all([lock.withLock(sourceKey, async () => { events.push('one'); }), lock.withLock(sourceKey, async () => { events.push('two'); })]);
    expect(events).toHaveLength(2);
    expect(await lock.entriesForTest(sourceKey)).toEqual([]);
  });

  it.each(['choosing', 'ticket'] as const)('recovers only a dead aged %s and preserves a live one', async (phase) => {
    const root = await temporaryDirectory(); const sourceKey = 'd'.repeat(64);
    const dead = new SourceLock({ root, timeoutMs: 100, staleAfterMs: 1, isProcessAlive: (pid) => pid === process.pid });
    await dead.createStaleForTest(sourceKey, 'dead', phase); await expect(dead.withLock(sourceKey, async () => 'ok')).resolves.toBe('ok');
    const live = new SourceLock({ root, retryMs: 1, timeoutMs: 20, staleAfterMs: 1, isProcessAlive: () => true });
    await live.createStaleForTest(sourceKey, 'live', phase, false);
    await expect(live.withLock(sourceKey, async () => 'bad')).rejects.toThrow(/Timed out/u);
  });

  it('serializes same keys, permits different keys, and release never removes another ticket', async () => {
    const root = await temporaryDirectory(); const lock = new SourceLock({ root, retryMs: 1, timeoutMs: 200 }); const events: string[] = [];
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = lock.withLock('e'.repeat(64), async () => { events.push('same'); await gate; });
    await lock.waitForTicketForTest('e'.repeat(64));
    const second = lock.withLock('e'.repeat(64), async () => { events.push('second'); });
    const other = lock.withLock('f'.repeat(64), async () => { events.push('other'); });
    await other; expect(events).toContain('other'); expect(events).not.toContain('second'); release(); await Promise.all([first, second]);
  });

  it('fails closed for a fresh malformed visible record but recovers an aged dead exact record', async () => {
    const root = await temporaryDirectory(); const key = '1'.repeat(64); const dir = join(root, `.codegraph-${key}.coordination`);
    await mkdir(dir, { recursive: true }); const bad = join(dir, 'ticket-999999-dead.json'); await writeFile(bad, '{');
    const lock = new SourceLock({ root, timeoutMs: 30, staleAfterMs: 10_000, isProcessAlive: () => false });
    await expect(lock.withLock(key, async () => 'no')).rejects.toThrow(/Malformed/u);
    const old = new Date(Date.now() - 20_000); await utimes(bad, old, old);
    const recovered = new SourceLock({ root, timeoutMs: 100, staleAfterMs: 100, isProcessAlive: () => false });
    await expect(recovered.withLock(key, async () => 'yes')).resolves.toBe('yes');
  });

  it('rejects unsafe token factories and read errors instead of ignoring visible records', async () => {
    const root = await temporaryDirectory(); const key = '2'.repeat(64);
    await expect(new SourceLock({ root, tokenFactory: () => '../escape' }).withLock(key, async () => 'no')).rejects.toThrow(/Invalid/u);
    const locked = new SourceLock({ root, read: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } });
    await expect(locked.withLock(key, async () => 'no')).rejects.toThrow(/Unable to read/u);
  });

  it('removes only aged dead private publish residue', async () => {
    const root = await temporaryDirectory(); const key = '3'.repeat(64); const dir = join(root, `.codegraph-${key}.coordination`); const residue = join(dir, '.private-ticket-999999-dead-random');
    await mkdir(dir, { recursive: true }); await writeFile(residue, 'partial'); const old = new Date(Date.now() - 20_000); await utimes(residue, old, old);
    const lock = new SourceLock({ root, staleAfterMs: 100, isProcessAlive: () => false }); await lock.withLock(key, async () => undefined);
    await expect(stat(residue)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
