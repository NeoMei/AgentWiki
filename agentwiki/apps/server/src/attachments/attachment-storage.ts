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

export interface AttachmentStorage {
  createTempPath(): Promise<string>;
  createReservedTempPath(
    reservedBytes: bigint,
    minFreeBytes: bigint,
  ): Promise<string>;
  publish(
    tempPath: string,
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
