import { z } from "zod";
import { canonicalBytes } from "./canonical.js";
import { sha256Hex } from "./hash.js";
import { PublicIdSchema } from "./schemas.js";
import {
  pathKey,
  validatePortableDirectoryPath,
  validatePortableMarkdownPath,
} from "./normalize.js";
import {
  TREE_SYNC_V2_LIMITS,
  SyncFolderV2Schema,
  TreeSyncCapabilitiesV2Schema,
  type SyncFolderV2,
  type SyncPageV2,
  type TreeDeltaItemV2,
} from "./sync-v2.js";

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const UuidSchema = z.string().uuid();
const Rfc3339Schema = z.string().datetime({ offset: true });
const AttachmentMimeTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const SYNC_PROTOCOL_V3 = "3" as const;

export const SYNC_V3_ERROR_CODES = Object.freeze([
  "ATTACHMENT_REFERENCE_INVALID",
  "ATTACHMENT_MISSING",
  "ATTACHMENT_CONTENT_INVALID",
  "ATTACHMENT_NAME_CONFLICT",
  "ATTACHMENT_REFERENCED",
  "ATTACHMENT_BLOB_MISSING",
  "ATTACHMENT_QUOTA_EXCEEDED",
  "SYNC_PROTOCOL_UPGRADE_REQUIRED",
] as const);

export const SyncV3ErrorCodeSchema = z.enum(SYNC_V3_ERROR_CODES);
export type SyncV3ErrorCode = z.infer<typeof SyncV3ErrorCodeSchema>;

export interface SyncV3ErrorEnvelope {
  protocolVersion: "3";
  error: {
    code: SyncV3ErrorCode;
    retryable: boolean;
  };
}

export const SyncV3ErrorEnvelopeSchema: z.ZodType<SyncV3ErrorEnvelope> = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  error: z.object({
    code: SyncV3ErrorCodeSchema,
    retryable: z.boolean(),
  }).strict(),
}).strict();

export const TREE_SYNC_V3_HARD_LIMITS = Object.freeze({
  maxAttachmentBytes: 10 * 1024 * 1024,
  maxRevisionAttachments: 1_000,
  maxTransferBlobBytes: 100 * 1024 * 1024,
  blobChunkBytes: 1024 * 1024,
  maxBlobChunks: 10,
  maxConcurrentBlobs: 2,
  maxImageDimension: 10_000,
  maxDecodedPixels: 40_000_000,
});

const BoundedDecimalSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).refine(
  (value) => BigInt(value) <= BigInt(TREE_SYNC_V3_HARD_LIMITS.maxAttachmentBytes),
  "Attachment byte count exceeds the hard limit",
);

export const FlatAttachmentPathSchema = z.string().transform((value, context) => {
  try {
    const path = validatePortableDirectoryPath(value).path;
    const parts = path.split("/");
    if (parts.length !== 2 || parts[0] !== "assets")
      throw new TypeError("Attachment path must be a flat path under assets/");
    if (!/\.(?:png|jpe?g|webp|gif)$/iu.test(parts[1] ?? ""))
      throw new TypeError("Attachment path must use a supported image extension");
    return path;
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Attachment path is not portable",
    });
    return z.NEVER;
  }
});

const PortableMarkdownPathSchema = z.string().transform((value, context) => {
  try {
    const path = validatePortableMarkdownPath(value).path;
    if (!path.startsWith("pages/")) throw new TypeError("Path must be under pages/");
    return path;
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Page path is not portable" });
    return z.NEVER;
  }
});

const SortedUniqueAttachmentIdsSchema = z
  .array(PublicIdSchema)
  .max(TREE_SYNC_V3_HARD_LIMITS.maxRevisionAttachments)
  .superRefine((ids, context) => {
    for (let index = 1; index < ids.length; index += 1) {
      if ((ids[index - 1] ?? "") >= (ids[index] ?? "")) {
        context.addIssue({
          code: "custom",
          message: "Attachment IDs must be sorted and unique",
        });
        return;
      }
    }
  });

export interface SyncAttachmentV3 {
  attachmentId: string;
  path: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  sizeBytes: string;
  width: number;
  height: number;
  contentHash: string;
  updatedAt: string;
}

