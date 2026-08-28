import { z } from "zod";
import { canonicalBytes } from "./canonical.js";
import { sha256Hex } from "./hash.js";
import { pathKey, validatePortableDirectoryPath, validatePortableMarkdownPath } from "./normalize.js";

const encoder = new TextEncoder();
const PublicIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const UuidSchema = z.string().uuid();
const Rfc3339Schema = z.string().datetime({ offset: true });
const DecimalCountSchema = z.string().regex(/^(0|[1-9][0-9]*)$/).refine(
  (value) => BigInt(value) <= 9223372036854775807n,
  "Decimal count exceeds signed bigint",
);

export const SYNC_PROTOCOL_V2 = "2" as const;
export const TREE_SYNC_V2_LIMITS = {
  maxPushChanges: 100,
  maxDocumentTreeBytes: 2 * 1024 * 1024,
} as const;

function validateManagedPath(
  input: string,
  validate: (value: string) => { path: string },
): string {
  const path = validate(input).path;
  if (!path.startsWith("pages/"))
    throw new TypeError("Path must be under pages/");
  return path;
}

function portableDirectoryPath() {
  return z.string().transform((value, context) => {
    try {
      return validateManagedPath(value, validatePortableDirectoryPath);
    } catch (error) {
      context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Path is not portable" });
      return z.NEVER;
    }
  });
}

function portableMarkdownPath() {
  return z.string().transform((value, context) => {
    try {
      return validateManagedPath(value, validatePortableMarkdownPath);
    } catch (error) {
      context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Path is not portable" });
      return z.NEVER;
    }
  });
}

export interface SyncFolderV2 {
  folderId: string;
  parentFolderId: string | null;
  name: string;
  path: string;
  sortOrder: number;
  updatedAt: string;
}

export interface SyncPageV2 {
  pageId: string;
  folderId: string | null;
  path: string;
  title: string;
  body: string;
  contentHash: string;
  updatedAt: string;
}

const SyncFolderV2ObjectSchema = z.object({
  folderId: PublicIdSchema,
  parentFolderId: PublicIdSchema.nullable(),
  name: z.string(),
  path: portableDirectoryPath(),
  sortOrder: z.number().int(),
  updatedAt: Rfc3339Schema,
}).strict();
export const SyncFolderV2Schema: z.ZodType<SyncFolderV2> = SyncFolderV2ObjectSchema;

const SyncPageV2ObjectSchema = z.object({
  pageId: PublicIdSchema,
  folderId: PublicIdSchema.nullable(),
  path: portableMarkdownPath(),
  title: z.string(),
  body: z.string(),
  contentHash: HashSchema,
  updatedAt: Rfc3339Schema,
}).strict();
export const SyncPageV2Schema: z.ZodType<SyncPageV2> = SyncPageV2ObjectSchema;

const TreePushManifestFolderUpsertV2Schema = z.object({
  operation: z.literal("upsert_folder"),
  folder: SyncFolderV2Schema,
}).strict();
const TreePushManifestPageUpsertV2Schema = z.object({
  operation: z.literal("upsert_page"),
  page: SyncPageV2ObjectSchema.omit({ body: true }),
}).strict();
export const TreeArchiveFolderV2Schema = z.object({
  operation: z.literal("archive_folder"),
  folderId: PublicIdSchema,
  previousPath: portableDirectoryPath(),
}).strict();
export const TreeArchivePageV2Schema = z.object({
  operation: z.literal("archive_page"),
  pageId: PublicIdSchema,
  previousPath: portableMarkdownPath(),
}).strict();

export const TreePushManifestChangeV2Schema = z.union([
  TreePushManifestFolderUpsertV2Schema,
  TreeArchiveFolderV2Schema,
  TreePushManifestPageUpsertV2Schema,
  TreeArchivePageV2Schema,
]);

export const TreePushChangeV2Schema = z.union([
  z.object({ operation: z.literal("upsert_folder"), folder: SyncFolderV2Schema }).strict(),
  TreeArchiveFolderV2Schema,
  z.object({ operation: z.literal("upsert_page"), page: SyncPageV2ObjectSchema }).strict(),
  TreeArchivePageV2Schema,
]);

export type TreePushManifestChangeV2 = z.infer<typeof TreePushManifestChangeV2Schema>;
export type TreePushChangeV2 = z.infer<typeof TreePushChangeV2Schema>;

export type TreeDeltaItemV2 =
  | { operation: "upsert_folder"; folder: SyncFolderV2 }
  | { operation: "archive_folder"; folderId: string; previousPath: string }
  | { operation: "upsert_page"; page: SyncPageV2 }
  | { operation: "archive_page"; pageId: string; previousPath: string };

