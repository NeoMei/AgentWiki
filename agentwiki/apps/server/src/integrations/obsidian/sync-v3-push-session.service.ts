import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateTreePushSessionRequestV3Schema,
  TreeFinalizePushRequestV3Schema,
  TreeFinalizePushResponseV3Schema,
  TreePushBatchV3Schema,
  TreePushSessionStatusResponseV3Schema,
  canonicalBytes,
  canonicalTreeDeltaItemsV3,
  canonicalTreeRevisionManifestV3,
  contentHash,
  normalizeMarkdown,
  pathKey,
  treeBatchHashV3,
  treeConfirmationHashV3,
  treeRevisionDeltaV3,
  type CreateTreePushSessionRequestV3,
  type SyncAttachmentV3,
  type SyncFolderV3,
  type SyncPageV3,
  type TreePushBatchV3,
  type TreePushChangeV3,
  type TreePushManifestChangeV3,
} from '@neomei/agentwiki-sync-protocol';
import { z } from 'zod';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../../attachments/attachment-storage';
import { AuthorizationService } from '../../core/authorization/authorization.service';
import { SyncV3RevisionWriterService } from '../../core/sync/sync-v3-revision-writer.service';
import { SearchService } from '../../core/search/search.service';
import { GraphMaintenance } from '../../knowledge-graph/graph-maintenance';
import { ContentTreeService } from '../../content-tree/content-tree.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import type { HumanDevicePrincipal } from './human-device.guard';
import { ObsidianCryptoService } from './obsidian-crypto.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { SyncApiException } from './sync-error';

const EMPTY_REVISION_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const MAX_TRANSACTION_ATTEMPTS = 3;

type SessionRow = Record<string, any>;
type BlobRow = Record<string, any>;
type TreeFinalizePushRequestV3 = z.infer<typeof TreeFinalizePushRequestV3Schema>;
type TreeFinalizePushResponseV3 = z.infer<typeof TreeFinalizePushResponseV3Schema>;

interface StoredChangePayload {
  batchIndex: number;
  change: TreePushChangeV3;
}

@Injectable()
export class SyncV3PushSessionService {
  private readonly logger = new Logger(SyncV3PushSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: ObsidianCryptoService,
    private readonly contentTree: ContentTreeService,
    private readonly authorization: AuthorizationService,
    private readonly capabilities: SyncCapabilitiesService,
    private readonly writer: SyncV3RevisionWriterService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
    private readonly redis: RedisService,
    @Optional() private readonly search?: SearchService,
    @Optional() private readonly graphMaintenance?: GraphMaintenance,
  ) {}

