import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readdir, readFile, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Phase = 'choosing' | 'ticket';
interface Owner { pid: number; token: string; createdAt: string; ticketNumber?: number; }
export interface SourceLockOptions { root: string; retryMs?: number; timeoutMs?: number; staleAfterMs?: number; now?: () => number; isProcessAlive?: (pid: number) => boolean; tokenFactory?: () => string; }
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const missing = (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === 'ENOENT';

export class SourceLock {
  private readonly retry: number; private readonly timeout: number; private readonly stale: number; private readonly now: () => number; private readonly alive: (pid: number) => boolean; private readonly token: () => string;
  constructor(private readonly options: SourceLockOptions) { this.retry = options.retryMs ?? 20; this.timeout = options.timeoutMs ?? 30_000; this.stale = options.staleAfterMs ?? 300_000; this.now = options.now ?? Date.now; this.alive = options.isProcessAlive ?? ((pid) => { try { process.kill(pid, 0); return pid > 0; } catch (e: unknown) { return typeof e === 'object' && e !== null && 'code' in e && e.code === 'EPERM'; } }); this.token = options.tokenFactory ?? randomUUID; }
  private dir(key: string) { if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error('Invalid source key for local scan lock'); return join(this.options.root, `.codegraph-${key}.coordination`); }
  private file(dir: string, phase: Phase, token: string) { return join(dir, `${phase}-${token}.json`); }
  private async read(path: string, phase: Phase, token: string): Promise<Owner | null> { let raw: string; try { raw = await readFile(path, 'utf8'); } catch (e) { if (missing(e)) return null; throw new Error('Unable to read local scan lock record', { cause: e }); } try { const owner = JSON.parse(raw) as Owner; if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || owner.token !== token || !/^[A-Za-z0-9-]{1,128}$/u.test(owner.token) || !Number.isFinite(Date.parse(owner.createdAt)) || (phase === 'ticket' && (!Number.isSafeInteger(owner.ticketNumber) || owner.ticketNumber! <= 0 || owner.ticketNumber! > Number.MAX_SAFE_INTEGER - 1)) || (phase === 'choosing' && owner.ticketNumber !== undefined)) throw new Error('invalid'); return owner; } catch { throw new Error('Malformed local scan lock record'); } }
  private isStale(owner: Owner, metadata: Awaited<ReturnType<typeof stat>>) { const age = this.now() - Math.max(Number(metadata?.mtimeMs ?? 0), Date.parse(owner.createdAt)); return Number.isFinite(age) && age >= this.stale && !this.alive(owner.pid); }
  private async entries(dir: string): Promise<Array<{ phase: Phase; owner: Owner; path: string }>> {
    let names: string[]; try { names = await readdir(dir); } catch (e) { if (missing(e)) return []; throw e; }
    const result: Array<{ phase: Phase; owner: Owner; path: string }> = [];
    for (const name of names) {
      const match = /^(choosing|ticket)-([A-Za-z0-9-]+)\.json$/u.exec(name); if (!match) continue;
      const path = join(dir, name); const owner = await this.read(path, match[1] as Phase, match[2]); if (!owner) continue;
      try { const metadata = await stat(path); if (this.isStale(owner, metadata)) { await unlink(path).catch(() => undefined); continue; } } catch { continue; }
      result.push({ phase: match[1] as Phase, owner, path });
    }
    return result;
  }
  private async publish(path: string, owner: Owner) { const temporary = `${path}.private-${owner.token}`; const handle = await open(temporary, 'wx', 0o600); try { await handle.writeFile(JSON.stringify(owner), 'utf8'); await handle.sync(); } finally { await handle.close(); } try { await link(temporary, path); } finally { await unlink(temporary).catch(() => undefined); } const dirHandle = await open(this.options.root, 'r'); try { await dirHandle.sync(); } finally { await dirHandle.close(); } }
  private async cleanupLegacy(key: string) {
    const prefix = `.codegraph-${key}.lock.`; let names: string[]; try { names = await readdir(this.options.root); } catch { return; }
    await Promise.all(names.filter((name) => name.startsWith(prefix + 'candidate-') || name.startsWith(prefix + 'quarantine-')).map(async (name) => {
      const path = join(this.options.root, name); const owner = await this.read(path, 'choosing', name.split('-').at(-1) ?? ''); if (!owner || !owner.token || !name.includes(owner.token)) return;
      try { if (this.isStale(owner, await stat(path))) await rm(path, { recursive: true, force: true }); } catch { /* retry on a later acquisition */ }
    }));
  }
  private async acquire(key: string): Promise<{ dir: string; token: string }> {
    const dir = this.dir(key); await mkdir(this.options.root, { recursive: true, mode: 0o700 }); await this.cleanupLegacy(key); await mkdir(dir, { recursive: true, mode: 0o700 }); const token = this.token(); const choosing = this.file(dir, 'choosing', token); const deadline = this.now() + this.timeout;
    await this.publish(choosing, { pid: process.pid, token, createdAt: new Date(this.now()).toISOString() });
    const before = await this.entries(dir); const ticketNumber = Math.max(0, ...before.filter((entry) => entry.phase === 'ticket').map((entry) => entry.owner.ticketNumber ?? 0)) + 1;
    const ticket = this.file(dir, 'ticket', token); await this.publish(ticket, { pid: process.pid, token, createdAt: new Date(this.now()).toISOString(), ticketNumber }); await unlink(choosing).catch(() => undefined);
    while (true) {
      const all = await this.entries(dir); const choosingOther = all.some((entry) => entry.phase === 'choosing' && entry.owner.token !== token);
      const tickets = all.filter((entry) => entry.phase === 'ticket').sort((a, b) => (a.owner.ticketNumber! - b.owner.ticketNumber!) || (a.owner.token < b.owner.token ? -1 : a.owner.token > b.owner.token ? 1 : 0));
      if (!choosingOther && tickets[0]?.owner.token === token) return { dir, token };
      if (this.now() >= deadline) { await unlink(ticket).catch(() => undefined); await unlink(choosing).catch(() => undefined); throw new Error('Timed out waiting for the local scan source lock'); }
      await sleep(this.retry);
    }
  }
  async withLock<T>(sourceKey: string, work: () => Promise<T>): Promise<T> { const owner = await this.acquire(sourceKey); try { return await work(); } finally { await unlink(this.file(owner.dir, 'ticket', owner.token)).catch(() => undefined); } }
  async waitForTicketForTest(key: string): Promise<void> { const dir = this.dir(key); for (let i = 0; i < 100; i += 1) { if ((await this.entries(dir)).some((e) => e.phase === 'ticket')) return; await sleep(1); } throw new Error('ticket not published'); }
  async createStaleForTest(key: string, token: string, phase: Phase, aged = true): Promise<void> { const dir = this.dir(key); await mkdir(dir, { recursive: true }); const owner = { pid: 999_999, token, createdAt: new Date(this.now() - (aged ? 10_000 : 0)).toISOString(), ...(phase === 'ticket' ? { ticketNumber: 1 } : {}) }; const path = this.file(dir, phase, token); await this.publish(path, owner); if (aged) { const date = new Date(this.now() - 10_000); await utimes(path, date, date); } }
  async entriesForTest(key: string): Promise<string[]> { return (await this.entries(this.dir(key))).map((entry) => entry.path); }
}
