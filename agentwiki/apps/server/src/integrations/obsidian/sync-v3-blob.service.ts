import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import type {
  BlobChunkReceiptV3,
  CompletedBlobV3,
  SyncAttachmentV3,
} from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../../database/prisma.service';
import {
  ATTACHMENT_CONFIG,
  type AttachmentConfig,
} from '../../attachments/attachment.config';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../../attachments/attachment-storage';
import {
  AttachmentValidationError,
  validateStagedImage,
} from '../../attachments/attachment-validator';
import type { HumanDevicePrincipal } from './human-device.guard';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { SyncApiException } from './sync-error';
import {
  SyncV3BlobStorage,
  SyncV3BlobStorageError,
  type StagedBlobChunk,
} from './sync-v3-blob.storage';

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const ALLOWED_MIME_TYPES = new Set<SyncAttachmentV3['mimeType']>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

interface BlobSessionRow {
  sessionId: string;
  contentHash: string;
  sizeBytes: bigint;
  mimeType: string;
  width: number;
  height: number;
  status: string;
  storageKey: string | null;
  verifiedAt: Date | null;
  session: {
    id: string;
    protocolVersion: string;
    credentialFamilyId: string;
    credentialId: string;
    userId: string;
    spaceId: string;
    status: string;
    transferBlobBytes: bigint;
    expiresAt: Date;
  };
  chunks?: Array<{
    sessionId: string;
    contentHash: string;
    chunkIndex: number;
    chunkHash: string;
    sizeBytes: number;
    receipt: string;
  }>;
}

interface CompleteBlobInput {
  sizeBytes: string;
  chunkCount: number;
}

export interface RevisionAttachmentDownload {
  stream: Readable;
  mimeType: SyncAttachmentV3['mimeType'];
  sizeBytes: number;
}