  async create(
    principal: HumanDevicePrincipal,
    spaceId: string,
    rawInput: CreateTreePushSessionRequestV3,
  ) {
    const parsed = CreateTreePushSessionRequestV3Schema.safeParse(rawInput);
    if (!parsed.success) throw this.error('PAYLOAD_INVALID', 'Invalid v3 Push session request');
    const input = parsed.data;
    const limits = this.capabilities.capabilitiesV3();
    if (input.changeCount > limits.maxChangeCount) {
      throw this.error('BATCH_TOO_LARGE', 'Change count exceeds the negotiated limit');
    }
    if (input.confirmationByteLength > limits.maxConfirmationBytes) {
      throw this.error('BATCH_TOO_LARGE', 'Confirmation exceeds the negotiated limit');
    }
    if (input.totalBodyBytes > limits.maxClientTotalBodyBytes) {
      throw this.error('SPACE_TOO_LARGE', 'Page bodies exceed the negotiated limit');
    }
    if (input.attachmentCount > limits.maxRevisionAttachments
      || input.transferBlobBytes > limits.maxTransferBlobBytes) {
      throw this.error('ATTACHMENT_QUOTA_EXCEEDED', 'Attachment requirements exceed negotiated limits');
    }
    await this.assertSessionCreateRate(principal, spaceId);
    if (input.capabilitiesHash !== await this.capabilities.hashV3()) {
      throw this.error('CAPABILITIES_CHANGED', 'Server capabilities changed');
    }

    try {
      return await this.retrySerializable(async () => this.prisma.$transaction(async (tx) => {
        const user = await this.lockLiveCredential(tx, principal);
        const locked = await this.contentTree.lockSyncMutationSpace(tx, spaceId);
        await this.assertPublishable(locked, user, spaceId);
        const existing = await locked.pushSession.findUnique({
          where: { credentialFamilyId_idempotencyKey: {
            credentialFamilyId: principal.credentialFamilyId,
            idempotencyKey: input.idempotencyKey,
          } },
        });
        if (existing) {
          const requirements = await locked.pushSessionBlob.findMany({
            where: { sessionId: existing.id }, orderBy: { contentHash: 'asc' },
          });
          this.assertCreateBinding(existing, requirements, principal, spaceId, input);
          return this.createResponse(existing, requirements);
        }
        const head = await locked.spaceKnowledgeRevision.findFirst({
          where: { spaceId }, orderBy: { sequence: 'desc' }, select: { id: true },
        });
        if ((head?.id ?? '0') !== input.baseRevision) {
          throw this.error('BASE_STALE', 'Base revision is no longer current');
        }

        const verified = await this.findVerifiedRequirements(locked, input.blobRequirements);
        const now = new Date();
        const session = await locked.pushSession.create({ data: {
          id: randomUUID(), protocolVersion: '3',
          credentialFamilyId: principal.credentialFamilyId,
          credentialId: principal.credentialId,
          userId: principal.userId,
          spaceId,
          baseRevisionId: input.baseRevision,
          idempotencyKey: input.idempotencyKey,
          status: input.changeCount === 0 ? 'ready_to_finalize' : 'uploading',
          capabilitiesHash: input.capabilitiesHash,
          confirmationHash: input.confirmationHash,
          confirmationByteLength: input.confirmationByteLength,
          changeCount: input.changeCount,
          totalBodyBytes: BigInt(input.totalBodyBytes),
          attachmentCount: input.attachmentCount,
          transferBlobBytes: BigInt(input.transferBlobBytes),
          expiresAt: new Date(now.getTime() + limits.pushSessionTtlSeconds * 1_000),
        } });
        const blobRows = input.blobRequirements.map((requirement) => {
          const resident = verified.get(requirement.contentHash);
          return {
            sessionId: session.id,
            contentHash: requirement.contentHash,
            sizeBytes: BigInt(requirement.sizeBytes),
            mimeType: requirement.mimeType,
            width: requirement.width,
            height: requirement.height,
            status: resident ? 'verified' : 'uploading',
            storageKey: resident?.storageKey ?? null,
            verifiedAt: resident ? now : null,
          };
        });
        if (blobRows.length > 0) await locked.pushSessionBlob.createMany({ data: blobRows });
        return this.createResponse(session, blobRows);
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 120_000,
      }));
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'P2002') {
        return this.retrySerializable(async () => this.prisma.$transaction(async (tx) => {
          const user = await this.lockLiveCredential(tx, principal);
          const locked = await this.contentTree.lockSyncMutationSpace(tx, spaceId);
          await this.assertPublishable(locked, user, spaceId);
          const existing = await locked.pushSession.findUnique({
            where: { credentialFamilyId_idempotencyKey: {
              credentialFamilyId: principal.credentialFamilyId,
              idempotencyKey: input.idempotencyKey,
            } },
          });
          if (!existing) throw error;
          const requirements = await locked.pushSessionBlob.findMany({
            where: { sessionId: existing.id }, orderBy: { contentHash: 'asc' },
          });
          this.assertCreateBinding(existing, requirements, principal, spaceId, input);
          return this.createResponse(existing, requirements);
        }, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 120_000,
        }));
      }
      throw error;
    }
  }

  async uploadBatch(
    principal: HumanDevicePrincipal,
    spaceId: string,
    sessionId: string,
    rawBatch: TreePushBatchV3,
  ) {
    const parsed = TreePushBatchV3Schema.safeParse(rawBatch);
    if (!parsed.success) throw this.error('PAYLOAD_INVALID', 'Invalid v3 Push batch');
    const batch = parsed.data;
    await this.assertUploadRate(principal);
    const expired = Symbol('expired');
    const result = await this.retrySerializable(async () => this.prisma.$transaction(async (tx) => {
      await this.lockLiveCredential(tx, principal);
      await tx.$executeRaw`SELECT "id" FROM "PushSession" WHERE "id" = ${sessionId} FOR NO KEY UPDATE`;
      const session = await tx.pushSession.findUnique({ where: { id: sessionId } });
      this.assertBoundSession(session, principal, spaceId, sessionId);
      if (session.expiresAt <= new Date()) {
        await tx.pushSession.update({ where: { id: sessionId }, data: { status: 'expired' } });
        return expired;
      }
      const existing = await tx.pushSessionBatch.findUnique({
        where: { sessionId_batchIndex: { sessionId, batchIndex: batch.batchIndex } },
      });
      if (existing) {
        if (existing.batchHash !== batch.batchHash) {
          throw this.error('BATCH_MISMATCH', 'Batch index already has a different hash');
        }
        return this.batchResponse(session, existing);
      }
      if (session.status !== 'uploading') {
        throw this.error('PUSH_SESSION_STATE_INVALID', 'Push session does not accept batches');
      }
      if (session.capabilitiesHash !== await this.capabilities.hashV3()) {
        throw this.error('CAPABILITIES_CHANGED', 'Server capabilities changed');
      }
      const limits = this.capabilities.capabilitiesV3();
      if (batch.changes.length > limits.maxBatchItems
        || canonicalBytes(batch).byteLength > limits.maxBatchBytes) {
        throw this.error('BATCH_TOO_LARGE', 'Batch exceeds negotiated limits');
      }
      if (batch.batchIndex !== session.receivedBatchCount) {
        throw this.error('BATCH_MISMATCH', 'Batches must be uploaded contiguously');
      }
      const { batchHash: _batchHash, ...withoutHash } = batch;
      if (await treeBatchHashV3(withoutHash) !== batch.batchHash) {
        throw this.error('PAYLOAD_INVALID', 'Batch hash does not match its contents');
      }
      this.assertCanonicalChanges(batch.changes);

      const priorRows = await tx.pushSessionV3Change.findMany({
        where: { sessionId }, orderBy: { ordinal: 'asc' },
      });
      const prior = priorRows.map((row: any) => this.decodeStored(row));
      const combined = [...prior, ...batch.changes];
      this.assertCanonicalChanges(combined);
      this.assertUniqueEntitiesAndPaths(combined);
      const requirements = await tx.pushSessionBlob.findMany({
        where: { sessionId }, orderBy: { contentHash: 'asc' },
      });
      this.assertAttachmentRequirements(batch.changes, requirements);

      let bodyBytes = 0;
      for (const change of batch.changes) {
        if (change.operation !== 'upsert_page') continue;
        const normalized = normalizeMarkdown(change.page.body);
        if (normalized !== change.page.body || normalized.startsWith('\ufeff')) {
          throw this.error('PAYLOAD_INVALID', 'Page body is not canonical');
        }
        const bytes = Buffer.byteLength(normalized, 'utf8');
        if (bytes > limits.maxPageBytes || await contentHash(normalized) !== change.page.contentHash) {
          throw this.error('ATTACHMENT_CONTENT_INVALID', 'Page body metadata is invalid');
        }
        bodyBytes += bytes;
      }
      const nextCount = session.receivedChangeCount + batch.changes.length;
      const nextBodyBytes = session.receivedBodyBytes + BigInt(bodyBytes);
      if (nextCount > session.changeCount || nextBodyBytes > session.totalBodyBytes) {
        throw this.error('PAYLOAD_INVALID', 'Batch exceeds declared totals');
      }
      const isComplete = nextCount === session.changeCount
        && nextBodyBytes === session.totalBodyBytes;
      if (isComplete) this.assertExactRequirementSet(combined, requirements, session.attachmentCount);
      const allBlobsVerified = requirements.every((blob: BlobRow) => (
        blob.status === 'verified' && blob.storageKey && blob.verifiedAt
      ));
      const receipt = this.crypto.batchReceipt(sessionId, batch.batchIndex, batch.batchHash);
      const batchRow = await tx.pushSessionBatch.create({ data: {
        id: randomUUID(), sessionId, batchIndex: batch.batchIndex,
        batchHash: batch.batchHash, receipt,
      } });
      await tx.pushSessionV3Change.createMany({ data: batch.changes.map((change, index) => {
        const entity = this.entity(change);
        return {
          sessionId,
          ordinal: session.receivedChangeCount + index,
          entityType: entity.type,
          entityId: entity.id,
          operation: change.operation,
          payload: this.json({ batchIndex: batch.batchIndex, change }),
        };
      }) });
      const updated = await tx.pushSession.update({
        where: { id: sessionId },
        data: {
          receivedBatchCount: { increment: 1 },
          receivedChangeCount: nextCount,
          receivedBodyBytes: nextBodyBytes,
          status: isComplete && allBlobsVerified ? 'ready_to_finalize' : 'uploading',
        },
      });
      return this.batchResponse(updated, batchRow);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    if (result === expired) throw this.error('PUSH_SESSION_EXPIRED', 'Push session expired');
    return result;
  }

  async finalize(
    principal: HumanDevicePrincipal,
    spaceId: string,
    sessionId: string,
    input: TreeFinalizePushRequestV3,
  ): Promise<TreeFinalizePushResponseV3> {
    await this.assertFinalizeRate(principal, spaceId);
    const located = await this.prisma.pushSession.findUnique({ where: { id: sessionId } });
    this.assertBoundSession(located, principal, spaceId, sessionId, true);
    const expired = Symbol('expired');
    const result = await this.retrySerializable(async () => this.prisma.$transaction(async (tx) => {
      const user = await this.lockLiveCredential(tx, principal);
      const locked = await this.contentTree.lockSyncMutationSpace(tx, spaceId);
      await this.assertPublishable(locked, user, spaceId);
      await locked.$executeRaw`SELECT "id" FROM "PushSession" WHERE "id" = ${sessionId} FOR NO KEY UPDATE`;
      const session = await locked.pushSession.findUnique({ where: { id: sessionId } });
      this.assertBoundSession(session, principal, spaceId, sessionId, true);
      if (session.status === 'published' && session.result) {
        return TreeFinalizePushResponseV3Schema.parse(session.result);
      }
      if (session.expiresAt <= new Date()) {
        await locked.pushSession.update({ where: { id: sessionId }, data: { status: 'expired' } });
        return expired;
      }
      if (session.status !== 'ready_to_finalize') {
        throw this.error('PUSH_SESSION_STATE_INVALID', 'Push session cannot be finalized');
      }
      if (session.confirmationHash !== input.confirmationHash) {
        throw this.error('CONFIRMATION_MISMATCH', 'Confirmation hash does not match');
      }
      await locked.pushSession.update({ where: { id: sessionId }, data: { status: 'finalizing' } });
      if (session.capabilitiesHash !== await this.capabilities.hashV3()) {
        throw this.error('CAPABILITIES_CHANGED', 'Server capabilities changed');
      }
      const head = await locked.spaceKnowledgeRevision.findFirst({
        where: { spaceId }, orderBy: { sequence: 'desc' },
      });
      if ((head?.id ?? '0') !== session.baseRevisionId) {
        throw this.error('BASE_STALE', 'Base revision is no longer current');
      }
      const { changes, requirements } = await this.revalidateStaging(locked, session);
      if (changes.length === 0) {
        const result = TreeFinalizePushResponseV3Schema.parse({
          protocolVersion: '3', status: 'noop', revision: head?.id ?? '0',
          sequence: head?.sequence ?? 0,
          publishedAt: head?.createdAt?.toISOString() ?? null,
          revisionContentHash: head?.revisionContentHash ?? EMPTY_REVISION_HASH,
          folderCount: String(head ? await locked.syncRevisionFolderRow.count({ where: { revisionId: head.id } }) : 0),
          pageCount: String(head?.pageCount ?? 0n),
          attachmentCount: String(head?.attachmentCount ?? 0n),
          revisionManifestByteLength: String(head?.revisionManifestByteLength ?? 0n),
          revisionBodyBytes: String(head?.revisionBodyBytes ?? 0n),
          revisionAttachmentBytes: String(head?.revisionAttachmentBytes ?? 0n),
          changeSetId: null,
        });
        await locked.pushSession.update({ where: { id: sessionId }, data: {
          status: 'published', result: this.json(result),
        } });
        return result;
      }

      const base = await this.writer.inspectCurrentLocked(locked, spaceId);
      if (base.baseRevision !== undefined && base.baseRevision !== session.baseRevisionId) {
        throw this.error('BASE_STALE', 'Candidate base revision changed');
      }
      const candidate = this.applyChanges(base.candidate, changes);
      const exactDelta = treeRevisionDeltaV3({
        protocolVersion: '3', spaceId,
        folders: base.candidate.folders,
        pages: base.candidate.pages,
        attachments: base.candidate.attachments,
      }, {
        protocolVersion: '3', spaceId,
        folders: candidate.folders,
        pages: candidate.pages,
        attachments: candidate.attachments,
      });
      if (!Buffer.from(canonicalBytes(exactDelta)).equals(Buffer.from(canonicalBytes(changes)))) {
        throw this.error('CONFIRMATION_MISMATCH', 'Staged changes are not the exact base-to-candidate delta');
      }
      await this.verifyRequirementStorage(requirements);
      const changeSet = await locked.changeSet.create({ data: {
        title: 'Obsidian sync v3', status: 'publishing', spaceId,
        createdByUserId: principal.userId, origin: 'obsidian_sync',
        humanDeviceCredentialId: principal.credentialId,
        confirmationHash: session.confirmationHash,
        baseRevisionId: session.baseRevisionId,
      } });
      await this.applyLiveChanges(locked, principal, spaceId, changes, requirements, changeSet.id);
      const advanced = await this.writer.advanceV3Locked(locked, spaceId, candidate, {
        origin: 'obsidian_sync', createdByUserId: principal.userId,
        humanDeviceCredentialId: principal.credentialId,
        sourceChangeSetId: changeSet.id,
      });
      const publishedAt = new Date();
      await locked.changeSet.update({ where: { id: changeSet.id }, data: {
        status: 'published', publishedAt,
      } });
      const result = TreeFinalizePushResponseV3Schema.parse({
        protocolVersion: '3', status: 'published', revision: advanced.revisionId,
        sequence: advanced.sequence, publishedAt: publishedAt.toISOString(),
        revisionContentHash: advanced.revisionContentHash,
        folderCount: String(candidate.folders.length),
        pageCount: String(advanced.pageCount),
        attachmentCount: String(advanced.attachmentCount),
        revisionManifestByteLength: String(advanced.revisionManifestByteLength),
        revisionBodyBytes: String(advanced.revisionBodyBytes),
        revisionAttachmentBytes: String(advanced.revisionAttachmentBytes),
        changeSetId: changeSet.id,
      });
      await locked.pushSession.update({ where: { id: sessionId }, data: {
        status: 'published', result: this.json(result), publishedChangeSetId: changeSet.id,
      } });
      return result;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 120_000,
    }));
    if (result === expired) throw this.error('PUSH_SESSION_EXPIRED', 'Push session expired');
    await this.refreshAfterFinalize(spaceId, result.changeSetId);
    return result;
  }

  async get(principal: HumanDevicePrincipal, spaceId: string, sessionId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockLiveCredential(tx, principal);
      const session = await tx.pushSession.findUnique({ where: { id: sessionId } });
      this.assertBoundSession(session, principal, spaceId, sessionId, true);
      if (session.expiresAt <= new Date() && !['published', 'aborted', 'expired'].includes(session.status)) {
        session.status = 'expired';
        await tx.pushSession.update({ where: { id: sessionId }, data: { status: 'expired' } });
      }
      const [batches, blobs] = await Promise.all([
        tx.pushSessionBatch.findMany({ where: { sessionId }, orderBy: { batchIndex: 'asc' } }),
        tx.pushSessionBlob.findMany({ where: { sessionId }, orderBy: { contentHash: 'asc' } }),
      ]);
      return TreePushSessionStatusResponseV3Schema.parse({
        protocolVersion: '3', sessionId, status: session.status,
        expiresAt: session.expiresAt.toISOString(),
        missingContentHashes: blobs.filter((blob: BlobRow) => blob.status !== 'verified').map((blob: BlobRow) => blob.contentHash),
        completedContentHashes: blobs.filter((blob: BlobRow) => blob.status === 'verified').map((blob: BlobRow) => blob.contentHash),
        receivedBatchIndexes: batches.map((batch: any) => batch.batchIndex),
        result: session.result ?? null,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async abort(principal: HumanDevicePrincipal, spaceId: string, sessionId: string): Promise<void> {
    const expired = await this.prisma.$transaction(async (tx) => {
      await this.lockLiveCredential(tx, principal);
      await tx.$executeRaw`SELECT "id" FROM "PushSession" WHERE "id" = ${sessionId} FOR NO KEY UPDATE`;
      const session = await tx.pushSession.findUnique({ where: { id: sessionId } });
      this.assertBoundSession(session, principal, spaceId, sessionId);
      if (session.status === 'aborted') return;
      if (session.status === 'published' || session.status === 'finalizing') {
        throw this.error('PUSH_SESSION_STATE_INVALID', 'Finalizing or published session cannot be aborted');
      }
      if (session.expiresAt <= new Date() || session.status === 'expired') {
        await tx.pushSession.update({ where: { id: sessionId }, data: { status: 'expired' } });
        return true;
      }
      await tx.pushSession.update({ where: { id: sessionId }, data: { status: 'aborted' } });
      return false;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (expired) throw this.error('PUSH_SESSION_EXPIRED', 'Push session expired');
  }

  private async revalidateStaging(tx: any, session: SessionRow) {
    const batches = await tx.pushSessionBatch.findMany({
      where: { sessionId: session.id }, orderBy: { batchIndex: 'asc' },
    });
    if (batches.length !== session.receivedBatchCount
      || batches.some((batch: any, index: number) => batch.batchIndex !== index)) {
      throw this.error('PUSH_SESSION_INCOMPLETE', 'Push session has incomplete batches');
    }
    const rows = await tx.pushSessionV3Change.findMany({
      where: { sessionId: session.id }, orderBy: { ordinal: 'asc' },
    });
    if (rows.length !== session.changeCount
      || rows.some((row: any, index: number) => row.ordinal !== index)) {
      throw this.error('PUSH_SESSION_INCOMPLETE', 'Push session has incomplete changes');
    }
    const decoded: Array<{ stored: StoredChangePayload; row: any }> = rows.map((row: any) => ({
      stored: this.decodeStoredPayload(row), row,
    }));
    const changes = decoded.map(({ stored }) => stored.change);
    this.assertCanonicalChanges(changes);
    this.assertUniqueEntitiesAndPaths(changes);
    for (const batch of batches) {
      const batchChanges = decoded.filter(({ stored }) => stored.batchIndex === batch.batchIndex)
        .map(({ stored }) => stored.change);
      const computed = await treeBatchHashV3({
        protocolVersion: '3', batchIndex: batch.batchIndex, changes: batchChanges,
      });
      if (computed !== batch.batchHash
        || this.crypto.batchReceipt(session.id, batch.batchIndex, batch.batchHash) !== batch.receipt) {
        throw this.error('BATCH_MISMATCH', 'Batch receipt evidence is invalid');
      }
    }
    const bodyBytes = changes.reduce((sum, change) => sum + (
      change.operation === 'upsert_page' ? Buffer.byteLength(change.page.body, 'utf8') : 0
    ), 0);
    const manifest = {
      protocolVersion: '3' as const,
      spaceId: session.spaceId,
      baseRevision: session.baseRevisionId,
      capabilitiesHash: session.capabilitiesHash,
      changes: changes.map((change) => this.manifestChange(change)),
    };
    if (await treeConfirmationHashV3(manifest) !== session.confirmationHash
      || canonicalBytes(manifest).byteLength !== session.confirmationByteLength
      || bodyBytes !== Number(session.totalBodyBytes)) {
      throw this.error('CONFIRMATION_MISMATCH', 'Confirmation manifest evidence is invalid');
    }
    const requirements = await tx.pushSessionBlob.findMany({
      where: { sessionId: session.id }, orderBy: { contentHash: 'asc' },
    });
    this.assertExactRequirementSet(changes, requirements, session.attachmentCount);
    if (requirements.some((blob: BlobRow) => blob.status !== 'verified' || !blob.storageKey || !blob.verifiedAt)) {
      throw this.error('ATTACHMENT_BLOB_MISSING', 'A required Blob is not verified');
    }
    return { changes, requirements };
  }

  private applyChanges(
    base: { folders: SyncFolderV3[]; pages: SyncPageV3[]; attachments: SyncAttachmentV3[] },
    changes: TreePushChangeV3[],
  ) {
    const folders = new Map(base.folders.map((folder) => [folder.folderId, folder]));
    const pages = new Map(base.pages.map((page) => [page.pageId, page]));
    const attachments = new Map(base.attachments.map((attachment) => [attachment.attachmentId, attachment]));
    for (const change of changes) {
      if (change.operation === 'archive_page') pages.delete(change.pageId);
      else if (change.operation === 'archive_folder') {
        const removed = new Set([change.folderId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const folder of folders.values()) {
            if (folder.parentFolderId && removed.has(folder.parentFolderId) && !removed.has(folder.folderId)) {
              removed.add(folder.folderId); changed = true;
            }
          }
        }
        for (const id of removed) folders.delete(id);
        for (const page of pages.values()) if (page.folderId && removed.has(page.folderId)) pages.delete(page.pageId);
      } else if (change.operation === 'upsert_folder') folders.set(change.folder.folderId, change.folder);
      else if (change.operation === 'upsert_attachment') attachments.set(change.attachment.attachmentId, change.attachment);
      else if (change.operation === 'upsert_page') pages.set(change.page.pageId, change.page);
      else attachments.delete(change.attachmentId);
    }
    try {
      const candidate = canonicalTreeRevisionManifestV3({
        protocolVersion: '3', spaceId: 'candidate',
        folders: [...folders.values()], pages: [...pages.values()], attachments: [...attachments.values()],
      });
      return { folders: candidate.folders, pages: candidate.pages, attachments: candidate.attachments };
    } catch (error) {
      if (error instanceof SyncApiException) throw error;
      throw this.error('ATTACHMENT_REFERENCE_INVALID', 'Candidate manifest is inconsistent');
    }
  }

  private async applyLiveChanges(
    tx: any,
    principal: HumanDevicePrincipal,
    spaceId: string,
    changes: TreePushChangeV3[],
    requirements: BlobRow[],
    changeSetId: string,
  ) {
    const required = new Map(requirements.map((blob) => [blob.contentHash, blob]));
    const changedAt = new Date();
    for (const change of changes) {
      let publishedResourceId = this.entity(change).id;
      if (change.operation === 'upsert_attachment') {
        const blob = required.get(change.attachment.contentHash)!;
        const filename = change.attachment.path.slice('assets/'.length);
        const nameKey = pathKey(change.attachment.path).slice('assets/'.length);
        const current = await tx.spaceAttachment.findUnique({ where: { id: change.attachment.attachmentId } });
        if (current && current.spaceId !== spaceId) throw this.error('ATTACHMENT_MISSING', 'Attachment belongs to another Space');
        const conflicting = await tx.spaceAttachment.findFirst({ where: {
          spaceId, nameKey, id: { not: change.attachment.attachmentId },
        } });
        if (conflicting) throw this.error('ATTACHMENT_NAME_CONFLICT', 'Attachment path already exists');
        const data = {
          displayName: filename, nameKey,
          contentHash: change.attachment.contentHash, storageKey: blob.storageKey,
          mimeType: change.attachment.mimeType, sizeBytes: BigInt(change.attachment.sizeBytes),
          width: change.attachment.width, height: change.attachment.height,
          status: 'active', archivedAt: null,
          updatedAt: new Date(change.attachment.updatedAt),
          uploadedByUserId: principal.userId,
        };
        if (current) await tx.spaceAttachment.update({ where: { id: current.id }, data });
        else await tx.spaceAttachment.create({ data: {
          id: change.attachment.attachmentId, spaceId, ...data,
        } });
      } else if (change.operation === 'upsert_folder') {
        const current = await tx.folder.findUnique({ where: { id: change.folder.folderId } });
        const folderPathKey = pathKey(change.folder.path);
        const conflicting = await tx.folder.findFirst({ where: {
          spaceId, pathKey: folderPathKey, deletedAt: null,
          ...(current ? { id: { not: current.id } } : {}),
        } });
        if (conflicting) throw this.error('PATH_COLLISION', 'Folder path already exists');
        const data = {
          parentId: change.folder.parentFolderId, name: change.folder.name,
          nameKey: folderPathKey.split('/').slice(-1)[0],
          path: change.folder.path, pathKey: folderPathKey,
          sortOrder: change.folder.sortOrder, deletedAt: null, deletionBatchId: null,
          updatedAt: new Date(change.folder.updatedAt),
          lastModifiedByUserId: principal.userId, lastModifiedAt: changedAt,
        };
        if (current) {
          if (current.spaceId !== spaceId) throw this.error('PAGE_ID_CONFLICT', 'Folder belongs to another Space');
          await tx.folder.update({ where: { id: current.id }, data });
        } else await tx.folder.create({ data: {
          id: change.folder.folderId, spaceId, ...data, createdByUserId: principal.userId,
        } });
      } else if (change.operation === 'upsert_page') {
        const current = await tx.page.findUnique({ where: { knowledgeKey: change.page.pageId } });
        if (current && current.spaceId !== spaceId) throw this.error('PAGE_ID_CONFLICT', 'Page belongs to another Space');
        const pagePathKey = pathKey(change.page.path);
        const conflicting = await tx.page.findFirst({ where: {
          spaceId, syncPathKey: pagePathKey,
          ...(current ? { id: { not: current.id } } : {}),
        } });
        if (conflicting) throw this.error('PATH_COLLISION', 'Page path already exists');
        if (current) {
          await tx.pageVersion.create({ data: {
            pageId: current.id, title: current.title, content: current.content,
            authorId: current.authorId, slug: current.slug, format: current.format,
            parentId: current.parentId, folderId: current.folderId,
            syncPath: current.syncPath, syncPathKey: current.syncPathKey,
          } });
          await tx.page.update({ where: { id: current.id }, data: {
            title: change.page.title, content: change.page.body, format: 'markdown',
            folderId: change.page.folderId, parentId: null,
            syncPath: change.page.path, syncPathKey: pagePathKey,
            deletedAt: null, deletionBatchId: null, lastChangeSetId: changeSetId,
            lastModifiedByUserId: principal.userId, lastModifiedAt: changedAt,
            updatedAt: new Date(change.page.updatedAt),
          } });
          publishedResourceId = current.id;
        } else {
          const created = await tx.page.create({ data: {
          id: randomUUID(), knowledgeKey: change.page.pageId,
          title: change.page.title,
          slug: `sync-v3-${change.page.pageId}-${randomUUID().slice(0, 8)}`,
          content: change.page.body, format: 'markdown', spaceId,
          authorId: principal.userId, folderId: change.page.folderId, parentId: null,
          syncPath: change.page.path, syncPathKey: pagePathKey,
          sourceChangeSetId: changeSetId, lastChangeSetId: changeSetId,
          lastModifiedByUserId: principal.userId, lastModifiedAt: changedAt,
          updatedAt: new Date(change.page.updatedAt),
          } });
          publishedResourceId = created.id;
        }
      } else if (change.operation === 'archive_page') {
        const current = await tx.page.findUnique({ where: { knowledgeKey: change.pageId } });
        if (!current || current.spaceId !== spaceId || current.deletedAt
          || current.syncPath !== change.previousPath) {
          throw this.error('BASE_STALE', 'Page archive target changed');
        }
        await tx.pageVersion.create({ data: {
          pageId: current.id, title: current.title, content: current.content,
          authorId: current.authorId, slug: current.slug, format: current.format,
          parentId: current.parentId, folderId: current.folderId,
          syncPath: current.syncPath, syncPathKey: current.syncPathKey,
        } });
        await tx.page.update({ where: { id: current.id }, data: {
          deletedAt: changedAt, deletionBatchId: null, lastChangeSetId: changeSetId,
          lastModifiedByUserId: principal.userId, lastModifiedAt: changedAt,
        } });
        await tx.pageSearchDocument.deleteMany({ where: { pageId: current.id } });
        publishedResourceId = current.id;
      } else if (change.operation === 'archive_folder') {
        const current = await tx.folder.findUnique({ where: { id: change.folderId } });
        if (!current || current.spaceId !== spaceId || current.deletedAt
          || current.path !== change.previousPath) {
          throw this.error('BASE_STALE', 'Folder archive target changed');
        }
        await tx.folder.update({
          where: { id: current.id },
          data: {
            deletedAt: changedAt, deletionBatchId: null,
            lastModifiedByUserId: principal.userId, lastModifiedAt: changedAt,
          },
        });
      }
      await tx.changeItem.create({ data: {
        id: randomUUID(), type: change.operation,
        payload: this.json(change), status: 'published',
        publishedResourceId, changeSetId,
      } });
    }
    if (changes.some((change) => change.operation.includes('page') || change.operation.includes('folder'))) {
      const updated = await tx.space.updateMany({
        where: { id: spaceId, contentTreeRevision: tx.contentTreeRevision },
        data: { contentTreeRevision: { increment: 1n } },
      });
      if (updated.count !== 1) throw this.error('BASE_STALE', 'Space tree changed during finalize');
    }
  }

  private async refreshAfterFinalize(spaceId: string, changeSetId: string | null): Promise<void> {
    if (!changeSetId) return;
    try {
      const items = await this.prisma.changeItem.findMany({
        where: {
          changeSetId,
          type: { in: ['upsert_page', 'archive_page'] },
          publishedResourceId: { not: null },
        },
        select: { type: true, publishedResourceId: true },
      });
      const actions = [...new Map(items.map((item) => [item.publishedResourceId!, item])).values()];
      for (let offset = 0; offset < actions.length; offset += 8) {
        await Promise.allSettled(actions.slice(offset, offset + 8).map((item) => (
          item.type === 'archive_page'
            ? this.search?.deletePageIndex(item.publishedResourceId!)
            : this.search?.indexPage(item.publishedResourceId!)
        )));
      }
    } catch (error) {
      this.logger.warn(`post-finalize indexing failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      try {
        this.graphMaintenance?.enqueue(spaceId);
      } catch (error) {
        this.logger.warn(`post-finalize graph refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async findVerifiedRequirements(tx: any, requirements: CreateTreePushSessionRequestV3['blobRequirements']) {
    if (requirements.length === 0) return new Map<string, { storageKey: string }>();
    const candidates = await tx.attachmentVersion.findMany({
      where: { OR: requirements.map((requirement) => ({
        contentHash: requirement.contentHash,
        sizeBytes: BigInt(requirement.sizeBytes),
        mimeType: requirement.mimeType,
        width: requirement.width,
        height: requirement.height,
      })) },
      orderBy: { createdAt: 'asc' },
    });
    const found = new Map<string, { storageKey: string }>();
    for (const requirement of requirements) {
      for (const candidate of candidates) {
        if (found.has(requirement.contentHash)
          || candidate.contentHash !== requirement.contentHash
          || candidate.sizeBytes.toString() !== requirement.sizeBytes
          || candidate.mimeType !== requirement.mimeType
          || candidate.width !== requirement.width
          || candidate.height !== requirement.height
          || !candidate.storageKey) continue;
        try {
          const stream = await this.storage.openVerified(
            candidate.storageKey, candidate.contentHash, candidate.sizeBytes,
          );
          (stream as { destroy?: () => void }).destroy?.();
          found.set(requirement.contentHash, { storageKey: candidate.storageKey });
        } catch {
          // An unreadable content-addressed object is missing, never trusted.
        }
      }
    }
    return found;
  }

  private async verifyRequirementStorage(requirements: BlobRow[]) {
    for (const blob of requirements) {
      try {
        const stream = await this.storage.openVerified(blob.storageKey, blob.contentHash, blob.sizeBytes);
        (stream as { destroy?: () => void }).destroy?.();
      } catch {
        throw this.error('ATTACHMENT_BLOB_MISSING', 'Required Blob is unreadable');
      }
    }
  }

  private assertCreateBinding(
    session: SessionRow,
    requirements: BlobRow[],
    principal: HumanDevicePrincipal,
    spaceId: string,
    input: CreateTreePushSessionRequestV3,
  ) {
    const expected = input.blobRequirements;
    if (session.protocolVersion !== '3'
      || session.credentialFamilyId !== principal.credentialFamilyId
      || session.credentialId !== principal.credentialId
      || session.userId !== principal.userId
      || session.spaceId !== spaceId
      || session.baseRevisionId !== input.baseRevision
      || session.capabilitiesHash !== input.capabilitiesHash
      || session.confirmationHash !== input.confirmationHash
      || session.confirmationByteLength !== input.confirmationByteLength
      || session.changeCount !== input.changeCount
      || session.totalBodyBytes !== BigInt(input.totalBodyBytes)
      || session.attachmentCount !== input.attachmentCount
      || session.transferBlobBytes !== BigInt(input.transferBlobBytes)
      || requirements.length !== expected.length
      || requirements.some((row, index) => !this.sameRequirement(row, expected[index]!))) {
      throw this.error('IDEMPOTENCY_MISMATCH', 'Idempotency key is bound to another request');
    }
  }

  private assertBoundSession(
    session: SessionRow | null,
    principal: HumanDevicePrincipal,
    spaceId: string,
    sessionId: string,
    allowPublishedFamily = false,
  ): asserts session is SessionRow {
    if (!session || session.id !== sessionId || session.protocolVersion !== '3'
      || session.spaceId !== spaceId || session.userId !== principal.userId
      || session.credentialFamilyId !== principal.credentialFamilyId
      || (session.credentialId !== principal.credentialId
        && !(allowPublishedFamily && session.status === 'published'))) {
      throw this.error('PUSH_SESSION_NOT_FOUND', 'Push session not found');
    }
  }

  private async lockLiveCredential(tx: any, principal: HumanDevicePrincipal) {
    let user;
    try {
      user = await this.authorization.lockLiveHumanPrincipal(tx, principal);
    } catch {
      throw this.error('USER_INACTIVE', 'User account is unavailable');
    }
    const rows = await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "HumanDeviceCredential"
      WHERE "id" = ${principal.credentialId}
      FOR NO KEY UPDATE
    `) as Array<{ id: string }>;
    if (rows.length !== 1) throw this.error('DEVICE_CREDENTIAL_REVOKED', 'Credential is unavailable');
    const credential = await tx.humanDeviceCredential.findUnique({
      where: { id: principal.credentialId }, include: { user: true },
    });
    if (!credential
      || credential.credentialFamilyId !== principal.credentialFamilyId
      || credential.userId !== principal.userId
      || credential.deviceId !== principal.deviceId
      || credential.vaultId !== principal.vaultId) {
      throw this.error('DEVICE_CREDENTIAL_REVOKED', 'Credential binding changed');
    }
    if (credential.user.deletedAt || credential.user.lockedAt || credential.user.type !== 'human') {
      throw this.error('USER_INACTIVE', 'User account is unavailable');
    }
    if (credential.status === 'expired'
      || (credential.status === 'provisional'
        && (!credential.provisionalExpiresAt || credential.provisionalExpiresAt <= new Date()))) {
      throw this.error('DEVICE_CREDENTIAL_EXPIRED', 'Credential expired');
    }
    if (!['active', 'provisional'].includes(credential.status)) {
      throw this.error('DEVICE_CREDENTIAL_REVOKED', 'Credential is revoked');
    }
    return user;
  }

  private async assertPublishable(tx: any, user: { id: string; platformRole: string }, spaceId: string) {
    if (user.platformRole === 'super_admin') return;
    const member = await tx.spaceMember.findUnique({
      where: { userId_spaceId: { userId: user.id, spaceId } }, select: { role: true },
    });
    if (!member) throw this.error('SPACE_FORBIDDEN', 'Space is unavailable');
    if (!['owner', 'admin', 'editor'].includes(member.role)) {
      throw this.error('SPACE_READ_ONLY', 'Current role cannot publish');
    }
  }

  private assertCanonicalChanges(changes: TreePushChangeV3[]) {
    const canonical = canonicalTreeDeltaItemsV3(changes);
    if (!Buffer.from(canonicalBytes(canonical)).equals(Buffer.from(canonicalBytes(changes)))) {
      throw this.error('PAYLOAD_INVALID', 'Changes are not in canonical order');
    }
  }

  private assertUniqueEntitiesAndPaths(changes: TreePushChangeV3[]) {
    const entities = new Set<string>();
    const paths = new Map<string, string>();
    for (const change of changes) {
      const entity = this.entity(change);
      const entityKey = `${entity.type}:${entity.id}`;
      if (entities.has(entityKey)) throw this.error('PAYLOAD_INVALID', 'An entity may only change once');
      entities.add(entityKey);
      const candidatePath = change.operation === 'upsert_folder' ? change.folder.path
        : change.operation === 'upsert_page' ? change.page.path
          : change.operation === 'upsert_attachment' ? change.attachment.path : null;
      if (!candidatePath) continue;
      const namespace = change.operation === 'upsert_attachment' ? 'attachment' : 'tree';
      const key = `${namespace}:${pathKey(candidatePath)}`;
      const owner = paths.get(key);
      if (owner && owner !== entityKey) {
        throw this.error(
          namespace === 'attachment' ? 'ATTACHMENT_NAME_CONFLICT' : 'PATH_COLLISION',
          'Canonical paths collide',
        );
      }
      paths.set(key, entityKey);
    }
  }

  private assertAttachmentRequirements(changes: TreePushChangeV3[], requirements: BlobRow[]) {
    const byHash = new Map(requirements.map((row) => [row.contentHash, row]));
    for (const change of changes) {
      if (change.operation !== 'upsert_attachment') continue;
      const row = byHash.get(change.attachment.contentHash);
      if (!row || !this.sameRequirement(row, change.attachment)) {
        throw this.error('ATTACHMENT_CONTENT_INVALID', 'Attachment metadata differs from its requirement');
      }
    }
  }

  private assertExactRequirementSet(changes: TreePushChangeV3[], requirements: BlobRow[], attachmentCount: number) {
    const upserts = changes.filter((change) => change.operation === 'upsert_attachment');
    if (upserts.length !== attachmentCount) {
      throw this.error('CONFIRMATION_MISMATCH', 'Attachment change count differs from the declaration');
    }
    this.assertAttachmentRequirements(upserts, requirements);
    const hashes = new Set(upserts.map((change) => change.operation === 'upsert_attachment'
      ? change.attachment.contentHash : ''));
    if (hashes.size !== requirements.length
      || requirements.some((row) => !hashes.has(row.contentHash))) {
      throw this.error('CONFIRMATION_MISMATCH', 'Blob requirements do not exactly match attachment changes');
    }
  }

  private sameRequirement(row: BlobRow, requirement: {
    contentHash: string; sizeBytes: string; mimeType: string; width: number; height: number;
  }) {
    return row.contentHash === requirement.contentHash
      && row.sizeBytes.toString() === requirement.sizeBytes
      && row.mimeType === requirement.mimeType
      && row.width === requirement.width
      && row.height === requirement.height;
  }

  private entity(change: TreePushChangeV3) {
    if (change.operation === 'upsert_folder') return { type: 'folder', id: change.folder.folderId };
    if (change.operation === 'archive_folder') return { type: 'folder', id: change.folderId };
    if (change.operation === 'upsert_page') return { type: 'page', id: change.page.pageId };
    if (change.operation === 'archive_page') return { type: 'page', id: change.pageId };
    if (change.operation === 'upsert_attachment') return { type: 'attachment', id: change.attachment.attachmentId };
    return { type: 'attachment', id: change.attachmentId };
  }

  private manifestChange(change: TreePushChangeV3): TreePushManifestChangeV3 {
    if (change.operation !== 'upsert_page') return change;
    const { body: _body, ...page } = change.page;
    return { operation: 'upsert_page', page };
  }

  private decodeStored(row: any): TreePushChangeV3 {
    return this.decodeStoredPayload(row).change;
  }

  private decodeStoredPayload(row: any): StoredChangePayload {
    const value = row.payload as Partial<StoredChangePayload>;
    const parsed = TreePushBatchV3Schema.safeParse({
      protocolVersion: '3', batchIndex: value.batchIndex,
      changes: value.change ? [value.change] : [], batchHash: '0'.repeat(64),
    });
    if (!parsed.success || parsed.data.changes[0]?.operation !== row.operation) {
      throw this.error('PAYLOAD_INVALID', 'Stored Push change is invalid');
    }
    const entity = this.entity(parsed.data.changes[0]);
    if (entity.type !== row.entityType || entity.id !== row.entityId) {
      throw this.error('PAYLOAD_INVALID', 'Stored Push entity binding is invalid');
    }
    return { batchIndex: parsed.data.batchIndex, change: parsed.data.changes[0] };
  }

  private createResponse(session: SessionRow, requirements: BlobRow[]) {
    return {
      protocolVersion: '3' as const,
      sessionId: session.id,
      status: session.expiresAt <= new Date() && !['published', 'aborted'].includes(session.status)
        ? 'expired' as const : session.status,
      expiresAt: session.expiresAt.toISOString(),
      missingContentHashes: requirements.filter((row) => row.status !== 'verified')
        .map((row) => row.contentHash).sort(),
    };
  }

  private batchResponse(session: SessionRow, batch: any) {
    return {
      protocolVersion: '3' as const, sessionId: session.id,
      batchIndex: batch.batchIndex, batchHash: batch.batchHash,
      receipt: batch.receipt, receivedBatchCount: session.receivedBatchCount,
    };
  }

  private async retrySerializable<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!this.isSerializationFailure(error) || attempt === MAX_TRANSACTION_ATTEMPTS - 1) throw error;
      }
    }
    throw this.error('INTERNAL_ERROR', 'Serializable retry budget exhausted');
  }

  private isSerializationFailure(error: unknown) {
    return typeof error === 'object' && error !== null && (
      (error as any).code === 'P2034'
      || ((error as any).code === 'P2010' && (error as any).meta?.code === '40001')
    );
  }

  private async rateLimit(key: string, limit: number, ttlSeconds: number): Promise<void> {
    let count: number | null;
    try {
      count = await this.redis.incrementWithWindow(key, ttlSeconds);
    } catch {
      count = null;
    }
    if (count === null || count > limit) {
      throw this.error('RATE_LIMITED', 'Too many requests');
    }
  }

  private async assertSessionCreateRate(principal: HumanDevicePrincipal, spaceId: string): Promise<void> {
    const bucket = Math.floor(Date.now() / 60_000);
    const identity = this.crypto.credentialHash(
      `sync-session-create:${principal.credentialId}:${spaceId}`,
    ).slice(0, 16);
    await this.rateLimit(`sync:session-create:${bucket}:${identity}`, 10, 61);
  }

  private async assertUploadRate(principal: HumanDevicePrincipal): Promise<void> {
    const bucket = Math.floor(Date.now() / 60_000);
    const identity = this.crypto.credentialHash(
      `sync-batch-upload:${principal.credentialId}`,
    ).slice(0, 16);
    await this.rateLimit(`sync:batch-upload:${bucket}:${identity}`, 120, 61);
  }

  private async assertFinalizeRate(principal: HumanDevicePrincipal, spaceId: string): Promise<void> {
    const bucket = Math.floor(Date.now() / 60_000);
    const identity = this.crypto.credentialHash(
      `sync-finalize:${principal.credentialId}:${spaceId}`,
    ).slice(0, 16);
    await this.rateLimit(`sync:finalize:${bucket}:${identity}`, 10, 61);
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private error(code: any, message: string) {
    return new SyncApiException(code, message, undefined, '3');
  }
}
