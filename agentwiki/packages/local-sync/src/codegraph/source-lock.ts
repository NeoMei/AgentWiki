import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface LockOwner { pid: number; createdAt: string; }

export interface SourceLockOptions {
  root: string;
  retryMs?: number;
  timeoutMs?: number;
  staleAfterMs?: number;
  now?: () => number;
  isProcessAlive?: (pid: number) => boolean;
}

const DEFAULT_RETRY_MS = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 5 * 60_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validSourceKey(sourceKey: string): void {
  if (!/^[a-f0-9]{64}$/u.test(sourceKey)) throw new Error('Invalid source key for local scan lock');
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM';
  }
}

/** A filesystem lock scoped to one source identity; it never replaces a live owner's lock. */
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

  private path(sourceKey: string): string {
    validSourceKey(sourceKey);
    return join(this.options.root, `.codegraph-${sourceKey}.lock`);
  }

  private async recoverStale(path: string): Promise<boolean> {
    let owner: LockOwner;
    let metadata;
    try {
      [owner, metadata] = await Promise.all([
        readFile(join(path, 'owner.json'), 'utf8').then((text) => JSON.parse(text) as LockOwner),
        stat(path),
      ]);
    } catch {
      return false;
    }
    const createdAt = Date.parse(owner.createdAt);
    const age = this.now() - Math.max(metadata.mtimeMs, createdAt);
    if (!Number.isFinite(age) || age < this.staleAfterMs || this.isProcessAlive(owner.pid)) return false;
    try {
      await rm(path, { recursive: true, force: false });
      return true;
    } catch {
      return false;
    }
  }

  private async acquire(sourceKey: string): Promise<string> {
    const path = this.path(sourceKey);
    await mkdir(this.options.root, { recursive: true, mode: 0o700 });
    const deadline = this.now() + this.timeoutMs;
    while (true) {
      try {
        await mkdir(path, { mode: 0o700 });
        await writeFile(join(path, 'owner.json'), JSON.stringify({ pid: process.pid, createdAt: new Date(this.now()).toISOString() }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        return path;
      } catch (error: unknown) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST')) throw error;
        await this.recoverStale(path);
        if (this.now() >= deadline) throw new Error('Timed out waiting for the local scan source lock');
        await sleep(this.retryMs);
      }
    }
  }

  async withLock<T>(sourceKey: string, work: () => Promise<T>): Promise<T> {
    const path = await this.acquire(sourceKey);
    try {
      return await work();
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  }

  /** Test-only helper for verifying stale-owner behavior without process races. */
  async createForTest(sourceKey: string, owner: LockOwner): Promise<void> {
    const path = this.path(sourceKey);
    await mkdir(path, { recursive: true, mode: 0o700 });
    await writeFile(join(path, 'owner.json'), JSON.stringify(owner), { encoding: 'utf8', mode: 0o600 });
  }
}
