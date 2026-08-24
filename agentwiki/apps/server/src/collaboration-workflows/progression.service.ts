import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../core/filters/business-error';
import { canonicalRequestHash, RunEventStore } from './run-event.store';

type Tx = Prisma.TransactionClient;
type ProgressionState = {
  run: { status: string; pauseReason: string | null; templateSnapshot: unknown };
  tasks: Array<{ id: string; nodeId: string; status: string; generation: number; dependencyMode?: string; skippable?: boolean }>;
  reviews: Array<{ nodeId: string; status: string; generation: number; sourceTaskId: string }>;
  satisfiedNodeIds: Set<string>;
  reviewActionableNodeIds: Set<string>;
};

@Injectable()
export class ProgressionService {
  constructor(private readonly events: RunEventStore) {}

  async advanceRun(tx: Tx, runId: string, cause: string, recordEvent = true) {
    const mutation = async () => {
      const state = await this.loadState(tx, runId);
      const dependencies = await tx.collaborationTaskDependency.findMany({ where: { runId } });
      await this.createActionableReviews(tx, runId, state, dependencies);
      for (const task of state.tasks.filter((item) => item.status === 'blocked')) {
        const incoming = dependencies.filter((edge) => edge.toNodeId === task.nodeId);
        const satisfied = task.dependencyMode === 'any'
          ? incoming.some((edge) => state.satisfiedNodeIds.has(edge.fromNodeId))
          : incoming.every((edge) => state.satisfiedNodeIds.has(edge.fromNodeId));
        if (!incoming.length || !satisfied) continue;
        const updated = await tx.collaborationRunTask.updateMany({
          where: { id: task.id, status: 'blocked' },
          data: { status: 'ready' },
        });
        if (updated.count === 1) task.status = 'ready';
      }
      let nextStatus: string;
      let pauseReason = state.run.pauseReason;
      try {
        nextStatus = calculateRunStatus(state);
      } catch (error) {
        if (!(error instanceof BusinessException) || error.businessCode !== 'COLLABORATION_PROGRESS_INVARIANT') throw error;
        nextStatus = 'paused';
        pauseReason = 'progress_invariant';
      }
      await tx.collaborationRun.update({
        where: { id: runId },
        data: {
          status: nextStatus as any,
          pauseReason,
          finishedAt: nextStatus === 'completed' ? new Date() : null,
        },
      });
      return { runId, status: nextStatus };
    };
    if (!recordEvent) return mutation();
    const key = `progress:${createHash('sha256').update(cause).digest('hex').slice(0, 32)}`;
    return this.events.executeIdempotent(tx, {
      runId,
      actorKind: 'system',
      actorId: 'system',
      operation: 'advance_run',
      target: runId,
      key,
      requestHash: canonicalRequestHash({ cause }),
      metadata: { cause },
      eventType: 'collaboration.run.progressed',
    }, mutation);
  }

  private async loadState(tx: Tx, runId: string): Promise<ProgressionState> {
    const [run, tasks, reviews] = await Promise.all([
      tx.collaborationRun.findUnique({ where: { id: runId } }),
      tx.collaborationRunTask.findMany({ where: { runId }, orderBy: { ordinal: 'asc' } }),
      tx.collaborationReview.findMany({ where: { runId } }),
    ]);
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const currentReviews = reviews.filter((review) => {
      const source = taskById.get(review.sourceTaskId);
      return source !== undefined && source.generation === review.generation;
    });
    const satisfiedNodeIds = new Set<string>(
      tasks.filter((task) => ['completed', 'skipped'].includes(task.status)).map((task) => task.nodeId),
    );
    const reviewActionableNodeIds = new Set(satisfiedNodeIds);
    for (const review of currentReviews) {
      if (review.status === 'approved') {
        reviewActionableNodeIds.add(review.nodeId);
        const source = taskById.get(review.sourceTaskId);
        if (source && ['completed', 'skipped'].includes(source.status)) satisfiedNodeIds.add(review.nodeId);
      }
    }
    return { run, tasks, reviews: currentReviews, satisfiedNodeIds, reviewActionableNodeIds };
  }

