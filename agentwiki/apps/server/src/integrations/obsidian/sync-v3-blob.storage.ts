import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  rmdir,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { TREE_SYNC_V3_HARD_LIMITS } from '@neomei/agentwiki-sync-protocol';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const SUPPORTS_POSIX_PERMISSIONS = process.platform !== 'win32';

export type SyncV3BlobStorageErrorCode =
  | 'PAYLOAD_INVALID'
  | 'ATTACHMENT_CONTENT_INVALID'
  | 'ATTACHMENT_QUOTA_EXCEEDED';

export class SyncV3BlobStorageError extends Error {
  constructor(readonly code: SyncV3BlobStorageErrorCode, message: string) {
    super(message);
  }
}

export interface StagedBlobChunk {
  chunkIndex: number;
  chunkHash: string;
  sizeBytes: number;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as NodeJS.ErrnoException).code === code;
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function symlinkError(path: string, cause?: unknown): Error {
  return Object.assign(new Error(`Sync v3 Blob staging path must not be a symbolic link: ${path}`), {
    cause,
  });
}

async function openDirectory(path: string): Promise<FileHandle> {
  try {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const metadata = await handle.stat();
    if (!metadata.isDirectory()) {
      await handle.close();
      throw new Error('Sync v3 Blob staging component must be a directory');
    }
    return handle;
  } catch (error) {
    if (isNodeError(error, 'ELOOP') || isNodeError(error, 'ENOTDIR')) {
      throw symlinkError(path, error);
    }
    throw error;
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error, 'EEXIST')) throw error;
  }
  const pathMetadata = await lstat(path);
  if (pathMetadata.isSymbolicLink()) throw symlinkError(path);
  const handle = await openDirectory(path);
  try {
    const metadata = await handle.stat();
    if (SUPPORTS_POSIX_PERMISSIONS && (metadata.mode & 0o777) !== 0o700) {
      await handle.chmod(0o700);
      await handle.sync();
    }
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await openDirectory(path);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function openRegularFile(path: string, flags: number): Promise<{
  handle: FileHandle;
  metadata: Stats;
}> {
  let handle: FileHandle;
  try {
    handle = await open(path, flags | constants.O_NOFOLLOW);
  } catch (error) {
    if (isNodeError(error, 'ELOOP')) throw symlinkError(path, error);
    throw error;
  }
  const metadata = await handle.stat();
  if (!metadata.isFile()) {
    await handle.close();
    throw new Error('Sync v3 Blob staging path must be a regular file');
  }
  return { handle, metadata };
}

function destroyInput(input: AsyncIterable<Uint8Array>): void {
  const maybeStream = input as AsyncIterable<Uint8Array> & { destroy?: (error?: Error) => void };
  maybeStream.destroy?.();
}

export class SyncV3BlobStorage {
  private readonly storageRoot: string;
  private readonly stagingRoot: string;

  constructor(storageRoot: string) {
    this.storageRoot = resolve(storageRoot);
    this.stagingRoot = join(this.storageRoot, '.sync-v3-staging');
  }

  async putChunk(
    sessionId: string,
    contentHash: string,
    chunkIndex: number,
    input: AsyncIterable<Uint8Array>,
    maxBytes: number,
  ): Promise<{ chunkHash: string; sizeBytes: number }> {
    this.assertCoordinates(sessionId, contentHash, chunkIndex);
    const byteLimit = this.byteLimit(maxBytes);
    const directory = await this.ensureSessionDirectory(sessionId, contentHash);
    const finalPath = join(directory, `chunk-${chunkIndex}`);
    const tempPath = join(directory, `.incoming-${randomUUID()}`);
    const handle = await open(
      tempPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    const digest = createHash('sha256');
    let sizeBytes = 0;
    let closed = false;
    try {
      await handle.chmod(0o600);
      for await (const value of input) {
        if (!(value instanceof Uint8Array)) {
          throw new SyncV3BlobStorageError(
            'ATTACHMENT_CONTENT_INVALID',
            'Blob chunks must contain binary bytes',
          );
        }
        const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        sizeBytes += bytes.length;
        if (sizeBytes > byteLimit) {
          destroyInput(input);
          throw new SyncV3BlobStorageError(
            'ATTACHMENT_QUOTA_EXCEEDED',
            'Blob chunk exceeds the negotiated byte limit',
          );
        }
        if (bytes.length > 0) {
          const { bytesWritten } = await handle.write(bytes);
          if (bytesWritten !== bytes.length) {
            throw new Error('Blob chunk staging write was incomplete');
          }
          digest.update(bytes);
        }
      }
      if (sizeBytes === 0) {
        throw new SyncV3BlobStorageError(
          'ATTACHMENT_CONTENT_INVALID',
          'Blob chunk must not be empty',
        );
      }
      await handle.sync();
      await handle.close();
      closed = true;
      const chunkHash = digest.digest('hex');
      try {
        await link(tempPath, finalPath);
        await syncDirectory(directory);
      } catch (error) {
        if (!isNodeError(error, 'EEXIST')) throw error;
        await this.verifyChunkFile(finalPath, chunkHash, sizeBytes);
      } finally {
        await unlink(tempPath).catch((error: unknown) => {
          if (!isNodeError(error, 'ENOENT')) throw error;
        });
      }
      return { chunkHash, sizeBytes };
    } catch (error) {
      if (!closed) await handle.close().catch(() => undefined);
      await unlink(tempPath).catch(() => undefined);
      if (isNodeError(error, 'EEXIST')) {
        throw new SyncV3BlobStorageError(
          'ATTACHMENT_CONTENT_INVALID',
          'Blob chunk index already contains different bytes',
        );
      }
      throw error;
    }
  }

  async combineChunks(
    sessionId: string,
    contentHash: string,
    chunks: StagedBlobChunk[],
    destinationPath: string,
    maxBytes: number,
  ): Promise<{ contentHash: string; sizeBytes: number }> {
    this.assertCoordinates(sessionId, contentHash, 0);
    const byteLimit = Math.min(
      this.positiveSafeInteger(maxBytes, 'Blob byte limit'),
      TREE_SYNC_V3_HARD_LIMITS.maxAttachmentBytes,
    );
    if (chunks.length === 0 || chunks.length > TREE_SYNC_V3_HARD_LIMITS.maxBlobChunks) {
      throw new SyncV3BlobStorageError(
        'ATTACHMENT_CONTENT_INVALID',
        'Blob chunk receipt count is invalid',
      );
    }
    chunks.forEach((chunk, index) => {
      if (
        chunk.chunkIndex !== index
        || !HASH_PATTERN.test(chunk.chunkHash)
        || !Number.isSafeInteger(chunk.sizeBytes)
        || chunk.sizeBytes <= 0
        || chunk.sizeBytes > TREE_SYNC_V3_HARD_LIMITS.blobChunkBytes
      ) {
        throw new SyncV3BlobStorageError(
          'ATTACHMENT_CONTENT_INVALID',
          'Blob chunk receipts must be contiguous and valid',
        );
      }
    });
    const normalizedDestination = resolve(destinationPath);
    if (!normalizedDestination.startsWith(`${this.storageRoot}${sep}`)) {
      throw new SyncV3BlobStorageError(
        'PAYLOAD_INVALID',
        'Blob destination is outside protected attachment storage',
      );
    }
    const directory = await this.ensureSessionDirectory(sessionId, contentHash);
    const { handle: destination, metadata: destinationMetadata } = await openRegularFile(
      normalizedDestination,
      constants.O_RDWR | constants.O_TRUNC,
    );
    const contentDigest = createHash('sha256');
    let totalBytes = 0;
    try {
      for (const expected of chunks) {
        const chunkPath = join(directory, `chunk-${expected.chunkIndex}`);
        const { handle, metadata } = await openRegularFile(chunkPath, constants.O_RDONLY);
        const chunkDigest = createHash('sha256');
        let chunkBytes = 0;
        try {
          const stream = handle.createReadStream({ autoClose: false, start: 0 });
          for await (const value of stream) {
            const bytes = value as Buffer;
            chunkBytes += bytes.length;
            totalBytes += bytes.length;
            if (totalBytes > byteLimit) {
              stream.destroy();
              throw new SyncV3BlobStorageError(
                'ATTACHMENT_QUOTA_EXCEEDED',
                'Blob exceeds the negotiated byte limit',
              );
            }
            chunkDigest.update(bytes);
            contentDigest.update(bytes);
            const { bytesWritten } = await destination.write(bytes);
            if (bytesWritten !== bytes.length) {
              throw new Error('Blob combination write was incomplete');
            }
          }
          const current = await lstat(chunkPath);
          if (
            current.isSymbolicLink()
            || !current.isFile()
            || !sameFile(metadata, current)
            || chunkBytes !== expected.sizeBytes
            || chunkDigest.digest('hex') !== expected.chunkHash
          ) {
            throw new SyncV3BlobStorageError(
              'ATTACHMENT_CONTENT_INVALID',
              'Staged Blob chunk does not match its durable receipt',
            );
          }
        } finally {
          await handle.close();
        }
      }
      await destination.sync();
      const opened = await destination.stat();
      const current = await lstat(normalizedDestination);
      if (
        !current.isFile()
        || current.isSymbolicLink()
        || !sameFile(destinationMetadata, current)
        || !sameFile(opened, current)
        || opened.size !== totalBytes
      ) {
        throw new SyncV3BlobStorageError(
          'ATTACHMENT_CONTENT_INVALID',
          'Combined Blob destination changed during staging',
        );
      }
      return { contentHash: contentDigest.digest('hex'), sizeBytes: totalBytes };
    } finally {
      await destination.close();
    }
  }

  async cleanupBlob(sessionId: string, contentHash: string): Promise<void> {
    this.assertCoordinates(sessionId, contentHash, 0);
    const key = this.sessionKey(sessionId, contentHash);
    const directory = join(this.stagingRoot, key.slice(0, 2), key);
    for (let index = 0; index < TREE_SYNC_V3_HARD_LIMITS.maxBlobChunks; index += 1) {
      await unlink(join(directory, `chunk-${index}`)).catch((error: unknown) => {
        if (!isNodeError(error, 'ENOENT')) throw error;
      });
    }
    await rmdir(directory).catch((error: unknown) => {
      if (!isNodeError(error, 'ENOENT') && !isNodeError(error, 'ENOTEMPTY')) throw error;
    });
    await rmdir(dirname(directory)).catch((error: unknown) => {
      if (!isNodeError(error, 'ENOENT') && !isNodeError(error, 'ENOTEMPTY')) throw error;
    });
  }

  private async ensureSessionDirectory(sessionId: string, contentHash: string): Promise<string> {
    await ensurePrivateDirectory(this.storageRoot);
    await ensurePrivateDirectory(this.stagingRoot);
    const key = this.sessionKey(sessionId, contentHash);
    const shard = join(this.stagingRoot, key.slice(0, 2));
    const directory = join(shard, key);
    await ensurePrivateDirectory(shard);
    await ensurePrivateDirectory(directory);
    return directory;
  }

  private sessionKey(sessionId: string, contentHash: string): string {
    return createHash('sha256')
      .update('agentwiki:sync-v3:blob-staging\0')
      .update(sessionId)
      .update('\0')
      .update(contentHash)
      .digest('hex');
  }

  private assertCoordinates(sessionId: string, contentHash: string, chunkIndex: number): void {
    if (
      !UUID_PATTERN.test(sessionId)
      || !HASH_PATTERN.test(contentHash)
      || !Number.isSafeInteger(chunkIndex)
      || chunkIndex < 0
      || chunkIndex >= TREE_SYNC_V3_HARD_LIMITS.maxBlobChunks
    ) {
      throw new SyncV3BlobStorageError('PAYLOAD_INVALID', 'Invalid Blob staging coordinates');
    }
  }

  private byteLimit(maxBytes: number): number {
    return Math.min(
      this.positiveSafeInteger(maxBytes, 'Blob chunk byte limit'),
      TREE_SYNC_V3_HARD_LIMITS.blobChunkBytes,
    );
  }

  private positiveSafeInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SyncV3BlobStorageError('PAYLOAD_INVALID', `${name} must be positive`);
    }
    return value;
  }

  private async verifyChunkFile(
    path: string,
    expectedHash: string,
    expectedSize: number,
  ): Promise<void> {
    const { handle, metadata } = await openRegularFile(path, constants.O_RDONLY);
    const digest = createHash('sha256');
    let sizeBytes = 0;
    try {
      const stream = handle.createReadStream({ autoClose: false, start: 0 });
      for await (const value of stream) {
        const bytes = value as Buffer;
        sizeBytes += bytes.length;
        digest.update(bytes);
      }
      const current = await lstat(path);
      if (
        current.isSymbolicLink()
        || !current.isFile()
        || !sameFile(metadata, current)
        || sizeBytes !== expectedSize
        || digest.digest('hex') !== expectedHash
      ) {
        throw new SyncV3BlobStorageError(
          'ATTACHMENT_CONTENT_INVALID',
          'Blob chunk index already contains different bytes',
        );
      }
    } finally {
      await handle.close();
    }
  }
}