export const SyncAttachmentV3Schema: z.ZodType<SyncAttachmentV3> = z
  .object({
    attachmentId: PublicIdSchema,
    path: FlatAttachmentPathSchema,
    mimeType: AttachmentMimeTypeSchema,
    sizeBytes: BoundedDecimalSchema,
    width: z.number().int().positive().max(TREE_SYNC_V3_HARD_LIMITS.maxImageDimension),
    height: z.number().int().positive().max(TREE_SYNC_V3_HARD_LIMITS.maxImageDimension),
    contentHash: HashSchema,
    updatedAt: Rfc3339Schema,
  })
  .strict()
  .superRefine((attachment, context) => {
    if (attachment.width * attachment.height > TREE_SYNC_V3_HARD_LIMITS.maxDecodedPixels) {
      context.addIssue({ code: "custom", message: "Decoded image pixels exceed the hard limit" });
    }
    const extension = attachment.path.slice(attachment.path.lastIndexOf(".") + 1).toLowerCase();
    const extensionMatches = attachment.mimeType === "image/jpeg"
      ? extension === "jpg" || extension === "jpeg"
      : extension === attachment.mimeType.slice("image/".length);
    if (!extensionMatches) {
      context.addIssue({ code: "custom", path: ["mimeType"], message: "Attachment MIME type does not match its path extension" });
    }
  });

export interface SyncPageV3 extends SyncPageV2 {
  referencedAttachmentIds: string[];
}

export const SyncPageV3Schema: z.ZodType<SyncPageV3> = z
  .object({
    pageId: PublicIdSchema,
    folderId: PublicIdSchema.nullable(),
    path: PortableMarkdownPathSchema,
    title: z.string(),
    body: z.string(),
    contentHash: HashSchema,
    updatedAt: Rfc3339Schema,
    referencedAttachmentIds: SortedUniqueAttachmentIdsSchema,
  })
  .strict();

const SortedUniqueMimeTypesSchema = z.array(AttachmentMimeTypeSchema).min(1).max(4).superRefine((values, context) => {
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index - 1] ?? "") >= (values[index] ?? "")) {
      context.addIssue({ code: "custom", message: "MIME types must be sorted and unique" });
      return;
    }
  }
});

export const TreeSyncCapabilitiesV3Schema = TreeSyncCapabilitiesV2Schema.extend({
  maxAttachmentBytes: z.number().int().positive().max(TREE_SYNC_V3_HARD_LIMITS.maxAttachmentBytes),
  maxRevisionAttachments: z.number().int().positive().max(TREE_SYNC_V3_HARD_LIMITS.maxRevisionAttachments),
  maxTransferBlobBytes: z.number().int().positive().max(TREE_SYNC_V3_HARD_LIMITS.maxTransferBlobBytes),
  blobChunkBytes: z.number().int().positive().max(TREE_SYNC_V3_HARD_LIMITS.blobChunkBytes),
  maxBlobChunks: z.number().int().positive().max(TREE_SYNC_V3_HARD_LIMITS.maxBlobChunks),
  maxConcurrentBlobs: z.number().int().positive().max(TREE_SYNC_V3_HARD_LIMITS.maxConcurrentBlobs),
  maxImageDimension: z.number().int().positive().max(TREE_SYNC_V3_HARD_LIMITS.maxImageDimension),
  maxDecodedPixels: z.number().int().positive().max(TREE_SYNC_V3_HARD_LIMITS.maxDecodedPixels),
  allowedMimeTypes: SortedUniqueMimeTypesSchema,
  blobStagingTtlSeconds: z.number().int().positive(),
  downloadAuthorizationTtlSeconds: z.number().int().positive(),
}).strict();

export type TreeSyncCapabilitiesV3 = z.infer<typeof TreeSyncCapabilitiesV3Schema>;

export const TreeCapabilitiesResponseV3Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  capabilities: TreeSyncCapabilitiesV3Schema,
  capabilitiesHash: HashSchema,
}).strict();

export type TreeCapabilitiesResponseV3 = z.infer<typeof TreeCapabilitiesResponseV3Schema>;
export type SyncFolderV3 = SyncFolderV2;
export const SyncFolderV3Schema: z.ZodType<SyncFolderV3> = SyncFolderV2Schema;

