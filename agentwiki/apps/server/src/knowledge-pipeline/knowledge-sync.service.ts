import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { AuditService } from '../core/security/audit.service';
import { PrismaService } from '../database/prisma.service';
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
      result = await this.prisma.$transaction((tx) => this.persistSync(tx, spaceId, principal, envelope, idempotencyKey));
    } catch (error: unknown) {
      if (!this.isPrismaUniqueViolation(error)) throw error;
      const winner = await this.findConcurrentWinner(spaceId, envelope, idempotencyKey);
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
      update: {
        name: envelope.name,
        contentHash: this.hash(envelope.sourceKey),
        config: { kind: envelope.kind, producer: envelope.producer },
      },
      select: { id: true },
    });

    const idempotentRun = await tx.ingestRun.findUnique({
      where: { sourceId_idempotencyKey: { sourceId: source.id, idempotencyKey } },
      select: { id: true, inputSourceVersionId: true },
    });
    if (idempotentRun?.inputSourceVersionId) {
      return { status: 'existing', sourceId: source.id, sourceVersionId: idempotentRun.inputSourceVersionId, runId: idempotentRun.id };
    }

    let version = await tx.sourceVersion.findFirst({
      where: { sourceId: source.id, contentHash: envelope.contentHash },
      select: { id: true },
    });
    if (version) {
      const latestRun = await tx.ingestRun.findFirst({
        where: { sourceId: source.id, inputSourceVersionId: version.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true },
      });
      if (latestRun && !RETRYABLE_SYNC_RUN_STATUSES.includes(latestRun.status)) {
        if (FINISHED_RUN_STATUSES.includes(latestRun.status)) {
          return { status: 'noop', sourceId: source.id, sourceVersionId: version.id, runId: null };
        }
        return { status: 'existing', sourceId: source.id, sourceVersionId: version.id, runId: latestRun.id };
      }
    } else {
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

    const run = await tx.ingestRun.create({
      data: {
        sourceId: source.id,
        inputSourceVersionId: version.id,
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
    return { status: 'queued', sourceId: source.id, sourceVersionId: version.id, runId: run.id };
  }

  private async findConcurrentWinner(
    spaceId: string,
    envelope: NormalizedOkfEnvelope,
    idempotencyKey: string,
  ): Promise<KnowledgeSyncResult | undefined> {
    const source = await this.prisma.source.findUnique({
      where: { spaceId_type_sourceKey: { spaceId, type: 'okf', sourceKey: envelope.sourceKey } },
      select: { id: true },
    });
    if (!source) return undefined;

    const idempotentRun = await this.prisma.ingestRun.findUnique({
      where: { sourceId_idempotencyKey: { sourceId: source.id, idempotencyKey } },
      select: { id: true, inputSourceVersionId: true },
    });
    if (idempotentRun?.inputSourceVersionId) {
      return { status: 'existing', sourceId: source.id, sourceVersionId: idempotentRun.inputSourceVersionId, runId: idempotentRun.id };
    }

    const version = await this.prisma.sourceVersion.findFirst({
      where: { sourceId: source.id, contentHash: envelope.contentHash },
      select: { id: true },
    });
    if (!version) return undefined;
    const latestRun = await this.prisma.ingestRun.findFirst({
      where: { sourceId: source.id, inputSourceVersionId: version.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true },
    });
    if (!latestRun) return undefined;
    if (FINISHED_RUN_STATUSES.includes(latestRun.status)) {
      return { status: 'noop', sourceId: source.id, sourceVersionId: version.id, runId: null };
    }
    if (!RETRYABLE_SYNC_RUN_STATUSES.includes(latestRun.status)) {
      return { status: 'existing', sourceId: source.id, sourceVersionId: version.id, runId: latestRun.id };
    }
    return undefined;
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
