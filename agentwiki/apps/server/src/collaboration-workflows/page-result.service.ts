import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';

type Tx = Prisma.TransactionClient;

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
