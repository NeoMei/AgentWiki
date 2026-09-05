import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContentTreeService } from '../content-tree/content-tree.service';
import type { SpaceTreeLockedTransaction } from '../core/sync/space-revision-writer.service';
import { BusinessException } from '../core/filters/business-error';
import { SearchService } from '../core/search/search.service';
import { GraphMaintenance } from '../knowledge-graph/graph-maintenance';
import { canonicalPageContentHash } from '../collaboration-workflows/page-baseline';
import { pageVersionData, publishPageUpdateLocked } from './page-update-publication';

type Tx = Prisma.TransactionClient;

export type CollaborationPageReviewer = { userId: string; comment?: string };

@Injectable()
export class PagePublicationService {
  private readonly logger = new Logger(PagePublicationService.name);

  constructor(
    private readonly contentTree: ContentTreeService,
    @Optional() private readonly search?: SearchService,
    @Optional() private readonly graphMaintenance?: GraphMaintenance,
  ) {}

  async lockChangeSetSpace(tx: Tx, changeSetId: string): Promise<SpaceTreeLockedTransaction> {
    const link = await this.loadLink(tx, changeSetId);
    return this.contentTree.lockPageMutationSpace(tx, link.spaceId);
  }

  async publishLocked(
    lockedTx: SpaceTreeLockedTransaction,
    changeSetId: string,
    reviewer: CollaborationPageReviewer,
  ): Promise<{ pageId: string; pageVersionId: string }> {
    const link = await this.loadLink(lockedTx, changeSetId);
    const changeSet = await lockedTx.changeSet.findUnique({
      where: { id: changeSetId },
      include: { items: true },
    });
    const item = changeSet?.items[0];
    if (
      !changeSet
      || changeSet.spaceId !== link.spaceId
      || changeSet.origin !== 'collaboration'
      || changeSet.status !== 'pending_review'
      || changeSet.items.length !== 1
      || !item
      || item.type !== 'update_page'
      || item.status !== 'pending'
    ) {
      throw new BusinessException('CHANGESET_INVALID_STATE', 'Collaboration Page ChangeSet is no longer publishable');
    }
    const payload = objectValue(item.payload);
    const changes = objectValue(payload.changes);
    if (
      payload.pageId !== link.pageId
      || typeof payload.expectedUpdatedAt !== 'string'
      || typeof payload.expectedContentHash !== 'string'
      || (payload.expectedPageVersionId !== null && typeof payload.expectedPageVersionId !== 'string')
      || Object.keys(changes).length !== 1
      || typeof changes.content !== 'string'
    ) {
      throw new BusinessException('CHANGESET_INVALID_STATE', 'Collaboration Page ChangeSet payload is invalid');
    }
    const attempt = link.artifact.attempt;
    if (
      attempt.basePageVersionId !== payload.expectedPageVersionId
      || attempt.basePageUpdatedAt?.toISOString() !== payload.expectedUpdatedAt
      || attempt.baseContentHash !== payload.expectedContentHash
    ) {
      throw new BusinessException('CHANGESET_INVALID_STATE', 'Collaboration Page baseline is inconsistent');
    }
    const page = await lockedTx.page.findFirst({
      where: { id: link.pageId, spaceId: link.spaceId, deletedAt: null },
    });
    if (!page) throw new BusinessException('RESOURCE_NOT_FOUND', 'Target Page is unavailable');
    if (
      page.updatedAt.toISOString() !== payload.expectedUpdatedAt
      || canonicalPageContentHash(page.content) !== payload.expectedContentHash
    ) {
      throw new BusinessException('CHANGESET_CONFLICT', 'The target Page changed after the task was claimed');
    }
    if (payload.expectedPageVersionId) {
      const version = await lockedTx.pageVersion.findFirst({
        where: { id: payload.expectedPageVersionId, pageId: page.id },
        select: { id: true, title: true, content: true },
      });
      if (!version || version.title !== page.title || canonicalPageContentHash(version.content) !== payload.expectedContentHash) {
        throw new BusinessException('CHANGESET_CONFLICT', 'The target Page version baseline is no longer valid');
      }
    }
    const now = new Date();
    const claimed = await lockedTx.changeSet.updateMany({
      where: { id: changeSetId, status: 'pending_review', origin: 'collaboration' },
      data: { status: 'publishing', reviewedAt: now },
    });
    if (claimed.count !== 1) throw new BusinessException('CHANGESET_INVALID_STATE');
    const accepted = await lockedTx.changeItem.updateMany({
      where: { id: item.id, changeSetId, status: 'pending' },
      data: { status: 'accepted' },
    });
    if (accepted.count !== 1) throw new BusinessException('CHANGESET_INVALID_STATE');
    await publishPageUpdateLocked({
      tx: lockedTx,
      changeSet,
      item,
      authorId: reviewer.userId,
      reviewerUserId: reviewer.userId,
      contentTree: this.contentTree,
    });
    await lockedTx.changeItem.update({
      where: { id: item.id },
      data: { status: 'published', publishedResourceId: page.id },
    });
    await lockedTx.approval.create({ data: {
      changeSetId,
      reviewerId: reviewer.userId,
      decision: 'approved',
      comment: reviewer.comment,
    } });
    const publishedChangeSet = await lockedTx.changeSet.updateMany({
      where: { id: changeSetId, status: 'publishing' },
      data: { status: 'published', publishedAt: now },
    });
    if (publishedChangeSet.count !== 1) throw new BusinessException('CHANGESET_INVALID_STATE');
    const published = await lockedTx.page.findUnique({ where: { id: page.id } });
    if (!published || published.content !== changes.content) {
      throw new BusinessException('CHANGESET_CONFLICT', 'Published Page state is unavailable');
    }
    const publishedVersion = await lockedTx.pageVersion.create({ data: pageVersionData(published) });
    await this.contentTree.advancePageMutation(lockedTx, {
      spaceId: link.spaceId,
      expectedTreeRevision: lockedTx.contentTreeRevision,
      structural: false,
      changes: [{
        operation: 'upsert',
        pageId: published.knowledgeKey,
        folderId: published.folderId,
        path: published.syncPath,
        title: published.title,
        body: published.content,
      }],
      actor: { agentId: changeSet.createdByAgentId! },
      revisionOrigin: { sourceChangeSetId: changeSetId },
    });
    return { pageId: page.id, pageVersionId: publishedVersion.id };
  }

