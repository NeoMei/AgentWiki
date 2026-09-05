import { extname, posix } from 'node:path';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, SpaceAttachmentStatus, type SpaceAttachment } from '@prisma/client';
import { FlatAttachmentPathSchema } from '@neomei/agentwiki-sync-protocol';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';
import { SearchService } from '../core/search/search.service';
import { GraphMaintenance } from '../knowledge-graph/graph-maintenance';
import { isSyncV3RevisionFormat } from '../core/sync/sync-revision-format';
import { PrismaService } from '../database/prisma.service';
import { ATTACHMENT_CONFIG, type AttachmentConfig } from './attachment.config';
import {
  type AttachmentListQueryDto,
  type AttachmentRenameConfirmDto,
  type AttachmentRenamePreview,
  type AttachmentRenamePreviewDto,
  type AttachmentStateDto,
  type AttachmentSummary,
} from './attachment.dto';
import {
  ATTACHMENT_STORAGE,
  type AttachmentContentLease,
  type AttachmentStorage,
  type AttachmentTempReservation,
  type StoredUpload,
  type StoredAttachment,
} from './attachment-storage';
import {
  AttachmentValidationError,
  validateAttachmentFilename,
  validateUploadedImage,
  type PreparedAttachment,
} from './attachment-validator';
import { normalizeAttachmentName } from './attachment-name';
import {
  parseImageReferences,
  resolveParsedAttachmentReferences,
  rewriteAttachmentReferenceRanges,
  type ParsedImageReference,
} from '../markdown-resources/attachment-reference';

const READ_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
const WRITE_ROLES = ['owner', 'editor'] as const;
const MAX_FILENAME_CODE_POINTS = 200;
const MAX_FILENAME_UTF8_BYTES = 512;

type AttachmentRow = Pick<
  SpaceAttachment,
  | 'id'
  | 'spaceId'
  | 'displayName'
  | 'mimeType'
  | 'sizeBytes'
  | 'width'
  | 'height'
  | 'status'
  | 'uploadedByUserId'
  | 'createdAt'
  | 'updatedAt'
  | 'archivedAt'
>;

type RenamePage = {
  id: string;
  knowledgeKey: string;
  title: string;
  content: string;
  authorId: string;
  slug: string;
  format: string;
  parentId: string | null;
  folderId: string | null;
  syncPath: string;
  syncPathKey: string;
  updatedAt: Date;
};

type RenamePageChange = { page: RenamePage; content: string };

const MIME_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

export interface AttachmentContent {
  stream: NodeJS.ReadableStream;
  mimeType: string;
  sizeBytes: bigint;
  displayName: string;
  contentHash: string;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as NodeJS.ErrnoException).code === code;
}

function attachCleanupFailure(primary: unknown, cleanup: unknown): void {
  if (typeof primary !== 'object' || primary === null) return;
  try {
    const error = primary as { cause?: unknown; attachmentCleanupError?: unknown };
    if (error.cause === undefined) error.cause = cleanup;
    else error.attachmentCleanupError = cleanup;
  } catch {
    // Preserve a frozen transaction error as the primary failure.
  }
}

function suffixedName(displayName: string, suffix: number): string {
  const extension = extname(displayName);
  const stem = extension ? displayName.slice(0, -extension.length) : displayName;
  const ending = ` (${suffix})${extension}`;
  const availableCodePoints = MAX_FILENAME_CODE_POINTS - [...ending].length;
  const availableBytes = MAX_FILENAME_UTF8_BYTES - Buffer.byteLength(ending, 'utf8');
  let boundedStem = '';
  let codePoints = 0;
  let bytes = 0;
  for (const character of stem) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (codePoints + 1 > availableCodePoints || bytes + characterBytes > availableBytes) break;
    boundedStem += character;
    codePoints += 1;
    bytes += characterBytes;
  }
  return `${boundedStem}${ending}`;
}

function attachmentFamilySuffix(
  displayName: string,
  candidateDisplayName: string,
): number | undefined {
  const candidate = candidateDisplayName.normalize('NFC').trim();
  const candidateExtension = extname(candidate);
  const candidateStem = candidateExtension
    ? candidate.slice(0, -candidateExtension.length)
    : candidate;
  const match = / \(([1-9][0-9]*)\)$/.exec(candidateStem);
  if (!match) return undefined;
  const suffix = Number(match[1]);
  if (!Number.isSafeInteger(suffix) || suffix < 2) return undefined;
  const expectedKey = normalizeAttachmentName(suffixedName(displayName, suffix)).nameKey;
  return normalizeAttachmentName(candidate).nameKey === expectedKey ? suffix : undefined;
}

