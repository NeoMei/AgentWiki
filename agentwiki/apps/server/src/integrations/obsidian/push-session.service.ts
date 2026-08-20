import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  batchHash,
  canonicalBytes,
  capabilitiesHash,
  comparePushChanges,
  confirmationHash,
  contentHash,
  normalizeMarkdown,
  pathKey,
  type PushBatch,
  type PushConfirmationManifest,
  type SyncCapabilities,
} from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';
import { SyncApiException } from './sync-error';
import { DEFAULT_SYNC_CAPABILITIES, ObsidianCryptoService } from './obsidian-crypto.service';
import { SpaceRevisionWriterService } from '../../core/sync/space-revision-writer.service';
import type { HumanDevicePrincipal } from './human-device.guard';
import { SearchService } from '../../core/search/search.service';
import { GraphMaintenance } from '../../knowledge-graph/graph-maintenance';

const SESSION_TTL_MS = 900 * 1_000;
const EMPTY_REVISION_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

@Injectable()
export class PushSessionService {
  private readonly logger = new Logger(PushSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: ObsidianCryptoService,
    private readonly writer: SpaceRevisionWriterService,
    private readonly search: SearchService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly graphMaintenance?: GraphMaintenance,
  ) {}

  async create(principal: HumanDevicePrincipal, spaceId: string, input: {
    baseRevision: string;
    idempotencyKey: string;
    capabilitiesHash: string;
    confirmationHash: string;
    confirmationByteLength: number;
    changeCount: number;
    totalBodyBytes: number;
  }) {
    if (input.changeCount > 5_000) {
      throw new SyncApiException('BATCH_TOO_LARGE', 'changeCount exceeds the maximum of 5000');
    }
    if (input.confirmationByteLength > 4_194_304) {
      throw new SyncApiException('BATCH_TOO_LARGE', 'confirmationByteLength exceeds 4 MiB');
    }
    if (input.changeCount === 0 && input.totalBodyBytes !== 0) {
      throw new SyncApiException('PAYLOAD_INVALID', 'totalBodyBytes must be zero when changeCount is zero');
    }
    await this.assertSessionCreateRate(principal, spaceId);
    const existing = await this.prisma.pushSession.findUnique({
      where: { credentialFamilyId_idempotencyKey: { credentialFamilyId: principal.credentialFamilyId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) {
      if (
        existing.userId !== principal.userId
        || existing.spaceId !== spaceId
        || existing.baseRevisionId !== input.baseRevision
        || existing.capabilitiesHash !== input.capabilitiesHash
        || existing.confirmationHash !== input.confirmationHash
        || existing.confirmationByteLength !== input.confirmationByteLength
        || existing.changeCount !== input.changeCount
        || existing.totalBodyBytes !== BigInt(input.totalBodyBytes)
      ) {
        throw new SyncApiException('IDEMPOTENCY_MISMATCH', 'Existing session has different binding fields');
      }
      if (existing.credentialId !== principal.credentialId && existing.status !== 'published') {
        throw new SyncApiException('IDEMPOTENCY_MISMATCH', 'An unpublished session cannot be recovered by a rotated credential');
      }
      return this.sessionResponse(existing, await this.capabilities());
    }

    await this.assertPublishable(principal, spaceId);
    const expectedCapabilitiesHash = await this.capabilityHash();
    if (input.capabilitiesHash !== expectedCapabilitiesHash) {
      throw new SyncApiException('CAPABILITIES_CHANGED', 'Server capabilities have changed');
    }
    const head = await this.prisma.spaceKnowledgeRevision.findFirst({
      where: { spaceId },
      orderBy: { sequence: 'desc' },
    });
    const headRevision = head?.id ?? '0';
    if (input.baseRevision !== headRevision) {
      throw new SyncApiException('BASE_STALE', 'base revision is not the current head');
    }

    try {
      const session = await this.prisma.pushSession.create({
        data: {
          id: randomUUID(),
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
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      });
      return this.sessionResponse(session, await this.capabilities());
    } catch (error: unknown) {
      if ((error as any)?.code === 'P2002') {
        const created = await this.prisma.pushSession.findUnique({
          where: { credentialFamilyId_idempotencyKey: { credentialFamilyId: principal.credentialFamilyId, idempotencyKey: input.idempotencyKey } },
        });
        if (created) return this.sessionResponse(created, await this.capabilities());
      }
      throw error;
    }
  }

  async upload(principal: HumanDevicePrincipal, spaceId: string, sessionId: string, batch: PushBatch) {
    await this.assertUploadRate(principal);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT * FROM "PushSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const session = await tx.pushSession.findUnique({ where: { id: sessionId } });
      if (!session || session.spaceId !== spaceId || session.credentialId !== principal.credentialId) {
        throw new SyncApiException('PUSH_SESSION_NOT_FOUND', 'Push session not found');
      }
      this.assertMutable(session);
      const existingBatch = await tx.pushSessionBatch.findUnique({
        where: { sessionId_batchIndex: { sessionId, batchIndex: batch.batchIndex } },
      });
      if (existingBatch) {
        if (existingBatch.batchHash !== batch.batchHash) {
          throw new SyncApiException('BATCH_MISMATCH', 'Batch index already used with a different hash');
        }
        return {
          protocolVersion: '1',
          sessionId,
          batchIndex: batch.batchIndex,
          batchHash: batch.batchHash,
          receipt: existingBatch.receipt,
          receivedBatchCount: session.receivedBatchCount,
        };
      }
      const { batchHash: _sentHash, ...batchWithoutHash } = batch;
      const computedHash = await batchHash(batchWithoutHash);
      if (computedHash !== batch.batchHash) {
        throw new SyncApiException('PAYLOAD_INVALID', 'Batch hash does not match its contents');
      }
      if (batch.changes.length === 0) {
        throw new SyncApiException('PAYLOAD_INVALID', 'Batch cannot be empty');
      }
      if (batch.changes.length > DEFAULT_SYNC_CAPABILITIES.maxBatchItems) {
        throw new SyncApiException('BATCH_TOO_LARGE', 'Batch exceeds maxBatchItems');
      }
      if (canonicalBytes(batch).byteLength > DEFAULT_SYNC_CAPABILITIES.maxBatchBytes) {
        throw new SyncApiException('BATCH_TOO_LARGE', 'Batch exceeds maxBatchBytes');
      }
      let bodyBytes = 0;
      for (const change of batch.changes) {
        if (change.operation !== 'upsert') continue;
        const normalizedBody = normalizeMarkdown(change.body);
        if (normalizedBody.startsWith('﻿')) {
          throw new SyncApiException('PAYLOAD_INVALID', 'Page body must not begin with U+FEFF');
        }
        const pageBytes = new TextEncoder().encode(normalizedBody).byteLength;
        if (pageBytes > DEFAULT_SYNC_CAPABILITIES.maxPageBytes) {
          throw new SyncApiException('PAGE_TOO_LARGE', 'Page exceeds maxPageBytes');
        }
        bodyBytes += pageBytes;
      }
      const batchPageIds = batch.changes.map((change) => change.pageId);
      if (new Set(batchPageIds).size !== batchPageIds.length) {
        throw new SyncApiException('PAYLOAD_INVALID', 'A page ID may only appear once per push session');
      }
      const duplicatePageRows = await tx.pushSessionChange.findMany({
        where: { sessionId, pageId: { in: batchPageIds } },
        select: { pageId: true },
      });
      if (duplicatePageRows.length > 0) {
        throw new SyncApiException('PAYLOAD_INVALID', 'A page ID may only appear once per push session');
      }
      const nextChangeCount = session.receivedChangeCount + batch.changes.length;
      const nextBodyBytes = session.receivedBodyBytes + BigInt(bodyBytes);
      if (nextChangeCount > session.changeCount || nextBodyBytes > session.totalBodyBytes) {
        throw new SyncApiException('PAYLOAD_INVALID', 'Batch exceeds the declared change or byte totals');
      }
      const receipt = this.crypto.batchReceipt(sessionId, batch.batchIndex, batch.batchHash);
      const batchRow = await tx.pushSessionBatch.create({
        data: { id: randomUUID(), sessionId, batchIndex: batch.batchIndex, batchHash: batch.batchHash, receipt },
      });
      const changeRows = [];
      for (let index = 0; index < batch.changes.length; index += 1) {
        const change = batch.changes[index];
        changeRows.push({
          id: randomUUID(),
          sessionId,
          batchId: batchRow.id,
          ordinal: session.receivedChangeCount + index,
          operation: change.operation,
          pageId: change.pageId,
          path: change.operation === 'upsert' ? change.path : undefined,
          title: change.operation === 'upsert' ? change.title : undefined,
          body: change.operation === 'upsert' ? normalizeMarkdown(change.body) : undefined,
          contentHash: change.operation === 'upsert' ? await contentHash(change.body) : undefined,
          previousPath: change.operation === 'archive' ? change.previousPath : undefined,
        });
      }
      await tx.pushSessionChange.createMany({ data: changeRows });
      const complete = nextChangeCount === session.changeCount && nextBodyBytes === session.totalBodyBytes;
      await tx.pushSession.update({
        where: { id: sessionId },
        data: {
          receivedBatchCount: { increment: 1 },
          receivedChangeCount: nextChangeCount,
          receivedBodyBytes: nextBodyBytes,
          status: complete ? 'ready_to_finalize' : session.status,
        },
      });
      return {
        protocolVersion: '1',
        sessionId,
        batchIndex: batch.batchIndex,
        batchHash: batch.batchHash,
        receipt,
        receivedBatchCount: session.receivedBatchCount + 1,
      };
        }, { isolationLevel: 'Serializable' });
      } catch (error: unknown) {
        if (this.isSerializationFailure(error) && attempt < 2) continue;
        throw error;
      }
    }
  }