export const TreeDeltaItemV2Schema: z.ZodType<TreeDeltaItemV2> = TreePushChangeV2Schema;

export interface TreeRevisionContentManifestV2 {
  protocolVersion: "2";
  spaceId: string;
  folders: SyncFolderV2[];
  pages: SyncPageV2[];
}

export const TreeRevisionContentManifestV2Schema: z.ZodType<TreeRevisionContentManifestV2> = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V2),
  spaceId: PublicIdSchema,
  folders: z.array(SyncFolderV2Schema),
  pages: z.array(SyncPageV2Schema),
}).strict();

export interface TreePushConfirmationManifestV2 {
  protocolVersion: "2";
  spaceId: string;
  baseRevision: string;
  changes: TreePushManifestChangeV2[];
}

export const TreePushConfirmationManifestV2Schema: z.ZodType<TreePushConfirmationManifestV2> = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V2),
  spaceId: PublicIdSchema,
  baseRevision: PublicIdSchema,
  changes: z.array(TreePushManifestChangeV2Schema),
}).strict();

export interface TreePushBatchWithoutHashV2 {
  protocolVersion: "2";
  batchIndex: number;
  changes: TreePushChangeV2[];
}

export interface TreePushBatchV2 extends TreePushBatchWithoutHashV2 {
  batchHash: string;
}

export const TreePushBatchV2Schema: z.ZodType<TreePushBatchV2> = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V2),
  batchIndex: z.number().int().nonnegative(),
  changes: z.array(TreePushChangeV2Schema).min(1).max(TREE_SYNC_V2_LIMITS.maxPushChanges),
  batchHash: HashSchema,
}).strict();

export const CreateTreePushSessionRequestV2Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V2),
  baseRevision: PublicIdSchema,
  idempotencyKey: UuidSchema,
  capabilitiesHash: HashSchema,
  confirmationHash: HashSchema,
  confirmationByteLength: z.number().int().positive().max(4_194_304),
  changeCount: z.number().int().min(0).max(TREE_SYNC_V2_LIMITS.maxPushChanges),
  totalBodyBytes: z.number().int().nonnegative(),
}).strict();

const PushSessionStatusV2Schema = z.enum(["uploading", "ready_to_finalize", "published", "aborted", "expired"]);
const treeRevisionCountsSchema = {
  folderCount: DecimalCountSchema,
  pageCount: DecimalCountSchema,
  revisionManifestByteLength: DecimalCountSchema,
  revisionBodyBytes: DecimalCountSchema,
};

export const TreeRevisionHeadResponseV2Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V2),
  spaceId: PublicIdSchema,
  revision: PublicIdSchema,
  sequence: z.number().int().nonnegative(),
  revisionContentHash: HashSchema,
  ...treeRevisionCountsSchema,
  publishedAt: Rfc3339Schema.nullable(),
}).strict();

export const TreeSnapshotPageV2Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V2),
  spaceId: PublicIdSchema,
  revision: PublicIdSchema,
  sequence: z.number().int().nonnegative(),
  revisionContentHash: HashSchema,
  ...treeRevisionCountsSchema,
  folders: z.array(SyncFolderV2Schema),
  pages: z.array(SyncPageV2Schema),
  nextCursor: z.string().max(4096).nullable(),
}).strict();

export const TreeDeltaPageV2Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V2),
  spaceId: PublicIdSchema,
  fromRevision: PublicIdSchema,
  toRevision: PublicIdSchema,
  toSequence: z.number().int().nonnegative(),
  toRevisionContentHash: HashSchema,
  toFolderCount: DecimalCountSchema,
  toPageCount: DecimalCountSchema,
  toRevisionManifestByteLength: DecimalCountSchema,
  toRevisionBodyBytes: DecimalCountSchema,
  items: z.array(TreeDeltaItemV2Schema),
  nextCursor: z.string().max(4096).nullable(),
}).strict();

export const TreeFinalizePushRequestV2Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V2),
  confirmationHash: HashSchema,
  userConfirmed: z.literal(true),
}).strict();

export const TreeFinalizePushResponseV2Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V2),
  status: z.enum(["published", "noop"]),
  revision: PublicIdSchema,
  sequence: z.number().int(),
  publishedAt: Rfc3339Schema.nullable(),
  revisionContentHash: HashSchema,
  ...treeRevisionCountsSchema,
  changeSetId: z.string().nullable(),
}).strict();

export const CreateTreePushSessionResponseV2Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V2),
  sessionId: UuidSchema,
  status: PushSessionStatusV2Schema,
  expiresAt: Rfc3339Schema,
  result: TreeFinalizePushResponseV2Schema.nullable(),
}).strict();