function summary(row: AttachmentRow): AttachmentSummary {
  return {
    id: row.id,
    spaceId: row.spaceId,
    displayName: row.displayName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes.toString(10),
    width: row.width,
    height: row.height,
    status: row.status,
    uploadedByUserId: row.uploadedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function markdownRenameTarget(
  body: string,
  sourceSyncPath: string,
  reference: ParsedImageReference,
  canonicalPath: string,
): string {
  if (reference.syntax === 'obsidian') return canonicalPath;
  const pagePath = sourceSyncPath.normalize('NFC');
  const directory = posix.dirname(pagePath);
  const relative = posix.relative(directory === '.' ? '' : directory, canonicalPath);
  if (body[reference.targetStart - 1] === '<') return relative;
  if (/\\[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/u.test(reference.rawTarget)) {
    return relative.replace(/[()]/gu, '\\$&').replace(/ /gu, '%20');
  }
  return relative.split('/').map((segment) => encodeURIComponent(segment)
    .replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly revisionWriter: SpaceRevisionWriterService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
    @Inject(ATTACHMENT_CONFIG) private readonly config: AttachmentConfig,
    private readonly searchService: SearchService,
    private readonly graphMaintenance: GraphMaintenance,
  ) {}

  async list(
    spaceId: string,
    query: AttachmentListQueryDto,
    principal: Principal,
  ): Promise<{ items: AttachmentSummary[]; total: number; skip: number; take: number }> {
    await this.authorization.assertSpaceAccess(
      principal,
      spaceId,
      [...READ_ROLES],
      'pages:read',
    );
    const q = query.q?.trim();
    const where: Prisma.SpaceAttachmentWhereInput = {
      spaceId,
      ...(query.status === 'all' ? {} : { status: query.status }),
      ...(q ? { displayName: { contains: q, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.spaceAttachment.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.spaceAttachment.count({ where }),
    ]);
    return { items: rows.map(summary), total, skip: query.skip, take: query.take };
  }

  async upload(
    spaceId: string,
    file: Express.Multer.File,
    principal: Principal,
  ): Promise<AttachmentSummary> {
    const reservation = (file as Partial<StoredUpload>).attachmentTempReservation;
    if (!reservation || reservation.path !== file.path) {
      throw new Error('A matching attachment temp reservation is required');
    }
    try {
      await this.assertWritableHuman(this.prisma, principal, spaceId);
      let prepared: PreparedAttachment;
      try {
        prepared = await validateUploadedImage({
          ...file,
          originalname: file.originalname.normalize('NFC').trim(),
        }, this.config);
      } catch (error) {
        if (error instanceof AttachmentValidationError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
      const normalized = normalizeAttachmentName(prepared.displayName);
      const normalizedPrepared = {
        ...prepared,
        ...normalized,
      };
      return await this.storage.withContentLock(
        prepared.contentHash,
        async (lease) => this.uploadWithinContentLease(
          spaceId,
          normalizedPrepared,
          principal,
          lease,
          reservation,
        ),
      );
    } finally {
      await this.storage.releaseTempReservation(reservation);
    }
  }

  async archive(
    spaceId: string,
    attachmentId: string,
    body: AttachmentStateDto,
    principal: Principal,
  ): Promise<AttachmentSummary> {
    return this.changeStatus(
      spaceId,
      attachmentId,
      body,
      principal,
      SpaceAttachmentStatus.active,
      SpaceAttachmentStatus.archived,
    );
  }

  async restore(
    spaceId: string,
    attachmentId: string,
    body: AttachmentStateDto,
    principal: Principal,
  ): Promise<AttachmentSummary> {
    return this.changeStatus(
      spaceId,
      attachmentId,
      body,
      principal,
      SpaceAttachmentStatus.archived,
      SpaceAttachmentStatus.active,
    );
  }

  async previewRename(
    spaceId: string,
    attachmentId: string,
    body: AttachmentRenamePreviewDto,
    principal: Principal,
  ): Promise<AttachmentRenamePreview> {
    await this.assertWritableHuman(this.prisma, principal, spaceId);
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId, deletedAt: null },
      select: { contentTreeRevision: true },
    });
    if (!space) throw new BusinessException('SPACE_NOT_FOUND');
    const attachment = await this.prisma.spaceAttachment.findFirst({
      where: { id: attachmentId, spaceId, status: SpaceAttachmentStatus.active },
    });
    if (!attachment) throw new BusinessException('RESOURCE_NOT_FOUND', 'Attachment not found');
    const target = this.renameTarget(body.displayName, attachment.mimeType);
    await this.assertRenameNameAvailable(this.prisma, spaceId, attachmentId, target.nameKey);
    const pageChanges = await this.buildRenamePageChanges(
      this.prisma, spaceId, attachmentId, target.displayName,
    );
    return {
      attachmentId,
      displayName: target.displayName,
      path: target.path,
      expectedUpdatedAt: attachment.updatedAt.toISOString(),
      expectedTreeRevision: space.contentTreeRevision.toString(10),
      impactedPages: pageChanges.map(({ page }) => ({ id: page.id, title: page.title })),
    };
  }

  async rename(
    spaceId: string,
    attachmentId: string,
    body: AttachmentRenameConfirmDto,
    principal: Principal,
  ): Promise<AttachmentSummary & { path: string; impactedPages: Array<{ id: string; title: string }> }> {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      const lockedTx = await this.revisionWriter.lockContentTreeSpace(tx, spaceId);
      if (!lockedTx) throw new BusinessException('SPACE_NOT_FOUND');
      await this.assertWritableHuman(lockedTx, principal, spaceId);
      if (lockedTx.contentTreeRevision.toString(10) !== body.expectedTreeRevision) {
        throw new BusinessException('CONTENT_TREE_CONFLICT');
      }
      const attachment = await lockedTx.spaceAttachment.findFirst({
        where: { id: attachmentId, spaceId, status: SpaceAttachmentStatus.active },
      });
      if (!attachment) throw new BusinessException('RESOURCE_NOT_FOUND', 'Attachment not found');
      if (attachment.updatedAt.getTime() !== new Date(body.expectedUpdatedAt).getTime()) {
        throw new BusinessException('RESOURCE_CONFLICT', 'Attachment changed; preview again');
      }
      const target = this.renameTarget(body.displayName, attachment.mimeType);
      await this.assertRenameNameAvailable(lockedTx, spaceId, attachmentId, target.nameKey);
      const pageChanges = await this.buildRenamePageChanges(
        lockedTx, spaceId, attachmentId, target.displayName,
      );

      const changedAttachment = await lockedTx.spaceAttachment.updateMany({
        where: {
          id: attachmentId,
          spaceId,
          status: SpaceAttachmentStatus.active,
          updatedAt: attachment.updatedAt,
        },
        data: { displayName: target.displayName, nameKey: target.nameKey },
      });
      if (changedAttachment.count !== 1) {
        throw new BusinessException('RESOURCE_CONFLICT', 'Attachment changed; preview again');
      }

      const changedAt = new Date();
      for (const change of pageChanges) {
        const { page } = change;
        await lockedTx.pageVersion.create({ data: {
          pageId: page.id,
          title: page.title,
          content: page.content,
          authorId: page.authorId,
          slug: page.slug,
          format: page.format,
          parentId: page.parentId,
          folderId: page.folderId,
          syncPath: page.syncPath,
          syncPathKey: page.syncPathKey,
        } });
        const updated = await lockedTx.page.updateMany({
          where: {
            id: page.id,
            spaceId,
            deletedAt: null,
            updatedAt: page.updatedAt,
            content: page.content,
          },
          data: {
            content: change.content,
            lastModifiedByUserId: principal.userId,
            lastModifiedByAgentId: null,
            lastModifiedAt: changedAt,
          },
        });
        if (updated.count !== 1) {
          throw new BusinessException('ATTACHMENT_REFERENCE_INVALID', 'Page changed; preview again');
        }
        await lockedTx.pageSearchDocument.deleteMany({ where: { pageId: page.id } });
      }

      await this.revisionWriter.advanceLocked(lockedTx, spaceId, pageChanges.map(({ page, content }) => ({
        operation: 'upsert' as const,
        pageId: page.knowledgeKey,
        path: page.syncPath,
        title: page.title,
        body: content,
      })), {
        origin: 'web_editor',
        createdByUserId: principal.userId,
      });
      const updatedAttachment = await lockedTx.spaceAttachment.findUnique({ where: { id: attachmentId } });
      if (!updatedAttachment || updatedAttachment.spaceId !== spaceId) {
        throw new BusinessException('RESOURCE_CONFLICT', 'Attachment changed; preview again');
      }
      return {
        ...summary(updatedAttachment),
        path: target.path,
        impactedPages: pageChanges.map(({ page }) => ({ id: page.id, title: page.title })),
      };
    });
    for (const page of result.impactedPages) {
      try {
        await this.searchService.indexPage(page.id);
      } catch (error) {
        this.logger.warn(
          `Attachment rename search refresh failed for ${page.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    try {
      this.graphMaintenance.enqueue(spaceId);
    } catch (error) {
      this.logger.warn(
        `Attachment rename graph refresh failed for ${spaceId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return result;
  }

  async content(attachmentId: string, principal: Principal): Promise<AttachmentContent> {
    const attachment = await this.prisma.spaceAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment) {
      throw new BusinessException('RESOURCE_NOT_FOUND', 'Attachment not found');
    }
    try {
      await this.authorization.assertSpaceAccess(
        principal,
        attachment.spaceId,
        [...READ_ROLES],
        'pages:read',
      );
    } catch (error) {
      if (
        error instanceof BusinessException
        && ['SPACE_ACCESS_DENIED', 'SPACE_NOT_FOUND'].includes(error.businessCode)
      ) {
        throw new BusinessException('RESOURCE_NOT_FOUND', 'Attachment not found');
      }
      throw error;
    }
    let stream: NodeJS.ReadableStream;
    try {
      stream = await this.storage.open(attachment.storageKey);
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        throw new BusinessException('RESOURCE_NOT_FOUND', 'Attachment content is unavailable');
      }
      throw error;
    }
    return {
      stream,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      displayName: attachment.displayName,
      contentHash: attachment.contentHash,
    };
  }

  private async uploadWithinContentLease(
    spaceId: string,
    prepared: PreparedAttachment,
    principal: Principal,
    lease: AttachmentContentLease,
    reservation: AttachmentTempReservation,
  ): Promise<AttachmentSummary> {
    let stored: StoredAttachment | undefined;
    try {
      stored = await this.storage.publish(
        reservation,
        prepared.contentHash,
        prepared.sizeBytes,
        lease,
      );
      const attachment = await this.prisma.$transaction(async (tx) => {
        await this.authorization.lockLiveHumanPrincipal(tx, principal);
        await this.revisionWriter.lockSpace(tx, spaceId);
        const live = await this.assertWritableHuman(tx, principal, spaceId);

        const identical = await tx.spaceAttachment.findFirst({
          where: {
            spaceId,
            nameKey: prepared.nameKey,
            contentHash: prepared.contentHash,
            status: SpaceAttachmentStatus.active,
          },
        });
        if (identical) return identical;

        const reserved = await tx.spaceAttachment.findMany({
          where: { spaceId },
        });
        const reservedByKey = new Map(
          reserved.map((item) => [normalizeAttachmentName(item.nameKey).nameKey, item]),
        );
        const reusableFamilyMatch = reserved
          .map((item) => ({
            item,
            suffix: attachmentFamilySuffix(prepared.displayName, item.displayName),
          }))
          .filter((candidate): candidate is typeof candidate & { suffix: number } => (
            candidate.suffix !== undefined
            && candidate.item.status === SpaceAttachmentStatus.active
            && candidate.item.contentHash === prepared.contentHash
          ))
          .sort((left, right) => left.suffix - right.suffix)[0];
        if (reusableFamilyMatch) return reusableFamilyMatch.item;

        let displayName = prepared.displayName;
        let nameKey = prepared.nameKey;
        for (let suffix = 2; reservedByKey.has(nameKey); suffix += 1) {
          const collision = reservedByKey.get(nameKey)!;
          if (
            collision.status === SpaceAttachmentStatus.active
            && collision.contentHash === prepared.contentHash
          ) {
            return collision;
          }
          ({ displayName, nameKey } = normalizeAttachmentName(
            suffixedName(prepared.displayName, suffix),
          ));
        }

        const active = await tx.spaceAttachment.aggregate({
          where: { spaceId, status: SpaceAttachmentStatus.active },
          _sum: { sizeBytes: true },
        });
        const activeBytes = active._sum.sizeBytes ?? 0n;
        if (activeBytes + prepared.sizeBytes > this.config.maxSpaceBytes) {
          throw new BusinessException(
            'RESOURCE_CONFLICT',
            `Space attachment quota exceeds ${this.config.maxSpaceBytes.toString()} bytes`,
          );
        }

        return tx.spaceAttachment.create({
          data: {
            spaceId,
            displayName,
            nameKey,
            contentHash: prepared.contentHash,
            storageKey: stored!.storageKey,
            mimeType: prepared.mimeType,
            sizeBytes: prepared.sizeBytes,
            width: prepared.width,
            height: prepared.height,
            uploadedByUserId: live.userId,
            status: SpaceAttachmentStatus.active,
          },
        });
      });
      return summary(attachment);
    } catch (error) {
      if (stored?.created) {
        try {
          const references = await this.prisma.spaceAttachment.count({
            where: { storageKey: stored.storageKey },
          });
          if (references === 0) {
            await this.storage.removeIfUnreferenced(stored.storageKey, lease);
          }
        } catch (cleanupError) {
          attachCleanupFailure(error, cleanupError);
        }
      }
      throw error;
    }
  }

  private async changeStatus(
    spaceId: string,
    attachmentId: string,
    body: AttachmentStateDto,
    principal: Principal,
    from: SpaceAttachmentStatus,
    to: SpaceAttachmentStatus,
  ): Promise<AttachmentSummary> {
    return this.prisma.$transaction(async (tx) => {
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      await this.revisionWriter.lockSpace(tx, spaceId);
      await this.assertWritableHuman(tx, principal, spaceId);

      if (to === SpaceAttachmentStatus.archived) {
        await this.assertNotReferencedByCurrentV3(tx, spaceId, attachmentId);
      }

      if (to === SpaceAttachmentStatus.active) {
        const candidate = await tx.spaceAttachment.findUnique({
          where: { id: attachmentId },
          select: { id: true, spaceId: true, status: true, sizeBytes: true },
        });
        if (candidate?.spaceId === spaceId && candidate.status === from) {
          const active = await tx.spaceAttachment.aggregate({
            where: { spaceId, status: SpaceAttachmentStatus.active },
            _sum: { sizeBytes: true },
          });
          if ((active._sum.sizeBytes ?? 0n) + candidate.sizeBytes > this.config.maxSpaceBytes) {
            throw new BusinessException('RESOURCE_CONFLICT', 'Space attachment quota exceeded');
          }
        }
      }

      const archivedAt = to === SpaceAttachmentStatus.archived ? new Date() : null;
      const changed = await tx.spaceAttachment.updateMany({
        where: {
          id: attachmentId,
          spaceId,
          status: from,
          updatedAt: new Date(body.expectedUpdatedAt),
        },
        data: { status: to, archivedAt },
      });
      if (changed.count !== 1) {
        throw new BusinessException('RESOURCE_CONFLICT', 'Attachment changed; reload before retrying');
      }
      const updated = await tx.spaceAttachment.findUnique({ where: { id: attachmentId } });
      if (!updated || updated.spaceId !== spaceId) {
        throw new BusinessException('RESOURCE_CONFLICT', 'Attachment changed; reload before retrying');
      }
      return summary(updated);
    });
  }

  private async assertNotReferencedByCurrentV3(
    tx: Prisma.TransactionClient,
    spaceId: string,
    attachmentId: string,
  ): Promise<void> {
    const current = await tx.spaceKnowledgeRevision.findFirst({
      where: { spaceId },
      orderBy: { sequence: 'desc' },
      select: { id: true, schemaVersion: true, recipeVersion: true },
    });
    if (!current || !isSyncV3RevisionFormat(current)) return;

    const revisionReference = await tx.syncRevisionAttachmentRow.findUnique({
      where: {
        revisionId_attachmentId: { revisionId: current.id, attachmentId },
      },
      select: { attachmentId: true },
    });
    if (!revisionReference) return;

    const sidecar = await tx.legacyRevisionSidecar.findUnique({
      where: { revisionId: current.id },
      select: { sidecar: true },
    });
    const record = sidecar?.sidecar;
    const syncV3 = record && typeof record === 'object' && !Array.isArray(record)
      ? (record as Record<string, unknown>).syncV3Revision
      : undefined;
    const rawPageReferences = syncV3 && typeof syncV3 === 'object' && !Array.isArray(syncV3)
      ? (syncV3 as Record<string, unknown>).pageAttachmentIds
      : undefined;
    const pageKeys = new Set<string>();
    if (Array.isArray(rawPageReferences)) {
      for (const entry of rawPageReferences) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const pageId = (entry as Record<string, unknown>).pageId;
        const referencedAttachmentIds = (entry as Record<string, unknown>).referencedAttachmentIds;
        if (
          typeof pageId === 'string'
          && Array.isArray(referencedAttachmentIds)
          && referencedAttachmentIds.includes(attachmentId)
        ) pageKeys.add(pageId);
      }
    }
    const pages = pageKeys.size === 0 ? [] : await tx.page.findMany({
      where: {
        spaceId,
        deletedAt: null,
        knowledgeKey: { in: [...pageKeys] },
      },
      select: { id: true, title: true },
    });
    const safePages = [...new Map(
      pages.map((page) => [page.id, { id: page.id, title: page.title }]),
    ).values()].sort((left, right) => left.id.localeCompare(right.id));
    throw new BusinessException(
      'ATTACHMENT_REFERENCED',
      undefined,
      { pages: safePages },
    );
  }

  private renameTarget(value: string, mimeType: string) {
    let normalized: { displayName: string; nameKey: string };
    try {
      normalized = validateAttachmentFilename(value.normalize('NFC').trim());
    } catch (error) {
      if (error instanceof AttachmentValidationError) throw new BadRequestException(error.message);
      throw error;
    }
    const path = FlatAttachmentPathSchema.safeParse(`assets/${normalized.displayName}`);
    if (!path.success || MIME_EXTENSION.get(extname(normalized.displayName).toLowerCase()) !== mimeType) {
      throw new BadRequestException('Attachment filename extension must match its image type');
    }
    return { ...normalized, path: path.data };
  }

  private async assertRenameNameAvailable(
    db: Prisma.TransactionClient,
    spaceId: string,
    attachmentId: string,
    nameKey: string,
  ): Promise<void> {
    const conflict = await db.spaceAttachment.findFirst({
      where: { spaceId, nameKey, id: { not: attachmentId } },
      select: { id: true },
    });
    if (conflict) throw new BusinessException('ATTACHMENT_NAME_CONFLICT');
  }

  private async buildRenamePageChanges(
    db: Prisma.TransactionClient,
    spaceId: string,
    attachmentId: string,
    displayName: string,
  ): Promise<RenamePageChange[]> {
    const [attachments, pages] = await Promise.all([
      db.spaceAttachment.findMany({
        where: { spaceId, status: SpaceAttachmentStatus.active },
        select: { id: true, displayName: true, nameKey: true },
      }),
      db.page.findMany({
        where: { spaceId, deletedAt: null },
        select: {
          id: true,
          knowledgeKey: true,
          title: true,
          content: true,
          authorId: true,
          slug: true,
          format: true,
          parentId: true,
          folderId: true,
          syncPath: true,
          syncPathKey: true,
          updatedAt: true,
        },
        orderBy: { id: 'asc' },
      }),
    ]);
    const canonicalPath = `assets/${displayName}`;
    const changes: RenamePageChange[] = [];
    for (const page of pages) {
      const parsed = parseImageReferences(page.content, page.syncPath);
      const resolved = resolveParsedAttachmentReferences(parsed, attachments);
      if (resolved.errors.length > 0) {
        throw new BusinessException(resolved.errors[0].code);
      }
      const references = resolved.references.filter((reference) => reference.attachmentId === attachmentId);
      if (references.length === 0) continue;
      const content = rewriteAttachmentReferenceRanges(page.content, references.map((reference) => ({
        start: reference.targetStart,
        end: reference.targetEnd,
        target: markdownRenameTarget(page.content, page.syncPath, reference, canonicalPath),
      })));
      const verified = resolveParsedAttachmentReferences(
        parseImageReferences(content, page.syncPath),
        attachments.map((attachment) => attachment.id === attachmentId
          ? { ...attachment, displayName, nameKey: normalizeAttachmentName(displayName).nameKey }
          : attachment),
      );
      if (verified.errors.length > 0 || !verified.attachmentIds.includes(attachmentId)) {
        throw new BusinessException('ATTACHMENT_REFERENCE_INVALID');
      }
      changes.push({ page, content });
    }
    return changes;
  }

  private async assertWritableHuman(
    db: Prisma.TransactionClient,
    principal: Principal,
    spaceId: string,
  ) {
    if (principal.agentId) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Agents cannot mutate binary attachments');
    }
    const access = await this.authorization.assertLiveHumanSpaceAccess(
      db,
      principal,
      spaceId,
      [...WRITE_ROLES],
    );
    if (!WRITE_ROLES.includes(access.role as typeof WRITE_ROLES[number])) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Only Space owners and editors can mutate attachments');
    }
    return access;
  }
}
