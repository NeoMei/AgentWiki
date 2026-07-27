import { ExecutionContext } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

describe('RateLimitGuard identity boundaries', () => {
  let counts: Map<string, number>;
  let redis: { incrementWithWindow: jest.Mock };
  let guard: RateLimitGuard;

  const contextFor = (request: Record<string, unknown>) => ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as ExecutionContext;

  beforeEach(() => {
    counts = new Map();
    redis = {
      incrementWithWindow: jest.fn(async (key: string) => {
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        return count;
      }),
    };
    guard = new RateLimitGuard(redis as any);
  });

  it('rate limits auth requests by client IP even when every API key is different', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(guard.canActivate(contextFor({
        originalUrl: '/api/auth/login',
        headers: { 'x-api-key': `random-key-${attempt}` },
        ip: '203.0.113.10',
      }))).resolves.toBe(true);
    }

    await expect(guard.canActivate(contextFor({
      originalUrl: '/api/auth/login',
      headers: { 'x-api-key': 'another-random-key' },
      ip: '203.0.113.10',
    }))).rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
  });

  it('treats the exact /api/auth pathname as an auth route', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(guard.canActivate(contextFor({
        originalUrl: '/api/auth',
        headers: { 'x-api-key': `random-key-${attempt}` },
        ip: '203.0.113.11',
      }))).resolves.toBe(true);
    }

    await expect(guard.canActivate(contextFor({
      originalUrl: '/api/auth',
      headers: { 'x-api-key': 'another-random-key' },
      ip: '203.0.113.11',
    }))).rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
  });

  it('does not classify an auth-looking query value as an auth route', async () => {
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await expect(guard.canActivate(contextFor({
        originalUrl: '/api/pages?redirect=/api/auth/login',
        headers: { 'x-api-key': 'valid-api-key' },
        ip: '203.0.113.12',
      }))).resolves.toBe(true);
    }
  });

  it('normalizes IPv4-mapped client addresses into the same auth bucket', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(guard.canActivate(contextFor({
        originalUrl: '/api/auth/login',
        headers: {},
        ip: '::ffff:203.0.113.20',
      }))).resolves.toBe(true);
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(guard.canActivate(contextFor({
        originalUrl: '/api/auth/login',
        headers: {},
        ip: '203.0.113.20',
      }))).resolves.toBe(true);
    }

    await expect(guard.canActivate(contextFor({
      originalUrl: '/api/auth/login',
      headers: {},
      ip: '203.0.113.20',
    }))).rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
  });

  it('keeps the 120-request credential bucket for non-auth API-key requests across IPs', async () => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await expect(guard.canActivate(contextFor({
        originalUrl: '/api/pages',
        headers: { 'x-api-key': 'valid-api-key' },
        ip: `203.0.113.${attempt + 1}`,
      }))).resolves.toBe(true);
    }

    await expect(guard.canActivate(contextFor({
      originalUrl: '/api/pages',
      headers: { 'x-api-key': 'valid-api-key' },
      ip: '198.51.100.1',
    }))).rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
  });
});
