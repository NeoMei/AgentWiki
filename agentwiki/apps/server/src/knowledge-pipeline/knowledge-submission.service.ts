import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ReviewService } from '../review/review.service';
import { BusinessException } from '../core/filters/business-error';
import { parseKnowledgeBundle, NormalizedKnowledgeBundle } from './knowledge-bundle';
import { AuthorizationService, Principal } from '../core/authorization/authorization.service';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';

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
    private readonly revisionWriter: SpaceRevisionWriterService,
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
    const requiredScopes = this.deriveRequiredScopes(bundle);
    for (const requiredScope of requiredScopes) {
      await this.auth.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor'], requiredScope);
    }

    const principalKey = principal.agentId ? `credential:${principal.credentialId ?? 'unknown'}` : `user:${principal.userId}`;

    return this.prisma.$transaction(async (tx) => {
      const lockedTx = await this.revisionWriter.lockContentTreeSpace(tx, spaceId);
      if (!lockedTx) throw new BusinessException('RESOURCE_NOT_FOUND');
      await this.auth.assertLiveAgentWriteAccess(lockedTx, principal, spaceId, requiredScopes);
      const currentRevision = await this.currentRevisionHead(lockedTx, spaceId);
      if (bundle.baseRevision !== currentRevision.revisionId) {
        throw new BusinessException('KNOWLEDGE_BASE_STALE', `Current revision is ${currentRevision.revisionId}`);
      }

      const existing = await lockedTx.knowledgeSubmission.findUnique({
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

      const items = await this.compileChangeItems(
        lockedTx,
        bundle,
        lockedTx.contentTreeRevision.toString(),
      );
      if (items.length === 0) {
        return { status: 'noop', submissionId: '', changeSetId: null, currentRevision: currentRevision.revisionId };
      }

      const title = `Knowledge submission from ${principalKey}`;
      const changeSet = await lockedTx.changeSet.create({
        data: {
          spaceId,
          title,
          status: 'pending_review',
          createdByUserId: principal.agentId ? undefined : principal.userId,
          createdByAgentId: principal.agentId,
          items: { create: items },
        },
      });

      const submission = await lockedTx.knowledgeSubmission.create({
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

      await lockedTx.changeSet.update({
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

  private deriveRequiredScopes(bundle: NormalizedKnowledgeBundle): string[] {
    const scopes = new Set<string>();
    if (bundle.pages.length || bundle.deletions.some((d) => d.itemType === 'page')) scopes.add('pages:write');
    if (bundle.memories.length || bundle.deletions.some((d) => d.itemType === 'memory')) scopes.add('memory:write');
    if (bundle.relations.length || bundle.deletions.some((d) => d.itemType === 'relation')) scopes.add('graph:write');
    if (scopes.size === 0) scopes.add('pages:write');
    return [...scopes];
  }

  private async compileChangeItems(
    tx: Prisma.TransactionClient,
    bundle: NormalizedKnowledgeBundle,
    expectedTreeRevision: string,
  ): Promise<Array<{ type: string; status: 'pending'; payload: any }>> {
    const items: Array<{ type: string; status: 'pending'; payload: any }> = [];
    const pageIds = [
      ...bundle.pages.map((page) => page.pageId),
      ...bundle.deletions.filter((item) => item.itemType === 'page').map((item) => item.itemId),
    ];
    const sourcePaths = bundle.pages.map((page) => page.path);
    const existingPages = pageIds.length === 0 ? [] : await tx.page.findMany({
      where: {
        spaceId: bundle.spaceId,
        deletedAt: null,
        OR: [{ knowledgeKey: { in: pageIds } }, { sourcePath: { in: sourcePaths } }],
      },
      select: { id: true, knowledgeKey: true, sourcePath: true, title: true, content: true, updatedAt: true },
    });
    const existingById = new Map(existingPages.map((page) => [page.knowledgeKey, page]));
    const existingByPath = new Map(existingPages.filter((page) => page.sourcePath).map((page) => [page.sourcePath as string, page]));
    const memoryIds = [
      ...bundle.memories.map((memory) => memory.memoryId),
      ...bundle.deletions.filter((item) => item.itemType === 'memory').map((item) => item.itemId),
    ];
    const existingMemories = memoryIds.length === 0 ? [] : await tx.agentMemory.findMany({
      where: { id: { in: memoryIds }, spaceId: bundle.spaceId, deletedAt: null },
      select: { id: true, type: true, content: true, contentHash: true, updatedAt: true },
    });
    const existingMemoryById = new Map(existingMemories.map((memory) => [memory.id, memory]));
    const relationIds = [
      ...bundle.relations.map((relation) => relation.relationId),
      ...bundle.deletions.filter((item) => item.itemType === 'relation').map((item) => item.itemId),
    ];
    const existingRelations = relationIds.length === 0 ? [] : await tx.knowledgeRelation.findMany({
      where: { knowledgeKey: { in: relationIds }, sourcePage: { spaceId: bundle.spaceId } },
      select: {
        id: true, knowledgeKey: true, relation: true, lastModifiedAt: true,
        sourcePage: { select: { knowledgeKey: true } },
        targetPage: { select: { knowledgeKey: true } },
      },
    });
    const existingRelationById = new Map(existingRelations.map((relation) => [relation.knowledgeKey, relation]));
    for (const page of bundle.pages) {
      const existing = existingById.get(page.pageId) ?? existingByPath.get(page.path);
      if (existing) {
        if (existing.title === page.title && existing.content === page.body && existing.sourcePath === page.path) continue;
        items.push({
          type: 'update_page',
          status: 'pending',
          payload: {
            pageId: existing.id,
            expectedUpdatedAt: existing.updatedAt.toISOString(),
            expectedTreeRevision,
            changes: { title: page.title, content: page.body },
            sourcePath: page.path,
          },
        });
        continue;
      }
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
          expectedTreeRevision,
        },
      });
    }
    for (const memory of bundle.memories) {
      const existing = existingMemoryById.get(memory.memoryId);
      if (existing && existing.type === memory.key && existing.content === memory.value && existing.contentHash === memory.contentHash) continue;
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
          ...(existing ? { expectedUpdatedAt: existing.updatedAt.toISOString() } : {}),
        },
      });
    }
    for (const relation of bundle.relations) {
      const existing = existingRelationById.get(relation.relationId);
      if (
        existing
        && existing.relation === relation.relationType
        && existing.sourcePage.knowledgeKey === relation.sourceId
        && existing.targetPage.knowledgeKey === relation.targetId
      ) continue;
      if (existing) {
        items.push({
          type: 'update_relation',
          status: 'pending',
          payload: {
            relationId: existing.id,
            knowledgeKey: relation.relationId,
            expectedLastModifiedAt: existing.lastModifiedAt.toISOString(),
            sourceKnowledgeKey: relation.sourceId,
            targetKnowledgeKey: relation.targetId,
            relation: relation.relationType,
            artifactIds: relation.artifactIds,
          },
        });
        continue;
      }
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
      const payload = del.itemType === 'page'
        ? (() => {
          const page = existingById.get(del.itemId);
          return page ? {
            pageId: page.id,
            expectedUpdatedAt: page.updatedAt.toISOString(),
            expectedTreeRevision,
            knowledgeKey: del.itemId,
            reason: del.reason,
          } : null;
        })()
        : del.itemType === 'memory'
          ? (() => {
            const memory = existingMemoryById.get(del.itemId);
            return memory ? {
              memoryId: del.itemId,
              expectedUpdatedAt: memory.updatedAt.toISOString(),
              knowledgeKey: del.itemId,
              reason: del.reason,
            } : null;
          })()
          : (() => {
            const relation = existingRelationById.get(del.itemId);
            return relation ? { relationId: relation.id, expectedLastModifiedAt: relation.lastModifiedAt.toISOString(), knowledgeKey: del.itemId, reason: del.reason } : null;
          })();
      if (payload) items.push({ type: map[del.itemType], status: 'pending', payload });
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