const SyncPageManifestV3Schema = z.object({
  pageId: PublicIdSchema,
  folderId: PublicIdSchema.nullable(),
  path: PortableMarkdownPathSchema,
  title: z.string(),
  contentHash: HashSchema,
  updatedAt: Rfc3339Schema,
  referencedAttachmentIds: SortedUniqueAttachmentIdsSchema,
}).strict();

const TreePushManifestFolderUpsertV3Schema = z.object({
  operation: z.literal("upsert_folder"),
  folder: SyncFolderV3Schema,
}).strict();
const TreePushManifestPageUpsertV3Schema = z.object({
  operation: z.literal("upsert_page"),
  page: SyncPageManifestV3Schema,
}).strict();
const TreePushManifestAttachmentUpsertV3Schema = z.object({
  operation: z.literal("upsert_attachment"),
  attachment: SyncAttachmentV3Schema,
}).strict();
export const TreeArchiveFolderV3Schema = z.object({
  operation: z.literal("archive_folder"),
  folderId: PublicIdSchema,
  previousPath: z.string().transform((value, context) => {
    try {
      const path = validatePortableDirectoryPath(value).path;
      if (!path.startsWith("pages/")) throw new TypeError("Path must be under pages/");
      return path;
    } catch (error) {
      context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Folder path is not portable" });
      return z.NEVER;
    }
  }),
}).strict();
export const TreeArchivePageV3Schema = z.object({
  operation: z.literal("archive_page"),
  pageId: PublicIdSchema,
  previousPath: PortableMarkdownPathSchema,
}).strict();
export const TreeDetachAttachmentV3Schema = z.object({
  operation: z.literal("detach_attachment"),
  attachmentId: PublicIdSchema,
  previousPath: FlatAttachmentPathSchema,
}).strict();

export const TreePushManifestChangeV3Schema = z.union([
  TreePushManifestFolderUpsertV3Schema,
  TreeArchiveFolderV3Schema,
  TreePushManifestAttachmentUpsertV3Schema,
  TreePushManifestPageUpsertV3Schema,
  TreeArchivePageV3Schema,
  TreeDetachAttachmentV3Schema,
]);

export const TreePushChangeV3Schema = z.union([
  TreePushManifestFolderUpsertV3Schema,
  TreeArchiveFolderV3Schema,
  TreePushManifestAttachmentUpsertV3Schema,
  z.object({ operation: z.literal("upsert_page"), page: SyncPageV3Schema }).strict(),
  TreeArchivePageV3Schema,
  TreeDetachAttachmentV3Schema,
]);

export type TreePushManifestChangeV3 = z.infer<typeof TreePushManifestChangeV3Schema>;
export type TreePushChangeV3 = z.infer<typeof TreePushChangeV3Schema>;

export type TreeDeltaItemV3 =
  | Exclude<TreeDeltaItemV2, { operation: "upsert_page" }>
  | { operation: "upsert_page"; page: SyncPageV3 }
  | { operation: "upsert_attachment"; attachment: SyncAttachmentV3 }
  | { operation: "detach_attachment"; attachmentId: string; previousPath: string };

export const TreeDeltaItemV3Schema: z.ZodType<TreeDeltaItemV3> = TreePushChangeV3Schema;

export interface TreeRevisionContentManifestV3 {
  protocolVersion: "3";
  spaceId: string;
  folders: SyncFolderV3[];
  pages: SyncPageV3[];
  attachments: SyncAttachmentV3[];
}

const TreeRevisionContentManifestV3ObjectSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  spaceId: PublicIdSchema,
  folders: z.array(SyncFolderV3Schema),
  pages: z.array(SyncPageV3Schema),
  attachments: z.array(SyncAttachmentV3Schema).max(TREE_SYNC_V3_HARD_LIMITS.maxRevisionAttachments),
}).strict().superRefine((manifest, context) => {
  const attachmentIds = new Set(manifest.attachments.map((attachment) => attachment.attachmentId));
  const referencedIds = new Set(manifest.pages.flatMap((page) => page.referencedAttachmentIds));
  if (attachmentIds.size !== manifest.attachments.length) {
    context.addIssue({ code: "custom", path: ["attachments"], message: "Attachment IDs must be unique" });
  }
  const attachmentPathKeys = new Set(manifest.attachments.map((attachment) => pathKey(attachment.path)));
  if (attachmentPathKeys.size !== manifest.attachments.length) {
    context.addIssue({ code: "custom", path: ["attachments"], message: "Attachment path keys must be unique" });
  }
  if (referencedIds.size !== attachmentIds.size
    || [...referencedIds].some((attachmentId) => !attachmentIds.has(attachmentId))) {
    context.addIssue({ code: "custom", path: ["attachments"], message: "Attachment manifest must equal the Page reference set" });
  }
});