@Injectable()
export class SyncV3BlobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staging: SyncV3BlobStorage,
    @Inject(ATTACHMENT_STORAGE) private readonly attachmentStorage: AttachmentStorage,
    @Inject(ATTACHMENT_CONFIG) private readonly attachmentConfig: AttachmentConfig,
    private readonly capabilities: SyncCapabilitiesService,
  ) {}

  async putChunk(
    principal: HumanDevicePrincipal,
    spaceId: string,
    sessionId: string,
    contentHash: string,
    chunkIndex: number,
    input: AsyncIterable<Uint8Array>,
  ): Promise<BlobChunkReceiptV3> {
    const limits = this.capabilities.capabilitiesV3();
    this.assertHash(contentHash);
    if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= limits.maxBlobChunks) {
      throw this.error('ATTACHMENT_QUOTA_EXCEEDED', 'Blob chunk index exceeds the negotiated limit');
    }
    const initial = await this.loadBoundBlob(
      this.prisma,
      principal,
      spaceId,
      sessionId,
      contentHash,
      false,
    );
    this.assertBlobLimits(initial, limits);
    const existingBefore = await this.prisma.pushSessionBlobChunk.findUnique({
      where: { sessionId_contentHash_chunkIndex: { sessionId, contentHash, chunkIndex } },
    });
    if (initial.status === 'verified' && !existingBefore) {
      throw this.error('PUSH_SESSION_STATE_INVALID', 'Verified Blob does not accept new chunks');
    }
    if (initial.session.status !== 'uploading' && !existingBefore) {
      throw this.error('PUSH_SESSION_STATE_INVALID', 'Push session does not accept new Blob chunks');
    }

    let staged: { chunkHash: string; sizeBytes: number };
    try {
      staged = await this.staging.putChunk(
        sessionId,
        contentHash,
        chunkIndex,
        input,
        limits.blobChunkBytes,
      );
    } catch (error) {
      throw this.mapStorageError(error);
    }

    const receipt = randomUUID();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT "id" FROM "PushSession" WHERE "id" = ${sessionId} FOR UPDATE`;
        const current = await this.loadBoundBlob(
          tx,
          principal,
          spaceId,
          sessionId,
          contentHash,
          true,
        );
        this.assertBlobLimits(current, limits);
        const existing = await tx.pushSessionBlobChunk.findUnique({
          where: { sessionId_contentHash_chunkIndex: { sessionId, contentHash, chunkIndex } },
        });
        if (existing) {
          if (existing.chunkHash !== staged.chunkHash || existing.sizeBytes !== staged.sizeBytes) {
            throw this.error(
              'ATTACHMENT_CONTENT_INVALID',
              'Blob chunk index already contains different bytes',
            );
          }
          return this.chunkReceipt(existing);
        }
        this.assertChunkUploadSession(current);
        if (current.status === 'verified') {
          throw this.error('PUSH_SESSION_STATE_INVALID', 'Verified Blob does not accept new chunks');
        }
        const receivedBytes = (current.chunks ?? []).reduce(
          (sum, chunk) => sum + BigInt(chunk.sizeBytes),
          0n,
        );
        if (receivedBytes + BigInt(staged.sizeBytes) > current.sizeBytes) {
          throw this.error(
            'ATTACHMENT_CONTENT_INVALID',
            'Blob chunks exceed the required content size',
          );
        }
        const sessionBytes = await tx.pushSessionBlobChunk.aggregate({
          where: { sessionId },
          _sum: { sizeBytes: true },
        });
        const actualTransferBytes = BigInt(sessionBytes._sum.sizeBytes ?? 0);
        const sessionTransferLimit = current.session.transferBlobBytes < BigInt(limits.maxTransferBlobBytes)
          ? current.session.transferBlobBytes
          : BigInt(limits.maxTransferBlobBytes);
        if (actualTransferBytes + BigInt(staged.sizeBytes) > sessionTransferLimit) {
          throw this.error(
            'ATTACHMENT_QUOTA_EXCEEDED',
            'Blob chunks exceed the Push Session transfer limit',
          );
        }
        const created = await tx.pushSessionBlobChunk.create({
          data: {
            sessionId,
            contentHash,
            chunkIndex,
            chunkHash: staged.chunkHash,
            sizeBytes: staged.sizeBytes,
            receipt,
          },
        });
        return this.chunkReceipt(created);
      }, { isolationLevel: 'ReadCommitted' });
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'P2002') {
        return this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT "id" FROM "PushSession" WHERE "id" = ${sessionId} FOR UPDATE`;
          await this.loadBoundBlob(
            tx,
            principal,
            spaceId,
            sessionId,
            contentHash,
            false,
          );
          const raced = await tx.pushSessionBlobChunk.findUnique({
            where: { sessionId_contentHash_chunkIndex: { sessionId, contentHash, chunkIndex } },
          });
          if (
            raced
            && raced.chunkHash === staged.chunkHash
            && raced.sizeBytes === staged.sizeBytes
          ) return this.chunkReceipt(raced);
          throw this.error(
            'ATTACHMENT_CONTENT_INVALID',
            'Blob chunk index already contains different bytes',
          );
        }, { isolationLevel: 'ReadCommitted' });
      }
      throw error;
    }
  }

  async complete(
    principal: HumanDevicePrincipal,
    spaceId: string,
    sessionId: string,
    contentHash: string,
    input: CompleteBlobInput,
  ): Promise<CompletedBlobV3> {
    const limits = this.capabilities.capabilitiesV3();
    this.assertHash(contentHash);
    const expectedSize = this.decimalBytes(input.sizeBytes);
    const initial = await this.loadBoundBlob(
      this.prisma,
      principal,
      spaceId,
      sessionId,
      contentHash,
      true,
    );
    this.assertBlobLimits(initial, limits);
    if (
      input.chunkCount <= 0
      || input.chunkCount > limits.maxBlobChunks
      || expectedSize !== initial.sizeBytes
    ) {
      throw this.error('ATTACHMENT_CONTENT_INVALID', 'Blob completion declaration is inconsistent');
    }
    if (initial.status === 'verified') {
      return this.completedVerifiedBlob(initial);
    }
    const chunks = [...(initial.chunks ?? [])].sort((left, right) => left.chunkIndex - right.chunkIndex);
    if (
      chunks.length !== input.chunkCount
      || chunks.some((chunk, index) => chunk.chunkIndex !== index)
      || chunks.reduce((sum, chunk) => sum + BigInt(chunk.sizeBytes), 0n) !== expectedSize
    ) {
      throw this.error('ATTACHMENT_CONTENT_INVALID', 'Blob chunks are incomplete or non-contiguous');
    }

    const reservation = await this.attachmentStorage.createReservedTempPath(
      expectedSize,
      this.attachmentConfig.minFreeBytes,
    );
    let published = false;
    try {
      let combined: { contentHash: string; sizeBytes: number };
      try {
        combined = await this.staging.combineChunks(
          sessionId,
          contentHash,
          chunks satisfies StagedBlobChunk[],
          reservation.path,
          Math.min(limits.maxAttachmentBytes, Number(this.attachmentConfig.maxFileBytes)),
        );
      } catch (error) {
        throw this.mapStorageError(error);
      }
      if (
        combined.contentHash !== contentHash
        || BigInt(combined.sizeBytes) !== expectedSize
      ) {
        throw this.error('ATTACHMENT_CONTENT_INVALID', 'Combined Blob hash or size is invalid');
      }
      let prepared;
      try {
        prepared = await validateStagedImage({
          originalname: this.validationFilename(initial.mimeType),
          mimetype: initial.mimeType,
          path: reservation.path,
        }, {
          ...this.attachmentConfig,
          maxFileBytes: BigInt(Math.min(
            limits.maxAttachmentBytes,
            Number(this.attachmentConfig.maxFileBytes),
          )),
          maxDimension: Math.min(limits.maxImageDimension, this.attachmentConfig.maxDimension),
          maxPixels: BigInt(Math.min(
            limits.maxDecodedPixels,
            Number(this.attachmentConfig.maxPixels),
          )),
        });
      } catch (error) {
        if (error instanceof AttachmentValidationError) {
          throw this.error('ATTACHMENT_CONTENT_INVALID', 'Blob image validation failed');
        }
        throw error;
      }
      if (
        prepared.contentHash !== contentHash
        || prepared.sizeBytes !== initial.sizeBytes
        || prepared.mimeType !== initial.mimeType
        || prepared.width !== initial.width
        || prepared.height !== initial.height
      ) {
        throw this.error('ATTACHMENT_CONTENT_INVALID', 'Blob metadata does not match its requirement');
      }
      const stored = await this.attachmentStorage.withContentLock(contentHash, (lease) => (
        this.attachmentStorage.publish(reservation, contentHash, expectedSize, lease)
      ));
      published = true;
      const verifiedAt = new Date();
      const completed = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT "id" FROM "PushSession" WHERE "id" = ${sessionId} FOR UPDATE`;
        const current = await this.loadBoundBlob(
          tx,
          principal,
          spaceId,
          sessionId,
          contentHash,
          true,
        );
        if (current.status === 'verified') return this.completedVerifiedBlob(current);
        const updated = await tx.pushSessionBlob.update({
          where: { sessionId_contentHash: { sessionId, contentHash } },
          data: { status: 'verified', storageKey: stored.storageKey, verifiedAt },
        });
        return this.completedBlob(updated);
      }, { isolationLevel: 'ReadCommitted' });
      void this.staging.cleanupBlob(sessionId, contentHash).catch(() => undefined);
      return completed;
    } finally {
      if (!published) {
        await this.attachmentStorage.releaseTempReservation(reservation).catch(() => undefined);
      }
    }
  }

  async openRevisionAttachment(
    principal: HumanDevicePrincipal,
    spaceId: string,
    revisionId: string,
    attachmentId: string,
  ): Promise<RevisionAttachmentDownload> {
    if (revisionId === 'current') {
      throw this.error('PAYLOAD_INVALID', 'A fixed revision is required');
    }
    const version = await this.prisma.$transaction(async (tx) => {
      await this.assertLiveCredential(tx, principal);
      await this.assertReadableSpace(tx, principal, spaceId);
      const revision = await tx.spaceKnowledgeRevision.findFirst({
        where: { id: revisionId, spaceId },
        select: { id: true, spaceId: true },
      });
      if (!revision) {
        throw this.error('ATTACHMENT_MISSING', 'Attachment is not part of the requested revision');
      }
      const row = await tx.syncRevisionAttachmentRow.findUnique({
        where: { revisionId_attachmentId: { revisionId, attachmentId } },
        include: {
          attachment: { select: { id: true, spaceId: true } },
          attachmentVersion: true,
        },
      });
      if (
        !row
        || row.spaceId !== spaceId
        || row.revisionId !== revision.id
        || row.attachmentId !== attachmentId
        || row.attachment.id !== attachmentId
        || row.attachment.spaceId !== spaceId
        || row.attachmentVersionId !== row.attachmentVersion.id
        || row.attachmentVersion.attachmentId !== attachmentId
      ) {
        throw this.error('ATTACHMENT_MISSING', 'Attachment is not part of the requested revision');
      }
      return row.attachmentVersion;
    }, { isolationLevel: 'RepeatableRead' });
    if (
      !HASH_PATTERN.test(version.contentHash)
      || !version.storageKey
      || !ALLOWED_MIME_TYPES.has(version.mimeType as SyncAttachmentV3['mimeType'])
      || version.sizeBytes <= 0n
      || version.sizeBytes > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw this.error('ATTACHMENT_BLOB_MISSING', 'Immutable attachment Blob is unavailable');
    }
    try {
      const stream = await this.attachmentStorage.openVerified(
        version.storageKey,
        version.contentHash,
        version.sizeBytes,
      );
      return {
        stream: stream as Readable,
        mimeType: version.mimeType as SyncAttachmentV3['mimeType'],
        sizeBytes: Number(version.sizeBytes),
      };
    } catch {
      throw this.error('ATTACHMENT_BLOB_MISSING', 'Immutable attachment Blob is unavailable');
    }
  }

  private async loadBoundBlob(
    db: any,
    principal: HumanDevicePrincipal,
    spaceId: string,
    sessionId: string,
    contentHash: string,
    includeChunks: boolean,
  ): Promise<BlobSessionRow> {
    await this.assertLiveCredential(db, principal);
    const blob = await db.pushSessionBlob.findUnique({
      where: { sessionId_contentHash: { sessionId, contentHash } },
      include: { session: true, ...(includeChunks ? { chunks: { orderBy: { chunkIndex: 'asc' } } } : {}) },
    }) as BlobSessionRow | null;
    if (
      !blob
      || blob.session.protocolVersion !== '3'
      || blob.session.id !== sessionId
      || blob.session.spaceId !== spaceId
      || blob.session.userId !== principal.userId
      || blob.session.credentialFamilyId !== principal.credentialFamilyId
      || blob.session.credentialId !== principal.credentialId
      || blob.contentHash !== contentHash
    ) {
      throw this.error('PUSH_SESSION_NOT_FOUND', 'Push session Blob requirement was not found');
    }
    if (blob.session.expiresAt <= new Date()) {
      throw this.error('PUSH_SESSION_EXPIRED', 'Push session has expired');
    }
    if (!['uploading', 'ready_to_finalize'].includes(blob.session.status)) {
      throw this.error('PUSH_SESSION_STATE_INVALID', 'Push session does not accept Blob transfer');
    }
    if (!['uploading', 'verified'].includes(blob.status)) {
      throw this.error('PUSH_SESSION_STATE_INVALID', 'Blob requirement is not transferable');
    }
    return blob;
  }

  private async assertLiveCredential(db: any, principal: HumanDevicePrincipal): Promise<void> {
    const credential = await db.humanDeviceCredential.findUnique({
      where: { id: principal.credentialId },
      include: { user: { select: {
        deletedAt: true,
        lockedAt: true,
        type: true,
        platformRole: true,
      } } },
    });
    if (
      !credential
      || credential.id !== principal.credentialId
      || credential.credentialFamilyId !== principal.credentialFamilyId
      || credential.userId !== principal.userId
      || credential.deviceId !== principal.deviceId
      || credential.vaultId !== principal.vaultId
    ) {
      throw this.error('DEVICE_CREDENTIAL_REVOKED', 'Device credential is no longer valid');
    }
    if (credential.user.deletedAt || credential.user.lockedAt || credential.user.type !== 'human') {
      throw this.error('USER_INACTIVE', 'User account is unavailable');
    }
    if (credential.status === 'provisional') {
      if (!credential.provisionalExpiresAt || credential.provisionalExpiresAt <= new Date()) {
        throw this.error('DEVICE_CREDENTIAL_EXPIRED', 'Device credential has expired');
      }
    } else if (credential.status === 'expired') {
      throw this.error('DEVICE_CREDENTIAL_EXPIRED', 'Device credential has expired');
    } else if (credential.status !== 'active') {
      throw this.error('DEVICE_CREDENTIAL_REVOKED', 'Device credential is not active');
    }
  }

  private async assertReadableSpace(
    db: any,
    principal: HumanDevicePrincipal,
    spaceId: string,
  ): Promise<void> {
    const space = await db.space.findUnique({
      where: { id: spaceId },
      select: { id: true, deletedAt: true },
    });
    if (!space || space.deletedAt) {
      throw this.error('SPACE_FORBIDDEN', 'Space is not accessible');
    }
    if (principal.platformRole === 'super_admin') return;
    const member = await db.spaceMember.findUnique({
      where: { userId_spaceId: { userId: principal.userId, spaceId } },
      select: { role: true },
    });
    if (!member) throw this.error('SPACE_FORBIDDEN', 'Space is not accessible');
  }

  private assertBlobLimits(blob: BlobSessionRow, limits: ReturnType<SyncCapabilitiesService['capabilitiesV3']>): void {
    if (
      blob.sizeBytes <= 0n
      || blob.sizeBytes > BigInt(limits.maxAttachmentBytes)
      || blob.sizeBytes > this.attachmentConfig.maxFileBytes
      || blob.session.transferBlobBytes < blob.sizeBytes
      || blob.session.transferBlobBytes > BigInt(limits.maxTransferBlobBytes)
      || !ALLOWED_MIME_TYPES.has(blob.mimeType as SyncAttachmentV3['mimeType'])
      || !limits.allowedMimeTypes.includes(blob.mimeType as SyncAttachmentV3['mimeType'])
      || !Number.isSafeInteger(blob.width)
      || !Number.isSafeInteger(blob.height)
      || blob.width <= 0
      || blob.height <= 0
      || blob.width > Math.min(limits.maxImageDimension, this.attachmentConfig.maxDimension)
      || blob.height > Math.min(limits.maxImageDimension, this.attachmentConfig.maxDimension)
      || BigInt(blob.width) * BigInt(blob.height) > BigInt(Math.min(
        limits.maxDecodedPixels,
        Number(this.attachmentConfig.maxPixels),
      ))
    ) {
      throw this.error('ATTACHMENT_QUOTA_EXCEEDED', 'Blob requirement exceeds negotiated limits');
    }
  }

  private assertChunkUploadSession(blob: BlobSessionRow): void {
    if (blob.session.status !== 'uploading') {
      throw this.error('PUSH_SESSION_STATE_INVALID', 'Push session does not accept Blob chunks');
    }
  }

  private completedVerifiedBlob(blob: BlobSessionRow): CompletedBlobV3 {
    if (!blob.storageKey || !blob.verifiedAt) {
      throw this.error('ATTACHMENT_BLOB_MISSING', 'Verified Blob metadata is incomplete');
    }
    return this.completedBlob(blob);
  }

  private completedBlob(blob: {
    contentHash: string;
    sizeBytes: bigint;
    mimeType: string;
    width: number;
    height: number;
    verifiedAt: Date | null;
  }): CompletedBlobV3 {
    if (!blob.verifiedAt || !ALLOWED_MIME_TYPES.has(blob.mimeType as SyncAttachmentV3['mimeType'])) {
      throw this.error('ATTACHMENT_BLOB_MISSING', 'Verified Blob metadata is incomplete');
    }
    return {
      contentHash: blob.contentHash,
      sizeBytes: blob.sizeBytes.toString(),
      mimeType: blob.mimeType as SyncAttachmentV3['mimeType'],
      width: blob.width,
      height: blob.height,
      verifiedAt: blob.verifiedAt.toISOString(),
    };
  }

  private chunkReceipt(chunk: {
    contentHash: string;
    chunkIndex: number;
    chunkHash: string;
    receipt: string;
  }): BlobChunkReceiptV3 {
    return {
      contentHash: chunk.contentHash,
      chunkIndex: chunk.chunkIndex,
      chunkHash: chunk.chunkHash,
      receipt: chunk.receipt,
    };
  }

  private decimalBytes(value: string): bigint {
    if (!/^(0|[1-9][0-9]*)$/u.test(value)) {
      throw this.error('PAYLOAD_INVALID', 'Blob size must be a canonical decimal string');
    }
    return BigInt(value);
  }

  private assertHash(contentHash: string): void {
    if (!HASH_PATTERN.test(contentHash)) {
      throw this.error('PAYLOAD_INVALID', 'Invalid Blob content hash');
    }
  }

  private validationFilename(mimeType: string): string {
    return ({
      'image/png': 'blob.png',
      'image/jpeg': 'blob.jpg',
      'image/webp': 'blob.webp',
      'image/gif': 'blob.gif',
    } as Record<string, string>)[mimeType] ?? 'blob.invalid';
  }

  private mapStorageError(error: unknown): SyncApiException {
    if (error instanceof SyncV3BlobStorageError) {
      return this.error(error.code, 'Blob staging validation failed');
    }
    if (error instanceof SyncApiException) return error;
    return this.error('ATTACHMENT_CONTENT_INVALID', 'Blob staging validation failed');
  }

  private error(
    code: ConstructorParameters<typeof SyncApiException>[0],
    message: string,
  ): SyncApiException {
    return new SyncApiException(code, message, undefined, '3');
  }
}
