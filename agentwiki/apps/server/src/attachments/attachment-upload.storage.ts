import { constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import type { StorageEngine } from 'multer';
import type { AttachmentConfig } from './attachment.config';
import type { AttachmentStorage } from './attachment-storage';

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

export class AttachmentUploadStorage implements StorageEngine {
  private readonly pendingPaths = new WeakMap<Express.Multer.File, string>();

  constructor(
    private readonly storage: AttachmentStorage,
    private readonly config: AttachmentConfig,
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
    const tempPath = await this.storage.createTempPath();
    this.pendingPaths.set(file, tempPath);
    let handle;
    let size = 0n;
    try {
      handle = await open(
        tempPath,
        constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW,
      );
      await handle.chmod(0o600);
      const byteLimit = this.config.maxFileBytes;
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
      await pipeline(
        file.stream,
        limiter,
        handle.createWriteStream({ autoClose: true }),
      );
      handle = undefined;
      if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('Uploaded file size cannot be represented safely');
      }
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
      await unlink(tempPath).catch((unlinkError: unknown) => {
        if (!isNodeError(unlinkError, 'ENOENT')) {
          throw unlinkError;
        }
      });
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