export const TreePushSessionStatusResponseV2Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V2),
  sessionId: UuidSchema,
  status: PushSessionStatusV2Schema,
  expiresAt: Rfc3339Schema,
  receivedBatchIndexes: z.array(z.number().int().nonnegative()),
  result: TreeFinalizePushResponseV2Schema.nullable(),
}).strict();

export const TreePushBatchReceiptV2Schema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_V2),
  sessionId: UuidSchema,
  batchIndex: z.number().int().nonnegative(),
  batchHash: HashSchema,
  receipt: z.string(),
  receivedBatchCount: z.number().int().nonnegative(),
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

function folderDepth(folder: SyncFolderV2, folders: ReadonlyMap<string, SyncFolderV2>, visiting = new Set<string>()): number {
  if (folder.parentFolderId === null) return 0;
  if (visiting.has(folder.folderId)) throw new TypeError("Folder hierarchy contains a cycle");
  const parent = folders.get(folder.parentFolderId);
  if (!parent) throw new TypeError("Folder hierarchy references an unknown parent");
  visiting.add(folder.folderId);
  try {
    return folderDepth(parent, folders, visiting) + 1;
  } finally {
    visiting.delete(folder.folderId);
  }
}

export function canonicalTreeRevisionManifestV2(
  manifest: TreeRevisionContentManifestV2,
): TreeRevisionContentManifestV2 {
  const parsed = TreeRevisionContentManifestV2Schema.parse(manifest);
  const foldersById = new Map(parsed.folders.map((folder) => [folder.folderId, folder]));
  if (foldersById.size !== parsed.folders.length) throw new TypeError("Folder manifest contains duplicate IDs");
  return {
    ...parsed,
    folders: [...parsed.folders].sort((left, right) =>
      folderDepth(left, foldersById) - folderDepth(right, foldersById)
      || compareStrings(pathKey(left.path), pathKey(right.path))
      || compareStrings(left.folderId, right.folderId)),
    pages: [...parsed.pages].sort((left, right) =>
      compareStrings(pathKey(left.path), pathKey(right.path)) || compareStrings(left.pageId, right.pageId)),
  };
}

function sameRevisionFolder(left: SyncFolderV2 | undefined, right: SyncFolderV2): boolean {
  return !!left
    && left.parentFolderId === right.parentFolderId
    && left.name === right.name
    && left.path === right.path
    && left.sortOrder === right.sortOrder
    && left.updatedAt === right.updatedAt;
}

function sameRevisionPage(left: SyncPageV2 | undefined, right: SyncPageV2): boolean {
  return !!left
    && left.folderId === right.folderId
    && left.path === right.path
    && left.title === right.title
    && left.contentHash === right.contentHash
    && left.updatedAt === right.updatedAt;
}

/**
 * Derive the unique persisted/served tree delta from immutable manifests.
 * A null parent represents a pre-v2 revision and therefore produces a full
 * parent-first v2 upsert set.
 */
export function treeRevisionDeltaV2(
  parentInput: TreeRevisionContentManifestV2 | null,
  currentInput: TreeRevisionContentManifestV2,
): TreeDeltaItemV2[] {
  const current = canonicalTreeRevisionManifestV2(currentInput);
  const parent = parentInput === null
    ? { protocolVersion: SYNC_PROTOCOL_V2, spaceId: current.spaceId, folders: [], pages: [] } satisfies TreeRevisionContentManifestV2
    : canonicalTreeRevisionManifestV2(parentInput);
  if (parent.spaceId !== current.spaceId) throw new TypeError("Tree revision manifests belong to different Spaces");

  const parentFolders = new Map(parent.folders.map((folder) => [folder.folderId, folder]));
  const currentFolders = new Map(current.folders.map((folder) => [folder.folderId, folder]));
  const parentPages = new Map(parent.pages.map((page) => [page.pageId, page]));
  const currentPages = new Map(current.pages.map((page) => [page.pageId, page]));

  const archivedPages: TreeDeltaItemV2[] = parent.pages
    .filter((page) => !currentPages.has(page.pageId))
    .sort((left, right) => compareStrings(pathKey(left.path), pathKey(right.path)) || compareStrings(left.pageId, right.pageId))
    .map((page) => ({ operation: "archive_page", pageId: page.pageId, previousPath: page.path }));
  const archivedFolders: TreeDeltaItemV2[] = parent.folders
    .filter((folder) => !currentFolders.has(folder.folderId))
    .sort((left, right) => folderDepth(right, parentFolders) - folderDepth(left, parentFolders)
      || compareStrings(pathKey(left.path), pathKey(right.path))
      || compareStrings(left.folderId, right.folderId))
    .map((folder) => ({ operation: "archive_folder", folderId: folder.folderId, previousPath: folder.path }));
  const upsertFolders: TreeDeltaItemV2[] = current.folders
    .filter((folder) => !sameRevisionFolder(parentFolders.get(folder.folderId), folder))
    .map((folder) => ({ operation: "upsert_folder", folder }));
  const upsertPages: TreeDeltaItemV2[] = current.pages
    .filter((page) => !sameRevisionPage(parentPages.get(page.pageId), page))
    .map((page) => ({ operation: "upsert_page", page }));
  return [...archivedPages, ...archivedFolders, ...upsertFolders, ...upsertPages];
}

