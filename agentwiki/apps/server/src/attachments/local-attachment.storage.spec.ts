import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { cwd } from 'node:process';
import { join, resolve, sep } from 'node:path';
import { loadAttachmentConfig, type AttachmentConfig } from './attachment.config';
import { LocalAttachmentStorage } from './local-attachment.storage';
import type { AttachmentTempReservation, StoredAttachment } from './attachment-storage';

const roots = new Set<string>();

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-'));
  roots.add(root);
  return root;
}

function config(
  storagePath: string,
  overrides: Partial<AttachmentConfig> = {},
): AttachmentConfig {
  return {
    storagePath,
    maxFileBytes: 10n * 1024n * 1024n,
    maxSpaceBytes: 500n * 1024n * 1024n,
    maxDimension: 10_000,
    maxPixels: 40_000_000n,
    minFreeBytes: 1n,
    retentionMs: 30 * 24 * 60 * 60 * 1000,
    orphanGraceMs: 24 * 60 * 60 * 1000,
    contentLockTimeoutMs: 5_000,
    ...overrides,
  };
}

async function publishLocked(
  storage: LocalAttachmentStorage,
  reservation: AttachmentTempReservation,
  contentHash: string,
  sizeBytes: bigint,
): Promise<StoredAttachment> {
  return storage.withContentLock(contentHash, (lease) =>
    storage.publish(reservation, contentHash, sizeBytes, lease),
  );
}

async function reservedBytes(
  storage: LocalAttachmentStorage,
  bytes: Buffer,
): Promise<AttachmentTempReservation> {
  const reservation = await storage.createReservedTempPath(BigInt(bytes.length), 1n);
  await writeFile(reservation.path, bytes, { mode: 0o600 });
  return reservation;
}

function fakeDirectory(names: string[], onClose: () => void = () => undefined) {
  let index = 0;
  return {
    read: async () => names[index] ? { name: names[index++] } : null,
    close: async () => { onClose(); },
  };
}

describe('attachment config', () => {
  it('fails closed in production when the storage path is missing', () => {
    expect(() => loadAttachmentConfig({ NODE_ENV: 'production' })).toThrow(
      'ATTACHMENT_STORAGE_PATH',
    );
  });

  it('rejects a relative configured storage path', () => {
    expect(() =>
      loadAttachmentConfig({
        NODE_ENV: 'production',
        ATTACHMENT_STORAGE_PATH: 'relative/attachments',
      }),
    ).toThrow('absolute');
  });

  it.each(['/', '.', '..'])('rejects the broad storage path %s', (storagePath) => {
    expect(() =>
      loadAttachmentConfig({ NODE_ENV: 'production', ATTACHMENT_STORAGE_PATH: storagePath }),
    ).toThrow();
  });

  it.each([tmpdir(), '/tmp', '/var', homedir(), cwd()])(
    'rejects the broad, host, or deployment storage path %s',
    (storagePath) => {
      expect(() =>
        loadAttachmentConfig({ NODE_ENV: 'production', ATTACHMENT_STORAGE_PATH: storagePath }),
      ).toThrow('narrow');
    },
  );

  it('rejects storage inside the home, temporary, and deployment trees', () => {
    for (const storagePath of [
      join(homedir(), 'agentwiki-attachments'),
      join(tmpdir(), 'agentwiki-attachments'),
      join(cwd(), '.data', 'attachments'),
    ]) {
      expect(() =>
        loadAttachmentConfig({ NODE_ENV: 'production', ATTACHMENT_STORAGE_PATH: storagePath }),
      ).toThrow('outside');
    }
  });

  it.each([
    join(homedir(), 'agentwiki-attachment-test-home'),
    join(cwd(), 'agentwiki-attachment-test-deployment'),
  ])('does not treat a matching test basename outside tmpdir as a test root: %s', (storagePath) => {
    expect(() =>
      loadAttachmentConfig({ NODE_ENV: 'test', ATTACHMENT_STORAGE_PATH: storagePath }),
    ).toThrow('outside');
  });

  it.each([
    join(tmpdir(), 'agentwiki-attachment-test-'),
    join(tmpdir(), 'agentwiki-attachment-test-invalid.suffix'),
  ])('rejects a malformed direct test-root basename: %s', (storagePath) => {
    expect(() =>
      loadAttachmentConfig({ NODE_ENV: 'test', ATTACHMENT_STORAGE_PATH: storagePath }),
    ).toThrow('outside');
  });

  it('accepts only an actual direct mkdtemp test root and cleans that exact root', async () => {
    const storagePath = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-'));
    try {
      expect(
        loadAttachmentConfig({ NODE_ENV: 'test', ATTACHMENT_STORAGE_PATH: storagePath })
          .storagePath,
      ).toBe(storagePath);
    } finally {
      await rm(storagePath, { recursive: true, force: true });
    }
  });

  const posixTest = process.platform === 'win32' ? it.skip : it;
  posixTest('accepts the isolated macOS E2E root only in test mode', () => {
    const storagePath = '/tmp/agentwiki-mac-attachments.ABC123';

    expect(
      loadAttachmentConfig({ NODE_ENV: 'test', ATTACHMENT_STORAGE_PATH: storagePath })
        .storagePath,
    ).toBe(storagePath);
    expect(() =>
      loadAttachmentConfig({ NODE_ENV: 'production', ATTACHMENT_STORAGE_PATH: storagePath }),
    ).toThrow('narrow');
  });

  it('accepts the reviewed narrow production storage path', () => {
    expect(
      loadAttachmentConfig({
        NODE_ENV: 'production',
        ATTACHMENT_STORAGE_PATH: '/var/lib/agentwiki/attachments',
      }).storagePath,
    ).toBe(resolve('/var/lib/agentwiki/attachments'));
  });
});

