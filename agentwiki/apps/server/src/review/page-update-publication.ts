import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { BusinessException } from '../core/filters/business-error';
import type { SpaceTreeLockedTransaction } from '../core/sync/space-revision-writer.service';
import { canonicalPageContentHash } from '../collaboration-workflows/page-baseline';
import type { ContentTreeService } from '../content-tree/content-tree.service';
import { ContentTreeError } from '../content-tree/content-tree.types';

export type PageUpdateChangeSet = {
  id: string;
  spaceId: string;
  createdByUserId: string | null;
  createdByAgentId: string | null;
};

export type PageUpdateItem = { id: string; payload: unknown };

export async function publishPageUpdateLocked(input: {
  tx: SpaceTreeLockedTransaction;
  changeSet: PageUpdateChangeSet;
  item: PageUpdateItem;
  authorId: string;
  reviewerUserId?: string;
  contentTree: ContentTreeService;
}): Promise<{ pageId: string; sourcePath: string | null }> {
  const { tx, changeSet, item, authorId } = input;
  const payload = objectValue(item.payload);
  const page = await tx.page.findFirst({
    where: { id: payload.pageId, spaceId: changeSet.spaceId, deletedAt: null },
  });
  if (!page) throw new BadRequestException('Updated page must belong to the change set space');
  if (payload.expectedUpdatedAt && page.updatedAt.toISOString() !== payload.expectedUpdatedAt) {
    throw new BusinessException('CHANGESET_INVALID_STATE', 'The page changed after this candidate was compiled; create a new run before publishing');
  }
  if (typeof payload.expectedContentHash === 'string' && canonicalPageContentHash(page.content) !== payload.expectedContentHash) {
    throw new BusinessException('CHANGESET_CONFLICT', 'The target Page changed after the task was claimed');
  }
  const changes = objectValue(payload.changes);
  if (changes.parentId !== undefined) {
    throw new ContentTreeError('PAGE_PARENT_DEPRECATED', 'Legacy Page parent placement cannot be mapped safely');
  }
  const {
    expectedTreeRevision: _expectedTreeRevision,
    folderId: requestedFolderId,
    ...pageChanges
  } = changes;
  const structural = changes.title !== undefined || changes.folderId !== undefined;
  const placement = structural
    ? await input.contentTree.preparePageMutation(tx, {
      spaceId: changeSet.spaceId,
      pageId: page.id,
      title: changes.title ?? page.title,
      folderId: requestedFolderId === undefined ? (page.folderId ?? null) : requestedFolderId,
      current: {
        title: page.title, folderId: page.folderId ?? null, syncPath: page.syncPath,
        syncPathKey: page.syncPathKey, sortOrder: page.sortOrder ?? 0,
        createdAt: page.createdAt ?? page.updatedAt, updatedAt: page.updatedAt,
        knowledgeKey: page.knowledgeKey, content: page.content,
      },
    })
    : { folderId: page.folderId ?? null, syncPath: page.syncPath, syncPathKey: page.syncPathKey };
  await tx.pageVersion.create({ data: pageVersionData(page) });
  await tx.changeItem.update({
    where: { id: item.id },
    data: { payload: { ...payload, before: pageBefore(page) } as Prisma.InputJsonValue },
  });
  const modifiedAt = new Date();
  const updated = await tx.page.updateMany({
    where: { id: page.id, spaceId: changeSet.spaceId, deletedAt: null, updatedAt: page.updatedAt },
    data: {
      ...pageChanges,
      ...(structural ? {
        parentId: null,
        folderId: placement.folderId,
        ...(placement.syncPathKey === page.syncPathKey ? {} : {
          syncPath: placement.syncPath,
          syncPathKey: placement.syncPathKey,
        }),
      } : {}),
      sourceChangeSetId: page.sourceChangeSetId || changeSet.id,
      createdByAgentId: page.createdByAgentId || changeSet.createdByAgentId,
      lastChangeSetId: changeSet.id,
      lastModifiedByAgentId: changeSet.createdByAgentId,
      lastModifiedByUserId: changeSet.createdByAgentId ? null : input.reviewerUserId ?? authorId,
      lastModifiedAt: modifiedAt,
      sourceId: payload.sourceId ?? page.sourceId,
      sourceVersionId: payload.sourceVersionId ?? page.sourceVersionId,
      sourcePath: payload.sourcePath ?? page.sourcePath,
    },
  });
  if (updated.count !== 1) {
    throw new BusinessException('CHANGESET_CONFLICT', 'The page changed while this change set was being published');
  }
  return { pageId: page.id, sourcePath: payload.sourcePath || page.sourcePath || null };
}

export function pageVersionData(page: any): Prisma.PageVersionUncheckedCreateInput {
  return {
    pageId: page.id, title: page.title, content: page.content, authorId: page.authorId,
    slug: page.slug, format: page.format, parentId: page.parentId, folderId: page.folderId ?? null,
    syncPath: page.syncPath, syncPathKey: page.syncPathKey,
  };
}

function pageBefore(page: any): Record<string, unknown> {
  return {
    title: page.title, slug: page.slug, content: page.content, parentId: page.parentId,
    folderId: page.folderId ?? null, format: page.format,
    sourceChangeSetId: page.sourceChangeSetId, createdByAgentId: page.createdByAgentId,
    lastChangeSetId: page.lastChangeSetId, lastModifiedByUserId: page.lastModifiedByUserId,
    lastModifiedByAgentId: page.lastModifiedByAgentId, lastModifiedAt: page.lastModifiedAt,
    sourceId: page.sourceId, sourceVersionId: page.sourceVersionId, sourcePath: page.sourcePath,
    syncPath: page.syncPath, syncPathKey: page.syncPathKey,
  };
}

function objectValue(value: unknown): Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
