import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthorizationService, type Principal, type SpaceRole } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';
import { ProgressionService } from './progression.service';
import type { ReviewDecisionDto } from './review.dto';
import { canonicalRequestHash, RunEventStore } from './run-event.store';
import { CollaborationEventsService } from './collaboration-events.service';
import { withCollaborationSerializableRetry } from './serializable-retry';
import { HUMAN_ROLE_ORDER, rolesAtLeast } from './reviewer-members';

type Tx = Prisma.TransactionClient;

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly events: RunEventStore,
    private readonly progression: ProgressionService,
    private readonly notifications: CollaborationEventsService,
  ) {}

  async decide(
    spaceId: string,
    runId: string,
    reviewId: string,
    input: ReviewDecisionDto,
    principal: Principal,
  ) {
    if (principal.agentId) throw new BusinessException('HUMAN_AUTH_REQUIRED');
    const result = await withCollaborationSerializableRetry(() => this.prisma.$transaction(async (tx) => {
      const currentRun = await tx.collaborationRun.findUnique({ where: { id: runId } });
      if (!currentRun || currentRun.spaceId !== spaceId) {
        throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
      }
      const currentReview = await tx.collaborationReview.findFirst({ where: { id: reviewId, runId } });
      if (!currentReview) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration review not found');
      let member: { role: SpaceRole };
      try {
        member = await this.authorization.assertLiveHumanSpaceAccess(
          tx,
          principal,
          spaceId,
          ['owner', 'admin', 'editor'],
        );
      } catch (error) {
        if (error instanceof BusinessException && error.businessCode === 'SPACE_ACCESS_DENIED') {
          throw new BusinessException('COLLABORATION_REVIEWER_DENIED');
        }
        throw error;
      }
      const reviewerOverride = await this.assertReviewer(tx, spaceId, currentReview, member.role, principal.userId);
      return this.events.executeIdempotent(tx, {
        runId,
        actorKind: 'human',
        actorId: principal.userId,
        actorUserId: principal.userId,
        operation: `review_${input.kind}`,
        target: reviewId,
        key: input.idempotencyKey,
        requestHash: canonicalRequestHash(input),
        metadata: { reviewId, kind: input.kind, reason: input.reason, reviewerOverride },
      }, async () => {
        const mutationRun = await tx.collaborationRun.findUnique({ where: { id: runId } });
        const current = await tx.collaborationReview.findFirst({ where: { id: reviewId, runId, status: 'pending' } });
        if (!mutationRun || mutationRun.spaceId !== spaceId || !current) {
          throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Review is no longer pending');
        }
        if (['completed', 'failed', 'cancelled'].includes(mutationRun.status)) {
          throw new BusinessException('COLLABORATION_RUN_TERMINAL');
        }
        const currentTasks = await tx.collaborationRunTask.findMany({ where: { runId } });
        const currentSource = currentTasks.find((task) => task.id === current.sourceTaskId);
        if (!currentSource || currentSource.generation !== current.generation || currentSource.status !== 'submitted') {
          throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Review generation is stale');
        }
        const decidedAt = new Date();
        const status = input.kind === 'approve' ? 'approved' : input.kind === 'terminate' ? 'terminated' : 'rejected';
        const decided = await tx.collaborationReview.updateMany({
          where: { id: reviewId, runId, status: 'pending' },
          data: { status, reviewerUserId: principal.userId, reason: input.reason, decidedAt },
        });
        if (decided.count !== 1) throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Review was decided concurrently');

        if (input.kind === 'approve') {
          const sourceReviewNodeIds = snapshotGraph(mutationRun.templateSnapshot).nodes
            .filter((node) => node.kind === 'human_review' && node.artifactTaskId === currentSource.nodeId)
            .map((node) => node.id);
          const sourceReviews = await tx.collaborationReview.findMany({
            where: { runId, sourceTaskId: current.sourceTaskId, generation: current.generation },
          });
          const sourceReviewByNode = new Map(sourceReviews.map((item) => [item.nodeId, item]));
          const groupApproved = sourceReviewNodeIds.length > 0
            && sourceReviewNodeIds.every((nodeId) => sourceReviewByNode.get(nodeId)?.status === 'approved');
          const currentArtifact = await tx.collaborationTaskArtifact.findFirst({
            where: { id: current.artifactId, runId, generation: current.generation },
            select: { status: true },
          });
          if (!currentArtifact || !['pending', 'accepted'].includes(currentArtifact.status)) {
            throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Review Artifact is stale');
          }
          if (groupApproved && currentArtifact.status === 'pending') {
            const accepted = await tx.collaborationTaskArtifact.updateMany({
              where: { id: current.artifactId, runId, generation: current.generation, status: 'pending' },
              data: { status: 'accepted', acceptedAt: decidedAt },
            });
            if (accepted.count !== 1) throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Review Artifact is stale');
          }
          if (groupApproved) {
            await tx.collaborationRunTask.update({
              where: { id: current.sourceTaskId },
              data: { status: 'completed', completedAt: decidedAt },
            });
          }
          await this.progression.advanceRun(tx, runId, `review-approved:${reviewId}`, false);
        } else if (input.kind === 'reject_for_revision') {
          await this.rejectForRevision(tx, mutationRun, current, input.reason, currentTasks);
          await this.progression.advanceRun(tx, runId, `review-rejected:${reviewId}`, false);
        } else {
          if (!current.allowTerminate) throw new BusinessException('COLLABORATION_REVIEW_TERMINATE_DENIED');
          await tx.collaborationTaskAttempt.updateMany({
            where: { runId, status: { in: ['claimed', 'running'] } },
            data: { status: 'invalidated', failureCode: 'review_terminated', finishedAt: decidedAt },
          });
          await tx.collaborationRun.update({
            where: { id: runId },
            data: { status: 'cancelled', finishedAt: decidedAt },
          });
        }
        const receipt = await tx.collaborationRun.findUnique({
          where: { id: runId },
          select: { id: true, status: true, version: true },
        });
        if (!receipt) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
        return { runId: receipt.id, status: receipt.status, version: receipt.version };
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    await this.notifications.publishCurrentRun(runId);
    return result;
  }

  private async assertReviewer(
    tx: Tx,
    spaceId: string,
    review: { minimumRole: string; reviewerUserIds: unknown },
    role: SpaceRole,
    userId: string,
  ): Promise<boolean> {
    const minimum = HUMAN_ROLE_ORDER.indexOf(review.minimumRole as SpaceRole);
    if (minimum < 0 || HUMAN_ROLE_ORDER.indexOf(role) < minimum) {
      throw new BusinessException('COLLABORATION_REVIEWER_DENIED');
    }
    const reviewers = stringArray(review.reviewerUserIds);
    if (reviewers.length && !reviewers.includes(userId)) {
      const eligibleReviewers = await tx.spaceMember.count({
        where: {
          spaceId,
          userId: { in: reviewers },
          role: { in: rolesAtLeast(review.minimumRole) },
          user: { type: 'human', deletedAt: null, lockedAt: null },
        },
      });
      if (eligibleReviewers > 0 || !['owner', 'admin'].includes(role)) {
        throw new BusinessException('COLLABORATION_REVIEWER_DENIED');
      }
      return true;
    }
    return false;
  }

  private async rejectForRevision(
    tx: Tx,
    run: any,
    review: any,
    reason: string,
    sourceTask: any[],
  ): Promise<void> {
    const snapshot = snapshotGraph(run.templateSnapshot);
    const sourceNodeId = sourceTask.find((task) => task.id === review.sourceTaskId)?.nodeId;
    const revisionNodeId = sourceTask.find((task) => task.id === review.revisionTaskId)?.nodeId;
    if (!sourceNodeId || !revisionNodeId || !hasPath(snapshot.dependencies, revisionNodeId, sourceNodeId)) {
      throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Review revision target is not a source ancestor');
    }
    const nodeIds = snapshot.nodes.map((node) => node.id);
    const affectedNodes = new Set(nodeIds.filter((nodeId) =>
      (hasPath(snapshot.dependencies, revisionNodeId, nodeId) && hasPath(snapshot.dependencies, nodeId, review.nodeId))
      || hasPath(snapshot.dependencies, review.nodeId, nodeId)));
    const siblingReviewNodeIds = snapshot.nodes
      .filter((node) => node.kind === 'human_review' && node.artifactTaskId === sourceNodeId)
      .map((node) => node.id);
    for (const siblingReviewNodeId of siblingReviewNodeIds) {
      for (const nodeId of nodeIds) {
        if (hasPath(snapshot.dependencies, siblingReviewNodeId, nodeId)) affectedNodes.add(nodeId);
      }
    }
    const affectedTasks = sourceTask.filter((task) => affectedNodes.has(task.nodeId));
    const affectedTaskIds = affectedTasks.map((task) => task.id).sort();
    if (!affectedTaskIds.includes(review.revisionTaskId) || !affectedTaskIds.includes(review.sourceTaskId)) {
      throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT');
    }

    await tx.collaborationTaskAttempt.updateMany({
      where: { runId: run.id, taskId: { in: affectedTaskIds }, status: { in: ['claimed', 'running'] } },
      data: { status: 'invalidated', failureCode: 'review_revision', finishedAt: new Date() },
    });
    const rejected = await tx.collaborationTaskArtifact.updateMany({
      where: { id: review.artifactId, runId: run.id, generation: review.generation, status: { in: ['pending', 'accepted'] } },
      data: { status: 'rejected' },
    });
    if (rejected.count !== 1) throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT', 'Review Artifact is stale');
    await tx.collaborationTaskArtifact.updateMany({
      where: {
        runId: run.id,
        taskId: { in: affectedTaskIds },
        id: { not: review.artifactId },
        status: { in: ['pending', 'accepted'] },
      },
      data: { status: 'superseded' },
    });
    await tx.collaborationReview.updateMany({
      where: {
        runId: run.id,
        sourceTaskId: review.sourceTaskId,
        generation: review.generation,
        id: { not: review.id },
        status: 'pending',
      },
      data: { status: 'superseded', reason: `Superseded by revision: ${reason}` },
    });
    await tx.collaborationReview.updateMany({
      where: { runId: run.id, id: { not: review.id }, nodeId: { in: [...affectedNodes] }, status: 'pending' },
      data: { status: 'superseded', reason: `Superseded by revision: ${reason}` },
    });

    const todos: Array<Record<string, unknown>> = [];
    const satisfiedOutside = new Set(sourceTask
      .filter((task) => !affectedNodes.has(task.nodeId) && ['completed', 'skipped'].includes(task.status))
      .map((task) => task.nodeId));
    for (const task of affectedTasks.sort((left, right) => left.id.localeCompare(right.id))) {
      const generation = task.generation + 1;
      const status = task.nodeId === revisionNodeId && externalDependenciesSatisfied(
        snapshot.dependencies,
        revisionNodeId,
        affectedNodes,
        satisfiedOutside,
      ) ? 'ready' : 'blocked';
      await tx.collaborationRunTask.update({
        where: { id: task.id },
        data: { generation, status, nextAttemptAt: null, completedAt: null },
      });
      const definition = snapshot.nodes.find((node) => node.kind === 'agent_task' && node.id === task.nodeId);
      if (definition?.kind === 'agent_task') {
        definition.todos.forEach((todo: any, ordinal: number) => todos.push({
          runId: run.id,
          taskId: task.id,
          generation,
          templateId: todo.id,
          ordinal,
          name: todo.name,
          required: todo.required,
          status: 'pending',
        }));
      }
    }
    if (todos.length) await tx.collaborationTaskTodo.createMany({ data: todos as any });
    await tx.collaborationRun.update({
      where: { id: run.id },
      data: { status: 'running', pauseReason: null, finishedAt: null },
    });
  }
}

function snapshotGraph(value: unknown): { nodes: any[]; dependencies: Array<{ from: string; to: string }> } {
  if (!value || typeof value !== 'object') throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT');
  const snapshot = value as { nodes?: unknown; dependencies?: unknown };
  if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.dependencies)) {
    throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT');
  }
  return { nodes: snapshot.nodes as any[], dependencies: snapshot.dependencies as Array<{ from: string; to: string }> };
}

function hasPath(edges: Array<{ from: string; to: string }>, from: string, to: string): boolean {
  if (from === to) return true;
  const queue = [from];
  const seen = new Set(queue);
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of edges.filter((item) => item.from === current)) {
      if (edge.to === to) return true;
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return false;
}

function externalDependenciesSatisfied(
  edges: Array<{ from: string; to: string; mode?: string }>,
  nodeId: string,
  affected: Set<string>,
  satisfied: Set<string>,
): boolean {
  const incoming = edges.filter((edge) => edge.to === nodeId && !affected.has(edge.from));
  if (!incoming.length) return true;
  return incoming[0].mode === 'any'
    ? incoming.some((edge) => satisfied.has(edge.from))
    : incoming.every((edge) => satisfied.has(edge.from));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