  private async createActionableReviews(
    tx: Tx,
    runId: string,
    state: ProgressionState,
    dependencies: Array<{ fromNodeId: string; toNodeId: string; mode: string }>,
  ): Promise<void> {
    const reviewNodes = snapshotReviewNodes(state.run.templateSnapshot);
    if (!reviewNodes.length) return;
    const taskByNodeId = new Map(state.tasks.map((task) => [task.nodeId, task]));

    for (const reviewNode of reviewNodes) {
      const sourceTask = taskByNodeId.get(reviewNode.artifactTaskId);
      if (!sourceTask || sourceTask.status !== 'submitted') continue;
      if (state.reviews.some((review) =>
        review.nodeId === reviewNode.id
        && review.sourceTaskId === sourceTask.id
        && review.generation === sourceTask.generation)) continue;
      const incoming = dependencies.filter((edge) => edge.toNodeId === reviewNode.id);
      const edgeSatisfied = (fromNodeId: string) =>
        state.reviewActionableNodeIds.has(fromNodeId) || fromNodeId === sourceTask.nodeId;
      const satisfied = !incoming.length || (incoming[0].mode === 'any'
        ? incoming.some((edge) => edgeSatisfied(edge.fromNodeId))
        : incoming.every((edge) => edgeSatisfied(edge.fromNodeId)));
      if (!satisfied) continue;
      const [artifact, revisionTask, prior] = await Promise.all([
        tx.collaborationTaskArtifact.findFirst({
          where: {
            runId, taskId: sourceTask.id, generation: sourceTask.generation, status: { in: ['pending', 'accepted'] },
          },
          orderBy: { version: 'desc' },
          select: { id: true },
        }),
        tx.collaborationRunTask.findFirst({
          where: { runId, nodeId: reviewNode.revisionTaskId },
          select: { id: true },
        }),
        tx.collaborationReview.findFirst({
          where: { runId, nodeId: reviewNode.id },
          orderBy: { revision: 'desc' },
          select: { revision: true },
        }),
      ]);
      if (!artifact || !revisionTask) throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT');
      const created = await tx.collaborationReview.create({
        data: {
          runId,
          nodeId: reviewNode.id,
          revision: (prior?.revision ?? 0) + 1,
          generation: sourceTask.generation,
          sourceTaskId: sourceTask.id,
          artifactId: artifact.id,
          revisionTaskId: revisionTask.id,
          minimumRole: reviewNode.minimumRole,
          reviewerUserIds: structuredClone(reviewNode.reviewerUserIds) as Prisma.InputJsonValue,
          allowTerminate: reviewNode.allowTerminate,
          status: 'pending',
        },
      });
      state.reviews.push(created);
    }
  }
}

export function calculateRunStatus(state: ProgressionState): string {
  if (['completed', 'failed', 'cancelled'].includes(state.run.status)) return state.run.status;
  if (state.run.pauseReason) return 'paused';
  if (state.tasks.some((task) => ['ready', 'claimed', 'running', 'retry_wait'].includes(task.status))) return 'running';
  if (state.reviews.some((review) => review.status === 'pending')) return 'waiting_review';
  const terminalIds = terminalNodeIds(state.run.templateSnapshot);
  const allTasksSatisfied = state.tasks.every((task) => ['completed', 'skipped'].includes(task.status));
  const terminalsSatisfied = terminalIds.length > 0 && terminalIds.every((nodeId) => state.satisfiedNodeIds.has(nodeId));
  if (allTasksSatisfied && terminalsSatisfied) return 'completed';
  throw new BusinessException('COLLABORATION_PROGRESS_INVARIANT');
}

function terminalNodeIds(snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const value = (snapshot as { terminalNodeIds?: unknown }).terminalNodeIds;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

type SnapshotReviewNode = {
  kind: 'human_review';
  id: string;
  artifactTaskId: string;
  revisionTaskId: string;
  minimumRole: string;
  reviewerUserIds: string[];
  allowTerminate: boolean;
};

function snapshotReviewNodes(snapshot: unknown): SnapshotReviewNode[] {
  if (!snapshot || typeof snapshot !== 'object') return [];
  const nodes = (snapshot as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.filter((node): node is SnapshotReviewNode =>
    node !== null
    && typeof node === 'object'
    && (node as { kind?: unknown }).kind === 'human_review'
    && typeof (node as { id?: unknown }).id === 'string'
    && typeof (node as { artifactTaskId?: unknown }).artifactTaskId === 'string'
    && typeof (node as { revisionTaskId?: unknown }).revisionTaskId === 'string');
}
