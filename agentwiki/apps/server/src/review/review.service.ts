import { BadRequestException, Injectable } from '@nestjs/common';
import { BusinessException } from '../core/filters/business-error';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { SearchService } from '../core/search/search.service';

@Injectable()
export class ReviewService {
  constructor(
    private prisma: PrismaService,
    private search: SearchService,
  ) {}

  async propose(
    principal: { userId: string; agentId?: string; scopes?: string[] },
    spaceId: string,
    title: string,
    item: { type: string; payload: Record<string, unknown> },
  ) {
    // Agent proposals can skip manual review only when the space, the agent and
    // the credential all opt in to scoped auto-publish. Anything less stays in
    // pending_review for a human to approve.
    const [space, agent] = await Promise.all([
      this.prisma.space.findUnique({ where: { id: spaceId }, select: { approvalPolicy: true } }),
      principal.agentId
        ? this.prisma.agent.findUnique({ where: { id: principal.agentId }, select: { approvalMode: true } })
        : Promise.resolve(null),
    ]);
    const autoPublish = !!principal.agentId &&
      space?.approvalPolicy === 'scoped-auto-publish' &&
      agent?.approvalMode === 'scoped-auto-publish' &&
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
      const acceptedItems = changeSet.items.filter((candidate) => candidate.status === 'accepted');
      const pageItems = acceptedItems.filter((item) => ['create_page', 'update_page', 'archive_page'].includes(item.type));
      const relationItems = acceptedItems.filter((item) => ['create_relation', 'archive_relation'].includes(item.type));

      for (const item of pageItems) {
        const payload = item.payload as any;
        let resourceId: string;
        if (item.type === 'create_page') {
          if (payload.parentId) await this.assertValidParent(tx, changeSet.spaceId, payload.parentId);
          const page = await tx.page.create({
            data: {
              spaceId: changeSet.spaceId,
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
            },
          });
          resourceId = page.id;
          pageIds.push(page.id);
          if (payload.sourcePath) pageIdBySourcePath.set(payload.sourcePath, page.id);
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
          const before = {
            title: page.title, slug: page.slug, content: page.content, parentId: page.parentId,
            format: page.format,
            sourceChangeSetId: page.sourceChangeSetId, createdByAgentId: page.createdByAgentId,
            lastChangeSetId: page.lastChangeSetId, lastModifiedByUserId: page.lastModifiedByUserId,
            lastModifiedByAgentId: page.lastModifiedByAgentId, lastModifiedAt: page.lastModifiedAt,
            sourceId: page.sourceId, sourceVersionId: page.sourceVersionId, sourcePath: page.sourcePath,
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
            },
          });
          await tx.changeItem.update({ where: { id: item.id }, data: { payload: { ...payload, before } } });
          await tx.page.update({
            where: { id: page.id },
            data: {
              ...changes,
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
          await tx.changeItem.update({ where: { id: item.id }, data: { payload: { ...payload, before: { deletedAt: page.deletedAt } } } });
          await tx.page.update({
            where: { id: page.id },
            data: {
              deletedAt: new Date(),
              lastChangeSetId: id,
              lastModifiedByAgentId: changeSet.createdByAgentId,
              lastModifiedByUserId: changeSet.createdByAgentId ? null : authorId,
              lastModifiedAt: new Date(),
            },
          });
          resourceId = page.id;
          pageIds.push(page.id);
        } else {
          throw new BadRequestException(`Unsupported page change item type: ${item.type}`);
        }
        await tx.changeItem.update({ where: { id: item.id }, data: { status: 'published', publishedResourceId: resourceId } });
      }

      for (const item of relationItems) {
          const payload = item.payload as any;
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
          const sourcePageId = payload.sourcePageId || await this.resolvePageBySourcePath(tx, changeSet.spaceId, payload.sourcePath, pageIdBySourcePath);
          const targetPageId = payload.targetPageId || await this.resolvePageBySourcePath(tx, changeSet.spaceId, payload.targetPath, pageIdBySourcePath);
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
              relation: payload.relation,
              strength: payload.strength || 1,
              confidence: payload.confidence || 1,
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
      const unsupported = acceptedItems.filter((item) => !['create_page', 'update_page', 'archive_page', 'create_relation', 'archive_relation'].includes(item.type));
      if (unsupported.length) throw new BadRequestException(`Unsupported change item type: ${unsupported[0].type}`);
      await this.syncLexicalIndex(tx, pageIds);
      await tx.changeSet.updateMany({ where: { id, status: 'publishing' }, data: { status: 'published', publishedAt: new Date() } });
      return Array.from(new Set(pageIds));
    });
    await Promise.allSettled(publishedPageIds.map((pageId) => this.search.indexPage(pageId)));
    return this.get(id);
  }

  async revert(id: string) {
    const changeSet = await this.get(id);
    if (changeSet.status !== 'published') throw new BadRequestException('Only published change sets can be reverted');
    const publishedAt = changeSet.publishedAt;
    if (!publishedAt) throw new BusinessException('CHANGESET_CONFLICT', 'Published change set is missing its publication timestamp');
    const affectedPageIds = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.changeSet.updateMany({ where: { id, status: 'published' }, data: { status: 'reverting' } });
      if (!claimed.count) throw new BusinessException('CHANGESET_INVALID_STATE', 'Change set is already being reverted or is no longer published');
      const pageIds: string[] = [];
      for (const item of changeSet.items) {
        if (!item.publishedResourceId) continue;
        if (item.type === 'create_page') {
          const reverted = await tx.page.updateMany({
            where: {
              id: item.publishedResourceId,
              spaceId: changeSet.spaceId,
              sourceChangeSetId: id,
              lastChangeSetId: id,
              deletedAt: null,
              updatedAt: { lte: publishedAt },
            },
            data: { deletedAt: new Date() },
          });
          this.assertRevertMutation(reverted.count, item.type);
          pageIds.push(item.publishedResourceId);
        } else if (item.type === 'update_page') {
          const payload = item.payload as any;
          if (!payload.before) throw new BadRequestException('Update change is missing its prior page state');
          const reverted = await tx.page.updateMany({
            where: {
              id: item.publishedResourceId,
              spaceId: changeSet.spaceId,
              lastChangeSetId: id,
              deletedAt: null,
              updatedAt: { lte: publishedAt },
            },
            data: payload.before,
          });
          this.assertRevertMutation(reverted.count, item.type);
          pageIds.push(item.publishedResourceId);
        } else if (item.type === 'archive_page') {
          const payload = item.payload as any;
          const reverted = await tx.page.updateMany({
            where: {
              id: item.publishedResourceId,
              spaceId: changeSet.spaceId,
              lastChangeSetId: id,
              deletedAt: { not: null },
              updatedAt: { lte: publishedAt },
            },
            data: { deletedAt: payload.before?.deletedAt || null },
          });
          this.assertRevertMutation(reverted.count, item.type);
          pageIds.push(item.publishedResourceId);
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
        }
        await tx.changeItem.update({ where: { id: item.id }, data: { status: 'reverted' } });
      }
      await this.syncLexicalIndex(tx, pageIds);
      await tx.changeSet.updateMany({ where: { id, status: 'reverting' }, data: { status: 'reverted', revertedAt: new Date() } });
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
