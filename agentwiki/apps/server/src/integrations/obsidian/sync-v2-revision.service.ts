import { Injectable } from '@nestjs/common';
import {
  canonicalBytes,
  canonicalTreeRevisionManifestV2,
  contentHash,
  normalizeMarkdown,
  pathKey,
  treeRevisionContentHashV2,
  type SyncFolderV2,
  type SyncPageV2,
  type TreeDeltaItemV2,
  type TreeRevisionContentManifestV2,
} from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../../database/prisma.service';
import { SyncApiException } from './sync-error';
import { SyncCursorService } from './sync-cursor.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';

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

function compareText(left: string, right: string): number {
  return Buffer.from(left, 'utf8').compare(Buffer.from(right, 'utf8'));
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

function sameFolder(left: SyncFolderV2 | undefined, right: SyncFolderV2): boolean {
  return !!left
    && left.parentFolderId === right.parentFolderId
    && left.name === right.name
    && left.path === right.path
    && left.sortOrder === right.sortOrder
    && left.updatedAt === right.updatedAt;
}

function samePage(left: SyncPageV2 | undefined, right: SyncPageV2): boolean {
  return !!left
    && left.folderId === right.folderId
    && left.path === right.path
    && left.title === right.title
    && left.contentHash === right.contentHash
    && left.updatedAt === right.updatedAt;
}

function revisionGone(): SyncApiException {
  return new SyncApiException('REVISION_GONE', 'Revision is not available', undefined, '2');
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
        where: { spaceId }, orderBy: { sequence: 'desc' },
      })
      : await this.prisma.spaceKnowledgeRevision.findUnique({ where: { id: revisionRef } });
    if (!revision) {
      if (revisionRef === 'current') return this.loadRevision(spaceId, '0');
      throw new SyncApiException('REVISION_GONE', 'Revision is not available', undefined, '2');
    }
    if (revision.spaceId !== spaceId) {
      throw new SyncApiException('REVISION_GONE', 'Revision is not available', undefined, '2');
    }
    try {
      const [folderRows, pageRows] = await Promise.all([
        this.prisma.syncRevisionFolderRow.findMany({ where: { revisionId: revision.id } }),
        this.prisma.syncRevisionPageRow.findMany({
          where: { revisionId: revision.id }, include: { content: true },
        }),
      ]);
      if (
        folderRows.some((folder) => folder.pathKey !== pathKey(folder.path))
        || pageRows.some((page) => page.pathKey !== pathKey(page.path))
      ) throw revisionGone();
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
      const folderIds = new Set(manifest.folders.map((folder) => folder.folderId));
      for (const folder of manifest.folders) folderDepth(folder, new Map(manifest.folders.map((item) => [item.folderId, item])));
      if (manifest.pages.some((page) => page.folderId !== null && !folderIds.has(page.folderId))) throw revisionGone();
      for (let index = 0; index < pageRows.length; index += 1) {
        const row = pageRows[index]!;
        const body = normalizeMarkdown(row.content.body);
        if (
          body !== row.content.body
          || await contentHash(body) !== row.contentHash
          || Buffer.byteLength(body, 'utf8') !== row.content.byteLength
        ) throw revisionGone();
      }
      const empty = manifest.folders.length === 0 && manifest.pages.length === 0;
      const calculatedHash = empty ? EMPTY_HASH : await treeRevisionContentHashV2(manifest);
      const manifestBytes = empty ? 0 : canonicalBytes(manifest).byteLength;
      const bodyBytes = manifest.pages.reduce(
        (total, page) => total + Buffer.byteLength(page.body, 'utf8'), 0,
      );
      if (revision.schemaVersion === 'content-tree@2') {
        if (
          revision.revisionContentHash !== calculatedHash
          || revision.pageCount !== BigInt(manifest.pages.length)
          || revision.revisionManifestByteLength !== BigInt(manifestBytes)
          || revision.revisionBodyBytes !== BigInt(bodyBytes)
        ) throw revisionGone();
        const [sidecarRow, deltaRows] = await Promise.all([
          this.prisma.legacyRevisionSidecar.findUnique({ where: { revisionId: revision.id } }),
          this.prisma.syncRevisionTreeDeltaRow.findMany({
            where: { revisionId: revision.id }, orderBy: { ordinal: 'asc' },
          }),
        ]);
        const sidecar = record(sidecarRow?.sidecar);
        const migration = record(sidecar?.spaceFolderMigration);
        const v2 = record(migration?.v2Revision);
        if (
          v2?.protocolVersion !== '2'
          || v2.manifestSchema !== 'TreeRevisionContentManifestV2'
          || v2.folderCount !== String(manifest.folders.length)
          || v2.pageCount !== String(manifest.pages.length)
          || v2.revisionContentHash !== calculatedHash
          || v2.revisionManifestByteLength !== String(manifestBytes)
          || v2.revisionBodyBytes !== String(bodyBytes)
          || v2.treeDeltaCount !== String(deltaRows.length)
        ) throw revisionGone();
        this.assertTreeDeltaContract(deltaRows, manifest);
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

  private assertTreeDeltaContract(rows: Array<{
    ordinal: number; operation: string; folderId: string | null; pageId: string | null;
    previousPath: string | null; contentHash: string | null;
  }>, manifest: TreeRevisionContentManifestV2): void {
    const folderById = new Map(manifest.folders.map((folder) => [folder.folderId, folder]));
    const pageById = new Map(manifest.pages.map((page) => [page.pageId, page]));
    const rank = new Map([
      ['archive_page', 0], ['archive_folder', 1], ['upsert_folder', 2], ['upsert_page', 3],
    ]);
    let previousRank = -1;
    const folderOrdinal = new Map<string, number>();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const currentRank = rank.get(row.operation);
      if (row.ordinal !== index || currentRank === undefined || currentRank < previousRank) throw revisionGone();
      previousRank = currentRank;
      if (row.operation === 'archive_page') {
        if (!row.pageId || row.folderId || !row.previousPath || row.contentHash || pageById.has(row.pageId)) throw revisionGone();
      } else if (row.operation === 'archive_folder') {
        if (!row.folderId || row.pageId || !row.previousPath || row.contentHash || folderById.has(row.folderId)) throw revisionGone();
      } else if (row.operation === 'upsert_folder') {
        if (!row.folderId || row.pageId || row.previousPath || row.contentHash || !folderById.has(row.folderId)) throw revisionGone();
        folderOrdinal.set(row.folderId, row.ordinal);
      } else {
        const page = row.pageId ? pageById.get(row.pageId) : undefined;
        if (!page || row.folderId || row.previousPath || row.contentHash !== page.contentHash) throw revisionGone();
      }
    }
    for (const [folderId, ordinal] of folderOrdinal) {
      const parentId = folderById.get(folderId)?.parentFolderId;
      const parentOrdinal = parentId ? folderOrdinal.get(parentId) : undefined;
      if (parentOrdinal !== undefined && parentOrdinal >= ordinal) throw revisionGone();
    }
  }

  private deltaItems(from: TreeRevisionContentManifestV2, to: TreeRevisionContentManifestV2): TreeDeltaItemV2[] {
    const fromFolders = new Map(from.folders.map((folder) => [folder.folderId, folder]));
    const toFolders = new Map(to.folders.map((folder) => [folder.folderId, folder]));
    const fromPages = new Map(from.pages.map((page) => [page.pageId, page]));
    const toPages = new Map(to.pages.map((page) => [page.pageId, page]));
    const archivedPages = from.pages
      .filter((page) => !toPages.has(page.pageId))
      .sort((left, right) => compareText(pathKey(left.path), pathKey(right.path)) || compareText(left.pageId, right.pageId))
      .map((page) => ({ operation: 'archive_page' as const, pageId: page.pageId, previousPath: page.path }));
    const archivedFolders = from.folders
      .filter((folder) => !toFolders.has(folder.folderId))
      .sort((left, right) => folderDepth(right, fromFolders) - folderDepth(left, fromFolders)
        || compareText(pathKey(left.path), pathKey(right.path))
        || compareText(left.folderId, right.folderId))
      .map((folder) => ({ operation: 'archive_folder' as const, folderId: folder.folderId, previousPath: folder.path }));
    const upsertFolders = to.folders
      .filter((folder) => !sameFolder(fromFolders.get(folder.folderId), folder))
      .map((folder) => ({ operation: 'upsert_folder' as const, folder }));
    const upsertPages = to.pages
      .filter((page) => !samePage(fromPages.get(page.pageId), page))
      .map((page) => ({ operation: 'upsert_page' as const, page }));
    return [...archivedPages, ...archivedFolders, ...upsertFolders, ...upsertPages];
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