export const TreeRevisionContentManifestV3Schema: z.ZodType<TreeRevisionContentManifestV3> = TreeRevisionContentManifestV3ObjectSchema;

export interface TreePushConfirmationManifestV3 {
  protocolVersion: "3";
  spaceId: string;
  baseRevision: string;
  capabilitiesHash: string;
  changes: TreePushManifestChangeV3[];
}

export const TreePushConfirmationManifestV3Schema: z.ZodType<TreePushConfirmationManifestV3> = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  spaceId: PublicIdSchema,
  baseRevision: PublicIdSchema,
  capabilitiesHash: HashSchema,
  changes: z.array(TreePushManifestChangeV3Schema).max(TREE_SYNC_V2_LIMITS.maxDeltaItems),
}).strict();

export interface TreePushBatchWithoutHashV3 {
  protocolVersion: "3";
  batchIndex: number;
  changes: TreePushChangeV3[];
}

export interface TreePushBatchV3 extends TreePushBatchWithoutHashV3 {
  batchHash: string;
}

export const TreePushBatchV3Schema: z.ZodType<TreePushBatchV3> = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  batchIndex: z.number().int().nonnegative(),
  changes: z.array(TreePushChangeV3Schema).min(1).max(TREE_SYNC_V2_LIMITS.maxPushChanges),
  batchHash: HashSchema,
}).strict();

export interface TreeRevisionDeltaManifestV3 {
  protocolVersion: "3";
  spaceId: string;
  fromRevision: string;
  toRevision: string;
  items: TreeDeltaItemV3[];
}

export const TreeRevisionDeltaManifestV3Schema: z.ZodType<TreeRevisionDeltaManifestV3> = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  spaceId: PublicIdSchema,
  fromRevision: PublicIdSchema,
  toRevision: PublicIdSchema,
  items: z.array(TreeDeltaItemV3Schema).max(TREE_SYNC_V2_LIMITS.maxDeltaItems),
}).strict();

const SortedUniqueHashesSchema = z.array(HashSchema).max(TREE_SYNC_V3_HARD_LIMITS.maxRevisionAttachments).superRefine((hashes, context) => {
  for (let index = 1; index < hashes.length; index += 1) {
    if ((hashes[index - 1] ?? "") >= (hashes[index] ?? "")) {
      context.addIssue({ code: "custom", message: "Content hashes must be sorted and unique" });
      return;
    }
  }
});

export const CreateTreePushSessionRequestV3Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  baseRevision: PublicIdSchema,
  idempotencyKey: UuidSchema,
  capabilitiesHash: HashSchema,
  confirmationHash: HashSchema,
  confirmationByteLength: z.number().int().positive().max(4_194_304),
  changeCount: z.number().int().min(0).max(TREE_SYNC_V2_LIMITS.maxDeltaItems),
  totalBodyBytes: z.number().int().nonnegative().max(TREE_SYNC_V2_LIMITS.maxDocumentTreeBytes),
  attachmentCount: z.number().int().min(0).max(TREE_SYNC_V3_HARD_LIMITS.maxRevisionAttachments),
  transferBlobBytes: z.number().int().nonnegative().max(TREE_SYNC_V3_HARD_LIMITS.maxTransferBlobBytes),
  contentHashes: SortedUniqueHashesSchema,
}).strict();

const PushSessionStatusV3Schema = z.enum([
  "uploading",
  "ready_to_finalize",
  "finalizing",
  "published",
  "aborted",
  "expired",
]);
const DecimalCountSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).refine(
  (value) => BigInt(value) <= 9223372036854775807n,
  "Decimal count exceeds signed bigint",
);
const treeRevisionCountsV3Schema = {
  folderCount: DecimalCountSchema,
  pageCount: DecimalCountSchema,
  attachmentCount: DecimalCountSchema,
  revisionManifestByteLength: DecimalCountSchema,
  revisionBodyBytes: DecimalCountSchema,
  revisionAttachmentBytes: DecimalCountSchema,
};

