import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  canonicalBytes,
  canonicalTreeRevisionManifestV3,
  contentHash,
  normalizeMarkdown,
  pathKey,
  treeRevisionContentHashV3,
  treeRevisionDeltaV3,
  type SyncAttachmentV3,
  type SyncFolderV3,
  type SyncPageV3,
  type TreeRevisionContentManifestV3,
} from '@neomei/agentwiki-sync-protocol';
import { MarkdownResourceService } from '../../markdown-resources/markdown-resource.service';
import { resolveReferencedAttachments } from '../../markdown-resources/attachment-reference';
import { SyncApiException } from '../../integrations/obsidian/sync-error';
import type { RevisionOrigin, RevisionWriteResult } from './space-revision-writer.service';
import type { SpaceLockedTransaction } from './readable-sync-path.service';

const V3_SCHEMA_VERSION = 'content-tree@3';
const V3_RECIPE_VERSION = 'referenced-images-v1';
const encoder = new TextEncoder();

export interface SyncV3Candidate {
  folders: SyncFolderV3[];
  pages: SyncPageV3[];
  attachments: SyncAttachmentV3[];
}

export interface SyncV3RevisionWriteResult extends RevisionWriteResult {
  attachmentCount: bigint;
  revisionAttachmentBytes: bigint;
  publishedAt: Date;
}

export interface SyncV3CandidateInspection {
  mode: 'native_v3' | 'bootstrap_required' | 'legacy_v2';
  baseRevision: string;
  candidateHash: string;
  attachmentCount: string;
  transferBytes: string;
  blockers: Array<{
    pageId: string;
    code: 'ATTACHMENT_REFERENCE_INVALID' | 'ATTACHMENT_MISSING';
  }>;
  candidate: SyncV3Candidate;
}

interface V3Sidecar {
  protocolVersion: '3';
  manifestSchema: 'TreeRevisionContentManifestV3';
  revisionContentHash: string;
  folderCount: string;
  pageCount: string;
  attachmentCount: string;
  revisionManifestByteLength: string;
  revisionBodyBytes: string;
  revisionAttachmentBytes: string;
  treeDeltaCount: string;
  pageAttachmentIds: Array<{ pageId: string; referencedAttachmentIds: string[] }>;
  attachmentUpdatedAt: Array<{ attachmentId: string; updatedAt: string }>;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return rightSet.size === right.length && left.every((value) => rightSet.has(value));
}

function attachmentName(path: string): string {
  return path.slice('assets/'.length);
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sidecarObject(value: Prisma.JsonValue | null | undefined): Prisma.InputJsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Prisma.InputJsonObject
    : {};
}

@Injectable()
export class SyncV3RevisionWriterService {
  constructor(private readonly markdownResources: MarkdownResourceService) {}

  async inspectCurrentLocked(
    tx: SpaceLockedTransaction,
    spaceId: string,
  ): Promise<SyncV3CandidateInspection> {
    const [latest, historicalV3] = await Promise.all([
      tx.spaceKnowledgeRevision.findFirst({
        where: { spaceId }, orderBy: { sequence: 'desc' }, select: { id: true },
      }),
      tx.spaceKnowledgeRevision.findFirst({
        where: { spaceId, schemaVersion: V3_SCHEMA_VERSION }, select: { id: true },
      }),
    ]);
    if (!latest) return this.inspectLiveCurrentLocked(tx, spaceId, historicalV3 !== null);
    const [folders, pages] = await Promise.all([
      tx.syncRevisionFolderRow.findMany({
        where: { revisionId: latest.id },
        orderBy: [{ sortOrder: 'asc' }, { folderId: 'asc' }],
      }),
      tx.syncRevisionPageRow.findMany({
        where: { revisionId: latest.id },
        include: { content: true },
        orderBy: [{ pathKey: 'asc' }, { pageId: 'asc' }],
      }),
    ]);
    return this.inspectCandidate(tx, spaceId, latest.id, historicalV3 !== null, {
      folders: folders.map((folder): SyncFolderV3 => ({
        folderId: folder.folderId,
        parentFolderId: folder.parentFolderId,
        name: folder.name,
        path: folder.path,
        sortOrder: folder.sortOrder,
        updatedAt: folder.updatedAt.toISOString(),
      })),
      pages: pages.map((page) => ({
        pageId: page.pageId,
        folderId: page.folderId,
        path: page.path,
        title: page.title,
        body: page.content.body,
        updatedAt: page.updatedAt,
      })),
    });
  }

