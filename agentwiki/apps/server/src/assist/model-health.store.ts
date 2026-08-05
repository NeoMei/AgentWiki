import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { RedisService } from '../database/redis.service';
import { readRoutingConfig, RoutingConfig } from './opencode.config';
import { FailureCode } from './opencode.types';

export interface ModelHealth {
  failures: number;
  openUntil: number | null;
}

export interface ModelHealthStore {
  get(model: string): Promise<ModelHealth | null>;
  recordFailure(model: string, code: FailureCode, transitionAtMs?: number): Promise<void>;
  recordSuccess(model: string, transitionAtMs?: number): Promise<void>;
  tryAcquireProbe(model: string): Promise<boolean>;
}

const IMMEDIATE_OPEN_CODES = new Set<FailureCode>([
  'rate_limited',
  'model_unavailable',
  'auth_failed',
]);
const TRANSITION_FENCE_SECONDS = 86_400;

@Injectable()
export class RedisModelHealthStore implements ModelHealthStore {
  private readonly logger = new Logger(RedisModelHealthStore.name);
  private readonly config: RoutingConfig;

  constructor(
    private readonly redis: RedisService,
    @Inject(ConfigService) config: ConfigService | RoutingConfig,
  ) {
    this.config = 'circuitFailures' in config ? config : readRoutingConfig(config);
  }

  async get(model: string): Promise<ModelHealth | null> {
    try {
      const [failures, openUntil] = await Promise.all([
        this.redis.getStrict(this.key('fail', model)),
        this.redis.getStrict(this.key('open', model)),
      ]);
      if (failures === null && openUntil === null) return null;
      return {
        failures: failures === null ? 0 : Number(failures),
        openUntil: openUntil === null ? null : Number(openUntil),
      };
    } catch {
      this.warn('get', model);
      return null;
    }
  }

  async recordFailure(
    model: string,
    code: FailureCode,
    transitionAtMs = Date.now(),
  ): Promise<void> {
    try {
      await this.redis.applyModelHealthTransition(this.transitionKeys(model), {
        kind: 'failure',
        atMs: transitionAtMs,
        failureWindowSeconds: this.seconds(this.config.circuitWindowMs),
        fenceSeconds: TRANSITION_FENCE_SECONDS,
        failureThreshold: this.config.circuitFailures,
        immediateOpen: IMMEDIATE_OPEN_CODES.has(code),
        openSeconds: this.seconds(this.config.circuitOpenMs),
        openUntilMs: transitionAtMs + this.config.circuitOpenMs,
      });
    } catch {
      this.warn('recordFailure', model);
    }
  }

  async recordSuccess(model: string, transitionAtMs = Date.now()): Promise<void> {
    try {
      await this.redis.applyModelHealthTransition(this.transitionKeys(model), {
        kind: 'success',
        atMs: transitionAtMs,
        failureWindowSeconds: this.seconds(this.config.circuitWindowMs),
        fenceSeconds: TRANSITION_FENCE_SECONDS,
        failureThreshold: this.config.circuitFailures,
        immediateOpen: false,
        openSeconds: this.seconds(this.config.circuitOpenMs),
        openUntilMs: 0,
      });
    } catch {
      this.warn('recordSuccess', model);
    }
  }

  async tryAcquireProbe(model: string): Promise<boolean> {
    try {
      return await this.redis.setOnce(
        this.key('probe', model),
        '1',
        this.seconds(this.config.circuitOpenMs),
      );
    } catch {
      this.warn('tryAcquireProbe', model);
      return true;
    }
  }

  private transitionKeys(model: string) {
    return {
      failureKey: this.key('fail', model),
      openKey: this.key('open', model),
      probeKey: this.key('probe', model),
      fenceKey: this.key('fence', model),
    };
  }

  private key(kind: 'fail' | 'open' | 'probe' | 'fence', model: string): string {
    const hash = createHash('sha256').update(model).digest('hex');
    return `assist:model-health:${kind}:${hash}`;
  }

  private seconds(milliseconds: number): number {
    return Math.ceil(milliseconds / 1_000);
  }

  private warn(operation: string, model: string): void {
    this.logger.warn(`${operation} ${model}`);
  }
}