export const TreeRevisionHeadResponseV3Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  spaceId: PublicIdSchema,
  revision: PublicIdSchema,
  sequence: z.number().int().nonnegative(),
  revisionContentHash: HashSchema,
  ...treeRevisionCountsV3Schema,
  publishedAt: Rfc3339Schema.nullable(),
}).strict();

export const TreeSnapshotPageV3Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  spaceId: PublicIdSchema,
  revision: PublicIdSchema,
  sequence: z.number().int().nonnegative(),
  revisionContentHash: HashSchema,
  ...treeRevisionCountsV3Schema,
  folders: z.array(SyncFolderV3Schema),
  pages: z.array(SyncPageV3Schema),
  attachments: z.array(SyncAttachmentV3Schema),
  nextCursor: z.string().max(4096).nullable(),
}).strict();

export const TreeDeltaPageV3Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  spaceId: PublicIdSchema,
  fromRevision: PublicIdSchema,
  toRevision: PublicIdSchema,
  toSequence: z.number().int().nonnegative(),
  toRevisionContentHash: HashSchema,
  toFolderCount: DecimalCountSchema,
  toPageCount: DecimalCountSchema,
  toAttachmentCount: DecimalCountSchema,
  toRevisionManifestByteLength: DecimalCountSchema,
  toRevisionBodyBytes: DecimalCountSchema,
  toRevisionAttachmentBytes: DecimalCountSchema,
  items: z.array(TreeDeltaItemV3Schema).max(TREE_SYNC_V2_LIMITS.maxDeltaItems),
  nextCursor: z.string().max(4096).nullable(),
}).strict();

export const TreeFinalizePushRequestV3Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  confirmationHash: HashSchema,
  userConfirmed: z.literal(true),
}).strict();

export const TreeFinalizePushResponseV3Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  status: z.enum(["published", "noop"]),
  revision: PublicIdSchema,
  sequence: z.number().int().nonnegative(),
  publishedAt: Rfc3339Schema.nullable(),
  revisionContentHash: HashSchema,
  ...treeRevisionCountsV3Schema,
  changeSetId: z.string().nullable(),
}).strict();

export const CreateTreePushSessionResponseV3Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  sessionId: UuidSchema,
  status: PushSessionStatusV3Schema,
  expiresAt: Rfc3339Schema,
  missingContentHashes: SortedUniqueHashesSchema,
}).strict();

export const TreePushSessionStatusResponseV3Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  sessionId: UuidSchema,
  status: PushSessionStatusV3Schema,
  expiresAt: Rfc3339Schema,
  missingContentHashes: SortedUniqueHashesSchema,
  completedContentHashes: SortedUniqueHashesSchema,
  receivedBatchIndexes: z.array(z.number().int().nonnegative()),
  result: TreeFinalizePushResponseV3Schema.nullable(),
}).strict();

export const TreePushBatchReceiptV3Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  sessionId: UuidSchema,
  batchIndex: z.number().int().nonnegative(),
  batchHash: HashSchema,
  receipt: z.string().min(1),
  receivedBatchCount: z.number().int().nonnegative(),
}).strict();

export interface BlobChunkReceiptV3 {
  contentHash: string;
  chunkIndex: number;
  chunkHash: string;
  receipt: string;
}

export const BlobChunkReceiptV3Schema: z.ZodType<BlobChunkReceiptV3> = z.object({
  contentHash: HashSchema,
  chunkIndex: z.number().int().nonnegative().max(TREE_SYNC_V3_HARD_LIMITS.maxBlobChunks - 1),
  chunkHash: HashSchema,
  receipt: z.string().min(1),
}).strict();

export interface CompletedBlobV3 {
  contentHash: string;
  sizeBytes: string;
  mimeType: SyncAttachmentV3["mimeType"];
  width: number;
  height: number;
  verifiedAt: string;
}

export const CompletedBlobV3Schema: z.ZodType<CompletedBlobV3> = z.object({
  contentHash: HashSchema,
  sizeBytes: BoundedDecimalSchema,
  mimeType: AttachmentMimeTypeSchema,
  width: z.number().int().positive().max(TREE_SYNC_V3_HARD_LIMITS.maxImageDimension),
  height: z.number().int().positive().max(TREE_SYNC_V3_HARD_LIMITS.maxImageDimension),
  verifiedAt: Rfc3339Schema,
}).strict().superRefine((blob, context) => {
  if (blob.width * blob.height > TREE_SYNC_V3_HARD_LIMITS.maxDecodedPixels) {
    context.addIssue({ code: "custom", message: "Decoded image pixels exceed the hard limit" });
  }
});

