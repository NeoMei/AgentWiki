import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { BusinessException } from '../filters/business-error';
import { createHash } from 'crypto';
import { RedisService } from '../../database/redis.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly fallback = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const route = String(request.originalUrl || request.url || '');
    const apiKey = String(request.headers['x-api-key'] || '');
    const identity = apiKey
      ? 'key:' + createHash('sha256').update(apiKey).digest('hex').slice(0, 16)
      : 'ip:' + String(request.ip || request.socket?.remoteAddress || 'unknown');
    const limit = route.includes('/api/auth/') ? 10 : apiKey ? 120 : 300;
    const windowSeconds = 60;
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `rate:${bucket}:${identity}:${route.includes('/api/auth/') ? 'auth' : 'api'}`;
    const redisCount = await this.redis.incrementWithWindow(key, windowSeconds + 1);
    const count = redisCount ?? this.incrementFallback(key, windowSeconds);
    if (count > limit) {
      throw new BusinessException('AUTH_RATE_LIMITED', 'Too many requests');
    }
    return true;
  }

  private incrementFallback(key: string, ttlSeconds: number): number {
    const now = Date.now();
    const current = this.fallback.get(key);
    if (!current || current.resetAt <= now) {
      this.fallback.set(key, { count: 1, resetAt: now + ttlSeconds * 1000 });
      return 1;
    }
    current.count += 1;
    if (this.fallback.size > 10_000) {
      for (const [entryKey, entry] of this.fallback) {
        if (entry.resetAt <= now) this.fallback.delete(entryKey);
      }
    }
    return current.count;
  }
}
