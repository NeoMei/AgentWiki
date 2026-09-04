import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  canonicalBytes,
  canonicalTreeRevisionManifestV3,
  contentHash,
  normalizeMarkdown,
  pathKey,
  SyncAttachmentV3Schema,
  SyncFolderV3Schema,
  SyncPageV3Schema,
  TREE_SYNC_V2_LIMITS,
  TREE_SYNC_V3_HARD_LIMITS,
  treeRevisionContentHashV3,
  treeRevisionDeltaV3,
  validatePortableMarkdownPath,
  type SyncAttachmentV3,
  type SyncFolderV3,
  type SyncPageV3,
  type TreeRevisionContentManifestV3,
} from '@neomei/agentwiki-sync-protocol';
import { MarkdownResourceService } from '../../markdown-resources/markdown-resource.service';
import { resolveReferencedAttachments } from '../../markdown-resources/attachment-reference';
import { normalizeAttachmentName } from '../../attachments/attachment-name';
import { SyncApiException } from '../../integrations/obsidian/sync-error';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../../attachments/attachment-storage';
import type {
  PageChange,
  RevisionOrigin,
  RevisionWriteResult,
  StructuralPageChange,
} from './space-revision-writer.service';
import type { SpaceLockedTransaction } from './readable-sync-path.service';
import {
  isSupportedSyncRevisionFormat,
  isSyncV3RevisionFormat,
  SYNC_V3_RECIPE_VERSION,
  SYNC_V3_SCHEMA_VERSION,
} from './sync-revision-format';

const WRITE_BATCH_SIZE = 500;
const encoder = new TextEncoder();

function v3PagePath(path: string): string {
  const portable = validatePortableMarkdownPath(path).path;
  return portable.startsWith('pages/') ? portable : `pages/${portable}`;
}

async function writeBatches<T>(
  rows: readonly T[],
  write: (batch: T[]) => Promise<unknown>,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += WRITE_BATCH_SIZE) {
    await write(rows.slice(offset, offset + WRITE_BATCH_SIZE));
  }
}

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

function assertSupportedRevisionHead(
  revision: { schemaVersion: string; recipeVersion: string } | null,
): void {
  if (!revision) return;
  if (!isSupportedSyncRevisionFormat(revision)) {
    throw new SyncApiException(
      'SYNC_PROTOCOL_UPGRADE_REQUIRED',
      'Latest revision uses a newer or unsupported Sync protocol',
      undefined,
      '3',
    );
  }
}

export function assertSyncV3CandidateHardLimits(candidate: SyncV3Candidate): void {
  if (candidate.folders.length + candidate.pages.length > TREE_SYNC_V2_LIMITS.maxSnapshotObjects) {
    throw new SyncApiException(
      'ATTACHMENT_CONTENT_INVALID',
      'Sync v3 candidate contains too many Folder/Page objects',
      undefined,
      '3',
    );
  }
  const bodyBytes = candidate.pages.reduce(
    (total, page) => total + encoder.encode(page.body).byteLength,
    0,
  );
  if (bodyBytes > TREE_SYNC_V2_LIMITS.maxDocumentTreeBytes) {
    throw new SyncApiException(
      'ATTACHMENT_CONTENT_INVALID',
      'Sync v3 Page bodies exceed the hard limit',
      undefined,
      '3',
    );
  }
  if (candidate.attachments.length > TREE_SYNC_V3_HARD_LIMITS.maxRevisionAttachments) {
    throw new SyncApiException(
      'ATTACHMENT_QUOTA_EXCEEDED',
      'Sync v3 attachment count exceeds the hard limit',
      undefined,
      '3',
    );
  }
  let transferBytes = 0n;
  try {
    for (const attachment of candidate.attachments) {
      const sizeBytes = BigInt(attachment.sizeBytes);
      if (sizeBytes > BigInt(TREE_SYNC_V3_HARD_LIMITS.maxAttachmentBytes)) {
        throw new RangeError('per-attachment');
      }
      transferBytes += sizeBytes;
    }
  } catch {
    throw new SyncApiException(
      'ATTACHMENT_QUOTA_EXCEEDED',
      'Sync v3 attachment size is invalid',
      undefined,
      '3',
    );
  }
  if (transferBytes > BigInt(TREE_SYNC_V3_HARD_LIMITS.maxTransferBlobBytes)) {
    throw new SyncApiException(
      'ATTACHMENT_QUOTA_EXCEEDED',
      'Sync v3 attachment transfer bytes exceed the hard limit',
      undefined,
      '3',
    );
  }
}

