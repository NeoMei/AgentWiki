import { unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, SpaceAttachmentStatus, type SpaceAttachment } from '@prisma/client';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';
import { PrismaService } from '../database/prisma.service';
import type { AttachmentConfig } from './attachment.config';
import { type AttachmentListQueryDto, type AttachmentStateDto, type AttachmentSummary } from './attachment.dto';
import {
  ATTACHMENT_STORAGE,
  type AttachmentContentLease,
  type AttachmentStorage,
  type StoredAttachment,
} from './attachment-storage';
import { validateUploadedImage, type PreparedAttachment } from './attachment-validator';

export const ATTACHMENT_CONFIG = 'ATTACHMENT_CONFIG';

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

export function normalizeAttachmentName(value: string): { displayName: string; nameKey: string } {
  const displayName = value.normalize('NFC').trim();
  return { displayName, nameKey: displayName.toLocaleLowerCase('und') };
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

@Injectable()
export class AttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly revisionWriter: SpaceRevisionWriterService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
    @Inject(ATTACHMENT_CONFIG) private readonly config: AttachmentConfig,
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
    try {
      await this.assertWritableHuman(this.prisma, principal, spaceId);
      const prepared = await validateUploadedImage({
        ...file,
        originalname: file.originalname.normalize('NFC').trim(),
      }, this.config);
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
        ),
      );
    } finally {
      if (file?.path) {
        await unlink(file.path).catch((error: unknown) => {
          if (!isNodeError(error, 'ENOENT')) throw error;
        });
      }
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
  ): Promise<AttachmentSummary> {
    let stored: StoredAttachment | undefined;
    try {
      stored = await this.storage.publish(
        prepared.tempPath,
        prepared.contentHash,
        prepared.sizeBytes,
        lease,
      );
      const attachment = await this.prisma.$transaction(async (tx) => {
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
      await this.revisionWriter.lockSpace(tx, spaceId);
      await this.assertWritableHuman(tx, principal, spaceId);

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
