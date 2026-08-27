import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  rmdir,
  rename,
  statfs,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { AttachmentConfig } from './attachment.config';
import type {
  AttachmentStorage,
  AttachmentContentLease,
  StoredAttachment,
} from './attachment-storage';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const TEMP_NAME_PATTERN = /^upload-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;

interface OwnedContentLock {
  lockPath: string;
  ownerPath: string;
  token: string;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function errorWithCause(message: string, cause: unknown): Error {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

function attachCleanupCause(primary: unknown, cleanupError: unknown): void {
  if (typeof primary !== 'object' || primary === null) {
    return;
  }
  try {
    const error = primary as { cause?: unknown; attachmentLockCleanupError?: unknown };
    if (error.cause === undefined) {
      error.cause = cleanupError;
    } else {
      error.attachmentLockCleanupError = cleanupError;
    }
  } catch {
    // A frozen callback error remains the primary failure even when diagnostics
    // cannot be attached to it.
  }
}

async function openDirectorySafely(path: string): Promise<FileHandle> {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const metadata = await handle.stat();
  if (!metadata.isDirectory()) {
    await handle.close();
    throw new Error(`Attachment storage path is not a directory: ${path}`);
  }
  return handle;
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  let created = false;
  try {
    await mkdir(path, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (!isNodeError(error, 'EEXIST')) {
      throw error;
    }
  }

  const pathMetadata = await lstat(path);
  if (pathMetadata.isSymbolicLink()) {
    throw new Error(`Attachment storage path must not be a symbolic link: ${path}`);
  }

  let handle: FileHandle;
  try {
    handle = await openDirectorySafely(path);
  } catch (error) {
    if (isNodeError(error, 'ELOOP') || isNodeError(error, 'ENOTDIR')) {
      throw errorWithCause(
        `Attachment storage path must not be a symbolic link: ${path}`,
        error,
      );
    }
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if ((metadata.mode & 0o777) !== 0o700) {
      throw new Error(`Attachment storage directory must have mode 0700: ${path}`);
    }
    if (created) {
      await handle.sync();
    }
  } finally {
    await handle.close();
  }
}

async function hashHandle(handle: FileHandle): Promise<string> {
  const digest = createHash('sha256');
  const stream = handle.createReadStream({ autoClose: false, start: 0 });
  for await (const chunk of stream) {
    digest.update(chunk as Buffer);
  }
  return digest.digest('hex');
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export class LocalAttachmentStorage implements AttachmentStorage {
  private readonly root: string;
  private readonly tempRoot: string;
  private readonly lockRoot: string;
  private readonly activeLeases = new WeakMap<AttachmentContentLease, OwnedContentLock>();

  constructor(private readonly config: AttachmentConfig) {
    this.root = resolve(config.storagePath);
    this.tempRoot = join(this.root, '.tmp');
    this.lockRoot = join(this.root, '.locks');
  }

  async createTempPath(): Promise<string> {
    await this.ensureBaseDirectories();
    const tempPath = join(this.tempRoot, `upload-${randomUUID()}.tmp`);
    const handle = await open(
      tempPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.chmod(0o600);
    } finally {
      await handle.close();
    }
    return tempPath;
  }

  async publish(
    tempPath: string,
    contentHash: string,
    sizeBytes: bigint,
    lease: AttachmentContentLease,
  ): Promise<StoredAttachment> {
    if (!HASH_PATTERN.test(contentHash)) {
      throw new Error('Invalid attachment content hash');
    }
    if (sizeBytes <= 0n) {
      throw new Error('Attachment size must be positive');
    }
    this.assertLease(lease, contentHash);
    this.assertTempPath(tempPath);
    await this.ensureBaseDirectories();

    let tempHandle: FileHandle;
    try {
      tempHandle = await open(
        tempPath,
        constants.O_RDWR | constants.O_NOFOLLOW,
      );
    } catch (error) {
      if (isNodeError(error, 'ELOOP')) {
        throw errorWithCause('Attachment temp path must not be a symbolic link', error);
      }
      throw error;
    }

    try {
      const metadata = await tempHandle.stat();
      if (!metadata.isFile()) {
        throw new Error('Attachment temp path must be a regular file');
      }
      if (BigInt(metadata.size) !== sizeBytes) {
        throw new Error('Attachment size does not match the temp file');
      }
      if ((await hashHandle(tempHandle)) !== contentHash) {
        throw new Error('Attachment content hash does not match the temp file');
      }
      await tempHandle.chmod(0o600);
      await tempHandle.sync();

      const storageKey = this.storageKey(contentHash);
      const finalPath = this.pathForStorageKey(storageKey);
      const finalDirectory = dirname(finalPath);
      await this.ensureHashDirectories(contentHash);
      const stagingPath = join(finalDirectory, `.${contentHash}.${randomUUID()}.tmp`);

      await rename(tempPath, stagingPath);
      let created = false;
      try {
        try {
          await link(stagingPath, finalPath);
          created = true;
          const published = await lstat(finalPath);
          const opened = await tempHandle.stat();
          if (!published.isFile() || !sameFile(published, opened)) {
            await unlink(finalPath).catch(() => undefined);
            throw new Error('Attachment temp file changed while publishing');
          }
        } catch (error) {
          if (!isNodeError(error, 'EEXIST')) {
            throw error;
          }
          await this.verifyExisting(finalPath, contentHash, sizeBytes);
        }
      } finally {
        await unlink(stagingPath).catch((error: unknown) => {
          if (!isNodeError(error, 'ENOENT')) {
            throw error;
          }
        });
      }
      await this.syncDirectory(finalDirectory);

      return { contentHash, storageKey, sizeBytes, created };
    } finally {
      await tempHandle.close();
    }
  }

  async withContentLock<T>(
    contentHash: string,
    work: (lease: AttachmentContentLease) => Promise<T>,
  ): Promise<T> {
    if (!HASH_PATTERN.test(contentHash)) {
      throw new Error('Invalid attachment content hash');
    }
    await this.ensureBaseDirectories();
    const firstShard = join(this.lockRoot, contentHash.slice(0, 2));
    await ensurePrivateDirectory(firstShard);
    const lockPath = join(firstShard, `${contentHash}.lock`);
    const ownedLock = await this.acquireLockDirectory(
      lockPath,
      this.config.contentLockTimeoutMs,
    );
    const lease = Object.freeze({ contentHash });
    this.activeLeases.set(lease, ownedLock);
    let callbackFailed = false;
    let callbackError: unknown;
    let result: T | undefined;
    try {
      result = await work(lease);
    } catch (error) {
      callbackFailed = true;
      callbackError = error;
    }
    this.activeLeases.delete(lease);
    try {
      await this.releaseLockDirectory(ownedLock);
    } catch (cleanupError) {
      if (callbackFailed) {
        attachCleanupCause(callbackError, cleanupError);
        throw callbackError;
      }
      throw cleanupError;
    }
    if (callbackFailed) {
      throw callbackError;
    }
    return result as T;
  }

  async open(storageKey: string): Promise<NodeJS.ReadableStream> {
    const path = this.pathForStorageKey(storageKey);
    let handle: FileHandle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (isNodeError(error, 'ELOOP')) {
        throw errorWithCause('Attachment content path must not be a symbolic link', error);
      }
      throw error;
    }
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      await handle.close();
      throw new Error('Attachment content path must be a regular file');
    }
    return handle.createReadStream({ autoClose: true, start: 0 });
  }

  async removeIfUnreferenced(
    storageKey: string,
    lease: AttachmentContentLease,
  ): Promise<void> {
    const path = this.pathForStorageKey(storageKey);
    const contentHash = storageKey.slice(storageKey.lastIndexOf('/') + 1);
    this.assertLease(lease, contentHash);
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        return;
      }
      throw error;
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('Attachment content path must be a regular file');
    }
    await unlink(path);
    await this.syncDirectory(dirname(path));
  }

