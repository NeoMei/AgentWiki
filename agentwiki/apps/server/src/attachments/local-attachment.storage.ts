import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  rename,
  statfs,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { AttachmentConfig } from './attachment.config';
import type {
  AttachmentStorage,
  StoredAttachment,
} from './attachment-storage';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const TEMP_NAME_PATTERN = /^upload-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;

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
  try {
    await mkdir(path, { mode: 0o700 });
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
    await handle.chmod(0o700);
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

  constructor(config: AttachmentConfig) {
    this.root = resolve(config.storagePath);
    this.tempRoot = join(this.root, '.tmp');
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
  ): Promise<StoredAttachment> {
    if (!HASH_PATTERN.test(contentHash)) {
      throw new Error('Invalid attachment content hash');
    }
    if (sizeBytes <= 0n) {
      throw new Error('Attachment size must be positive');
    }
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

  async removeIfUnreferenced(storageKey: string): Promise<void> {
    const path = this.pathForStorageKey(storageKey);
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