  private async inspectLiveCurrentLocked(
    tx: SpaceLockedTransaction,
    spaceId: string,
    nativeV3?: boolean,
  ): Promise<SyncV3CandidateInspection> {
    const [latest, historicalV3, folders, pages] = await Promise.all([
      tx.spaceKnowledgeRevision.findFirst({
        where: { spaceId }, orderBy: { sequence: 'desc' }, select: { id: true },
      }),
      nativeV3 === undefined ? tx.spaceKnowledgeRevision.findFirst({
        where: { spaceId, schemaVersion: V3_SCHEMA_VERSION }, select: { id: true },
      }) : Promise.resolve(nativeV3 ? { id: 'native' } : null),
      tx.folder.findMany({
        where: { spaceId, deletedAt: null }, orderBy: [{ pathKey: 'asc' }, { id: 'asc' }],
      }),
      tx.page.findMany({
        where: { spaceId, deletedAt: null }, orderBy: [{ syncPathKey: 'asc' }, { knowledgeKey: 'asc' }],
      }),
    ]);
    return this.inspectCandidate(tx, spaceId, latest?.id ?? '0', historicalV3 !== null, {
      folders: folders.map((folder): SyncFolderV3 => ({
        folderId: folder.id,
        parentFolderId: folder.parentId,
        name: folder.name,
        path: folder.path,
        sortOrder: folder.sortOrder,
        updatedAt: folder.updatedAt.toISOString(),
      })),
      pages: pages.map((page) => ({
        pageId: page.knowledgeKey,
        folderId: page.folderId,
        path: page.syncPath,
        title: page.title,
        body: page.content,
        updatedAt: page.updatedAt,
      })),
    });
  }

  private async inspectCandidate(
    tx: SpaceLockedTransaction,
    spaceId: string,
    baseRevision: string,
    nativeV3: boolean,
    source: {
      folders: SyncFolderV3[];
      pages: Array<{
        pageId: string; folderId: string | null; path: string; title: string;
        body: string; updatedAt: Date;
      }>;
    },
  ): Promise<SyncV3CandidateInspection> {

    const blockers: SyncV3CandidateInspection['blockers'] = [];
    const syncPages: SyncPageV3[] = [];
    const referencedIds = new Set<string>();
    for (const page of source.pages) {
      const body = normalizeMarkdown(page.body);
      const resolved = await this.markdownResources.resolveReferencedAttachments({
        spaceId,
        sourceSyncPath: page.path,
        body,
      }, tx);
      for (const error of resolved.errors) blockers.push({ pageId: page.pageId, code: error.code });
      for (const attachmentId of resolved.attachmentIds) referencedIds.add(attachmentId);
      syncPages.push({
        pageId: page.pageId,
        folderId: page.folderId,
        path: page.path,
        title: page.title,
        body,
        contentHash: await contentHash(body),
        updatedAt: page.updatedAt.toISOString(),
        referencedAttachmentIds: resolved.attachmentIds,
      });
    }

    const attachments = referencedIds.size === 0 ? [] : await tx.spaceAttachment.findMany({
      where: { spaceId, status: 'active', id: { in: [...referencedIds] } },
      orderBy: [{ nameKey: 'asc' }, { id: 'asc' }],
    });
    const syncAttachments = attachments.map((attachment): SyncAttachmentV3 => ({
      attachmentId: attachment.id,
      path: `assets/${attachment.displayName}`,
      mimeType: attachment.mimeType as SyncAttachmentV3['mimeType'],
      sizeBytes: attachment.sizeBytes.toString(),
      width: attachment.width,
      height: attachment.height,
      contentHash: attachment.contentHash,
      updatedAt: attachment.updatedAt.toISOString(),
    }));
    const candidate = this.canonicalCandidate(spaceId, {
      folders: source.folders,
      pages: syncPages,
      attachments: syncAttachments,
    });
    const candidateHash = await treeRevisionContentHashV3({
      protocolVersion: '3', spaceId, ...candidate,
    });
    return {
      mode: nativeV3
        ? 'native_v3'
        : referencedIds.size > 0 || blockers.length > 0
          ? 'bootstrap_required'
          : 'legacy_v2',
      baseRevision,
      candidateHash,
      attachmentCount: String(candidate.attachments.length),
      transferBytes: candidate.attachments.reduce(
        (total, attachment) => total + BigInt(attachment.sizeBytes), 0n,
      ).toString(),
      blockers,
      candidate,
    };
  }