  async finalize(principal: HumanDevicePrincipal, spaceId: string, sessionId: string, confirmationHashValue: string) {
    await this.assertFinalizeRate(principal, spaceId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.prisma.$transaction(async (tx) => {
      await this.writer.lockSpace(tx, spaceId);
      await this.assertPublishableInTx(tx, principal, spaceId);
      await tx.$executeRaw`SELECT * FROM "PushSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const session = await tx.pushSession.findUnique({ where: { id: sessionId } });
      if (!session || session.spaceId !== spaceId || session.credentialId !== principal.credentialId) {
        throw new SyncApiException('PUSH_SESSION_NOT_FOUND', 'Push session not found');
      }
      if (session.status === 'published' && session.result) {
        return session.result;
      }
      this.assertMutable(session);
      if (session.status !== 'ready_to_finalize') {
        throw new SyncApiException('PUSH_SESSION_INCOMPLETE', 'Push session is not ready to finalize');
      }
      if (session.confirmationHash !== confirmationHashValue) {
        throw new SyncApiException('CONFIRMATION_MISMATCH', 'Confirmation hash does not match');
      }
      const head = await this.prisma.spaceKnowledgeRevision.findFirst({
        where: { spaceId },
        orderBy: { sequence: 'desc' },
      });
      if ((head?.id ?? '0') !== session.baseRevisionId) {
        throw new SyncApiException('BASE_STALE', 'base revision is no longer the current head');
      }

      const batches = await tx.pushSessionBatch.findMany({
        where: { sessionId },
        orderBy: { batchIndex: 'asc' },
        select: { batchIndex: true },
      });
      if (
        batches.length !== session.receivedBatchCount
        || batches.some((batch, index) => batch.batchIndex !== index)
      ) {
        throw new SyncApiException('PUSH_SESSION_INCOMPLETE', 'Push session is missing one or more batch indexes');
      }

      const staged = await tx.pushSessionChange.findMany({
        where: { sessionId },
        orderBy: { ordinal: 'asc' },
      });
      if (staged.length !== session.changeCount) {
        throw new SyncApiException('PUSH_SESSION_INCOMPLETE', 'Not all changes were uploaded');
      }
      const changes = staged.map((row) =>
        row.operation === 'archive'
          ? { operation: 'archive' as const, pageId: row.pageId, previousPath: row.previousPath ?? '' }
          : { operation: 'upsert' as const, pageId: row.pageId, path: row.path ?? '', title: row.title ?? '', body: row.body ?? '' },
      );
      const manifest: PushConfirmationManifest = {
        protocolVersion: '1',
        spaceId,
        baseRevision: session.baseRevisionId,
        changes: changes.map((change) =>
          change.operation === 'archive'
            ? { operation: 'archive', pageId: change.pageId, previousPath: change.previousPath }
            : { operation: 'upsert', pageId: change.pageId, path: change.path, title: change.title, contentHash: '' },
        ),
      };
      for (let i = 0; i < changes.length; i += 1) {
        const change = changes[i];
        if (change.operation === 'upsert') {
          (manifest.changes[i] as any).contentHash = await contentHash(change.body);
        }
      }
      const sortedManifest: PushConfirmationManifest = {
        ...manifest,
        changes: [...manifest.changes].sort(comparePushChanges),
      };
      const computedConfirmation = await confirmationHash(sortedManifest);
      const computedBytes = canonicalBytes(sortedManifest).byteLength;
      if (computedConfirmation !== session.confirmationHash || computedBytes !== session.confirmationByteLength) {
        throw new SyncApiException('CONFIRMATION_MISMATCH', 'Confirmation does not match staged changes');
      }

      const orderedChanges = [...changes].sort(comparePushChanges);
      const noop = session.changeCount === 0
        || (await this.isNoop(tx, spaceId, orderedChanges));
      if (noop) {
        const result = {
          protocolVersion: '1',
          status: 'noop',
          revision: head?.id ?? '0',
          sequence: head?.sequence ?? 0,
          publishedAt: head?.createdAt.toISOString() ?? null,
          revisionContentHash: head?.revisionContentHash ?? EMPTY_REVISION_HASH,
          pageCount: (head?.pageCount ?? 0n).toString(),
          revisionManifestByteLength: (head?.revisionManifestByteLength ?? 0n).toString(),
          revisionBodyBytes: (head?.revisionBodyBytes ?? 0n).toString(),
          changeSetId: null,
        };
        await tx.pushSession.update({ where: { id: sessionId }, data: { status: 'published', result } });
        return result;
      }

      await this.assertNoPathCollisions(tx, spaceId, orderedChanges);

      const applied = await this.applyPageChanges(tx, spaceId, principal.userId, orderedChanges);
      const revision = await this.writer.advance(tx, spaceId, orderedChanges, {
        origin: 'obsidian_sync',
        createdByUserId: principal.userId,
        humanDeviceCredentialId: principal.credentialId,
      });
      const capabilities = await this.capabilities();
      if (
        revision.pageCount > BigInt(capabilities.maxClientSpacePages)
        || revision.revisionBodyBytes > BigInt(capabilities.maxClientTotalBodyBytes)
        || revision.revisionManifestByteLength > BigInt(capabilities.maxClientManifestBytes)
      ) {
        throw new SyncApiException('SPACE_TOO_LARGE', 'Resulting space exceeds the client capability');
      }
      const changeSet = await tx.changeSet.create({
        data: {
          title: 'Obsidian sync',
          status: 'published',
          spaceId,
          createdByUserId: principal.userId,
          origin: 'obsidian_sync',
          humanDeviceCredentialId: principal.credentialId,
          confirmationHash: session.confirmationHash,
          baseRevisionId: session.baseRevisionId,
          publishedAt: new Date(),
        },
      });
      for (const item of applied) {
        await tx.changeItem.create({
          data: {
          id: randomUUID(),
          type: item.type,
          payload: item.payload as Prisma.InputJsonValue,
          status: 'published',
          publishedResourceId: item.publishedResourceId,
          changeSetId: changeSet.id,
          },
        });
      }
      const result = {
        protocolVersion: '1',
        status: 'published',
        revision: revision.revisionId,
        sequence: revision.sequence,
        publishedAt: new Date().toISOString(),
        revisionContentHash: revision.revisionContentHash,
        pageCount: revision.pageCount.toString(),
        revisionManifestByteLength: revision.revisionManifestByteLength.toString(),
        revisionBodyBytes: revision.revisionBodyBytes.toString(),
        changeSetId: changeSet.id,
      };
      await tx.pushSession.update({
        where: { id: sessionId },
        data: { status: 'published', result, publishedChangeSetId: changeSet.id },
      });
      return result;
        }, { isolationLevel: 'Serializable', timeout: 120_000 });
        await this.refreshGraphAfterFinalize(spaceId, (result as any).changeSetId ?? null);
        return result;
      } catch (error: unknown) {
        const serializationConflict = typeof error === 'object' && error !== null && (
          (error as any).code === 'P2034'
          || ((error as any).code === 'P2010' && (error as any).meta?.code === '40001')
        );
        if (serializationConflict && attempt < 2) {
          continue;
        }
        throw error;
      }
    }
  }

  private async refreshGraphAfterFinalize(spaceId: string, changeSetId: string | null) {
    if (!changeSetId) return;
    try {
      const items = await this.prisma.changeItem.findMany({
        where: {
          changeSetId,
          type: { in: ['create_page', 'update_page', 'archive_page'] },
          publishedResourceId: { not: null },
        },
        select: { type: true, publishedResourceId: true },
      });
      const actions = [...new Map(items.map((item) => [item.publishedResourceId!, item])).values()];
      for (let offset = 0; offset < actions.length; offset += 8) {
        await Promise.allSettled(actions.slice(offset, offset + 8).map((item) => item.type === 'archive_page'
          ? this.search.deletePageIndex(item.publishedResourceId!)
          : this.search.indexPage(item.publishedResourceId!)));
      }
    } catch (error) {
      this.logger.warn(`post-finalize graph indexing failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.graphMaintenance?.enqueue(spaceId);
    }
  }

  async get(principal: HumanDevicePrincipal, spaceId: string, sessionId: string) {
    const session = await this.prisma.pushSession.findUnique({
      where: { id: sessionId },
      include: { batches: { orderBy: { batchIndex: 'asc' } } },
    });
    if (!session || session.spaceId !== spaceId || session.credentialFamilyId !== principal.credentialFamilyId) {
      throw new SyncApiException('PUSH_SESSION_NOT_FOUND', 'Push session not found');
    }
    if (session.credentialId !== principal.credentialId && session.status !== 'published') {
      throw new SyncApiException('PUSH_SESSION_NOT_FOUND', 'Push session not found');
    }
    const status = session.expiresAt <= new Date() && !['published', 'aborted'].includes(session.status)
      ? 'expired'
      : session.status;
    return {
      protocolVersion: '1',
      sessionId,
      status,
      expiresAt: session.expiresAt.toISOString(),
      receivedBatchIndexes: session.batches.map((b) => b.batchIndex),
      result: session.result,
    };
  }

  async abort(principal: HumanDevicePrincipal, spaceId: string, sessionId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT * FROM "PushSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const session = await tx.pushSession.findUnique({ where: { id: sessionId } });
      if (!session || session.spaceId !== spaceId || session.credentialId !== principal.credentialId) {
        throw new SyncApiException('PUSH_SESSION_NOT_FOUND', 'Push session not found');
      }
      if (session.status === 'published') {
        throw new SyncApiException('PUSH_SESSION_STATE_INVALID', 'Published session cannot be aborted');
      }
      if (session.status === 'aborted') return;
      if (session.expiresAt <= new Date()) {
        throw new SyncApiException('PUSH_SESSION_EXPIRED', 'Push session has expired');
      }
      await tx.pushSessionChange.deleteMany({ where: { sessionId } });
      await tx.pushSessionBatch.deleteMany({ where: { sessionId } });
      await tx.pushSession.update({ where: { id: sessionId }, data: { status: 'aborted' } });
    });
  }

