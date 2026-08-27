export const ATTACHMENT_STORAGE = Symbol('ATTACHMENT_STORAGE');

export interface StoredAttachment {
  contentHash: string;
  storageKey: string;
  sizeBytes: bigint;
  created: boolean;
}

export interface AttachmentContentLease {
  readonly contentHash: string;
}

export interface AttachmentTempReservation {
  readonly path: string;
  readonly ownerToken: string;
}

export interface StoredUpload extends Express.Multer.File {
  attachmentTempReservation: AttachmentTempReservation;
}

export interface AttachmentStorage {
  createTempPath(): Promise<string>;
  createReservedTempPath(
    reservedBytes: bigint,
    minFreeBytes: bigint,
  ): Promise<AttachmentTempReservation>;
  releaseTempReservation(reservation: AttachmentTempReservation): Promise<void>;
  cleanupExpiredTempReservations(cutoff: Date): Promise<number>;
  publish(
    reservation: AttachmentTempReservation,
    contentHash: string,
    sizeBytes: bigint,
    lease: AttachmentContentLease,
  ): Promise<StoredAttachment>;
  withContentLock<T>(
    contentHash: string,
    work: (lease: AttachmentContentLease) => Promise<T>,
  ): Promise<T>;
  open(storageKey: string): Promise<NodeJS.ReadableStream>;
  removeIfUnreferenced(
    storageKey: string,
    lease: AttachmentContentLease,
  ): Promise<void>;
  probe(): Promise<{ writable: true; availableBytes: bigint }>;
}
