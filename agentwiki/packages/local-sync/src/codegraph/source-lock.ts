import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface LockOwner { pid: number; createdAt: string; token?: string; }
interface ObservedOwner { raw: string | null; token: string | null; pid: number | null; createdAt: number | null; mtimeMs: number; }

export interface SourceLockOptions {
  root: string;
  retryMs?: number;
  timeoutMs?: number;
  staleAfterMs?: number;
  now?: () => number;
  isProcessAlive?: (pid: number) => boolean;
  /** Test seam for a contender taking the path between inspection and quarantine. */
  beforeQuarantine?: (path: string) => void | Promise<void>;
}

const DEFAULT_RETRY_MS = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 5 * 60_000;

function sleep(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function validSourceKey(sourceKey: string): void { if (!/^[a-f0-9]{64}$/u.test(sourceKey)) throw new Error('Invalid source key for local scan lock'); }

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error: unknown) { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM'; }
}

function sameOwner(left: ObservedOwner, right: ObservedOwner): boolean {
  if (left.token !== null) return left.token === right.token;
  return right.token === null && left.raw === right.raw;
}

function isExistingDirectoryError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY');
}

/** A filesystem lock scoped to one source. Ownership is published atomically only after its token exists. */
export class SourceLock {
  private readonly retryMs: number;
  private readonly timeoutMs: number;
  private readonly staleAfterMs: number;
  private readonly now: () => number;
  private readonly isProcessAlive: (pid: number) => boolean;

  constructor(private readonly options: SourceLockOptions) {
    this.retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.now = options.now ?? Date.now;
    this.isProcessAlive = options.isProcessAlive ?? processIsAlive;
  }

  private path(sourceKey: string): string { validSourceKey(sourceKey); return join(this.options.root, `.codegraph-${sourceKey}.lock`); }

  private async observe(path: string): Promise<ObservedOwner | null> {
    try {
      const metadata = await stat(path);
      const raw = await readFile(metadata.isDirectory() ? join(path, 'owner.json') : path, 'utf8')
        .catch((error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT' ? null : Promise.reject(error));
      if (raw === null) return { raw: null, token: null, pid: null, createdAt: null, mtimeMs: metadata.mtimeMs };
      try {
        const parsed = JSON.parse(raw) as LockOwner;
        const token = typeof parsed.token === 'string' && parsed.token.length > 0 ? parsed.token : null;
        const pid = Number.isInteger(parsed.pid) && parsed.pid > 0 ? parsed.pid : null;
        const timestamp = typeof parsed.createdAt === 'string' ? Date.parse(parsed.createdAt) : Number.NaN;
        return { raw, token, pid, createdAt: Number.isFinite(timestamp) ? timestamp : null, mtimeMs: metadata.mtimeMs };
      } catch { return { raw, token: null, pid: null, createdAt: null, mtimeMs: metadata.mtimeMs }; }
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  private stale(owner: ObservedOwner): boolean {
    const age = this.now() - Math.max(owner.mtimeMs, owner.createdAt ?? Number.NEGATIVE_INFINITY);
    return Number.isFinite(age) && age >= this.staleAfterMs && (owner.pid === null || !this.isProcessAlive(owner.pid));
  }

  private async recoverStale(path: string): Promise<boolean> {
    const observed = await this.observe(path);
    if (!observed || !this.stale(observed)) return false;
    await this.options.beforeQuarantine?.(path);
    const quarantine = `${path}.quarantine-${randomUUID()}`;
    try { await rename(path, quarantine); } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false;
      return false;
    }
    const moved = await this.observe(quarantine);
    if (moved && sameOwner(observed, moved)) {
      await rm(quarantine, { recursive: true, force: true });
      return true;
    }
    // A different contender was moved after our stale observation. New-format
    // locks are files, so hard-link restoration is create-if-absent and cannot
    // overwrite another lock that appeared while we were checking the token.
    try {
      if ((await stat(quarantine)).isFile()) {
        await link(quarantine, path);
        await unlink(quarantine);
      }
    } catch { /* retain unknown quarantine rather than destroying live state */ }
    return false;
  }

  private async acquire(sourceKey: string): Promise<{ path: string; token: string }> {
    const path = this.path(sourceKey);
    await mkdir(this.options.root, { recursive: true, mode: 0o700 });
    const deadline = this.now() + this.timeoutMs;
    while (true) {
      const token = randomUUID();
      const candidate = `${path}.candidate-${token}`;
      try {
        // Hard-link publication is create-if-absent: unlike rename it cannot
        // replace a live file or an empty legacy lock directory.
        await writeFile(candidate, JSON.stringify({ pid: process.pid, createdAt: new Date(this.now()).toISOString(), token }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await link(candidate, path);
        await unlink(candidate);
        return { path, token };
      } catch (error: unknown) {
        await rm(candidate, { recursive: true, force: true });
        if (!isExistingDirectoryError(error)) throw error;
        await this.recoverStale(path);
        if (this.now() >= deadline) throw new Error('Timed out waiting for the local scan source lock');
        await sleep(this.retryMs);
      }
    }
  }

  async withLock<T>(sourceKey: string, work: () => Promise<T>): Promise<T> {
    const owner = await this.acquire(sourceKey);
    try {
      return await work();
    } finally {
      const current = await this.observe(owner.path);
      if (current?.token === owner.token) await rm(owner.path, { recursive: true, force: true });
    }
  }

  async createForTest(sourceKey: string, owner: LockOwner): Promise<void> {
    const path = this.path(sourceKey);
    await mkdir(this.options.root, { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify({ ...owner, token: owner.token ?? randomUUID() }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }

  async readForTest(sourceKey: string): Promise<LockOwner | null> {
    try {
      const path = this.path(sourceKey);
      return JSON.parse(await readFile((await stat(path)).isDirectory() ? join(path, 'owner.json') : path, 'utf8')) as LockOwner;
    } catch { return null; }
  }
}
