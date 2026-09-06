import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  rename,
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

export interface StagedBlobChunkUpload extends StagedBlobChunk {
  readonly sessionId: string;
  readonly contentHash: string;
  readonly stagingPath: string;
  readonly device: bigint;
  readonly inode: bigint;
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

type OpenFile = typeof open;

export interface SyncV3BlobStorageDependencies {
  openFile?: OpenFile;
}

async function openDirectory(path: string, openFile: OpenFile): Promise<FileHandle> {
  let handle: FileHandle | undefined;
  try {
    handle = await openFile(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const metadata = await handle.stat();
    if (!metadata.isDirectory()) {
      throw new Error('Sync v3 Blob staging component must be a directory');
    }
    return handle;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (isNodeError(error, 'ELOOP') || isNodeError(error, 'ENOTDIR')) {
      throw symlinkError(path, error);
    }
    throw error;
  }
}

async function ensurePrivateDirectory(path: string, openFile: OpenFile): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error, 'EEXIST')) throw error;
  }
  const pathMetadata = await lstat(path);
  if (pathMetadata.isSymbolicLink()) throw symlinkError(path);
  const handle = await openDirectory(path, openFile);
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

async function syncDirectory(path: string, openFile: OpenFile): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await openDirectory(path, openFile);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function openRegularFile(path: string, flags: number, openFile: OpenFile): Promise<{
  handle: FileHandle;
  metadata: Stats;
}> {
  let handle: FileHandle;
  try {
    handle = await openFile(path, flags | constants.O_NOFOLLOW);
  } catch (error) {
    if (isNodeError(error, 'ELOOP')) throw symlinkError(path, error);
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new Error('Sync v3 Blob staging path must be a regular file');
    }
    return { handle, metadata };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

function inputIterator(input: AsyncIterable<Uint8Array>): AsyncIterator<Uint8Array> {
  const readable = input as AsyncIterable<Uint8Array> & {
    iterator?: (options: { destroyOnReturn: boolean }) => AsyncIterator<Uint8Array>;
  };
  return readable.iterator?.({ destroyOnReturn: false }) ?? input[Symbol.asyncIterator]();
}

function drainInput(input: AsyncIterable<Uint8Array>): void {
  const readable = input as AsyncIterable<Uint8Array> & { resume?: () => unknown };
  readable.resume?.();
}

export class SyncV3BlobStorage {
  private readonly storageRoot: string;
  private readonly stagingRoot: string;

  private readonly openFile: OpenFile;

  constructor(
    storageRoot: string,
    dependencies: SyncV3BlobStorageDependencies = {},
  ) {
    this.storageRoot = resolve(storageRoot);
    this.stagingRoot = join(this.storageRoot, '.sync-v3-staging');
    this.openFile = dependencies.openFile ?? open;
  }

  async stageChunk(
    sessionId: string,
    contentHash: string,
    chunkIndex: number,
    input: AsyncIterable<Uint8Array>,
    maxBytes: number,
  ): Promise<StagedBlobChunkUpload> {
    this.assertCoordinates(sessionId, contentHash, chunkIndex);
    const byteLimit = this.byteLimit(maxBytes);
    const directory = await this.ensureSessionDirectory(sessionId, contentHash);
    const tempPath = join(directory, `.incoming-${randomUUID()}`);
    const handle = await this.openFile(
      tempPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    const digest = createHash('sha256');
    let sizeBytes = 0;
    let closed = false;
    try {
      await handle.chmod(0o600);
      const iterator = inputIterator(input);
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        const value = next.value;
        if (!(value instanceof Uint8Array)) {
          throw new SyncV3BlobStorageError(
            'ATTACHMENT_CONTENT_INVALID',
            'Blob chunks must contain binary bytes',
          );
        }
        const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        sizeBytes += bytes.length;
        if (sizeBytes > byteLimit) {
          try {
            await iterator.return?.();
          } catch {
            // Preserve the quota error; draining the readable below owns the
            // remaining request lifecycle even if an iterator cleanup hook fails.
          }
          drainInput(input);
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
      const metadata = await handle.stat({ bigint: true });
      await handle.close();
      closed = true;
      const chunkHash = digest.digest('hex');
      return {
        sessionId,
        contentHash,
        chunkIndex,
        chunkHash,
        sizeBytes,
        stagingPath: tempPath,
        device: metadata.dev,
        inode: metadata.ino,
      };
    } catch (error) {
      if (!closed) await handle.close().catch(() => undefined);
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  async commitStagedChunk(staged: StagedBlobChunkUpload): Promise<StagedBlobChunk> {
    this.assertStagedUpload(staged);
    const directory = await this.ensureSessionDirectory(staged.sessionId, staged.contentHash);
    const finalPath = join(directory, `chunk-${staged.chunkIndex}`);
    const commitPath = join(directory, `.commit-${randomUUID()}`);
    await this.verifyStagedUpload(staged);
    try {
      await link(staged.stagingPath, commitPath);
      await syncDirectory(directory, this.openFile);
      await rename(commitPath, finalPath);
      await syncDirectory(directory, this.openFile);
      await this.verifyChunkFile(finalPath, staged.chunkHash, staged.sizeBytes);
    } finally {
      await unlink(commitPath).catch((error: unknown) => {
        if (!isNodeError(error, 'ENOENT')) throw error;
      });
      await this.discardStagedChunk(staged);
    }
    return {
      chunkIndex: staged.chunkIndex,
      chunkHash: staged.chunkHash,
      sizeBytes: staged.sizeBytes,
    };
  }

  async discardStagedChunk(staged: StagedBlobChunkUpload): Promise<void> {
    this.assertStagedUpload(staged);
    await unlink(staged.stagingPath).catch((error: unknown) => {
      if (!isNodeError(error, 'ENOENT')) throw error;
    });
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
      constants.O_RDWR,
      this.openFile,
    );
    const contentDigest = createHash('sha256');
    let totalBytes = 0;
    let destinationPosition = 0;
    try {
      for (const expected of chunks) {
        const chunkPath = join(directory, `chunk-${expected.chunkIndex}`);
        const { handle, metadata } = await openRegularFile(
          chunkPath, constants.O_RDONLY, this.openFile,
        );
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
            const { bytesWritten } = await destination.write(
              bytes,
              0,
              bytes.length,
              destinationPosition,
            );
            if (bytesWritten !== bytes.length) {
              throw new Error('Blob combination write was incomplete');
            }
            destinationPosition += bytesWritten;
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
      await destination.truncate(totalBytes);
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
    await ensurePrivateDirectory(this.storageRoot, this.openFile);
    await ensurePrivateDirectory(this.stagingRoot, this.openFile);
    const key = this.sessionKey(sessionId, contentHash);
    const shard = join(this.stagingRoot, key.slice(0, 2));
    const directory = join(shard, key);
    await ensurePrivateDirectory(shard, this.openFile);
    await ensurePrivateDirectory(directory, this.openFile);
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
    const { handle, metadata } = await openRegularFile(path, constants.O_RDONLY, this.openFile);
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

  private assertStagedUpload(staged: StagedBlobChunkUpload): void {
    this.assertCoordinates(staged.sessionId, staged.contentHash, staged.chunkIndex);
    if (
      !HASH_PATTERN.test(staged.chunkHash)
      || !Number.isSafeInteger(staged.sizeBytes)
      || staged.sizeBytes <= 0
      || staged.sizeBytes > TREE_SYNC_V3_HARD_LIMITS.blobChunkBytes
      || staged.device < 0n
      || staged.inode < 0n
    ) {
      throw new SyncV3BlobStorageError('PAYLOAD_INVALID', 'Invalid staged Blob chunk');
    }
    const key = this.sessionKey(staged.sessionId, staged.contentHash);
    const directory = join(this.stagingRoot, key.slice(0, 2), key);
    if (
      dirname(staged.stagingPath) !== directory
      || !/^\.incoming-[0-9a-f-]{36}$/u.test(staged.stagingPath.slice(directory.length + 1))
    ) {
      throw new SyncV3BlobStorageError('PAYLOAD_INVALID', 'Invalid staged Blob chunk path');
    }
  }

  private async verifyStagedUpload(staged: StagedBlobChunkUpload): Promise<void> {
    const { handle, metadata } = await openRegularFile(
      staged.stagingPath, constants.O_RDONLY, this.openFile,
    );
    try {
      if (
        BigInt(metadata.dev) !== staged.device
        || BigInt(metadata.ino) !== staged.inode
      ) {
        throw new SyncV3BlobStorageError(
          'ATTACHMENT_CONTENT_INVALID',
          'Staged Blob chunk identity changed before commit',
        );
      }
      const digest = createHash('sha256');
      let sizeBytes = 0;
      const stream = handle.createReadStream({ autoClose: false, start: 0 });
      for await (const value of stream) {
        const bytes = value as Buffer;
        sizeBytes += bytes.length;
        digest.update(bytes);
      }
      if (sizeBytes !== staged.sizeBytes || digest.digest('hex') !== staged.chunkHash) {
        throw new SyncV3BlobStorageError(
          'ATTACHMENT_CONTENT_INVALID',
          'Staged Blob chunk changed before commit',
        );
      }
    } finally {
      await handle.close();
    }
  }
}
