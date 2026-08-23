import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessException } from '../core/filters/business-error';

export type IdempotencyActorKind = 'human' | 'agent' | 'system';

export type IdempotencyScope<T> = {
  runId: string;
  actorKind: IdempotencyActorKind;
  actorId: string;
  actorUserId?: string;
  actorAgentId?: string;
  operation: string;
  target: string;
  key: string;
  requestHash: string;
  eventType?: string;
  metadata?: Record<string, unknown>;
  responseForStorage?: (response: T) => unknown;
};

@Injectable()
export class RunEventStore {
  async findReplay<T>(tx: Prisma.TransactionClient, scope: IdempotencyScope<T>): Promise<T | undefined> {
    const existing = await tx.collaborationRunEvent.findFirst({
      where: {
        runId: scope.runId,
        actorKind: scope.actorKind,
        actorId: scope.actorId,
        idempotencyKey: scope.key,
      },
      orderBy: { sequence: 'asc' },
    });
    if (!existing) return undefined;
    this.assertReplayMatches(existing, scope);
    return cloneJson(existing.response) as T;
  }

  async executeIdempotent<T>(
    tx: Prisma.TransactionClient,
    scope: IdempotencyScope<T>,
    mutation: () => Promise<T>,
  ): Promise<T> {
    const replay = await this.findReplay(tx, scope);
    if (replay !== undefined) return replay;

    await tx.$queryRawUnsafe('SELECT "id" FROM "CollaborationRun" WHERE "id" = $1 FOR UPDATE', scope.runId);
    const replayAfterLock = await this.findReplay(tx, scope);
    if (replayAfterLock !== undefined) return replayAfterLock;

    const response = await mutation();
    const run = await tx.collaborationRun.update({
      where: { id: scope.runId },
      data: { eventSequence: { increment: 1 } },
      select: { eventSequence: true },
    });
    const safeResponse = scope.responseForStorage ? scope.responseForStorage(response) : response;
    await tx.collaborationRunEvent.create({
      data: {
        runId: scope.runId,
        sequence: run.eventSequence,
        type: scope.eventType ?? `collaboration.${scope.operation}`,
        actorKind: scope.actorKind,
        actorId: scope.actorId,
        actorUserId: scope.actorUserId,
        actorAgentId: scope.actorAgentId,
        operation: scope.operation,
        target: scope.target,
        idempotencyKey: scope.key,
        requestHash: scope.requestHash,
        metadata: toInputJson(scope.metadata ?? {}),
        response: toInputJson(safeResponse),
      },
    });
    return response;
  }

  private assertReplayMatches<T>(
    existing: { operation: string; target: string; requestHash: string },
    scope: IdempotencyScope<T>,
  ): void {
    if (
      existing.operation !== scope.operation
      || existing.target !== scope.target
      || existing.requestHash !== scope.requestHash
    ) {
      throw new BusinessException('COLLABORATION_IDEMPOTENCY_MISMATCH');
    }
  }
}

export function canonicalRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(sortObject(value))).digest('hex');
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortObject((value as Record<string, unknown>)[key]);
      return result;
    }, {});
  }
  return value;
}

function cloneJson(value: unknown): unknown {
  return value === null || value === undefined ? value : structuredClone(value);
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return structuredClone(value) as Prisma.InputJsonValue;
}
