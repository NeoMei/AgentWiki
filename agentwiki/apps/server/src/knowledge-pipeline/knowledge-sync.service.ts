import { lockSourceHead, lockSourceMutationSpace, nextSourceGeneration, sourceVersionConflict } from './source-head';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';
import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { AuditService } from '../core/security/audit.service';
import { PrismaService } from '../database/prisma.service';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { NormalizedOkfEnvelope, OkfEnvelopeError, parseOkfEnvelope } from './okf-envelope';

const SOURCE_KEY_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const FINISHED_RUN_STATUSES = ['completed', 'partial'];
const RETRYABLE_SYNC_RUN_STATUSES = ['failed', 'cancelled'];

export interface KnowledgeSyncState {
  exists: boolean;
  sourceId: string | null;
  sourceVersionId: string | null;
  syncedAt: Date | null;
  documents: Array<{ path: string; contentHash: string }>;
}

export interface KnowledgeSyncResult {
  status: 'queued' | 'noop' | 'existing';
  sourceId: string;
  sourceVersionId: string;
  runId: string | null;
}

@Injectable()
export class KnowledgeSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
    private readonly revisionWriter: SpaceRevisionWriterService,
  ) {}

  async getState(spaceId: string, sourceKey: string): Promise<KnowledgeSyncState> {
    this.assertSourceKey(sourceKey);
    const source = await this.prisma.source.findUnique({
      where: { spaceId_type_sourceKey: { spaceId, type: 'okf', sourceKey } },
      select: { id: true },
    });
    if (!source) return this.emptyState();

    const run = await this.prisma.ingestRun.findFirst({
      where: {
        sourceId: source.id,
        inputSourceVersionId: { not: null },
        status: { in: FINISHED_RUN_STATUSES },
      },
      orderBy: { completedAt: 'desc' },
      select: {
        completedAt: true,
        inputSourceVersion: {
          select: {
            id: true,
            files: { select: { path: true, contentHash: true }, orderBy: { path: 'asc' } },
          },
        },
      },
    });
    if (!run?.inputSourceVersion) {
      return { exists: true, sourceId: source.id, sourceVersionId: null, syncedAt: null, documents: [] };
    }
    return {
      exists: true,
      sourceId: source.id,
      sourceVersionId: run.inputSourceVersion.id,
      syncedAt: run.completedAt,
      documents: run.inputSourceVersion.files.map((file) => ({ path: file.path, contentHash: file.contentHash })),
    };
  }

  async createSync(
    spaceId: string,
    principal: Principal,
    file: Buffer,
    idempotencyKey: string,
    confirmed: boolean,
  ): Promise<KnowledgeSyncResult> {
    if (!confirmed) {
      throw new BusinessException('SYNC_CONFIRMATION_REQUIRED', 'Explicit confirmation is required before knowledge is synchronized');
    }
    if (!idempotencyKey || idempotencyKey.length > 128) {
      throw new BusinessException('SOURCE_INVALID', 'Idempotency key must be between 1 and 128 characters');
    }

    const envelope = this.parseEnvelope(file);
    this.assertSourceKey(envelope.sourceKey);

    let result: KnowledgeSyncResult;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await lockSourceMutationSpace(tx, principal, spaceId, ['sources:write', 'runs:write'], this.authorization, this.revisionWriter);
        return this.persistSync(tx, spaceId, principal, envelope, idempotencyKey);
      });
    } catch (error: unknown) {
      if (!this.isPrismaUniqueViolation(error)) throw error;
      const winner = await this.findConcurrentWinner(spaceId, principal, envelope, idempotencyKey);
      if (!winner) throw error;
      result = winner;
    }

    await this.audit.record({
      action: 'knowledge_sync.create',
      outcome: 'success',
      actorUserId: principal.agentId ? undefined : principal.userId,
      actorAgentId: principal.agentId,
      metadata: {
        agentId: principal.agentId,
        credentialId: principal.credentialId,
        spaceId,
        sourceKey: envelope.sourceKey,
        packageHash: envelope.contentHash,
        idempotencyKey,
        userConfirmed: true,
        status: result.status,
      },
    });
    return result;
  }

  private async persistSync(
    tx: any,
    spaceId: string,
    principal: Principal,
    envelope: NormalizedOkfEnvelope,
    idempotencyKey: string,
  ): Promise<KnowledgeSyncResult> {
    const source = await tx.source.upsert({
      where: { spaceId_type_sourceKey: { spaceId, type: 'okf', sourceKey: envelope.sourceKey } },
      create: {
        spaceId,
        type: 'okf',
        sourceKey: envelope.sourceKey,
        name: envelope.name,
        contentHash: this.hash(envelope.sourceKey),
        config: { kind: envelope.kind, producer: envelope.producer },
        createdByUserId: principal.agentId ? undefined : principal.userId,
        createdByAgentId: principal.agentId,
      },
      // Resolve the identity without rewriting metadata on a historical replay.
      update: {},
      select: { id: true },
    });

    const head = await lockSourceHead(tx, source.id, spaceId);
    const replay = await this.findReceipt(tx, source.id, envelope.contentHash, idempotencyKey);
    if (replay) return replay;

    await tx.source.update({
      where: { id: source.id },
      data: {
        name: envelope.name,
        contentHash: this.hash(envelope.sourceKey),
        config: { kind: envelope.kind, producer: envelope.producer },
      },
    });

    let version = await tx.sourceVersion.findFirst({
      where: { sourceId: source.id, contentHash: envelope.contentHash },
      select: { id: true },
    });
    if (!version) {
      const latestVersion = await tx.sourceVersion.findFirst({
        where: { sourceId: source.id },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      version = await tx.sourceVersion.create({
        data: {
          sourceId: source.id,
          version: (latestVersion?.version || 0) + 1,
          content: JSON.stringify(envelope),
          contentHash: envelope.contentHash,
          metadata: { okfVersion: envelope.okfVersion, kind: envelope.kind, producer: envelope.producer },
          files: {
            create: envelope.documents.map((document) => ({
              path: document.path,
              contentHash: document.contentHash,
              size: Buffer.byteLength(document.content, 'utf8'),
            })),
          },
        },
        select: { id: true },
      });
    }

    const sourceState = await tx.source.findUnique({ where: { id: source.id }, select: { currentSourceGeneration: true } });
    const generation = nextSourceGeneration(sourceState.currentSourceGeneration, head?.sourceVersionId === version.id);
    if (!head || head.sourceVersionId !== version.id) await tx.source.update({ where: { id: source.id }, data: { currentSourceVersionId: version.id, currentSourceGeneration: generation } });
    const saveReceipt = async (result: KnowledgeSyncResult) => {
      await tx.sourceSyncReceipt.create({ data: { sourceId: source.id, idempotencyKey, inputHash: envelope.contentHash, sourceVersionId: version.id, inputSourceGeneration: generation, resultStatus: result.status, runId: result.runId } });
      return result;
    };
    if (head?.sourceVersionId === version.id) {
      const latestRun = await tx.ingestRun.findFirst({
        where: { sourceId: source.id, inputSourceVersionId: version.id, inputSourceGeneration: generation },
        orderBy: { createdAt: 'desc' }, select: { id: true, status: true },
      });
      if (latestRun && !RETRYABLE_SYNC_RUN_STATUSES.includes(latestRun.status)) return saveReceipt({
        status: FINISHED_RUN_STATUSES.includes(latestRun.status) ? 'noop' : 'existing', sourceId: source.id, sourceVersionId: version.id,
        runId: FINISHED_RUN_STATUSES.includes(latestRun.status) ? null : latestRun.id,
      });
    }
    const run = await tx.ingestRun.create({
      data: {
        sourceId: source.id,
        inputSourceVersionId: version.id,
        inputSourceGeneration: generation,
        spaceId,
        idempotencyKey,
        requestedByUserId: principal.agentId ? undefined : principal.userId,
        requestedByAgentId: principal.agentId,
        requestedScopes: principal.scopes || [],
        requestedCredentialId: principal.credentialId,
        requestedCredentialType: principal.agentId ? 'agent' : principal.credentialId ? 'personal' : 'jwt',
      },
      select: { id: true },
    });
    return saveReceipt({ status: 'queued', sourceId: source.id, sourceVersionId: version.id, runId: run.id });
  }

  private async findReceipt(tx: any, sourceId: string, inputHash: string, idempotencyKey: string): Promise<KnowledgeSyncResult | undefined> {
    const receipt = await tx.sourceSyncReceipt.findUnique({ where: { sourceId_idempotencyKey: { sourceId, idempotencyKey } } });
    if (receipt) {
      if (receipt.inputHash !== inputHash) sourceVersionConflict();
      return { status: receipt.runId ? 'existing' : 'noop', sourceId, sourceVersionId: receipt.sourceVersionId, runId: receipt.runId };
    }
    // Preserve exact pre-migration Run keys; never infer historical no-op receipts.
    const legacy = await tx.ingestRun.findUnique({ where: { sourceId_idempotencyKey: { sourceId, idempotencyKey } }, include: { inputSourceVersion: { select: { contentHash: true, sourceId: true } } } });
    if (!legacy) return undefined;
    if (!legacy.inputSourceVersionId || legacy.inputSourceVersion?.sourceId !== sourceId || legacy.inputSourceVersion.contentHash !== inputHash) sourceVersionConflict();
    await tx.sourceSyncReceipt.create({ data: { sourceId, idempotencyKey, inputHash, sourceVersionId: legacy.inputSourceVersionId, inputSourceGeneration: legacy.inputSourceGeneration ?? null, resultStatus: 'existing', runId: legacy.id } });
    return { status: 'existing', sourceId, sourceVersionId: legacy.inputSourceVersionId, runId: legacy.id };
  }

  private async findConcurrentWinner(spaceId: string, principal: Principal, envelope: NormalizedOkfEnvelope, idempotencyKey: string): Promise<KnowledgeSyncResult | undefined> {
    return this.prisma.$transaction(async tx => {
      await lockSourceMutationSpace(tx, principal, spaceId, ['sources:write', 'runs:write'], this.authorization, this.revisionWriter);
      const source = await tx.source.findUnique({ where: { spaceId_type_sourceKey: { spaceId, type: 'okf', sourceKey: envelope.sourceKey } }, select: { id: true } });
      if (!source) return undefined;
      await lockSourceHead(tx, source.id, spaceId);
      return this.findReceipt(tx, source.id, envelope.contentHash, idempotencyKey);
    });
  }

  private parseEnvelope(file: Buffer): NormalizedOkfEnvelope {
    try {
      return parseOkfEnvelope(file);
    } catch (error) {
      if (error instanceof OkfEnvelopeError) throw new BusinessException(error.code, error.message);
      throw error;
    }
  }

  private assertSourceKey(sourceKey: string) {
    if (!SOURCE_KEY_PATTERN.test(sourceKey)) {
      throw new BusinessException('SOURCE_INVALID', 'sourceKey must contain only letters, numbers, dots, underscores, and hyphens');
    }
  }

  private emptyState(): KnowledgeSyncState {
    return { exists: false, sourceId: null, sourceVersionId: null, syncedAt: null, documents: [] };
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private isPrismaUniqueViolation(error: unknown): error is { code: string } {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
  }
}
