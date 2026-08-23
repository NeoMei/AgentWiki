import { link as hardLink, mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceLock, type SourceLockLease, type SourceLockOptions } from './source-lock.js';

const directories: string[] = [];
async function temporaryDirectory() { const directory = await mkdtemp(join(tmpdir(), 'agentwiki-lock-')); directories.push(directory); return directory; }
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

type SourceLockTestDependencies = NonNullable<ConstructorParameters<typeof SourceLock>[1]>;
function testLock(options: SourceLockOptions & SourceLockTestDependencies) {
  const { root, retryMs, timeoutMs, staleAfterMs, ...dependencies } = options;
  return new SourceLock({ root, retryMs, timeoutMs, staleAfterMs }, dependencies as SourceLockTestDependencies);
}

describe('source locks', () => {
  it('issues an active opaque lease bound to exactly one source and invalidates it on release', async () => {
    const root = await temporaryDirectory();
    const lock = testLock({ root });
    const key = 'a'.repeat(64);
    let captured!: SourceLockLease;

    await lock.withLock(key, async (lease) => {
      captured = lease;
      expect(lock.assertLease(key, lease)).toBeUndefined();
      expect(() => lock.assertLease('b'.repeat(64), lease)).toThrow(/lease/i);
      expect(() => lock.assertLease(key, { ...lease } as SourceLockLease)).toThrow(/lease/i);
    });

    expect(() => lock.assertLease(key, captured)).toThrow(/lease/i);
  });

  it('lets only the code-unit smaller token enter when two published choosers select the same ticket', async () => {
    const root = await temporaryDirectory();
    let arrived = 0; let open!: () => void; const bothChoosing = new Promise<void>((resolve) => { open = resolve; }); const trace: string[] = [];
    const makeLock = (pid: number, token: string) => testLock({ root, pid, retryMs: 1, timeoutMs: 200, tokenFactory: () => token, hook: async (stage, owner) => { trace.push(`${pid}:${stage}:${owner.phase}:${owner.token}:${owner.ticketNumber ?? ''}`); if (stage !== 'before-ticket-publish') return; arrived += 1; if (arrived === 2) open(); await bothChoosing; } });
    const b = makeLock(101, 'b'); const a = makeLock(102, 'a');
    const events: string[] = [];
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = b.withLock('a'.repeat(64), async () => { events.push('b'); });
    const second = a.withLock('a'.repeat(64), async () => { events.push('a'); await gate; });
    while (events.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(events, trace.join('|')).toEqual(['a']); release(); await Promise.all([first, second]); expect(events, trace.join('|')).toEqual(['a', 'b']);
  });

  it('makes a later contender wait behind an already published ticket', async () => {
    const root = await temporaryDirectory(); const lock = testLock({ root, retryMs: 1, timeoutMs: 5_000 }); const events: string[] = [];
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = lock.withLock('b'.repeat(64), async () => { events.push('A'); await gate; });
    await lock.waitForTicketForTest('b'.repeat(64));
    while (!events.includes('A')) await new Promise((resolve) => setTimeout(resolve, 1));
    const second = lock.withLock('b'.repeat(64), async () => { events.push('B'); });
    await new Promise((resolve) => setTimeout(resolve, 15)); expect(events).toEqual(['A']);
    release(); await Promise.all([first, second]); expect(events).toEqual(['A', 'B']);
  });

  it.each([1, 2, 3])('does not enter when a newcomer is published immediately before its final scan (%i)', async () => {
    const root = await temporaryDirectory(); const key = '9'.repeat(64); let pause!: () => void; const finalGate = new Promise<void>((resolve) => { pause = resolve; }); let held = false;
    const lock = testLock({ root, retryMs: 1, timeoutMs: 300, tokenFactory: (() => { const tokens = ['a', 'b']; return () => tokens.shift()!; })(), hook: async (stage, owner) => { if (stage === 'before-final-scan' && owner.token === 'a' && !held) { held = true; await finalGate; } } });
    const events: string[] = []; let release!: () => void; const workGate = new Promise<void>((resolve) => { release = resolve; });
    const first = lock.withLock(key, async () => { events.push('A'); await workGate; });
    while (!held) await new Promise((resolve) => setTimeout(resolve, 1));
    const second = lock.withLock(key, async () => { events.push('B'); }); await lock.waitForTicketForTest(key);
    expect(events).toEqual([]); pause(); while (!events.includes('A')) await new Promise((resolve) => setTimeout(resolve, 1)); expect(events).toEqual(['A']); release(); await Promise.all([first, second]); expect(events).toEqual(['A', 'B']);
  });

  it('fails closed when different pids reuse one token, then leaves no owner record behind', async () => {
    const root = await temporaryDirectory(); const key = '8'.repeat(64); let arrived = 0; let open!: () => void; const bothChoosing = new Promise<void>((resolve) => { open = resolve; }); const shared = { root, retryMs: 1, timeoutMs: 100, tokenFactory: () => 'same', hook: async (stage: string, owner: { phase: string }) => { if (stage !== 'after-link' || owner.phase !== 'choosing') return; arrived += 1; if (arrived === 2) open(); await bothChoosing; } };
    let entered = 0; const result = await Promise.allSettled([testLock({ ...shared, pid: 801 }).withLock(key, async () => { entered += 1; }), testLock({ ...shared, pid: 802 }).withLock(key, async () => { entered += 1; })]);
    expect(entered).toBe(0); expect(result.every((item) => item.status === 'rejected' && /identity conflict/u.test(String(item.reason)))).toBe(true);
    await expect(testLock({ root, pid: 803, tokenFactory: () => 'next' }).withLock(key, async () => 'next')).resolves.toBe('next');
  });

  it.each(['choosing', 'ticket'] as const)('two cleaners of the same stale %s remove only that exact record and serialize work', async (phase) => {
    const root = await temporaryDirectory(); const sourceKey = 'c'.repeat(64);
    let seen = 0; let open!: () => void; const observed = new Promise<void>((resolve) => { open = resolve; });
    const base = { root, retryMs: 1, timeoutMs: 300, staleAfterMs: 1, isProcessAlive: (pid: number) => pid === process.pid || pid === 301 || pid === 302, hook: async (stage: string, owner: { token: string }) => { if (stage !== 'before-stale-unlink' || owner.token !== 'dead') return; seen += 1; if (seen === 2) open(); await observed; } };
    const setup = testLock(base); await setup.createStaleForTest(sourceKey, 'dead', phase);
    const one = testLock({ ...base, pid: 301, tokenFactory: () => 'one' }); const two = testLock({ ...base, pid: 302, tokenFactory: () => 'two' });
    let active = 0; let maximum = 0; const events: string[] = [];
    await Promise.all([one.withLock(sourceKey, async () => { active += 1; maximum = Math.max(maximum, active); events.push('one'); await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; }), two.withLock(sourceKey, async () => { active += 1; maximum = Math.max(maximum, active); events.push('two'); active -= 1; })]);
    expect(maximum).toBe(1); expect(events).toHaveLength(2);
    expect(await setup.entriesForTest(sourceKey)).toEqual([]);
  });

  it.each(['choosing', 'ticket'] as const)('recovers only a dead aged %s and preserves a live one', async (phase) => {
    const root = await temporaryDirectory(); const sourceKey = 'd'.repeat(64);
    const dead = testLock({ root, timeoutMs: 100, staleAfterMs: 1, isProcessAlive: (pid) => pid === process.pid });
    await dead.createStaleForTest(sourceKey, 'dead', phase); await expect(dead.withLock(sourceKey, async () => 'ok')).resolves.toBe('ok');
    const live = testLock({ root, retryMs: 1, timeoutMs: 20, staleAfterMs: 1, isProcessAlive: () => true });
    await live.createStaleForTest(sourceKey, 'live', phase, false);
    await expect(live.withLock(sourceKey, async () => 'bad')).rejects.toThrow(/Timed out/u);
  });

  it('serializes same keys, permits different keys, and release never removes another ticket', async () => {
    const root = await temporaryDirectory(); const lock = testLock({ root, retryMs: 1, timeoutMs: 5_000 }); const events: string[] = [];
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = lock.withLock('e'.repeat(64), async () => { events.push('same'); await gate; });
    await lock.waitForTicketForTest('e'.repeat(64));
    while (!events.includes('same')) await new Promise((resolve) => setTimeout(resolve, 1));
    const second = lock.withLock('e'.repeat(64), async () => { events.push('second'); });
    const other = lock.withLock('f'.repeat(64), async () => { events.push('other'); });
    await other; expect(events).toContain('other'); expect(events).not.toContain('second'); release(); await Promise.all([first, second]);
  });

  it('fails closed for a fresh malformed visible record but recovers an aged dead exact record', async () => {
    const root = await temporaryDirectory(); const key = '1'.repeat(64); const dir = join(root, `.codegraph-${key}.coordination`);
    await mkdir(dir, { recursive: true }); const bad = join(dir, 'ticket-999999-dead.json'); await writeFile(bad, '{');
    const lock = testLock({ root, timeoutMs: 30, staleAfterMs: 10_000, isProcessAlive: () => false });
    await expect(lock.withLock(key, async () => 'no')).rejects.toThrow(/Malformed/u);
    const old = new Date(Date.now() - 20_000); await utimes(bad, old, old);
    const recovered = testLock({ root, timeoutMs: 100, staleAfterMs: 100, isProcessAlive: () => false });
    await expect(recovered.withLock(key, async () => 'yes')).resolves.toBe('yes');
  });

  it('rejects unsafe token factories and read errors instead of ignoring visible records', async () => {
    const root = await temporaryDirectory(); const key = '2'.repeat(64);
    await expect(testLock({ root, tokenFactory: () => '../escape' }).withLock(key, async () => 'no')).rejects.toThrow(/Invalid/u);
    const locked = testLock({ root, read: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } });
    await expect(locked.withLock(key, async () => 'no')).rejects.toThrow(/Unable to read/u);
  });

  it('cleans its own records after every acquire failure and permits a later contender', async () => {
    const root = await temporaryDirectory(); const key = '6'.repeat(64); const dir = join(root, `.codegraph-${key}.coordination`); await mkdir(dir, { recursive: true });
    const overflow = join(dir, 'ticket-999999-old.json'); await writeFile(overflow, JSON.stringify({ pid: 999999, token: 'old', createdAt: new Date().toISOString(), phase: 'ticket', ticketNumber: 1_000_000_000 }));
    const assertClean = async (pid: number, token: string) => expect((await readdir(dir)).filter((name) => name.includes(`-${pid}-${token}`))).toEqual([]);
    await expect(testLock({ root, pid: 611, tokenFactory: () => 'overflow', isProcessAlive: () => true }).withLock(key, async () => undefined)).rejects.toThrow(/overflow/u); await assertClean(611, 'overflow'); await unlink(overflow);
    await expect(testLock({ root, pid: 612, tokenFactory: () => 'hook', hook: (stage) => { if (stage === 'before-ticket-publish') throw new Error('hook failure'); } }).withLock(key, async () => undefined)).rejects.toThrow(/hook failure/u); await assertClean(612, 'hook');
    let links = 0; const collision = testLock({ root, pid: 613, tokenFactory: () => 'collision', link: (async (existingPath: string, newPath: string) => { links += 1; if (links === 2) throw Object.assign(new Error('exists'), { code: 'EEXIST' }); await hardLink(existingPath, newPath); }) as typeof hardLink });
    await expect(collision.withLock(key, async () => undefined)).rejects.toThrow(/collision/u); await assertClean(613, 'collision');
    const denied = testLock({ root, pid: 614, tokenFactory: () => 'denied', read: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } });
    await expect(denied.withLock(key, async () => undefined)).rejects.toThrow(/Unable to read/u); await assertClean(614, 'denied');
    const ticketDeniedRead = (async (path: unknown) => { if (String(path).includes('ticket-616-ticket-denied')) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return readFile(path as Parameters<typeof readFile>[0], 'utf8'); }) as unknown as typeof readFile;
    const ticketDenied = testLock({ root, pid: 616, tokenFactory: () => 'ticket-denied', read: ticketDeniedRead });
    await expect(ticketDenied.withLock(key, async () => undefined)).rejects.toThrow(/Unable to read/u); await assertClean(616, 'ticket-denied');
    let reads = 0; const entriesDeniedRead = (async (path: unknown) => { reads += 1; if (reads === 3) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return readdir(path as Parameters<typeof readdir>[0]); }) as unknown as typeof readdir;
    const entriesDenied = testLock({ root, pid: 617, tokenFactory: () => 'entries-denied', readdir: entriesDeniedRead });
    await expect(entriesDenied.withLock(key, async () => undefined)).rejects.toThrow(/Unable to inspect/u); await assertClean(617, 'entries-denied');
    await expect(testLock({ root, pid: 615, tokenFactory: () => 'later' }).withLock(key, async () => 'later')).resolves.toBe('later');
  });

  it('removes only aged dead private publish residue', async () => {
    const root = await temporaryDirectory(); const key = '3'.repeat(64); const dir = join(root, `.codegraph-${key}.coordination`); const residue = join(dir, '.private-ticket-999999-dead~random');
    await mkdir(dir, { recursive: true }); const old = new Date(Date.now() - 20_000); await writeFile(residue, JSON.stringify({ pid: 999999, token: 'dead', createdAt: old.toISOString(), phase: 'ticket', ticketNumber: 1 })); await utimes(residue, old, old);
    const lock = testLock({ root, staleAfterMs: 100, isProcessAlive: () => false }); await lock.withLock(key, async () => undefined);
    await expect(stat(residue)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);

  it('never deletes fresh, live, or filename-mismatched private records', async () => {
    const root = await temporaryDirectory(); const old = new Date(Date.now() - 20_000);
    const create = async (key: string, name: string, body: string, aged = false) => { const dir = join(root, `.codegraph-${key}.coordination`); await mkdir(dir, { recursive: true }); const path = join(dir, name); await writeFile(path, body); if (aged) await utimes(path, old, old); return path; };
    const freshKey = 'a'.repeat(64); const fresh = await create(freshKey, '.private-choosing-999999-fresh~uuid', '');
    await expect(testLock({ root, timeoutMs: 15, staleAfterMs: 10_000, isProcessAlive: () => false }).withLock(freshKey, async () => undefined)).rejects.toThrow(/Malformed/u); await expect(stat(fresh)).resolves.toBeDefined();
    const liveKey = 'b'.repeat(64); const live = await create(liveKey, '.private-choosing-777-live~uuid', '{}', true);
    await expect(testLock({ root, timeoutMs: 15, staleAfterMs: 1, isProcessAlive: (pid) => pid === 777 }).withLock(liveKey, async () => undefined)).rejects.toThrow(/Malformed/u); await expect(stat(live)).resolves.toBeDefined();
    const mismatchKey = 'c'.repeat(64); const mismatch = await create(mismatchKey, '.private-ticket-999999-name~uuid', JSON.stringify({ pid: 999999, token: 'other', createdAt: old.toISOString(), phase: 'ticket', ticketNumber: 1 }), true);
    await expect(testLock({ root, staleAfterMs: 1, isProcessAlive: () => false }).withLock(mismatchKey, async () => undefined)).rejects.toThrow(/Malformed/u); await expect(stat(mismatch)).resolves.toBeDefined();
    const pidMismatchKey = 'd'.repeat(64); const pidMismatch = await create(pidMismatchKey, '.private-choosing-999999-dead~uuid', JSON.stringify({ pid: 777 }), true);
    await expect(testLock({ root, staleAfterMs: 1, isProcessAlive: (pid) => pid === 777 }).withLock(pidMismatchKey, async () => undefined)).rejects.toThrow(/Malformed/u); await expect(stat(pidMismatch)).resolves.toBeDefined();
    const phaseMismatchKey = 'e'.repeat(64); const phaseMismatch = await create(phaseMismatchKey, '.private-choosing-999999-dead~uuid', JSON.stringify({ phase: 'ticket' }), true);
    await expect(testLock({ root, staleAfterMs: 1, isProcessAlive: () => false }).withLock(phaseMismatchKey, async () => undefined)).rejects.toThrow(/Malformed/u); await expect(stat(phaseMismatch)).resolves.toBeDefined();
  });

  it('recovers only aged dead partial private records whose filename identity remains trustworthy', async () => {
    const root = await temporaryDirectory(); const old = new Date(Date.now() - 20_000); const bodies = ['', '{', '{}'];
    for (const [index, body] of bodies.entries()) {
      const key = String(index + 1).repeat(64); const dir = join(root, `.codegraph-${key}.coordination`); const path = join(dir, `.private-choosing-999999-dead${index}~uuid`);
      await mkdir(dir, { recursive: true }); await writeFile(path, body); await utimes(path, old, old);
      await expect(testLock({ root, staleAfterMs: 100, isProcessAlive: () => false }).withLock(key, async () => 'ok')).resolves.toBe('ok');
      await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  }, 20_000);

  it('rolls back private and visible bytes when publication fails after creating an owner', async () => {
    const root = await temporaryDirectory(); const key = 'd'.repeat(64); const dir = join(root, `.codegraph-${key}.coordination`);
    const assertNoOwner = async (pid: number, token: string) => expect((await readdir(dir)).filter((name) => name.includes(`-${pid}-${token}`))).toEqual([]);
    const afterTemp = testLock({ root, pid: 901, tokenFactory: () => 'temp', hook: (stage) => { if (stage === 'after-temp-fsync') throw new Error('temp hook'); } });
    await expect(afterTemp.withLock(key, async () => undefined)).rejects.toThrow(/temp hook/u); await assertNoOwner(901, 'temp');
    const afterLink = testLock({ root, pid: 902, tokenFactory: () => 'link', hook: (stage) => { if (stage === 'after-link') throw new Error('link hook'); } });
    await expect(afterLink.withLock(key, async () => undefined)).rejects.toThrow(/link hook/u); await assertNoOwner(902, 'link');
    const syncFailure = testLock({ root, pid: 903, tokenFactory: () => 'sync', directorySync: async () => { throw new Error('dir sync'); } } as never);
    await expect(syncFailure.withLock(key, async () => undefined)).rejects.toThrow(/dir sync/u); await assertNoOwner(903, 'sync');
    await expect(testLock({ root, pid: 904, tokenFactory: () => 'later' }).withLock(key, async () => 'later')).resolves.toBe('later');
  });

  it('preserves a real foreign visible target when hard-link publication gets EEXIST', async () => {
    const root = await temporaryDirectory(); const key = 'e'.repeat(64); const dir = join(root, `.codegraph-${key}.coordination`); await mkdir(dir, { recursive: true });
    const foreign = join(dir, 'ticket-918-foreign.json'); const foreignRaw = JSON.stringify({ pid: 918, token: 'foreign', createdAt: new Date().toISOString(), phase: 'ticket', ticketNumber: 1 }); await writeFile(foreign, foreignRaw);
    const contender = testLock({ root, pid: 918, tokenFactory: () => 'foreign' });
    const failure = await contender.withLock(key, async () => undefined).catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: expect.stringMatching(/collision/u), cause: expect.objectContaining({ code: 'EEXIST' }) });
    await expect(readFile(foreign, 'utf8')).resolves.toBe(foreignRaw);
    expect((await readdir(dir)).filter((name) => name.includes('-918-foreign') && name !== 'ticket-918-foreign.json')).toEqual([]);
    await unlink(foreign);
    await expect(testLock({ root, pid: 919, tokenFactory: () => 'later' }).withLock(key, async () => 'later')).resolves.toBe('later');
  });

  it('keeps an in-progress hidden staging file out of coordination until its guard is atomically published', async () => {
    const root = await temporaryDirectory(); const key = 'f'.repeat(64); let opened = false; let releaseStaging!: () => void; const openedGate = new Promise<void>((resolve) => { releaseStaging = resolve; }); let releaseSecond!: () => void; const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; }); let firstEntered = false; let secondEntered = false;
    const first = testLock({ root, pid: 920, tokenFactory: () => 'first', hook: async (stage, owner) => { if (stage === 'after-temp-open' && owner.phase === 'choosing') { opened = true; await openedGate; } } }).withLock(key, async () => { firstEntered = true; return 'first'; });
    while (!opened) await new Promise((resolve) => setTimeout(resolve, 1));
    const second = testLock({ root, pid: 921, tokenFactory: () => 'second' }).withLock(key, async () => { secondEntered = true; await secondGate; return 'second'; });
    while (!secondEntered) await new Promise((resolve) => setTimeout(resolve, 1));
    releaseStaging(); await new Promise((resolve) => setTimeout(resolve, 15)); expect(firstEntered).toBe(false);
    releaseSecond(); await expect(second).resolves.toBe('second'); await expect(first).resolves.toBe('first');
  });

  it('cleans only a complete aged dead hidden staging residue', async () => {
    const root = await temporaryDirectory(); const key = 'f'.repeat(64); const dir = join(root, `.codegraph-${key}.coordination`); const old = new Date(Date.now() - 20_000); const residue = join(dir, '.staging-choosing-999999-dead~uuid');
    await mkdir(dir, { recursive: true }); await writeFile(residue, JSON.stringify({ pid: 999999, token: 'dead', createdAt: old.toISOString(), phase: 'choosing' })); await utimes(residue, old, old);
    await expect(testLock({ root, staleAfterMs: 100, isProcessAlive: () => false }).withLock(key, async () => 'ok')).resolves.toBe('ok');
    await expect(stat(residue)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);

  it('leaves fresh and live hidden staging residues inert', async () => {
    const root = await temporaryDirectory(); const key = 'f'.repeat(64); const dir = join(root, `.codegraph-${key}.coordination`); const old = new Date(Date.now() - 20_000); const fresh = join(dir, '.staging-choosing-999999-fresh~uuid'); const live = join(dir, '.staging-choosing-777-live~uuid');
    await mkdir(dir, { recursive: true }); await writeFile(fresh, JSON.stringify({ pid: 999999, token: 'fresh', createdAt: new Date().toISOString(), phase: 'choosing' })); await writeFile(live, JSON.stringify({ pid: 777, token: 'live', createdAt: old.toISOString(), phase: 'choosing' })); await utimes(live, old, old);
    await expect(testLock({ root, staleAfterMs: 100, isProcessAlive: (pid) => pid === 777 }).withLock(key, async () => 'ok')).resolves.toBe('ok');
    await expect(stat(fresh)).resolves.toBeDefined(); await expect(stat(live)).resolves.toBeDefined();
  });

  it('does not treat malformed visible or private filenames as formal lock records', async () => {
    const root = await temporaryDirectory(); const key = '7'.repeat(64); const dir = join(root, `.codegraph-${key}.coordination`); await mkdir(dir, { recursive: true });
    const names = ['ticket-999999-missing-json', '.private-ticket-999999-no-suffix', '.private-ticket-999999-wrong~'];
    await Promise.all(names.map((name) => writeFile(join(dir, name), '{')));
    await expect(testLock({ root, tokenFactory: () => 'valid' }).withLock(key, async () => 'ok')).resolves.toBe('ok');
    expect(await readdir(dir)).toEqual(expect.arrayContaining(names));
  });

  it('cleans only compatible aged dead legacy candidate and quarantine residues in the root', async () => {
    const root = await temporaryDirectory(); const key = '0'.repeat(64); const base = `.codegraph-${key}.lock`; const old = new Date(Date.now() - 20_000); const owner = (token: string, pid = 999999) => JSON.stringify({ pid, token, createdAt: old.toISOString() });
    const removable = [`${base}.candidate-dead`, `${base}.quarantine-dead-${'a'.repeat(36)}`]; const fresh = `${base}.candidate-fresh`; const live = `${base}.candidate-live`; const mismatch = `${base}.candidate-name`;
    await Promise.all(removable.map(async (name) => { await writeFile(join(root, name), owner('dead')); await utimes(join(root, name), old, old); }));
    await writeFile(join(root, fresh), owner('fresh')); await writeFile(join(root, live), owner('live', 777)); await writeFile(join(root, mismatch), owner('other'));
    const lock = testLock({ root, staleAfterMs: 100, isProcessAlive: (pid) => pid === 777 }); await lock.withLock(key, async () => undefined);
    await Promise.all(removable.map((name) => expect(stat(join(root, name))).rejects.toMatchObject({ code: 'ENOENT' })));
    await Promise.all([fresh, live, mismatch].map((name) => expect(stat(join(root, name))).resolves.toBeDefined()));
  });

  it('releases only its own ticket when another valid ticket exists', async () => {
    const root = await temporaryDirectory(); const key = '4'.repeat(64); const dir = join(root, `.codegraph-${key}.coordination`); const other = join(dir, `ticket-${process.pid}-other.json`);
    const lock = testLock({ root, tokenFactory: () => 'mine' });
    await lock.withLock(key, async () => { await writeFile(other, JSON.stringify({ pid: process.pid, token: 'other', createdAt: new Date().toISOString(), phase: 'ticket', ticketNumber: 2 })); });
    await expect(stat(other)).resolves.toBeDefined();
  });

  it('does not let another contender pass while a complete private guard is published', async () => {
    const root = await temporaryDirectory(); const key = '5'.repeat(64); let open!: () => void; const privateGate = new Promise<void>((resolve) => { open = resolve; }); let held = false;
    const lock = testLock({ root, retryMs: 1, timeoutMs: 300, tokenFactory: (() => { const tokens = ['a', 'b']; return () => tokens.shift()!; })(), hook: async (stage, owner) => { if (stage === 'after-temp-fsync' && owner.phase === 'choosing' && owner.token === 'a' && !held) { held = true; await privateGate; } } });
    const events: string[] = []; const first = lock.withLock(key, async () => { events.push('A'); });
    while (!held) await new Promise((resolve) => setTimeout(resolve, 1)); const second = lock.withLock(key, async () => { events.push('B'); });
    await new Promise((resolve) => setTimeout(resolve, 15)); expect(events).toEqual([]); open(); await Promise.all([first, second]); expect(events.sort()).toEqual(['A', 'B']);
  });
});
