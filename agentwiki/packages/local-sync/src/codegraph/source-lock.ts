import { randomUUID } from 'node:crypto';
import { link, mkdir, readdir, readFile, rename, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

interface LockOwner { pid: number; createdAt: string; token?: string; }
interface ObservedOwner { raw: string; pid: number | null; token: string | null; createdAt: number | null; mtimeMs: number; }

export interface SourceLockOptions {
  root: string; retryMs?: number; timeoutMs?: number; staleAfterMs?: number; now?: () => number; isProcessAlive?: (pid: number) => boolean;
  beforeQuarantine?: (path: string) => void | Promise<void>;
  beforeRestore?: () => void | Promise<void>;
}

const DEFAULT_RETRY_MS = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 5 * 60_000;
const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const exists = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY');
const missing = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return pid > 0; } catch (error: unknown) { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM'; }
}

/** Serializes one source with a recovery fence around every stale-lock decision. */
export class SourceLock {
  private readonly retryMs: number; private readonly timeoutMs: number; private readonly staleAfterMs: number; private readonly now: () => number; private readonly isProcessAlive: (pid: number) => boolean;
  constructor(private readonly options: SourceLockOptions) {
    this.retryMs = options.retryMs ?? DEFAULT_RETRY_MS; this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS; this.now = options.now ?? Date.now; this.isProcessAlive = options.isProcessAlive ?? processIsAlive;
  }
  private path(sourceKey: string): string { if (!/^[a-f0-9]{64}$/u.test(sourceKey)) throw new Error('Invalid source key for local scan lock'); return join(this.options.root, `.codegraph-${sourceKey}.lock`); }
  private fence(path: string): string { return `${path}.recovery-fence`; }
  private async observe(path: string): Promise<ObservedOwner | null> {
    try {
      const metadata = await stat(path);
      const raw = await readFile(metadata.isDirectory() ? join(path, 'owner.json') : path, 'utf8').catch((error: unknown) => missing(error) ? '' : Promise.reject(error));
      try {
        const parsed = JSON.parse(raw) as Partial<LockOwner>;
        return { raw, pid: Number.isInteger(parsed.pid) && parsed.pid! > 0 ? parsed.pid! : null, token: typeof parsed.token === 'string' && parsed.token.length > 0 ? parsed.token : null, createdAt: typeof parsed.createdAt === 'string' && Number.isFinite(Date.parse(parsed.createdAt)) ? Date.parse(parsed.createdAt) : null, mtimeMs: metadata.mtimeMs };
      } catch { return { raw, pid: null, token: null, createdAt: null, mtimeMs: metadata.mtimeMs }; }
    } catch (error) { if (missing(error)) return null; throw error; }
  }
  private stale(owner: ObservedOwner): boolean { const age = this.now() - Math.max(owner.mtimeMs, owner.createdAt ?? Number.NEGATIVE_INFINITY); return Number.isFinite(age) && age >= this.staleAfterMs && (owner.pid === null || !this.isProcessAlive(owner.pid)); }
  private async publish(path: string, owner: LockOwner): Promise<boolean> {
    if (!owner.token) throw new Error('Lock owner token is required');
    const candidate = `${path}.candidate-${owner.token}`;
    try { await writeFile(candidate, JSON.stringify(owner), { encoding: 'utf8', mode: 0o600, flag: 'wx' }); await link(candidate, path); await unlink(candidate); return true; }
    catch (error) { await rm(candidate, { force: true }); if (exists(error)) return false; throw error; }
  }
  private async removeIfOwned(path: string, owner: ObservedOwner): Promise<boolean> {
    const current = await this.observe(path);
    if (!current || current.token !== owner.token || current.raw !== owner.raw) return false;
    await rm(path, { recursive: true, force: false });
    return true;
  }
  private async cleanupResidues(path: string): Promise<void> {
    const prefix = `${basename(path)}.`;
    let entries: string[]; try { entries = await readdir(this.options.root); } catch (error) { if (missing(error)) return; throw error; }
    await Promise.all(entries.filter((name) => name.startsWith(prefix + 'candidate-') || name.startsWith(prefix + 'quarantine-')).map(async (name) => {
      const residue = join(this.options.root, name); const owner = await this.observe(residue);
      if (!owner || owner.token === null || !this.stale(owner)) return;
      if (!name.includes(owner.token)) return;
      await this.removeIfOwned(residue, owner).catch(() => undefined);
    }));
  }
  private async acquireFence(path: string, deadline: number): Promise<LockOwner> {
    const fence = this.fence(path);
    while (true) {
      await this.cleanupResidues(path);
      const owner = { pid: process.pid, createdAt: new Date(this.now()).toISOString(), token: randomUUID() };
      if (await this.publish(fence, owner)) return owner;
      const existing = await this.observe(fence);
      if (existing && this.stale(existing)) await this.removeIfOwned(fence, existing).catch(() => undefined);
      if (this.now() >= deadline) throw new Error('Timed out waiting for the local scan source lock');
      await sleep(this.retryMs);
    }
  }
  private async release(path: string, token: string): Promise<void> { const owner = await this.observe(path); if (owner?.token === token) await this.removeIfOwned(path, owner).catch(() => undefined); }
  private async recoverUnderFence(path: string, observed: ObservedOwner): Promise<void> {
    await this.options.beforeQuarantine?.(path);
    const quarantine = `${path}.quarantine-${observed.token ?? 'legacy'}-${randomUUID()}`;
    try { await rename(path, quarantine); } catch (error) { if (missing(error)) return; throw error; }
    const moved = await this.observe(quarantine);
    if (moved?.token === observed.token && moved.raw === observed.raw) { await rm(quarantine, { recursive: true, force: true }); return; }
    await this.options.beforeRestore?.();
    // The recovery fence remains held, so this create-if-absent restoration has
    // no interval in which another protocol claimant can begin work.
    if (moved?.token !== null) { try { await link(quarantine, path); await unlink(quarantine); } catch { /* retain unknown quarantine */ } }
  }
  private async acquire(sourceKey: string): Promise<{ path: string; token: string }> {
    const path = this.path(sourceKey); await mkdir(this.options.root, { recursive: true, mode: 0o700 }); const deadline = this.now() + this.timeoutMs;
    while (true) {
      const fenceOwner = await this.acquireFence(path, deadline);
      try {
        const current = await this.observe(path);
        if (!current) {
          const owner = { pid: process.pid, createdAt: new Date(this.now()).toISOString(), token: randomUUID() };
          if (await this.publish(path, owner)) return { path, token: owner.token };
        } else if (this.stale(current)) {
          await this.recoverUnderFence(path, current);
        }
      } finally { await this.release(this.fence(path), fenceOwner.token!); }
      if (this.now() >= deadline) throw new Error('Timed out waiting for the local scan source lock');
      await sleep(this.retryMs);
    }
  }
  async withLock<T>(sourceKey: string, work: () => Promise<T>): Promise<T> { const owner = await this.acquire(sourceKey); try { return await work(); } finally { await this.release(owner.path, owner.token); } }
  async createForTest(sourceKey: string, owner: LockOwner): Promise<void> { await mkdir(this.options.root, { recursive: true, mode: 0o700 }); await writeFile(this.path(sourceKey), JSON.stringify({ ...owner, token: owner.token ?? randomUUID() }), { encoding: 'utf8', mode: 0o600, flag: 'wx' }); }
  async readForTest(sourceKey: string): Promise<LockOwner | null> { try { return JSON.parse(await readFile(this.path(sourceKey), 'utf8')) as LockOwner; } catch { return null; } }
  async createResidueForTest(sourceKey: string, kind: 'candidate' | 'quarantine', owner: LockOwner): Promise<void> { const path = `${this.path(sourceKey)}.${kind}-${owner.token}`; await mkdir(this.options.root, { recursive: true, mode: 0o700 }); await writeFile(path, JSON.stringify(owner), { encoding: 'utf8', mode: 0o600 }); const time = new Date(owner.createdAt); if (!Number.isNaN(time.valueOf())) await utimes(path, time, time); }
  async cleanupResiduesForTest(sourceKey: string): Promise<void> { await this.cleanupResidues(this.path(sourceKey)); }
  async residuesForTest(sourceKey: string): Promise<string[]> { const prefix = `${basename(this.path(sourceKey))}.`; return (await readdir(this.options.root)).filter((name) => name.startsWith(prefix + 'candidate-') || name.startsWith(prefix + 'quarantine-')).sort(); }
}
