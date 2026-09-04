import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  canonicalBytes,
  canonicalTreeDeltaItemsV3,
  canonicalTreeRevisionManifestV3,
  contentHash,
  normalizeMarkdown,
  pathKey,
  treeRevisionContentHashV3,
  treeRevisionDeltaV3,
  type SyncAttachmentV3,
  type SyncFolderV3,
  type SyncPageV3,
  type TreeDeltaItemV3,
  type TreeRevisionContentManifestV3,
} from '@neomei/agentwiki-sync-protocol';

export const V3_SCHEMA_VERSION = 'content-tree@3';
export const V3_RECIPE_VERSION = 'referenced-images-v1';
const encoder = new TextEncoder();

export class SyncV3AuthorityError extends Error {}

export interface VerifiedSyncV3Revision {
  revision: string;
  sequence: number;
  publishedAt: string | null;
  manifest: TreeRevisionContentManifestV3;
  revisionContentHash: string;
  revisionManifestByteLength: number;
  revisionBodyBytes: number;
  revisionAttachmentBytes: number;
}

type RevisionReader = Prisma.TransactionClient;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function emptyManifest(spaceId: string): TreeRevisionContentManifestV3 {
  return { protocolVersion: '3', spaceId, folders: [], pages: [], attachments: [] };
}

@Injectable()
export class SyncV3ImmutableRevisionService {
  async verify(
    tx: RevisionReader,
    spaceId: string,
    revisionRef: string | { id: string; spaceId: string; schemaVersion: string; recipeVersion: string },
  ): Promise<VerifiedSyncV3Revision> {
    const revision = typeof revisionRef === 'string'
      ? revisionRef === 'current'
        ? await tx.spaceKnowledgeRevision.findFirst({ where: { spaceId }, orderBy: { sequence: 'desc' } })
        : await tx.spaceKnowledgeRevision.findUnique({ where: { id: revisionRef } })
      : revisionRef;
    if (!revision || revision.spaceId !== spaceId) throw new SyncV3AuthorityError();
    if (revision.schemaVersion !== V3_SCHEMA_VERSION || revision.recipeVersion !== V3_RECIPE_VERSION) {
      throw new SyncV3AuthorityError('unsupported-v3-revision');
    }
    const parent = (revision as any).parentRevisionId
      ? await tx.spaceKnowledgeRevision.findUnique({ where: { id: (revision as any).parentRevisionId } })
      : null;
    if (parent && parent.spaceId !== spaceId) throw new SyncV3AuthorityError();
    const current = await this.rebuild(tx, spaceId, revision as any);
    const parentManifest = parent
      && parent.schemaVersion === V3_SCHEMA_VERSION
      && parent.recipeVersion === V3_RECIPE_VERSION
      ? (await this.rebuild(tx, spaceId, parent as any, false)).manifest
      : emptyManifest(spaceId);
    let storedDelta: TreeDeltaItemV3[];
    let expectedDelta: TreeDeltaItemV3[];
    try {
      const raw = Array.isArray((revision as any).delta) ? (revision as any).delta as TreeDeltaItemV3[] : null;
      if (!raw) throw new SyncV3AuthorityError();
      storedDelta = canonicalTreeDeltaItemsV3(raw);
      if (!Buffer.from(canonicalBytes(raw)).equals(Buffer.from(canonicalBytes(storedDelta)))) {
        throw new SyncV3AuthorityError();
      }
      expectedDelta = treeRevisionDeltaV3(parentManifest, current.manifest);
    } catch (error) {
      if (error instanceof SyncV3AuthorityError) throw error;
      throw new SyncV3AuthorityError();
    }
    if (!Buffer.from(canonicalBytes(storedDelta)).equals(Buffer.from(canonicalBytes(expectedDelta)))) {
      throw new SyncV3AuthorityError();
    }
    if (current.treeDeltaCount !== storedDelta.length) throw new SyncV3AuthorityError();
    return current.loaded;
  }