  private async assertPublishable(principal: HumanDevicePrincipal, spaceId: string) {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId },
      select: { deletedAt: true },
    });
    if (!space || space.deletedAt) {
      throw new SyncApiException('SPACE_FORBIDDEN', 'Space is not accessible');
    }
    if (principal.platformRole === 'super_admin') return;
    const member = await this.prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: principal.userId, spaceId } },
    });
    if (!member) {
      throw new SyncApiException('SPACE_FORBIDDEN', 'Space is not accessible');
    }
    if (!['editor', 'admin', 'owner'].includes(member.role)) {
      throw new SyncApiException('SPACE_READ_ONLY', 'Space role does not permit publishing');
    }
  }

  private async assertPublishableInTx(tx: any, principal: HumanDevicePrincipal, spaceId: string) {
    const space = await tx.space.findUnique({
      where: { id: spaceId },
      select: { deletedAt: true },
    });
    if (!space || space.deletedAt) {
      throw new SyncApiException('SPACE_FORBIDDEN', 'Space is not accessible');
    }
    if (principal.platformRole === 'super_admin') return;
    const member = await tx.spaceMember.findUnique({
      where: { userId_spaceId: { userId: principal.userId, spaceId } },
    });
    if (!member) {
      throw new SyncApiException('SPACE_FORBIDDEN', 'Space is not accessible');
    }
    if (!['editor', 'admin', 'owner'].includes(member.role)) {
      throw new SyncApiException('SPACE_READ_ONLY', 'Space role does not permit publishing');
    }
  }

  private assertMutable(session: { status: string; expiresAt: Date }) {
    if (session.expiresAt <= new Date()) {
      throw new SyncApiException('PUSH_SESSION_EXPIRED', 'Push session has expired');
    }
    if (session.status === 'published') {
      throw new SyncApiException('PUSH_SESSION_STATE_INVALID', 'Push session is already published');
    }
    if (session.status === 'aborted') {
      throw new SyncApiException('PUSH_SESSION_STATE_INVALID', 'Push session is aborted');
    }
  }

  private async rateLimit(key: string, limit: number, ttlSeconds: number): Promise<void> {
    if (!this.redis) return;
    const count = await this.redis.incrementWithWindow(key, ttlSeconds);
    if (count === null || count > limit) {
      throw new SyncApiException('RATE_LIMITED', 'Too many requests');
    }
  }

  private async assertSessionCreateRate(principal: HumanDevicePrincipal, spaceId: string): Promise<void> {
    if (!this.redis) return;
    const bucket = Math.floor(Date.now() / (60 * 1_000));
    const identity = this.crypto.credentialHash(`sync-session-create:${principal.credentialId}:${spaceId}`).slice(0, 16);
    await this.rateLimit(`sync:session-create:${bucket}:${identity}`, 10, 61);
  }

  private async assertUploadRate(principal: HumanDevicePrincipal): Promise<void> {
    if (!this.redis) return;
    const bucket = Math.floor(Date.now() / (60 * 1_000));
    const identity = this.crypto.credentialHash(`sync-batch-upload:${principal.credentialId}`).slice(0, 16);
    await this.rateLimit(`sync:batch-upload:${bucket}:${identity}`, 120, 61);
  }

  private async assertFinalizeRate(principal: HumanDevicePrincipal, spaceId: string): Promise<void> {
    if (!this.redis) return;
    const bucket = Math.floor(Date.now() / (60 * 1_000));
    const identity = this.crypto.credentialHash(`sync-finalize:${principal.credentialId}:${spaceId}`).slice(0, 16);
    await this.rateLimit(`sync:finalize:${bucket}:${identity}`, 10, 61);
  }

  private isSerializationFailure(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (
      (error as any).code === 'P2034'
      || ((error as any).code === 'P2010' && (error as any).meta?.code === '40001')
    );
  }
  private async capabilities(): Promise<SyncCapabilities> {
    return { ...DEFAULT_SYNC_CAPABILITIES };
  }

  private async capabilityHash(): Promise<string> {
    return capabilitiesHash(DEFAULT_SYNC_CAPABILITIES);
  }

  private async sessionResponse(session: any, capabilities: SyncCapabilities) {
    const status = session.expiresAt <= new Date() && !['published', 'aborted'].includes(session.status)
      ? 'expired'
      : session.status;
    return {
      protocolVersion: '1',
      sessionId: session.id,
      status,
      expiresAt: session.expiresAt.toISOString(),
      capabilities,
      result: session.result ?? null,
    };
  }

  private async assertNoPathCollisions(
    tx: any,
    spaceId: string,
    changes: Array<{ operation: string; pageId: string; path?: string; previousPath?: string }>,
  ) {
    const ownerByPathKey = new Map<string, string>();
    for (const change of changes) {
      if (change.operation !== 'upsert' || !change.path) continue;
      const key = pathKey(change.path);
      const owner = ownerByPathKey.get(key);
      if (owner && owner !== change.pageId) {
        throw new SyncApiException('PATH_COLLISION', 'Two pages resolve to the same path');
      }
      if (!owner) ownerByPathKey.set(key, change.pageId);
      const existing = await tx.page.findFirst({
        where: { spaceId, syncPathKey: key },
        select: { knowledgeKey: true },
      });
      if (existing && existing.knowledgeKey !== change.pageId) {
        throw new SyncApiException('PATH_COLLISION', 'Path is already used by another page');
      }
    }
  }

  private async isNoop(tx: any, spaceId: string, changes: Array<{ operation: string; pageId: string; path?: string; title?: string; body?: string; previousPath?: string }>) {
    const upserts = changes.filter((c) => c.operation === 'upsert');
    const archives = changes.filter((c) => c.operation === 'archive');
    if (archives.length > 0) return false;
    for (const change of upserts) {
      const page = await tx.page.findUnique({ where: { knowledgeKey: change.pageId } });
      if (!page || page.spaceId !== spaceId || page.deletedAt) return false;
      const body = normalizeMarkdown(change.body ?? '');
      if (page.title !== change.title || page.content !== body) return false;
      if (change.path && page.syncPath !== change.path) return false;
    }
    return true;
  }

  private async applyPageChanges(
    tx: any,
    spaceId: string,
    userId: string,
    changes: Array<{ operation: string; pageId: string; path?: string; title?: string; body?: string; previousPath?: string }>,
  ): Promise<Array<{ type: string; payload: Record<string, unknown>; publishedResourceId: string }>> {
    const applied: Array<{ type: string; payload: Record<string, unknown>; publishedResourceId: string }> = [];
    for (const change of changes) {
      if (change.operation === 'archive') {
        const page = await tx.page.findUnique({ where: { knowledgeKey: change.pageId } });
        if (!page) throw new SyncApiException('PAGE_ID_CONFLICT', 'Archive target page does not exist');
        if (page.spaceId !== spaceId) throw new SyncApiException('PAGE_ID_CONFLICT', 'Page belongs to another space');
        await tx.pageVersion.create({
          data: {
            pageId: page.id, title: page.title, content: page.content, authorId: userId,
            slug: page.slug, format: page.format, parentId: page.parentId,
            syncPath: page.syncPath, syncPathKey: page.syncPathKey,
          },
        });
        await tx.page.update({
          where: { id: page.id },
          data: { deletedAt: new Date(), lastModifiedByUserId: userId, lastModifiedAt: new Date() },
        });
        await tx.pageSearchDocument.deleteMany({ where: { pageId: page.id } });
        applied.push({ type: 'archive_page', payload: { pageId: change.pageId, previousPath: change.previousPath ?? page.syncPath }, publishedResourceId: page.id });
        continue;
      }

      const body = normalizeMarkdown(change.body ?? '');
      const key = change.path ? pathKey(change.path) : undefined;
      let page = await tx.page.findUnique({ where: { knowledgeKey: change.pageId } });
      if (page && page.spaceId !== spaceId) {
        throw new SyncApiException('PAGE_ID_CONFLICT', 'Page ID belongs to another space');
      }
      if (page && page.deletedAt) {
        await tx.pageVersion.create({
          data: {
            pageId: page.id, title: page.title, content: page.content, authorId: userId,
            slug: page.slug, format: page.format, parentId: page.parentId,
            syncPath: page.syncPath, syncPathKey: page.syncPathKey,
          },
        });
        page = await tx.page.update({
          where: { id: page.id },
          data: {
            title: change.title ?? page.title, content: body, format: 'markdown',
            syncPath: change.path ?? page.syncPath, syncPathKey: key ?? page.syncPathKey,
            deletedAt: null, lastModifiedByUserId: userId, lastModifiedAt: new Date(),
          },
        });
        applied.push({ type: 'create_page', payload: { pageId: change.pageId, path: change.path }, publishedResourceId: page.id });
        continue;
      }
      if (page) {
        await tx.pageVersion.create({
          data: {
            pageId: page.id, title: page.title, content: page.content, authorId: userId,
            slug: page.slug, format: page.format, parentId: page.parentId,
            syncPath: page.syncPath, syncPathKey: page.syncPathKey,
          },
        });
        page = await tx.page.update({
          where: { id: page.id },
          data: {
            title: change.title ?? page.title, content: body, format: 'markdown',
            syncPath: change.path ?? page.syncPath, syncPathKey: key ?? page.syncPathKey,
            lastModifiedByUserId: userId, lastModifiedAt: new Date(),
          },
        });
        applied.push({ type: 'update_page', payload: { pageId: change.pageId, path: change.path, title: change.title }, publishedResourceId: page.id });
        continue;
      }
      page = await tx.page.create({
        data: {
          id: randomUUID(), knowledgeKey: change.pageId,
          title: change.title ?? '',
          slug: this.uniqueSlug(change.title ?? 'untitled', change.pageId),
          content: body, format: 'markdown', spaceId, authorId: userId,
          syncPath: change.path, syncPathKey: key,
          lastModifiedByUserId: userId, lastModifiedAt: new Date(),
        },
      });
      applied.push({ type: 'create_page', payload: { pageId: change.pageId, path: change.path, title: change.title }, publishedResourceId: page.id });
    }
    return applied;
  }

  private uniqueSlug(title: string, pageId: string): string {
    const base = title
      .toLowerCase()
      .replace(/[^a-z0-9一-龥]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled';
    return `${base}-${pageId}`;
  }
}
