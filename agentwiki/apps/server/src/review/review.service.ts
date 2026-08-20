import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { BusinessException } from '../core/filters/business-error';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { SearchService } from '../core/search/search.service';
 import type { NormalizedKnowledgeBundle } from '../knowledge-pipeline/knowledge-bundle';
import type { SpaceKnowledgeRevision } from '@prisma/client';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';
import { GraphMaintenance } from '../knowledge-graph/graph-maintenance';
import {
  ReadableSyncPathService,
  safeMarkdownBasename,
  syncPathDirectory,
} from '../core/sync/readable-sync-path.service';
import {
  canonicalBytes,
  contentHash as syncContentHash,
  normalizeMarkdown,
  pathKey,
  revisionContentHash,
  validatePortablePath,
  type RevisionContentManifest,
} from '@neomei/agentwiki-sync-protocol';

@Injectable()
export class ReviewService {
  constructor(
    private prisma: PrismaService,
    private search: SearchService,
    private revisionWriter: SpaceRevisionWriterService,
    private syncPaths: ReadableSyncPathService,
    @Optional() private graphMaintenance?: GraphMaintenance,
  ) {}

  async propose(
    principal: { userId: string; agentId?: string; scopes?: string[] },
    spaceId: string,
    title: string,
    item: { type: string; payload: Record<string, unknown> },
  ) {
    // Agent proposals can skip manual review only when the space, the agent,
    // the credential and the per-space grant all opt in. An empty grant scope
    // list deliberately means that the credential is not narrowed further.
    const [space, agent, grant] = await Promise.all([
      this.prisma.space.findUnique({ where: { id: spaceId }, select: { approvalPolicy: true } }),
      principal.agentId
        ? this.prisma.agent.findUnique({ where: { id: principal.agentId }, select: { approvalMode: true } })
        : Promise.resolve(null),
      principal.agentId
        ? this.prisma.agentGrant.findUnique({
          where: { agentId_spaceId: { agentId: principal.agentId, spaceId } },
          select: { scopes: true },
        })
        : Promise.resolve(null),
    ]);
    const grantAllowsAutoPublish = !!grant &&
      (grant.scopes.length === 0 || grant.scopes.includes('review:auto-publish'));
    const autoPublish = !!principal.agentId &&
      space?.approvalPolicy === 'scoped-auto-publish' &&
      agent?.approvalMode === 'scoped-auto-publish' &&
      grantAllowsAutoPublish &&
      (principal.scopes || []).includes('review:auto-publish');

    const changeSet = await this.prisma.changeSet.create({
      data: {
        spaceId,
        title,
        status: autoPublish ? 'approved' : 'pending_review',
        ...(autoPublish ? { reviewedAt: new Date() } : {}),
        createdByUserId: principal.agentId ? undefined : principal.userId,
        createdByAgentId: principal.agentId,
        items: { create: { type: item.type, status: autoPublish ? 'accepted' : 'pending', payload: item.payload as Prisma.InputJsonValue } },
      },
      include: { items: true },
    });

    if (!autoPublish) return { ...changeSet, autoPublished: false };
    const published = await this.publish(changeSet.id);
    return { ...published, autoPublished: true };
  }

