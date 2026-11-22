import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { hasUniHubLifecycleRuntime, UniHubClient, UniHubRuntimeError } from './unihub-client';

type SourceState = 'locked' | 'active' | 'deleted';

type LifecycleEvent = {
  id: string;
  userId: string;
  previousLocalVersion: number;
  state: SourceState | null;
  attempts: number;
};

const POLL_INTERVAL_MS = 1_000;
const POLL_BATCH_SIZE = 20;

export function shouldRecordUniHubLifecycle(): boolean {
  return process.env.UNIHUB_IDENTITY_ENABLED === 'true' || hasUniHubLifecycleRuntime(
    process.env.UNIHUB_IDENTITY_API_ORIGIN,
    process.env.UNIHUB_IDENTITY_RUNTIME_TOKEN,
  );
}

/**
 * Commit this intent before sending the first mapping-capable request to UniHub.
 * Build the source authentication proof first and use that proof for this attempt.
 */
export async function persistUniHubEnrollmentIntent(
  prisma: PrismaService,
  userId: string,
  expectedAuthVersion: number,
): Promise<boolean> {
  const recorded = await prisma.$executeRaw`
    WITH eligible AS (
      -- Serialize with native account mutations, including a self-delete that
      -- started a serializable snapshot before the intent was recorded.
      UPDATE "User" SET "authVersion" = "authVersion"
      WHERE "id" = ${userId} AND "authVersion" = ${expectedAuthVersion}
        AND "type" = 'human' AND "lockedAt" IS NULL AND "deletedAt" IS NULL AND NOT "mustChangePassword"
      RETURNING "id"
    )
    INSERT INTO "UniHubEnrollmentIntent" ("userId", "reconcileAfter")
    -- Allow for UniHub's 60-second proof freshness window and 30-second request deadline.
    SELECT "id", clock_timestamp() + INTERVAL '2 minutes' FROM eligible
    ON CONFLICT ("userId") DO UPDATE SET "reconcileAfter" = EXCLUDED."reconcileAfter"
  `;
  return recorded === 1;
}

export async function recordUniHubSourceLifecycle(
  tx: Prisma.TransactionClient,
  userId: string,
  previousLocalVersion: number,
  state?: SourceState,
): Promise<void> {
  if (!shouldRecordUniHubLifecycle()) return;

  await tx.$executeRaw`
    INSERT INTO "UniHubLifecycleOutbox" ("id", "userId", "previousLocalVersion", "state")
    SELECT ${randomUUID()}, ${userId}, ${previousLocalVersion}, ${state ?? null}
    WHERE EXISTS (SELECT 1 FROM "UniHubIdentityBinding" WHERE "userId" = ${userId})
       OR EXISTS (SELECT 1 FROM "UniHubEnrollmentIntent" WHERE "userId" = ${userId})
  `;
}

