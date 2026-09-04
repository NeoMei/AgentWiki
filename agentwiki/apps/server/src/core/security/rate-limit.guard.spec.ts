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

  it('raises the auth ceiling for an explicitly configured E2E test runtime', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    const previousLimit = process.env.AGENTWIKI_E2E_AUTH_RATE_LIMIT;
    process.env.NODE_ENV = 'test';
    process.env.AGENTWIKI_E2E_AUTH_RATE_LIMIT = '20';
    try {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await expect(guard.canActivate(contextFor({
          originalUrl: '/api/auth/register',
          headers: {},
          ip: '127.0.0.1',
        }))).resolves.toBe(true);
      }
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
      if (previousLimit === undefined) delete process.env.AGENTWIKI_E2E_AUTH_RATE_LIMIT;
      else process.env.AGENTWIKI_E2E_AUTH_RATE_LIMIT = previousLimit;
    }
  });

  it('ignores the E2E auth ceiling outside the test runtime', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    const previousLimit = process.env.AGENTWIKI_E2E_AUTH_RATE_LIMIT;
    process.env.NODE_ENV = 'production';
    process.env.AGENTWIKI_E2E_AUTH_RATE_LIMIT = '20';
    try {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await guard.canActivate(contextFor({
          originalUrl: '/api/auth/register',
          headers: {},
          ip: '127.0.0.1',
        }));
      }
      await expect(guard.canActivate(contextFor({
        originalUrl: '/api/auth/register',
        headers: {},
        ip: '127.0.0.1',
      }))).rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
      if (previousLimit === undefined) delete process.env.AGENTWIKI_E2E_AUTH_RATE_LIMIT;
      else process.env.AGENTWIKI_E2E_AUTH_RATE_LIMIT = previousLimit;
    }
  });

  it('raises the API IP ceiling for an explicitly configured E2E test runtime', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    const previousLimit = process.env.AGENTWIKI_E2E_API_RATE_LIMIT;
    process.env.NODE_ENV = 'test';
    process.env.AGENTWIKI_E2E_API_RATE_LIMIT = '400';
    try {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        await expect(guard.canActivate(contextFor({
          originalUrl: '/api/pages',
          headers: {},
          ip: '127.0.0.1',
        }))).resolves.toBe(true);
      }
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
      if (previousLimit === undefined) delete process.env.AGENTWIKI_E2E_API_RATE_LIMIT;
      else process.env.AGENTWIKI_E2E_API_RATE_LIMIT = previousLimit;
    }
  });

  it('ignores the E2E API IP ceiling outside the test runtime', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    const previousLimit = process.env.AGENTWIKI_E2E_API_RATE_LIMIT;
    process.env.NODE_ENV = 'production';
    process.env.AGENTWIKI_E2E_API_RATE_LIMIT = '400';
    try {
      for (let attempt = 0; attempt < 300; attempt += 1) {
        await guard.canActivate(contextFor({
          originalUrl: '/api/pages',
          headers: {},
          ip: '127.0.0.1',
        }));
      }
      await expect(guard.canActivate(contextFor({
        originalUrl: '/api/pages',
        headers: {},
        ip: '127.0.0.1',
      }))).rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
      if (previousLimit === undefined) delete process.env.AGENTWIKI_E2E_API_RATE_LIMIT;
      else process.env.AGENTWIKI_E2E_API_RATE_LIMIT = previousLimit;
    }
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

  it('keeps the same credential bucket when an Agent key is sent as Bearer auth', async () => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await expect(guard.canActivate(contextFor({
        originalUrl: '/api/pages',
        headers: { authorization: 'Bearer agk_same-agent-credential' },
        ip: `198.51.100.${(attempt % 250) + 1}`,
      }))).resolves.toBe(true);
    }

    await expect(guard.canActivate(contextFor({
      originalUrl: '/api/pages',
      headers: { authorization: 'Bearer agk_same-agent-credential' },
      ip: '203.0.113.251',
    }))).rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
  });

  it('cannot hide a fixed X-API-Key behind rotating invalid Bearer credentials', async () => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await expect(guard.canActivate(contextFor({
        originalUrl: '/api/pages',
        headers: {
          authorization: `Bearer agk_invalid-${attempt}`,
          'x-api-key': 'agk_fixed-valid-credential',
        },
        ip: `192.0.2.${(attempt % 250) + 1}`,
      }))).resolves.toBe(true);
    }

    await expect(guard.canActivate(contextFor({
      originalUrl: '/api/pages',
      headers: {
        authorization: 'Bearer agk_invalid-next',
        'x-api-key': 'agk_fixed-valid-credential',
      },
      ip: '192.0.2.251',
    }))).rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
  });

  it('keeps an IP ceiling when a JWT caller rotates unvalidated API-key headers', async () => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      await expect(guard.canActivate(contextFor({
        originalUrl: '/api/pages',
        headers: {
          authorization: 'Bearer valid-jwt',
          'x-api-key': `unvalidated-${attempt}`,
        },
        ip: '203.0.113.50',
      }))).resolves.toBe(true);
    }

    await expect(guard.canActivate(contextFor({
      originalUrl: '/api/pages',
      headers: {
        authorization: 'Bearer valid-jwt',
        'x-api-key': 'unvalidated-next',
      },
      ip: '203.0.113.50',
    }))).rejects.toMatchObject({ businessCode: 'AUTH_RATE_LIMITED' });
  });

  it('keeps the in-process fallback bounded while a limited IP rotates credentials', async () => {
    redis.incrementWithWindow.mockResolvedValue(null);
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      await guard.canActivate(contextFor({
        originalUrl: '/api/pages',
        headers: { 'x-api-key': `rotating-${attempt}` },
        ip: '203.0.113.99',
      })).catch(() => undefined);
    }

    expect((guard as any).fallback.size).toBeLessThanOrEqual(301);
  });

  it('never allocates more than the hard fallback bucket cap', () => {
    for (let index = 0; index < 10_100; index += 1) {
      (guard as any).incrementFallback(`unique-${index}`, 60);
    }
    expect((guard as any).fallback.size).toBe(10_000);
  });
});