  list(spaceIds: string[]) {
    return this.prisma.changeSet.findMany({
      where: { spaceId: { in: spaceIds }, status: { in: ['pending_review', 'approved', 'published', 'reverted', 'rejected'] } },
      include: {
        space: { select: { id: true, name: true } },
        run: { include: { source: { select: { id: true, name: true, type: true, uri: true } } } },
        items: true,
        approvals: { include: { reviewer: { select: { id: true, name: true, email: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(id: string) {
    const changeSet = await this.prisma.changeSet.findUnique({
      where: { id },
      include: {
        space: true,
        run: {
          include: {
            source: true,
            evidences: {
              include: { sourceVersion: { select: { version: true, metadata: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        items: true,
        approvals: { include: { reviewer: { select: { id: true, name: true, email: true } } } },
      },
    });
    if (!changeSet) throw new BusinessException('RESOURCE_NOT_FOUND', 'Change set not found');
    return changeSet;
  }

  async decideItem(changeSetId: string, itemId: string, status: string) {
    const result = await this.prisma.changeItem.updateMany({
      where: { id: itemId, changeSetId, status: 'pending', changeSet: { status: 'pending_review' } },
      data: { status },
    });
    if (!result.count) throw new BusinessException('CHANGESET_INVALID_STATE', 'Change item is no longer pending');
    return { success: true };
  }

  async submitForReview(id: string) {
    const changed = await this.prisma.changeSet.updateMany({
      where: { id, status: 'draft' },
      data: { status: 'pending_review' },
    });
    if (!changed.count) throw new BusinessException('CHANGESET_INVALID_STATE', 'Change set is not in draft state');
    return this.get(id);
  }

  async approve(id: string, reviewerId: string, comment?: string) {
    await this.prisma.$transaction(async (tx) => {
      const [pending, accepted] = await Promise.all([
        tx.changeItem.count({ where: { changeSetId: id, status: 'pending' } }),
        tx.changeItem.count({ where: { changeSetId: id, status: 'accepted' } }),
      ]);
      if (pending > 0) throw new BusinessException('CHANGESET_INVALID_STATE', 'Every change item must be accepted or rejected before approval');
      if (accepted === 0) throw new BadRequestException('At least one change item must be accepted before approval');
      const changed = await tx.changeSet.updateMany({
        where: { id, status: 'pending_review' },
        data: { status: 'approved', reviewedAt: new Date() },
      });
      if (!changed.count) throw new BusinessException('CHANGESET_INVALID_STATE', 'Change set is not pending review');
      await tx.approval.create({ data: { changeSetId: id, reviewerId, decision: 'approved', comment } });
    });
    return this.get(id);
  }

  async reject(id: string, reviewerId: string, comment?: string) {
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.changeSet.updateMany({
        where: { id, status: 'pending_review' },
        data: { status: 'rejected', reviewedAt: new Date() },
      });
      if (!changed.count) throw new BusinessException('CHANGESET_INVALID_STATE', 'Change set is not pending review');
      await tx.approval.create({ data: { changeSetId: id, reviewerId, decision: 'rejected', comment } });
    });
    return this.get(id);
  }

  /**
   * One-shot human review: accept every remaining pending item, approve and
   * publish in a single action. This is the fast path for a reviewer who trusts
   * the whole set; the per-item accept → approve → publish steps remain for
   * selective review.
   */
  async reviewPublish(id: string, reviewerId: string, comment?: string) {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.changeSet.updateMany({
        where: { id, status: 'pending_review' },
        data: { status: 'approved', reviewedAt: new Date() },
      });
      if (!claimed.count) throw new BusinessException('CHANGESET_INVALID_STATE', 'Change set is not pending review');
      await tx.changeItem.updateMany({
        where: { changeSetId: id, status: 'pending' },
        data: { status: 'accepted' },
      });
      const accepted = await tx.changeItem.count({ where: { changeSetId: id, status: 'accepted' } });
      if (accepted === 0) throw new BadRequestException('At least one change item must be accepted before publishing');
      await tx.approval.create({ data: { changeSetId: id, reviewerId, decision: 'approved', comment } });
    });
    return this.publish(id);
  }

  async publish(id: string) {
    const changeSet = await this.get(id);
    if (changeSet.status !== 'approved') throw new BusinessException('APPROVAL_REQUIRED', 'Change set must be approved before publishing');
    const authorId = changeSet.createdByUserId || await this.resolveAgentOwner(changeSet.createdByAgentId);
    const publishedPageIds = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.changeSet.updateMany({
        where: { id, status: 'approved' },
        data: { status: 'publishing' },
      });
      if (!claimed.count) throw new BusinessException('CHANGESET_INVALID_STATE', 'Change set is already being published or is no longer approved');
      const pageIds: string[] = [];
      const pageIdBySourcePath = new Map<string, string>();
      const pageIdByKnowledgeKey = new Map<string, string>();
      const acceptedItems = changeSet.items.filter((candidate) => candidate.status === 'accepted');
      const pageItems = acceptedItems.filter((item) => ['create_page', 'update_page', 'archive_page'].includes(item.type));
      const memoryItems = acceptedItems.filter((item) => ['upsert_space_memory', 'archive_space_memory'].includes(item.type));
      const relationItems = acceptedItems.filter((item) => ['create_relation', 'update_relation', 'archive_relation', 'update_relation_strength'].includes(item.type));
      const lockedTx = pageItems.length > 0
        ? await this.revisionWriter.lockSpace(tx, changeSet.spaceId)
        : null;

      for (const item of pageItems) {
        const payload = item.payload as any;
        let resourceId: string;
        if (item.type === 'create_page') {
          if (payload.parentId) await this.assertValidParent(tx, changeSet.spaceId, payload.parentId);
          const knowledgeKey = payload.knowledgeKey || randomUUID();
          const sourceSyncPath = this.validateSourceSyncPath(payload.sourcePath);
          const createdSyncPath = sourceSyncPath ?? await this.syncPaths.allocate(lockedTx!, {
            spaceId: changeSet.spaceId,
            directory: 'pages',
            title: payload.title,
          });
          const page = await tx.page.create({
            data: {
              spaceId: changeSet.spaceId,
              knowledgeKey,
              authorId,
              title: payload.title,
              slug: payload.slug || this.slugify(payload.title) + '-' + Date.now().toString(36) + '-' + item.id.slice(-4),
              content: payload.content ?? '',
              format: payload.format || 'markdown',
              parentId: payload.parentId,
              sourceChangeSetId: id,
              createdByAgentId: changeSet.createdByAgentId,
              lastChangeSetId: id,
              lastModifiedByAgentId: changeSet.createdByAgentId,
              lastModifiedByUserId: changeSet.createdByAgentId ? null : authorId,
              lastModifiedAt: new Date(),
              sourceId: payload.sourceId,
              sourceVersionId: payload.sourceVersionId,
              sourcePath: payload.sourcePath,
              syncPath: createdSyncPath.path,
              syncPathKey: createdSyncPath.pathKey,
            },
          });
          resourceId = page.id;
          pageIds.push(page.id);
          if (payload.sourcePath) pageIdBySourcePath.set(payload.sourcePath, page.id);
          if (payload.knowledgeKey) pageIdByKnowledgeKey.set(payload.knowledgeKey, page.id);
          if (changeSet.runId) {
            await tx.evidence.updateMany({
              where: {
                runId: changeSet.runId,
                targetPageId: null,
                ...(payload.sourcePath ? { location: { path: ['sourcePath'], equals: payload.sourcePath } } : {}),
              },
              data: { targetPageId: page.id },
            });
          }
        } else if (item.type === 'update_page') {
          const page = await tx.page.findFirst({ where: { id: payload.pageId, spaceId: changeSet.spaceId, deletedAt: null } });
          if (!page) throw new BadRequestException('Updated page must belong to the change set space');
          if (payload.expectedUpdatedAt && page.updatedAt.toISOString() !== payload.expectedUpdatedAt) {
          throw new BusinessException('CHANGESET_INVALID_STATE', 'The page changed after this candidate was compiled; create a new run before publishing');
          }
          const changes = payload.changes || {};
          if (changes.parentId !== undefined) await this.assertValidParent(tx, changeSet.spaceId, changes.parentId, page.id);
          const allocatedPath = changes.title !== undefined
            && safeMarkdownBasename(changes.title) !== safeMarkdownBasename(page.title)
            ? await this.syncPaths.allocate(lockedTx!, {
                spaceId: changeSet.spaceId,
                directory: syncPathDirectory(page.syncPath),
                title: changes.title,
                excludePageId: page.id,
              })
            : null;
          const before = {
            title: page.title, slug: page.slug, content: page.content, parentId: page.parentId,
            format: page.format,
            sourceChangeSetId: page.sourceChangeSetId, createdByAgentId: page.createdByAgentId,
            lastChangeSetId: page.lastChangeSetId, lastModifiedByUserId: page.lastModifiedByUserId,
            lastModifiedByAgentId: page.lastModifiedByAgentId, lastModifiedAt: page.lastModifiedAt,
            sourceId: page.sourceId, sourceVersionId: page.sourceVersionId, sourcePath: page.sourcePath,
            syncPath: page.syncPath, syncPathKey: page.syncPathKey,
          };
          await tx.pageVersion.create({
            data: {
              pageId: page.id,
              title: page.title,
              content: page.content,
              authorId: page.authorId,
              slug: page.slug,
              format: page.format,
              parentId: page.parentId,
              syncPath: page.syncPath,
              syncPathKey: page.syncPathKey,
            },
          });
          await tx.changeItem.update({ where: { id: item.id }, data: { payload: { ...payload, before } } });
          await tx.page.update({
            where: { id: page.id },
            data: {
              ...changes,
              ...(allocatedPath
                ? { syncPath: allocatedPath.path, syncPathKey: allocatedPath.pathKey }
                : {}),
              sourceChangeSetId: page.sourceChangeSetId || id,
              createdByAgentId: page.createdByAgentId || changeSet.createdByAgentId,
              lastChangeSetId: id,
              lastModifiedByAgentId: changeSet.createdByAgentId,
              lastModifiedByUserId: changeSet.createdByAgentId ? null : authorId,
              lastModifiedAt: new Date(),
              sourceId: payload.sourceId ?? page.sourceId,
              sourceVersionId: payload.sourceVersionId ?? page.sourceVersionId,
              sourcePath: payload.sourcePath ?? page.sourcePath,
            },
          });
          resourceId = page.id;
          pageIds.push(page.id);
          if (payload.sourcePath || page.sourcePath) pageIdBySourcePath.set(payload.sourcePath || page.sourcePath!, page.id);
          if (changeSet.runId) {
            await tx.evidence.updateMany({
              where: {
                runId: changeSet.runId,
                targetPageId: null,
                ...((payload.sourcePath || page.sourcePath) ? { location: { path: ['sourcePath'], equals: payload.sourcePath || page.sourcePath } } : {}),
              },
              data: { targetPageId: page.id },
            });
          }
        } else if (item.type === 'archive_page') {
          const page = await tx.page.findFirst({ where: { id: payload.pageId, spaceId: changeSet.spaceId, deletedAt: null } });
          if (!page) throw new BadRequestException('Archived page must belong to the change set space');
          if (payload.expectedUpdatedAt && page.updatedAt.toISOString() !== payload.expectedUpdatedAt) {
          throw new BusinessException('CHANGESET_INVALID_STATE', 'The page changed after this archive candidate was compiled');
          }
          const before = {
            lastChangeSetId: page.lastChangeSetId,
            lastModifiedByUserId: page.lastModifiedByUserId,
            lastModifiedByAgentId: page.lastModifiedByAgentId,
            lastModifiedAt: page.lastModifiedAt.toISOString(),
            deletedAt: page.deletedAt?.toISOString() ?? null,
          };
          await tx.pageVersion.create({
            data: {
              pageId: page.id,
              title: page.title,
              content: page.content,
              authorId: page.authorId,
              slug: page.slug,
              format: page.format,
              parentId: page.parentId,
              syncPath: page.syncPath,
              syncPathKey: page.syncPathKey,
            },
          });
          await tx.changeItem.update({
            where: { id: item.id },
            data: { payload: { ...payload, before } },
          });
          const archived = await tx.page.updateMany({
            where: {
              id: page.id,
              spaceId: changeSet.spaceId,
              deletedAt: null,
              updatedAt: page.updatedAt,
            },
            data: {
              deletedAt: new Date(),
              lastChangeSetId: id,
              lastModifiedByAgentId: changeSet.createdByAgentId,
              lastModifiedByUserId: changeSet.createdByAgentId ? null : authorId,
              lastModifiedAt: new Date(),
            },
          });
          if (!archived.count) {
            throw new BusinessException('CHANGESET_INVALID_STATE', 'The page changed while it was being archived');
          }
          resourceId = page.id;
          pageIds.push(page.id);
        } else {
          throw new BadRequestException(`Unsupported page change item type: ${item.type}`);
        }
        await tx.changeItem.update({ where: { id: item.id }, data: { status: 'published', publishedResourceId: resourceId } });
      }

      for (const item of memoryItems) {
        const payload = item.payload as any;
        if (item.type === 'archive_space_memory') {
          const existing = await tx.agentMemory.findFirst({
            where: { id: payload.memoryId, spaceId: changeSet.spaceId, deletedAt: null },
          });
          if (!existing) throw new BadRequestException('Archived memory must belong to the change set space');
          if (payload.expectedUpdatedAt && existing.updatedAt.toISOString() !== payload.expectedUpdatedAt) {
            throw new BusinessException('CHANGESET_INVALID_STATE', 'The memory changed after this archive candidate was compiled');
          }
          const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...before } = existing;
          await tx.changeItem.update({ where: { id: item.id }, data: { payload: { ...payload, before } } });
          const archived = await tx.agentMemory.updateMany({
            where: {
              id: payload.memoryId,
              spaceId: changeSet.spaceId,
              deletedAt: null,
              updatedAt: existing.updatedAt,
            },
            data: { status: 'archived', archivedAt: new Date(), deletedAt: new Date() },
          });
          if (!archived.count) throw new BusinessException('CHANGESET_INVALID_STATE', 'The memory changed while it was being archived');
          await tx.changeItem.update({ where: { id: item.id }, data: { status: 'published', publishedResourceId: payload.memoryId } });
          continue;
        }
        const existing = await tx.agentMemory.findUnique({ where: { id: payload.knowledgeKey } });
        if (existing && existing.spaceId !== changeSet.spaceId) {
          throw new BadRequestException('Updated memory must belong to the change set space');
        }
        if (existing && payload.expectedUpdatedAt && existing.updatedAt.toISOString() !== payload.expectedUpdatedAt) {
          throw new BusinessException('CHANGESET_INVALID_STATE', 'The memory changed after this candidate was compiled');
        }
        if (!existing && !changeSet.createdByAgentId) {
          throw new BadRequestException('A shared Agent memory requires an Agent author');
        }
        const before = existing
          ? (({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...state }) => state)(existing)
          : null;
        await tx.changeItem.update({ where: { id: item.id }, data: { payload: { ...payload, before } } });
        let memoryId: string;
        if (existing) {
          const updated = await tx.agentMemory.updateMany({
            where: { id: existing.id, spaceId: changeSet.spaceId, updatedAt: existing.updatedAt },
            data: {
              type: payload.key,
              content: payload.value,
              contentHash: payload.contentHash,
              visibility: 'space',
              status: 'active',
              archivedAt: null,
              deletedAt: null,
            },
          });
          if (!updated.count) {
            throw new BusinessException('CHANGESET_INVALID_STATE', 'The memory changed while it was being published');
          }
          memoryId = existing.id;
        } else {
          const memory = await tx.agentMemory.create({
            data: {
              id: payload.knowledgeKey,
              type: payload.key,
              content: payload.value,
              contentHash: payload.contentHash,
              visibility: 'space',
              status: 'active',
              agentId: changeSet.createdByAgentId!,
              spaceId: changeSet.spaceId,
            },
          });
          memoryId = memory.id;
        }
        await tx.changeItem.update({ where: { id: item.id }, data: { status: 'published', publishedResourceId: memoryId } });
      }

      for (const item of relationItems) {
          const payload = item.payload as any;
          if (item.type === 'update_relation') {
            const existing = await tx.knowledgeRelation.findUnique({
              where: { id: payload.relationId },
              include: {
                sourcePage: { select: { spaceId: true } },
                targetPage: { select: { spaceId: true } },
              },
            });
            if (!existing || existing.sourcePage.spaceId !== changeSet.spaceId || existing.targetPage.spaceId !== changeSet.spaceId) {
              throw new BadRequestException('Updated relation must belong to the change set space');
            }
            if (payload.expectedLastModifiedAt && existing.lastModifiedAt.toISOString() !== payload.expectedLastModifiedAt) {
              throw new BusinessException('CHANGESET_INVALID_STATE', 'The relation changed after this candidate was compiled');
            }
            const sourcePageId = pageIdByKnowledgeKey.get(payload.sourceKnowledgeKey)
              || await this.resolvePageByKnowledgeKey(tx, changeSet.spaceId, payload.sourceKnowledgeKey);
            const targetPageId = pageIdByKnowledgeKey.get(payload.targetKnowledgeKey)
              || await this.resolvePageByKnowledgeKey(tx, changeSet.spaceId, payload.targetKnowledgeKey);
            if (!sourcePageId || !targetPageId) throw new BadRequestException('Updated relation page reference is missing');
            if (sourcePageId === targetPageId) throw new BadRequestException('A page cannot relate to itself');
            const { sourcePage: _sourcePage, targetPage: _targetPage, createdAt: _createdAt, ...before } = existing;
            await tx.changeItem.update({ where: { id: item.id }, data: { payload: { ...payload, before } } });
            const updated = await tx.knowledgeRelation.update({
              where: { id: existing.id },
              data: {
                sourcePageId,
                targetPageId,
                relation: payload.relation,
                sourceChangeSetId: id,
                createdByAgentId: existing.createdByAgentId || changeSet.createdByAgentId,
                lastModifiedByUserId: changeSet.createdByAgentId ? null : authorId,
                lastModifiedAt: new Date(),
              },
            });
            await tx.changeItem.update({ where: { id: item.id }, data: { status: 'published', publishedResourceId: updated.id } });
            continue;
          }
          if (item.type === 'archive_relation') {
            const existing = await tx.knowledgeRelation.findUnique({
              where: { id: payload.relationId },
              include: {
                sourcePage: { select: { spaceId: true } },
                targetPage: { select: { spaceId: true } },
              },
            });
            if (!existing || existing.sourcePage.spaceId !== changeSet.spaceId || existing.targetPage.spaceId !== changeSet.spaceId) {
              throw new BadRequestException('Archived relation must belong to the change set space');
            }
            if (payload.expectedLastModifiedAt && existing.lastModifiedAt.toISOString() !== payload.expectedLastModifiedAt) {
          throw new BusinessException('CHANGESET_INVALID_STATE', 'The relation changed after this candidate was compiled');
            }
            const { sourcePage: _sourcePage, targetPage: _targetPage, createdAt: _createdAt, ...before } = existing;
            await tx.changeItem.update({ where: { id: item.id }, data: { payload: { ...payload, before } } });
            await tx.knowledgeRelation.delete({ where: { id: existing.id } });
            if (existing.evidenceId) {
              await tx.evidence.updateMany({ where: { id: existing.evidenceId, targetRelationId: existing.id }, data: { targetRelationId: null } });
            }
           await tx.changeItem.update({ where: { id: item.id }, data: { status: 'published', publishedResourceId: existing.id } });
           continue;
         }
          if (item.type === 'update_relation_strength') {
            const existing = await tx.knowledgeRelation.findUnique({
              where: { id: payload.relationId },
              include: { sourcePage: { select: { spaceId: true } } },
            });
            if (!existing || existing.sourcePage.spaceId !== changeSet.spaceId) {
              throw new BadRequestException('Updated relation must belong to the change set space');
            }
            if (payload.expectedLastModifiedAt && existing.lastModifiedAt.toISOString() !== payload.expectedLastModifiedAt) {
              throw new BusinessException('CHANGESET_INVALID_STATE', 'The relation changed after this candidate was compiled');
            }
            await tx.changeItem.update({ where: { id: item.id }, data: { payload: { ...payload, before: { strength: existing.strength } } } });
            await tx.knowledgeRelation.update({
              where: { id: existing.id },
              data: { strength: payload.strength, lastModifiedAt: new Date() },
            });
            await tx.changeItem.update({ where: { id: item.id }, data: { status: 'published', publishedResourceId: existing.id } });
            continue;
          }
         const sourcePageId = payload.sourcePageId
           || pageIdByKnowledgeKey.get(payload.sourceKnowledgeKey)
           || await this.resolvePageByKnowledgeKey(tx, changeSet.spaceId, payload.sourceKnowledgeKey)
           || await this.resolvePageBySourcePath(tx, changeSet.spaceId, payload.sourcePath, pageIdBySourcePath);
          const targetPageId = payload.targetPageId
            || pageIdByKnowledgeKey.get(payload.targetKnowledgeKey)
            || await this.resolvePageByKnowledgeKey(tx, changeSet.spaceId, payload.targetKnowledgeKey)
            || await this.resolvePageBySourcePath(tx, changeSet.spaceId, payload.targetPath, pageIdBySourcePath);
          if (sourcePageId === targetPageId) throw new BadRequestException('A page cannot relate to itself');
          const pages = await tx.page.findMany({
            where: { id: { in: [sourcePageId, targetPageId] }, deletedAt: null },
            select: { id: true, spaceId: true },
          });
          if (pages.length !== 2 || pages.some((page) => page.spaceId !== changeSet.spaceId)) {
            throw new BadRequestException('Relation pages must both belong to the change set space');
          }
          if (payload.evidenceId) {
            const evidence = await tx.evidence.findUnique({ where: { id: payload.evidenceId }, select: { run: { select: { spaceId: true } } } });
            if (!evidence || evidence.run.spaceId !== changeSet.spaceId) throw new BadRequestException('Relation evidence must belong to the change set space');
          }
          const relation = await tx.knowledgeRelation.create({
            data: {
              sourcePageId,
              targetPageId,
              ...(payload.knowledgeKey ? { knowledgeKey: payload.knowledgeKey } : {}),
              relation: payload.relation,
              strength: payload.strength ?? 1,
              confidence: payload.confidence ?? 1,
              origin: 'compiled',
              sourceChangeSetId: id,
              createdByAgentId: changeSet.createdByAgentId,
              evidenceId: payload.evidenceId,
              lastModifiedAt: new Date(),
            },
          });
          if (payload.evidenceId) await tx.evidence.update({ where: { id: payload.evidenceId }, data: { targetRelationId: relation.id } });
          await tx.changeItem.update({ where: { id: item.id }, data: { status: 'published', publishedResourceId: relation.id } });
      }
      const unsupported = acceptedItems.filter((item) => ![
        'create_page', 'update_page', 'archive_page',
        'upsert_space_memory', 'archive_space_memory',
        'create_relation', 'update_relation', 'archive_relation', 'update_relation_strength',
      ].includes(item.type));
      if (unsupported.length) throw new BadRequestException(`Unsupported change item type: ${unsupported[0].type}`);
      await this.syncLexicalIndex(tx, pageIds);
      await tx.changeSet.updateMany({ where: { id, status: 'publishing' }, data: { status: 'published', publishedAt: new Date() } });
      const needsLegacySidecar = memoryItems.length > 0 || relationItems.length > 0;
      const legacySidecarOverride = needsLegacySidecar
        ? await this.buildLegacySidecar(tx, changeSet.spaceId)
        : undefined;
      const submission = await tx.knowledgeSubmission?.findUnique({ where: { changeSetId: id } });
      if (submission) {
        const revision = await this.createKnowledgeRevision(tx, changeSet.spaceId, submission, id);
        await tx.knowledgeSubmission.update({
          where: { id: submission.id },
          data: { status: 'published', appliedRevisionId: revision.id },
        });
      } else if (pageIds.length > 0) {
        const pages = await tx.page.findMany({
          where: { id: { in: pageIds } },
          select: { knowledgeKey: true, syncPath: true, title: true, content: true, deletedAt: true },
        });
        await this.revisionWriter.advance(tx, changeSet.spaceId, pages.map((p) => p.deletedAt
          ? { operation: 'archive' as const, pageId: p.knowledgeKey, previousPath: p.syncPath ?? undefined }
          : { operation: 'upsert' as const, pageId: p.knowledgeKey, path: p.syncPath ?? undefined, title: p.title, body: p.content },
        ), { origin: 'change_set', sourceChangeSetId: id, createdByUserId: changeSet.createdByUserId, legacySidecarOverride });
      } else if (memoryItems.length > 0 || relationItems.length > 0) {
        // Relation/Memory-only changesets still advance the authoritative
        // revision sequence: they inherit parent page rows and produce an empty
        // sync v1 Delta with the same revisionContentHash.
        await this.revisionWriter.advance(tx, changeSet.spaceId, [], {
          origin: 'change_set',
          sourceChangeSetId: id,
          createdByUserId: changeSet.createdByUserId,
          legacySidecarOverride,
        });
      }
      return Array.from(new Set(pageIds));
    });
    await Promise.allSettled(publishedPageIds.map((pageId) => this.search.indexPage(pageId)));
    this.graphMaintenance?.enqueue(changeSet.spaceId);
    return this.get(id);
  }

  private async createKnowledgeRevision(
    tx: Prisma.TransactionClient,
    spaceId: string,
    submission: { id: string; bundle: unknown; schemaVersion: string; recipeVersion: string; contentHash: string },
    changeSetId: string,
  ): Promise<SpaceKnowledgeRevision> {
    await this.revisionWriter.lockSpace(tx, spaceId);
    const bundle = submission.bundle as NormalizedKnowledgeBundle;
    const submittedPagesById = new Map(bundle.pages.map((page) => [page.pageId, page]));
    const submittedPagesByPath = new Map(bundle.pages.map((page) => [page.path, page]));
    const submittedMemoriesById = new Map(bundle.memories.map((memory) => [memory.memoryId, memory]));
    const submittedRelationsById = new Map(bundle.relations.map((relation) => [relation.relationId, relation]));
    const pages = await tx.page.findMany({
      where: { spaceId, deletedAt: null },
      select: {
        id: true,
        knowledgeKey: true,
        title: true,
        content: true,
        parentId: true,
        sortOrder: true,
        updatedAt: true,
        sourcePath: true,
        syncPath: true,
        syncPathKey: true,
        sourceId: true,
      },
    });
    const memories = await tx.agentMemory.findMany({
      where: { spaceId, deletedAt: null, archivedAt: null },
      select: { id: true, type: true, content: true, updatedAt: true },
    });
    const relations = await tx.knowledgeRelation.findMany({
      where: { sourcePage: { spaceId } },
      select: {
        id: true,
        knowledgeKey: true,
        sourcePageId: true,
        targetPageId: true,
        relation: true,
        strength: true,
        confidence: true,
        lastModifiedAt: true,
      },
    });
    const pageKnowledgeKeyById = new Map(pages.map((page) => [page.id, page.knowledgeKey]));
    const snapshot = {
      schemaVersion: submission.schemaVersion,
      recipeVersion: submission.recipeVersion,
      spaceId,
      baseRevision: bundle.baseRevision,
      pages: pages.map((p) => {
        const submitted = submittedPagesById.get(p.knowledgeKey) ?? (p.sourcePath ? submittedPagesByPath.get(p.sourcePath) : undefined);
        return {
          pageId: p.knowledgeKey,
          spaceId,
          path: p.sourcePath || this.pagePathFromTitle(p.title),
          title: p.title,
          body: p.content,
          order: p.sortOrder ?? 0,
          ...(p.parentId ? { metadata: { parentId: p.parentId } } : {}),
          artifactIds: submitted?.artifactIds ?? [],
          contentHash: createHash('sha256').update(p.content).digest('hex'),
          updatedAt: p.updatedAt.toISOString(),
        };
      }),
      memories: memories.map((m) => {
        const submitted = submittedMemoriesById.get(m.id);
        return {
          memoryId: m.id,
          spaceId,
          key: m.type,
          value: m.content,
          scope: 'space' as const,
          pageIds: [] as string[],
          artifactIds: submitted?.artifactIds ?? [],
          contentHash: createHash('sha256').update(m.content).digest('hex'),
          updatedAt: m.updatedAt.toISOString(),
        };
      }),
      relations: relations.map((r) => ({
        relationId: r.knowledgeKey,
        spaceId,
        sourceId: pageKnowledgeKeyById.get(r.sourcePageId) ?? r.sourcePageId,
        targetId: pageKnowledgeKeyById.get(r.targetPageId) ?? r.targetPageId,
        relationType: r.relation,
        artifactIds: submittedRelationsById.get(r.knowledgeKey)?.artifactIds ?? [],
        metadata: { strength: r.strength, confidence: r.confidence },
      })),
      provenance: bundle.provenance || [],
      deletions: bundle.deletions || [],
    };
    const snapshotJson = JSON.stringify(snapshot);
    const contentHash = createHash('sha256').update(snapshotJson).digest('hex');
    const latest = await tx.spaceKnowledgeRevision.findFirst({
      where: { spaceId },
      orderBy: { sequence: 'desc' },
      select: { id: true, sequence: true },
    });
    const sequence = (latest?.sequence ?? 0) + 1;
    const normalizedPages = [];
    const occupiedPathKeys = new Set<string>();
    for (const page of pages) {
      const body = normalizeMarkdown(page.content);
      const hash = await syncContentHash(body);
      let path: string | undefined = page.syncPath ?? page.sourcePath ?? undefined;
      let key: string | undefined = page.syncPathKey ?? (path ? pathKey(path) : undefined);
      if (!path || occupiedPathKeys.has(key!)) {
        path = `pages/p-${await this.idFileKey(page.knowledgeKey)}.md`;
      }
      key = pathKey(path);
      occupiedPathKeys.add(key);
      normalizedPages.push({
        pageId: page.knowledgeKey,
        path,
        pathKey: key as string,
        title: page.title,
        contentHash: hash,
        body,
        updatedAt: page.updatedAt,
      });
    }
    normalizedPages.sort((a, b) => (a.pageId < b.pageId ? -1 : 1));
    const manifest: RevisionContentManifest = {
      protocolVersion: '1',
      spaceId,
      pages: normalizedPages.map((p) => ({
        pageId: p.pageId,
        path: p.path,
        title: p.title,
        contentHash: p.contentHash,
      })),
    };
    const computedRevisionContentHash = normalizedPages.length === 0
      ? 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      : await revisionContentHash(manifest);
    const manifestBytes = normalizedPages.length === 0 ? 0 : canonicalBytes(manifest).byteLength;
    const revisionBodyBytes = normalizedPages.reduce(
      (sum, p) => sum + new TextEncoder().encode(p.body).byteLength,
      0,
    );
    for (const page of normalizedPages) {
      await tx.syncPageContentRow.upsert({
        where: { contentHash: page.contentHash },
        create: { contentHash: page.contentHash, body: page.body, byteLength: new TextEncoder().encode(page.body).byteLength },
        update: {},
      });
    }
    const created = await tx.spaceKnowledgeRevision.create({
      data: {
        spaceId,
        sequence,
        parentRevisionId: latest?.id ?? null,
        schemaVersion: submission.schemaVersion,
        recipeVersion: submission.recipeVersion,
        contentHash,
        revisionContentHash: computedRevisionContentHash,
        snapshot: Prisma.JsonNull,
        delta: Prisma.JsonNull,
        pageCount: BigInt(normalizedPages.length),
        revisionBodyBytes: BigInt(revisionBodyBytes),
        revisionManifestByteLength: BigInt(manifestBytes),
        origin: 'change_set',
        createdByUserId: null,
        sourceChangeSetId: changeSetId,
      },
    });
    if (normalizedPages.length > 0) {
      await tx.syncRevisionPageRow.createMany({
        data: normalizedPages.map((p) => ({
          revisionId: created.id,
          pageId: p.pageId,
          path: p.path,
          pathKey: p.pathKey,
          title: p.title,
          contentHash: p.contentHash,
          updatedAt: p.updatedAt,
        })),
      });
    }
    // Persist the legacy projection so local-sync remains synthesizable after
    // snapshot/delta become null in Release B.
    for (const [ordinal, page] of (snapshot as any).pages.entries()) {
      const legacyBodyHash = page.contentHash;
      await tx.legacyPageBodyRow.upsert({
        where: { contentHash: legacyBodyHash },
        create: { contentHash: legacyBodyHash, body: page.body },
        update: {},
      });
      await tx.legacyRevisionPageExtra.create({
        data: {
          revisionId: created.id,
          pageId: page.pageId,
          ordinal,
          legacyBodyHash,
          extra: {
            spaceId,
            title: page.title,
            order: page.order ?? ordinal,
            metadata: page.metadata ?? null,
            artifactIds: page.artifactIds ?? [],
            legacyBodyHash,
            contentHash: legacyBodyHash,
            path: page.path,
            updatedAt: page.updatedAt,
          },
        },
      });
    }
    await tx.legacyRevisionSidecar.upsert({
      where: { revisionId: created.id },
      create: {
        revisionId: created.id,
        sidecar: {
          schemaVersion: (snapshot as any).schemaVersion,
          recipeVersion: (snapshot as any).recipeVersion,
          baseRevision: (snapshot as any).baseRevision ?? null,
          memories: (snapshot as any).memories ?? [],
          relations: (snapshot as any).relations ?? [],
          provenance: (snapshot as any).provenance ?? [],
          deletions: (snapshot as any).deletions ?? [],
        },
      },
      update: {},
    });
    return created;
  }

  private async buildLegacySidecar(tx: any, spaceId: string): Promise<Prisma.InputJsonObject> {
    const latest = tx.spaceKnowledgeRevision?.findFirst
      ? await tx.spaceKnowledgeRevision.findFirst({
          where: { spaceId },
          orderBy: { sequence: 'desc' },
          select: { id: true },
        })
      : null;
    const parentSidecar = latest && tx.legacyRevisionSidecar?.findUnique
      ? await tx.legacyRevisionSidecar.findUnique({ where: { revisionId: latest.id } })
      : null;
    const parent = (parentSidecar?.sidecar ?? {}) as Record<string, any>;
    const memories = tx.agentMemory?.findMany
      ? await tx.agentMemory.findMany({
          where: { spaceId, deletedAt: null, archivedAt: null },
          select: { id: true, type: true, content: true, updatedAt: true },
        })
      : [];
    const relations = tx.knowledgeRelation?.findMany
      ? await tx.knowledgeRelation.findMany({
          where: { sourcePage: { spaceId } },
          select: {
            id: true,
            knowledgeKey: true,
            sourcePageId: true,
            targetPageId: true,
            relation: true,
            strength: true,
            confidence: true,
            lastModifiedAt: true,
          },
        })
      : [];
    const pageKnowledgeKeyById = new Map<string, string>();
    const pages = tx.page?.findMany
      ? await tx.page.findMany({
          where: { spaceId, deletedAt: null },
          select: { id: true, knowledgeKey: true },
        })
      : [];
    for (const page of pages) pageKnowledgeKeyById.set(page.id, page.knowledgeKey);
    return {
      schemaVersion: parent.schemaVersion ?? 'knowledge-bundle@1',
      recipeVersion: parent.recipeVersion ?? 'none',
      baseRevision: parent.baseRevision ?? null,
      memories: memories.map((m: any) => ({
        memoryId: m.id,
        spaceId,
        key: m.type,
        value: m.content,
        scope: 'space' as const,
        pageIds: [] as string[],
        artifactIds: [] as string[],
        contentHash: createHash('sha256').update(m.content).digest('hex'),
        updatedAt: m.updatedAt.toISOString(),
      })),
      relations: relations.map((r: any) => ({
        relationId: r.knowledgeKey,
        spaceId,
        sourceId: pageKnowledgeKeyById.get(r.sourcePageId) ?? r.sourcePageId,
        targetId: pageKnowledgeKeyById.get(r.targetPageId) ?? r.targetPageId,
        relationType: r.relation,
        artifactIds: [] as string[],
        metadata: { strength: r.strength, confidence: r.confidence },
      })),
      provenance: parent.provenance ?? [],
      deletions: parent.deletions ?? [],
    } as Prisma.InputJsonObject;
  }
  private async idFileKey(id: string): Promise<string> {
    const { idFileKey } = await import('@neomei/agentwiki-sync-protocol');
    return idFileKey(id);
  }

  private validateSourceSyncPath(
    sourcePath: unknown,
  ): { path: string; pathKey: string } | null {
    if (typeof sourcePath !== 'string') return null;
    try {
      const validated = validatePortablePath(sourcePath);
      return { path: validated.path, pathKey: validated.key };
    } catch {
      return null;
    }
  }

  private pagePathFromTitle(title: string): string {
    const slug = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
    return `pages/${slug}.md`;
  }

  async revert(id: string) {
    const changeSet = await this.get(id);
    if (changeSet.status !== 'published') throw new BadRequestException('Only published change sets can be reverted');
    const publishedAt = changeSet.publishedAt;
    if (!publishedAt) throw new BusinessException('CHANGESET_CONFLICT', 'Published change set is missing its publication timestamp');
    const affectedPageIds = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.changeSet.updateMany({ where: { id, status: 'published' }, data: { status: 'reverting' } });
      if (!claimed.count) throw new BusinessException('CHANGESET_INVALID_STATE', 'Change set is already being reverted or is no longer published');
      const pageItemTypes = new Set(['create_page', 'update_page', 'archive_page']);
      const hasPageRevert = changeSet.items.some(
        (item) => pageItemTypes.has(item.type) && item.publishedResourceId,
      );
      if (hasPageRevert) {
        await this.revisionWriter.lockSpace(tx, changeSet.spaceId);
      }
      const snapshotPage = async (where: Prisma.PageWhereInput, itemType: string) => {
        const page = await tx.page.findFirst({ where });
        if (!page) {
          throw new BusinessException('CHANGESET_CONFLICT', `Cannot revert ${itemType}: the published resource was changed later`);
        }
        await tx.pageVersion.create({
          data: {
            pageId: page.id,
            title: page.title,
            content: page.content ?? '',
            authorId: page.authorId,
            slug: page.slug,
            format: page.format,
            parentId: page.parentId,
            syncPath: page.syncPath,
            syncPathKey: page.syncPathKey,
          },
        });
      };
      const pageIds: string[] = [];
      for (const item of changeSet.items) {
        if (!item.publishedResourceId) continue;
        if (item.type === 'create_page') {
          const where = {
            id: item.publishedResourceId,
            spaceId: changeSet.spaceId,
            sourceChangeSetId: id,
            lastChangeSetId: id,
            deletedAt: null,
            updatedAt: { lte: publishedAt },
          };
          await snapshotPage(where, item.type);
          const reverted = await tx.page.updateMany({
            where,
            data: { deletedAt: new Date() },
          });
          this.assertRevertMutation(reverted.count, item.type);
          pageIds.push(item.publishedResourceId);
        } else if (item.type === 'update_page') {
          const payload = item.payload as any;
          if (!payload.before) throw new BadRequestException('Update change is missing its prior page state');
          const where = {
            id: item.publishedResourceId,
            spaceId: changeSet.spaceId,
            lastChangeSetId: id,
            deletedAt: null,
            updatedAt: { lte: publishedAt },
          };
          await snapshotPage(where, item.type);
          const reverted = await tx.page.updateMany({
            where,
            data: payload.before,
          });
          this.assertRevertMutation(reverted.count, item.type);
          pageIds.push(item.publishedResourceId);
        } else if (item.type === 'archive_page') {
          const payload = item.payload as any;
          if (!payload.before) throw new BadRequestException('Archived page is missing its prior state');
          const where = {
            id: item.publishedResourceId,
            spaceId: changeSet.spaceId,
            lastChangeSetId: id,
            deletedAt: { not: null },
            updatedAt: { lte: publishedAt },
          };
          await snapshotPage(where, item.type);
          const restoredState = {
            ...payload.before,
            deletedAt: payload.before.deletedAt === null || payload.before.deletedAt === undefined
              ? null
              : new Date(payload.before.deletedAt),
            ...(payload.before.lastModifiedAt === undefined
              ? {}
              : { lastModifiedAt: new Date(payload.before.lastModifiedAt) }),
          };
          const reverted = await tx.page.updateMany({
            where,
            data: restoredState,
          });
          this.assertRevertMutation(reverted.count, item.type);
          pageIds.push(item.publishedResourceId);
        } else if (item.type === 'upsert_space_memory') {
          const payload = item.payload as any;
          const reverted = payload.before
            ? await tx.agentMemory.updateMany({
              where: {
                id: item.publishedResourceId,
                spaceId: changeSet.spaceId,
                updatedAt: { lte: publishedAt },
              },
              data: payload.before,
            })
            : await tx.agentMemory.updateMany({
              where: {
                id: item.publishedResourceId,
                spaceId: changeSet.spaceId,
                updatedAt: { lte: publishedAt },
              },
              data: { status: 'archived', archivedAt: new Date(), deletedAt: new Date() },
            });
          this.assertRevertMutation(reverted.count, item.type);
        } else if (item.type === 'archive_space_memory') {
          const payload = item.payload as any;
          if (!payload.before) throw new BadRequestException('Archived memory is missing its prior state');
          const reverted = await tx.agentMemory.updateMany({
            where: {
              id: item.publishedResourceId,
              spaceId: changeSet.spaceId,
              updatedAt: { lte: publishedAt },
            },
            data: payload.before,
          });
          this.assertRevertMutation(reverted.count, item.type);
        } else if (item.type === 'create_relation') {
          const reverted = await tx.knowledgeRelation.deleteMany({
            where: {
              id: item.publishedResourceId,
              sourceChangeSetId: id,
              lastModifiedAt: { lte: publishedAt },
            },
          });
          this.assertRevertMutation(reverted.count, item.type);
          const payload = item.payload as any;
          if (payload.evidenceId) {
            await tx.evidence.updateMany({ where: { id: payload.evidenceId, targetRelationId: item.publishedResourceId }, data: { targetRelationId: null } });
          }
        } else if (item.type === 'archive_relation') {
          const payload = item.payload as any;
          if (!payload.before) throw new BadRequestException('Archived relation is missing its prior state');
          const reverted = await tx.knowledgeRelation.createMany({
            data: { ...payload.before, id: item.publishedResourceId },
            skipDuplicates: true,
          });
          this.assertRevertMutation(reverted.count, item.type);
          if (payload.before.evidenceId) {
            const relinked = await tx.evidence.updateMany({
              where: { id: payload.before.evidenceId, targetRelationId: null },
              data: { targetRelationId: item.publishedResourceId },
            });
          this.assertRevertMutation(relinked.count, item.type);
          }
        } else if (item.type === 'update_relation_strength') {
          const payload = item.payload as any;
          if (!payload.before) throw new BadRequestException('Updated relation is missing its prior strength');
          const reverted = await tx.knowledgeRelation.updateMany({
            where: { id: item.publishedResourceId, lastModifiedAt: { lte: publishedAt } },
            data: { strength: payload.before.strength },
          });
          this.assertRevertMutation(reverted.count, item.type);
        } else if (item.type === 'update_relation') {
          const payload = item.payload as any;
          if (!payload.before) throw new BadRequestException('Updated relation is missing its prior state');
          const { id: _id, ...before } = payload.before;
          const reverted = await tx.knowledgeRelation.updateMany({
            where: {
              id: item.publishedResourceId,
              sourceChangeSetId: id,
              lastModifiedAt: { lte: publishedAt },
            },
            data: before,
          });
          this.assertRevertMutation(reverted.count, item.type);
        } else {
          throw new BadRequestException(`Unsupported reverted change item type: ${item.type}`);
        }
        await tx.changeItem.update({ where: { id: item.id }, data: { status: 'reverted' } });
      }
      await this.syncLexicalIndex(tx, pageIds);
      await tx.changeSet.updateMany({ where: { id, status: 'reverting' }, data: { status: 'reverted', revertedAt: new Date() } });
      const nonPageTypes = new Set([
        'upsert_space_memory',
        'archive_space_memory',
        'create_relation',
        'update_relation',
        'archive_relation',
        'update_relation_strength',
      ]);
      const hasNonPageRevert = changeSet.items.some(
        (item) => nonPageTypes.has(item.type) && item.publishedResourceId,
      );
      const legacySidecarOverride = hasNonPageRevert
        ? await this.buildLegacySidecar(tx, changeSet.spaceId)
        : undefined;
      if (pageIds.length > 0) {
        const pages = await tx.page.findMany({
          where: { id: { in: pageIds } },
          select: { knowledgeKey: true, syncPath: true, title: true, content: true, deletedAt: true },
        });
        await this.revisionWriter.advance(tx, changeSet.spaceId, pages.map((p) => p.deletedAt
          ? { operation: 'archive' as const, pageId: p.knowledgeKey, previousPath: p.syncPath ?? undefined }
          : { operation: 'upsert' as const, pageId: p.knowledgeKey, path: p.syncPath ?? undefined, title: p.title, body: p.content },
        ), { origin: 'change_set', sourceChangeSetId: id, legacySidecarOverride });
      } else if (hasNonPageRevert) {
        await this.revisionWriter.advance(tx, changeSet.spaceId, [], {
          origin: 'change_set',
          sourceChangeSetId: id,
          legacySidecarOverride,
        });
      }
      return pageIds;
    });
    await Promise.allSettled(affectedPageIds.map((pageId) => this.search.indexPage(pageId)));
    return this.get(id);
  }

  private assertRevertMutation(count: number, itemType: string) {
    if (count !== 1) {
      throw new BusinessException('CHANGESET_CONFLICT', `Cannot revert ${itemType}: the published resource was changed later`);
    }
  }

  private async assertValidParent(
    tx: Prisma.TransactionClient,
    spaceId: string,
    parentId?: string | null,
    currentPageId?: string,
  ) {
    if (!parentId) return;
    let cursor: string | null = parentId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === currentPageId) throw new BadRequestException('Page hierarchy cannot contain a cycle');
      if (visited.has(cursor)) throw new BadRequestException('Existing page hierarchy contains a cycle');
      visited.add(cursor);
      const page: { spaceId: string; parentId: string | null } | null = await tx.page.findUnique({
        where: { id: cursor, deletedAt: null },
        select: { spaceId: true, parentId: true },
      });
      if (!page || page.spaceId !== spaceId) throw new BadRequestException('Parent page must belong to the change set space');
      cursor = page.parentId;
    }
  }

  private async resolvePageBySourcePath(
    tx: Prisma.TransactionClient,
    spaceId: string,
    sourcePath: string | undefined,
    created: Map<string, string>,
  ) {
    if (!sourcePath) throw new BadRequestException('Relation page reference is missing');
    const createdId = created.get(sourcePath);
    if (createdId) return createdId;
    const page = await tx.page.findFirst({ where: { spaceId, sourcePath, deletedAt: null }, select: { id: true } });
    if (!page) throw new BadRequestException(`Relation page not found for source path: ${sourcePath}`);
    return page.id;
  }

  private async resolvePageByKnowledgeKey(
    tx: Prisma.TransactionClient,
    spaceId: string,
    knowledgeKey: string | undefined,
  ): Promise<string | undefined> {
    if (!knowledgeKey) return undefined;
    const page = await tx.page.findFirst({
      where: { spaceId, knowledgeKey, deletedAt: null },
      select: { id: true },
    });
    return page?.id;
  }

  private async syncLexicalIndex(tx: Prisma.TransactionClient, pageIds: string[]) {
    for (const pageId of new Set(pageIds)) {
      const page = await tx.page.findUnique({
        where: { id: pageId },
        select: { title: true, content: true, deletedAt: true },
      });
      if (!page || page.deletedAt) {
        await tx.pageSearchDocument.deleteMany({ where: { pageId } });
        continue;
      }
      const text = `${page.title}\n${page.content ?? ''}`;
      await tx.pageSearchDocument.upsert({
        where: { pageId },
        create: { pageId, text, contentHash: createHash('sha256').update(text).digest('hex') },
        update: { text, contentHash: createHash('sha256').update(text).digest('hex'), indexedAt: new Date() },
      });
    }
  }

  private async resolveAgentOwner(agentId?: string | null) {
    if (!agentId) throw new BadRequestException('Change set has no author');
    const agent = await this.prisma.agent.findUnique({ where: { id: agentId }, select: { ownerId: true } });
    if (!agent) throw new BadRequestException('Agent owner no longer exists');
    return agent.ownerId;
  }

  private slugify(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'generated';
  }
}