  async advanceCurrentIfRequiredLocked(
    tx: SpaceLockedTransaction,
    spaceId: string,
    origin: RevisionOrigin,
  ): Promise<SyncV3RevisionWriteResult | null> {
    const inspection = await this.inspectLiveCurrentLocked(tx, spaceId);
    if (inspection.mode !== 'native_v3') return null;
    const blocker = inspection.blockers[0];
    if (blocker) {
      throw new SyncApiException(blocker.code, 'Page attachment reference cannot be resolved', undefined, '3');
    }
    return this.advanceV3Locked(tx, spaceId, inspection.candidate, origin);
  }

  async advanceV3Locked(
    tx: SpaceLockedTransaction,
    spaceId: string,
    candidateInput: SyncV3Candidate,
    origin: RevisionOrigin,
  ): Promise<SyncV3RevisionWriteResult> {
    const resolverCandidates = candidateInput.attachments.map((attachment) => ({
      id: attachment.attachmentId,
      displayName: attachmentName(attachment.path),
      nameKey: attachmentName(attachment.path).normalize('NFC').toLocaleLowerCase('en-US'),
    }));
    for (const page of candidateInput.pages) {
      const normalizedBody = normalizeMarkdown(page.body);
      if (await contentHash(normalizedBody) !== page.contentHash) {
        throw new SyncApiException(
          'ATTACHMENT_CONTENT_INVALID',
          'Page content hash does not match its body',
          undefined,
          '3',
        );
      }
      const resolved = resolveReferencedAttachments(normalizedBody, page.path, resolverCandidates);
      const blocker = resolved.errors[0];
      if (blocker) {
        throw new SyncApiException(blocker.code, 'Page attachment reference cannot be resolved', undefined, '3');
      }
      if (!sameStringSet(resolved.attachmentIds, page.referencedAttachmentIds)) {
        throw new SyncApiException(
          'ATTACHMENT_REFERENCE_INVALID',
          'Page attachment references do not match the candidate manifest',
          undefined,
          '3',
        );
      }
    }

    let candidate: SyncV3Candidate;
    try {
      candidate = this.canonicalCandidate(spaceId, candidateInput);
    } catch {
      throw new SyncApiException(
        'ATTACHMENT_CONTENT_INVALID',
        'Candidate manifest is invalid',
        undefined,
        '3',
      );
    }

    const latest = await tx.spaceKnowledgeRevision.findFirst({
      where: { spaceId }, orderBy: { sequence: 'desc' },
      select: { id: true, sequence: true, schemaVersion: true },
    });
    const parentManifest = latest?.schemaVersion === V3_SCHEMA_VERSION
      ? await this.loadManifest(tx, spaceId, latest.id)
      : null;
    const manifest = canonicalTreeRevisionManifestV3({
      protocolVersion: '3', spaceId, ...candidate,
    });
    const delta = treeRevisionDeltaV3(parentManifest, manifest);

    const activeAttachments = candidate.attachments.length === 0 ? [] : await tx.spaceAttachment.findMany({
      where: {
        spaceId,
        status: 'active',
        id: { in: candidate.attachments.map((attachment) => attachment.attachmentId) },
      },
    });
    if (activeAttachments.length !== candidate.attachments.length) {
      throw new SyncApiException('ATTACHMENT_MISSING', 'Candidate attachment is not active in this Space', undefined, '3');
    }
    const activeById = new Map(activeAttachments.map((attachment) => [attachment.id, attachment]));
    const attachmentVersions = new Map<string, string>();
    for (const attachment of candidate.attachments) {
      const active = activeById.get(attachment.attachmentId)!;
      let version = await tx.attachmentVersion.findUnique({
        where: { attachmentId_contentHash: {
          attachmentId: attachment.attachmentId,
          contentHash: attachment.contentHash,
        } },
      });
      if (!version) {
        const metadataMatches = active.contentHash === attachment.contentHash
          && active.mimeType === attachment.mimeType
          && active.sizeBytes.toString() === attachment.sizeBytes
          && active.width === attachment.width
          && active.height === attachment.height
          && active.storageKey.length > 0;
        if (!metadataMatches) {
          throw new SyncApiException('ATTACHMENT_BLOB_MISSING', 'Candidate attachment version is not staged', undefined, '3');
        }
        version = await tx.attachmentVersion.create({ data: {
          attachmentId: attachment.attachmentId,
          contentHash: attachment.contentHash,
          storageKey: active.storageKey,
          mimeType: attachment.mimeType,
          sizeBytes: BigInt(attachment.sizeBytes),
          width: attachment.width,
          height: attachment.height,
        } });
      }
      if (
        version.contentHash !== attachment.contentHash
        || version.mimeType !== attachment.mimeType
        || version.sizeBytes.toString() !== attachment.sizeBytes
        || version.width !== attachment.width
        || version.height !== attachment.height
      ) {
        throw new SyncApiException(
          'ATTACHMENT_CONTENT_INVALID',
          'Candidate attachment metadata does not match its immutable version',
          undefined,
          '3',
        );
      }
      attachmentVersions.set(attachment.attachmentId, version.id);
      const name = attachmentName(attachment.path);
      if (
        active.displayName !== name
        || active.nameKey !== pathKey(name)
        || active.contentHash !== attachment.contentHash
        || active.mimeType !== attachment.mimeType
        || active.sizeBytes.toString() !== attachment.sizeBytes
        || active.width !== attachment.width
        || active.height !== attachment.height
        || active.updatedAt.toISOString() !== attachment.updatedAt
      ) {
        await tx.spaceAttachment.update({
          where: { id: active.id },
          data: {
            displayName: name,
            nameKey: pathKey(name),
            contentHash: attachment.contentHash,
            storageKey: version.storageKey,
            mimeType: attachment.mimeType,
            sizeBytes: BigInt(attachment.sizeBytes),
            width: attachment.width,
            height: attachment.height,
            updatedAt: new Date(attachment.updatedAt),
          },
        });
      }
    }

    await this.persistPages(tx, spaceId, candidate.pages, origin);
    for (const page of candidate.pages) {
      await tx.syncPageContentRow.upsert({
        where: { contentHash: page.contentHash },
        create: {
          contentHash: page.contentHash,
          body: page.body,
          byteLength: encoder.encode(page.body).byteLength,
        },
        update: {},
      });
      await tx.legacyPageBodyRow.upsert({
        where: { contentHash: page.contentHash },
        create: { contentHash: page.contentHash, body: page.body },
        update: {},
      });
    }

    const revisionContentHash = await treeRevisionContentHashV3(manifest);
    const revisionManifestByteLength = BigInt(canonicalBytes(manifest).byteLength);
    const revisionBodyBytes = BigInt(candidate.pages.reduce(
      (total, page) => total + encoder.encode(page.body).byteLength, 0,
    ));
    const revisionAttachmentBytes = candidate.attachments.reduce(
      (total, attachment) => total + BigInt(attachment.sizeBytes), 0n,
    );
    const created = await tx.spaceKnowledgeRevision.create({ data: {
      spaceId,
      sequence: (latest?.sequence ?? 0) + 1,
      parentRevisionId: latest?.id ?? null,
      schemaVersion: V3_SCHEMA_VERSION,
      recipeVersion: V3_RECIPE_VERSION,
      contentHash: revisionContentHash,
      snapshot: Prisma.JsonNull,
      delta: jsonValue(delta),
      revisionContentHash,
      pageCount: BigInt(candidate.pages.length),
      revisionBodyBytes,
      revisionManifestByteLength,
      attachmentCount: BigInt(candidate.attachments.length),
      revisionAttachmentBytes,
      origin: origin.origin,
      createdByUserId: origin.createdByUserId ?? null,
      humanDeviceCredentialId: origin.humanDeviceCredentialId ?? null,
      sourceChangeSetId: origin.sourceChangeSetId ?? null,
      migrationBatchId: origin.migrationBatchId ?? null,
    } });

    if (candidate.folders.length > 0) {
      await tx.syncRevisionFolderRow.createMany({ data: candidate.folders.map((folder) => ({
        revisionId: created.id,
        folderId: folder.folderId,
        parentFolderId: folder.parentFolderId,
        name: folder.name,
        path: folder.path,
        pathKey: pathKey(folder.path),
        sortOrder: folder.sortOrder,
        updatedAt: new Date(folder.updatedAt),
      })) });
    }
    if (candidate.pages.length > 0) {
      await tx.syncRevisionPageRow.createMany({ data: candidate.pages.map((page) => ({
        revisionId: created.id,
        pageId: page.pageId,
        folderId: page.folderId,
        path: page.path,
        pathKey: pathKey(page.path),
        title: page.title,
        contentHash: page.contentHash,
        updatedAt: new Date(page.updatedAt),
      })) });
      await tx.legacyRevisionPageExtra.createMany({ data: candidate.pages.map((page, ordinal) => ({
        revisionId: created.id,
        pageId: page.pageId,
        ordinal,
        legacyBodyHash: page.contentHash,
        extra: jsonValue({
          spaceId,
          title: page.title,
          order: ordinal,
          metadata: null,
          artifactIds: [],
          legacyBodyHash: page.contentHash,
          contentHash: page.contentHash,
          path: page.path,
          updatedAt: page.updatedAt,
        }),
      })) });
    }
    if (candidate.attachments.length > 0) {
      await tx.syncRevisionAttachmentRow.createMany({ data: candidate.attachments.map((attachment, ordinal) => ({
        revisionId: created.id,
        attachmentId: attachment.attachmentId,
        attachmentVersionId: attachmentVersions.get(attachment.attachmentId)!,
        spaceId,
        path: attachment.path,
        pathKey: pathKey(attachment.path),
        ordinal,
      })) });
    }

    const representableDelta: Array<{
      operation: string;
      folderId: string | null;
      pageId: string | null;
      previousPath: string | null;
      contentHash: string | null;
    }> = [];
    for (const item of delta) {
      if (item.operation === 'upsert_attachment' || item.operation === 'detach_attachment') continue;
      if (item.operation === 'archive_page') {
        representableDelta.push({ operation: item.operation, folderId: null, pageId: item.pageId, previousPath: item.previousPath, contentHash: null });
        continue;
      }
      if (item.operation === 'archive_folder') {
        representableDelta.push({ operation: item.operation, folderId: item.folderId, pageId: null, previousPath: item.previousPath, contentHash: null });
        continue;
      }
      if (item.operation === 'upsert_folder') {
        representableDelta.push({ operation: item.operation, folderId: item.folder.folderId, pageId: null, previousPath: null, contentHash: null });
        continue;
      }
      representableDelta.push({ operation: item.operation, folderId: null, pageId: item.page.pageId, previousPath: null, contentHash: item.page.contentHash });
    }
    if (representableDelta.length > 0) {
      await tx.syncRevisionTreeDeltaRow.createMany({ data: representableDelta.map((row, ordinal) => ({
        revisionId: created.id, ordinal, ...row,
      })) });
    }
    const priorSidecar = latest ? await tx.legacyRevisionSidecar.findUnique({
      where: { revisionId: latest.id }, select: { sidecar: true },
    }) : null;
    const v3Sidecar: V3Sidecar = {
      protocolVersion: '3',
      manifestSchema: 'TreeRevisionContentManifestV3',
      revisionContentHash,
      folderCount: String(candidate.folders.length),
      pageCount: String(candidate.pages.length),
      attachmentCount: String(candidate.attachments.length),
      revisionManifestByteLength: revisionManifestByteLength.toString(),
      revisionBodyBytes: revisionBodyBytes.toString(),
      revisionAttachmentBytes: revisionAttachmentBytes.toString(),
      treeDeltaCount: String(delta.length),
      pageAttachmentIds: candidate.pages.map((page) => ({
        pageId: page.pageId,
        referencedAttachmentIds: page.referencedAttachmentIds,
      })),
      attachmentUpdatedAt: candidate.attachments.map((attachment) => ({
        attachmentId: attachment.attachmentId,
        updatedAt: attachment.updatedAt,
      })),
    };
    await tx.legacyRevisionSidecar.create({ data: {
      revisionId: created.id,
      sidecar: {
        ...sidecarObject(priorSidecar?.sidecar),
        ...origin.legacySidecarOverride,
        syncV3Revision: jsonValue(v3Sidecar),
      },
    } });
    if (latest) {
      await tx.spaceKnowledgeRevision.update({
        where: { id: latest.id }, data: { supersededAt: new Date() },
      });
    }
    return {
      revisionId: created.id,
      sequence: created.sequence,
      revisionContentHash,
      pageCount: BigInt(candidate.pages.length),
      revisionManifestByteLength,
      revisionBodyBytes,
      attachmentCount: BigInt(candidate.attachments.length),
      revisionAttachmentBytes,
      publishedAt: created.createdAt,
    };
  }

