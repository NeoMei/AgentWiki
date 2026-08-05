import { Logger } from '@nestjs/common';
import { RoutingConfig } from './opencode.config';
import { FailureCode } from './opencode.types';
import { RedisModelHealthStore } from './model-health.store';

class FakeRedisService {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();

  async getStrict(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async deleteStrict(key: string): Promise<number> {
    const deleted = this.values.delete(key);
    this.ttls.delete(key);
    return deleted ? 1 : 0;
  }

  async setStrict(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.values.set(key, value);
    if (ttlSeconds !== undefined) this.ttls.set(key, ttlSeconds);
  }

  async setOnce(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.values.has(key)) return false;
    this.values.set(key, value);
    this.ttls.set(key, ttlSeconds);
    return true;
  }

  async incrementWithWindow(key: string, ttlSeconds: number): Promise<number> {
    const count = Number(this.values.get(key) ?? '0') + 1;
    this.values.set(key, String(count));
    if (count === 1) this.ttls.set(key, ttlSeconds);
    return count;
  }
}

const config: RoutingConfig = {
  freeModels: [],
  paidModelExcludes: [],
  allowPaidFallback: true,
  maxFreeAttempts: 3,
  maxPaidAttempts: 1,
  totalTimeoutMs: 180_000,
  attemptTimeoutMs: 60_000,
  modelCacheMs: 600_000,
  modelStaleMs: 3_600_000,
  modelEnumTimeoutMs: 10_000,
  estimatedOutputTokens: 2_000,
  circuitFailures: 3,
  circuitWindowMs: 300_000,
  circuitOpenMs: 120_000,
};

const createStore = (redis = new FakeRedisService()) => ({
  redis,
  store: new RedisModelHealthStore(redis as any, config),
});

describe('RedisModelHealthStore', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens at the configured failure threshold, resets on success, and admits one probe', async () => {
    const { redis, store } = createStore();

    await store.recordFailure('vendor/model', 'process_error');
    await store.recordFailure('vendor/model', 'process_error');
    expect(await store.get('vendor/model')).toMatchObject({ openUntil: null, failures: 2 });

    await store.recordFailure('vendor/model', 'process_error');
    expect((await store.get('vendor/model'))!.openUntil).toBeGreaterThan(Date.now());

    await store.recordSuccess('vendor/model');
    expect(await store.get('vendor/model')).toBeNull();
    expect(await store.tryAcquireProbe('vendor/model')).toBe(true);
    expect(await store.tryAcquireProbe('vendor/model')).toBe(false);

    const hash = 'ba72376734e8fac325ba1ca0dc79b94d3ad3eaa5e0d9b1c019ea1378bce34d6d';
    expect([...redis.values.keys()]).toEqual([`assist:model-health:probe:${hash}`]);
    expect(redis.ttls.get(`assist:model-health:probe:${hash}`)).toBe(120);
  });

  it.each<FailureCode>(['rate_limited', 'model_unavailable', 'auth_failed'])(
    'opens immediately for %s',
    async (code) => {
      const { redis, store } = createStore();

      await store.recordFailure('vendor/model', code);

      expect(await store.get('vendor/model')).toMatchObject({ failures: 1 });
      expect((await store.get('vendor/model'))!.openUntil).toBeGreaterThan(Date.now());
      const hash = 'ba72376734e8fac325ba1ca0dc79b94d3ad3eaa5e0d9b1c019ea1378bce34d6d';
      expect(redis.ttls.get(`assist:model-health:fail:${hash}`)).toBe(300);
      expect(redis.ttls.get(`assist:model-health:open:${hash}`)).toBe(120);
    },
  );

  it('fails open and emits only stable operation and model context when Redis rejects', async () => {
    const getFailure = new Error('secret get failure');
    const incrementFailure = new Error('secret increment failure');
    const setFailure = new Error('secret set failure');
    const deleteFailure = new Error('secret delete failure');
    const probeFailure = new Error('secret probe failure');
    const redis = new FakeRedisService();
    const { store } = createStore(redis);
    const warning = jest.spyOn(Logger.prototype, 'warn');

    jest.spyOn(redis, 'getStrict').mockRejectedValueOnce(getFailure);
    await expect(store.get('vendor/model')).resolves.toBeNull();

    jest.spyOn(redis, 'incrementWithWindow').mockRejectedValueOnce(incrementFailure);
    await expect(store.recordFailure('vendor/model', 'process_error')).resolves.toBeUndefined();

    jest.spyOn(redis, 'setStrict').mockRejectedValueOnce(setFailure);
    await expect(store.recordFailure('vendor/model', 'rate_limited')).resolves.toBeUndefined();

    jest.spyOn(redis, 'deleteStrict').mockRejectedValueOnce(deleteFailure);
    await expect(store.recordSuccess('vendor/model')).resolves.toBeUndefined();

    jest.spyOn(redis, 'setOnce').mockRejectedValueOnce(probeFailure);
    await expect(store.tryAcquireProbe('vendor/model')).resolves.toBe(true);

    expect(warning.mock.calls.map(([message]) => message)).toEqual([
      'get vendor/model',
      'recordFailure vendor/model',
      'recordFailure vendor/model',
      'recordSuccess vendor/model',
      'tryAcquireProbe vendor/model',
    ]);
  });
});
