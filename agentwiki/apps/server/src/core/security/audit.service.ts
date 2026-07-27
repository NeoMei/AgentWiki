import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../database/redis.service';

export interface AuditEventInput {
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  actorUserId?: string;
  actorAgentId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

type PendingAuditEvent = Prisma.SecurityAuditEventUncheckedCreateInput & { id: string };

const AUDIT_PENDING_KEY = 'audit:pending';
const AUDIT_DEAD_KEY = 'audit:dead';
const AUDIT_RETRY_INTERVAL_MS = 30_000;
const AUDIT_RETRY_BATCH_SIZE = 100;
const PERMANENT_PRISMA_ERROR_CODES = new Set([
  'P2000',
  'P2003',
  'P2005',
  'P2006',
  'P2007',
  'P2011',
  'P2012',
  'P2013',
  'P2014',
  'P2023',
]);
const AggregateErrorWithCause = AggregateError as unknown as new (
  errors: Iterable<unknown>,
  message?: string,
  options?: { cause?: unknown },
) => AggregateError;

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private retryTimer?: NodeJS.Timeout;
  private drainPromise?: Promise<number>;
  private pendingCursor = '0';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    await this.tryDrainPending();
    this.retryTimer = setInterval(() => void this.tryDrainPending(), AUDIT_RETRY_INTERVAL_MS);
    this.retryTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = undefined;
  }

  async record(event: AuditEventInput): Promise<void> {
    const data = this.toPendingEvent(event);
    try {
      await this.prisma.securityAuditEvent.create({ data });
    } catch (databaseError) {
      this.logger.error(`Failed to persist audit event ${event.action}: ${this.errorMessage(databaseError)}`);
      try {
        await this.redis.setDurableHashField(AUDIT_PENDING_KEY, data.id, JSON.stringify(data));
      } catch (redisError) {
        this.logger.error(
          `Failed to durably queue audit event ${event.action}; pending Redis field may remain, `
          + `but local AOF durability was not confirmed: ${this.errorMessage(redisError)}`,
        );
        throw new AggregateErrorWithCause(
          [databaseError, redisError],
          `Failed to persist or durably queue audit event ${event.action}`,
          { cause: databaseError },
        );
      }
    }
  }

  drainPending(limit = AUDIT_RETRY_BATCH_SIZE): Promise<number> {
    if (this.drainPromise) return this.drainPromise;
    const draining = this.performDrain(limit);
    this.drainPromise = draining;
    return draining.finally(() => {
      if (this.drainPromise === draining) this.drainPromise = undefined;
    });
  }

  private async performDrain(limit: number): Promise<number> {
    const page = await this.redis.scanHashFields(AUDIT_PENDING_KEY, this.pendingCursor, limit);
    this.pendingCursor = page.cursor;
    let acknowledged = 0;
    for (const entry of page.entries) {
      let data: PendingAuditEvent;
      try {
        data = this.parsePendingEvent(entry.field, entry.value);
      } catch (error) {
        this.logger.error(`Invalid pending audit event ${entry.field}: ${this.errorMessage(error)}`);
        if (await this.moveToDeadLetter(entry.field, entry.value, 'invalid-payload')) {
          acknowledged += 1;
        }
        continue;
      }

      try {
        await this.prisma.securityAuditEvent.create({ data });
      } catch (error) {
        if (this.isAlreadyPersisted(error)) {
          // The stable audit ID makes a duplicate retry safe to acknowledge.
        } else if (this.isPermanentPersistenceError(error)) {
          const code = this.prismaErrorCode(error) as string;
          if (await this.moveToDeadLetter(entry.field, entry.value, `prisma:${code}`)) {
            acknowledged += 1;
          }
          continue;
        } else {
          this.logger.error(`Failed to retry audit event ${data.action}: ${this.errorMessage(error)}`);
          continue;
        }
      }

      if (await this.acknowledgePending(entry.field)) acknowledged += 1;
    }
    return acknowledged;
  }

  private async moveToDeadLetter(field: string, payload: string, reason: string): Promise<boolean> {
    const deadLetter = JSON.stringify({
      auditId: field,
      failedAt: new Date().toISOString(),
      reason,
      payload,
    });
    try {
      await this.redis.setDurableHashField(AUDIT_DEAD_KEY, field, deadLetter);
      await this.redis.deleteHashField(AUDIT_PENDING_KEY, field);
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to durably dead-letter audit event ${field}; pending entry retained: ${this.errorMessage(error)}`,
      );
      return false;
    }
  }

  private async acknowledgePending(field: string): Promise<boolean> {
    try {
      await this.redis.deleteHashField(AUDIT_PENDING_KEY, field);
      return true;
    } catch (error) {
      this.logger.error(`Failed to acknowledge pending audit event ${field}: ${this.errorMessage(error)}`);
      return false;
    }
  }

  private async tryDrainPending(): Promise<void> {
    try {
      await this.drainPending();
    } catch (error) {
      this.logger.error(`Failed to drain pending audit events: ${this.errorMessage(error)}`);
    }
  }

  private toPendingEvent(event: AuditEventInput): PendingAuditEvent {
    return {
      id: randomUUID(),
      action: event.action,
      outcome: event.outcome,
      actorUserId: event.actorUserId,
      actorAgentId: event.actorAgentId,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      metadata: event.metadata as Prisma.InputJsonValue | undefined,
    };
  }

  private parsePendingEvent(field: string, value: string): PendingAuditEvent {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || (parsed as { id?: unknown }).id !== field) {
      throw new Error('Pending audit ID does not match its Redis field');
    }
    return parsed as PendingAuditEvent;
  }

  private isAlreadyPersisted(error: unknown): boolean {
    return this.prismaErrorCode(error) === 'P2002';
  }

  private isPermanentPersistenceError(error: unknown): boolean {
    const code = this.prismaErrorCode(error);
    return typeof code === 'string' && PERMANENT_PRISMA_ERROR_CODES.has(code);
  }

  private prismaErrorCode(error: unknown): unknown {
    return error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