  async probe(): Promise<{ writable: true; availableBytes: bigint }> {
    const probePath = await this.createTempPath();
    await unlink(probePath);
    const filesystem = await statfs(this.root, { bigint: true });
    return {
      writable: true,
      availableBytes: filesystem.bavail * filesystem.bsize,
    };
  }

  private async ensureBaseDirectories(): Promise<void> {
    await ensurePrivateDirectory(this.root);
    await ensurePrivateDirectory(this.tempRoot);
    await ensurePrivateDirectory(this.lockRoot);
  }

  private async acquireLockDirectory(
    lockPath: string,
    timeoutMs: number,
  ): Promise<OwnedContentLock> {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        const directoryHandle = await openDirectorySafely(lockPath);
        try {
          const metadata = await directoryHandle.stat();
          if ((metadata.mode & 0o777) !== 0o700) {
            throw new Error(`Attachment content lock must have mode 0700: ${lockPath}`);
          }
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
        const token = randomUUID();
        const ownerPath = join(lockPath, '.owner');
        const ownerHandle = await open(
          ownerPath,
          constants.O_CREAT |
            constants.O_EXCL |
            constants.O_RDWR |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await ownerHandle.writeFile(token, 'utf8');
          await ownerHandle.chmod(0o600);
          await ownerHandle.sync();
        } finally {
          await ownerHandle.close();
        }
        await this.syncDirectory(lockPath);
        await this.syncDirectory(dirname(lockPath));
        return { lockPath, ownerPath, token };
      } catch (error) {
        if (!isNodeError(error, 'EEXIST')) {
          throw error;
        }
        let existing;
        try {
          existing = await lstat(lockPath);
        } catch (statError) {
          if (isNodeError(statError, 'ENOENT')) {
            continue;
          }
          throw statError;
        }
        if (!existing.isDirectory() || existing.isSymbolicLink()) {
          throw errorWithCause('Attachment content lock path is unsafe', error);
        }
        const remainingMs = deadline - performance.now();
        if (remainingMs <= 0) {
          throw errorWithCause('Timed out acquiring attachment content lock', error);
        }
        await new Promise<void>((resolveWait) =>
          setTimeout(resolveWait, Math.min(10, remainingMs)),
        );
      }
    }
  }

  private async releaseLockDirectory(ownedLock: OwnedContentLock): Promise<void> {
    const ownerHandle = await open(
      ownedLock.ownerPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const metadata = await ownerHandle.stat();
      if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
        throw new Error('Attachment content lock ownership file is unsafe');
      }
      const token = await ownerHandle.readFile('utf8');
      if (token !== ownedLock.token) {
        throw new Error('Attachment content lock ownership changed before release');
      }
    } finally {
      await ownerHandle.close();
    }
    await unlink(ownedLock.ownerPath);
    await rmdir(ownedLock.lockPath);
    await this.syncDirectory(dirname(ownedLock.lockPath));
  }

  private assertLease(lease: AttachmentContentLease, contentHash: string): void {
    if (!this.activeLeases.has(lease) || lease.contentHash !== contentHash) {
      throw new Error('A matching active attachment content lease is required');
    }
  }

  private async ensureHashDirectories(contentHash: string): Promise<void> {
    const algorithmRoot = join(this.root, 'sha256');
    const firstShard = join(algorithmRoot, contentHash.slice(0, 2));
    const secondShard = join(firstShard, contentHash.slice(2, 4));
    await ensurePrivateDirectory(algorithmRoot);
    await ensurePrivateDirectory(firstShard);
    await ensurePrivateDirectory(secondShard);
  }

  private storageKey(contentHash: string): string {
    return `sha256/${contentHash.slice(0, 2)}/${contentHash.slice(2, 4)}/${contentHash}`;
  }

  private pathForStorageKey(storageKey: string): string {
    const match = /^sha256\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{64})$/.exec(
      storageKey,
    );
    if (!match || match[1] !== match[3].slice(0, 2) || match[2] !== match[3].slice(2, 4)) {
      throw new Error('Invalid attachment storage key');
    }
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(this.root + sep)) {
      throw new Error('Invalid attachment storage key');
    }
    return path;
  }

  private assertTempPath(tempPath: string): void {
    const resolved = resolve(tempPath);
    if (
      dirname(resolved) !== this.tempRoot ||
      !TEMP_NAME_PATTERN.test(basename(resolved))
    ) {
      throw new Error('Invalid attachment temp path');
    }
  }

  private async verifyExisting(
    finalPath: string,
    contentHash: string,
    sizeBytes: bigint,
  ): Promise<void> {
    let handle: FileHandle;
    try {
      handle = await open(finalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (isNodeError(error, 'ELOOP')) {
        throw errorWithCause(
          'Existing attachment content must not be a symbolic link',
          error,
        );
      }
      throw error;
    }
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || BigInt(metadata.size) !== sizeBytes) {
        throw new Error('Existing attachment content does not match its storage key');
      }
      if ((await hashHandle(handle)) !== contentHash) {
        throw new Error('Existing attachment content does not match its storage key');
      }
    } finally {
      await handle.close();
    }
  }

  private async syncDirectory(path: string): Promise<void> {
    const handle = await openDirectorySafely(path);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
