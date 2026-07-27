import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

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
    } catch (err: any) {
      this.logger.error('Failed to connect to Redis:', err.message);
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
