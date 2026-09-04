import { ExecutionContext } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

describe('RateLimitGuard identity boundaries', () => {
  let counts: Map<string, number>;
  let redis: { incrementWithWindow: jest.Mock };
  let guard: RateLimitGuard;

  const contextFor = (request: Record<string, unknown>) => ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as ExecutionContext;

  const isolatedE2EEnvironment: Record<string, string> = {
    NODE_ENV: 'test',
    AGENTWIKI_LISTEN_HOST: '127.0.0.1',
    DATABASE_URL:
      'postgresql://agentwiki_test:test-only@127.0.0.1:55432/agentwiki_test_task3?schema=mac_e2e_20260904_1234',
  };

  const withEnvironment = async (
    values: Record<string, string | undefined>,
    run: () => Promise<void>,
  ) => {
    const previous = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(values)) {
      previous.set(name, process.env[name]);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    try {
      await run();
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  };

  const expectAuthRequestElevenToBeLimited = async () => {
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
  };

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
    await withEnvironment({
      ...isolatedE2EEnvironment,
      AGENTWIKI_E2E_AUTH_RATE_LIMIT: '20',
    }, async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await expect(guard.canActivate(contextFor({
          originalUrl: '/api/auth/register',
          headers: {},
          ip: '127.0.0.1',
        }))).resolves.toBe(true);
      }
    });
  });

  it('ignores the E2E auth ceiling outside the test runtime', async () => {
    await withEnvironment({
      ...isolatedE2EEnvironment,
      NODE_ENV: 'production',
      AGENTWIKI_E2E_AUTH_RATE_LIMIT: '20',
    }, expectAuthRequestElevenToBeLimited);
  });

  it.each([
    ['missing listen host', { AGENTWIKI_LISTEN_HOST: undefined }],
    ['non-loopback listen host', { AGENTWIKI_LISTEN_HOST: '0.0.0.0' }],
    ['non-loopback database host', {
      DATABASE_URL:
        'postgresql://agentwiki_test:test-only@database.internal:5432/agentwiki_test_task3?schema=mac_e2e_20260904_1234',
    }],
    ['database name without test', {
      DATABASE_URL:
        'postgresql://agentwiki_test:test-only@127.0.0.1:55432/agentwiki?schema=mac_e2e_20260904_1234',
    }],
    ['missing schema', {
      DATABASE_URL:
        'postgresql://agentwiki_test:test-only@127.0.0.1:55432/agentwiki_test_task3',
    }],
    ['non-E2E schema', {
      DATABASE_URL:
        'postgresql://agentwiki_test:test-only@127.0.0.1:55432/agentwiki_test_task3?schema=public',
    }],
    ['malformed E2E schema', {
      DATABASE_URL:
        'postgresql://agentwiki_test:test-only@127.0.0.1:55432/agentwiki_test_task3?schema=mac_e2e_bad-name',
    }],
    ['malformed database URL', { DATABASE_URL: 'not-a-database-url' }],
  ])('ignores E2E ceilings with %s', async (_label, override) => {
    await withEnvironment({
      ...isolatedE2EEnvironment,
      ...override,
      AGENTWIKI_E2E_AUTH_RATE_LIMIT: '20',
    }, expectAuthRequestElevenToBeLimited);
  });

  it.each(['0', '-1', '+20', '20.5', '9007199254740992', '1001'])(
    'ignores the invalid E2E auth ceiling %s',
    async (limit) => {
      await withEnvironment({
        ...isolatedE2EEnvironment,
        AGENTWIKI_E2E_AUTH_RATE_LIMIT: limit,
      }, expectAuthRequestElevenToBeLimited);
    },
  );

  it('raises the API IP ceiling for an explicitly configured E2E test runtime', async () => {
    await withEnvironment({
      ...isolatedE2EEnvironment,
      AGENTWIKI_E2E_API_RATE_LIMIT: '400',
    }, async () => {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        await expect(guard.canActivate(contextFor({
          originalUrl: '/api/pages',
          headers: {},
          ip: '127.0.0.1',
        }))).resolves.toBe(true);
      }
    });
  });

  it('ignores the E2E API IP ceiling outside the test runtime', async () => {
    await withEnvironment({
      ...isolatedE2EEnvironment,
      NODE_ENV: 'production',
      AGENTWIKI_E2E_API_RATE_LIMIT: '400',
    }, async () => {
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
    });
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
