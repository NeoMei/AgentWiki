import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

// Must exceed one `appendfsync everysec` fsync period (worst case ~1s), or the
// durability probe times out spuriously even when persistence is healthy.
const REDIS_AOF_TIMEOUT_MS = 5_000;
const REDIS_DURABILITY_PROBE_PREFIX = 'audit:durability-probe';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    try {
      this.client = new Redis(redisUrl);

      this.client.on('connect', () => {
        this.logger.log('Redis connected');
      });

      this.client.on('error', (err) => {
        this.logger.error('Redis error:', err.message);
      });

      await this.assertAofDurability();
    } catch (error) {
      this.logger.error(`Failed Redis durability preflight: ${this.errorMessage(error)}`);
      this.client?.disconnect();
      this.client = null;
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis disconnected');
    }
  }

  private getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.getClient().get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.getClient().setex(key, ttlSeconds, value);
      } else {
        await this.getClient().set(key, value);
      }
    } catch (err: any) {
      this.logger.error('Redis set error:', err.message);
    }
  }

  async setOnce(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    return (await this.getClient().set(key, value, 'EX', ttlSeconds, 'NX')) === 'OK';
  }

  async getDel(key: string): Promise<string | null> {
    return this.getClient().getdel(key);
  }

  async getStrict(key: string): Promise<string | null> {
    return this.getClient().get(key);
  }

  async deleteStrict(key: string): Promise<number> {
    return this.getClient().del(key);
  }

  async del(key: string): Promise<void> {
    try {
      await this.getClient().del(key);
    } catch (err: any) {
      this.logger.error('Redis del error:', err.message);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.getClient().exists(key);
      return result === 1;
    } catch {
      return false;
    }
  }

  async expire(key: string, seconds: number): Promise<void> {
    try {
      await this.getClient().expire(key, seconds);
    } catch (err: any) {
      this.logger.error('Redis expire error:', err.message);
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      return await this.getClient().keys(pattern);
    } catch {
      return [];
    }
  }

  async setHashField(key: string, field: string, value: string): Promise<void> {
    await this.getClient().hset(key, field, value);
  }

  async setDurableHashField(
    key: string,
    field: string,
    value: string,
    timeoutMs = REDIS_AOF_TIMEOUT_MS,
  ): Promise<void> {
    const client = this.getClient();
    await client.hset(key, field, value);
    await this.waitForLocalAof(client, timeoutMs);
  }

  async assertAofDurability(timeoutMs = REDIS_AOF_TIMEOUT_MS): Promise<void> {
    const client = this.getClient();
    const persistence = await client.info('persistence');
    if (!/(?:^|\r?\n)aof_enabled:1(?:\r?\n|$)/.test(persistence)) {
      throw new Error('Redis AOF persistence is not enabled');
    }

    const probeId = randomUUID();
    const probeKey = `${REDIS_DURABILITY_PROBE_PREFIX}:${probeId}`;
    const probeField = 'probe';
    let probeMayExist = false;
    let cleanupConfirmed = false;
    try {
      probeMayExist = true;
      await client.hset(probeKey, probeField, probeId);
      await this.waitForLocalAof(client, timeoutMs);
      await this.confirmDurabilityProbe(client, probeKey, probeField, probeId);

      const deleted = await client.hdel(probeKey, probeField);
      if (deleted !== 1) throw new Error('Redis durability probe could not be deleted');
      await this.waitForLocalAof(client, timeoutMs);
      cleanupConfirmed = true;
    } finally {
      if (probeMayExist && !cleanupConfirmed) {
        try {
          await client.hdel(probeKey, probeField);
          await this.waitForLocalAof(client, timeoutMs);
        } catch (cleanupError) {
          this.logger.error(
            `Failed Redis durability probe cleanup for ${probeKey}: ${this.errorMessage(cleanupError)}`,
          );
        }
      }
    }
  }

  async scanHashFields(
    key: string,
    cursor: string,
    countHint: number,
  ): Promise<{ cursor: string; entries: Array<{ field: string; value: string }> }> {
    const entries: Array<{ field: string; value: string }> = [];
    const count = Math.max(1, Math.floor(countHint));
    const [nextCursor, values] = await this.getClient().hscan(key, cursor, 'COUNT', count);
    for (let index = 0; index + 1 < values.length; index += 2) {
      entries.push({ field: values[index], value: values[index + 1] });
    }
    return { cursor: nextCursor, entries };
  }

  async deleteHashField(key: string, field: string): Promise<number> {
    return this.getClient().hdel(key, field);
  }

  private async waitForLocalAof(client: Redis, timeoutMs: number): Promise<void> {
    const result = await client.call('WAITAOF', 1, 0, timeoutMs);
    const local = Array.isArray(result) ? Number(result[0]) : Number.NaN;
    if (!Number.isInteger(local) || local < 1) {
      throw new Error(`Redis did not confirm a local AOF fsync within ${timeoutMs}ms`);
    }
  }

  private async confirmDurabilityProbe(
    client: Redis,
    key: string,
    field: string,
    expectedValue: string,
  ): Promise<void> {
    let cursor = '0';
    do {
      const [nextCursor, values] = await client.hscan(key, cursor, 'COUNT', 1);
      for (let index = 0; index + 1 < values.length; index += 2) {
        if (values[index] === field && values[index + 1] === expectedValue) return;
      }
      cursor = nextCursor;
    } while (cursor !== '0');
    throw new Error('Redis durability probe could not be read back');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async incrementWithWindow(key: string, ttlSeconds: number): Promise<number | null> {
    try {
      const client = this.getClient();
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, ttlSeconds);
      return count;
    } catch {
      return null;
    }
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.getClient().ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
