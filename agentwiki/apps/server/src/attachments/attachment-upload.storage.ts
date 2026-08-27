import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import type { StorageEngine } from 'multer';
import type { AttachmentConfig } from './attachment.config';
import type {
  AttachmentStorage,
  AttachmentTempReservation,
  StoredUpload,
} from './attachment-storage';
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

interface CapacityCoordinatorDependencies {
  timeoutMs?: number;
  now?: () => number;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

const CAPACITY_LOCK_SQL =
  'SELECT pg_try_advisory_xact_lock(1096243028, 1) AS acquired';
const CAPACITY_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 120_000 } as const;

export class PostgresAttachmentCapacityCoordinator
implements AttachmentCapacityCoordinator {
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly sleep: (delayMs: number) => Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    dependencies: CapacityCoordinatorDependencies = {},
  ) {
    this.timeoutMs = dependencies.timeoutMs ?? 30_000;
    this.now = dependencies.now ?? Date.now;
    this.random = dependencies.random ?? Math.random;
    this.sleep = dependencies.sleep ?? ((delayMs) =>
      new Promise<void>((resolveWait) => setTimeout(resolveWait, delayMs)));
  }

  async withLock<T>(work: () => Promise<T>): Promise<T> {
    const deadline = this.now() + this.timeoutMs;
    let delayMs = 10;
    let attempted = false;
    for (;;) {
      if (attempted && this.now() >= deadline) {
        throw new Error('Timed out acquiring attachment capacity admission lock');
      }
      attempted = true;
      const attempt = await this.prisma.$transaction(async (transaction) => {
        const rows = await transaction.$queryRawUnsafe<Array<{ acquired: boolean }>>(
          CAPACITY_LOCK_SQL,
        );
        if (rows.length !== 1 || typeof rows[0]?.acquired !== 'boolean') {
          throw new Error('Attachment capacity admission lock returned an invalid result');
        }
        if (!rows[0].acquired) return { acquired: false } as const;
        return { acquired: true, value: await work() } as const;
      }, CAPACITY_TRANSACTION_OPTIONS);
      if (attempt.acquired) return attempt.value;

      const remainingMs = deadline - this.now();
      if (remainingMs <= 0) {
        throw new Error('Timed out acquiring attachment capacity admission lock');
      }
      const jittered = Math.max(1, Math.floor(delayMs * (1 + this.random() * 0.25)));
      await this.sleep(Math.min(jittered, remainingMs));
      delayMs = Math.min(delayMs * 2, 250);
    }
  }
}

export class AttachmentUploadStorage implements StorageEngine {
  private readonly pendingReservations = new WeakMap<
    Express.Multer.File,
    AttachmentTempReservation
  >();

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
    let reservation: AttachmentTempReservation | undefined;
    let handle;
    let size = 0n;
    try {
      await this.capacity.withLock(async () => {
        reservation = await this.storage.createReservedTempPath(
          this.config.maxFileBytes,
          this.config.minFreeBytes,
        );
      });
      if (!reservation) {
        throw new Error('Attachment capacity reservation did not return a temp path');
      }
      const tempPath = reservation.path;
      this.pendingReservations.set(file, reservation);
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
        attachmentTempReservation: reservation,
      } as Partial<StoredUpload>;
    } catch (error) {
      this.pendingReservations.delete(file);
      if (reservation) {
        await this.storage.releaseTempReservation(reservation);
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
    const reservation = this.pendingReservations.get(file);
    if (!reservation || file.path !== reservation.path) {
      throw new Error('Invalid attachment temp path');
    }
    const metadata = await lstat(reservation.path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('Attachment temp path must not be a symbolic link');
    }
    await this.storage.releaseTempReservation(reservation);
    this.pendingReservations.delete(file);
  }
}
