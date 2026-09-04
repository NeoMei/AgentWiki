import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  canonicalBytes,
  canonicalTreeDeltaItemsV3,
  canonicalTreeRevisionManifestV3,
  contentHash,
  normalizeMarkdown,
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
import type { HumanDevicePrincipal } from './human-device.guard';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { SyncCursorService } from './sync-cursor.service';
import { SyncApiException } from './sync-error';

const V3_SCHEMA_VERSION = 'content-tree@3';
const V3_RECIPE_VERSION = 'referenced-images-v1';
const encoder = new TextEncoder();

class RevisionV3IntegrityError extends Error {}

interface LoadedRevisionV3 {
  revision: string;
  sequence: number;
  publishedAt: string | null;
  manifest: TreeRevisionContentManifestV3;
  revisionContentHash: string;
  revisionManifestByteLength: number;
  revisionBodyBytes: number;
  revisionAttachmentBytes: number;
}

type SnapshotEntry =
  | { objectKind: 'folder'; canonicalKey: string; folder: SyncFolderV3 }
  | { objectKind: 'page'; canonicalKey: string; page: SyncPageV3 }
  | { objectKind: 'attachment'; canonicalKey: string; attachment: SyncAttachmentV3 };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

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
      const revisions = await tx.spaceKnowledgeRevision.findMany({
        where: { spaceId: { in: spaceIds } },
        orderBy: [{ spaceId: 'asc' }, { sequence: 'desc' }],
      });
      const latestBySpace = new Map<string, any>();
      const nativeSpaces = new Set<string>();
      for (const revision of revisions) {
        if (!latestBySpace.has(revision.spaceId)) latestBySpace.set(revision.spaceId, revision);
        if (revision.schemaVersion === V3_SCHEMA_VERSION && revision.recipeVersion === V3_RECIPE_VERSION) {
          nativeSpaces.add(revision.spaceId);
        }
      }
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

      const spaces = [];
      for (const space of accessible) {
        const latest = latestBySpace.get(space.id);
        if (nativeSpaces.has(space.id)) {
          if (!latest || latest.schemaVersion !== V3_SCHEMA_VERSION || latest.recipeVersion !== V3_RECIPE_VERSION) {
            throw revisionGone();
          }
          const folderCount = (foldersByRevision.get(latest.id) ?? []).length;
          if (latest.pageCount < 0n || latest.attachmentCount < 0n) throw revisionGone();
          spaces.push({
            spaceId: space.id,
            displayName: space.name,
            role: space.role,
            canRead: true,
            canPublish: space.role === 'owner' || space.role === 'editor',
            syncMode: 'native_v3' as const,
            currentRevision: latest.id,
            folderCount: String(folderCount),
            pageCount: latest.pageCount.toString(),
            attachmentCount: latest.attachmentCount.toString(),
            revisionManifestByteLength: latest.revisionManifestByteLength.toString(),
            revisionBodyBytes: latest.revisionBodyBytes.toString(),
            revisionAttachmentBytes: latest.revisionAttachmentBytes.toString(),
          });
          continue;
        }
        if (latest && !this.isSupportedLegacy(latest)) {
          throw new SyncApiException(
            'SYNC_PROTOCOL_UPGRADE_REQUIRED',
            'Latest revision uses an unsupported Sync protocol',
            undefined,
            '3',
          );
        }
        const revisionFolders = latest ? foldersByRevision.get(latest.id) ?? [] : liveFoldersBySpace.get(space.id) ?? [];
        const revisionPages = latest ? pagesByRevision.get(latest.id) ?? [] : livePagesBySpace.get(space.id) ?? [];
        const inspection = await this.writer.inspectCandidate(
          tx as any,
          space.id,
          latest?.id ?? '0',
          false,
          {
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
        );
        const manifest = canonicalTreeRevisionManifestV3({
          protocolVersion: '3', spaceId: space.id, ...inspection.candidate,
        });
        spaces.push({
          spaceId: space.id,
          displayName: space.name,
          role: space.role,
          canRead: true,
          canPublish: space.role === 'owner' || space.role === 'editor',
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

  async assertLegacyPushAllowed(
    tx: Prisma.TransactionClient,
    spaceId: string,
    protocolVersion: '1' | '2',
  ): Promise<void> {
    const inspection = await this.writer.inspectCurrentLocked(tx as any, spaceId);
    if (inspection.mode !== 'legacy_v2') {
      throw new SyncApiException(
        'SYNC_PROTOCOL_UPGRADE_REQUIRED',
        'This Space requires Sync v3',
        undefined,
        protocolVersion,
      );
    }
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
      if (error instanceof RevisionV3IntegrityError) throw revisionGone();
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
    if (revision.schemaVersion !== V3_SCHEMA_VERSION || revision.recipeVersion !== V3_RECIPE_VERSION) {
      throw new SyncApiException(
        'SYNC_PROTOCOL_UPGRADE_REQUIRED',
        'Revision is not a supported Sync v3 revision',
        undefined,
        '3',
      );
    }
    const [folderRows, pageRows, attachmentRows, sidecarRow] = await Promise.all([
      tx.syncRevisionFolderRow.findMany({ where: { revisionId: revision.id } }),
      tx.syncRevisionPageRow.findMany({ where: { revisionId: revision.id }, include: { content: true } }),
      tx.syncRevisionAttachmentRow.findMany({
        where: { revisionId: revision.id },
        include: {
          attachment: { select: { id: true, spaceId: true } },
          attachmentVersion: { include: { attachment: { select: { id: true, spaceId: true } } } },
        },
      }),
      tx.legacyRevisionSidecar.findUnique({ where: { revisionId: revision.id }, select: { sidecar: true } }),
    ]);
    const sidecarRoot = record(sidecarRow?.sidecar);
    const sidecar = record(sidecarRoot?.syncV3Revision);
    if (!sidecar || !exactKeys(sidecar, [
      'protocolVersion', 'manifestSchema', 'revisionContentHash', 'folderCount', 'pageCount',
      'attachmentCount', 'revisionManifestByteLength', 'revisionBodyBytes',
      'revisionAttachmentBytes', 'treeDeltaCount', 'pageAttachmentIds', 'attachmentUpdatedAt',
    ])) throw new RevisionV3IntegrityError();
    if (sidecar.protocolVersion !== '3' || sidecar.manifestSchema !== 'TreeRevisionContentManifestV3') {
      throw new RevisionV3IntegrityError();
    }
    const refs = this.sidecarMap(sidecar.pageAttachmentIds, 'pageId', 'referencedAttachmentIds');
    const updatedAt = this.sidecarMap(sidecar.attachmentUpdatedAt, 'attachmentId', 'updatedAt');
    if (refs.size !== pageRows.length || updatedAt.size !== attachmentRows.length) {
      throw new RevisionV3IntegrityError();
    }
    const folders: SyncFolderV3[] = folderRows.map((folder) => {
      if (pathKey(folder.path) !== folder.pathKey) throw new RevisionV3IntegrityError();
      return {
        folderId: folder.folderId, parentFolderId: folder.parentFolderId, name: folder.name,
        path: folder.path, sortOrder: folder.sortOrder, updatedAt: folder.updatedAt.toISOString(),
      };
    });
    const pages: SyncPageV3[] = [];
    for (const page of pageRows) {
      const body = normalizeMarkdown(page.content.body);
      if (
        pathKey(page.path) !== page.pathKey
        || body !== page.content.body
        || await contentHash(body) !== page.contentHash
        || encoder.encode(body).byteLength !== page.content.byteLength
      ) throw new RevisionV3IntegrityError();
      const pageRefs = refs.get(page.pageId);
      if (!Array.isArray(pageRefs)) throw new RevisionV3IntegrityError();
      pages.push({
        pageId: page.pageId, folderId: page.folderId, path: page.path, title: page.title,
        body, contentHash: page.contentHash, updatedAt: page.updatedAt.toISOString(),
        referencedAttachmentIds: pageRefs as string[],
      });
    }
    const attachments: SyncAttachmentV3[] = attachmentRows.map((row) => {
      if (
        row.spaceId !== spaceId
        || row.attachmentId !== row.attachment.id
        || row.attachment.spaceId !== spaceId
        || row.attachmentVersionId !== row.attachmentVersion.id
        || row.attachmentId !== row.attachmentVersion.attachmentId
        || row.attachmentVersion.attachment.id !== row.attachmentId
        || row.attachmentVersion.attachment.spaceId !== spaceId
        || pathKey(row.path) !== row.pathKey
        || row.attachmentVersion.storageKey !== this.storageKey(row.attachmentVersion.contentHash)
      ) throw new RevisionV3IntegrityError();
      const timestamp = updatedAt.get(row.attachmentId);
      if (typeof timestamp !== 'string') throw new RevisionV3IntegrityError();
      return {
        attachmentId: row.attachmentId,
        path: row.path,
        mimeType: row.attachmentVersion.mimeType as SyncAttachmentV3['mimeType'],
        sizeBytes: row.attachmentVersion.sizeBytes.toString(),
        width: row.attachmentVersion.width,
        height: row.attachmentVersion.height,
        contentHash: row.attachmentVersion.contentHash,
        updatedAt: timestamp,
      };
    });
    let manifest: TreeRevisionContentManifestV3;
    try {
      manifest = canonicalTreeRevisionManifestV3({
        protocolVersion: '3', spaceId, folders, pages, attachments,
      });
    } catch {
      throw new RevisionV3IntegrityError();
    }
    const canonicalAttachmentIds = manifest.attachments.map((attachment) => attachment.attachmentId);
    const storedAttachmentIds = [...attachmentRows]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((row, ordinal) => {
        if (row.ordinal !== ordinal) throw new RevisionV3IntegrityError();
        return row.attachmentId;
      });
    if (canonicalAttachmentIds.join('\0') !== storedAttachmentIds.join('\0')) {
      throw new RevisionV3IntegrityError();
    }
    const revisionContentHash = await treeRevisionContentHashV3(manifest);
    const revisionManifestByteLength = canonicalBytes(manifest).byteLength;
    const revisionBodyBytes = manifest.pages.reduce(
      (total, page) => total + encoder.encode(page.body).byteLength, 0,
    );
    const revisionAttachmentBytes = manifest.attachments.reduce(
      (total, attachment) => total + Number(BigInt(attachment.sizeBytes)), 0,
    );
    const delta = Array.isArray(revision.delta) ? revision.delta : null;
    let canonicalDelta: TreeDeltaItemV3[];
    try {
      canonicalDelta = canonicalTreeDeltaItemsV3((delta ?? []) as TreeDeltaItemV3[]);
    } catch {
      throw new RevisionV3IntegrityError();
    }
    if (
      !delta
      || !Buffer.from(canonicalBytes(delta)).equals(Buffer.from(canonicalBytes(canonicalDelta)))
    ) throw new RevisionV3IntegrityError();
    const metadataMatches = revision.revisionContentHash === revisionContentHash
      && revision.contentHash === revisionContentHash
      && revision.pageCount === BigInt(manifest.pages.length)
      && revision.attachmentCount === BigInt(manifest.attachments.length)
      && revision.revisionManifestByteLength === BigInt(revisionManifestByteLength)
      && revision.revisionBodyBytes === BigInt(revisionBodyBytes)
      && revision.revisionAttachmentBytes === BigInt(revisionAttachmentBytes)
      && sidecar.revisionContentHash === revisionContentHash
      && sidecar.folderCount === String(manifest.folders.length)
      && sidecar.pageCount === String(manifest.pages.length)
      && sidecar.attachmentCount === String(manifest.attachments.length)
      && sidecar.revisionManifestByteLength === String(revisionManifestByteLength)
      && sidecar.revisionBodyBytes === String(revisionBodyBytes)
      && sidecar.revisionAttachmentBytes === String(revisionAttachmentBytes)
      && sidecar.treeDeltaCount === String(canonicalDelta.length);
    if (!metadataMatches) throw new RevisionV3IntegrityError();
    return {
      revision: revision.id,
      sequence: revision.sequence,
      publishedAt: revision.createdAt.toISOString(),
      manifest,
      revisionContentHash,
      revisionManifestByteLength,
      revisionBodyBytes,
      revisionAttachmentBytes,
    };
  }

  private sidecarMap(value: unknown, idKey: string, valueKey: string): Map<string, unknown> {
    if (!Array.isArray(value)) throw new RevisionV3IntegrityError();
    const result = new Map<string, unknown>();
    for (const item of value) {
      const row = record(item);
      if (!row || !exactKeys(row, [idKey, valueKey]) || typeof row[idKey] !== 'string' || result.has(row[idKey] as string)) {
        throw new RevisionV3IntegrityError();
      }
      result.set(row[idKey] as string, row[valueKey]);
    }
    return result;
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

  private isSupportedLegacy(revision: { schemaVersion: string; recipeVersion: string }): boolean {
    return (revision.schemaVersion === 'knowledge-bundle@1' && revision.recipeVersion === 'none')
      || (revision.schemaVersion === 'content-tree@2' && revision.recipeVersion === 'space-folders-v1');
  }

  private storageKey(contentHashValue: string): string {
    return `sha256/${contentHashValue.slice(0, 2)}/${contentHashValue.slice(2, 4)}/${contentHashValue}`;
  }

  private groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
    const grouped = new Map<string, T[]>();
    for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) ?? []), row]);
    return grouped;
  }
}