export const CompleteBlobRequestV3Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  contentHash: HashSchema,
  sizeBytes: BoundedDecimalSchema,
  chunkCount: z.number().int().positive().max(TREE_SYNC_V3_HARD_LIMITS.maxBlobChunks),
}).strict();

export const TreeSyncSpaceSummaryV3Schema = z.object({
  spaceId: PublicIdSchema,
  displayName: z.string(),
  role: z.enum(["viewer", "editor", "admin", "owner"]),
  canRead: z.literal(true),
  canPublish: z.boolean(),
  syncMode: z.enum(["native_v3", "bootstrap_required", "legacy_v2"]),
  currentRevision: PublicIdSchema,
  ...treeRevisionCountsV3Schema,
}).strict();

export const TreeSyncSpaceListResponseV3Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  spaces: z.array(TreeSyncSpaceSummaryV3Schema),
}).strict();

export const TreeBootstrapPreviewV3Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  mode: z.literal("bootstrap_required"),
  baseRevision: PublicIdSchema,
  candidateHash: HashSchema,
  attachmentCount: DecimalCountSchema,
  transferBytes: DecimalCountSchema,
  blockers: z.array(z.object({
    pageId: PublicIdSchema,
    code: SyncV3ErrorCodeSchema,
  }).strict()),
}).strict();

export const TreeBootstrapRequestV3Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V3),
  baseRevision: PublicIdSchema,
  confirmationHash: HashSchema,
  userConfirmed: z.literal(true),
}).strict();

function compareStrings(left: string, right: string): number {
  const leftCodePoints = Array.from(left, (char) => char.codePointAt(0) ?? 0);
  const rightCodePoints = Array.from(right, (char) => char.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(leftCodePoints.length, rightCodePoints.length); index += 1) {
    if (leftCodePoints[index] !== rightCodePoints[index])
      return (leftCodePoints[index] ?? 0) - (rightCodePoints[index] ?? 0);
  }
  return leftCodePoints.length - rightCodePoints.length;
}

function folderDepths(folders: ReadonlyMap<string, SyncFolderV3>): ReadonlyMap<string, number> {
  const depths = new Map<string, number>();
  for (const folderId of folders.keys()) {
    if (depths.has(folderId)) continue;
    const chain: SyncFolderV3[] = [];
    const chainIds = new Set<string>();
    let current = folders.get(folderId);
    let baseDepth = -1;
    while (current) {
      const cachedDepth = depths.get(current.folderId);
      if (cachedDepth !== undefined) {
        baseDepth = cachedDepth;
        break;
      }
      if (chainIds.has(current.folderId)) throw new TypeError("Folder hierarchy contains a cycle");
      chainIds.add(current.folderId);
      chain.push(current);
      if (current.parentFolderId === null) break;
      const parent = folders.get(current.parentFolderId);
      if (!parent) throw new TypeError("Folder hierarchy references an unknown parent");
      current = parent;
    }
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      baseDepth += 1;
      depths.set(chain[index]!.folderId, baseDepth);
    }
  }
  return depths;
}

export function canonicalTreeRevisionManifestV3(manifest: TreeRevisionContentManifestV3): TreeRevisionContentManifestV3 {
  const parsed = TreeRevisionContentManifestV3Schema.parse(manifest);
  const foldersById = new Map(parsed.folders.map((folder) => [folder.folderId, folder]));
  if (foldersById.size !== parsed.folders.length) throw new TypeError("Folder manifest contains duplicate IDs");
  const depthByFolderId = folderDepths(foldersById);
  const pageIds = new Set(parsed.pages.map((page) => page.pageId));
  if (pageIds.size !== parsed.pages.length) throw new TypeError("Page manifest contains duplicate IDs");
  return {
    ...parsed,
    folders: [...parsed.folders].sort((left, right) =>
      depthByFolderId.get(left.folderId)! - depthByFolderId.get(right.folderId)!
      || compareStrings(pathKey(left.path), pathKey(right.path))
      || compareStrings(left.folderId, right.folderId)),
    pages: [...parsed.pages].sort((left, right) =>
      compareStrings(pathKey(left.path), pathKey(right.path)) || compareStrings(left.pageId, right.pageId)),
    attachments: [...parsed.attachments].sort((left, right) =>
      compareStrings(pathKey(left.path), pathKey(right.path)) || compareStrings(left.attachmentId, right.attachmentId)),
  };
}