function treeChangeSortKey(change: TreePushManifestChangeV2 | TreePushChangeV2): [number, string, string, string] {
  if (change.operation === "upsert_folder") return [0, pathKey(change.folder.path), change.folder.folderId, change.operation];
  if (change.operation === "archive_folder") return [0, pathKey(change.previousPath), change.folderId, change.operation];
  if (change.operation === "upsert_page") return [1, pathKey(change.page.path), change.page.pageId, change.operation];
  return [1, pathKey(change.previousPath), change.pageId, change.operation];
}

function compareTreeChanges(left: TreePushManifestChangeV2 | TreePushChangeV2, right: TreePushManifestChangeV2 | TreePushChangeV2): number {
  const leftKey = treeChangeSortKey(left);
  const rightKey = treeChangeSortKey(right);
  return leftKey[0] - rightKey[0]
    || compareStrings(leftKey[1], rightKey[1])
    || compareStrings(leftKey[2], rightKey[2])
    || compareStrings(leftKey[3], rightKey[3]);
}

export async function treeConfirmationHashV2(manifest: TreePushConfirmationManifestV2): Promise<string> {
  const parsed = TreePushConfirmationManifestV2Schema.parse(manifest);
  return sha256Hex(canonicalBytes({ ...parsed, changes: [...parsed.changes].sort(compareTreeChanges) }));
}

export async function treeBatchHashV2(batch: TreePushBatchWithoutHashV2): Promise<string> {
  return sha256Hex(canonicalBytes({ ...batch, changes: [...batch.changes].sort(compareTreeChanges) }));
}

export async function treeRevisionContentHashV2(manifest: TreeRevisionContentManifestV2): Promise<string> {
  const canonical = canonicalTreeRevisionManifestV2(manifest);
  if (canonical.folders.length === 0 && canonical.pages.length === 0) return sha256Hex(new Uint8Array());
  return sha256Hex(canonicalBytes(canonical));
}

export interface TreePushCapabilitiesV2 {
  maxPageBytes: number;
  maxBatchBytes: number;
  maxBatchItems: number;
  maxChangeCount: number;
}

function pageBodyBytes(change: TreePushChangeV2): number {
  return change.operation === "upsert_page"
    ? encoder.encode(change.page.body.replace(/\r\n?/g, "\n")).byteLength
    : 0;
}

async function materializeTreeBatch(batchIndex: number, changes: TreePushChangeV2[]): Promise<TreePushBatchV2> {
  const withoutHash: TreePushBatchWithoutHashV2 = { protocolVersion: SYNC_PROTOCOL_V2, batchIndex, changes };
  return { ...withoutHash, batchHash: await treeBatchHashV2(withoutHash) };
}

export async function partitionTreePushChangesV2(
  changes: TreePushChangeV2[],
  capabilities: TreePushCapabilitiesV2,
): Promise<TreePushBatchV2[]> {
  if (changes.length > Math.min(capabilities.maxChangeCount, TREE_SYNC_V2_LIMITS.maxPushChanges))
    throw new RangeError("BATCH_TOO_LARGE");
  const sorted = [...changes].sort(compareTreeChanges);
  const batches: TreePushBatchV2[] = [];
  let current: TreePushChangeV2[] = [];
  for (const change of sorted) {
    if (pageBodyBytes(change) > capabilities.maxPageBytes) throw new RangeError("PAGE_TOO_LARGE");
    const proposed = [...current, change];
    const batch = await materializeTreeBatch(batches.length, proposed);
    const exceeds = proposed.length > capabilities.maxBatchItems || canonicalBytes(batch).byteLength > capabilities.maxBatchBytes;
    if (exceeds && current.length === 0) throw new RangeError("BATCH_TOO_LARGE");
    if (exceeds) {
      batches.push(await materializeTreeBatch(batches.length, current));
      current = [change];
      if (canonicalBytes(await materializeTreeBatch(batches.length, current)).byteLength > capabilities.maxBatchBytes)
        throw new RangeError("BATCH_TOO_LARGE");
    } else {
      current = proposed;
    }
  }
  if (current.length > 0) batches.push(await materializeTreeBatch(batches.length, current));
  return batches;
}
