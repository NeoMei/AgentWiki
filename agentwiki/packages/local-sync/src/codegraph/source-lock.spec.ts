import { mkdtemp, rm } from 'node:fs/promises';
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
});
