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
  recordFailure(model: string, code: FailureCode): Promise<void>;
  recordSuccess(model: string): Promise<void>;
  tryAcquireProbe(model: string): Promise<boolean>;
}

const IMMEDIATE_OPEN_CODES = new Set<FailureCode>([
  'rate_limited',
  'model_unavailable',
  'auth_failed',
]);

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

  async recordFailure(model: string, code: FailureCode): Promise<void> {
    try {
      const failures = await this.redis.incrementWithWindow(
        this.key('fail', model),
        this.seconds(this.config.circuitWindowMs),
      );
      if (failures === null) throw new Error('Redis failure counter unavailable');
      if (failures >= this.config.circuitFailures || IMMEDIATE_OPEN_CODES.has(code)) {
        await this.redis.setStrict(
          this.key('open', model),
          String(Date.now() + this.config.circuitOpenMs),
          this.seconds(this.config.circuitOpenMs),
        );
      }
    } catch {
      this.warn('recordFailure', model);
    }
  }

  async recordSuccess(model: string): Promise<void> {
    try {
      await Promise.all([
        this.redis.deleteStrict(this.key('fail', model)),
        this.redis.deleteStrict(this.key('open', model)),
        this.redis.deleteStrict(this.key('probe', model)),
      ]);
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

  private key(kind: 'fail' | 'open' | 'probe', model: string): string {
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
