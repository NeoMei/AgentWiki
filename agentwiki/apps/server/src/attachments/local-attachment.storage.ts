import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants, type BigIntStats, type Stats } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
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
  AttachmentTempReservation,
  StoredAttachment,
} from './attachment-storage';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const TEMP_NAME_PATTERN = /^upload-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
const OWNER_TOKEN_PATTERN = /^[0-9a-f]{64}$/u;

interface ReservationLeaseRecord {
  version: 1;
  ownerToken: string;
  tempName: string;
  device: string;
  inode: string;
  createdAt: string;
  heartbeatAt: string;
}

interface OwnedTempReservation {
  reservation: AttachmentTempReservation;
  leasePath: string;
  reclaimPath: string;
  tempIdentity: { dev: bigint; ino: bigint };
  leaseIdentity: { dev: bigint; ino: bigint };
  timer?: NodeJS.Timeout;
  heartbeatPromise?: Promise<void>;
  heartbeatFailure?: unknown;
  releasePromise?: Promise<void>;
}

interface OwnedContentLock {
  lockPath: string;
  ownerPath: string;
  token: string;
}

type LockDirectorySyncStage = 'after-mkdir' | 'after-owner';

interface LocalAttachmentStorageDependencies {
  availableBytes?: () => Promise<bigint>;
  writeReservation?: (handle: FileHandle, reservedBytes: bigint) => Promise<void>;
  writeLockOwner?: (handle: FileHandle, token: string) => Promise<void>;
  syncLockOwner?: (handle: FileHandle) => Promise<void>;
  syncLockDirectory?: (
    handle: FileHandle,
    stage: LockDirectorySyncStage,
  ) => Promise<void>;
  now?: () => number;
  setInterval?: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  clearInterval?: (timer: NodeJS.Timeout) => void;
  beforeReservationReap?: (
    stage: 'after-claim' | 'before-unlink',
    tempPath: string,
  ) => Promise<void> | void;
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

function sameBigIntFile(
  left: Pick<BigIntStats, 'dev' | 'ino'>,
  right: Pick<BigIntStats, 'dev' | 'ino'>,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function leaseBytes(record: ReservationLeaseRecord): Buffer {
  return Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
}

function parseReservationLease(raw: string): ReservationLeaseRecord | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const value = parsed as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  const expected = [
    'createdAt', 'device', 'heartbeatAt', 'inode', 'ownerToken', 'tempName', 'version',
  ];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return undefined;
  }
  if (
    value.version !== 1
    || typeof value.ownerToken !== 'string'
    || !OWNER_TOKEN_PATTERN.test(value.ownerToken)
    || typeof value.tempName !== 'string'
    || !TEMP_NAME_PATTERN.test(value.tempName)
    || typeof value.device !== 'string'
    || !/^[0-9]+$/u.test(value.device)
    || typeof value.inode !== 'string'
    || !/^[0-9]+$/u.test(value.inode)
    || typeof value.createdAt !== 'string'
    || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.heartbeatAt !== 'string'
    || !Number.isFinite(Date.parse(value.heartbeatAt))
  ) return undefined;
  return value as unknown as ReservationLeaseRecord;
}

async function writeReservation(handle: FileHandle, reservedBytes: bigint): Promise<void> {
  if (reservedBytes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Attachment reservation size must be a safe integer');
  }
  const chunk = Buffer.alloc(1024 * 1024, 0xa5);
  let offset = 0;
  const total = Number(reservedBytes);
  while (offset < total) {
    const length = Math.min(chunk.length, total - offset);
    const { bytesWritten } = await handle.write(chunk, 0, length, offset);
    if (bytesWritten !== length) {
      throw new Error('Attachment reservation write was incomplete');
    }
    offset += bytesWritten;
  }
}

export class LocalAttachmentStorage implements AttachmentStorage {
  private readonly root: string;
  private readonly tempRoot: string;
  private readonly lockRoot: string;
  private readonly activeLeases = new WeakMap<AttachmentContentLease, OwnedContentLock>();
  private readonly activeReservations = new WeakMap<
    AttachmentTempReservation,
    OwnedTempReservation
  >();
  private readonly releasedReservations = new WeakSet<AttachmentTempReservation>();
  private readonly now: () => number;
  private readonly scheduleInterval: (
    callback: () => void,
    delayMs: number,
  ) => NodeJS.Timeout;
  private readonly cancelInterval: (timer: NodeJS.Timeout) => void;

