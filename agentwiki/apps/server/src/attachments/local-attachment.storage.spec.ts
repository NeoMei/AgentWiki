import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
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
import { join } from 'node:path';
import { loadAttachmentConfig, type AttachmentConfig } from './attachment.config';
import { LocalAttachmentStorage } from './local-attachment.storage';
import type { StoredAttachment } from './attachment-storage';

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
  tempPath: string,
  contentHash: string,
  sizeBytes: bigint,
): Promise<StoredAttachment> {
  return storage.withContentLock(contentHash, (lease) =>
    storage.publish(tempPath, contentHash, sizeBytes, lease),
  );
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

  it('accepts the reviewed narrow production storage path', () => {
    expect(
      loadAttachmentConfig({
        NODE_ENV: 'production',
        ATTACHMENT_STORAGE_PATH: '/var/lib/agentwiki/attachments',
      }).storagePath,
    ).toBe('/var/lib/agentwiki/attachments');
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

    expect(tempPath.startsWith(join(root, '.tmp') + '/')).toBe(true);
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, '.tmp'))).mode & 0o777).toBe(0o700);
    expect((await stat(tempPath)).mode & 0o777).toBe(0o600);
  });

  it('fails closed without chmodding an overly broad pre-existing root', async () => {
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
    const firstTemp = await storage.createTempPath();
    const secondTemp = await storage.createTempPath();
    await writeFile(firstTemp, bytes, { mode: 0o600 });
    await writeFile(secondTemp, bytes, { mode: 0o600 });

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
    expect(secondStat.mode & 0o777).toBe(0o600);
    expect(await readFile(join(root, first.storageKey))).toEqual(bytes);
    await expect(access(firstTemp, constants.F_OK)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(secondTemp, constants.F_OK)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('marks pre-existing content as not created so DB-failure cleanup cannot delete it', async () => {
    const parent = await makeRoot();
    const root = join(parent, 'attachments');
    const storage = new LocalAttachmentStorage(config(root));
    const bytes = Buffer.from('already referenced bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const firstTemp = await storage.createTempPath();
    await writeFile(firstTemp, bytes);
    const existing = await publishLocked(storage, firstTemp, hash, BigInt(bytes.length));
    const retryTemp = await storage.createTempPath();
    await writeFile(retryTemp, bytes);

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
    const seedTemp = await uploadStorage.createTempPath();
    await writeFile(seedTemp, bytes);
    await uploadStorage.withContentLock(hash, async (lease) => {
      await uploadStorage.publish(seedTemp, hash, BigInt(bytes.length), lease);
    });

    const retryTemp = await uploadStorage.createTempPath();
    await writeFile(retryTemp, bytes);
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
    expect((primary as Error & { cause?: unknown }).cause).toMatchObject({ code: 'ENOTDIR' });
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
    const tempPath = await second.createTempPath();
    await writeFile(tempPath, bytes);
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
  });

  it('opens, probes, and precisely removes a published content file', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root));
    const bytes = Buffer.from('streamed content');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const tempPath = await storage.createTempPath();
    await writeFile(tempPath, bytes);
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
    const tempPath = await storage.createTempPath();
    await rm(tempPath);
    await symlink(outside, tempPath);
    const hash = createHash('sha256').update('outside-bytes').digest('hex');

    await expect(
      storage.withContentLock(hash, (lease) => storage.publish(tempPath, hash, 13n, lease)),
    ).rejects.toThrow();
    expect(await readFile(outside, 'utf8')).toBe('outside-bytes');
  });

  it('refuses a caller-supplied hash that does not match the temp bytes', async () => {
    const root = await makeRoot();
    const storage = new LocalAttachmentStorage(config(root));
    const tempPath = await storage.createTempPath();
    await writeFile(tempPath, 'real bytes');

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