  private canonicalCandidate(spaceId: string, candidate: SyncV3Candidate): SyncV3Candidate {
    const manifest = canonicalTreeRevisionManifestV3({ protocolVersion: '3', spaceId, ...candidate });
    return { folders: manifest.folders, pages: manifest.pages, attachments: manifest.attachments };
  }

  private async persistPages(
    tx: SpaceLockedTransaction,
    spaceId: string,
    pages: SyncPageV3[],
    origin: RevisionOrigin,
  ): Promise<void> {
    if (pages.length === 0) return;
    const existing = await tx.page.findMany({
      where: { spaceId, knowledgeKey: { in: pages.map((page) => page.pageId) } },
    });
    const byKnowledgeKey = new Map(existing.map((page) => [page.knowledgeKey, page]));
    if (existing.length !== pages.length) {
      throw new SyncApiException('ATTACHMENT_CONTENT_INVALID', 'Candidate Page does not exist in this Space', undefined, '3');
    }
    for (const page of pages) {
      const current = byKnowledgeKey.get(page.pageId)!;
      const changed = current.title !== page.title
        || normalizeMarkdown(current.content) !== page.body
        || current.folderId !== page.folderId
        || current.syncPath !== page.path;
      if (!changed) continue;
      await tx.pageVersion.create({ data: {
        pageId: current.id,
        title: current.title,
        content: current.content,
        authorId: current.authorId,
        slug: current.slug,
        format: current.format,
        parentId: current.parentId,
        folderId: current.folderId,
        syncPath: current.syncPath,
        syncPathKey: current.syncPathKey,
        migrationBatchId: origin.migrationBatchId ?? null,
      } });
      await tx.page.update({
        where: { id: current.id },
        data: {
          title: page.title,
          content: page.body,
          folderId: page.folderId,
          syncPath: page.path,
          syncPathKey: pathKey(page.path),
          updatedAt: new Date(page.updatedAt),
          lastModifiedAt: new Date(page.updatedAt),
          lastModifiedByUserId: origin.createdByUserId ?? null,
          lastChangeSetId: origin.sourceChangeSetId ?? null,
        },
      });
    }
  }