@Injectable()
export class UniHubLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UniHubLifecycleService.name);
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: UniHubClient,
  ) {}

  onModuleInit(): void {
    if (!this.client.lifecycleEnabled) return;

    this.timer = setInterval(() => {
      void this.pollOnce().catch(() => this.logger.warn('Could not poll the UniHub lifecycle outbox'));
    }, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    await this.inFlight?.catch(() => undefined);
  }

  async pollOnce(): Promise<void> {
    if (!this.client.lifecycleEnabled || this.stopping || this.inFlight) return;
    this.inFlight = this.drain();
    try {
      await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async drain(): Promise<void> {
    for (let i = 0; i < POLL_BATCH_SIZE && !this.stopping; i++) {
      const found = await this.prisma.$transaction(async (tx) => {
        // A deferred or claimed head still blocks later events for its user.
        const [event] = await tx.$queryRaw<LifecycleEvent[]>`
          SELECT pending."id", pending."userId", pending."previousLocalVersion", pending."state", pending."attempts"
          FROM "UniHubLifecycleOutbox" AS pending
          WHERE pending."availableAt" <= CURRENT_TIMESTAMP
            AND NOT EXISTS (
              SELECT 1 FROM "UniHubLifecycleOutbox" AS earlier
              WHERE earlier."userId" = pending."userId"
                AND earlier."previousLocalVersion" < pending."previousLocalVersion"
            )
          ORDER BY pending."availableAt", pending."id"
          LIMIT 1
          FOR UPDATE OF pending SKIP LOCKED
        `;
        if (!event) return false;

        if (await this.deliver(tx, event)) {
          await tx.$executeRaw`DELETE FROM "UniHubLifecycleOutbox" WHERE "id" = ${event.id}`;
        } else {
          const delayMs = Math.min(60_000, POLL_INTERVAL_MS * 2 ** Math.min(event.attempts, 6));
          await tx.$executeRaw`
            UPDATE "UniHubLifecycleOutbox" SET
              "attempts" = "attempts" + 1,
              "availableAt" = clock_timestamp() + ${delayMs} * INTERVAL '1 millisecond'
            WHERE "id" = ${event.id}
          `;
        }
        return true;
      // A transition and a conflict lookup can each use the client's HTTP timeout.
      }, { timeout: 10_000 });
      if (!found) return;
    }
  }

  private async deliver(tx: Prisma.TransactionClient, event: LifecycleEvent): Promise<boolean> {
    const previous = event.previousLocalVersion + 1;
    const next = previous + 1;

    try {
      const receipt = await this.client.request<{ auth_version: number }>('/source-lifecycle', {
        operation_id: event.id,
        local_user_id: event.userId,
        previous_auth_version: previous,
        next_auth_version: next,
        ...(event.state ? { state: event.state } : {}),
      });
      if (receipt?.auth_version !== next) return false;
    } catch (error) {
      if (!(error instanceof UniHubRuntimeError) || ![404, 409].includes(error.status)) return false;
      return this.reconcile(tx, event, next);
    }

    await this.observeMapping(tx, event.userId);
    return true;
  }

  private async reconcile(tx: Prisma.TransactionClient, event: LifecycleEvent, next: number): Promise<boolean> {
    let status: { local_user_id?: unknown; found?: unknown; auth_version?: unknown; state?: unknown } | undefined;
    try {
      status = await this.client.request<typeof status>('/source-lifecycle/status', { local_user_id: event.userId });
    } catch {
      return false;
    }

    if (status?.local_user_id !== event.userId) return false;
    const { found, auth_version: version, state } = status;
    if (found === false) {
      if (version !== undefined || state !== undefined) return false;
      return this.retireUnmappedIntent(tx, event.userId);
    }
    if ((found !== undefined && found !== true) ||
        typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1 ||
        (state !== 'locked' && state !== 'active' && state !== 'deleted')) return false;

    // A native account can first enroll at a version newer than a queued event.
    await this.observeMapping(tx, event.userId);
    return version > next || (version === next && (event.state === null || event.state === state));
  }

  private async observeMapping(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO "UniHubEnrollmentIntent" ("userId", "reconcileAfter", "mappingObserved")
      SELECT account."id", CURRENT_TIMESTAMP, TRUE
      FROM "User" AS account
      WHERE account."id" = ${userId} AND account."type" = 'human'
        AND NOT EXISTS (SELECT 1 FROM "UniHubIdentityBinding" WHERE "userId" = account."id")
      ON CONFLICT ("userId") DO UPDATE SET "mappingObserved" = TRUE
      WHERE NOT "UniHubEnrollmentIntent"."mappingObserved"
    `;
  }

  private async retireUnmappedIntent(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
    const [result] = await tx.$queryRaw<Array<{ retire: boolean }>>`
      WITH bound AS (
        SELECT 1 FROM "UniHubIdentityBinding" WHERE "userId" = ${userId}
      ), expired AS (
        DELETE FROM "UniHubEnrollmentIntent"
        WHERE "userId" = ${userId} AND NOT "mappingObserved"
          -- Require the window to have ended before this poll's status lookup.
          AND "reconcileAfter" <= CURRENT_TIMESTAMP AND NOT EXISTS (SELECT 1 FROM bound)
        RETURNING "userId"
      )
      SELECT NOT EXISTS (SELECT 1 FROM bound)
        AND (EXISTS (SELECT 1 FROM expired) OR NOT EXISTS (
          SELECT 1 FROM "UniHubEnrollmentIntent" WHERE "userId" = ${userId}
        )) AS retire
    `;
    return result.retire;
  }
}