  async rejectLocked(
    lockedTx: SpaceTreeLockedTransaction,
    changeSetId: string,
    reviewer: CollaborationPageReviewer,
  ): Promise<void> {
    await this.loadLink(lockedTx, changeSetId);
    const rejected = await lockedTx.changeSet.updateMany({
      where: { id: changeSetId, status: 'pending_review', origin: 'collaboration' },
      data: { status: 'rejected', reviewedAt: new Date() },
    });
    if (rejected.count !== 1) throw new BusinessException('CHANGESET_INVALID_STATE');
    await lockedTx.changeItem.updateMany({
      where: { changeSetId, status: 'pending' }, data: { status: 'rejected' },
    });
    await lockedTx.approval.create({ data: {
      changeSetId, reviewerId: reviewer.userId, decision: 'rejected', comment: reviewer.comment,
    } });
  }

  async runPostCommitEffects(spaceId: string, pageIds: string[]): Promise<void> {
    await Promise.allSettled(pageIds.map((pageId) => this.search?.indexPage(pageId)));
    try {
      this.graphMaintenance?.enqueue(spaceId);
    } catch (error) {
      this.logger.warn({ code: 'COLLABORATION_PAGE_GRAPH_ENQUEUE_FAILED', spaceId, error });
    }
  }

  private async loadLink(tx: Tx, changeSetId: string): Promise<any> {
    const link = await tx.collaborationArtifactChangeSetLink.findUnique({
      where: { changeSetId },
      include: { artifact: { include: { attempt: true } } },
    });
    if (!link) throw new BusinessException('CHANGESET_INVALID_STATE', 'ChangeSet is not linked to a collaboration Page result');
    return link;
  }
}

function objectValue(value: unknown): Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
