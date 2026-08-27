import { Logger } from '@nestjs/common';
import { mkdtemp, mkdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AttachmentConfig } from './attachment.config';
import { AttachmentCleanupWorker } from './attachment-cleanup.worker';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('AttachmentCleanupWorker', () => {
  const roots = new Set<string>();
  const workers = new Set<AttachmentCleanupWorker>();
  const now = new Date('2026-08-27T12:00:00.000Z');

  const configFor = (storagePath: string): AttachmentConfig => ({
    storagePath,
    maxFileBytes: 10n * 1024n * 1024n,
    maxSpaceBytes: 500n * 1024n * 1024n,
    maxDimension: 10_000,
    maxPixels: 40_000_000n,
    minFreeBytes: 1024n * 1024n * 1024n,
    retentionMs: 30 * DAY_MS,
    orphanGraceMs: DAY_MS,
    contentLockTimeoutMs: 5_000,
  });

  const createRoot = async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-'));
    roots.add(root);
    return root;
  };

  const createWorker = (
    storagePath: string,
    options: {
      role?: string;
      pollMs?: number;
      archived?: Array<Record<string, unknown>>;
      referenceCount?: number;
      referenceCountFor?: (storageKey: string) => number;
    } = {},
  ) => {
    const events: string[] = [];
    const tx = {
      spaceAttachment: {
        deleteMany: jest.fn(async () => {
          events.push('metadata-delete');
          return { count: 1 };
        }),
      },
    };
    const prisma = {
      spaceAttachment: {
        findMany: jest.fn().mockResolvedValue(options.archived ?? []),
        count: jest.fn(async ({ where }: { where: { storageKey: string } }) => {
          events.push('reference-check');
          if (options.referenceCountFor) return options.referenceCountFor(where.storageKey);
          return options.referenceCount ?? 0;
        }),
      },
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const runtimeConfig = {
      get: jest.fn((key: string) => {
        if (key === 'PROCESS_ROLE') return options.role ?? 'worker';
        if (key === 'ATTACHMENT_CLEANUP_POLL_MS') return options.pollMs;
        return undefined;
      }),
    };
    const storage = {
      withContentLock: jest.fn(async (_hash: string, work: (lease: object) => unknown) => {
        events.push('lock-start');
        const result = await work(Object.freeze({ contentHash: _hash }));
        events.push('lock-end');
        return result;
      }),
      removeIfUnreferenced: jest.fn(async () => {
        events.push('physical-remove');
      }),
    };
    const worker = new AttachmentCleanupWorker(
      prisma as any,
      runtimeConfig as any,
      storage as any,
      configFor(storagePath),
    );
    workers.add(worker);
    return { worker, prisma, tx, storage, events };
  };

  beforeEach(() => {
    jest.useFakeTimers({ now });
  });

  afterEach(async () => {
    for (const worker of workers) await worker.onModuleDestroy();
    workers.clear();
    jest.restoreAllMocks();
    for (const root of roots) {
      await rm(root, { recursive: true, force: true });
    }
    roots.clear();
    jest.useRealTimers();
  });

  it('does not create a timer or run cleanup in the API role', async () => {
    jest.useFakeTimers({ now });
    const root = await createRoot();
    const { worker, prisma } = createWorker(root, { role: 'api' });

    await worker.onModuleInit();
    await jest.runOnlyPendingTimersAsync();

    expect((worker as any).timer).toBeUndefined();
    expect(prisma.spaceAttachment.findMany).not.toHaveBeenCalled();
  });

  it('runs an immediate worker tick and then polls every 60 minutes by default', async () => {
    jest.useFakeTimers({ now });
    const root = await createRoot();
    const { worker } = createWorker(root);
    const tick = jest.spyOn(worker as any, 'safeTick').mockResolvedValue(undefined);

    await worker.onModuleInit();
    expect(tick).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(HOUR_MS);
    expect(tick).toHaveBeenCalledTimes(2);
    worker.onModuleDestroy();
  });

  it('accepts the largest delay supported by Node timers without clamping', () => {
    const { worker } = createWorker('/tmp/agentwiki-attachment-test-timer-boundary', {
      pollMs: 2_147_483_647,
    });
    const interval = jest.spyOn(global, 'setInterval');

    worker.onModuleInit();

    expect(interval).toHaveBeenCalledWith(expect.any(Function), 2_147_483_647);
  });

  it('fails closed before scheduling when the configured delay exceeds the Node timer maximum', () => {
    const { worker } = createWorker('/tmp/agentwiki-attachment-test-timer-overflow', {
      pollMs: 2_147_483_648,
    });
    const interval = jest.spyOn(global, 'setInterval');

    expect(() => worker.onModuleInit()).toThrow('ATTACHMENT_CLEANUP_POLL_MS');
    expect(interval).not.toHaveBeenCalled();
  });

  it('suppresses an overlapping tick', async () => {
    const root = await createRoot();
    const { worker, prisma } = createWorker(root);
    let release!: () => void;
    prisma.spaceAttachment.findMany.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve([]);
      }),
    );

    const first = worker.tick();
    const second = worker.tick();
    await Promise.resolve();

    expect(prisma.spaceAttachment.findMany).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
  });

  it('uses the 30-day cutoff and batch 100, commits metadata deletion before the locked final reference check and unlink', async () => {
    const root = await createRoot();
    const hash = 'a'.repeat(64);
    const archivedAt = new Date(now.getTime() - 31 * DAY_MS);
    const { worker, prisma, tx, storage, events } = createWorker(root, {
      archived: [{ id: 'attachment-1', contentHash: hash, storageKey: `sha256/aa/aa/${hash}`, archivedAt }],
    });

    await worker.tick();

    expect(prisma.spaceAttachment.findMany).toHaveBeenCalledWith({
      where: { status: 'archived', archivedAt: { lte: new Date(now.getTime() - 30 * DAY_MS) } },
      orderBy: [{ archivedAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true, contentHash: true, storageKey: true, archivedAt: true },
    });
    expect(tx.spaceAttachment.deleteMany).toHaveBeenCalledWith({
      where: { id: 'attachment-1', status: 'archived', archivedAt: { lte: new Date(now.getTime() - 30 * DAY_MS) } },
    });
    expect(storage.withContentLock).toHaveBeenCalledWith(hash, expect.any(Function));
    expect(events).toEqual([
      'metadata-delete',
      'lock-start',
      'reference-check',
      'physical-remove',
      'lock-end',
    ]);
  });

  it('retains a shared blob when another metadata row references its storage key', async () => {
    const root = await createRoot();
    const hash = 'b'.repeat(64);
    const { worker, storage } = createWorker(root, {
      referenceCount: 1,
      archived: [{
        id: 'attachment-1',
        contentHash: hash,
        storageKey: `sha256/bb/bb/${hash}`,
        archivedAt: new Date(now.getTime() - 31 * DAY_MS),
      }],
    });

    await worker.tick();

    expect(storage.removeIfUnreferenced).not.toHaveBeenCalled();
  });

  it('only scans old regular non-symlink blobs in validated sha256 paths and bounds orphan cleanup to 100', async () => {
    const root = await createRoot();
    const validDirectory = join(root, 'sha256', 'aa', 'aa');
    await mkdir(validDirectory, { recursive: true });
    const oldTime = new Date(now.getTime() - DAY_MS - 1);
    for (let index = 0; index < 101; index += 1) {
      const hash = `aaaa${index.toString(16).padStart(60, '0')}`;
      const path = join(validDirectory, hash);
      await writeFile(path, 'orphan');
      await utimes(path, oldTime, oldTime);
    }
    const freshHash = `aaaa${'f'.repeat(60)}`;
    await writeFile(join(validDirectory, freshHash), 'fresh');
    const symlinkHash = `aaaa${'e'.repeat(60)}`;
    await symlink(join(validDirectory, freshHash), join(validDirectory, symlinkHash));
    await writeFile(join(validDirectory, 'not-a-hash'), 'invalid');
    const wrongShard = join(root, 'sha256', 'bb', 'bb');
    await mkdir(wrongShard, { recursive: true });
    await writeFile(join(wrongShard, `cccc${'d'.repeat(60)}`), 'wrong shard');
    const staleLock = join(root, '.locks', 'cc', `${'c'.repeat(64)}.lock`);
    await mkdir(staleLock, { recursive: true });
    await writeFile(join(staleLock, '.owner'), 'operator-owned-stale-lock');
    await utimes(staleLock, new Date(0), new Date(0));

    const { worker, storage } = createWorker(root);
    await worker.tick();

    expect(storage.removeIfUnreferenced.mock.calls.length).toBeGreaterThan(0);
    expect(storage.removeIfUnreferenced.mock.calls.length).toBeLessThanOrEqual(100);
    const removals = storage.removeIfUnreferenced.mock.calls as unknown as Array<[string, object]>;
    for (const [storageKey] of removals) {
      expect(storageKey).toMatch(/^sha256\/aa\/aa\/aaaa[0-9a-f]{60}$/u);
      expect(storageKey).not.toContain(freshHash);
      expect(storageKey).not.toContain(symlinkHash);
    }
    await expect(stat(staleLock)).resolves.toMatchObject({});
  });

  it('advances its bounded scan so an orphan after 100 referenced old files is reached on a later tick', async () => {
    const root = await createRoot();
    const validDirectory = join(root, 'sha256', 'dd', 'dd');
    await mkdir(validDirectory, { recursive: true });
    const oldTime = new Date(now.getTime() - DAY_MS - 1);
    const hashes = Array.from({ length: 101 }, (_, index) =>
      `dddd${index.toString(16).padStart(60, '0')}`,
    );
    for (const hash of hashes) {
      const path = join(validDirectory, hash);
      await writeFile(path, 'old blob');
      await utimes(path, oldTime, oldTime);
    }
    let referenceChecks = 0;
    const { worker, storage } = createWorker(root, {
      referenceCountFor: () => {
        referenceChecks += 1;
        return referenceChecks <= 100 ? 1 : 0;
      },
    });

    await worker.tick();
    expect(storage.removeIfUnreferenced).not.toHaveBeenCalled();
    expect((worker as any).orphanIterator).toBeDefined();

    await worker.tick();

    expect(referenceChecks).toBe(101);
    expect(storage.removeIfUnreferenced).toHaveBeenCalledTimes(1);
    expect(storage.removeIfUnreferenced).toHaveBeenCalledWith(
      expect.stringMatching(/^sha256\/dd\/dd\/d{4}[0-9a-f]{60}$/u),
      expect.any(Object),
    );
    await worker.onModuleDestroy();
    expect((worker as any).orphanIterator).toBeUndefined();
  });

  it('shuts down while a real orphan generator next is pending without replacing it or doing later work', async () => {
    const root = await createRoot();
    const hash = 'f'.repeat(64);
    const absolutePath = join(root, 'sha256', 'ff', 'ff', hash);
    await mkdir(join(root, 'sha256', 'ff', 'ff'), { recursive: true });
    await writeFile(absolutePath, 'old orphan');
    const oldTime = new Date(now.getTime() - DAY_MS - 1);
    await utimes(absolutePath, oldTime, oldTime);
    const { worker, prisma, storage } = createWorker(root);
    let releaseNext!: () => void;
    let signalNextStarted!: () => void;
    const nextStarted = new Promise<void>((resolve) => { signalNextStarted = resolve; });
    const pendingNext = new Promise<void>((resolve) => { releaseNext = resolve; });
    let generators = 0;
    let generatorsClosed = 0;
    async function* controlledScan() {
      generators += 1;
      try {
        signalNextStarted();
        await pendingNext;
        yield {
          candidate: {
            absolutePath,
            contentHash: hash,
            storageKey: `sha256/ff/ff/${hash}`,
          },
        };
      } finally {
        generatorsClosed += 1;
      }
    }
    jest.spyOn(worker as any, 'scanOrphanEntries').mockImplementation(controlledScan);

    const activeTick = worker.tick();
    await nextStarted;
    const firstDestroy = worker.onModuleDestroy();
    const repeatedDestroy = worker.onModuleDestroy();
    expect(repeatedDestroy).toBe(firstDestroy);
    let destroySettled = false;
    void firstDestroy.then(() => { destroySettled = true; });
    await Promise.resolve();
    expect(destroySettled).toBe(false);

    releaseNext();
    await Promise.all([activeTick, firstDestroy, repeatedDestroy]);
    const finishedDestroy = worker.onModuleDestroy();
    expect(finishedDestroy).toBe(firstDestroy);
    await finishedDestroy;
    await worker.tick();
    await (worker as any).safeTick();

    expect(generators).toBe(1);
    expect(generatorsClosed).toBe(1);
    expect((worker as any).orphanIterator).toBeUndefined();
    expect(prisma.spaceAttachment.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.spaceAttachment.count).not.toHaveBeenCalled();
    expect(storage.withContentLock).not.toHaveBeenCalled();
    expect(storage.removeIfUnreferenced).not.toHaveBeenCalled();
  });

  it('closes and resets the stateful orphan iterator after a scan error', async () => {
    const root = await createRoot();
    const { worker } = createWorker(root);
    const iteratorFailure = new Error('directory scan failed');
    const iterator = {
      next: jest.fn().mockRejectedValue(iteratorFailure),
      return: jest.fn().mockResolvedValue({ done: true, value: undefined }),
    };
    (worker as any).orphanIterator = iterator;

    await expect(worker.tick()).rejects.toBe(iteratorFailure);

    expect(iterator.return).toHaveBeenCalledTimes(1);
    expect((worker as any).orphanIterator).toBeUndefined();
  });

  it('logs storage failures without crashing the process', async () => {
    const root = await createRoot();
    const { worker, prisma } = createWorker(root);
    prisma.spaceAttachment.findMany.mockRejectedValueOnce(new Error('storage metadata unavailable'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect((worker as any).safeTick()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Attachment cleanup tick failed: storage metadata unavailable'),
    );
  });
});