const changeOrder: Record<TreeDeltaItemV3["operation"], number> = {
  archive_page: 0,
  archive_folder: 1,
  upsert_folder: 2,
  upsert_attachment: 3,
  upsert_page: 4,
  detach_attachment: 5,
};

function treeChangeSortKey(change: TreeDeltaItemV3 | TreePushManifestChangeV3): [number, string, string, string] {
  if (change.operation === "upsert_folder") return [changeOrder[change.operation], pathKey(change.folder.path), change.folder.folderId, change.operation];
  if (change.operation === "archive_folder") return [changeOrder[change.operation], pathKey(change.previousPath), change.folderId, change.operation];
  if (change.operation === "upsert_attachment") return [changeOrder[change.operation], pathKey(change.attachment.path), change.attachment.attachmentId, change.operation];
  if (change.operation === "upsert_page") return [changeOrder[change.operation], pathKey(change.page.path), change.page.pageId, change.operation];
  if (change.operation === "archive_page") return [changeOrder[change.operation], pathKey(change.previousPath), change.pageId, change.operation];
  return [changeOrder[change.operation], pathKey(change.previousPath), change.attachmentId, change.operation];
}

function compareTreeChanges(left: TreeDeltaItemV3 | TreePushManifestChangeV3, right: TreeDeltaItemV3 | TreePushManifestChangeV3): number {
  const leftKey = treeChangeSortKey(left);
  const rightKey = treeChangeSortKey(right);
  return leftKey[0] - rightKey[0]
    || compareStrings(leftKey[1], rightKey[1])
    || compareStrings(leftKey[2], rightKey[2])
    || compareStrings(leftKey[3], rightKey[3]);
}

export function canonicalTreeDeltaItemsV3(items: TreeDeltaItemV3[]): TreeDeltaItemV3[] {
  const parsed = z.array(TreeDeltaItemV3Schema).parse(items);
  return [...parsed].sort(compareTreeChanges);
}

function sameRevisionFolder(left: SyncFolderV3 | undefined, right: SyncFolderV3): boolean {
  return !!left
    && left.parentFolderId === right.parentFolderId
    && left.name === right.name
    && left.path === right.path
    && left.sortOrder === right.sortOrder
    && left.updatedAt === right.updatedAt;
}

function sameRevisionPage(left: SyncPageV3 | undefined, right: SyncPageV3): boolean {
  return !!left
    && left.folderId === right.folderId
    && left.path === right.path
    && left.title === right.title
    && left.contentHash === right.contentHash
    && left.updatedAt === right.updatedAt
    && left.referencedAttachmentIds.length === right.referencedAttachmentIds.length
    && left.referencedAttachmentIds.every((id, index) => id === right.referencedAttachmentIds[index]);
}

function sameRevisionAttachment(left: SyncAttachmentV3 | undefined, right: SyncAttachmentV3): boolean {
  return !!left
    && left.path === right.path
    && left.mimeType === right.mimeType
    && left.sizeBytes === right.sizeBytes
    && left.width === right.width
    && left.height === right.height
    && left.contentHash === right.contentHash
    && left.updatedAt === right.updatedAt;
}