  private async loadManifest(
    tx: SpaceLockedTransaction,
    spaceId: string,
    revisionId: string,
  ): Promise<TreeRevisionContentManifestV3> {
    const [folders, pages, attachments, sidecarRow] = await Promise.all([
      tx.syncRevisionFolderRow.findMany({ where: { revisionId }, orderBy: [{ sortOrder: 'asc' }, { folderId: 'asc' }] }),
      tx.syncRevisionPageRow.findMany({
        where: { revisionId }, include: { content: true }, orderBy: { pathKey: 'asc' },
      }),
      tx.syncRevisionAttachmentRow.findMany({
        where: { revisionId, spaceId }, include: { attachmentVersion: true }, orderBy: { ordinal: 'asc' },
      }),
      tx.legacyRevisionSidecar.findUnique({ where: { revisionId }, select: { sidecar: true } }),
    ]);
    const rawSidecar = sidecarObject(sidecarRow?.sidecar).syncV3Revision;
    const v3 = rawSidecar && typeof rawSidecar === 'object' && !Array.isArray(rawSidecar)
      ? rawSidecar as unknown as V3Sidecar
      : null;
    if (!v3 || v3.protocolVersion !== '3') {
      throw new SyncApiException('ATTACHMENT_CONTENT_INVALID', 'Stored v3 revision sidecar is incomplete', undefined, '3');
    }
    const refs = new Map(v3.pageAttachmentIds.map((item) => [item.pageId, item.referencedAttachmentIds]));
    const updated = new Map(v3.attachmentUpdatedAt.map((item) => [item.attachmentId, item.updatedAt]));
    return canonicalTreeRevisionManifestV3({
      protocolVersion: '3',
      spaceId,
      folders: folders.map((folder) => ({
        folderId: folder.folderId,
        parentFolderId: folder.parentFolderId,
        name: folder.name,
        path: folder.path,
        sortOrder: folder.sortOrder,
        updatedAt: folder.updatedAt.toISOString(),
      })),
      pages: pages.map((page) => ({
        pageId: page.pageId,
        folderId: page.folderId,
        path: page.path,
        title: page.title,
        body: page.content.body,
        contentHash: page.contentHash,
        updatedAt: page.updatedAt.toISOString(),
        referencedAttachmentIds: refs.get(page.pageId) ?? [],
      })),
      attachments: attachments.map((attachment) => ({
        attachmentId: attachment.attachmentId,
        path: attachment.path,
        mimeType: attachment.attachmentVersion.mimeType as SyncAttachmentV3['mimeType'],
        sizeBytes: attachment.attachmentVersion.sizeBytes.toString(),
        width: attachment.attachmentVersion.width,
        height: attachment.attachmentVersion.height,
        contentHash: attachment.attachmentVersion.contentHash,
        updatedAt: updated.get(attachment.attachmentId) ?? attachment.attachmentVersion.createdAt.toISOString(),
      })),
    });
  }
}
