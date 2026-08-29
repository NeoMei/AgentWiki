import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  canonicalBytes,
  canonicalTreeRevisionManifestV2,
  contentHash,
  normalizeMarkdown,
  treeRevisionDeltaV2,
  treeRevisionContentHashV2,
  validatePortableDirectoryPath,
  validatePortableMarkdownPath,
  type SyncFolderV2,
  type SyncPageV2,
  type TreeDeltaItemV2,
  type TreeRevisionContentManifestV2,
} from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../../database/prisma.service';
import { SyncApiException } from './sync-error';
import { SyncCursorService } from './sync-cursor.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import {
  assertRevisionV2Metadata,
  assertStoredTreeDeltaV2,
  REVISION_V2_SCALAR_SELECT,
  revisionShouldBeV2,
  validateRevisionChainTrust,
} from '../../core/sync/revision-v2-integrity';

const EMPTY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

interface LoadedRevision {
  revision: string;
  sequence: number;
  publishedAt: string | null;
  manifest: TreeRevisionContentManifestV2;
  revisionContentHash: string;
  revisionManifestByteLength: number;
  revisionBodyBytes: number;
}

function folderDepth(folder: SyncFolderV2, folders: ReadonlyMap<string, SyncFolderV2>): number {
  let depth = 0;
  let current = folder;
  const seen = new Set<string>();
  while (current.parentFolderId !== null) {
    if (seen.has(current.folderId)) throw new SyncApiException('REVISION_GONE', 'Folder revision contains a cycle', undefined, '2');
    seen.add(current.folderId);
    const parent = folders.get(current.parentFolderId);
    if (!parent) throw new SyncApiException('REVISION_GONE', 'Folder revision references a missing parent', undefined, '2');
    current = parent;
    depth += 1;
  }
  return depth;
}

function revisionGone(): SyncApiException {
  return new SyncApiException('REVISION_GONE', 'Revision is not available', undefined, '2');
}

