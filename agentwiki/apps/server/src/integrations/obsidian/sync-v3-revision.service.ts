import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  canonicalBytes,
  canonicalTreeRevisionManifestV3,
  pathKey,
  TREE_SYNC_V2_LIMITS,
  TreeDeltaPageV3Schema,
  TreeRevisionHeadResponseV3Schema,
  TreeSnapshotPageV3Schema,
  TreeSyncSpaceListResponseV3Schema,
  treeRevisionContentHashV3,
  treeRevisionDeltaV3,
  type SyncAttachmentV3,
  type SyncFolderV3,
  type SyncPageV3,
  type TreeDeltaItemV3,
  type TreeRevisionContentManifestV3,
} from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../../database/prisma.service';
import { SyncV3RevisionWriterService } from '../../core/sync/sync-v3-revision-writer.service';
import {
  isSupportedLegacySyncRevisionFormat,
  isSyncV3RevisionFormat,
  SYNC_V3_RECIPE_VERSION,
  SYNC_V3_SCHEMA_VERSION,
} from '../../core/sync/sync-revision-format';
import type { HumanDevicePrincipal } from './human-device.guard';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { SyncCursorService } from './sync-cursor.service';
import { SyncApiException } from './sync-error';
import {
  SyncV3AuthorityError,
  SyncV3ImmutableRevisionService,
  type VerifiedSyncV3Revision,
} from './sync-v3-immutable-revision.service';

const encoder = new TextEncoder();

type LoadedRevisionV3 = VerifiedSyncV3Revision;

interface SpaceRevisionSummaryRow {
  id: string;
  spaceId: string;
  sequence: number;
  parentRevisionId: string | null;
  schemaVersion: string;
  recipeVersion: string;
  contentHash: string;
  delta: Prisma.JsonValue | null;
  revisionContentHash: string;
  pageCount: bigint;
  revisionBodyBytes: bigint;
  revisionManifestByteLength: bigint;
  attachmentCount: bigint;
  revisionAttachmentBytes: bigint;
  createdAt: Date;
}

type SnapshotEntry =
  | { objectKind: 'folder'; canonicalKey: string; folder: SyncFolderV3 }
  | { objectKind: 'page'; canonicalKey: string; page: SyncPageV3 }
  | { objectKind: 'attachment'; canonicalKey: string; attachment: SyncAttachmentV3 };

function revisionGone(): SyncApiException {
  return new SyncApiException('REVISION_GONE', 'Revision is not available', undefined, '3');
}

function readUnavailable(): SyncApiException {
  return new SyncApiException('INTERNAL_ERROR', 'Revision read temporarily unavailable', undefined, '3');
}