  constructor(
    private readonly config: AttachmentConfig,
    private readonly dependencies: LocalAttachmentStorageDependencies = {},
  ) {
    this.root = resolve(config.storagePath);
    this.tempRoot = join(this.root, '.tmp');
    this.lockRoot = join(this.root, '.locks');
    this.now = dependencies.now ?? Date.now;
    this.scheduleInterval = dependencies.setInterval
      ?? ((callback, delayMs) => setInterval(callback, delayMs));
    this.cancelInterval = dependencies.clearInterval ?? clearInterval;
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

  async createReservedTempPath(
    reservedBytes: bigint,
    minFreeBytes: bigint,
  ): Promise<AttachmentTempReservation> {
    if (reservedBytes <= 0n || minFreeBytes <= 0n) {
      throw new Error('Attachment reservation and minimum free space must be positive');
    }
    await this.ensureBaseDirectories();
    const availableBytes = await this.availableBytes();
    if (availableBytes < reservedBytes + minFreeBytes) {
      throw new Error('Insufficient attachment storage free space');
    }

    const tempPath = join(this.tempRoot, `upload-${randomUUID()}.tmp`);
    const leasePath = `${tempPath}.lease`;
    const reclaimPath = `${tempPath}.reclaim`;
    let handle: FileHandle | undefined;
    let leaseHandle: FileHandle | undefined;
    try {
      handle = await open(
        tempPath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_RDWR |
          constants.O_NOFOLLOW,
        0o600,
      );
      await handle.chmod(0o600);
      await (this.dependencies.writeReservation ?? writeReservation)(
        handle,
        reservedBytes,
      );
      const metadata = await handle.stat({ bigint: true });
      if (!metadata.isFile() || BigInt(metadata.size) !== reservedBytes) {
        throw new Error('Attachment reservation size does not match requested bytes');
      }
      await handle.sync();
      if (await this.availableBytes() < minFreeBytes) {
        throw new Error('Insufficient attachment storage free space after reservation');
      }
      const ownerToken = randomBytes(32).toString('hex');
      const createdAt = new Date(this.now()).toISOString();
      const reservation = Object.freeze({ path: tempPath, ownerToken });
      const record: ReservationLeaseRecord = {
        version: 1,
        ownerToken,
        tempName: basename(tempPath),
        device: metadata.dev.toString(10),
        inode: metadata.ino.toString(10),
        createdAt,
        heartbeatAt: createdAt,
      };
      leaseHandle = await open(
        leasePath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_RDWR |
          constants.O_NOFOLLOW,
        0o600,
      );
      await leaseHandle.writeFile(leaseBytes(record));
      await leaseHandle.chmod(0o600);
      await leaseHandle.sync();
      const leaseMetadata = await leaseHandle.stat({ bigint: true });
      if (!leaseMetadata.isFile()) {
        throw new Error('Attachment reservation lease must be a regular file');
      }
      await leaseHandle.close();
      leaseHandle = undefined;
      await handle.close();
      handle = undefined;
      await this.syncDirectory(this.tempRoot);
      const owned: OwnedTempReservation = {
        reservation,
        leasePath,
        reclaimPath,
        tempIdentity: { dev: metadata.dev, ino: metadata.ino },
        leaseIdentity: { dev: leaseMetadata.dev, ino: leaseMetadata.ino },
      };
      this.activeReservations.set(reservation, owned);
      const heartbeatMs = Math.max(
        1_000,
        Math.min(60_000, Math.floor(this.config.orphanGraceMs / 3)),
      );
      owned.timer = this.scheduleInterval(() => {
        if (owned.heartbeatPromise || owned.releasePromise) return;
        const heartbeat = this.refreshReservationHeartbeat(owned);
        owned.heartbeatPromise = heartbeat;
        void heartbeat.catch((error: unknown) => {
          owned.heartbeatFailure = error;
          if (owned.timer) this.cancelInterval(owned.timer);
          owned.timer = undefined;
        }).finally(() => {
          if (owned.heartbeatPromise === heartbeat) owned.heartbeatPromise = undefined;
        });
      }, heartbeatMs);
      owned.timer.unref?.();
      return reservation;
    } catch (error) {
      await leaseHandle?.close().catch((cleanupError: unknown) => {
        attachCleanupCause(error, cleanupError);
      });
      await handle?.close().catch((cleanupError: unknown) => {
        attachCleanupCause(error, cleanupError);
      });
      await unlink(leasePath).catch((cleanupError: unknown) => {
        if (!isNodeError(cleanupError, 'ENOENT')) attachCleanupCause(error, cleanupError);
      });
      await unlink(reclaimPath).catch((cleanupError: unknown) => {
        if (!isNodeError(cleanupError, 'ENOENT')) attachCleanupCause(error, cleanupError);
      });
      await unlink(tempPath).catch((cleanupError: unknown) => {
        if (!isNodeError(cleanupError, 'ENOENT')) {
          attachCleanupCause(error, cleanupError);
        }
      });
      throw error;
    }
  }

  async releaseTempReservation(
    reservation: AttachmentTempReservation,
  ): Promise<void> {
    if (this.releasedReservations.has(reservation)) return;
    const owned = this.activeReservations.get(reservation);
    if (!owned) {
      throw new Error('A matching active attachment temp reservation is required');
    }
    owned.releasePromise ??= this.releaseOwnedTempReservation(owned);
    return owned.releasePromise;
  }

  async cleanupExpiredTempReservations(cutoff: Date): Promise<number> {
    if (!Number.isFinite(cutoff.getTime())) {
      throw new Error('Attachment temp reservation cutoff must be a valid date');
    }
    await this.ensureBaseDirectories();
    let removed = 0;
    for (const entry of await readdir(this.tempRoot, { withFileTypes: true })) {
      if (!TEMP_NAME_PATTERN.test(entry.name)) continue;
      if (await this.cleanupExpiredTempReservation(join(this.tempRoot, entry.name), cutoff)) {
        removed += 1;
      }
    }
    return removed;
  }

  async publish(
    reservation: AttachmentTempReservation,
    contentHash: string,
    sizeBytes: bigint,
    lease: AttachmentContentLease,
  ): Promise<StoredAttachment> {
    const tempPath = reservation.path;
    if (!HASH_PATTERN.test(contentHash)) {
      throw new Error('Invalid attachment content hash');
    }
    if (sizeBytes <= 0n) {
      throw new Error('Attachment size must be positive');
    }
    this.assertLease(lease, contentHash);
    this.assertTempPath(tempPath);
    await this.ensureBaseDirectories();
    const ownedReservation = await this.assertTempReservationActive(reservation);

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
      const metadata = await tempHandle.stat({ bigint: true });
      if (!metadata.isFile()) {
        throw new Error('Attachment temp path must be a regular file');
      }
      if (!sameBigIntFile(metadata, ownedReservation.tempIdentity)) {
        throw new Error('Attachment temp reservation identity changed before publishing');
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

      await this.assertTempReservationActive(reservation);
      await rename(tempPath, stagingPath);
      let created = false;
      try {
        try {
          await link(stagingPath, finalPath);
          created = true;
          const published = await lstat(finalPath, { bigint: true });
          const opened = await tempHandle.stat({ bigint: true });
          if (!published.isFile() || !sameBigIntFile(published, opened)) {
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
      try {
        await tempHandle.close();
      } finally {
        await this.releaseTempReservation(reservation);
      }
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

  private async availableBytes(): Promise<bigint> {
    if (this.dependencies.availableBytes) {
      return this.dependencies.availableBytes();
    }
    const filesystem = await statfs(this.root, { bigint: true });
    return filesystem.bavail * filesystem.bsize;
  }

  private async lstatBigInt(path: string): Promise<BigIntStats | undefined> {
    try {
      return await lstat(path, { bigint: true });
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return undefined;
      throw error;
    }
  }

  private async readReservationSidecar(
    path: string,
  ): Promise<{ raw: string; metadata: BigIntStats } | undefined> {
    let handle: FileHandle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return undefined;
      throw error;
    }
    try {
      const metadata = await handle.stat({ bigint: true });
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4_096n) {
        throw new Error('Attachment reservation sidecar is unsafe');
      }
      return { raw: await handle.readFile('utf8'), metadata };
    } finally {
      await handle.close();
    }
  }

  private recordMatchesTemp(
    record: ReservationLeaseRecord,
    tempPath: string,
    metadata: Pick<BigIntStats, 'dev' | 'ino'>,
  ): boolean {
    return record.tempName === basename(tempPath)
      && record.device === metadata.dev.toString(10)
      && record.inode === metadata.ino.toString(10);
  }

  private async refreshReservationHeartbeat(owned: OwnedTempReservation): Promise<void> {
    if (owned.releasePromise || this.releasedReservations.has(owned.reservation)) return;
    if (await this.lstatBigInt(owned.reclaimPath)) {
      throw new Error('Attachment temp reservation was claimed for cleanup');
    }
    const handle = await open(
      owned.leasePath,
      constants.O_RDWR | constants.O_NOFOLLOW,
    );
    try {
      const leaseMetadata = await handle.stat({ bigint: true });
      if (!leaseMetadata.isFile() || !sameBigIntFile(leaseMetadata, owned.leaseIdentity)) {
        throw new Error('Attachment temp reservation lease identity changed');
      }
      const raw = await handle.readFile('utf8');
      const record = parseReservationLease(raw);
      const tempMetadata = await this.lstatBigInt(owned.reservation.path);
      if (
        !record
        || record.ownerToken !== owned.reservation.ownerToken
        || !tempMetadata?.isFile()
        || tempMetadata.isSymbolicLink()
        || !sameBigIntFile(tempMetadata, owned.tempIdentity)
        || !this.recordMatchesTemp(record, owned.reservation.path, tempMetadata)
      ) {
        throw new Error('Attachment temp reservation ownership changed');
      }
      const next = leaseBytes({
        ...record,
        heartbeatAt: new Date(this.now()).toISOString(),
      });
      if (next.byteLength !== Buffer.byteLength(raw, 'utf8')) {
        throw new Error('Attachment temp reservation heartbeat size changed');
      }
      const { bytesWritten } = await handle.write(next, 0, next.byteLength, 0);
      if (bytesWritten !== next.byteLength) {
        throw new Error('Attachment temp reservation heartbeat write was incomplete');
      }
      await handle.sync();
      const currentLease = await this.lstatBigInt(owned.leasePath);
      if (
        !currentLease?.isFile()
        || !sameBigIntFile(currentLease, owned.leaseIdentity)
        || await this.lstatBigInt(owned.reclaimPath)
      ) {
        throw new Error('Attachment temp reservation lease was claimed during heartbeat');
      }
    } finally {
      await handle.close();
    }
  }

  private async assertTempReservationActive(
    reservation: AttachmentTempReservation,
  ): Promise<OwnedTempReservation> {
    const owned = this.activeReservations.get(reservation);
    if (!owned || this.releasedReservations.has(reservation)) {
      throw new Error('A matching active attachment temp reservation is required');
    }
    if (owned.heartbeatFailure) {
      throw errorWithCause(
        'Attachment temp reservation heartbeat failed',
        owned.heartbeatFailure,
      );
    }
    if (owned.heartbeatPromise) await owned.heartbeatPromise;
    const [lease, reclaim, tempMetadata] = await Promise.all([
      this.readReservationSidecar(owned.leasePath),
      this.lstatBigInt(owned.reclaimPath),
      this.lstatBigInt(reservation.path),
    ]);
    const record = lease && parseReservationLease(lease.raw);
    if (
      reclaim
      || !lease
      || !sameBigIntFile(lease.metadata, owned.leaseIdentity)
      || !record
      || record.ownerToken !== reservation.ownerToken
      || !tempMetadata?.isFile()
      || tempMetadata.isSymbolicLink()
      || !sameBigIntFile(tempMetadata, owned.tempIdentity)
      || !this.recordMatchesTemp(record, reservation.path, tempMetadata)
    ) {
      throw new Error('Attachment temp reservation ownership changed');
    }
    return owned;
  }

  private async releaseOwnedTempReservation(owned: OwnedTempReservation): Promise<void> {
    if (owned.timer) this.cancelInterval(owned.timer);
    owned.timer = undefined;
    if (owned.heartbeatPromise) {
      await owned.heartbeatPromise.catch(() => undefined);
    }
    this.activeReservations.delete(owned.reservation);
    this.releasedReservations.add(owned.reservation);
    if (await this.lstatBigInt(owned.reclaimPath)) {
      throw new Error('Attachment temp reservation was claimed for cleanup');
    }

    let cleanupError: unknown;
    const tempMetadata = await this.lstatBigInt(owned.reservation.path).catch((error) => {
      cleanupError = error;
      return undefined;
    });
    if (tempMetadata) {
      if (
        !tempMetadata.isFile()
        || tempMetadata.isSymbolicLink()
        || !sameBigIntFile(tempMetadata, owned.tempIdentity)
      ) {
        cleanupError = new Error('Attachment temp reservation identity changed before release');
      } else {
        await unlink(owned.reservation.path).catch((error) => { cleanupError ??= error; });
      }
    }
    for (const path of [owned.leasePath, owned.reclaimPath]) {
      const metadata = await this.lstatBigInt(path).catch((error) => {
        cleanupError ??= error;
        return undefined;
      });
      if (!metadata) continue;
      if (
        !metadata.isFile()
        || metadata.isSymbolicLink()
        || !sameBigIntFile(metadata, owned.leaseIdentity)
      ) {
        cleanupError ??= new Error('Attachment temp reservation sidecar identity changed');
        continue;
      }
      await unlink(path).catch((error) => { cleanupError ??= error; });
    }
    await this.syncDirectory(this.tempRoot).catch((error) => { cleanupError ??= error; });
    if (cleanupError) throw cleanupError;
  }

  private async cleanupExpiredTempReservation(
    tempPath: string,
    cutoff: Date,
  ): Promise<boolean> {
    const cutoffMs = cutoff.getTime();
    const initialTemp = await this.lstatBigInt(tempPath);
    if (!initialTemp?.isFile() || initialTemp.isSymbolicLink()) return false;
    const leasePath = `${tempPath}.lease`;
    const reclaimPath = `${tempPath}.reclaim`;
    let claim = await this.readReservationSidecar(reclaimPath);

    if (!claim) {
      const lease = await this.readReservationSidecar(leasePath);
      const parsed = lease && parseReservationLease(lease.raw);
      if (parsed) {
        if (!this.recordMatchesTemp(parsed, tempPath, initialTemp)) return false;
        if (Date.parse(parsed.heartbeatAt) > cutoffMs) return false;
      } else if (Number(initialTemp.mtimeMs) > cutoffMs) {
        return false;
      }

      if (lease) {
        try {
          await link(leasePath, reclaimPath);
        } catch (error) {
          if (!isNodeError(error, 'EEXIST')) throw error;
        }
        claim = await this.readReservationSidecar(reclaimPath);
        const currentLease = await this.lstatBigInt(leasePath);
        if (
          !claim
          || !sameBigIntFile(claim.metadata, lease.metadata)
          || !currentLease
          || !sameBigIntFile(currentLease, lease.metadata)
        ) return false;
        await unlink(leasePath);
      } else {
        let claimHandle: FileHandle;
        try {
          claimHandle = await open(
            reclaimPath,
            constants.O_CREAT |
              constants.O_EXCL |
              constants.O_RDWR |
              constants.O_NOFOLLOW,
            0o600,
          );
        } catch (error) {
          if (isNodeError(error, 'EEXIST')) return false;
          throw error;
        }
        try {
          await claimHandle.writeFile(`${JSON.stringify({
            claim: 'missing-lease',
            device: initialTemp.dev.toString(10),
            inode: initialTemp.ino.toString(10),
          })}\n`);
          await claimHandle.sync();
        } finally {
          await claimHandle.close();
        }
        claim = await this.readReservationSidecar(reclaimPath);
      }
      await this.syncDirectory(this.tempRoot);
    }

    if (!claim) return false;
    await this.dependencies.beforeReservationReap?.('after-claim', tempPath);
    const claimedRecord = parseReservationLease(claim.raw);
    const claimedTemp = await this.lstatBigInt(tempPath);
    if (!claimedTemp?.isFile() || claimedTemp.isSymbolicLink()) return false;
    const eligible = claimedRecord
      ? this.recordMatchesTemp(claimedRecord, tempPath, claimedTemp)
        && Date.parse(claimedRecord.heartbeatAt) <= cutoffMs
      : Number(claimedTemp.mtimeMs) <= cutoffMs;
    if (!eligible || !sameBigIntFile(claimedTemp, initialTemp)) return false;

    await this.dependencies.beforeReservationReap?.('before-unlink', tempPath);
    const [leaseAfterClaim, finalClaim, finalTemp] = await Promise.all([
      this.lstatBigInt(leasePath),
      this.readReservationSidecar(reclaimPath),
      this.lstatBigInt(tempPath),
    ]);
    if (
      leaseAfterClaim
      || !finalClaim
      || finalClaim.raw !== claim.raw
      || !sameBigIntFile(finalClaim.metadata, claim.metadata)
      || !finalTemp?.isFile()
      || finalTemp.isSymbolicLink()
      || !sameBigIntFile(finalTemp, initialTemp)
    ) return false;
    const finalRecord = parseReservationLease(finalClaim.raw);
    if (
      finalRecord
        ? !this.recordMatchesTemp(finalRecord, tempPath, finalTemp)
          || Date.parse(finalRecord.heartbeatAt) > cutoffMs
        : Number(finalTemp.mtimeMs) > cutoffMs
    ) return false;

    await unlink(tempPath);
    await unlink(reclaimPath);
    await this.syncDirectory(this.tempRoot);
    return true;
  }

  private async acquireLockDirectory(
    lockPath: string,
    timeoutMs: number,
  ): Promise<OwnedContentLock> {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      try {
        await mkdir(lockPath, { mode: 0o700 });
        let directoryHandle: FileHandle | undefined;
        let directoryIdentity: Stats | undefined;
        let ownerHandle: FileHandle | undefined;
        let ownerIdentity: Stats | undefined;
        const token = randomUUID();
        const ownerPath = join(lockPath, '.owner');
        try {
          directoryHandle = await openDirectorySafely(lockPath);
          directoryIdentity = await directoryHandle.stat();
          if ((directoryIdentity.mode & 0o777) !== 0o700) {
            throw new Error(`Attachment content lock must have mode 0700: ${lockPath}`);
          }
          await (this.dependencies.syncLockDirectory
            ?? ((handle: FileHandle) => handle.sync()))(
            directoryHandle,
            'after-mkdir',
          );
          ownerHandle = await open(
            ownerPath,
            constants.O_CREAT |
              constants.O_EXCL |
              constants.O_RDWR |
              constants.O_NOFOLLOW,
            0o600,
          );
          ownerIdentity = await ownerHandle.stat();
          await (this.dependencies.writeLockOwner
            ?? ((handle: FileHandle, value: string) => handle.writeFile(value, 'utf8')))(
            ownerHandle,
            token,
          );
          await ownerHandle.chmod(0o600);
          await (this.dependencies.syncLockOwner
            ?? ((handle: FileHandle) => handle.sync()))(ownerHandle);
          await ownerHandle.close();
          ownerHandle = undefined;
          await (this.dependencies.syncLockDirectory
            ?? ((handle: FileHandle) => handle.sync()))(
            directoryHandle,
            'after-owner',
          );
          await directoryHandle.close();
          directoryHandle = undefined;
          await this.syncDirectory(dirname(lockPath));
          return { lockPath, ownerPath, token };
        } catch (initializationError) {
          await ownerHandle?.close().catch((cleanupError: unknown) => {
            attachCleanupCause(initializationError, cleanupError);
          });
          await directoryHandle?.close().catch((cleanupError: unknown) => {
            attachCleanupCause(initializationError, cleanupError);
          });
          try {
            if (ownerIdentity) {
              const currentOwner = await lstat(ownerPath).catch((error: unknown) => {
                if (isNodeError(error, 'ENOENT')) return undefined;
                throw error;
              });
              if (currentOwner && sameFile(ownerIdentity, currentOwner)) {
                await unlink(ownerPath);
              }
            }
            if (directoryIdentity) {
              const currentDirectory = await lstat(lockPath).catch((error: unknown) => {
                if (isNodeError(error, 'ENOENT')) return undefined;
                throw error;
              });
              if (currentDirectory && sameFile(directoryIdentity, currentDirectory)) {
                await rmdir(lockPath);
                await this.syncDirectory(dirname(lockPath));
              }
            }
          } catch (cleanupError) {
            attachCleanupCause(initializationError, cleanupError);
          }
          throw initializationError;
        }
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
