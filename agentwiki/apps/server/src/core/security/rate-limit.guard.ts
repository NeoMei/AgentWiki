import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BusinessException } from '../filters/business-error';
import { createHash } from 'crypto';
import { isIP } from 'net';
import { RedisService } from '../../database/redis.service';

const MAX_FALLBACK_BUCKETS = 10_000;
const AUTH_RATE_LIMIT = 10;
const MAX_E2E_AUTH_RATE_LIMIT = 1_000;
const API_IP_RATE_LIMIT = 300;
const MAX_E2E_API_IP_RATE_LIMIT = 10_000;

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly fallback = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const route = String(request.originalUrl || request.url || '');
    const pathname = this.pathname(route);
    const apiKey = String(request.headers?.['x-api-key'] || '');
    const authorization = String(request.headers?.authorization || '');
    const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const bearerCredential = /^(?:agk|awk)_/.test(bearerToken) ? bearerToken : '';
    const presentedCredentials = [...new Set([bearerCredential, apiKey].filter(Boolean))];
    const isAuthRoute = pathname === '/api/auth' || pathname.startsWith('/api/auth/');
    const ipIdentity = 'ip:' + this.normalizeClientIp(request.ip || request.socket?.remoteAddress);
    const windowSeconds = 60;
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    if (isAuthRoute) {
      await this.consume(
        `rate:${bucket}:${ipIdentity}:auth`,
        this.authRateLimit(),
        windowSeconds,
      );
      return true;
    }
    // The global guard runs before authentication, so a raw X-API-Key header
    // is not a trusted identity. Keep the useful per-key ceiling, but always
    // pair it with an IP ceiling that rotating bogus headers cannot evade.
    await this.consume(
      `rate:${bucket}:${ipIdentity}:api`,
      this.apiIpRateLimit(),
      windowSeconds,
    );
    for (const presentedCredential of presentedCredentials) {
      const keyIdentity = 'key:' + createHash('sha256').update(presentedCredential).digest('hex').slice(0, 16);
      await this.consume(`rate:${bucket}:${keyIdentity}:api`, 120, windowSeconds);
    }
    return true;
  }

  private authRateLimit(): number {
    return this.e2eRateLimit(
      'AGENTWIKI_E2E_AUTH_RATE_LIMIT',
      AUTH_RATE_LIMIT,
      MAX_E2E_AUTH_RATE_LIMIT,
    );
  }

  private apiIpRateLimit(): number {
    return this.e2eRateLimit(
      'AGENTWIKI_E2E_API_RATE_LIMIT',
      API_IP_RATE_LIMIT,
      MAX_E2E_API_IP_RATE_LIMIT,
    );
  }

  private e2eRateLimit(name: string, defaultLimit: number, maximum: number): number {
    if (process.env.NODE_ENV !== 'test') return defaultLimit;
    const configured = process.env[name];
    if (!configured || !/^[1-9][0-9]*$/.test(configured)) return defaultLimit;
    const parsed = Number(configured);
    if (
      !Number.isSafeInteger(parsed)
      || parsed <= defaultLimit
      || parsed > maximum
    ) {
      return defaultLimit;
    }
    return parsed;
  }

  private async consume(key: string, limit: number, windowSeconds: number) {
    const redisCount = await this.redis.incrementWithWindow(key, windowSeconds + 1);
    const count = redisCount ?? this.incrementFallback(key, windowSeconds);
    if (count > limit) throw new BusinessException('AUTH_RATE_LIMITED', 'Too many requests');
  }

  private pathname(route: string): string {
    try {
      return new URL(route, 'http://localhost').pathname;
    } catch {
      return route.split(/[?#]/, 1)[0] || '/';
    }
  }

  private normalizeClientIp(value: unknown): string {
    const address = String(value || 'unknown').trim().toLowerCase().replace(/%[^%]+$/, '');
    if (address === '::1') return '127.0.0.1';
    if (address.startsWith('::ffff:')) {
      const ipv4 = address.slice('::ffff:'.length);
      if (isIP(ipv4) === 4) return ipv4;
    }
    return address || 'unknown';
  }

  private incrementFallback(key: string, ttlSeconds: number): number {
    const now = Date.now();
    const current = this.fallback.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && this.fallback.size >= MAX_FALLBACK_BUCKETS) {
        for (const [entryKey, entry] of this.fallback) {
          if (entry.resetAt <= now) this.fallback.delete(entryKey);
        }
        if (this.fallback.size >= MAX_FALLBACK_BUCKETS) return Number.MAX_SAFE_INTEGER;
      }
      this.fallback.set(key, { count: 1, resetAt: now + ttlSeconds * 1000 });
      return 1;
    }
    current.count += 1;
    if (this.fallback.size >= MAX_FALLBACK_BUCKETS) {
      for (const [entryKey, entry] of this.fallback) {
        if (entry.resetAt <= now) this.fallback.delete(entryKey);
      }
    }
    return current.count;
  }
}
