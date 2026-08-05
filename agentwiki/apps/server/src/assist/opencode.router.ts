import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModelHealthStore } from './model-health.store';
import { buildCandidates, OpencodeModelCatalog } from './opencode.catalog';
import { readRoutingConfig, RoutingConfig } from './opencode.config';
import { OpencodeCliRunner } from './opencode.runner';
import {
  AssistAttemptSummary,
  AssistInput,
  AssistRunResult,
  EMPTY_USAGE,
  FailureCode,
  ModelCandidate,
  ModelUsage,
  OpencodeExecutionError,
  OpencodeRoutingError,
  OpencodeRunner,
} from './opencode.types';

const LEASE_SAFETY_MS = 5_000;
const NO_MODEL_ID = 'opencode/none';

@Injectable()
export class OpencodeModelRouter implements OpencodeRunner, OnModuleInit {
  private config!: RoutingConfig;

  constructor(
    private readonly catalog: OpencodeModelCatalog,
    private readonly runner: OpencodeCliRunner,
    @Inject('MODEL_HEALTH_STORE') private readonly health: ModelHealthStore,
    private readonly configService: ConfigService,
    @Optional() @Inject('OPENCODE_NOW') private readonly now: () => number = Date.now,
  ) {}

  onModuleInit(): void {
    this.config = readRoutingConfig(this.configService);
  }

  async run(task: AssistInput): Promise<AssistRunResult> {
    if (!this.config) this.onModuleInit();

    let prompt: string;
    try {
      prompt = this.runner.buildPrompt(task);
    } catch {
      throw this.routingError('configuration_error', [], { ...EMPTY_USAGE }, 0);
    }

    const leaseDeadline = task.leaseExpiresAtMs === undefined
      ? Number.POSITIVE_INFINITY
      : task.leaseExpiresAtMs - LEASE_SAFETY_MS;
    const deadline = Math.min(this.now() + this.config.totalTimeoutMs, leaseDeadline);

    let candidates: ModelCandidate[];
    try {
      candidates = this.limitCandidates(buildCandidates(
        await this.withinDeadline(() => this.catalog.getModels(), deadline),
        this.config,
        prompt,
      ));
    } catch (error) {
      throw this.routingError(this.errorCode(error), [], { ...EMPTY_USAGE }, 0);
    }

    if (candidates.length === 0) {
      throw this.routingError('no_models', [], { ...EMPTY_USAGE }, 0);
    }

    let selected: ModelCandidate[];
    try {
      selected = await this.selectHealthyCandidates(candidates, deadline);
    } catch (error) {
      throw this.routingError(this.errorCode(error), [], { ...EMPTY_USAGE }, 0, candidates[0]);
    }
    if (selected.length === 0) {
      throw this.routingError('no_models', [], { ...EMPTY_USAGE }, 0, candidates[0]);
    }

    const attempts: AssistAttemptSummary[] = [];
    const totalUsage = { ...EMPTY_USAGE };
    let totalCost = 0;

    for (const candidate of selected) {
      if (task.isActive) {
        let active: boolean;
        try {
          active = await this.withinDeadline(task.isActive, deadline);
        } catch (error) {
          throw this.routingError(this.errorCode(error), attempts, totalUsage, totalCost, candidate);
        }
        if (!active) {
          throw this.routingError('cancelled', attempts, totalUsage, totalCost, candidate);
        }
      }
      const startedAt = this.now();
      const remaining = deadline - startedAt;
      if (remaining <= 0) {
        throw this.routingError(
          'budget_exhausted',
          attempts,
          totalUsage,
          totalCost,
          candidate,
        );
      }

      try {
        const result = await this.runner.runModel(
          prompt,
          candidate.id,
          Math.min(this.config.attemptTimeoutMs, remaining),
        );
        const completedAt = this.now();
        this.addUsage(totalUsage, result.usage);
        totalCost += result.cost;
        attempts.push({
          model: candidate.id,
          tier: candidate.tier,
          durationMs: this.duration(startedAt, completedAt),
          status: 'succeeded',
          usage: { ...result.usage },
          cost: result.cost,
        });
        this.resetHealth(candidate.id, completedAt);
        return {
          summary: result.summary,
          changes: result.changes,
          model: candidate.id,
          modelTier: candidate.tier,
          attemptCount: attempts.length,
          usage: totalUsage,
          cost: totalCost,
          attempts,
        };
      } catch (error) {
        const completedAt = this.now();
        const code = this.errorCode(error);
        const failureUsage = error instanceof OpencodeExecutionError
          ? error.usage
          : EMPTY_USAGE;
        const failureCost = error instanceof OpencodeExecutionError
          ? error.cost
          : 0;
        this.addUsage(totalUsage, failureUsage);
        totalCost += failureCost;
        attempts.push({
          model: candidate.id,
          tier: candidate.tier,
          durationMs: this.duration(startedAt, completedAt),
          status: 'failed',
          errorCode: code,
          usage: { ...failureUsage },
          cost: failureCost,
        });

        if (!(error instanceof OpencodeExecutionError) || error.scope !== 'model') {
          throw this.routingError(code, attempts, totalUsage, totalCost, candidate);
        }
        try {
          await this.withinDeadline(
            () => this.health.recordFailure(candidate.id, error.code, completedAt),
            deadline,
          );
        } catch (healthError) {
          throw this.routingError(
            this.errorCode(healthError),
            attempts,
            totalUsage,
            totalCost,
            candidate,
          );
        }
      }
    }

    const last = selected[selected.length - 1];
    const finalCode = attempts[attempts.length - 1]?.errorCode || 'no_models';
    throw this.routingError(finalCode, attempts, totalUsage, totalCost, last);
  }

