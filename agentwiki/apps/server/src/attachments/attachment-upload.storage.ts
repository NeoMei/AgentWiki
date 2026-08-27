import { constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import type { StorageEngine } from 'multer';
import type { AttachmentConfig } from './attachment.config';
import type { AttachmentStorage } from './attachment-storage';
import { PrismaService } from '../database/prisma.service';

type StorageCallback = (
  error: Error | null,
  info?: Partial<Express.Multer.File>,
) => void;

function fileSizeError(field: string): Error & { code: 'LIMIT_FILE_SIZE' } {
  const error = new Error('File too large') as Error & { code: 'LIMIT_FILE_SIZE' };
  error.name = 'MulterError';
  error.code = 'LIMIT_FILE_SIZE';
  Object.assign(error, { field });
  return error;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

export interface AttachmentCapacityCoordinator {
  withLock<T>(work: () => Promise<T>): Promise<T>;
}

export class PostgresAttachmentCapacityCoordinator
implements AttachmentCapacityCoordinator {
  constructor(private readonly prisma: PrismaService) {}

  withLock<T>(work: () => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(1096243028, 1)',
      );
      return work();
    }, {
      maxWait: 30_000,
      timeout: 120_000,
    });
  }
}

export class AttachmentUploadStorage implements StorageEngine {
  private readonly pendingPaths = new WeakMap<Express.Multer.File, string>();

  constructor(
    private readonly storage: AttachmentStorage,
    private readonly config: AttachmentConfig,
    private readonly capacity: AttachmentCapacityCoordinator,
  ) {}

  _handleFile(
    _request: Request,
    file: Express.Multer.File,
    callback: StorageCallback,
  ): void {
    void this.store(file).then(
      (info) => callback(null, info),
      (error: unknown) => callback(error as Error),
    );
  }

  _removeFile(
    _request: Request,
    file: Express.Multer.File,
    callback: (error: Error | null) => void,
  ): void {
    void this.remove(file).then(
      () => callback(null),
      (error: unknown) => callback(error as Error),
    );
  }

  private async store(file: Express.Multer.File): Promise<Partial<Express.Multer.File>> {
    let tempPath: string | undefined;
    let handle;
    let size = 0n;
    try {
      await this.capacity.withLock(async () => {
        tempPath = await this.storage.createReservedTempPath(
          this.config.maxFileBytes,
          this.config.minFreeBytes,
        );
      });
      if (!tempPath) {
        throw new Error('Attachment capacity reservation did not return a temp path');
      }
      this.pendingPaths.set(file, tempPath);
      handle = await open(
        tempPath,
        constants.O_RDWR | constants.O_NOFOLLOW,
      );
      await handle.chmod(0o600);
      const byteLimit = this.config.maxFileBytes;
      const uploadHandle = handle;
      let writeOffset = 0;
      const limiter = new Transform({
        transform(chunk: Buffer | string, encoding, done) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
          size += BigInt(bytes.length);
          if (size > byteLimit) {
            done(fileSizeError(file.fieldname));
            return;
          }
          done(null, bytes);
        },
      });
      const writer = new Writable({
        write(chunk: Buffer | string, encoding, done) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
          void uploadHandle.write(bytes, 0, bytes.length, writeOffset).then(
            ({ bytesWritten }) => {
              if (bytesWritten !== bytes.length) {
                done(new Error('Attachment upload write was incomplete'));
                return;
              }
              writeOffset += bytesWritten;
              done();
            },
            (error: unknown) => done(error as Error),
          );
        },
      });
      await pipeline(
        file.stream,
        limiter,
        writer,
      );
      if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Uploaded file size cannot be represented safely');
      }
      await handle.truncate(Number(size));
      await handle.sync();
      return {
        fieldname: file.fieldname,
        originalname: file.originalname,
        encoding: file.encoding,
        mimetype: file.mimetype,
        path: tempPath,
        size: Number(size),
      };
    } catch (error) {
      this.pendingPaths.delete(file);
      if (tempPath) {
        await unlink(tempPath).catch((unlinkError: unknown) => {
          if (!isNodeError(unlinkError, 'ENOENT')) {
            throw unlinkError;
          }
        });
      }
      throw error;
    } finally {
      await handle?.close().catch((closeError: unknown) => {
        if (!isNodeError(closeError, 'EBADF')) {
          throw closeError;
        }
      });
    }
  }

  private async remove(file: Express.Multer.File): Promise<void> {
    const tempPath = this.pendingPaths.get(file);
    if (!tempPath || file.path !== tempPath) {
      throw new Error('Invalid attachment temp path');
    }
    const metadata = await lstat(tempPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('Attachment temp path must not be a symbolic link');
    }
    await unlink(tempPath);
    this.pendingPaths.delete(file);
  }
}
