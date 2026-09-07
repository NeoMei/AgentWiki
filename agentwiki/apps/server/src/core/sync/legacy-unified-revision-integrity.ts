import type { Prisma } from '@prisma/client';
import {
  canonicalBytes,
  canonicalTreeRevisionManifestV2,
  contentHash,
  normalizeMarkdown,
  pathKey,
  revisionContentHash,
  treeRevisionContentHashV2,
  validatePortableMarkdownPath,
  type TreeRevisionContentManifestV2,
} from '@neomei/agentwiki-sync-protocol';
import { legacyBundleHash, type LegacyPageProjection } from './legacy-serializer';
import { isLegacyUnifiedRevisionFormat } from './sync-revision-format';

const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export class LegacyUnifiedRevisionIntegrityError extends Error {
  constructor() {
    super('LEGACY_UNIFIED_REVISION_INTEGRITY_FAILED');
    this.name = 'LegacyUnifiedRevisionIntegrityError';
  }
}

interface LegacyUnifiedRevision {
  id: string;
  spaceId: string;
  sequence: number;
  parentRevisionId: string | null;
  schemaVersion: string;
  recipeVersion: string;
  contentHash: string;
  revisionContentHash: string;
  pageCount: bigint;
  revisionManifestByteLength: bigint;
  revisionBodyBytes: bigint;
  migrationBatchId: string | null;
  origin: string | null;
  attachmentCount: bigint;
  revisionAttachmentBytes: bigint;
  createdAt: Date;
}

const LEGACY_UNIFIED_REVISION_SELECT = {
  id: true,
  spaceId: true,
  sequence: true,
  parentRevisionId: true,
  schemaVersion: true,
  recipeVersion: true,
  contentHash: true,
  revisionContentHash: true,
  pageCount: true,
  revisionManifestByteLength: true,
  revisionBodyBytes: true,
  migrationBatchId: true,
  origin: true,
  attachmentCount: true,
  revisionAttachmentBytes: true,
  createdAt: true,
} as const;

export interface VerifiedLegacyUnifiedRevision {
  revision: LegacyUnifiedRevision;
  manifest: TreeRevisionContentManifestV2;
  revisionContentHash: string;
  revisionManifestByteLength: number;
  revisionBodyBytes: number;
}

