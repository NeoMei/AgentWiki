import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TemplateEffectJob } from '@prisma/client';
import { CollaborationEventsService } from '../collaboration-workflows/collaboration-events.service';
import { SearchService } from '../core/search/search.service';
import { PrismaService } from '../database/prisma.service';
import { GraphRefreshService } from '../knowledge-graph/graph-refresh.service';

const MAX_ATTEMPTS = 8;
const CLAIM_BATCH_SIZE = 25;
const POLL_INTERVAL_MS = 1_000;
const STALE_CLAIM_MS = 5 * 60_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const GRAPH_RETRY_REASONS = new Set([
  'llm_unavailable', 'rate_limited', 'proposal_pending', 'no_author',
]);

type DrainResult = { claimed: number; completed: number; retried: number; failed: number };

class EffectDispatchError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'EffectDispatchError';
  }
}

@Injectable()
export class TemplateEffectsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TemplateEffectsService.name);
  private timer?: NodeJS.Timeout;
  private activeDrain?: Promise<DrainResult>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly search: SearchService,
    private readonly graph: GraphRefreshService,
    private readonly events: CollaborationEventsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const role = String(this.config.get('PROCESS_ROLE', 'api')).toLowerCase();
    if (role !== 'worker' && role !== 'all') return;
    await this.drain();
    this.timer = setInterval(() => {
      void this.drain().catch(() => this.logger.warn('template effect drain failed'));
    }, POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  drain(): Promise<DrainResult> {
    if (this.activeDrain) return this.activeDrain;
    this.activeDrain = this.runDrain().finally(() => {
      this.activeDrain = undefined;
    });
    return this.activeDrain;
  }

  private async runDrain(): Promise<DrainResult> {
    const result: DrainResult = { claimed: 0, completed: 0, retried: 0, failed: 0 };
    const candidates = await this.claimCandidates(new Date());
    for (const candidate of candidates) {
      if (candidate.status === 'processing' && candidate.attempts >= MAX_ATTEMPTS) {
        const expired = await this.prisma.templateEffectJob.updateMany({
          where: {
            id: candidate.id, status: 'processing', attempts: candidate.attempts,
            lockedAt: candidate.lockedAt,
          },
          data: {
            status: 'failed', lockedAt: null, lastError: 'TEMPLATE_EFFECT_CLAIM_EXPIRED',
          },
        });
        result.failed += expired.count;
        continue;
      }

      const lockedAt = new Date();
      const claimed = await this.prisma.templateEffectJob.updateMany({
        where: {
          id: candidate.id, status: candidate.status, attempts: candidate.attempts,
          lockedAt: candidate.lockedAt,
        },
        data: { status: 'processing', attempts: { increment: 1 }, lockedAt, lastError: null },
      });
      if (claimed.count !== 1) continue;
      result.claimed += 1;
      const attempt = candidate.attempts + 1;

      try {
        await this.dispatch(candidate);
        const completed = await this.prisma.templateEffectJob.updateMany({
          where: { id: candidate.id, status: 'processing', attempts: attempt, lockedAt },
          data: { status: 'done', lockedAt: null, lastError: null },
        });
        result.completed += completed.count;
      } catch (error) {
        const code = error instanceof EffectDispatchError
          ? error.code
          : 'TEMPLATE_EFFECT_HANDLER_FAILED';
        const terminal = attempt >= MAX_ATTEMPTS;
        const failed = await this.prisma.templateEffectJob.updateMany({
          where: { id: candidate.id, status: 'processing', attempts: attempt, lockedAt },
          data: terminal
            ? { status: 'failed', lockedAt: null, lastError: code }
            : {
              status: 'pending', lockedAt: null, lastError: code,
              availableAt: new Date(Date.now() + retryDelay(attempt)),
            },
        });
        if (terminal) result.failed += failed.count;
        else result.retried += failed.count;
      }
    }
    return result;
  }

  private claimCandidates(now: Date): Promise<TemplateEffectJob[]> {
    return this.prisma.templateEffectJob.findMany({
      where: {
        OR: [
          { status: 'pending', attempts: { lt: MAX_ATTEMPTS }, availableAt: { lte: now } },
          { status: 'processing', lockedAt: { lte: new Date(now.getTime() - STALE_CLAIM_MS) } },
        ],
      },
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: CLAIM_BATCH_SIZE,
    });
  }

  private async dispatch(job: TemplateEffectJob): Promise<void> {
    if (job.kind === 'page_index') {
      const { pageId } = exactIdPayload(job.payload, 'pageId');
      const page = await this.prisma.page.findUnique({
        where: { id: pageId }, select: { id: true, spaceId: true, deletedAt: true },
      });
      if (page && page.spaceId !== job.spaceId) throw new EffectDispatchError('TEMPLATE_EFFECT_SCOPE_MISMATCH');
      const indexed = await this.search.indexPage(pageId);
      if (page?.deletedAt || !page) return;
      if (!indexed.lexicalIndexed) throw new EffectDispatchError('PAGE_INDEX_LEXICAL_PENDING');
      if (!indexed.semanticIndexed) throw new EffectDispatchError('PAGE_INDEX_SEMANTIC_PENDING');
      return;
    }

    if (job.kind === 'space_graph') {
      const { spaceId } = exactIdPayload(job.payload, 'spaceId');
      if (spaceId !== job.spaceId) throw new EffectDispatchError('TEMPLATE_EFFECT_SCOPE_MISMATCH');
      const space = await this.prisma.space.findUnique({
        where: { id: spaceId }, select: { id: true, deletedAt: true },
      });
      if (!space || space.deletedAt) return;
      const refreshed = await this.graph.refresh(spaceId);
      const reason = refreshed.llm.reason;
      if (reason && GRAPH_RETRY_REASONS.has(reason)) {
        throw new EffectDispatchError(`SPACE_GRAPH_LLM_DEFERRED:${reason}`);
      }
      return;
    }

    if (job.kind === 'collaboration_run') {
      const { runId } = exactIdPayload(job.payload, 'runId');
      const run = await this.prisma.collaborationRun.findUnique({
        where: { id: runId }, select: { id: true, spaceId: true },
      });
      if (!run) return;
      if (run.spaceId !== job.spaceId) throw new EffectDispatchError('TEMPLATE_EFFECT_SCOPE_MISMATCH');
      await this.events.publishCurrentRun(runId);
      return;
    }

    throw new EffectDispatchError('TEMPLATE_EFFECT_KIND_INVALID');
  }
}

function exactIdPayload(payload: unknown, key: string): Record<string, string> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new EffectDispatchError('TEMPLATE_EFFECT_PAYLOAD_INVALID');
  }
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record[key] !== 'string' || record[key]!.length === 0) {
    throw new EffectDispatchError('TEMPLATE_EFFECT_PAYLOAD_INVALID');
  }
  return { [key]: record[key] as string };
}

function retryDelay(attempt: number): number {
  return Math.min(INITIAL_BACKOFF_MS * (2 ** Math.max(0, attempt - 1)), MAX_BACKOFF_MS);
}
