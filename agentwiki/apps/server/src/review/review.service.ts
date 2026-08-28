import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { BusinessException } from '../core/filters/business-error';
import type { Principal } from '../core/authorization/authorization.service';
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
  type SpaceLockedTransaction,
} from '../core/sync/readable-sync-path.service';
import { ContentTreeService } from '../content-tree/content-tree.service';
import { ContentTreeError } from '../content-tree/content-tree.types';
import {
  canonicalBytes,
  contentHash as syncContentHash,
  agentRoleAllowsScope,
  normalizeMarkdown,
  pathKey,
  revisionContentHash,
  type RevisionContentManifest,
} from '@neomei/agentwiki-sync-protocol';
import {
  lockLiveAgentAuthorization,
  lockLiveAgentAuthorizationAcrossSpaceBoundary,
  type LockedAgentAuthorization,
} from '../core/authorization/live-agent-authorization';

interface AgentAutoPublishContext {
  ownerId?: string;
  agentId: string;
  credentialId: string;
}

@Injectable()
export class ReviewService {
  constructor(
    private prisma: PrismaService,
    private search: SearchService,
    private revisionWriter: SpaceRevisionWriterService,
    private syncPaths: ReadableSyncPathService,
    @Optional() private graphMaintenance?: GraphMaintenance,
    private contentTree?: ContentTreeService,
  ) {}

  private requireContentTree(): ContentTreeService {
    if (!this.contentTree) {
      throw new Error('ContentTreeService is required for Review Page mutations');
    }
    return this.contentTree;
  }