  async verifyMany(
    tx: RevisionReader,
    targets: Array<{ spaceId: string; revision: any }>,
  ): Promise<Map<string, VerifiedSyncV3Revision>> {
    if (targets.length === 0) return new Map();
    const parentIds = [...new Set(targets.flatMap(({ revision }) => revision.parentRevisionId
      ? [revision.parentRevisionId as string]
      : []))];
    const parents = parentIds.length === 0 ? [] : await tx.spaceKnowledgeRevision.findMany({
      where: { id: { in: parentIds } },
    });
    const revisions = [...targets.map(({ revision }) => revision), ...parents];
    const ids = revisions.map((revision) => revision.id);
    const [folders, pages, attachments, sidecars] = await Promise.all([
      tx.syncRevisionFolderRow.findMany({ where: { revisionId: { in: ids } } }),
      tx.syncRevisionPageRow.findMany({ where: { revisionId: { in: ids } }, include: { content: true } }),
      tx.syncRevisionAttachmentRow.findMany({
        where: { revisionId: { in: ids } },
        include: {
          attachment: { select: { id: true, spaceId: true } },
          attachmentVersion: { include: { attachment: { select: { id: true, spaceId: true } } } },
        },
      }),
      tx.legacyRevisionSidecar.findMany({ where: { revisionId: { in: ids } }, select: { revisionId: true, sidecar: true } }),
    ]);
    const byId = new Map(revisions.map((revision) => [revision.id, revision]));
    const cached = {
      spaceKnowledgeRevision: {
        findUnique: async ({ where }: any) => byId.get(where.id) ?? null,
      },
      syncRevisionFolderRow: {
        findMany: async ({ where }: any) => folders.filter((row: any) => row.revisionId === where.revisionId),
      },
      syncRevisionPageRow: {
        findMany: async ({ where }: any) => pages.filter((row: any) => row.revisionId === where.revisionId),
      },
      syncRevisionAttachmentRow: {
        findMany: async ({ where }: any) => attachments.filter((row: any) => row.revisionId === where.revisionId),
      },
      legacyRevisionSidecar: {
        findUnique: async ({ where }: any) => sidecars.find((row: any) => row.revisionId === where.revisionId) ?? null,
      },
    } as unknown as RevisionReader;
    const entries = await Promise.all(targets.map(async ({ spaceId, revision }) => (
      [spaceId, await this.verify(cached, spaceId, revision)] as const
    )));
    return new Map(entries);
  }

