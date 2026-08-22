import { describe, expect, it, vi } from 'vitest';
import { OnboardingClient } from './client.js';
import { OnboardingError } from './errors.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(handlers: Array<(url: string, init: RequestInit) => Response>): typeof fetch {
  let call = 0;
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const handler = handlers[Math.min(call, handlers.length - 1)];
    call += 1;
    return handler(String(url), init ?? {});
  }) as unknown as typeof fetch;
}

const SERVER = 'https://example.test/api';

describe('OnboardingClient.start', () => {
  it('posts to /onboard/device/start and returns the device session', async () => {
    const fetchImpl = mockFetch([
      () =>
        jsonResponse(200, {
          deviceCode: 'awd_test',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://example.test/onboard/device',
          verificationUriComplete: 'https://example.test/onboard/device?user_code=ABCD-EFGH',
          expiresIn: 600,
          interval: 5,
        }),
    ]);
    const client = new OnboardingClient({ fetchImpl });
    const result = await client.start({
      serverBaseUrl: SERVER,
      packageVersion: '0.5.0',
      clientType: 'codex',
      fetchImpl,
    });
    expect(result.deviceCode).toBe('awd_test');
    expect(result.interval).toBe(5);
  });

  it('strips trailing slashes from the base URL', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      seen.push(String(url));
      return jsonResponse(200, {
        deviceCode: 'x',
        userCode: 'x',
        verificationUri: 'x',
        verificationUriComplete: 'x',
        expiresIn: 1,
        interval: 1,
      });
    }) as unknown as typeof fetch;
    const client = new OnboardingClient({ fetchImpl });
    await client.start({
      serverBaseUrl: 'https://example.test/api///',
      packageVersion: '0.5.0',
      clientType: 'codex',
      fetchImpl,
    });
    expect(seen[0]).toBe('https://example.test/api/onboard/device/start');
  });
});

describe('OnboardingClient.pollUntilSettled', () => {
  it('settles when the server authorizes', async () => {
    const fetchImpl = mockFetch([
      () => jsonResponse(200, { status: 'authorization_pending' }),
      () => jsonResponse(200, { status: 'authorized', onboardingToken: 'awo_tok', expiresIn: 600 }),
    ]);
    const client = new OnboardingClient({ fetchImpl });
    const result = await client.pollUntilSettled(SERVER, 'awd_test', undefined, {
      fetchImpl,
      intervalMs: 1,
      maxAttempts: 10,
    });
    expect(result.status).toBe('authorized');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('honours slow_down intervals', async () => {
    const intervals: number[] = [];
    const fetchImpl = mockFetch([
      () => jsonResponse(200, { status: 'slow_down', interval: 3 }),
      () => jsonResponse(200, { status: 'authorization_pending' }),
      () => jsonResponse(200, { status: 'authorized', onboardingToken: 'awo_tok', expiresIn: 600 }),
    ]);
    const client = new OnboardingClient({ fetchImpl });
    const slept: number[] = [];
    await client.pollUntilSettled(
      SERVER,
      'awd_test',
      (ms) => intervals.push(ms),
      { fetchImpl, intervalMs: 1, maxAttempts: 10, sleepFn: (ms) => { slept.push(ms); return Promise.resolve(); } },
    );
    // After slow_down the interval should be at least 3000ms.
    expect(intervals[0]).toBeGreaterThanOrEqual(3000);
  });

  it('returns denied as a terminal result', async () => {
    const fetchImpl = mockFetch([() => jsonResponse(200, { status: 'denied' })]);
    const client = new OnboardingClient({ fetchImpl });
    const result = await client.pollUntilSettled(SERVER, 'awd_test', undefined, {
      fetchImpl,
      maxAttempts: 5,
    });
    expect(result.status).toBe('denied');
  });

  it('returns expired as a terminal result', async () => {
    const fetchImpl = mockFetch([() => jsonResponse(200, { status: 'expired' })]);
    const client = new OnboardingClient({ fetchImpl });
    const result = await client.pollUntilSettled(SERVER, 'awd_test', undefined, {
      fetchImpl,
      maxAttempts: 5,
    });
    expect(result.status).toBe('expired');
  });

  it('throws AUTH_EXPIRED when the token was already consumed', async () => {
    const fetchImpl = mockFetch([() => jsonResponse(200, { status: 'authorization_consumed' })]);
    const client = new OnboardingClient({ fetchImpl });
    await expect(
      client.pollUntilSettled(SERVER, 'awd_test', undefined, { fetchImpl, maxAttempts: 5 }),
    ).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
  });

  it('throws AUTH_EXPIRED after exceeding the attempt ceiling', async () => {
    const fetchImpl = mockFetch([() => jsonResponse(200, { status: 'authorization_pending' })]);
    const client = new OnboardingClient({ fetchImpl });
    await expect(
      client.pollUntilSettled(SERVER, 'awd_test', undefined, {
        fetchImpl,
        intervalMs: 1,
        maxAttempts: 3,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
  });
});

describe('OnboardingClient.bootstrap', () => {
  const plan = {
    space: { mode: 'create' as const, name: 'R&D' },
    agentName: 'Codex',
    role: 'editor' as const,
    packageVersion: '0.5.0' as const,
  };

  it('posts the plan with onboarding token and idempotency key', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return jsonResponse(200, {
        space: { id: 's1', name: 'R&D' },
        agent: { id: 'a1', name: 'Codex' },
        grant: { role: 'editor', scopes: ['pages:read'] },
        installation: { code: 'code', installationId: 'i1', expiresAt: '2026-01-01T00:00:00Z' },
      });
    }) as unknown as typeof fetch;
    const client = new OnboardingClient({ fetchImpl });
    const result = await client.bootstrap({
      serverBaseUrl: SERVER,
      onboardingToken: 'awo_tok',
      idempotencyKey: 'idem-1',
      serverPlan: plan,
      serverPlanHash: 'a'.repeat(64),
      fetchImpl,
    });
    expect(result.agent.id).toBe('a1');
    expect((capturedInit!.headers as Record<string, string>)['idempotency-key']).toBe('idem-1');
    expect((capturedInit!.headers as Record<string, string>).authorization).toBe('Bearer awo_tok');
  });

  it('throws AUTH_EXPIRED on 401', async () => {
    const fetchImpl = mockFetch([() => jsonResponse(401, {})]); // single handler reused
    const client = new OnboardingClient({ fetchImpl });
    await expect(
      client.bootstrap({
        serverBaseUrl: SERVER,
        onboardingToken: 'awo_tok',
        idempotencyKey: 'idem-1',
        serverPlan: plan,
        serverPlanHash: 'a'.repeat(64),
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_EXPIRED', retryable: false });
  });

  it('redacts secrets from error messages', async () => {
    const fetchImpl = mockFetch([
      () => jsonResponse(500, 'internal error with agk_supersecretkey1234567890'),
    ]);
    const client = new OnboardingClient({ fetchImpl });
    try {
      await client.bootstrap({
        serverBaseUrl: SERVER,
        onboardingToken: 'awo_tok',
        idempotencyKey: 'idem-1',
        serverPlan: plan,
        serverPlanHash: 'a'.repeat(64),
        fetchImpl,
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(OnboardingError);
      expect((error as OnboardingError).message).not.toContain('agk_supersecretkey');
      expect((error as OnboardingError).retryable).toBe(true);
    }
  });
});
