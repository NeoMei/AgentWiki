export const ATTACHMENT_STORAGE = Symbol('ATTACHMENT_STORAGE');

export interface StoredAttachment {
  contentHash: string;
  storageKey: string;
  sizeBytes: bigint;
  created: boolean;
}

export interface AttachmentStorage {
  createTempPath(): Promise<string>;
  publish(
    tempPath: string,
    contentHash: string,
    sizeBytes: bigint,
  ): Promise<StoredAttachment>;
  open(storageKey: string): Promise<NodeJS.ReadableStream>;
  removeIfUnreferenced(storageKey: string): Promise<void>;
  probe(): Promise<{ writable: true; availableBytes: bigint }>;
}