  private limitCandidates(candidates: ModelCandidate[]): ModelCandidate[] {
    let free = 0;
    let paid = 0;
    return candidates.filter((candidate) => {
      if (candidate.tier === 'free') {
        free += 1;
        return free <= this.config.maxFreeAttempts;
      }
      paid += 1;
      return this.config.allowPaidFallback && paid <= this.config.maxPaidAttempts;
    });
  }

  private async selectHealthyCandidates(
    candidates: ModelCandidate[],
    deadline: number,
  ): Promise<ModelCandidate[]> {
    const now = this.now();
    const states = await Promise.all(candidates.map(async (candidate) => ({
      candidate,
      health: await this.withinDeadline(() => this.health.get(candidate.id), deadline),
    })));
    const available = states
      .filter(({ health }) => health?.openUntil === null || health === null || health.openUntil <= now)
      .map(({ candidate }) => candidate);
    if (available.length > 0) return available;

    const freeProbe = states
      .filter(({ candidate, health }) => candidate.tier === 'free' && health?.openUntil !== null)
      .sort((left, right) => (
        (left.health?.openUntil || Number.POSITIVE_INFINITY)
        - (right.health?.openUntil || Number.POSITIVE_INFINITY)
      ))[0]?.candidate;
    if (
      !freeProbe
      || !(await this.withinDeadline(
        () => this.health.tryAcquireProbe(freeProbe.id),
        deadline,
      ))
    ) return [];
    return [freeProbe];
  }

  private withinDeadline<T>(operation: () => Promise<T>, deadline: number): Promise<T> {
    const remaining = deadline - this.now();
    if (remaining <= 0) return Promise.reject(this.budgetError());

    let pending: Promise<T>;
    try {
      pending = operation();
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(this.budgetError());
      }, remaining);
      timer.unref();

      void pending.then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private budgetError(): OpencodeExecutionError {
    return new OpencodeExecutionError(
      'budget_exhausted',
      'budget_exhausted',
      'global',
      { ...EMPTY_USAGE },
    );
  }

  private resetHealth(model: string, transitionAtMs: number): void {
    try {
      void this.health.recordSuccess(model, transitionAtMs).catch(() => undefined);
    } catch { /* Health cleanup is best-effort after a successful model result. */ }
  }

  private errorCode(error: unknown): FailureCode {
    return error instanceof OpencodeExecutionError ? error.code : 'process_error';
  }

  private duration(startedAt: number, completedAt: number): number {
    return Math.max(0, completedAt - startedAt);
  }

  private addUsage(total: ModelUsage, addition: ModelUsage): void {
    total.input += addition.input;
    total.output += addition.output;
    total.reasoning += addition.reasoning;
    total.cacheRead += addition.cacheRead;
    total.cacheWrite += addition.cacheWrite;
    total.total += addition.total;
  }

  private routingError(
    code: FailureCode,
    attempts: AssistAttemptSummary[],
    usage: ModelUsage,
    cost: number,
    candidate?: ModelCandidate,
  ): OpencodeRoutingError {
    const finalCandidate = candidate || (attempts.length > 0
      ? {
          id: attempts[attempts.length - 1].model,
          tier: attempts[attempts.length - 1].tier,
        }
      : undefined);
    return new OpencodeRoutingError(`OpenCode routing failed: ${code}`, {
      summary: 'Editing assistant failed',
      model: finalCandidate?.id || NO_MODEL_ID,
      modelTier: finalCandidate?.tier || 'free',
      attemptCount: attempts.length,
      usage: { ...usage },
      cost,
      attempts: attempts.map((attempt) => ({
        ...attempt,
        usage: { ...attempt.usage },
      })),
    });
  }
}