function fail(): never {
  throw new LegacyUnifiedRevisionIntegrityError();
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function arrays(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function migrationBatchPrefix(revision: LegacyUnifiedRevision): string | null {
  if (!revision.migrationBatchId) return null;
  const suffix = `:${revision.id}`;
  if (!revision.migrationBatchId.endsWith(suffix)) return null;
  const prefix = revision.migrationBatchId.slice(0, -suffix.length);
  return prefix.length > 0 ? prefix : null;
}

/**
 * Verify the historical Release-A backfill shape without mutating it. Those
 * revisions retained a null SQL parent, while the original logical chain is
 * sealed by sidecar.baseRevision and one backfill batch prefix.
 */
export async function verifyLegacyUnifiedRevisionChain(
  tx: Prisma.TransactionClient,
  spaceId: string,
  revisionRef: string | LegacyUnifiedRevision,
): Promise<VerifiedLegacyUnifiedRevision> {
  const revisionId = typeof revisionRef === 'string' ? revisionRef : revisionRef.id;
  const current = await tx.spaceKnowledgeRevision.findUnique({
    where: { id: revisionId },
    select: LEGACY_UNIFIED_REVISION_SELECT,
  });
  if (!current || current.spaceId !== spaceId || !isLegacyUnifiedRevisionFormat(current)) fail();
  if (!Number.isSafeInteger(current.sequence) || current.sequence < 1) fail();
  const revisions = await tx.spaceKnowledgeRevision.findMany({
    where: { spaceId, sequence: { lte: current.sequence } },
    orderBy: { sequence: 'asc' },
    select: LEGACY_UNIFIED_REVISION_SELECT,
  }) as LegacyUnifiedRevision[];
  if (revisions.length !== current.sequence) fail();
  if (revisions[revisions.length - 1]?.id !== current.id) fail();
  const prefix = migrationBatchPrefix(current as LegacyUnifiedRevision);
  if (!prefix) fail();
  for (const [index, revision] of revisions.entries()) {
    if (
      revision.spaceId !== spaceId
      || revision.sequence !== index + 1
      || revision.parentRevisionId !== null
      || !isLegacyUnifiedRevisionFormat(revision)
      || migrationBatchPrefix(revision) !== prefix
      || revision.attachmentCount !== 0n
      || revision.revisionAttachmentBytes !== 0n
    ) fail();
  }

  const ids = revisions.map((revision) => revision.id);
  const [pageRows, sidecarRows, extras, folderRow, attachmentRow, treeDeltaRow] = await Promise.all([
    tx.syncRevisionPageRow.findMany({
      where: { revisionId: { in: ids } },
      include: { content: true },
    }),
    tx.legacyRevisionSidecar.findMany({ where: { revisionId: { in: ids } } }),
    tx.legacyRevisionPageExtra.findMany({
      where: { revisionId: { in: ids } },
      orderBy: [{ revisionId: 'asc' }, { ordinal: 'asc' }],
    }),
    tx.syncRevisionFolderRow.findFirst({
      where: { revisionId: { in: ids } },
      select: { revisionId: true },
    }),
    tx.syncRevisionAttachmentRow.findFirst({
      where: { revisionId: { in: ids } },
      select: { revisionId: true },
    }),
    tx.syncRevisionTreeDeltaRow.findFirst({
      where: { revisionId: { in: ids } },
      select: { revisionId: true },
    }),
  ]);
  if (folderRow || attachmentRow || treeDeltaRow) fail();
  const legacyBodyHashes = [...new Set(extras.map((row) => row.legacyBodyHash))];
  const legacyBodies = legacyBodyHashes.length === 0
    ? []
    : await tx.legacyPageBodyRow.findMany({
      where: { contentHash: { in: legacyBodyHashes } },
    });
  const pagesByRevision = groupByRevision(pageRows as Array<{ revisionId: string }>);
  const extrasByRevision = groupByRevision(extras as Array<{ revisionId: string }>);
  const sidecarByRevision = new Map(sidecarRows.map((row) => [row.revisionId, row.sidecar]));
  const legacyBodyByHash = new Map(legacyBodies.map((row) => [row.contentHash, row.body]));
  let verifiedCurrent: VerifiedLegacyUnifiedRevision | null = null;

  for (const [index, revision] of revisions.entries()) {
    const sidecar = record(sidecarByRevision.get(revision.id));
    const memories = arrays(sidecar?.memories);
    const relations = arrays(sidecar?.relations);
    const provenance = arrays(sidecar?.provenance);
    const deletions = arrays(sidecar?.deletions);
    const expectedBase = index === 0 ? '0' : revisions[index - 1]!.id;
    if (
      !sidecar
      || !exactKeys(sidecar, [
        'schemaVersion', 'recipeVersion', 'baseRevision', 'memories',
        'relations', 'provenance', 'deletions',
      ])
      || sidecar.schemaVersion !== revision.schemaVersion
      || sidecar.recipeVersion !== revision.recipeVersion
      || sidecar.baseRevision !== expectedBase
      || !memories || !relations || !provenance || !deletions
    ) fail();

    const rawPages = pagesByRevision.get(revision.id) ?? [];
    const immutablePages = [];
    for (const raw of rawPages as any[]) {
      const portable = validatePortableMarkdownPath(raw.path);
      const body = normalizeMarkdown(raw.content.body);
      if (
        portable.path !== raw.path
        || portable.key !== raw.pathKey
        || pathKey(raw.path) !== raw.pathKey
        || body !== raw.content.body
        || await contentHash(body) !== raw.contentHash
        || Buffer.byteLength(body, 'utf8') !== raw.content.byteLength
        || raw.folderId !== null
      ) fail();
      immutablePages.push({
        pageId: raw.pageId,
        folderId: null,
        path: raw.path,
        title: raw.title,
        body,
        contentHash: raw.contentHash,
        updatedAt: raw.updatedAt.toISOString(),
      });
    }
    let manifest: TreeRevisionContentManifestV2;
    try {
      manifest = canonicalTreeRevisionManifestV2({
        protocolVersion: '2',
        spaceId,
        folders: [],
        pages: immutablePages,
      });
    } catch {
      fail();
    }
    const v1Manifest = {
      protocolVersion: '1' as const,
      spaceId,
      pages: manifest.pages.map((page) => ({
        pageId: page.pageId,
        path: page.path,
        title: page.title,
        contentHash: page.contentHash,
      })),
    };
    const empty = manifest.pages.length === 0;
    const storedRevisionHash = empty ? EMPTY_HASH : await revisionContentHash(v1Manifest);
    const storedManifestBytes = empty ? 0 : canonicalBytes(v1Manifest).byteLength;
    const bodyBytes = manifest.pages.reduce(
      (total, page) => total + Buffer.byteLength(page.body, 'utf8'),
      0,
    );
    if (
      revision.revisionContentHash !== storedRevisionHash
      || revision.pageCount !== BigInt(manifest.pages.length)
      || revision.revisionManifestByteLength !== BigInt(storedManifestBytes)
      || revision.revisionBodyBytes !== BigInt(bodyBytes)
    ) fail();

    const revisionExtras = extrasByRevision.get(revision.id) ?? [];
    if (revisionExtras.length !== manifest.pages.length) fail();
    const immutableByPageId = new Map(manifest.pages.map((page) => [page.pageId, page]));
    const legacyPages: LegacyPageProjection[] = [];
    const seenIds = new Set<string>();
    for (const [ordinal, rawExtra] of (revisionExtras as any[]).entries()) {
      if (rawExtra.ordinal !== ordinal || seenIds.has(rawExtra.pageId)) fail();
      seenIds.add(rawExtra.pageId);
      const extra = record(rawExtra.extra);
      const legacyBody = legacyBodyByHash.get(rawExtra.legacyBodyHash);
      const immutablePage = immutableByPageId.get(rawExtra.pageId);
      const metadata = record(extra?.metadata);
      const artifactIds = arrays(extra?.artifactIds);
      if (
        !extra
        || !exactKeys(extra, [
          'spaceId', 'title', 'order', 'metadata', 'artifactIds',
          'legacyBodyHash', 'contentHash', 'path', 'updatedAt',
        ])
        || !immutablePage
        || typeof legacyBody !== 'string'
        || extra.spaceId !== spaceId
        || extra.title !== immutablePage.title
        || typeof extra.path !== 'string'
        || typeof extra.order !== 'number'
        || !Number.isSafeInteger(extra.order)
        || (extra.metadata !== null && !metadata)
        || !artifactIds
        || artifactIds.some((artifactId) => typeof artifactId !== 'string')
        || extra.legacyBodyHash !== rawExtra.legacyBodyHash
        || extra.contentHash !== rawExtra.legacyBodyHash
        || typeof extra.updatedAt !== 'string'
        || new Date(extra.updatedAt).getTime() !== new Date(immutablePage.updatedAt).getTime()
      ) fail();
      legacyPages.push({
        pageId: rawExtra.pageId,
        spaceId,
        path: typeof extra.path === 'string' ? extra.path : '',
        title: typeof extra.title === 'string' ? extra.title : '',
        body: legacyBody,
        order: typeof extra.order === 'number' ? extra.order : 0,
        metadata: metadata as { parentId: string } | null,
        artifactIds: artifactIds as string[],
        contentHash: extra.contentHash as string,
        updatedAt: extra.updatedAt,
      });
    }
    if (manifest.pages.some((page) => !seenIds.has(page.pageId))) fail();
    if (revision.contentHash !== legacyBundleHash({
      schemaVersion: revision.schemaVersion,
      recipeVersion: revision.recipeVersion,
      spaceId,
      baseRevision: expectedBase,
      pages: legacyPages,
      memories,
      relations,
      provenance,
      deletions,
    })) fail();

    if (revision.id === current.id) {
      verifiedCurrent = {
        revision,
        manifest,
        revisionContentHash: empty ? EMPTY_HASH : await treeRevisionContentHashV2(manifest),
        revisionManifestByteLength: empty ? 0 : canonicalBytes(manifest).byteLength,
        revisionBodyBytes: bodyBytes,
      };
    }
  }
  return verifiedCurrent ?? fail();
}

function groupByRevision<T extends { revisionId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) grouped.set(row.revisionId, [...(grouped.get(row.revisionId) ?? []), row]);
  return grouped;
}