@Injectable()
export class SyncV2RevisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cursors: SyncCursorService,
    private readonly capabilities: SyncCapabilitiesService,
  ) {}

  async head(spaceId: string) {
    const loaded = await this.loadRevision(spaceId, 'current');
    return this.headEnvelope(spaceId, loaded);
  }

  async snapshot(spaceId: string, revisionRef = 'current', cursor?: string, limit = 100) {
    this.assertLimit(limit);
    let revision = revisionRef;
    let afterKey: string | undefined;
    if (cursor) {
      const payload = this.decodeCursor(cursor);
      if (payload.kind !== 'snapshot-v2' || payload.spaceId !== spaceId) this.invalidCursor();
      if (revisionRef !== 'current' && revisionRef !== payload.revision) this.invalidCursor();
      revision = payload.revision;
      afterKey = payload.lastPageId;
    }
    const loaded = await this.loadRevision(spaceId, revision);
    const entries = [
      ...loaded.manifest.folders.map((folder) => ({ key: `folder:${folder.folderId}`, folder })),
      ...loaded.manifest.pages.map((page) => ({ key: `page:${page.pageId}`, page })),
    ];
    const start = this.resumeIndex(entries.map((entry) => entry.key), afterKey);
    const metadata = this.snapshotMetadata(spaceId, loaded);
    const selected: typeof entries = [];
    const maxBytes = this.capabilities.capabilitiesV2().maxResponseBytes;
    for (let index = start; index < entries.length && selected.length < limit; index += 1) {
      const candidate = [...selected, entries[index]!];
      const hasMore = index + 1 < entries.length;
      const nextCursor = hasMore
        ? this.encodeCursor({
          kind: 'snapshot-v2', spaceId, revision: loaded.revision,
          lastPageId: candidate[candidate.length - 1]!.key,
        })
        : null;
      const response = this.snapshotEnvelope(metadata, candidate, nextCursor);
      if (Buffer.byteLength(JSON.stringify(response), 'utf8') > maxBytes) {
        if (selected.length === 0) {
          throw new SyncApiException('SPACE_TOO_LARGE', 'One snapshot item exceeds maxResponseBytes', undefined, '2');
        }
        break;
      }
      selected.push(entries[index]!);
    }
    const consumed = start + selected.length;
    const nextCursor = consumed < entries.length
      ? this.encodeCursor({
        kind: 'snapshot-v2', spaceId, revision: loaded.revision,
        lastPageId: selected[selected.length - 1]!.key,
      })
      : null;
    return this.snapshotEnvelope(metadata, selected, nextCursor);
  }

  async delta(spaceId: string, fromRevision: string, cursor?: string, limit = 100) {
    this.assertLimit(limit);
    let toRevision = 'current';
    let afterOrdinal: number | undefined;
    if (cursor) {
      const payload = this.decodeCursor(cursor);
      if (
        payload.kind !== 'delta-v2'
        || payload.spaceId !== spaceId
        || payload.fromRevision !== fromRevision
      ) this.invalidCursor();
      toRevision = payload.revision;
      afterOrdinal = Number(payload.lastPageId);
      if (!Number.isSafeInteger(afterOrdinal) || afterOrdinal! < 0) this.invalidCursor();
    }
    const [from, to] = await Promise.all([
      this.loadRevision(spaceId, fromRevision),
      this.loadRevision(spaceId, toRevision),
    ]);
    const items = this.deltaItems(from.manifest, to.manifest);
    const start = afterOrdinal === undefined ? 0 : afterOrdinal + 1;
    if (start > items.length) this.invalidCursor();
    const metadata = {
      protocolVersion: '2' as const,
      spaceId,
      fromRevision: from.revision,
      toRevision: to.revision,
      toSequence: to.sequence,
      toRevisionContentHash: to.revisionContentHash,
      toFolderCount: String(to.manifest.folders.length),
      toPageCount: String(to.manifest.pages.length),
      toRevisionManifestByteLength: String(to.revisionManifestByteLength),
      toRevisionBodyBytes: String(to.revisionBodyBytes),
    };
    const selected: TreeDeltaItemV2[] = [];
    const maxBytes = this.capabilities.capabilitiesV2().maxResponseBytes;
    for (let index = start; index < items.length && selected.length < limit; index += 1) {
      const candidate = [...selected, items[index]!];
      const hasMore = index + 1 < items.length;
      const nextCursor = hasMore ? this.encodeCursor({
        kind: 'delta-v2', spaceId, revision: to.revision, fromRevision: from.revision,
        lastPageId: String(index),
      }) : null;
      const response = { ...metadata, items: candidate, nextCursor };
      if (Buffer.byteLength(JSON.stringify(response), 'utf8') > maxBytes) {
        if (selected.length === 0) {
          throw new SyncApiException('SPACE_TOO_LARGE', 'One delta item exceeds maxResponseBytes', undefined, '2');
        }
        break;
      }
      selected.push(items[index]!);
    }
    const consumed = start + selected.length;
    const nextCursor = consumed < items.length ? this.encodeCursor({
      kind: 'delta-v2', spaceId, revision: to.revision, fromRevision: from.revision,
      lastPageId: String(consumed - 1),
    }) : null;
    return { ...metadata, items: selected, nextCursor };
  }

  private async loadRevision(spaceId: string, revisionRef: string): Promise<LoadedRevision> {
    if (revisionRef === '0') {
      return {
        revision: '0', sequence: 0, publishedAt: null,
        manifest: { protocolVersion: '2', spaceId, folders: [], pages: [] },
        revisionContentHash: EMPTY_HASH, revisionManifestByteLength: 0, revisionBodyBytes: 0,
      };
    }
    const revision = revisionRef === 'current'
      ? await this.prisma.spaceKnowledgeRevision.findFirst({
        where: { spaceId }, orderBy: { sequence: 'desc' }, select: REVISION_V2_SCALAR_SELECT,
      })
      : await this.prisma.spaceKnowledgeRevision.findUnique({
        where: { id: revisionRef }, select: REVISION_V2_SCALAR_SELECT,
      });
    if (!revision) {
      if (revisionRef === 'current') return this.loadRevision(spaceId, '0');
      throw new SyncApiException('REVISION_GONE', 'Revision is not available', undefined, '2');
    }
    if (revision.spaceId !== spaceId) {
      throw new SyncApiException('REVISION_GONE', 'Revision is not available', undefined, '2');
    }
    try {
      const [immutable, sidecarRow, deltaRows, ancestors] = await Promise.all([
        this.rebuildImmutableManifest(spaceId, revision.id),
        this.prisma.legacyRevisionSidecar.findUnique({ where: { revisionId: revision.id } }),
        this.prisma.syncRevisionTreeDeltaRow.findMany({
          where: { revisionId: revision.id }, orderBy: { ordinal: 'asc' },
        }),
        this.prisma.spaceKnowledgeRevision.findMany({
          where: { spaceId, sequence: { lt: revision.sequence } },
          orderBy: { sequence: 'desc' },
          select: REVISION_V2_SCALAR_SELECT,
        }),
      ]);
      const chainTrust = await validateRevisionChainTrust(
        this.prisma as unknown as Prisma.TransactionClient,
        spaceId,
        revision,
        ancestors,
      );
      const ancestorById = new Map(ancestors.map((ancestor) => [ancestor.id, ancestor]));
      const parentRevision = revision.parentRevisionId
        ? ancestorById.get(revision.parentRevisionId) ?? null
        : null;
      const { manifest, calculatedHash, manifestBytes, bodyBytes } = immutable;
      const parentEvidence = parentRevision ? await Promise.all([
        this.prisma.legacyRevisionSidecar.findUnique({ where: { revisionId: parentRevision.id } }),
        this.rebuildImmutableManifest(spaceId, parentRevision.id),
        this.prisma.syncRevisionTreeDeltaRow.findMany({
          where: { revisionId: parentRevision.id }, orderBy: { ordinal: 'asc' },
        }),
      ]) : null;
      const grandparentRevision = parentRevision?.parentRevisionId
        ? ancestorById.get(parentRevision.parentRevisionId) ?? null
        : null;
      const grandparentEvidence = grandparentRevision ? await Promise.all([
        this.prisma.legacyRevisionSidecar.findUnique({ where: { revisionId: grandparentRevision.id } }),
        this.rebuildImmutableManifest(spaceId, grandparentRevision.id),
        this.prisma.syncRevisionTreeDeltaRow.findMany({
          where: { revisionId: grandparentRevision.id }, orderBy: { ordinal: 'asc' },
        }),
      ]) : null;
      const grandparentShouldBeV2 = !!grandparentRevision && !!grandparentEvidence && revisionShouldBeV2({
        schemaVersion: grandparentRevision.schemaVersion,
        recipeVersion: grandparentRevision.recipeVersion,
        sidecar: grandparentEvidence[0]?.sidecar,
        folderRowCount: grandparentEvidence[1].folderRowCount,
        hasPlacedPage: grandparentEvidence[1].hasPlacedPage,
        treeDeltaRowCount: grandparentEvidence[2].length,
        migrationBatchId: grandparentRevision.migrationBatchId,
      });
      const parentShouldBeV2 = !!parentRevision && !!parentEvidence && revisionShouldBeV2({
        schemaVersion: parentRevision.schemaVersion,
        recipeVersion: parentRevision.recipeVersion,
        sidecar: parentEvidence[0]?.sidecar,
        folderRowCount: parentEvidence[1].folderRowCount,
        hasPlacedPage: parentEvidence[1].hasPlacedPage,
        treeDeltaRowCount: parentEvidence[2].length,
        migrationBatchId: parentRevision.migrationBatchId,
        parentShouldBeV2: grandparentShouldBeV2,
      });
      const shouldBeV2 = revisionShouldBeV2({
        schemaVersion: revision.schemaVersion,
        recipeVersion: revision.recipeVersion,
        sidecar: sidecarRow?.sidecar,
        folderRowCount: immutable.folderRowCount,
        hasPlacedPage: immutable.hasPlacedPage,
        treeDeltaRowCount: deltaRows.length,
        migrationBatchId: revision.migrationBatchId,
        parentShouldBeV2,
      });
      if (shouldBeV2) {
        this.assertV2Metadata(revision, immutable, sidecarRow, deltaRows);
        let parentManifest: TreeRevisionContentManifestV2 | null = null;
        if (parentRevision && parentEvidence && parentShouldBeV2) {
          this.assertV2Metadata(parentRevision, parentEvidence[1], parentEvidence[0], parentEvidence[2]);
          parentManifest = parentEvidence[1].manifest;
          let grandparentManifest: TreeRevisionContentManifestV2 | null = null;
          if (grandparentRevision && grandparentEvidence && grandparentShouldBeV2) {
            this.assertV2Metadata(
              grandparentRevision,
              grandparentEvidence[1],
              grandparentEvidence[0],
              grandparentEvidence[2],
            );
            grandparentManifest = grandparentEvidence[1].manifest;
          }
          if (chainTrust.checkpoint?.anchorRevisionId !== parentRevision.id) {
            this.assertTreeDeltaContract(
              parentEvidence[2],
              treeRevisionDeltaV2(grandparentManifest, parentManifest),
            );
          }
        }
        if (chainTrust.checkpoint?.anchorRevisionId !== revision.id) {
          this.assertTreeDeltaContract(deltaRows, treeRevisionDeltaV2(parentManifest, manifest));
        }
      }
      return {
        revision: revision.id,
        sequence: revision.sequence,
        publishedAt: revision.createdAt.toISOString(),
        manifest,
        revisionContentHash: calculatedHash,
        revisionManifestByteLength: manifestBytes,
        revisionBodyBytes: bodyBytes,
      };
    } catch {
      throw revisionGone();
    }
  }

  private async rebuildImmutableManifest(spaceId: string, revisionId: string) {
    const [folderRows, pageRows] = await Promise.all([
      this.prisma.syncRevisionFolderRow.findMany({ where: { revisionId } }),
      this.prisma.syncRevisionPageRow.findMany({ where: { revisionId }, include: { content: true } }),
    ]);
    for (const folder of folderRows) {
      const portable = validatePortableDirectoryPath(folder.path);
      if (portable.path !== folder.path || portable.key !== folder.pathKey) throw revisionGone();
    }
    for (const page of pageRows) {
      const portable = validatePortableMarkdownPath(page.path);
      const body = normalizeMarkdown(page.content.body);
      if (
        portable.path !== page.path
        || portable.key !== page.pathKey
        || body !== page.content.body
        || await contentHash(body) !== page.contentHash
        || Buffer.byteLength(body, 'utf8') !== page.content.byteLength
      ) throw revisionGone();
    }
    const manifest = canonicalTreeRevisionManifestV2({
      protocolVersion: '2',
      spaceId,
      folders: folderRows.map((folder) => ({
        folderId: folder.folderId, parentFolderId: folder.parentFolderId,
        name: folder.name, path: folder.path, sortOrder: folder.sortOrder,
        updatedAt: folder.updatedAt.toISOString(),
      })),
      pages: pageRows.map((page) => ({
        pageId: page.pageId, folderId: page.folderId, path: page.path,
        title: page.title, body: page.content.body, contentHash: page.contentHash,
        updatedAt: page.updatedAt.toISOString(),
      })),
    });
    const folderById = new Map(manifest.folders.map((folder) => [folder.folderId, folder]));
    for (const folder of manifest.folders) folderDepth(folder, folderById);
    if (manifest.pages.some((page) => page.folderId !== null && !folderById.has(page.folderId))) {
      throw revisionGone();
    }
    const empty = manifest.folders.length === 0 && manifest.pages.length === 0;
    return {
      manifest,
      calculatedHash: empty ? EMPTY_HASH : await treeRevisionContentHashV2(manifest),
      manifestBytes: empty ? 0 : canonicalBytes(manifest).byteLength,
      bodyBytes: manifest.pages.reduce((total, page) => total + Buffer.byteLength(page.body, 'utf8'), 0),
      folderRowCount: folderRows.length,
      hasPlacedPage: pageRows.some((page) => page.folderId !== null),
    };
  }

  private assertV2Metadata(
    revision: {
      schemaVersion: string; recipeVersion: string; revisionContentHash: string;
      pageCount: bigint; revisionManifestByteLength: bigint; revisionBodyBytes: bigint;
    },
    immutable: Awaited<ReturnType<SyncV2RevisionService['rebuildImmutableManifest']>>,
    sidecarRow: { sidecar: unknown } | null,
    deltaRows: Array<{
      ordinal: number; operation: string; folderId: string | null; pageId: string | null;
      previousPath: string | null; contentHash: string | null;
    }>,
  ): void {
    try {
      assertRevisionV2Metadata(revision, {
        ...immutable,
        sidecar: sidecarRow?.sidecar,
        deltaRows,
      });
    } catch {
      throw revisionGone();
    }
  }

  private assertTreeDeltaContract(rows: Array<{
    ordinal: number; operation: string; folderId: string | null; pageId: string | null;
    previousPath: string | null; contentHash: string | null;
  }>, expectedItems: TreeDeltaItemV2[]): void {
    try {
      assertStoredTreeDeltaV2(rows, expectedItems);
    } catch {
      throw revisionGone();
    }
  }

  private deltaItems(from: TreeRevisionContentManifestV2, to: TreeRevisionContentManifestV2): TreeDeltaItemV2[] {
    return treeRevisionDeltaV2(from, to);
  }

  private headEnvelope(spaceId: string, loaded: LoadedRevision) {
    return {
      protocolVersion: '2' as const,
      spaceId,
      revision: loaded.revision,
      sequence: loaded.sequence,
      revisionContentHash: loaded.revisionContentHash,
      folderCount: String(loaded.manifest.folders.length),
      pageCount: String(loaded.manifest.pages.length),
      revisionManifestByteLength: String(loaded.revisionManifestByteLength),
      revisionBodyBytes: String(loaded.revisionBodyBytes),
      publishedAt: loaded.publishedAt,
    };
  }

  private snapshotMetadata(spaceId: string, loaded: LoadedRevision) {
    const { publishedAt: _publishedAt, ...head } = this.headEnvelope(spaceId, loaded);
    return head;
  }

  private snapshotEnvelope(
    metadata: ReturnType<SyncV2RevisionService['snapshotMetadata']>,
    entries: Array<{ key: string; folder?: SyncFolderV2; page?: SyncPageV2 }>,
    nextCursor: string | null,
  ) {
    return {
      ...metadata,
      folders: entries.flatMap((entry) => entry.folder ? [entry.folder] : []),
      pages: entries.flatMap((entry) => entry.page ? [entry.page] : []),
      nextCursor,
    };
  }

  private resumeIndex(keys: string[], afterKey?: string): number {
    if (!afterKey) return 0;
    const index = keys.indexOf(afterKey);
    if (index < 0) this.invalidCursor();
    return index + 1;
  }

  private assertLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid limit', undefined, '2');
    }
  }

  private encodeCursor(payload: Record<string, unknown>): string {
    return (this.cursors.encode as any)(payload);
  }

  private decodeCursor(cursor: string): any {
    return this.cursors.decode(cursor) as any;
  }

  private invalidCursor(): never {
    throw new SyncApiException('CURSOR_INVALID', 'Cursor does not match this route', undefined, '2');
  }
}
