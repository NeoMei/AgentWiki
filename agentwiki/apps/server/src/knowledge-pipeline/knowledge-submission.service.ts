import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ReviewService } from '../review/review.service';
import { BusinessException } from '../core/filters/business-error';
import { parseKnowledgeBundle, NormalizedKnowledgeBundle } from './knowledge-bundle';
import { AuthorizationService, Principal } from '../core/authorization/authorization.service';

export interface KnowledgeSubmissionResult {
  status: 'pending_review' | 'published' | 'noop' | 'existing';
  submissionId: string;
  changeSetId: string | null;
  currentRevision: string;
}

export interface SubmitPrincipal extends Principal {
  credentialId?: string;
}

@Injectable()
export class KnowledgeSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly review: ReviewService,
    private readonly auth: AuthorizationService,
  ) {}

  async submit(
    spaceId: string,
    principal: SubmitPrincipal,
    raw: Buffer,
    idempotencyKey: string,
    confirmed: boolean,
  ): Promise<KnowledgeSubmissionResult> {
    if (!confirmed) {
      throw new BusinessException('SYNC_CONFIRMATION_REQUIRED');
    }
    const bundle = parseKnowledgeBundle(raw);
    if (bundle.spaceId !== spaceId) {
      throw new BusinessException('KNOWLEDGE_BUNDLE_INVALID', 'Bundle spaceId does not match route');
    }
    const requiredScope = this.deriveRequiredScope(bundle);
    await this.auth.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor'], requiredScope);

    const principalKey = principal.agentId ? `credential:${principal.credentialId ?? 'unknown'}` : `user:${principal.userId}`;

    return this.prisma.$transaction(async (tx) => {
      const currentRevision = await this.currentRevisionHead(tx, spaceId);
      if (bundle.baseRevision !== currentRevision.revisionId) {
        throw new BusinessException('KNOWLEDGE_BASE_STALE', `Current revision is ${currentRevision.revisionId}`);
      }

      const existing = await tx.knowledgeSubmission.findUnique({
        where: { spaceId_principalKey_idempotencyKey: { spaceId, principalKey, idempotencyKey } },
      });
      if (existing) {
        return {
          status: existing.status === 'published' ? 'existing' : (existing.status as any),
          submissionId: existing.id,
          changeSetId: existing.changeSetId,
          currentRevision: currentRevision.revisionId,
        };
      }

      const items = this.compileChangeItems(bundle);
      if (items.length === 0) {
        return { status: 'noop', submissionId: '', changeSetId: null, currentRevision: currentRevision.revisionId };
      }

      const title = `Knowledge submission from ${principalKey}`;
      const changeSet = await tx.changeSet.create({
        data: {
          spaceId,
          title,
          status: 'pending_review',
          createdByUserId: principal.agentId ? undefined : principal.userId,
          createdByAgentId: principal.agentId,
          items: { create: items },
        },
      });

      const submission = await tx.knowledgeSubmission.create({
        data: {
          spaceId,
          baseRevisionId: bundle.baseRevision,
          principalKey,
          idempotencyKey,
          schemaVersion: bundle.schemaVersion,
          recipeVersion: bundle.recipeVersion,
          contentHash: bundle.contentHash,
          bundle: bundle as unknown as Prisma.InputJsonValue,
          status: 'pending_review',
          changeSetId: changeSet.id,
        },
      });

      await tx.changeSet.update({
        where: { id: changeSet.id },
        data: { knowledgeSubmission: { connect: { id: submission.id } } },
      });

      return { status: 'pending_review', submissionId: submission.id, changeSetId: changeSet.id, currentRevision: currentRevision.revisionId };
    });
  }

  async getSubmission(spaceId: string, submissionId: string): Promise<KnowledgeSubmissionResult | null> {
    const submission = await this.prisma.knowledgeSubmission.findUnique({
      where: { id: submissionId },
      include: { appliedRevision: { select: { id: true, sequence: true, contentHash: true } } },
    });
    if (!submission || submission.spaceId !== spaceId) {
      throw new BusinessException('RESOURCE_NOT_FOUND');
    }
    return {
      status: submission.status as KnowledgeSubmissionResult['status'],
      submissionId: submission.id,
      changeSetId: submission.changeSetId,
      currentRevision: submission.appliedRevisionId ?? submission.baseRevisionId ?? '0',
    };
  }

  private deriveRequiredScope(bundle: NormalizedKnowledgeBundle): string {
    if (bundle.pages.length || bundle.deletions.some((d) => d.itemType === 'page')) return 'pages:write';
    if (bundle.memories.length || bundle.deletions.some((d) => d.itemType === 'memory')) return 'memory:write';
    if (bundle.relations.length || bundle.deletions.some((d) => d.itemType === 'relation')) return 'graph:write';
    return 'pages:write';
  }

  private compileChangeItems(bundle: NormalizedKnowledgeBundle): Array<{ type: string; status: 'pending'; payload: any }> {
    const items: Array<{ type: string; status: 'pending'; payload: any }> = [];
    for (const page of bundle.pages) {
      items.push({
        type: 'create_page',
        status: 'pending',
        payload: {
          knowledgeKey: page.pageId,
          title: page.title,
          slug: page.path.replace(/^\//, '').replace(/\//g, '-'),
          content: page.body,
          format: 'markdown',
          sourcePath: page.path,
        },
      });
    }
    for (const memory of bundle.memories) {
      items.push({
        type: 'upsert_space_memory',
        status: 'pending',
        payload: {
          knowledgeKey: memory.memoryId,
          key: memory.key,
          value: memory.value,
          scope: memory.scope,
          pageIds: memory.pageIds ?? [],
          artifactIds: memory.artifactIds,
          contentHash: memory.contentHash,
        },
      });
    }
    for (const relation of bundle.relations) {
      items.push({
        type: 'create_relation',
        status: 'pending',
        payload: {
          knowledgeKey: relation.relationId,
          sourceKnowledgeKey: relation.sourceId,
          targetKnowledgeKey: relation.targetId,
          relation: relation.relationType,
          artifactIds: relation.artifactIds,
        },
      });
    }
    for (const del of bundle.deletions) {
      const map: Record<string, string> = { page: 'archive_page', memory: 'archive_space_memory', relation: 'archive_relation' };
      items.push({ type: map[del.itemType], status: 'pending', payload: { knowledgeKey: del.itemId, reason: del.reason } });
    }
    return items;
  }

  private async currentRevisionHead(tx: Prisma.TransactionClient, spaceId: string): Promise<{ revisionId: string; sequence: number }> {
    const latest = await tx.spaceKnowledgeRevision.findFirst({
      where: { spaceId },
      orderBy: { sequence: 'desc' },
      select: { id: true, sequence: true },
    });
    if (!latest) return { revisionId: '0', sequence: 0 };
    return { revisionId: latest.id, sequence: latest.sequence };
  }
}