  private async rebuild(tx: RevisionReader, spaceId: string, revision: any, verifyDeltaCount = true) {
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
    ])) throw new SyncV3AuthorityError();
    if (sidecar.protocolVersion !== '3' || sidecar.manifestSchema !== 'TreeRevisionContentManifestV3') {
      throw new SyncV3AuthorityError();
    }
    const refs = this.sidecarMap(sidecar.pageAttachmentIds, 'pageId', 'referencedAttachmentIds');
    const updatedAt = this.sidecarMap(sidecar.attachmentUpdatedAt, 'attachmentId', 'updatedAt');
    if (refs.size !== pageRows.length || updatedAt.size !== attachmentRows.length) throw new SyncV3AuthorityError();
    const folders: SyncFolderV3[] = folderRows.map((folder: any) => {
      if (pathKey(folder.path) !== folder.pathKey) throw new SyncV3AuthorityError();
      return {
        folderId: folder.folderId, parentFolderId: folder.parentFolderId, name: folder.name,
        path: folder.path, sortOrder: folder.sortOrder, updatedAt: folder.updatedAt.toISOString(),
      };
    });
    const pages: SyncPageV3[] = [];
    for (const page of pageRows as any[]) {
      const body = normalizeMarkdown(page.content.body);
      if (pathKey(page.path) !== page.pathKey || body !== page.content.body
        || await contentHash(body) !== page.contentHash
        || encoder.encode(body).byteLength !== page.content.byteLength) throw new SyncV3AuthorityError();
      const pageRefs = refs.get(page.pageId);
      if (!Array.isArray(pageRefs)) throw new SyncV3AuthorityError();
      pages.push({
        pageId: page.pageId, folderId: page.folderId, path: page.path, title: page.title,
        body, contentHash: page.contentHash, updatedAt: page.updatedAt.toISOString(),
        referencedAttachmentIds: pageRefs as string[],
      });
    }
    const attachments: SyncAttachmentV3[] = (attachmentRows as any[]).map((row) => {
      if (row.spaceId !== spaceId || row.attachmentId !== row.attachment.id
        || row.attachment.spaceId !== spaceId || row.attachmentVersionId !== row.attachmentVersion.id
        || row.attachmentId !== row.attachmentVersion.attachmentId
        || row.attachmentVersion.attachment.id !== row.attachmentId
        || row.attachmentVersion.attachment.spaceId !== spaceId
        || pathKey(row.path) !== row.pathKey
        || row.attachmentVersion.storageKey !== this.storageKey(row.attachmentVersion.contentHash)) {
        throw new SyncV3AuthorityError();
      }
      const timestamp = updatedAt.get(row.attachmentId);
      if (typeof timestamp !== 'string') throw new SyncV3AuthorityError();
      return {
        attachmentId: row.attachmentId, path: row.path,
        mimeType: row.attachmentVersion.mimeType as SyncAttachmentV3['mimeType'],
        sizeBytes: row.attachmentVersion.sizeBytes.toString(), width: row.attachmentVersion.width,
        height: row.attachmentVersion.height, contentHash: row.attachmentVersion.contentHash,
        updatedAt: timestamp,
      };
    });
    let manifest: TreeRevisionContentManifestV3;
    try {
      manifest = canonicalTreeRevisionManifestV3({ protocolVersion: '3', spaceId, folders, pages, attachments });
    } catch {
      throw new SyncV3AuthorityError();
    }
    const canonicalAttachmentIds = manifest.attachments.map((attachment) => attachment.attachmentId);
    const storedAttachmentIds = [...(attachmentRows as any[])]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((row, ordinal) => {
        if (row.ordinal !== ordinal) throw new SyncV3AuthorityError();
        return row.attachmentId;
      });
    if (canonicalAttachmentIds.join('\0') !== storedAttachmentIds.join('\0')) throw new SyncV3AuthorityError();
    const revisionContentHash = await treeRevisionContentHashV3(manifest);
    const revisionManifestByteLength = canonicalBytes(manifest).byteLength;
    const revisionBodyBytes = manifest.pages.reduce((total, page) => total + encoder.encode(page.body).byteLength, 0);
    const revisionAttachmentBytes = manifest.attachments.reduce(
      (total, attachment) => total + Number(BigInt(attachment.sizeBytes)), 0,
    );
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
      && sidecar.revisionAttachmentBytes === String(revisionAttachmentBytes);
    if (!metadataMatches) throw new SyncV3AuthorityError();
    const treeDeltaCount = Number(sidecar.treeDeltaCount);
    if (!Number.isSafeInteger(treeDeltaCount) || treeDeltaCount < 0 || (verifyDeltaCount && !Array.isArray(revision.delta))) {
      throw new SyncV3AuthorityError();
    }
    return {
      treeDeltaCount,
      manifest,
      loaded: {
        revision: revision.id, sequence: revision.sequence, publishedAt: revision.createdAt.toISOString(),
        manifest, revisionContentHash, revisionManifestByteLength, revisionBodyBytes, revisionAttachmentBytes,
      } satisfies VerifiedSyncV3Revision,
    };
  }

  private sidecarMap(value: unknown, idKey: string, valueKey: string): Map<string, unknown> {
    if (!Array.isArray(value)) throw new SyncV3AuthorityError();
    const result = new Map<string, unknown>();
    for (const item of value) {
      const row = record(item);
      if (!row || !exactKeys(row, [idKey, valueKey]) || typeof row[idKey] !== 'string'
        || result.has(row[idKey] as string)) throw new SyncV3AuthorityError();
      result.set(row[idKey] as string, row[valueKey]);
    }
    return result;
  }

  private storageKey(hash: string): string {
    return `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
  }
}