@Injectable()
export class SyncV3RevisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cursors: SyncCursorService,
    private readonly capabilities: SyncCapabilitiesService,
    private readonly writer: SyncV3RevisionWriterService,
    private readonly immutable: SyncV3ImmutableRevisionService,
  ) {}

  async listSpaces(principal: HumanDevicePrincipal) {
    return this.consistentRead(async (tx) => {
      const currentPrincipal = await this.assertLivePrincipal(tx, principal);
      const accessible = currentPrincipal.platformRole === 'super_admin'
        ? await tx.space.findMany({
          where: { deletedAt: null }, select: { id: true, name: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        }).then((spaces) => spaces.map((space) => ({ ...space, role: 'owner' as const })))
        : await tx.spaceMember.findMany({
          where: { userId: principal.userId, space: { deletedAt: null } },
          select: { role: true, createdAt: true, space: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        }).then((memberships) => memberships.map((membership) => ({
          id: membership.space.id,
          name: membership.space.name,
          createdAt: membership.createdAt,
          role: membership.role as 'viewer' | 'editor' | 'admin' | 'owner',
        })));
      const spaceIds = accessible.map((space) => space.id);
      if (spaceIds.length === 0) {
        return TreeSyncSpaceListResponseV3Schema.parse({ protocolVersion: '3', spaces: [] });
      }
      const [latestRevisions, v3Histories] = await Promise.all([
        tx.$queryRaw<SpaceRevisionSummaryRow[]>(Prisma.sql`
          SELECT DISTINCT ON ("spaceId")
            "id", "spaceId", "sequence", "parentRevisionId", "schemaVersion", "recipeVersion",
            "contentHash", "delta", "revisionContentHash", "pageCount", "revisionBodyBytes",
            "revisionManifestByteLength", "attachmentCount", "revisionAttachmentBytes", "createdAt"
          FROM "SpaceKnowledgeRevision"
          WHERE "spaceId" IN (${Prisma.join(spaceIds)})
          ORDER BY "spaceId" ASC, "sequence" DESC, "id" DESC
        `),
        tx.$queryRaw<Array<{ spaceId: string }>>(Prisma.sql`
          SELECT "spaceId"
          FROM "SpaceKnowledgeRevision"
          WHERE "spaceId" IN (${Prisma.join(spaceIds)})
            AND "schemaVersion" = ${SYNC_V3_SCHEMA_VERSION}
            AND "recipeVersion" = ${SYNC_V3_RECIPE_VERSION}
          GROUP BY "spaceId"
          ORDER BY "spaceId" ASC
        `),
      ]);
      const latestBySpace = new Map(latestRevisions.map((revision) => [revision.spaceId, revision]));
      const nativeSpaces = new Set(v3Histories.map((revision) => revision.spaceId));
      const headIds = [...latestBySpace.values()].map((revision) => revision.id);
      const emptySpaceIds = spaceIds.filter((spaceId) => !latestBySpace.has(spaceId));
      const [folderRows, pageRows, liveFolders, livePages] = await Promise.all([
        headIds.length === 0 ? [] : tx.syncRevisionFolderRow.findMany({ where: { revisionId: { in: headIds } } }),
        headIds.length === 0 ? [] : tx.syncRevisionPageRow.findMany({
          where: { revisionId: { in: headIds } }, include: { content: true },
        }),
        emptySpaceIds.length === 0 ? [] : tx.folder.findMany({
          where: { spaceId: { in: emptySpaceIds }, deletedAt: null },
        }),
        emptySpaceIds.length === 0 ? [] : tx.page.findMany({
          where: { spaceId: { in: emptySpaceIds }, deletedAt: null },
        }),
      ]);
      const foldersByRevision = this.groupBy(folderRows, (row: any) => row.revisionId);
      const pagesByRevision = this.groupBy(pageRows, (row: any) => row.revisionId);
      const liveFoldersBySpace = this.groupBy(liveFolders, (row: any) => row.spaceId);
      const livePagesBySpace = this.groupBy(livePages, (row: any) => row.spaceId);
      const nativeTargets = accessible.flatMap((space) => {
        const latest = latestBySpace.get(space.id);
        return nativeSpaces.has(space.id) && latest ? [{ spaceId: space.id, revision: latest }] : [];
      });
      const verifiedNative = await this.immutable.verifyMany(tx, nativeTargets);
      const legacyInputs = accessible.flatMap((space) => {
        if (nativeSpaces.has(space.id)) return [];
        const latest = latestBySpace.get(space.id);
        const revisionFolders = latest ? foldersByRevision.get(latest.id) ?? [] : liveFoldersBySpace.get(space.id) ?? [];
        const revisionPages = latest ? pagesByRevision.get(latest.id) ?? [] : livePagesBySpace.get(space.id) ?? [];
        return [{
          spaceId: space.id,
          baseRevision: latest?.id ?? '0',
          nativeV3: false,
          source: {
            folders: revisionFolders.map((folder: any) => ({
              folderId: folder.folderId ?? folder.id,
              parentFolderId: folder.parentFolderId ?? folder.parentId,
              name: folder.name,
              path: folder.path,
              sortOrder: folder.sortOrder,
              updatedAt: folder.updatedAt,
            })),
            pages: revisionPages.map((page: any) => ({
              pageId: page.pageId ?? page.knowledgeKey,
              folderId: page.folderId,
              path: page.path ?? page.syncPath,
              title: page.title,
              body: page.content?.body ?? page.content,
              updatedAt: page.updatedAt,
            })),
          },
        }];
      });
      const legacyInspections = await this.writer.inspectCandidates(tx as any, legacyInputs);

      const spaces = [];
      for (const space of accessible) {
        const latest = latestBySpace.get(space.id);
        if (nativeSpaces.has(space.id)) {
          if (!latest || !isSyncV3RevisionFormat(latest)) {
            throw revisionGone();
          }
          const verified = verifiedNative.get(space.id);
          if (!verified) throw revisionGone();
          spaces.push({
            spaceId: space.id,
            displayName: space.name,
            role: space.role,
            canRead: true,
            canPublish: ['owner', 'admin', 'editor'].includes(space.role),
            syncMode: 'native_v3' as const,
            currentRevision: latest.id,
            folderCount: String(verified.manifest.folders.length),
            pageCount: String(verified.manifest.pages.length),
            attachmentCount: String(verified.manifest.attachments.length),
            revisionManifestByteLength: String(verified.revisionManifestByteLength),
            revisionBodyBytes: String(verified.revisionBodyBytes),
            revisionAttachmentBytes: String(verified.revisionAttachmentBytes),
          });
          continue;
        }
        if (latest && !isSupportedLegacySyncRevisionFormat(latest)) {
          throw new SyncApiException(
            'SYNC_PROTOCOL_UPGRADE_REQUIRED',
            'Latest revision uses an unsupported Sync protocol',
            undefined,
            '3',
          );
        }
        const inspection = legacyInspections.get(space.id);
        if (!inspection) throw revisionGone();
        const manifest = canonicalTreeRevisionManifestV3({
          protocolVersion: '3', spaceId: space.id, ...inspection.candidate,
        });
        spaces.push({
          spaceId: space.id,
          displayName: space.name,
          role: space.role,
          canRead: true,
          canPublish: ['owner', 'admin', 'editor'].includes(space.role),
          syncMode: inspection.mode,
          currentRevision: inspection.baseRevision,
          folderCount: String(manifest.folders.length),
          pageCount: String(manifest.pages.length),
          attachmentCount: String(manifest.attachments.length),
          revisionManifestByteLength: String(canonicalBytes(manifest).byteLength),
          revisionBodyBytes: String(manifest.pages.reduce(
            (total, page) => total + encoder.encode(page.body).byteLength, 0,
          )),
          revisionAttachmentBytes: manifest.attachments.reduce(
            (total, attachment) => total + BigInt(attachment.sizeBytes), 0n,
          ).toString(),
        });
      }
      return TreeSyncSpaceListResponseV3Schema.parse({ protocolVersion: '3', spaces });
    });
  }

  async assertReadable(principal: HumanDevicePrincipal, spaceId: string): Promise<void> {
    await this.consistentRead(async (tx) => { await this.assertReadableTx(tx, principal, spaceId); });
  }

  async head(principal: HumanDevicePrincipal, spaceId: string) {
    return this.consistentRead(async (tx) => {
      await this.assertReadableTx(tx, principal, spaceId);
      return this.headEnvelope(spaceId, await this.loadRevision(tx, spaceId, 'current'));
    });
  }

  async snapshot(
    principal: HumanDevicePrincipal,
    spaceId: string,
    revisionRef = 'current',
    cursor?: string,
    limit = 100,
  ) {
    this.assertLimit(limit);
    return this.consistentRead(async (tx) => {
      await this.assertReadableTx(tx, principal, spaceId);
      let revision = revisionRef;
      let afterKey: string | undefined;
      let afterKind: SnapshotEntry['objectKind'] | undefined;
      if (cursor) {
        const payload = this.cursors.decodeV3(cursor);
        if (
          payload.kind !== 'snapshot-v3'
          || payload.spaceId !== spaceId
          || (revisionRef !== 'current' && revisionRef !== payload.revision)
        ) this.invalidCursor();
        revision = payload.revision;
        afterKey = payload.lastCanonicalKey;
        afterKind = payload.objectKind;
      }
      const loaded = await this.loadRevision(tx, spaceId, revision);
      const entries = this.snapshotEntries(loaded.manifest);
      const start = this.resumeSnapshot(entries, afterKey, afterKind);
      const metadata = this.snapshotMetadata(spaceId, loaded);
      const selected: SnapshotEntry[] = [];
      const maxBytes = this.maxResponseBytes();
      for (let index = start; index < entries.length && selected.length < limit; index += 1) {
        const candidate = [...selected, entries[index]!];
        const nextCursor = index + 1 < entries.length
          ? this.snapshotCursor(spaceId, loaded.revision, candidate[candidate.length - 1]!)
          : null;
        const response = this.snapshotEnvelope(metadata, candidate, nextCursor);
        if (Buffer.byteLength(JSON.stringify(response), 'utf8') > maxBytes) {
          if (selected.length === 0) this.itemTooLarge('snapshot');
          break;
        }
        selected.push(entries[index]!);
      }
      const consumed = start + selected.length;
      const nextCursor = consumed < entries.length
        ? this.snapshotCursor(spaceId, loaded.revision, selected[selected.length - 1]!)
        : null;
      const response = TreeSnapshotPageV3Schema.parse(
        this.snapshotEnvelope(metadata, selected, nextCursor),
      );
      this.assertResponseSize(response, 'snapshot');
      return response;
    });
  }

  async delta(
    principal: HumanDevicePrincipal,
    spaceId: string,
    fromRevision: string,
    cursor?: string,
    limit = 100,
  ) {
    this.assertLimit(limit);
    return this.consistentRead(async (tx) => {
      await this.assertReadableTx(tx, principal, spaceId);
      let toRef = 'current';
      let afterKey: string | undefined;
      let afterKind: string | undefined;
      if (cursor) {
        const payload = this.cursors.decodeV3(cursor);
        if (
          payload.kind !== 'delta-v3'
          || payload.spaceId !== spaceId
          || payload.fromRevision !== fromRevision
        ) this.invalidCursor();
        toRef = payload.toRevision;
        afterKey = payload.lastCanonicalKey;
        afterKind = payload.objectKind;
      }
      const [from, to] = await Promise.all([
        this.loadDeltaBase(tx, spaceId, fromRevision),
        this.loadRevision(tx, spaceId, toRef),
      ]);
      const items = treeRevisionDeltaV3(from.manifest, to.manifest);
      if (items.length > this.capabilities.capabilitiesV3().maxDeltaItems) {
        throw new SyncApiException('SPACE_TOO_LARGE', 'Delta exceeds maxDeltaItems', undefined, '3');
      }
      const keyed = items.map((item) => ({
        item,
        objectKind: item.operation,
        canonicalKey: this.deltaKey(item),
      }));
      const start = this.resumeDelta(keyed, afterKey, afterKind);
      const metadata = this.deltaMetadata(spaceId, from.revision, to);
      const selected: typeof keyed = [];
      const maxBytes = this.maxResponseBytes();
      for (let index = start; index < keyed.length && selected.length < limit; index += 1) {
        const candidate = [...selected, keyed[index]!];
        const nextCursor = index + 1 < keyed.length
          ? this.deltaCursor(spaceId, from.revision, to.revision, candidate[candidate.length - 1]!)
          : null;
        const response = { ...metadata, items: candidate.map((entry) => entry.item), nextCursor };
        if (Buffer.byteLength(JSON.stringify(response), 'utf8') > maxBytes) {
          if (selected.length === 0) this.itemTooLarge('delta');
          break;
        }
        selected.push(keyed[index]!);
      }
      const consumed = start + selected.length;
      const nextCursor = consumed < keyed.length
        ? this.deltaCursor(spaceId, from.revision, to.revision, selected[selected.length - 1]!)
        : null;
      const response = TreeDeltaPageV3Schema.parse({
        ...metadata, items: selected.map((entry) => entry.item), nextCursor,
      });
      this.assertResponseSize(response, 'delta');
      return response;
    });
  }

  private async consistentRead<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 10_000,
        timeout: 30_000,
      });
    } catch (error) {
      if (error instanceof SyncApiException) throw error;
      if (error instanceof SyncV3AuthorityError) throw revisionGone();
      throw readUnavailable();
    }
  }

  private async assertLivePrincipal(tx: Prisma.TransactionClient, principal: HumanDevicePrincipal) {
    const credential = await tx.humanDeviceCredential.findUnique({
      where: { id: principal.credentialId },
      include: { user: { select: { deletedAt: true, lockedAt: true, type: true, platformRole: true } } },
    });
    const now = new Date();
    if (
      !credential
      || credential.userId !== principal.userId
      || !['active', 'provisional'].includes(credential.status)
      || (credential.status === 'provisional'
        && (!credential.provisionalExpiresAt || credential.provisionalExpiresAt <= now))
      || credential.user.deletedAt
      || credential.user.lockedAt
      || credential.user.type !== 'human'
    ) {
      throw new SyncApiException('DEVICE_CREDENTIAL_REVOKED', 'Device credential is unavailable', undefined, '3');
    }
    return { platformRole: credential.user.platformRole as 'user' | 'super_admin' };
  }

  private async assertReadableTx(
    tx: Prisma.TransactionClient,
    principal: HumanDevicePrincipal,
    spaceId: string,
  ): Promise<void> {
    const current = await this.assertLivePrincipal(tx, principal);
    const space = await tx.space.findUnique({ where: { id: spaceId }, select: { deletedAt: true } });
    if (!space || space.deletedAt) {
      throw new SyncApiException('SPACE_FORBIDDEN', 'Space is not accessible', undefined, '3');
    }
    if (current.platformRole === 'super_admin') return;
    const member = await tx.spaceMember.findUnique({
      where: { userId_spaceId: { userId: principal.userId, spaceId } }, select: { role: true },
    });
    if (!member) throw new SyncApiException('SPACE_FORBIDDEN', 'Space is not accessible', undefined, '3');
  }

  private async loadDeltaBase(
    tx: Prisma.TransactionClient,
    spaceId: string,
    revision: string,
  ): Promise<LoadedRevisionV3> {
    if (revision !== '0') return this.loadRevision(tx, spaceId, revision);
    return {
      revision: '0', sequence: 0, publishedAt: null,
      manifest: { protocolVersion: '3', spaceId, folders: [], pages: [], attachments: [] },
      revisionContentHash: await treeRevisionContentHashV3({
        protocolVersion: '3', spaceId, folders: [], pages: [], attachments: [],
      }),
      revisionManifestByteLength: 0,
      revisionBodyBytes: 0,
      revisionAttachmentBytes: 0,
    };
  }

  private async loadRevision(
    tx: Prisma.TransactionClient,
    spaceId: string,
    revisionRef: string,
  ): Promise<LoadedRevisionV3> {
    const revision = revisionRef === 'current'
      ? await tx.spaceKnowledgeRevision.findFirst({ where: { spaceId }, orderBy: { sequence: 'desc' } })
      : await tx.spaceKnowledgeRevision.findUnique({ where: { id: revisionRef } });
    if (!revision) throw revisionGone();
    if (revision.spaceId !== spaceId) throw revisionGone();
    if (!isSyncV3RevisionFormat(revision)) {
      throw new SyncApiException(
        'SYNC_PROTOCOL_UPGRADE_REQUIRED',
        'Revision is not a supported Sync v3 revision',
        undefined,
        '3',
      );
    }
    return this.immutable.verify(tx, spaceId, revision);
  }

  private headEnvelope(spaceId: string, loaded: LoadedRevisionV3) {
    return TreeRevisionHeadResponseV3Schema.parse({
      protocolVersion: '3', spaceId, revision: loaded.revision, sequence: loaded.sequence,
      revisionContentHash: loaded.revisionContentHash,
      folderCount: String(loaded.manifest.folders.length),
      pageCount: String(loaded.manifest.pages.length),
      attachmentCount: String(loaded.manifest.attachments.length),
      revisionManifestByteLength: String(loaded.revisionManifestByteLength),
      revisionBodyBytes: String(loaded.revisionBodyBytes),
      revisionAttachmentBytes: String(loaded.revisionAttachmentBytes),
      publishedAt: loaded.publishedAt,
    });
  }

  private snapshotMetadata(spaceId: string, loaded: LoadedRevisionV3) {
    const { publishedAt: _publishedAt, ...head } = this.headEnvelope(spaceId, loaded);
    return head;
  }

  private snapshotEntries(manifest: TreeRevisionContentManifestV3): SnapshotEntry[] {
    return [
      ...manifest.folders.map((folder): SnapshotEntry => ({
        objectKind: 'folder', canonicalKey: `${pathKey(folder.path)}\0${folder.folderId}`, folder,
      })),
      ...manifest.pages.map((page): SnapshotEntry => ({
        objectKind: 'page', canonicalKey: `${pathKey(page.path)}\0${page.pageId}`, page,
      })),
      ...manifest.attachments.map((attachment): SnapshotEntry => ({
        objectKind: 'attachment', canonicalKey: `${pathKey(attachment.path)}\0${attachment.attachmentId}`, attachment,
      })),
    ];
  }

  private snapshotEnvelope(
    metadata: ReturnType<SyncV3RevisionService['snapshotMetadata']>,
    entries: SnapshotEntry[],
    nextCursor: string | null,
  ) {
    return {
      ...metadata,
      folders: entries.flatMap((entry) => entry.objectKind === 'folder' ? [entry.folder] : []),
      pages: entries.flatMap((entry) => entry.objectKind === 'page' ? [entry.page] : []),
      attachments: entries.flatMap((entry) => entry.objectKind === 'attachment' ? [entry.attachment] : []),
      nextCursor,
    };
  }

  private snapshotCursor(spaceId: string, revision: string, entry: SnapshotEntry): string {
    return this.cursors.encodeV3({
      protocolVersion: '3', kind: 'snapshot-v3', spaceId, revision,
      objectKind: entry.objectKind, lastCanonicalKey: entry.canonicalKey,
    });
  }

  private deltaCursor(
    spaceId: string,
    fromRevision: string,
    toRevision: string,
    entry: { objectKind: string; canonicalKey: string },
  ): string {
    return this.cursors.encodeV3({
      protocolVersion: '3', kind: 'delta-v3', spaceId, fromRevision, toRevision,
      objectKind: entry.objectKind, lastCanonicalKey: entry.canonicalKey,
    });
  }

  private resumeSnapshot(
    entries: SnapshotEntry[],
    afterKey?: string,
    afterKind?: SnapshotEntry['objectKind'],
  ): number {
    if (!afterKey || !afterKind) return 0;
    const index = entries.findIndex((entry) => entry.objectKind === afterKind && entry.canonicalKey === afterKey);
    if (index < 0) this.invalidCursor();
    return index + 1;
  }

  private resumeDelta(
    entries: Array<{ objectKind: string; canonicalKey: string }>,
    afterKey?: string,
    afterKind?: string,
  ): number {
    if (!afterKey || !afterKind) return 0;
    const index = entries.findIndex((entry) => entry.objectKind === afterKind && entry.canonicalKey === afterKey);
    if (index < 0) this.invalidCursor();
    return index + 1;
  }

  private deltaMetadata(spaceId: string, fromRevision: string, to: LoadedRevisionV3) {
    return {
      protocolVersion: '3' as const,
      spaceId,
      fromRevision,
      toRevision: to.revision,
      toSequence: to.sequence,
      toRevisionContentHash: to.revisionContentHash,
      toFolderCount: String(to.manifest.folders.length),
      toPageCount: String(to.manifest.pages.length),
      toAttachmentCount: String(to.manifest.attachments.length),
      toRevisionManifestByteLength: String(to.revisionManifestByteLength),
      toRevisionBodyBytes: String(to.revisionBodyBytes),
      toRevisionAttachmentBytes: String(to.revisionAttachmentBytes),
    };
  }

  private deltaKey(item: TreeDeltaItemV3): string {
    if (item.operation === 'upsert_folder') return `${pathKey(item.folder.path)}\0${item.folder.folderId}`;
    if (item.operation === 'archive_folder') return `${pathKey(item.previousPath)}\0${item.folderId}`;
    if (item.operation === 'upsert_page') return `${pathKey(item.page.path)}\0${item.page.pageId}`;
    if (item.operation === 'archive_page') return `${pathKey(item.previousPath)}\0${item.pageId}`;
    if (item.operation === 'upsert_attachment') return `${pathKey(item.attachment.path)}\0${item.attachment.attachmentId}`;
    return `${pathKey(item.previousPath)}\0${item.attachmentId}`;
  }

  private maxResponseBytes(): number {
    return Math.min(
      this.capabilities.capabilitiesV3().maxResponseBytes,
      TREE_SYNC_V2_LIMITS.maxResponseBytes,
    );
  }

  private assertLimit(limit: number): void {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new SyncApiException('PAYLOAD_INVALID', 'Invalid limit', undefined, '3');
    }
  }

  private invalidCursor(): never {
    throw new SyncApiException('CURSOR_INVALID', 'Cursor does not match this route', undefined, '3');
  }

  private itemTooLarge(kind: 'snapshot' | 'delta'): never {
    throw new SyncApiException('SPACE_TOO_LARGE', `One ${kind} item exceeds maxResponseBytes`, undefined, '3');
  }

  private assertResponseSize(response: unknown, kind: 'snapshot' | 'delta'): void {
    if (Buffer.byteLength(JSON.stringify(response), 'utf8') > this.maxResponseBytes()) {
      throw new SyncApiException(
        'SPACE_TOO_LARGE',
        `${kind} response metadata exceeds maxResponseBytes`,
        undefined,
        '3',
      );
    }
  }

  private groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) ?? []), row]);
    return grouped;
  }
}