export function treeRevisionDeltaV3(
  parentInput: TreeRevisionContentManifestV3 | null,
  currentInput: TreeRevisionContentManifestV3,
): TreeDeltaItemV3[] {
  const current = canonicalTreeRevisionManifestV3(currentInput);
  const parent = parentInput === null
    ? { protocolVersion: SYNC_PROTOCOL_V3, spaceId: current.spaceId, folders: [], pages: [], attachments: [] } satisfies TreeRevisionContentManifestV3
    : canonicalTreeRevisionManifestV3(parentInput);
  if (parent.spaceId !== current.spaceId) throw new TypeError("Tree revision manifests belong to different Spaces");

  const parentFolders = new Map(parent.folders.map((folder) => [folder.folderId, folder]));
  const currentFolders = new Map(current.folders.map((folder) => [folder.folderId, folder]));
  const parentPages = new Map(parent.pages.map((page) => [page.pageId, page]));
  const currentPages = new Map(current.pages.map((page) => [page.pageId, page]));
  const parentAttachments = new Map(parent.attachments.map((attachment) => [attachment.attachmentId, attachment]));
  const currentAttachments = new Map(current.attachments.map((attachment) => [attachment.attachmentId, attachment]));

  const changes: TreeDeltaItemV3[] = [];
  for (const page of parent.pages) {
    if (!currentPages.has(page.pageId)) changes.push({ operation: "archive_page", pageId: page.pageId, previousPath: page.path });
  }
  for (const folder of parent.folders) {
    if (!currentFolders.has(folder.folderId)) changes.push({ operation: "archive_folder", folderId: folder.folderId, previousPath: folder.path });
  }
  for (const folder of current.folders) {
    if (!sameRevisionFolder(parentFolders.get(folder.folderId), folder)) changes.push({ operation: "upsert_folder", folder });
  }
  for (const attachment of current.attachments) {
    if (!sameRevisionAttachment(parentAttachments.get(attachment.attachmentId), attachment)) changes.push({ operation: "upsert_attachment", attachment });
  }
  for (const page of current.pages) {
    if (!sameRevisionPage(parentPages.get(page.pageId), page)) changes.push({ operation: "upsert_page", page });
  }
  for (const attachment of parent.attachments) {
    if (!currentAttachments.has(attachment.attachmentId)) {
      changes.push({ operation: "detach_attachment", attachmentId: attachment.attachmentId, previousPath: attachment.path });
    }
  }
  return canonicalTreeDeltaItemsV3(changes);
}

const encoder = new TextEncoder();

async function domainHash(domain: string, value: unknown): Promise<string> {
  const prefix = encoder.encode(`${domain}\0`);
  const valueBytes = canonicalBytes(value);
  const bytes = new Uint8Array(prefix.byteLength + valueBytes.byteLength);
  bytes.set(prefix, 0);
  bytes.set(valueBytes, prefix.byteLength);
  return sha256Hex(bytes);
}

export async function treeCapabilitiesHashV3(capabilities: TreeSyncCapabilitiesV3): Promise<string> {
  return domainHash("agentwiki:sync-v3:capabilities", TreeSyncCapabilitiesV3Schema.parse(capabilities));
}

export async function treeRevisionContentHashV3(manifest: TreeRevisionContentManifestV3): Promise<string> {
  return domainHash("agentwiki:sync-v3:revision", canonicalTreeRevisionManifestV3(manifest));
}

export async function treeRevisionDeltaHashV3(manifest: TreeRevisionDeltaManifestV3): Promise<string> {
  const parsed = TreeRevisionDeltaManifestV3Schema.parse(manifest);
  return domainHash("agentwiki:sync-v3:delta", { ...parsed, items: canonicalTreeDeltaItemsV3(parsed.items) });
}

export async function treeConfirmationHashV3(manifest: TreePushConfirmationManifestV3): Promise<string> {
  const parsed = TreePushConfirmationManifestV3Schema.parse(manifest);
  return domainHash("agentwiki:sync-v3:confirmation", { ...parsed, changes: [...parsed.changes].sort(compareTreeChanges) });
}

export async function treeBatchHashV3(batch: TreePushBatchWithoutHashV3): Promise<string> {
  const parsed = z.object({
    protocolVersion: z.literal(SYNC_PROTOCOL_V3),
    batchIndex: z.number().int().nonnegative(),
    changes: z.array(TreePushChangeV3Schema).min(1).max(TREE_SYNC_V2_LIMITS.maxPushChanges),
  }).strict().parse(batch);
  return domainHash("agentwiki:sync-v3:batch", { ...parsed, changes: [...parsed.changes].sort(compareTreeChanges) });
}

export async function blobContentHashV3(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > TREE_SYNC_V3_HARD_LIMITS.maxAttachmentBytes) {
    throw new RangeError("ATTACHMENT_QUOTA_EXCEEDED");
  }
  return sha256Hex(bytes);
}

export async function blobChunkHashV3(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > TREE_SYNC_V3_HARD_LIMITS.blobChunkBytes) {
    throw new RangeError("ATTACHMENT_QUOTA_EXCEEDED");
  }
  return sha256Hex(bytes);
}
