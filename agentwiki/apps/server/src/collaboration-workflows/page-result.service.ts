import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { canonicalPageContentHash } from './page-baseline';

type Tx = Prisma.TransactionClient;

type CurrentPageVersionFields = {
  id: string;
  title: string;
  content: string;
  slug: string;
  format: string;
  parentId: string | null;
  folderId: string | null;
  syncPath: string;
  syncPathKey: string;
};

type PageTask = {
  id: string;
  runId: string;
  generation: number;
  name: string;
  targetPageId: string | null;
  targetSpaceId: string | null;
  humanAcceptance: boolean;
  outputContract: unknown;
};

type PageAttempt = {
  id: string;
  runId: string;
  taskId: string;
  generation: number;
  agentId: string;
  basePageVersionId: string | null;
  basePageUpdatedAt: Date | null;
  baseContentHash: string | null;
};

type MarkdownArtifact = {
  id: string;
  runId: string;
  taskId: string;
  attemptId: string;
  generation: number;
  kind: string;
  status: string;
  payload: unknown;
};

@Injectable()
export class PageResultService {
  async readCurrentPageVersionLocked(
    tx: Pick<Tx, 'pageVersion'>,
    page: CurrentPageVersionFields,
  ): Promise<string | null> {
    const currentVersion = await tx.pageVersion.findFirst({
      where: {
        pageId: page.id,
        title: page.title,
        content: page.content,
        slug: page.slug,
        format: page.format,
        parentId: page.parentId,
        folderId: page.folderId,
        syncPath: page.syncPath,
        syncPathKey: page.syncPathKey,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return currentVersion?.id ?? null;
  }

  async proposeLocked(
    tx: Tx,
    task: PageTask,
    attempt: PageAttempt,
    artifact: MarkdownArtifact,
    principal: Principal,
  ): Promise<{ changeSetId: string; artifactId: string; pageId: string }> {
    const pageId = task.targetPageId;
    const spaceId = task.targetSpaceId;
    const contract = objectValue(task.outputContract);
    const payload = objectValue(artifact.payload);
    if (
      !principal.agentId
      || !pageId
      || !spaceId
      || task.humanAcceptance !== true
      || contract.kind !== 'markdown'
      || artifact.kind !== 'markdown'
      || artifact.status !== 'pending'
      || artifact.runId !== task.runId
      || artifact.taskId !== task.id
      || artifact.attemptId !== attempt.id
      || artifact.generation !== task.generation
      || attempt.runId !== task.runId
      || attempt.taskId !== task.id
      || attempt.generation !== task.generation
      || attempt.agentId !== principal.agentId
      || typeof payload.markdown !== 'string'
      || !attempt.basePageUpdatedAt
      || !attempt.baseContentHash
    ) {
      throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Page result is not a reviewable targeted Markdown Artifact');
    }
    if (hasMoreThanCodePoints(payload.markdown, 200_000)) {
      throw new BusinessException('COLLABORATION_TEMPLATE_INVALID', 'Page Markdown cannot exceed 200000 Unicode code points');
    }
    const existing = await tx.collaborationArtifactChangeSetLink.findUnique({
      where: { artifactId: artifact.id },
      select: { artifactId: true, changeSetId: true, pageId: true },
    });
    if (existing) return existing;
    const changeSet = await tx.changeSet.create({
      data: {
        spaceId,
        title: `${task.name}: ${pageId}`,
        origin: 'collaboration',
        status: 'pending_review',
        createdByAgentId: principal.agentId,
        items: { create: {
          type: 'update_page',
          status: 'pending',
          payload: {
            pageId,
            expectedUpdatedAt: attempt.basePageUpdatedAt.toISOString(),
            expectedContentHash: attempt.baseContentHash,
            expectedPageVersionId: attempt.basePageVersionId,
            changes: { content: payload.markdown },
          } as Prisma.InputJsonValue,
        } },
      },
      include: { items: true },
    });
    await tx.collaborationArtifactChangeSetLink.create({ data: {
      artifactId: artifact.id,
      changeSetId: changeSet.id,
      runId: task.runId,
      taskId: task.id,
      spaceId,
      pageId,
    } });
    return { changeSetId: changeSet.id, artifactId: artifact.id, pageId };
  }

  async currentSnapshotLocked(
    tx: Tx,
    input: {
      spaceId: string;
      pageId: string;
      expectedPageVersionId: string | null;
      expectedContentHash: string;
      createVersion: boolean;
    },
  ): Promise<{ page: any; pageVersionId: string | null }> {
    const page = await tx.page.findFirst({
      where: { id: input.pageId, spaceId: input.spaceId, deletedAt: null },
    });
    if (!page) throw new BusinessException('PAGE_VERSION_CONFLICT', 'The target Page is no longer available');
    const currentContentHash = canonicalPageContentHash(page.content);
    const currentPageVersionId = await this.readCurrentPageVersionLocked(tx, page);
    if (
      currentContentHash !== input.expectedContentHash
      || currentPageVersionId !== input.expectedPageVersionId
    ) {
      throw new BusinessException('PAGE_VERSION_CONFLICT', 'The target Page changed during conflict recovery', {
        pageId: page.id,
        currentPageVersionId,
        currentContentHash,
      });
    }
    if (currentPageVersionId || !input.createVersion) {
      return { page, pageVersionId: currentPageVersionId };
    }
    const created = await tx.pageVersion.create({ data: {
      pageId: page.id,
      title: page.title,
      content: page.content,
      authorId: page.authorId,
      slug: page.slug,
      format: page.format,
      parentId: page.parentId,
      folderId: page.folderId,
      syncPath: page.syncPath,
      syncPathKey: page.syncPathKey,
    } });
    return { page, pageVersionId: created.id };
  }

  async adoptCurrentLocked(
    tx: Tx,
    input: {
      runId: string;
      task: PageTask & { status: string };
      review: { id: string; artifactId: string; generation: number };
      page: any;
      pageVersionId: string;
      reviewerUserId: string;
      reason: string;
    },
  ): Promise<{ artifactId: string; generation: number }> {
    const prior = await tx.collaborationTaskArtifact.findFirst({
      where: { id: input.review.artifactId, runId: input.runId, taskId: input.task.id },
      select: { id: true, attemptId: true, version: true, status: true },
    });
    if (!prior || !['pending', 'accepted'].includes(prior.status)) {
      throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'The Page conflict Artifact is stale');
    }
    const superseded = await tx.collaborationTaskArtifact.updateMany({
      where: { id: prior.id, runId: input.runId, status: { in: ['pending', 'accepted'] } },
      data: { status: 'superseded' },
    });
    if (superseded.count !== 1) throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT');
    const artifact = await tx.collaborationTaskArtifact.create({ data: {
      runId: input.runId,
      taskId: input.task.id,
      attemptId: prior.attemptId,
      generation: input.task.generation,
      version: prior.version + 1,
      kind: 'markdown',
      status: 'accepted',
      payload: {
        markdown: input.page.content,
        adoptedCurrentPage: {
          kind: 'human_adopt_current',
          pageId: input.page.id,
          pageVersionId: input.pageVersionId,
          contentHash: canonicalPageContentHash(input.page.content),
          adoptedByUserId: input.reviewerUserId,
        },
      } as Prisma.InputJsonValue,
      evidence: [] as Prisma.InputJsonValue,
      acceptedAt: new Date(),
    } });
    const decided = await tx.collaborationReview.updateMany({
      where: {
        id: input.review.id,
        runId: input.runId,
        artifactId: prior.id,
        generation: input.review.generation,
        status: 'pending',
      },
      data: {
        status: 'approved',
        artifactId: artifact.id,
        reviewerUserId: input.reviewerUserId,
        reason: input.reason,
        decidedAt: new Date(),
      },
    });
    if (decided.count !== 1) throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'The Page conflict was resolved concurrently');
    const completed = await tx.collaborationRunTask.updateMany({
      where: { id: input.task.id, runId: input.runId, generation: input.task.generation, status: 'submitted' },
      data: { status: 'completed', completedAt: new Date() },
    });
    if (completed.count !== 1) throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT');
    return { artifactId: artifact.id, generation: input.task.generation };
  }
}

function objectValue(value: unknown): Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function hasMoreThanCodePoints(value: string, maximum: number): boolean {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > maximum) return true;
  }
  return false;
}