  async propose(
    principal: Principal,
    spaceId: string,
    title: string,
    item: { type: string; payload: Record<string, unknown> },
  ) {
    const autoPublishContext = principal.agentId && principal.credentialId
      ? { ownerId: principal.userId, agentId: principal.agentId, credentialId: principal.credentialId }
      : null;
    const requiredScopes = this.requiredScopesForItems([item]);
    const createChangeSet = (
      db: PrismaService | Prisma.TransactionClient,
      autoPublish: boolean,
    ) => db.changeSet.create({
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

    let autoPublish = false;
    let changeSet;
    if (principal.agentId) {
      if (!autoPublishContext || !requiredScopes) {
        throw new BusinessException('SPACE_ACCESS_DENIED', 'Agent proposal authorization is unavailable');
      }
      ({ changeSet, autoPublish } = await this.prisma.$transaction(async (tx) => {
        // The request principal is only an authentication snapshot. Lock and
        // revalidate the bound Credential, Grant, Agent owner, and Space in the
        // same transaction that creates the ChangeSet so revocation cannot race
        // the write. Auto-publish is then derived from those locked rows.
        const liveAuthorization = await this.assertLiveAgentProposalAccess(
          tx, autoPublishContext, spaceId, requiredScopes,
        );
        const canAutoPublish = this.hasAgentAutoPublishAccess(
          liveAuthorization, requiredScopes,
        );
        return {
          changeSet: await createChangeSet(tx, canAutoPublish),
          autoPublish: canAutoPublish,
        };
      }));
    } else {
      changeSet = await createChangeSet(this.prisma, false);
    }

    if (!autoPublish) return { ...changeSet, autoPublished: false };
    const published = await this.publish(changeSet.id, autoPublishContext);
    return { ...published, autoPublished: published.status === 'published' };
  }

  async list(spaceIds: string[]) {
    const changeSets = await this.prisma.changeSet.findMany({
      where: { spaceId: { in: spaceIds }, status: { in: ['pending_review', 'approved', 'published', 'reverted', 'rejected'] } },
      include: {
        space: { select: { id: true, name: true } },
        run: { include: { source: { select: { id: true, name: true, type: true, uri: true } } } },
        items: true,
        approvals: { include: { reviewer: { select: { id: true, name: true, email: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const priority: Record<string, number> = {
      pending_review: 0,
      approved: 1,
      published: 2,
      rejected: 3,
      reverted: 4,
    };
    return changeSets.sort((left, right) =>
      (priority[left.status] ?? 99) - (priority[right.status] ?? 99) ||
      right.createdAt.getTime() - left.createdAt.getTime(),
    );
  }

  async countPending(spaceIds: string[]) {
    const pending = await this.prisma.changeSet.count({
      where: { spaceId: { in: spaceIds }, status: 'pending_review' },
    });
    return { pending };
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

  async publish(id: string, autoPublishContext?: AgentAutoPublishContext | null) {
    const changeSet = await this.get(id);
    if (['draft', 'pending_review'].includes(changeSet.status)) {
      throw new BusinessException('APPROVAL_REQUIRED', 'Change set must be approved before publishing');
    }
    if (changeSet.status !== 'approved') {
      throw new BusinessException('CHANGESET_INVALID_STATE', 'Change set is already being published or is no longer approved');
    }
    const authorId = changeSet.createdByUserId || await this.resolveAgentOwner(changeSet.createdByAgentId);
    const liveAutoPublishContext = autoPublishContext
      ? { ...autoPublishContext, ownerId: autoPublishContext.ownerId ?? authorId }
      : null;
    const acceptedItems = changeSet.items.filter((candidate) => candidate.status === 'accepted');
    const pageItems = acceptedItems.filter((item) => ['create_page', 'update_page', 'archive_page'].includes(item.type));
    const memoryItems = acceptedItems.filter((item) => ['upsert_space_memory', 'archive_space_memory'].includes(item.type));
    const relationItems = acceptedItems.filter((item) => ['create_relation', 'update_relation', 'archive_relation', 'update_relation_strength'].includes(item.type));
    const requestedTreeRevisions = Array.from(new Set(pageItems.flatMap((item) => {
      const payload = item.payload as any;
      const value = payload.expectedTreeRevision ?? payload.changes?.expectedTreeRevision;
      const changes = payload.changes ?? {};
      const structural = item.type === 'create_page'
        || item.type === 'archive_page'
        || changes.title !== undefined
        || changes.folderId !== undefined;
      if (value === undefined) {
        if (structural) {
          throw new ContentTreeError(
            'CONTENT_TREE_CONFLICT',
            'Every structural Page review item must carry an expected content-tree revision',
          );
        }
        return [];
      }
      if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) {
        throw new ContentTreeError(
          'CONTENT_TREE_CONFLICT',
          'The review proposal carries an invalid content-tree revision',
        );
      }
      return [value];
    })));
    if (requestedTreeRevisions.length > 1) {
      throw new ContentTreeError(
        'CONTENT_TREE_CONFLICT',
        'The review proposal mixes content-tree revisions',
      );
    }
    const requestedTreeRevision = requestedTreeRevisions[0] === undefined
      ? undefined
      : BigInt(requestedTreeRevisions[0]);
    let publication: { pageIds: string[]; authorizationLost: boolean };
    try {
      publication = await this.prisma.$transaction(async (tx) => {
      const acquireSpaceMutationLock = () => pageItems.length > 0
        ? this.requireContentTree().lockPageMutationSpace(
          tx,
          changeSet.spaceId,
          requestedTreeRevision,
        )
        : this.revisionWriter.lockSpace(tx, changeSet.spaceId);
      let lockedTx: Prisma.TransactionClient;
      if (liveAutoPublishContext) {
        const requiredScopes = this.requiredScopesForItems(changeSet.items);
        const lockedAuthorization = changeSet.createdByAgentId === liveAutoPublishContext.agentId &&
          !!liveAutoPublishContext.ownerId &&
          !!requiredScopes
          ? await lockLiveAgentAuthorizationAcrossSpaceBoundary(
            tx,
            {
              ownerId: liveAutoPublishContext.ownerId,
              agentId: liveAutoPublishContext.agentId,
              credentialId: liveAutoPublishContext.credentialId,
            },
            changeSet.spaceId,
            (state) => this.hasAgentAutoPublishAccess(state, requiredScopes),
            acquireSpaceMutationLock,
          )
          : null;
        if (!lockedAuthorization) {
          const demoted = await tx.changeSet.updateMany({
            where: { id, status: 'approved' },
            data: { status: 'pending_review', reviewedAt: null },
          });
          if (!demoted.count) {
            throw new BusinessException('CHANGESET_INVALID_STATE', 'Change set is no longer eligible for auto-publish');
          }
          await tx.changeItem.updateMany({
            where: { changeSetId: id, status: 'accepted' },
            data: { status: 'pending' },
          });
          return { pageIds: [], authorizationLost: true };
        }
        lockedTx = lockedAuthorization.spaceLock;
      } else {
        lockedTx = await acquireSpaceMutationLock();
      }
      const claimed = await tx.changeSet.updateMany({
        where: { id, status: 'approved' },
        data: { status: 'publishing' },
      });
      if (!claimed.count) throw new BusinessException('CHANGESET_INVALID_STATE', 'Change set is already being published or is no longer approved');
      const pageIds: string[] = [];
      const pageIdBySourcePath = new Map<string, string>();
      const pageIdByKnowledgeKey = new Map<string, string>();
      const expectedTreeRevision = pageItems.length > 0
        ? requestedTreeRevision ?? (lockedTx as any).contentTreeRevision
        : 0n;
      const structuralPageMutation = pageItems.some((item) => {
        if (item.type === 'create_page' || item.type === 'archive_page') return true;
        const changes = (item.payload as any).changes ?? {};
        return changes.title !== undefined || changes.folderId !== undefined;
      });
      if (relationItems.some((item) => item.type === 'create_relation')) {
        await tx.spaceGraphState.upsert({
          where: { spaceId: changeSet.spaceId },
          create: { spaceId: changeSet.spaceId },
          update: {},
        });
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "SpaceGraphState" WHERE "spaceId" = ${changeSet.spaceId} FOR UPDATE
        `);
      }

      for (const item of pageItems) {
        const payload = item.payload as any;
        let resourceId: string;
        let publishedItemType = item.type;
        if (item.type === 'create_page') {
          let targetFolderId = payload.folderId ?? null;
          if (payload.parentId !== undefined) {
            if (
              payload.folderId !== undefined
              || process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE !== 'true'
            ) {
              throw new ContentTreeError(
                'PAGE_PARENT_DEPRECATED',
                'Legacy Page parent placement cannot be mapped safely',
              );
            }
            targetFolderId = payload.parentId === null
              ? null
              : await this.requireContentTree().mapLegacyPageParent(
                lockedTx as any,
                changeSet.spaceId,
                payload.parentId,
              );
          }
          const existingSourcePage = payload.sourceId && payload.sourcePath
            ? await tx.page.findFirst({
                where: {
                  spaceId: changeSet.spaceId,
                  sourceId: payload.sourceId,
                  sourcePath: payload.sourcePath,
                },
              })
            : null;
          if (existingSourcePage && !existingSourcePage.deletedAt) {
            throw new BusinessException('CHANGESET_CONFLICT', 'An active page already uses this source path');
          }
          if (existingSourcePage) {
            if (existingSourcePage.deletionBatchId) {
              throw new ContentTreeError(
                'FOLDER_RESTORE_CONFLICT',
                'Page belongs to a Folder deletion batch; restore the deletion batch first',
              );
            }
            publishedItemType = 'update_page';
            const placement = await this.requireContentTree().preparePageMutation(lockedTx as any, {
              spaceId: changeSet.spaceId,
              pageId: existingSourcePage.id,
              title: payload.title,
              folderId: targetFolderId,
              current: {
                title: existingSourcePage.title,
                folderId: existingSourcePage.folderId ?? null,
                syncPath: existingSourcePage.syncPath,
                syncPathKey: existingSourcePage.syncPathKey,
                sortOrder: existingSourcePage.sortOrder ?? 0,
                createdAt: existingSourcePage.createdAt ?? existingSourcePage.updatedAt,
                updatedAt: existingSourcePage.updatedAt,
                knowledgeKey: existingSourcePage.knowledgeKey,
                content: existingSourcePage.content,
              },
            });
            await tx.pageVersion.create({
              data: {
                pageId: existingSourcePage.id,
                title: existingSourcePage.title,
                content: existingSourcePage.content,
                authorId: existingSourcePage.authorId,
                slug: existingSourcePage.slug,
                format: existingSourcePage.format,
                parentId: existingSourcePage.parentId,
                folderId: existingSourcePage.folderId ?? null,
                syncPath: existingSourcePage.syncPath,
                syncPathKey: existingSourcePage.syncPathKey,
              },
            });
            await tx.changeItem.update({
              where: { id: item.id },
              data: {
                payload: {
                  ...payload,
                  before: {
                    restoredFromArchive: true,
                    title: existingSourcePage.title,
                    slug: existingSourcePage.slug,
                    content: existingSourcePage.content,
                    format: existingSourcePage.format,
                    parentId: existingSourcePage.parentId,
                    folderId: existingSourcePage.folderId ?? null,
                    deletedAt: existingSourcePage.deletedAt!.toISOString(),
                    deletionBatchId: existingSourcePage.deletionBatchId ?? null,
                    sourceChangeSetId: existingSourcePage.sourceChangeSetId,
                    createdByAgentId: existingSourcePage.createdByAgentId,
                    lastChangeSetId: existingSourcePage.lastChangeSetId,
                    lastModifiedByUserId: existingSourcePage.lastModifiedByUserId,
                    lastModifiedByAgentId: existingSourcePage.lastModifiedByAgentId,
                    lastModifiedAt: existingSourcePage.lastModifiedAt.toISOString(),
                    sourceId: existingSourcePage.sourceId,
                    sourceVersionId: existingSourcePage.sourceVersionId,
                    sourcePath: existingSourcePage.sourcePath,
                    syncPath: existingSourcePage.syncPath,
                    syncPathKey: existingSourcePage.syncPathKey,
                  },
                },
              },
            });
            const restored = await tx.page.updateMany({
              where: {
                id: existingSourcePage.id,
                spaceId: changeSet.spaceId,
                deletedAt: existingSourcePage.deletedAt,
                updatedAt: existingSourcePage.updatedAt,
              },
              data: {
                title: payload.title,
                content: payload.content ?? '',
                format: payload.format || 'markdown',
                parentId: null,
                folderId: placement.folderId,
                deletedAt: null,
                deletionBatchId: null,
                sourceChangeSetId: existingSourcePage.sourceChangeSetId,
                createdByAgentId: existingSourcePage.createdByAgentId,
                lastChangeSetId: id,
                lastModifiedByAgentId: changeSet.createdByAgentId,
                lastModifiedByUserId: changeSet.createdByAgentId ? null : authorId,
                lastModifiedAt: new Date(),
                sourceId: payload.sourceId,
                sourceVersionId: payload.sourceVersionId,
                sourcePath: payload.sourcePath,
                syncPath: placement.syncPath,
                syncPathKey: placement.syncPathKey,
              },
            });
            if (restored.count !== 1) {
              throw new BusinessException('CHANGESET_CONFLICT', 'The archived source page was restored by another operation');
            }
            resourceId = existingSourcePage.id;
            pageIdByKnowledgeKey.set(existingSourcePage.knowledgeKey, existingSourcePage.id);
          } else {
            const knowledgeKey = payload.knowledgeKey || randomUUID();
            const pageId = randomUUID();
            const placement = await this.requireContentTree().placePage(lockedTx as any, {
              spaceId: changeSet.spaceId,
              pageId,
              title: payload.title,
              folderId: targetFolderId,
            });
            const page = await tx.page.create({
              data: {
                id: pageId,
                spaceId: changeSet.spaceId,
                knowledgeKey,
                authorId,
                title: payload.title,
                slug: payload.slug || this.slugify(payload.title) + '-' + Date.now().toString(36) + '-' + item.id.slice(-4),
                content: payload.content ?? '',
                format: payload.format || 'markdown',
                parentId: null,
                folderId: placement.folderId,
                sourceChangeSetId: id,
                createdByAgentId: changeSet.createdByAgentId,
                lastChangeSetId: id,
                lastModifiedByAgentId: changeSet.createdByAgentId,
                lastModifiedByUserId: changeSet.createdByAgentId ? null : authorId,
                lastModifiedAt: new Date(),
                sourceId: payload.sourceId,
                sourceVersionId: payload.sourceVersionId,
                sourcePath: payload.sourcePath,
                syncPath: placement.syncPath,
                syncPathKey: placement.syncPathKey,
              },
            });
            resourceId = page.id;
          }
          pageIds.push(resourceId);
          if (payload.sourcePath) pageIdBySourcePath.set(payload.sourcePath, resourceId);
          if (payload.knowledgeKey) pageIdByKnowledgeKey.set(payload.knowledgeKey, resourceId);
          if (changeSet.runId) {
            await tx.evidence.updateMany({
              where: {
                runId: changeSet.runId,
                targetPageId: null,
                ...(payload.sourcePath ? { location: { path: ['sourcePath'], equals: payload.sourcePath } } : {}),
              },
              data: { targetPageId: resourceId },
            });
          }
        } else if (item.type === 'update_page') {
          const page = await tx.page.findFirst({ where: { id: payload.pageId, spaceId: changeSet.spaceId, deletedAt: null } });
          if (!page) throw new BadRequestException('Updated page must belong to the change set space');
          if (payload.expectedUpdatedAt && page.updatedAt.toISOString() !== payload.expectedUpdatedAt) {
            throw new BusinessException('CHANGESET_INVALID_STATE', 'The page changed after this candidate was compiled; create a new run before publishing');
          }
          const changes = payload.changes || {};
          if (changes.parentId !== undefined) {
            throw new ContentTreeError(
              'PAGE_PARENT_DEPRECATED',
              'Legacy Page parent placement cannot be mapped safely',
            );
          }
          const {
            expectedTreeRevision: _expectedTreeRevision,
            folderId: requestedFolderId,
            ...pageChanges
          } = changes;
          const structural = changes.title !== undefined || changes.folderId !== undefined;
          const placement = structural
            ? await this.requireContentTree().preparePageMutation(lockedTx as any, {
              spaceId: changeSet.spaceId,
              pageId: page.id,
              title: changes.title ?? page.title,
              folderId: requestedFolderId === undefined ? (page.folderId ?? null) : requestedFolderId,
              current: {
                title: page.title,
                folderId: page.folderId ?? null,
                syncPath: page.syncPath,
                syncPathKey: page.syncPathKey,
                sortOrder: page.sortOrder ?? 0,
                createdAt: page.createdAt ?? page.updatedAt,
                updatedAt: page.updatedAt,
                knowledgeKey: page.knowledgeKey,
                content: page.content,
              },
            })
            : {
              folderId: page.folderId ?? null,
              syncPath: page.syncPath,
              syncPathKey: page.syncPathKey,
            };
          const before = {
            title: page.title, slug: page.slug, content: page.content, parentId: page.parentId,
            folderId: page.folderId ?? null, format: page.format,
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
              folderId: page.folderId ?? null,
              syncPath: page.syncPath,
              syncPathKey: page.syncPathKey,
            },
          });
          await tx.changeItem.update({ where: { id: item.id }, data: { payload: { ...payload, before } } });
          const updated = await tx.page.updateMany({
            where: { id: page.id, spaceId: changeSet.spaceId, deletedAt: null, updatedAt: page.updatedAt },
            data: {
              ...pageChanges,
              ...(structural
                ? {
                  parentId: null,
                  folderId: placement.folderId,
                  ...(placement.syncPathKey === page.syncPathKey
                    ? {}
                    : {
                      syncPath: placement.syncPath,
                      syncPathKey: placement.syncPathKey,
                    }),
                }
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
          if (updated.count !== 1) {
            throw new BusinessException('CHANGESET_CONFLICT', 'The page changed while this change set was being published');
          }
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
            title: page.title,
            slug: page.slug,
            content: page.content,
            format: page.format,
            parentId: page.parentId,
            folderId: page.folderId ?? null,
            syncPath: page.syncPath,
            syncPathKey: page.syncPathKey,
            sourceChangeSetId: page.sourceChangeSetId ?? null,
            createdByAgentId: page.createdByAgentId ?? null,
            lastChangeSetId: page.lastChangeSetId,
            lastModifiedByUserId: page.lastModifiedByUserId,
            lastModifiedByAgentId: page.lastModifiedByAgentId,
            lastModifiedAt: page.lastModifiedAt.toISOString(),
            sourceId: page.sourceId ?? null,
            sourceVersionId: page.sourceVersionId ?? null,
            sourcePath: page.sourcePath ?? null,
            deletedAt: null,
            deletionBatchId: page.deletionBatchId ?? null,
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
              folderId: page.folderId ?? null,
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
        await tx.changeItem.update({
          where: { id: item.id },
          data: {
            ...(publishedItemType === item.type ? {} : { type: publishedItemType }),
            status: 'published',
            publishedResourceId: resourceId,
          },
        });
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
            const updated = await tx.knowledgeRelation.updateMany({
              where: { id: existing.id, lastModifiedAt: existing.lastModifiedAt },
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
            if (updated.count !== 1) throw new BusinessException('CHANGESET_CONFLICT', 'The relation changed while this change set was being published');
            await tx.changeItem.update({ where: { id: item.id }, data: { status: 'published', publishedResourceId: existing.id } });
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
            const archived = await tx.knowledgeRelation.deleteMany({ where: { id: existing.id, lastModifiedAt: existing.lastModifiedAt } });
            if (archived.count !== 1) throw new BusinessException('CHANGESET_CONFLICT', 'The relation changed while this archive was being published');
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
            const updated = await tx.knowledgeRelation.updateMany({
              where: { id: existing.id, lastModifiedAt: existing.lastModifiedAt },
              data: { strength: payload.strength, lastModifiedAt: new Date() },
            });
            if (updated.count !== 1) throw new BusinessException('CHANGESET_CONFLICT', 'The relation changed while its strength was being published');
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
          const relationData = {
            sourcePageId,
            targetPageId,
            ...(payload.knowledgeKey ? { knowledgeKey: payload.knowledgeKey } : {}),
            relation: payload.relation,
            strength: payload.strength ?? 1,
            confidence: payload.confidence ?? 1,
            origin: payload.origin === 'auto_llm' ? 'auto_llm' : 'compiled',
            sourceChangeSetId: id,
            createdByAgentId: changeSet.createdByAgentId,
            evidenceId: payload.evidenceId,
            lastModifiedAt: new Date(),
          };
          let relation: { id: string };
          if (payload.origin === 'auto_llm') {
            const relationId = randomUUID();
            const creation = await tx.knowledgeRelation.createMany({
              data: { id: relationId, ...relationData },
              skipDuplicates: true,
            });
            if (!creation.count) {
              await tx.changeItem.update({ where: { id: item.id }, data: { status: 'rejected' } });
              continue;
            }
            relation = { id: relationId };
          } else {
            const existing = await tx.knowledgeRelation.findUnique({
              where: {
                sourcePageId_targetPageId_relation: {
                  sourcePageId,
                  targetPageId,
                  relation: payload.relation,
                },
              },
              select: { id: true, origin: true },
            });
            relation = existing?.origin.startsWith('auto_')
              ? await tx.knowledgeRelation.update({
                where: { id: existing.id },
                data: { ...relationData, origin: 'compiled' },
              })
              : await tx.knowledgeRelation.create({ data: relationData });
          }
          if (payload.evidenceId) await tx.evidence.update({ where: { id: payload.evidenceId }, data: { targetRelationId: relation.id } });
          await tx.changeItem.update({ where: { id: item.id }, data: { status: 'published', publishedResourceId: relation.id } });
      }
      const unsupported = acceptedItems.filter((item) => ![
        'create_page', 'update_page', 'archive_page',
        'upsert_space_memory', 'archive_space_memory',
        'create_relation', 'update_relation', 'archive_relation', 'update_relation_strength',
      ].includes(item.type));
      if (unsupported.length) throw new BadRequestException(`Unsupported change item type: ${unsupported[0].type}`);
      await tx.changeSet.updateMany({ where: { id, status: 'publishing' }, data: { status: 'published', publishedAt: new Date() } });
      const needsLegacySidecar = memoryItems.length > 0 || relationItems.length > 0;
      const legacySidecarOverride = needsLegacySidecar
        ? await this.buildLegacySidecar(tx, changeSet.spaceId)
        : undefined;
      const submission = await tx.knowledgeSubmission?.findUnique({ where: { changeSetId: id } });
      if (submission) {
        const revision = await this.createKnowledgeRevision(
          lockedTx as SpaceLockedTransaction,
          changeSet.spaceId,
          submission,
          id,
        );
        if (pageIds.length > 0) {
          await this.requireContentTree().advancePageMutation(lockedTx as any, {
            spaceId: changeSet.spaceId,
            expectedTreeRevision,
            structural: structuralPageMutation,
            changes: [],
            actor: changeSet.createdByAgentId
              ? { agentId: changeSet.createdByAgentId }
              : { userId: changeSet.createdByUserId ?? authorId },
            existingSyncRevisionId: revision.id,
          });
        }
        await tx.knowledgeSubmission.update({
          where: { id: submission.id },
          data: { status: 'published', appliedRevisionId: revision.id },
        });
      } else if (pageIds.length > 0) {
        const pages = await tx.page.findMany({
          where: { id: { in: pageIds } },
          select: {
            knowledgeKey: true,
            folderId: true,
            syncPath: true,
            title: true,
            content: true,
            deletedAt: true,
          },
        });
        await this.requireContentTree().advancePageMutation(lockedTx as any, {
          spaceId: changeSet.spaceId,
          expectedTreeRevision,
          structural: structuralPageMutation,
          changes: pages.map((page) => page.deletedAt
            ? {
              operation: 'archive' as const,
              pageId: page.knowledgeKey,
              previousPath: page.syncPath ?? undefined,
            }
            : {
              operation: 'upsert' as const,
              pageId: page.knowledgeKey,
              folderId: page.folderId,
              path: page.syncPath,
              title: page.title,
              body: page.content,
            }),
          actor: changeSet.createdByAgentId
            ? { agentId: changeSet.createdByAgentId }
            : { userId: changeSet.createdByUserId ?? authorId },
          revisionOrigin: {
            sourceChangeSetId: id,
            legacySidecarOverride,
          },
        });
      } else if (memoryItems.length > 0 || relationItems.length > 0) {
        // Relation/Memory-only changesets still advance the authoritative
        // revision sequence: they inherit parent page rows and produce an empty
        // sync v1 Delta with the same revisionContentHash.
        await this.revisionWriter.advanceLocked(
          lockedTx as SpaceLockedTransaction,
          changeSet.spaceId,
          [],
          {
            origin: 'change_set',
            sourceChangeSetId: id,
            createdByUserId: changeSet.createdByUserId,
            legacySidecarOverride,
          },
        );
      }
      return { pageIds: Array.from(new Set(pageIds)), authorizationLost: false };
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new BusinessException('CHANGESET_CONFLICT', 'A published resource now conflicts with this change set');
      }
      throw error;
    }
    if (publication.authorizationLost) return this.get(id);
    await Promise.allSettled(publication.pageIds.map((pageId) => this.search.indexPage(pageId)));
    this.graphMaintenance?.enqueue(changeSet.spaceId);
    return this.get(id);
  }

  private requiredScopesForItems(items: Array<{ type: string }>): string[] | null {
    const scopes = new Set<string>();
    for (const item of items) {
      if (['create_page', 'update_page', 'archive_page'].includes(item.type)) scopes.add('pages:write');
      else if (['create_relation', 'update_relation', 'archive_relation', 'update_relation_strength'].includes(item.type)) scopes.add('graph:write');
      else if (['upsert_space_memory', 'archive_space_memory'].includes(item.type)) scopes.add('memory:write');
      else return null;
    }
    return scopes.size > 0 ? [...scopes] : null;
  }

  private async assertLiveAgentProposalAccess(
    db: PrismaService | Prisma.TransactionClient,
    context: AgentAutoPublishContext,
    spaceId: string,
    requiredScopes: string[],
  ): Promise<LockedAgentAuthorization> {
    if (!context.ownerId) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Agent proposal authorization is no longer valid');
    }
    const state = await lockLiveAgentAuthorization(db, {
      ownerId: context.ownerId,
      agentId: context.agentId,
      credentialId: context.credentialId,
    }, spaceId);
    const now = new Date();
    const authorized = !!state &&
      !state.credential.revokedAt &&
      (!state.credential.expiresAt || state.credential.expiresAt > now) &&
      state.agent.status === 'active' &&
      !state.agent.revokedAt &&
      (!requiredScopes.some((scope) => scope.startsWith('memory:')) || state.agent.memoryEnabled) &&
      !state.user.deletedAt &&
      !state.user.lockedAt &&
      state.credential.authorizationId === state.grant.id &&
      !state.space.deletedAt &&
      requiredScopes.every((scope) => agentRoleAllowsScope(state.grant.role, scope));
    if (!authorized) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Agent proposal authorization is no longer valid');
    }
    return state;
  }

  private hasAgentAutoPublishAccess(
    state: LockedAgentAuthorization,
    requiredScopes: string[],
  ): boolean {
    const now = new Date();
    const gatedScopes = ['review:auto-publish', ...requiredScopes];
    return !state.credential.revokedAt &&
      (!state.credential.expiresAt || state.credential.expiresAt > now) &&
      state.agent.status === 'active' &&
      !state.agent.revokedAt &&
      state.agent.approvalMode === 'scoped-auto-publish' &&
      !state.user.deletedAt &&
      !state.user.lockedAt &&
      (!requiredScopes.includes('memory:write') || state.agent.memoryEnabled) &&
      state.credential.authorizationId === state.grant.id &&
      !state.space.deletedAt &&
      state.space.approvalPolicy === 'scoped-auto-publish' &&
      gatedScopes.every((scope) => agentRoleAllowsScope(state.grant.role, scope));
  }

  private async createKnowledgeRevision(
    tx: SpaceLockedTransaction,
    spaceId: string,
    submission: { id: string; bundle: unknown; schemaVersion: string; recipeVersion: string; contentHash: string },
    changeSetId: string,
  ): Promise<SpaceKnowledgeRevision> {
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
        folderId: true,
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
        folderId: page.folderId,
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
          folderId: p.folderId,
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

  private pagePathFromTitle(title: string): string {
    const slug = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
    return `pages/${slug}.md`;
  }

  async revert(id: string, expectedTreeRevision: string) {
    if (!/^(?:0|[1-9]\d*)$/u.test(expectedTreeRevision)) {
      throw new ContentTreeError(
        'CONTENT_TREE_CONFLICT',
        'The revert request carries an invalid content-tree revision',
      );
    }
    const requestedTreeRevision = BigInt(expectedTreeRevision);
    const changeSet = await this.get(id);
    if (changeSet.status !== 'published') {
      throw new BusinessException('CHANGESET_INVALID_STATE', 'Change set is already being reverted or is no longer published');
    }
    const publishedAt = changeSet.publishedAt;
    if (!publishedAt) throw new BusinessException('CHANGESET_CONFLICT', 'Published change set is missing its publication timestamp');
    const parseValidDate = (value: unknown) => {
      if (!(value instanceof Date) && typeof value !== 'string') return undefined;
      const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    };
    const restoredPageRestores = new Map<string, Record<string, unknown>>();
    const archiveRestores = new Map<string, Record<string, unknown>>();
    for (const item of changeSet.items) {
      if (item.type === 'create_page' && item.publishedResourceId) {
        const before = (item.payload as any)?.before;
        if (before?.restoredFromArchive === true) {
          const deletedAt = parseValidDate(before.deletedAt);
          const lastModifiedAt = parseValidDate(before.lastModifiedAt);
          if (
            typeof before !== 'object'
            || before === null
            || Array.isArray(before)
            || typeof before.title !== 'string'
            || typeof before.content !== 'string'
            || typeof before.format !== 'string'
            || !Object.prototype.hasOwnProperty.call(before, 'folderId')
            || (before.folderId !== null && typeof before.folderId !== 'string')
            || typeof before.syncPath !== 'string'
            || typeof before.syncPathKey !== 'string'
            || pathKey(before.syncPath) !== before.syncPathKey
            || !deletedAt
            || !lastModifiedAt
          ) {
            throw new BusinessException('CHANGESET_INVALID_STATE', 'Restored page prior state is invalid');
          }
          const restoredState: Record<string, unknown> = {
            title: before.title,
            content: before.content,
            format: before.format,
            parentId: null,
            folderId: before.folderId,
            syncPath: before.syncPath,
            syncPathKey: before.syncPathKey,
            deletedAt,
            sourceChangeSetId: before.sourceChangeSetId,
            createdByAgentId: before.createdByAgentId,
            lastChangeSetId: before.lastChangeSetId,
            lastModifiedByUserId: before.lastModifiedByUserId,
            lastModifiedByAgentId: before.lastModifiedByAgentId,
            lastModifiedAt,
            sourceId: before.sourceId,
            sourceVersionId: before.sourceVersionId,
            sourcePath: before.sourcePath,
          };
          restoredPageRestores.set(item.id, restoredState);
        }
      }
      if (item.type !== 'archive_page' || !item.publishedResourceId) continue;
      const payload = item.payload as any;
      const before = payload?.before;
      if (
        typeof before !== 'object'
        || before === null
        || Array.isArray(before)
        || !Object.prototype.hasOwnProperty.call(before, 'deletedAt')
        || before.deletedAt !== null
      ) {
        throw new BusinessException('CHANGESET_INVALID_STATE', 'Archived page prior state is invalid');
      }
      const restoredState: Record<string, unknown> = { deletedAt: null };
      const hasValue = (key: string) => Object.prototype.hasOwnProperty.call(before, key)
        && before[key] !== undefined;
      const structuralSnapshotKeys = [
        'slug', 'format', 'folderId', 'syncPath', 'syncPathKey', 'sourceChangeSetId',
      ];
      const hasStructuralSnapshot = structuralSnapshotKeys.some((key) => hasValue(key));
      if (hasStructuralSnapshot) {
        if (
          typeof before.title !== 'string'
          || typeof before.slug !== 'string'
          || typeof before.content !== 'string'
          || typeof before.format !== 'string'
          || !Object.prototype.hasOwnProperty.call(before, 'folderId')
          || (before.folderId !== null && typeof before.folderId !== 'string')
          || typeof before.syncPath !== 'string'
          || typeof before.syncPathKey !== 'string'
          || pathKey(before.syncPath) !== before.syncPathKey
        ) {
          throw new BusinessException('CHANGESET_INVALID_STATE', 'Archived page prior state is invalid');
        }
        Object.assign(restoredState, {
          title: before.title,
          slug: before.slug,
          content: before.content,
          format: before.format,
          parentId: null,
          folderId: before.folderId,
          syncPath: before.syncPath,
          syncPathKey: before.syncPathKey,
        });
        for (const key of [
          'sourceChangeSetId', 'createdByAgentId', 'lastChangeSetId',
          'lastModifiedByUserId', 'lastModifiedByAgentId', 'sourceId',
          'sourceVersionId', 'sourcePath', 'deletionBatchId',
        ]) {
          if (Object.prototype.hasOwnProperty.call(before, key)) restoredState[key] = before[key];
        }
      }
      if (hasValue('lastChangeSetId')) {
        restoredState.lastChangeSetId = before.lastChangeSetId;
      }
      if (hasValue('lastModifiedByUserId')) {
        restoredState.lastModifiedByUserId = before.lastModifiedByUserId;
      }
      if (hasValue('lastModifiedByAgentId')) {
        restoredState.lastModifiedByAgentId = before.lastModifiedByAgentId;
      }
      if (Object.prototype.hasOwnProperty.call(before, 'lastModifiedAt')) {
        const lastModifiedAt = parseValidDate(before.lastModifiedAt);
        if (!lastModifiedAt) {
          throw new BusinessException('CHANGESET_INVALID_STATE', 'Archived page prior state is invalid');
        }
        restoredState.lastModifiedAt = lastModifiedAt;
      }
      archiveRestores.set(item.id, restoredState);
    }
    const affectedPageIds = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.changeSet.updateMany({ where: { id, status: 'published' }, data: { status: 'reverting' } });
      if (!claimed.count) throw new BusinessException('CHANGESET_INVALID_STATE', 'Change set is already being reverted or is no longer published');
      const pageItemTypes = new Set(['create_page', 'update_page', 'archive_page']);
      const hasPageRevert = changeSet.items.some(
        (item) => pageItemTypes.has(item.type) && item.publishedResourceId,
      );
      const lockedTx = hasPageRevert
        ? await this.requireContentTree().lockPageMutationSpace(
          tx,
          changeSet.spaceId,
          requestedTreeRevision,
        )
        : tx;
      const snapshotPage = async (where: Prisma.PageWhereInput, itemType: string) => {
        const page = await lockedTx.page.findFirst({ where });
        if (!page) {
          throw new BusinessException('CHANGESET_CONFLICT', `Cannot revert ${itemType}: the published resource was changed later`);
        }
        await lockedTx.pageVersion.create({
          data: {
            pageId: page.id,
            title: page.title,
            content: page.content ?? '',
            authorId: page.authorId,
            slug: page.slug,
            format: page.format,
            parentId: page.parentId,
            folderId: page.folderId ?? null,
            syncPath: page.syncPath,
            syncPathKey: page.syncPathKey,
          },
        });
        return page;
      };
      const pageIds: string[] = [];
      let structuralPageRevert = false;
      const currentPlacement = (page: any) => ({
        title: page.title,
        folderId: page.folderId ?? null,
        syncPath: page.syncPath,
        syncPathKey: page.syncPathKey,
        sortOrder: page.sortOrder ?? 0,
        createdAt: page.createdAt ?? page.updatedAt,
        updatedAt: page.updatedAt,
        knowledgeKey: page.knowledgeKey,
        content: page.content,
      });
      const prepareExact = async (
        page: any,
        target: { title: string; folderId: string | null; syncPath: string },
      ) => this.requireContentTree().prepareExactPageMutation(lockedTx as any, {
        spaceId: changeSet.spaceId,
        pageId: page.id,
        title: target.title,
        folderId: target.folderId,
        syncPath: target.syncPath,
        current: currentPlacement(page),
      });
      const sanitizeUpdateBefore = (before: any) => {
        if (
          typeof before !== 'object'
          || before === null
          || Array.isArray(before)
          || typeof before.title !== 'string'
          || typeof before.slug !== 'string'
          || typeof before.content !== 'string'
          || typeof before.format !== 'string'
          || !Object.prototype.hasOwnProperty.call(before, 'folderId')
          || (before.folderId !== null && typeof before.folderId !== 'string')
          || typeof before.syncPath !== 'string'
          || typeof before.syncPathKey !== 'string'
          || pathKey(before.syncPath) !== before.syncPathKey
        ) {
          throw new ContentTreeError(
            'PAGE_PARENT_DEPRECATED',
            'The prior Page state cannot be mapped safely to a Folder',
          );
        }
        const restored: Record<string, unknown> = {
          title: before.title,
          slug: before.slug,
          content: before.content,
          format: before.format,
          parentId: null,
          folderId: before.folderId,
          syncPath: before.syncPath,
          syncPathKey: before.syncPathKey,
        };
        for (const key of [
          'sourceChangeSetId', 'createdByAgentId', 'lastChangeSetId',
          'lastModifiedByUserId', 'lastModifiedByAgentId', 'sourceId',
          'sourceVersionId', 'sourcePath', 'deletionBatchId',
        ]) {
          if (Object.prototype.hasOwnProperty.call(before, key)) restored[key] = before[key];
        }
        if (Object.prototype.hasOwnProperty.call(before, 'deletedAt')) {
          if (before.deletedAt === null) {
            restored.deletedAt = null;
          } else {
            const deletedAt = parseValidDate(before.deletedAt);
            if (!deletedAt) {
              throw new BusinessException('CHANGESET_INVALID_STATE', 'Update Page prior state is invalid');
            }
            restored.deletedAt = deletedAt;
          }
        }
        if (Object.prototype.hasOwnProperty.call(before, 'lastModifiedAt')) {
          const lastModifiedAt = parseValidDate(before.lastModifiedAt);
          if (!lastModifiedAt) {
            throw new BusinessException('CHANGESET_INVALID_STATE', 'Update Page prior state is invalid');
          }
          restored.lastModifiedAt = lastModifiedAt;
        }
        return restored;
      };
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
          const page = await snapshotPage(where, item.type);
          const restoredState = restoredPageRestores.get(item.id);
          const target = restoredState
            ? {
              title: restoredState.title as string,
              folderId: restoredState.folderId as string | null,
              syncPath: restoredState.syncPath as string,
            }
            : {
              title: page.title,
              folderId: page.folderId ?? null,
              syncPath: page.syncPath,
            };
          const placement = await prepareExact(page, target);
          const reverted = await lockedTx.page.updateMany({
            where,
            data: {
              ...(restoredState ?? { deletedAt: new Date() }),
              parentId: null,
              folderId: placement.folderId,
              syncPath: placement.syncPath,
              syncPathKey: placement.syncPathKey,
            },
          });
          this.assertRevertMutation(reverted.count, item.type);
          structuralPageRevert = true;
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
          const page = await snapshotPage(where, item.type);
          const restoredState = sanitizeUpdateBefore(payload.before);
          const structural = restoredState.deletedAt instanceof Date
            || page.parentId !== null
            || page.title !== restoredState.title
            || (page.folderId ?? null) !== restoredState.folderId
            || page.syncPath !== restoredState.syncPath
            || page.syncPathKey !== restoredState.syncPathKey;
          const placement = structural
            ? await prepareExact(page, {
              title: restoredState.title as string,
              folderId: restoredState.folderId as string | null,
              syncPath: restoredState.syncPath as string,
            })
            : {
              folderId: page.folderId ?? null,
              syncPath: page.syncPath,
              syncPathKey: page.syncPathKey,
            };
          const reverted = await lockedTx.page.updateMany({
            where,
            data: {
              ...restoredState,
              parentId: null,
              folderId: placement.folderId,
              syncPath: placement.syncPath,
              syncPathKey: placement.syncPathKey,
            },
          });
          this.assertRevertMutation(reverted.count, item.type);
          structuralPageRevert ||= structural;
          pageIds.push(item.publishedResourceId);
        } else if (item.type === 'archive_page') {
          const where = {
            id: item.publishedResourceId,
            spaceId: changeSet.spaceId,
            lastChangeSetId: id,
            deletedAt: { not: null },
            updatedAt: { lte: publishedAt },
          };
          const page = await snapshotPage(where, item.type);
          const restoredState = archiveRestores.get(item.id)!;
          const hasPlacementSnapshot = typeof restoredState.title === 'string'
            && typeof restoredState.syncPath === 'string';
          const placement = await prepareExact(page, {
            title: hasPlacementSnapshot ? restoredState.title as string : page.title,
            folderId: hasPlacementSnapshot
              ? restoredState.folderId as string | null
              : page.folderId ?? null,
            syncPath: hasPlacementSnapshot ? restoredState.syncPath as string : page.syncPath,
          });
          const reverted = await lockedTx.page.updateMany({
            where,
            data: {
              ...restoredState,
              parentId: null,
              folderId: placement.folderId,
              syncPath: placement.syncPath,
              syncPathKey: placement.syncPathKey,
            },
          });
          this.assertRevertMutation(reverted.count, item.type);
          structuralPageRevert = true;
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
        const pages = await lockedTx.page.findMany({
          where: { id: { in: pageIds } },
          select: {
            knowledgeKey: true, folderId: true, syncPath: true,
            title: true, content: true, deletedAt: true,
          },
        });
        await this.requireContentTree().advancePageMutation(lockedTx as any, {
          spaceId: changeSet.spaceId,
          expectedTreeRevision: requestedTreeRevision,
          structural: structuralPageRevert,
          changes: pages.map((page) => page.deletedAt
            ? {
              operation: 'archive' as const,
              pageId: page.knowledgeKey,
              previousPath: page.syncPath,
            }
            : {
              operation: 'upsert' as const,
              pageId: page.knowledgeKey,
              folderId: page.folderId ?? null,
              path: page.syncPath,
              title: page.title,
              body: page.content,
            }),
          actor: changeSet.createdByAgentId
            ? { agentId: changeSet.createdByAgentId }
            : { userId: changeSet.createdByUserId ?? undefined },
          revisionOrigin: {
            origin: 'change_set',
            sourceChangeSetId: id,
            legacySidecarOverride,
          },
        });
      } else if (hasNonPageRevert) {
        const origin = {
          origin: 'change_set' as const,
          sourceChangeSetId: id,
          legacySidecarOverride,
        };
        if (hasPageRevert) {
          await this.revisionWriter.advanceLocked(
            lockedTx as SpaceLockedTransaction,
            changeSet.spaceId,
            [],
            origin,
          );
        } else {
          await this.revisionWriter.advance(tx, changeSet.spaceId, [], origin);
        }
      }
      return pageIds;
    });
    await Promise.allSettled(affectedPageIds.map((pageId) => this.search.indexPage(pageId)));
    this.graphMaintenance?.enqueue(changeSet.spaceId);
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