describe('LocalAttachmentStorage', () => {
  afterEach(async () => {
    for (const root of roots) {
      await rm(root, { recursive: true, force: true });
      roots.delete(root);
    }
  });

  it('creates only private storage directories and temporary files', async () => {
    const parent = await makeRoot();
    const root = join(parent, 'attachments');
    const storage = new LocalAttachmentStorage(config(root));

    const tempPath = await storage.createTempPath();

    expect(tempPath.startsWith(join(root, '.tmp') + sep)).toBe(true);
    if (process.platform !== 'win32') {
      expect((await stat(root)).mode & 0o777).toBe(0o700);
      expect((await stat(join(root, '.tmp'))).mode & 0o777).toBe(0o700);
      expect((await stat(tempPath)).mode & 0o777).toBe(0o600);
    }
  });

  it('admits the exact free-space boundary and physically reserves the incoming allocation', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root), {
      availableBytes: async () => 15n,
    } as any);

    const reservation = await (storage as any).createReservedTempPath(10n, 5n);

    expect(reservation).toMatchObject({
      path: expect.stringMatching(/upload-[0-9a-f-]+\.tmp$/u),
      ownerToken: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect((await stat(reservation.path)).size).toBe(10);
    const lease = JSON.parse(await readFile(`${reservation.path}.lease`, 'utf8'));
    const metadata = await lstat(reservation.path, { bigint: true });
    expect(lease).toMatchObject({
      version: 1,
      ownerToken: reservation.ownerToken,
      tempName: expect.stringMatching(/^upload-.*\.tmp$/u),
      device: metadata.dev.toString(10),
      inode: metadata.ino.toString(10),
      createdAt: expect.any(String),
      heartbeatAt: expect.any(String),
    });
    await (storage as any).releaseTempReservation(reservation);
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
  });

  it('fails closed below the minimum-free boundary without leaving a reservation', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root), {
      availableBytes: async () => 14n,
    } as any);

    await expect((storage as any).createReservedTempPath(10n, 5n))
      .rejects.toThrow('free space');
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
  });

  it('fails closed and removes the reservation if the post-allocation probe falls below minimum free', async () => {
    const root = await makeRoot();
    const available = [15n, 4n];
    const storage = new LocalAttachmentStorage(config(root), {
      availableBytes: async () => available.shift(),
    } as any);

    await expect((storage as any).createReservedTempPath(10n, 5n))
      .rejects.toThrow('free space');
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
  });

  it('removes a partial reservation when physical allocation fails', async () => {
    const root = await makeRoot();
    const failure = new Error('allocation failed');
    const storage = new LocalAttachmentStorage(config(root), {
      availableBytes: async () => 15n,
      writeReservation: async (handle: { write: (...args: any[]) => Promise<unknown> }) => {
        await handle.write(Buffer.alloc(4), 0, 4, 0);
        throw failure;
      },
    } as any);

    await expect((storage as any).createReservedTempPath(10n, 5n)).rejects.toBe(failure);
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
  });

  it('reclaims a stopped-heartbeat crash reservation only after atomically claiming its exact lease', async () => {
    const root = await makeRoot();
    const clearReservationInterval = jest.fn();
    const owner = new LocalAttachmentStorage(config(root), {
      availableBytes: async () => 20n,
      setInterval: () => ({ unref: () => undefined } as unknown as NodeJS.Timeout),
      clearInterval: clearReservationInterval,
    } as any);
    const reservation = await (owner as any).createReservedTempPath(10n, 1n);
    const old = new Date('2026-08-20T00:00:00.000Z');
    const record = JSON.parse(await readFile(`${reservation.path}.lease`, 'utf8'));
    record.createdAt = old.toISOString();
    record.heartbeatAt = old.toISOString();
    await writeFile(`${reservation.path}.lease`, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    await utimes(reservation.path, old, old);
    await utimes(`${reservation.path}.lease`, old, old);
    let publishError: unknown;
    const bytes = Buffer.from('0123456789');
    const hash = createHash('sha256').update(bytes).digest('hex');
    let releaseError: unknown;
    let originalLeaseMissingAfterClaim = false;
    const cleaner = new LocalAttachmentStorage(config(root), {
      beforeReservationReap: async (stage: string) => {
        if (stage !== 'after-claim') return;
        originalLeaseMissingAfterClaim = await access(`${reservation.path}.lease`).then(
          () => false,
          (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
        );
        try {
          await owner.withContentLock(hash, (lease) =>
            (owner as any).publish(reservation, hash, 10n, lease));
        } catch (error) {
          publishError = error;
        }
        try {
          await (owner as any).releaseTempReservation(reservation);
        } catch (error) {
          releaseError = error;
        }
      },
    } as any);

    const removed = await (cleaner as any).cleanupExpiredTempReservations(
      new Date('2026-08-21T00:00:00.000Z'),
    );

    expect(removed).toBe(1);
    expect(publishError).toMatchObject({ message: expect.stringContaining('reservation') });
    expect(releaseError).toMatchObject({ message: expect.stringContaining('claimed') });
    expect(originalLeaseMissingAfterClaim).toBe(true);
    expect(clearReservationInterval).toHaveBeenCalledTimes(1);
    expect((owner as any).activeReservations.has(reservation)).toBe(false);
    expect(await readdir(join(root, '.tmp'))).toEqual([]);
  });

  it('keeps a reservation with a fresh heartbeat when scanned by another instance', async () => {
    const root = await makeRoot();
    const owner = new LocalAttachmentStorage(config(root), {
      availableBytes: async () => 20n,
    } as any);
    const reservation = await (owner as any).createReservedTempPath(10n, 1n);
    const cleaner = new LocalAttachmentStorage(config(root));

    const removed = await (cleaner as any).cleanupExpiredTempReservations(
      new Date(Date.now() - 1_000),
    );

    expect(removed).toBe(0);
    expect((await lstat(reservation.path)).isFile()).toBe(true);
    expect((await lstat(`${reservation.path}.lease`)).isFile()).toBe(true);
    await (owner as any).releaseTempReservation(reservation);
  });

  it('durably advances the lease heartbeat without changing its owner or inode identity', async () => {
    const root = await makeRoot();
    let now = Date.parse('2026-08-20T00:00:00.000Z');
    let heartbeat!: () => void;
    const clearReservationInterval = jest.fn();
    const storage = new LocalAttachmentStorage(config(root), {
      availableBytes: async () => 20n,
      now: () => now,
      setInterval: (callback: () => void) => {
        heartbeat = callback;
        return { unref: () => undefined } as unknown as NodeJS.Timeout;
      },
      clearInterval: clearReservationInterval,
    } as any);
    const reservation = await storage.createReservedTempPath(10n, 1n);
    const before = JSON.parse(await readFile(`${reservation.path}.lease`, 'utf8'));
    const leaseBefore = await lstat(`${reservation.path}.lease`, { bigint: true });

    now += 60_000;
    heartbeat();
    await (storage as any).activeReservations.get(reservation).heartbeatPromise;

    const after = JSON.parse(await readFile(`${reservation.path}.lease`, 'utf8'));
    const leaseAfter = await lstat(`${reservation.path}.lease`, { bigint: true });
    expect(after).toMatchObject({
      ownerToken: before.ownerToken,
      device: before.device,
      inode: before.inode,
      createdAt: before.createdAt,
      heartbeatAt: '2026-08-20T00:01:00.000Z',
    });
    expect(leaseAfter.dev).toBe(leaseBefore.dev);
    expect(leaseAfter.ino).toBe(leaseBefore.ino);
    await storage.releaseTempReservation(reservation);
    expect(clearReservationInterval).toHaveBeenCalledTimes(1);
  });

  it('does not delete an inode replacement introduced after a stale lease is claimed', async () => {
    const root = await makeRoot();
    const owner = new LocalAttachmentStorage(config(root), {
      availableBytes: async () => 20n,
      setInterval: () => ({ unref: () => undefined } as unknown as NodeJS.Timeout),
      clearInterval: () => undefined,
    } as any);
    const reservation = await (owner as any).createReservedTempPath(10n, 1n);
    const old = new Date('2026-08-20T00:00:00.000Z');
    const record = JSON.parse(await readFile(`${reservation.path}.lease`, 'utf8'));
    record.createdAt = old.toISOString();
    record.heartbeatAt = old.toISOString();
    await writeFile(`${reservation.path}.lease`, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    await utimes(reservation.path, old, old);
    await utimes(`${reservation.path}.lease`, old, old);
    const cleaner = new LocalAttachmentStorage(config(root), {
      beforeReservationReap: async (stage: string) => {
        if (stage !== 'after-claim') return;
        await rm(reservation.path);
        await writeFile(reservation.path, 'replacement', { mode: 0o600 });
      },
    } as any);

    const removed = await (cleaner as any).cleanupExpiredTempReservations(
      new Date('2026-08-21T00:00:00.000Z'),
    );

    expect(removed).toBe(0);
    expect(await readFile(reservation.path, 'utf8')).toBe('replacement');
  });

  it('leaves fresh malformed leases, unknown names, and symlinks untouched', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root));
    await storage.createTempPath();
    const tempRoot = join(root, '.tmp');
    const malformed = join(tempRoot, 'upload-11111111-1111-4111-8111-111111111111.tmp');
    const unknown = join(tempRoot, 'operator-owned.tmp');
    const outside = join(root, 'outside');
    await writeFile(malformed, 'fresh', { mode: 0o600 });
    await writeFile(`${malformed}.lease`, '{broken', { mode: 0o600 });
    await writeFile(unknown, 'unknown', { mode: 0o600 });
    await writeFile(outside, 'outside');
    await symlink(outside, join(tempRoot, 'upload-22222222-2222-4222-8222-222222222222.tmp'));
    await utimes(unknown, new Date(0), new Date(0));

    const removed = await (storage as any).cleanupExpiredTempReservations(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );

    expect(removed).toBe(0);
    expect(await readFile(malformed, 'utf8')).toBe('fresh');
    expect(await readFile(unknown, 'utf8')).toBe('unknown');
    expect(await readFile(outside, 'utf8')).toBe('outside');
  });

  it.each(['missing', 'malformed'] as const)(
    'reclaims an exact stable %s lease fallback only after the grace cutoff',
    async (kind) => {
      const root = await makeRoot();
      const storage = new LocalAttachmentStorage(config(root));
      await storage.createTempPath();
      const tempPath = join(
        root,
        '.tmp',
        `upload-33333333-3333-4333-8333-33333333333${kind === 'missing' ? '3' : '4'}.tmp`,
      );
      await writeFile(tempPath, 'crash residue', { mode: 0o600 });
      if (kind === 'malformed') {
        await writeFile(`${tempPath}.lease`, '{broken', { mode: 0o600 });
      }
      const old = new Date('2026-08-20T00:00:00.000Z');
      await utimes(tempPath, old, old);
      if (kind === 'malformed') await utimes(`${tempPath}.lease`, old, old);

      const removed = await storage.cleanupExpiredTempReservations(
        new Date('2026-08-21T00:00:00.000Z'),
      );

      expect(removed).toBe(1);
      await expect(access(tempPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(`${tempPath}.reclaim`)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('reclaims an old lease orphaned after publish moved away the base temp file', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root), {
      availableBytes: async () => 20n,
      setInterval: () => ({ unref: () => undefined } as unknown as NodeJS.Timeout),
      clearInterval: () => undefined,
    } as any);
    const reservation = await storage.createReservedTempPath(10n, 1n);
    const publishedPath = join(root, 'published-blob');
    await rename(reservation.path, publishedPath);
    const old = new Date('2026-08-20T00:00:00.000Z');
    await utimes(`${reservation.path}.lease`, old, old);

    const removed = await storage.cleanupExpiredTempReservations(
      new Date('2026-08-21T00:00:00.000Z'),
    );

    expect(removed).toBe(1);
    await expect(access(`${reservation.path}.lease`)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(publishedPath)).toEqual(Buffer.alloc(10, 0xa5));
  });

  it('reclaims an old reclaim sidecar orphaned after the base temp was unlinked', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root), {
      availableBytes: async () => 20n,
      setInterval: () => ({ unref: () => undefined } as unknown as NodeJS.Timeout),
      clearInterval: () => undefined,
    } as any);
    const reservation = await storage.createReservedTempPath(10n, 1n);
    await rename(`${reservation.path}.lease`, `${reservation.path}.reclaim`);
    await rm(reservation.path);
    const old = new Date('2026-08-20T00:00:00.000Z');
    await utimes(`${reservation.path}.reclaim`, old, old);

    const removed = await storage.cleanupExpiredTempReservations(
      new Date('2026-08-21T00:00:00.000Z'),
    );

    expect(removed).toBe(1);
    await expect(access(`${reservation.path}.reclaim`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('limits one persistent directory cursor to 100 visits and 100 physical deletes per tick', async () => {
    const root = await makeRoot();
    const tempRoot = join(root, '.tmp');
    await mkdir(tempRoot, { recursive: true, mode: 0o700 });
    const names = Array.from({ length: 101 }, (_, index) =>
      `upload-00000000-0000-4000-8000-${String(index).padStart(12, '0')}.tmp.reclaim`);
    const old = new Date('2026-08-20T00:00:00.000Z');
    for (const name of names) {
      const path = join(tempRoot, name);
      await writeFile(path, '{broken', { mode: 0o600 });
      await utimes(path, old, old);
    }
    let opens = 0;
    let closes = 0;
    const storage = new LocalAttachmentStorage(config(root), {
      openTempDirectory: async () => {
        opens += 1;
        return fakeDirectory(opens === 1 ? names : [], () => { closes += 1; });
      },
    } as any);
    const cutoff = new Date('2026-08-21T00:00:00.000Z');

    expect(await storage.cleanupExpiredTempReservations(cutoff)).toBe(100);
    await expect(access(join(tempRoot, names[100]))).resolves.toBeUndefined();
    expect(closes).toBe(0);

    expect(await storage.cleanupExpiredTempReservations(cutoff)).toBe(1);
    await expect(access(join(tempRoot, names[100]))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(closes).toBe(1);

    expect(await storage.cleanupExpiredTempReservations(cutoff)).toBe(0);
    expect(opens).toBe(2);
    expect(closes).toBe(2);
  });

  it('counts unknown and symlink entries as visits in the merged temp and sidecar scan', async () => {
    const root = await makeRoot();
    const tempRoot = join(root, '.tmp');
    await mkdir(tempRoot, { recursive: true, mode: 0o700 });
    const liveTemp = 'upload-11111111-1111-4111-8111-111111111111.tmp';
    await writeFile(join(tempRoot, liveTemp), 'live', { mode: 0o600 });
    await writeFile(join(tempRoot, `${liveTemp}.lease`), '{fresh', { mode: 0o600 });
    await writeFile(join(tempRoot, `${liveTemp}.reclaim`), '{fresh', { mode: 0o600 });
    const outside = join(root, 'outside');
    const symlinkName = 'upload-22222222-2222-4222-8222-222222222222.tmp.lease';
    await writeFile(outside, 'outside');
    await symlink(outside, join(tempRoot, symlinkName));
    const targetName = 'upload-33333333-3333-4333-8333-333333333333.tmp.lease';
    await writeFile(join(tempRoot, targetName), '{broken', { mode: 0o600 });
    const old = new Date('2026-08-20T00:00:00.000Z');
    await utimes(join(tempRoot, targetName), old, old);
    const entries = [
      ...Array.from({ length: 96 }, (_, index) => `unknown-${index}`),
      liveTemp,
      `${liveTemp}.lease`,
      `${liveTemp}.reclaim`,
      symlinkName,
      targetName,
    ];
    const storage = new LocalAttachmentStorage(config(root), {
      openTempDirectory: async () => fakeDirectory(entries),
    } as any);
    const cutoff = new Date('2026-08-21T00:00:00.000Z');

    expect(await storage.cleanupExpiredTempReservations(cutoff)).toBe(0);
    await expect(access(join(tempRoot, targetName))).resolves.toBeUndefined();

    expect(await storage.cleanupExpiredTempReservations(cutoff)).toBe(1);
    await expect(access(join(tempRoot, targetName))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(outside, 'utf8')).toBe('outside');
  });

  it('serializes concurrent cleanup calls and closes a faulted directory cursor', async () => {
    const root = await makeRoot();
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const failure = new Error('directory read failed');
    let opens = 0;
    let closes = 0;
    let signalFirstOpen!: () => void;
    const firstOpened = new Promise<void>((resolve) => { signalFirstOpen = resolve; });
    const storage = new LocalAttachmentStorage(config(root), {
      openTempDirectory: async () => {
        opens += 1;
        if (opens === 1) signalFirstOpen();
        if (opens > 1) return fakeDirectory([], () => { closes += 1; });
        let reads = 0;
        return {
          read: async () => {
            reads += 1;
            if (reads === 1) {
              await readGate;
              return { name: 'unknown' };
            }
            throw failure;
          },
          close: async () => { closes += 1; },
        };
      },
    } as any);
    const cutoff = new Date('2026-08-21T00:00:00.000Z');

    const first = storage.cleanupExpiredTempReservations(cutoff);
    const second = storage.cleanupExpiredTempReservations(cutoff);
    let openTimeout: NodeJS.Timeout | undefined;
    await Promise.race([
      firstOpened,
      new Promise<never>((_resolve, reject) => {
        openTimeout = setTimeout(() => reject(new Error('temp directory did not open')), 1_000);
      }),
    ]).finally(() => { if (openTimeout) clearTimeout(openTimeout); });
    const opensBeforeRelease = opens;
    releaseRead();

    const outcomes = await Promise.allSettled([first, second]);
    expect(opensBeforeRelease).toBe(1);
    expect(outcomes[0]).toEqual({ status: 'rejected', reason: failure });
    expect(outcomes[1]).toEqual({ status: 'fulfilled', value: 0 });
    expect(opens).toBe(2);
    expect(closes).toBe(2);
  });

  it('closes a retained temp cursor on destroy and never reopens it', async () => {
    const root = await makeRoot();
    let opens = 0;
    let closes = 0;
    const storage = new LocalAttachmentStorage(config(root), {
      openTempDirectory: async () => {
        opens += 1;
        return fakeDirectory(
          Array.from({ length: 100 }, (_, index) => `unknown-${index}`),
          () => { closes += 1; },
        );
      },
    } as any);
    const cutoff = new Date('2026-08-21T00:00:00.000Z');

    await storage.cleanupExpiredTempReservations(cutoff);
    expect(closes).toBe(0);
    await (storage as any).onModuleDestroy();
    expect(closes).toBe(1);

    expect(await storage.cleanupExpiredTempReservations(cutoff)).toBe(0);
    expect(opens).toBe(1);
  });

  it.each([
    ['owner write', { writeLockOwner: async () => { throw new Error('owner write failed'); } }],
    ['owner file sync', { syncLockOwner: async () => { throw new Error('owner sync failed'); } }],
    ['lock directory sync', { syncLockDirectory: async (_handle: unknown, stage: string) => {
      if (stage === 'after-owner') throw new Error('directory sync failed');
    } }],
  ] as const)('removes only this attempt partial lock after %s failure', async (_stage, dependencies) => {
    const root = await makeRoot();
    const hash = '9'.repeat(64);
    const lockPath = join(root, '.locks', hash.slice(0, 2), `${hash}.lock`);
    const storage = new LocalAttachmentStorage(config(root), dependencies as any);

    await expect(storage.withContentLock(hash, async () => undefined)).rejects.toThrow('failed');

    await expect(lstat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed without chmodding an overly broad pre-existing root', async () => {
    if (process.platform === 'win32') return;
    const parent = await makeRoot();
    const root = join(parent, 'attachments');
    await import('node:fs/promises').then((fs) => fs.mkdir(root, { mode: 0o755 }));
    await writeFile(join(parent, 'sentinel'), 'keep');
    const storage = new LocalAttachmentStorage(config(root));

    await expect(storage.createTempPath()).rejects.toThrow('0700');

    expect((await stat(root)).mode & 0o777).toBe(0o755);
    expect(await readFile(join(parent, 'sentinel'), 'utf8')).toBe('keep');
  });

  it('publishes identical files to one sharded hash path without replacing the first', async () => {
    const parent = await makeRoot();
    const root = join(parent, 'attachments');
    const storage = new LocalAttachmentStorage(config(root));
    const bytes = Buffer.from('identical attachment bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const firstTemp = await reservedBytes(storage, bytes);
    const secondTemp = await reservedBytes(storage, bytes);

    const first = await publishLocked(storage, firstTemp, hash, BigInt(bytes.length));
    const firstStat = await stat(join(root, first.storageKey));
    const second = await publishLocked(storage, secondTemp, hash, BigInt(bytes.length));
    const secondStat = await stat(join(root, second.storageKey));

    expect(first).toEqual({
      contentHash: hash,
      storageKey: `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`,
      sizeBytes: BigInt(bytes.length),
      created: true,
    });
    expect(second).toEqual({ ...first, created: false });
    expect(secondStat.ino).toBe(firstStat.ino);
    if (process.platform !== 'win32') expect(secondStat.mode & 0o777).toBe(0o600);
    expect(await readFile(join(root, first.storageKey))).toEqual(bytes);
    await expect(access(firstTemp.path, constants.F_OK)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(secondTemp.path, constants.F_OK)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes reservation lease sidecars after a successful publish or dedupe', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root), {
      availableBytes: async () => 1_000n,
    } as any);
    const bytes = Buffer.from('leased publish bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const first = await (storage as any).createReservedTempPath(BigInt(bytes.length), 1n);
    const second = await (storage as any).createReservedTempPath(BigInt(bytes.length), 1n);
    await writeFile(first.path, bytes);
    await writeFile(second.path, bytes);

    await storage.withContentLock(hash, async (lease) => {
      await (storage as any).publish(first, hash, BigInt(bytes.length), lease);
      await (storage as any).publish(second, hash, BigInt(bytes.length), lease);
    });

    expect(await readdir(join(root, '.tmp'))).toEqual([]);
  });

  it('marks pre-existing content as not created so DB-failure cleanup cannot delete it', async () => {
    const parent = await makeRoot();
    const root = join(parent, 'attachments');
    const storage = new LocalAttachmentStorage(config(root));
    const bytes = Buffer.from('already referenced bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const firstTemp = await reservedBytes(storage, bytes);
    const existing = await publishLocked(storage, firstTemp, hash, BigInt(bytes.length));
    const retryTemp = await reservedBytes(storage, bytes);

    const retried = await storage.withContentLock(hash, async (lease) => {
      const published = await storage.publish(
        retryTemp,
        hash,
        BigInt(bytes.length),
        lease,
      );
      if (published.created) {
        await storage.removeIfUnreferenced(published.storageKey, lease);
      }
      return published;
    });

    expect(existing.created).toBe(true);
    expect(retried.created).toBe(false);
    expect(await readFile(join(root, existing.storageKey))).toEqual(bytes);
  });

  it('serializes publish-to-metadata and reference-check-to-unlink across storage instances', async () => {
    const root = await makeRoot();
    const uploadStorage = new LocalAttachmentStorage(config(root));
    const cleanupStorage = new LocalAttachmentStorage(config(root));
    const bytes = Buffer.alloc(32 * 1024 * 1024, 0x5a);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
    const metadataReferences = new Set<string>();
    const seedTemp = await reservedBytes(uploadStorage, bytes);
    await uploadStorage.withContentLock(hash, async (lease) => {
      await uploadStorage.publish(seedTemp, hash, BigInt(bytes.length), lease);
    });

    const retryTemp = await reservedBytes(uploadStorage, bytes);
    let uploadPublished!: () => void;
    const uploadCanCommit = new Promise<void>((resolve) => {
      uploadPublished = resolve;
    });
    let allowMetadataCommit!: () => void;
    const metadataCommitAllowed = new Promise<void>((resolve) => {
      allowMetadataCommit = resolve;
    });
    let cleanupEntered = false;

    const upload = uploadStorage.withContentLock(
      hash,
      async (lease) => {
        const published = await uploadStorage.publish(
          retryTemp,
          hash,
          BigInt(bytes.length),
          lease,
        );
        expect(published.created).toBe(false);
        uploadPublished();
        await metadataCommitAllowed;
        metadataReferences.add(storageKey);
      },
    );
    await uploadCanCommit;

    const cleanup = cleanupStorage.withContentLock(
      hash,
      async (lease) => {
        cleanupEntered = true;
        if (!metadataReferences.has(storageKey)) {
          await cleanupStorage.removeIfUnreferenced(storageKey, lease);
        }
      },
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cleanupEntered).toBe(false);

    allowMetadataCommit();
    await Promise.all([upload, cleanup]);

    expect(cleanupEntered).toBe(true);
    expect(metadataReferences.has(storageKey)).toBe(true);
    expect((await stat(join(root, storageKey))).size).toBe(bytes.length);
  });

  it('bounds lock acquisition and lets an unrelated hash proceed', async () => {
    const root = await makeRoot();
    const first = new LocalAttachmentStorage(config(root, { contentLockTimeoutMs: 50 }));
    const second = new LocalAttachmentStorage(config(root, { contentLockTimeoutMs: 50 }));
    const blockedHash = 'a'.repeat(64);
    const unrelatedHash = 'b'.repeat(64);
    let unrelatedEntered = false;

    await first.withContentLock(blockedHash, async () => {
      await second.withContentLock(unrelatedHash, async () => {
        unrelatedEntered = true;
      });
      await expect(second.withContentLock(blockedHash, async () => undefined)).rejects.toThrow(
        'Timed out',
      );
    });

    expect(unrelatedEntered).toBe(true);
  });

  it('times out on a crash-residue lock without reclaiming it by age', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root, { contentLockTimeoutMs: 50 }));
    const blockedHash = 'c'.repeat(64);
    await storage.createTempPath();
    const staleLock = join(root, '.locks', blockedHash.slice(0, 2), `${blockedHash}.lock`);
    await mkdir(join(root, '.locks', blockedHash.slice(0, 2)), { mode: 0o700 });
    await mkdir(staleLock, { mode: 0o700 });
    await utimes(staleLock, new Date(0), new Date(0));

    await expect(storage.withContentLock(blockedHash, async () => undefined)).rejects.toThrow(
      'Timed out',
    );

    expect((await lstat(staleLock)).isDirectory()).toBe(true);
  });

  it('preserves a callback failure when lock cleanup also fails', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root));
    const hash = 'd'.repeat(64);
    const primary = new Error('metadata transaction failed');
    const lockPath = join(root, '.locks', hash.slice(0, 2), `${hash}.lock`);

    const rejection = storage.withContentLock(hash, async () => {
      await rm(lockPath, { recursive: true });
      await writeFile(lockPath, 'replacement');
      throw primary;
    });

    await expect(rejection).rejects.toBe(primary);
    expect((primary as Error & { cause?: NodeJS.ErrnoException }).cause?.code).toMatch(
      process.platform === 'win32' ? /^(?:ENOENT|ENOTDIR)$/u : /^ENOTDIR$/u,
    );
  });

  it('does not delete a replacement lock owned by another storage instance', async () => {
    const root = await makeRoot();
    const first = new LocalAttachmentStorage(config(root));
    const second = new LocalAttachmentStorage(config(root));
    const hash = 'e'.repeat(64);
    const lockPath = join(root, '.locks', hash.slice(0, 2), `${hash}.lock`);
    const displacedLockPath = `${lockPath}.displaced`;
    let replacementEntered!: () => void;
    const replacementEntry = new Promise<void>((resolve) => {
      replacementEntered = resolve;
    });
    let releaseReplacement!: () => void;
    const replacementRelease = new Promise<void>((resolve) => {
      releaseReplacement = resolve;
    });
    let replacement: Promise<void> | undefined;

    const original = first.withContentLock(hash, async () => {
      await rename(lockPath, displacedLockPath);
      replacement = second.withContentLock(hash, async () => {
        replacementEntered();
        await replacementRelease;
      });
      await replacementEntry;
    });

    let originalError: unknown;
    try {
      await original;
    } catch (error) {
      originalError = error;
    }
    try {
      expect(originalError).toMatchObject({ message: expect.stringContaining('ownership changed') });
      expect((await lstat(lockPath)).isDirectory()).toBe(true);
      expect((await lstat(join(lockPath, '.owner'))).isFile()).toBe(true);
    } finally {
      releaseReplacement();
      await replacement;
    }
    await expect(lstat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await lstat(displacedLockPath)).isDirectory()).toBe(true);
  });

  it('requires the exact active lease from the same storage callback', async () => {
    const root = await makeRoot();
    const first = new LocalAttachmentStorage(config(root));
    const second = new LocalAttachmentStorage(config(root));
    const bytes = Buffer.from('leased bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const tempPath = await reservedBytes(second, bytes);
    let expiredLease: Parameters<LocalAttachmentStorage['publish']>[3] | undefined;

    await first.withContentLock(hash, async (lease) => {
      expiredLease = lease;
      await expect(
        second.publish(tempPath, hash, BigInt(bytes.length), lease),
      ).rejects.toThrow('matching active');
    });

    await expect(
      first.publish(tempPath, hash, BigInt(bytes.length), expiredLease!),
    ).rejects.toThrow('matching active');
    await second.releaseTempReservation(tempPath);
  });

  it('opens, probes, and precisely removes a published content file', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root));
    const bytes = Buffer.from('streamed content');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const tempPath = await reservedBytes(storage, bytes);
    const published = await publishLocked(storage, tempPath, hash, BigInt(bytes.length));

    const stream = await storage.open(published.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    const probe = await storage.probe();
    await storage.withContentLock(hash, (lease) =>
      storage.removeIfUnreferenced(published.storageKey, lease),
    );

    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(probe.writable).toBe(true);
    expect(probe.availableBytes).toBeGreaterThan(0n);
    await expect(storage.open(published.storageKey)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(root)).isDirectory()).toBe(true);
  });

  it.each([
    '../outside',
    'sha256/ab/cd/../../outside',
    'sha256/AB/cd/' + 'a'.repeat(64),
    'sha256/aa/aa/' + 'b'.repeat(64),
    'sha256/aa/aa/' + 'a'.repeat(63),
  ])('rejects an uncontrolled storage key: %s', async (storageKey) => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root));

    await expect(storage.open(storageKey)).rejects.toThrow('storage key');
    await expect(
      storage.withContentLock('a'.repeat(64), (lease) =>
        storage.removeIfUnreferenced(storageKey, lease),
      ),
    ).rejects.toThrow('storage key');
  });

  it('rejects a symlinked configured root and does not touch its target', async () => {
    const parent = await makeRoot();
    const target = join(parent, 'target');
    const root = join(parent, 'attachments');
    await writeFile(target, 'target-bytes');
    await symlink(target, root);
    const storage = new LocalAttachmentStorage(config(root));

    await expect(storage.createTempPath()).rejects.toThrow('symbolic link');
    expect(await readFile(target, 'utf8')).toBe('target-bytes');
    expect((await lstat(root)).isSymbolicLink()).toBe(true);
  });

  it('rejects a temp-file symlink swap before publishing', async () => {
    const parent = await makeRoot();
    const root = join(parent, 'attachments');
    const outside = join(parent, 'outside');
    await writeFile(outside, 'outside-bytes');
    const storage = new LocalAttachmentStorage(config(root));
    const reservation = await reservedBytes(storage, Buffer.from('outside-bytes'));
    await rm(reservation.path);
    await symlink(outside, reservation.path);
    const hash = createHash('sha256').update('outside-bytes').digest('hex');

    await expect(
      storage.withContentLock(hash, (lease) => storage.publish(reservation, hash, 13n, lease)),
    ).rejects.toThrow();
    expect(await readFile(outside, 'utf8')).toBe('outside-bytes');
  });

  it('refuses a caller-supplied hash that does not match the temp bytes', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root));
    const tempPath = await reservedBytes(storage, Buffer.from('real bytes'));

    await expect(
      storage.withContentLock('a'.repeat(64), (lease) =>
        storage.publish(tempPath, 'a'.repeat(64), 10n, lease),
      ),
    ).rejects.toThrow('hash');
    await expect(access(join(root, 'sha256/aa/aa/' + 'a'.repeat(64)))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
