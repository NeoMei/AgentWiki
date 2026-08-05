import { RoutingConfig } from './opencode.config';
import {
  EMPTY_USAGE,
  ModelUsage,
  OpencodeExecutionError,
  OpencodeRoutingError,
} from './opencode.types';
import { OpencodeModelRouter } from './opencode.router';

const FREE_PRICE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const PAID_PRICE = { input: 0.000001, output: 0.000002, cacheRead: 0, cacheWrite: 0 };

const routingConfig: RoutingConfig = {
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

const configService = (config: RoutingConfig) => ({
  get: jest.fn((key: string) => ({
    ASSIST_OPENCODE_FREE_MODELS: config.freeModels.join(','),
    ASSIST_OPENCODE_PAID_MODEL_EXCLUDES: config.paidModelExcludes.join(','),
    ASSIST_OPENCODE_ALLOW_PAID_FALLBACK: String(config.allowPaidFallback),
    ASSIST_OPENCODE_MAX_FREE_ATTEMPTS: String(config.maxFreeAttempts),
    ASSIST_OPENCODE_MAX_PAID_ATTEMPTS: String(config.maxPaidAttempts),
    ASSIST_OPENCODE_TIMEOUT_MS: String(config.totalTimeoutMs),
    ASSIST_OPENCODE_ATTEMPT_TIMEOUT_MS: String(config.attemptTimeoutMs),
    ASSIST_OPENCODE_MODEL_CACHE_MS: String(config.modelCacheMs),
    ASSIST_OPENCODE_MODEL_STALE_MS: String(config.modelStaleMs),
    ASSIST_OPENCODE_MODEL_ENUM_TIMEOUT_MS: String(config.modelEnumTimeoutMs),
    ASSIST_OPENCODE_ESTIMATED_OUTPUT_TOKENS: String(config.estimatedOutputTokens),
    ASSIST_OPENCODE_CIRCUIT_FAILURES: String(config.circuitFailures),
    ASSIST_OPENCODE_CIRCUIT_WINDOW_MS: String(config.circuitWindowMs),
    ASSIST_OPENCODE_CIRCUIT_OPEN_MS: String(config.circuitOpenMs),
  } as Record<string, string>)[key]),
}) as any;

const model = (id: string, tier: 'free' | 'paid') => ({
  id,
  tier,
  price: tier === 'free' ? FREE_PRICE : PAID_PRICE,
});

const usage = (total: number): ModelUsage => ({
  input: total,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total,
});

const success = (changes: string, cost = 0, resultUsage = EMPTY_USAGE) => ({
  summary: 'done',
  changes,
  usage: resultUsage,
  cost,
});

const modelFailure = (
  code: 'invalid_output' | 'model_unavailable' | 'rate_limited' | 'timeout' = 'invalid_output',
  resultUsage: ModelUsage = EMPTY_USAGE,
  cost = 0,
  message = 'provider failure',
) => new OpencodeExecutionError(message, code, 'model', resultUsage, cost);

const task = { intent: 'polish', pageSnapshot: { content: '# Draft' } };

const captureRoutingError = async (promise: Promise<unknown>): Promise<OpencodeRoutingError> => {
  try {
    await promise;
    throw new Error('expected routing to fail');
  } catch (error) {
    if (!(error instanceof OpencodeRoutingError)) throw error;
    return error;
  }
};

const createRouter = (options: {
  models?: ReturnType<typeof model>[];
  config?: RoutingConfig;
  now?: () => number;
  getModels?: jest.Mock;
} = {}) => {
  const catalog = {
    getModels: options.getModels || jest.fn().mockResolvedValue(options.models || [
      model('free/one', 'free'),
      model('free/two', 'free'),
      model('paid/cheap', 'paid'),
    ]),
  };
  const runner = {
    buildPrompt: jest.fn().mockReturnValue('prompt'),
    runModel: jest.fn(),
  };
  const health = {
    get: jest.fn().mockResolvedValue(null),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    tryAcquireProbe: jest.fn().mockResolvedValue(true),
  };
  const config = options.config || routingConfig;
  const router = new OpencodeModelRouter(
    catalog as any,
    runner as any,
    health,
    configService(config),
    options.now || (() => 0),
  );
  router.onModuleInit();
  return { router, catalog, runner, health };
};

describe('OpencodeModelRouter', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('tries free models in order and stops at the first success', async () => {
    const { router, runner } = createRouter();
    runner.runModel
      .mockRejectedValueOnce(new OpencodeExecutionError('rate limited', 'rate_limited', 'model', EMPTY_USAGE))
      .mockResolvedValueOnce(success('# Free result'));

    expect((await router.run(task)).model).toBe('free/two');
    expect(runner.runModel.mock.calls.map((call) => call[1])).toEqual(['free/one', 'free/two']);
  });

  it('uses one lowest-cost paid candidate only after free candidates fail', async () => {
    const { router, runner } = createRouter();
    runner.runModel
      .mockRejectedValueOnce(modelFailure('invalid_output'))
      .mockRejectedValueOnce(modelFailure('model_unavailable'))
      .mockResolvedValueOnce(success('# Paid result', 0.004));

    await expect(router.run(task)).resolves.toMatchObject({
      model: 'paid/cheap',
      modelTier: 'paid',
      attemptCount: 3,
      cost: 0.004,
    });
  });

  it('never calls a paid model when paid fallback is disabled', async () => {
    const { router, runner } = createRouter({
      config: { ...routingConfig, allowPaidFallback: false },
    });
    runner.runModel.mockRejectedValue(modelFailure());

    await expect(router.run(task)).rejects.toBeInstanceOf(OpencodeRoutingError);
    expect(runner.runModel.mock.calls.map((call) => call[1])).toEqual(['free/one', 'free/two']);
  });

  it('stops immediately on global and unknown errors', async () => {
    const global = createRouter();
    global.runner.runModel.mockRejectedValueOnce(new OpencodeExecutionError(
      'OPENAI_API_KEY=sk-secret provider stderr',
      'binary_unavailable',
      'global',
      usage(2),
      0.001,
    ));

    const globalError = await captureRoutingError(global.router.run(task));
    expect(global.runner.runModel).toHaveBeenCalledTimes(1);
    expect(globalError).toBeInstanceOf(OpencodeRoutingError);
    expect(JSON.stringify(globalError)).not.toContain('sk-secret');

    const unknown = createRouter();
    unknown.runner.runModel.mockRejectedValueOnce(new Error('provider stderr sk-other-secret'));
    const unknownError = await captureRoutingError(unknown.router.run(task));
    expect(unknown.runner.runModel).toHaveBeenCalledTimes(1);
    expect(unknownError).toBeInstanceOf(OpencodeRoutingError);
    expect(JSON.stringify(unknownError)).not.toContain('sk-other-secret');
  });

  it('enforces the three-free and one-paid hard attempt ceilings', async () => {
    const { router, runner } = createRouter({
      models: [
        model('free/one', 'free'),
        model('free/two', 'free'),
        model('free/three', 'free'),
        model('free/four', 'free'),
        model('paid/one', 'paid'),
        model('paid/two', 'paid'),
      ],
    });
    runner.runModel.mockRejectedValue(modelFailure());

    await expect(router.run(task)).rejects.toBeInstanceOf(OpencodeRoutingError);
    expect(runner.runModel.mock.calls.map((call) => call[1])).toEqual([
      'free/four',
      'free/one',
      'free/three',
      'paid/one',
    ]);
  });

  it('spends catalog enumeration and model attempts from one total deadline', async () => {
    let time = 1_000;
    const getModels = jest.fn().mockImplementation(async () => {
      time += 30;
      return [model('free/one', 'free'), model('free/two', 'free')];
    });
    const { router, runner } = createRouter({
      config: { ...routingConfig, totalTimeoutMs: 100, attemptTimeoutMs: 90 },
      getModels,
      now: () => time,
    });
    runner.runModel
      .mockImplementationOnce(async () => {
        time += 50;
        throw modelFailure('timeout');
      })
      .mockResolvedValueOnce(success('# Result'));

    await router.run(task);

    expect(runner.runModel.mock.calls.map((call) => call[2])).toEqual([70, 20]);
  });

  it('ends routing by the lease-safe deadline when catalog enumeration hangs', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const getModels = jest.fn().mockReturnValue(new Promise(() => undefined));
    const { router, runner } = createRouter({
      getModels,
      now: () => Date.now(),
    });

    const failure = captureRoutingError(router.run({ ...task, leaseExpiresAtMs: 6_000 }));
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(failure).resolves.toMatchObject({ message: 'OpenCode routing failed: budget_exhausted' });
    expect(runner.runModel).not.toHaveBeenCalled();
  });

  it('ends routing by the lease-safe deadline when model health lookup hangs', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const { router, runner, health } = createRouter({ now: () => Date.now() });
    health.get.mockReturnValue(new Promise(() => undefined));

    const failure = captureRoutingError(router.run({ ...task, leaseExpiresAtMs: 6_000 }));
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(failure).resolves.toMatchObject({ message: 'OpenCode routing failed: budget_exhausted' });
    expect(runner.runModel).not.toHaveBeenCalled();
  });

  it('uses the worker lease minus five seconds as the tighter deadline', async () => {
    const now = 10_000;
    const { router, runner } = createRouter({ now: () => now });
    runner.runModel.mockResolvedValueOnce(success('# Result'));

    await router.run({ ...task, leaseExpiresAtMs: now + 45_000 });

    expect(runner.runModel).toHaveBeenCalledWith('prompt', 'free/one', 40_000);
  });

  it('does not spawn when the total budget is already exhausted', async () => {
    let time = 0;
    const getModels = jest.fn().mockImplementation(async () => {
      time = 100;
      return [model('free/one', 'free')];
    });
    const { router, runner } = createRouter({
      config: { ...routingConfig, totalTimeoutMs: 100 },
      getModels,
      now: () => time,
    });

    const error = await captureRoutingError(router.run(task));

    expect(runner.runModel).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(OpencodeRoutingError);
    expect(error.message).toContain('budget_exhausted');
  });

  it('does not create catalog work when the deadline is already expired', async () => {
    const getModels = jest.fn().mockImplementation(() => Promise.reject(
      new Error('late catalog rejection'),
    ));
    const { router, runner } = createRouter({ getModels, now: () => 1_000 });

    const error = await captureRoutingError(router.run({
      ...task,
      leaseExpiresAtMs: 6_000,
    }));
    await Promise.resolve();

    expect(error.message).toContain('budget_exhausted');
    expect(getModels).not.toHaveBeenCalled();
    expect(runner.runModel).not.toHaveBeenCalled();
  });

  it('skips open circuits when another candidate is available', async () => {
    const { router, runner, health } = createRouter();
    health.get.mockImplementation(async (id: string) => (
      id === 'free/one' ? { failures: 3, openUntil: 50_000 } : null
    ));
    runner.runModel.mockResolvedValueOnce(success('# Result'));

    await expect(router.run(task)).resolves.toMatchObject({ model: 'free/two' });
    expect(runner.runModel.mock.calls.map((call) => call[1])).toEqual(['free/two']);
    expect(health.tryAcquireProbe).not.toHaveBeenCalled();
  });

  it('allows only the earliest-opening free model to acquire a half-open probe when all circuits are open', async () => {
    const { router, runner, health } = createRouter();
    health.get.mockImplementation(async (id: string) => ({
      failures: 3,
      openUntil: id === 'free/two' ? 20_000 : 30_000,
    }));
    runner.runModel.mockResolvedValueOnce(success('# Probe result'));

    await expect(router.run(task)).resolves.toMatchObject({ model: 'free/two' });
    expect(health.tryAcquireProbe).toHaveBeenCalledTimes(1);
    expect(health.tryAcquireProbe).toHaveBeenCalledWith('free/two');
    expect(runner.runModel.mock.calls.map((call) => call[1])).toEqual(['free/two']);
  });

  it('never probes a paid model when all circuits are open or health is unavailable', async () => {
    const paidOnly = createRouter({ models: [model('paid/cheap', 'paid')] });
    paidOnly.health.get.mockResolvedValue({ failures: 3, openUntil: 30_000 });

    await expect(paidOnly.router.run(task)).rejects.toBeInstanceOf(OpencodeRoutingError);
    expect(paidOnly.health.tryAcquireProbe).not.toHaveBeenCalled();
    expect(paidOnly.runner.runModel).not.toHaveBeenCalled();

    const unavailable = createRouter();
    unavailable.health.get.mockResolvedValue(null);
    unavailable.runner.runModel.mockResolvedValueOnce(success('# Free result'));
    await unavailable.router.run(task);
    expect(unavailable.health.tryAcquireProbe).not.toHaveBeenCalled();
    expect(unavailable.runner.runModel.mock.calls[0][1]).toBe('free/one');
  });

  it('resets model health after success', async () => {
    const { router, runner, health } = createRouter();
    runner.runModel.mockResolvedValueOnce(success('# Result'));

    await router.run(task);

    expect(health.recordSuccess).toHaveBeenCalledWith('free/one', 0);
    expect(health.recordFailure).not.toHaveBeenCalled();
  });

  it('does not hold a successful result past the lease while health reset is pending', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const { router, runner, health } = createRouter({ now: () => Date.now() });
    runner.runModel.mockResolvedValueOnce(success('# Result'));
    health.recordSuccess.mockReturnValue(new Promise(() => undefined));

    const outcome = Promise.race([
      router.run({ ...task, leaseExpiresAtMs: 6_000 }).then(() => 'succeeded'),
      new Promise<string>((resolve) => setTimeout(() => resolve('lease-expired'), 1_000)),
    ]);
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(outcome).resolves.toBe('succeeded');
    expect(health.recordSuccess).toHaveBeenCalledWith('free/one', 0);
  });

  it('returns complete sanitized metadata with aggregated partial usage and cost when all candidates fail', async () => {
    const { router, runner, health } = createRouter({
      models: [model('free/one', 'free'), model('paid/cheap', 'paid')],
    });
    runner.runModel
      .mockRejectedValueOnce(modelFailure('rate_limited', usage(3), 0.001, 'OPENAI_API_KEY=sk-secret provider stderr'))
      .mockRejectedValueOnce(modelFailure('invalid_output', usage(5), 0.004, 'provider body sk-other-secret'));

    const error = await captureRoutingError(router.run(task));

    expect(error).toBeInstanceOf(OpencodeRoutingError);
    expect(error.result).toMatchObject({
      model: 'paid/cheap',
      modelTier: 'paid',
      attemptCount: 2,
      usage: { input: 8, total: 8 },
      cost: 0.005,
      attempts: [
        { model: 'free/one', tier: 'free', status: 'failed', errorCode: 'rate_limited', usage: { total: 3 }, cost: 0.001 },
        { model: 'paid/cheap', tier: 'paid', status: 'failed', errorCode: 'invalid_output', usage: { total: 5 }, cost: 0.004 },
      ],
    });
    expect(error.result.model).toBeDefined();
    expect(error.result.modelTier).toBeDefined();
    expect(JSON.stringify(error)).not.toContain('sk-secret');
    expect(JSON.stringify(error)).not.toContain('sk-other-secret');
    expect(health.recordFailure.mock.calls).toEqual([
      ['free/one', 'rate_limited', 0],
      ['paid/cheap', 'invalid_output', 0],
    ]);
  });

  it('validates routing config during module initialization', () => {
    const { router } = createRouter();
    const invalid = new OpencodeModelRouter(
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn((key: string) => key === 'ASSIST_OPENCODE_ALLOW_PAID_FALLBACK' ? 'yes' : undefined) } as any,
      () => 0,
    );

    expect(() => invalid.onModuleInit()).toThrow('true or false');
    expect(router).toBeDefined();
  });
});