@Injectable()
export class SyncV3RevisionWriterService {
  constructor(
    private readonly markdownResources: MarkdownResourceService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  async inspectCurrentLocked(
    tx: SpaceLockedTransaction,
    spaceId: string,
  ): Promise<SyncV3CandidateInspection> {
    const [latest, historicalV3] = await Promise.all([
      tx.spaceKnowledgeRevision.findFirst({
        where: { spaceId }, orderBy: { sequence: 'desc' },
        select: { id: true, schemaVersion: true, recipeVersion: true },
      }),
      tx.spaceKnowledgeRevision.findFirst({
        where: {
          spaceId,
          schemaVersion: SYNC_V3_SCHEMA_VERSION,
          recipeVersion: SYNC_V3_RECIPE_VERSION,
        },
        select: { id: true },
      }),
    ]);
    assertSupportedRevisionHead(latest);
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
        where: { spaceId }, orderBy: { sequence: 'desc' },
        select: { id: true, schemaVersion: true, recipeVersion: true },
      }),
      nativeV3 === undefined ? tx.spaceKnowledgeRevision.findFirst({
        where: {
          spaceId,
          schemaVersion: SYNC_V3_SCHEMA_VERSION,
          recipeVersion: SYNC_V3_RECIPE_VERSION,
        },
        select: { id: true },
      }) : Promise.resolve(nativeV3 ? { id: 'native' } : null),
      tx.folder.findMany({
        where: { spaceId, deletedAt: null }, orderBy: [{ pathKey: 'asc' }, { id: 'asc' }],
      }),
      tx.page.findMany({
        where: { spaceId, deletedAt: null }, orderBy: [{ syncPathKey: 'asc' }, { knowledgeKey: 'asc' }],
      }),
    ]);
    assertSupportedRevisionHead(latest);
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
        path: v3PagePath(page.syncPath),
        title: page.title,
        body: page.content,
        updatedAt: page.updatedAt,
      })),
    });
  }

  async inspectCandidate(
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
    assertSyncV3CandidateHardLimits({ folders: source.folders, pages: source.pages.map((page) => ({
      ...page,
      contentHash: '0'.repeat(64),
      updatedAt: page.updatedAt.toISOString(),
      referencedAttachmentIds: [],
    })), attachments: [] });
    const blockers: SyncV3CandidateInspection['blockers'] = [];
    const syncPages: SyncPageV3[] = [];
    const referencedIds = new Set<string>();
    const preparedPages = source.pages.map((page) => ({
      page,
      body: normalizeMarkdown(page.body),
    }));
    const resolvedPages = await this.markdownResources.resolveReferencedAttachmentsBatch(
      preparedPages.map(({ page, body }) => ({
        spaceId,
        sourceSyncPath: page.path,
        body,
      })),
      tx,
    );
    for (const [index, prepared] of preparedPages.entries()) {
      const { page, body } = prepared;
      const resolved = resolvedPages[index]!;
      for (const error of resolved.errors) blockers.push({ pageId: page.pageId, code: error.code });
      for (const attachmentId of resolved.attachmentIds) referencedIds.add(attachmentId);
      syncPages.push({
        pageId: page.pageId,
        folderId: page.folderId,
        path: v3PagePath(page.path),
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
    assertSyncV3CandidateHardLimits(candidate);
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
    changes: Array<PageChange | StructuralPageChange>,
    origin: RevisionOrigin,
  ): Promise<SyncV3RevisionWriteResult | null> {
    const inspection = await this.inspectLiveCurrentLocked(tx, spaceId);
    if (inspection.mode === 'legacy_v2') return null;
    const blocker = inspection.blockers[0];
    if (inspection.mode === 'bootstrap_required' && changes.length === 0) {
      if (blocker) {
        throw new SyncApiException(
          blocker.code,
          'Page attachment reference cannot be resolved',
          undefined,
          '3',
        );
      }
      throw new SyncApiException(
        'ATTACHMENT_CONTENT_INVALID',
        'Sync v3 bootstrap requires an explicit Page change or confirmation',
        undefined,
        '3',
      );
    }
    this.assertChangesApplied(inspection.candidate, changes);
    if (blocker) {
      throw new SyncApiException(blocker.code, 'Page attachment reference cannot be resolved', undefined, '3');
    }
    return this.advanceV3Locked(tx, spaceId, inspection.candidate, origin);
  }

  private assertChangesApplied(
    candidate: SyncV3Candidate,
    changes: Array<PageChange | StructuralPageChange>,
  ): void {
    const pages = new Map(candidate.pages.map((page) => [page.pageId, page]));
    for (const change of changes) {
      const page = pages.get(change.pageId);
      if (change.operation === 'archive') {
        if (!page) continue;
      } else if (
        page
        && change.path !== undefined
        && page.path === v3PagePath(change.path)
        && change.title !== undefined
        && page.title === change.title
        && change.body !== undefined
        && page.body === normalizeMarkdown(change.body)
        && (!('folderId' in change) || page.folderId === change.folderId)
      ) {
        continue;
      }
      throw new SyncApiException(
        'ATTACHMENT_CONTENT_INVALID',
        'Declared Page change is not reflected in the locked Space state',
        undefined,
        '3',
      );
    }
  }

  async advanceV3Locked(
    tx: SpaceLockedTransaction,
    spaceId: string,
    candidateInput: SyncV3Candidate,
    origin: RevisionOrigin,
  ): Promise<SyncV3RevisionWriteResult> {
    assertSyncV3CandidateHardLimits(candidateInput);
    try {
      for (const folder of candidateInput.folders) SyncFolderV3Schema.parse(folder);
      for (const page of candidateInput.pages) SyncPageV3Schema.parse(page);
      for (const attachment of candidateInput.attachments) SyncAttachmentV3Schema.parse(attachment);
    } catch {
      throw new SyncApiException(
        'ATTACHMENT_CONTENT_INVALID',
        'Candidate manifest is invalid',
        undefined,
        '3',
      );
    }
    const resolverCandidates = candidateInput.attachments.map((attachment) => {
      const name = normalizeAttachmentName(attachmentName(attachment.path));
      return { id: attachment.attachmentId, ...name };
    });
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
      select: { id: true, sequence: true, schemaVersion: true, recipeVersion: true },
    });
    assertSupportedRevisionHead(latest);
    const parentManifest = latest && isSyncV3RevisionFormat(latest)
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
    const versionKey = (attachmentId: string, hash: string) => `${attachmentId}:${hash}`;
    const loadedVersions = candidate.attachments.length === 0 ? [] : await tx.attachmentVersion.findMany({
      where: { OR: candidate.attachments.map((attachment) => ({
        attachmentId: attachment.attachmentId,
        contentHash: attachment.contentHash,
      })) },
    });
    const versionsByKey = new Map(loadedVersions.map((version) => [
      versionKey(version.attachmentId, version.contentHash),
      version,
    ]));
    const attachmentVersions = new Map<string, string>();
    const missingVersions: Array<{
      attachmentId: string;
      contentHash: string;
      storageKey: string;
      mimeType: string;
      sizeBytes: bigint;
      width: number;
      height: number;
    }> = [];
    for (const attachment of candidate.attachments) {
      const active = activeById.get(attachment.attachmentId)!;
      const name = normalizeAttachmentName(attachmentName(attachment.path));
      if (
        active.displayName !== name.displayName
        || active.nameKey !== name.nameKey
        || active.contentHash !== attachment.contentHash
        || active.mimeType !== attachment.mimeType
        || active.sizeBytes.toString() !== attachment.sizeBytes
        || active.width !== attachment.width
        || active.height !== attachment.height
        || active.updatedAt.toISOString() !== attachment.updatedAt
        || active.storageKey.length === 0
      ) {
        throw new SyncApiException(
          'ATTACHMENT_CONTENT_INVALID',
          'Candidate attachment is not reflected in the active Space state',
          undefined,
          '3',
        );
      }
      const version = versionsByKey.get(versionKey(attachment.attachmentId, attachment.contentHash));
      if (!version) {
        missingVersions.push({
          attachmentId: attachment.attachmentId,
          contentHash: attachment.contentHash,
          storageKey: active.storageKey,
          mimeType: attachment.mimeType,
          sizeBytes: BigInt(attachment.sizeBytes),
          width: attachment.width,
          height: attachment.height,
        });
      } else if (
        version.contentHash !== attachment.contentHash
        || version.storageKey !== active.storageKey
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
      await this.assertBlobReadable(active.storageKey);
      if (version) attachmentVersions.set(attachment.attachmentId, version.id);
    }
    if (missingVersions.length > 0) {
      await writeBatches(missingVersions, (data) => tx.attachmentVersion.createMany({
        data,
        skipDuplicates: true,
      }));
      const createdVersions = await tx.attachmentVersion.findMany({
        where: { OR: missingVersions.map(({ attachmentId, contentHash: hash }) => ({
          attachmentId,
          contentHash: hash,
        })) },
      });
      for (const version of createdVersions) {
        attachmentVersions.set(version.attachmentId, version.id);
      }
      if (attachmentVersions.size !== candidate.attachments.length) {
        throw new SyncApiException(
          'ATTACHMENT_BLOB_MISSING',
          'Candidate attachment version could not be persisted',
          undefined,
          '3',
        );
      }
    }

    if (candidate.pages.length > 0) {
      const contentRows = candidate.pages.map((page) => ({
          contentHash: page.contentHash,
          body: page.body,
          byteLength: encoder.encode(page.body).byteLength,
      }));
      await writeBatches(contentRows, (data) => tx.syncPageContentRow.createMany({
        data,
        skipDuplicates: true,
      }));
      const legacyBodyRows = candidate.pages.map((page) => ({
        contentHash: page.contentHash,
        body: page.body,
      }));
      await writeBatches(legacyBodyRows, (data) => tx.legacyPageBodyRow.createMany({
        data,
        skipDuplicates: true,
      }));
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
      schemaVersion: SYNC_V3_SCHEMA_VERSION,
      recipeVersion: SYNC_V3_RECIPE_VERSION,
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
      const folderRows = candidate.folders.map((folder) => ({
        revisionId: created.id,
        folderId: folder.folderId,
        parentFolderId: folder.parentFolderId,
        name: folder.name,
        path: folder.path,
        pathKey: pathKey(folder.path),
        sortOrder: folder.sortOrder,
        updatedAt: new Date(folder.updatedAt),
      }));
      await writeBatches(folderRows, (data) => tx.syncRevisionFolderRow.createMany({ data }));
    }
    if (candidate.pages.length > 0) {
      const pageRows = candidate.pages.map((page) => ({
        revisionId: created.id,
        pageId: page.pageId,
        folderId: page.folderId,
        path: page.path,
        pathKey: pathKey(page.path),
        title: page.title,
        contentHash: page.contentHash,
        updatedAt: new Date(page.updatedAt),
      }));
      await writeBatches(pageRows, (data) => tx.syncRevisionPageRow.createMany({ data }));
      const pageExtraRows = candidate.pages.map((page, ordinal) => ({
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
      }));
      await writeBatches(pageExtraRows, (data) => tx.legacyRevisionPageExtra.createMany({ data }));
    }
    if (candidate.attachments.length > 0) {
      const attachmentRows = candidate.attachments.map((attachment, ordinal) => ({
        revisionId: created.id,
        attachmentId: attachment.attachmentId,
        attachmentVersionId: attachmentVersions.get(attachment.attachmentId)!,
        spaceId,
        path: attachment.path,
        pathKey: pathKey(attachment.path),
        ordinal,
      }));
      await writeBatches(attachmentRows, (data) => tx.syncRevisionAttachmentRow.createMany({ data }));
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
      const deltaRows = representableDelta.map((row, ordinal) => ({
        revisionId: created.id, ordinal, ...row,
      }));
      await writeBatches(deltaRows, (data) => tx.syncRevisionTreeDeltaRow.createMany({ data }));
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

  private async assertBlobReadable(storageKey: string): Promise<void> {
    try {
      const stream = await this.storage.open(storageKey);
      const destroy = (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy;
      if (typeof destroy === 'function') destroy.call(stream);
    } catch {
      throw new SyncApiException(
        'ATTACHMENT_BLOB_MISSING',
        'Candidate attachment content is not readable',
        undefined,
        '3',
      );
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
