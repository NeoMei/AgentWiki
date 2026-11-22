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

export async function recordUniHubSourceLifecycle(
  tx: Prisma.TransactionClient,
  userId: string,
  previousLocalVersion: number,
  state?: SourceState,
): Promise<void> {
  if (!shouldRecordUniHubLifecycle()) return;

  // Gateway enrollment can commit before its binding is stored in AgentWiki.
  await tx.$executeRaw`
    INSERT INTO "UniHubLifecycleOutbox" ("id", "userId", "previousLocalVersion", "state")
    VALUES (${randomUUID()}, ${userId}, ${previousLocalVersion}, ${state ?? null})
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

        if (await this.deliver(event)) {
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

  private async deliver(event: LifecycleEvent): Promise<boolean> {
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
      return receipt?.auth_version === next;
    } catch (error) {
      if (!(error instanceof UniHubRuntimeError) || error.status !== 409) return false;
    }

    // A native account can first enroll at a version newer than a queued event.
    // Only the Gateway's exact source status can substantiate supersession.
    try {
      const status = await this.client.request<{ local_user_id: string; auth_version: number; state: SourceState }>(
        '/source-lifecycle/status', { local_user_id: event.userId },
      );
      if (status?.local_user_id !== event.userId || !Number.isSafeInteger(status.auth_version) ||
          !['locked', 'active', 'deleted'].includes(status.state)) return false;

      return status.auth_version > next ||
        (status.auth_version === next && (event.state === null || event.state === status.state));
    } catch {
      return false;
    }
  }
}
