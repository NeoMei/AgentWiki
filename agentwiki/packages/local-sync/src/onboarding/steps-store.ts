import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

export function stepsDirectory(home: string): string {
  return join(home, '.agentwiki', 'onboarding', 'steps');
}
export function stepsFile(home: string, sessionId: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sessionId))
    throw new Error('SESSION_INVALID: UUID required');
  return join(stepsDirectory(home), `${sessionId}.json`);
}
export async function writeStepState(path: string, state: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(state));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}
/** Crash recovery also covers the short-lived reaper lock; recursion is bounded. */
async function acquireLock(lock: string, depth = 0): Promise<() => Promise<void>> {
  if (depth > 8) throw new Error('SESSION_BUSY: lock recovery is busy');
  const acquire = async () => {
    const fd = await open(lock, 'wx', 0o600);
    try {
      await fd.writeFile(String(process.pid));
    } finally {
      await fd.close();
    }
  };
  try {
    await acquire();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const releaseReaper = await acquireLock(`${lock}.reap`, depth + 1);
    try {
      const pid = Number(await readFile(lock, 'utf8').catch(() => ''));
      let alive = true;
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
        }
      } else {
        // An empty file is a writer's tiny create-before-write window. Missing locks can be reacquired.
        const info = await stat(lock).catch(() => null);
        alive = info !== null && Date.now() - info.mtimeMs < 120_000;
      }
      if (alive) throw new Error('SESSION_BUSY: another command owns this session', { cause: error });
      await rm(lock, { force: true });
      try {
        await acquire();
      } catch {
        throw new Error('SESSION_BUSY: another command acquired this session');
      }
    } finally {
      await releaseReaper();
    }
  }
  return async () => {
    await rm(lock, { force: true });
  };
}
export async function withStepLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const release = await acquireLock(`${path}.lock`);
  try {
    return await action();
  } finally {
    await release();
  }
}
export async function readStepReply(path: string): Promise<unknown> {
  if (!isAbsolute(path)) throw new Error('REPLY_INVALID: absolute file path required');
  const fd = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await fd.stat();
    if (
      !info.isFile() ||
      info.size > 65536 ||
      (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
    )
      throw new Error('REPLY_INVALID: reply must be private, owned, regular, and at most 64 KiB');
    try {
      return JSON.parse(await fd.readFile('utf8'));
    } catch {
      throw new Error('REPLY_INVALID: JSON required');
    }
  } finally {
    await fd.close();
  }
}
