import { Logger } from '@nestjs/common';
import { RoutingConfig } from './opencode.config';
import { OpencodeCliRunner } from './opencode.runner';
import {
  buildCandidates,
  OpencodeModelCatalog,
  parseVerboseModels,
} from './opencode.catalog';

const metadata = (
  status: string,
  inputText: boolean,
  outputText: boolean,
  cost: unknown,
  extra: Record<string, unknown> = {},
) => JSON.stringify({
  status,
  capabilities: {
    input: { text: inputText, image: !inputText },
    output: { text: outputText },
    description: 'nested braces: {catalog} and escaped quote: "safe"',
  },
  cost,
  variants: { compact: { options: { note: 'a closing brace } in a string' } } },
  ...extra,
}, null, 2);

const verboseFixture = [
  'opencode/free',
  metadata('active', true, true, { input: 0, output: 0, cache: { read: 0, write: 0 } }),
  'vendor/cheap',
  metadata('active', true, true, { input: 0.000001, output: 0.000002, cache: { read: 0, write: 0 } }),
  'vendor/expensive',
  metadata('active', true, true, { input: 0.00001, output: 0.00002, cache: { read: 0.000001, write: 0.000001 } }),
  'vendor/inactive',
  metadata('inactive', true, true, { input: 0, output: 0, cache: { read: 0, write: 0 } }),
  'vendor/image-only',
  metadata('active', false, true, { input: 0, output: 0, cache: { read: 0, write: 0 } }),
  'vendor/malformed',
  metadata('active', true, true, { input: 0, output: 0, cache: { read: 0, write: -1 } }),
  'vendor/damaged-tail',
  '{ "status": "active", "cost": {',
].join('\n');

const routingConfig: RoutingConfig = {
  freeModels: ['vendor/cheap', 'opencode/free'],
  paidModelExcludes: [],
  allowPaidFallback: true,
  maxFreeAttempts: 3,
  maxPaidAttempts: 1,
  totalTimeoutMs: 180_000,
  attemptTimeoutMs: 60_000,
  modelCacheMs: 100,
  modelStaleMs: 1_000,
  modelEnumTimeoutMs: 10_000,
  estimatedOutputTokens: 2_000,
  circuitFailures: 3,
  circuitWindowMs: 300_000,
  circuitOpenMs: 120_000,
};

describe('OpenCode model catalog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('parses nested verbose records and fails closed on unusable or malformed prices', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const models = parseVerboseModels(verboseFixture);

    expect(models.map((model) => [model.id, model.tier])).toEqual([
      ['opencode/free', 'free'],
      ['vendor/cheap', 'paid'],
      ['vendor/expensive', 'paid'],
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('vendor/malformed');
  });

  it('orders confirmed free models before estimated-cost paid fallback', () => {
    const models = parseVerboseModels(verboseFixture);

    const candidates = buildCandidates(models, routingConfig, '中文 prompt');

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      'opencode/free',
      'vendor/cheap',
      'vendor/expensive',
    ]);
    expect(candidates[1].estimatedCost).toBe(
      0.000001 * [...'中文 prompt'].length + 0.000002 * routingConfig.estimatedOutputTokens,
    );
  });

  it('disables or excludes paid fallback without promoting configured paid models', () => {
    const models = parseVerboseModels(verboseFixture);

    expect(buildCandidates(
      models,
      { ...routingConfig, allowPaidFallback: false },
      'prompt',
    )).toHaveLength(1);
    expect(buildCandidates(
      models,
      { ...routingConfig, paidModelExcludes: ['vendor/cheap'] },
      'prompt',
    )[1].id).toBe('vendor/expensive');
  });

  it('uses configured free order, then OpenCode free models, then stable tie breakers', () => {
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const sameEstimateA = { input: 2, output: 1, cacheRead: 0, cacheWrite: 0 };
    const sameEstimateB = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 };
    const sameEstimateC = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 };
    const models = [
      { id: 'free/z', tier: 'free' as const, price: zero },
      { id: 'free/a', tier: 'free' as const, price: zero },
      { id: 'opencode/big-pickle', tier: 'free' as const, price: zero },
      { id: 'paid/output-cheaper', tier: 'paid' as const, price: sameEstimateA },
      { id: 'paid/b', tier: 'paid' as const, price: sameEstimateB },
      { id: 'paid/a', tier: 'paid' as const, price: sameEstimateC },
    ];

    expect(buildCandidates(models, {
      ...routingConfig,
      freeModels: ['paid/a', 'free/z', 'free/z'],
      estimatedOutputTokens: 1,
    }, 'x').map((candidate) => candidate.id)).toEqual([
      'free/z',
      'opencode/big-pickle',
      'free/a',
      'paid/output-cheaper',
      'paid/a',
      'paid/b',
    ]);
  });

  it('coalesces concurrent refreshes into one model enumeration', async () => {
    let resolveOutput!: (value: string) => void;
    const output = new Promise<string>((resolve) => { resolveOutput = resolve; });
    const runner = {
      listModels: jest.fn().mockReturnValue(output),
    } as unknown as OpencodeCliRunner;
    const catalog = new OpencodeModelCatalog(runner, routingConfig);

    const first = catalog.getModels();
    const second = catalog.getModels();
    const third = catalog.getModels();
    resolveOutput(verboseFixture);

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      expect.any(Array), expect.any(Array), expect.any(Array),
    ]);
    expect(runner.listModels).toHaveBeenCalledTimes(1);
    expect(runner.listModels).toHaveBeenCalledWith(routingConfig.modelEnumTimeoutMs);
  });

  it('reuses a fresh cached snapshot', async () => {
    const runner = {
      listModels: jest.fn().mockResolvedValue(verboseFixture),
    } as unknown as OpencodeCliRunner;
    const catalog = new OpencodeModelCatalog(runner, routingConfig);

    const first = await catalog.getModels();
    jest.setSystemTime(routingConfig.modelCacheMs - 1);
    const second = await catalog.getModels();

    expect(second).toEqual(first);
    expect(runner.listModels).toHaveBeenCalledTimes(1);
  });

  it('uses a stale snapshot when refresh fails within modelStaleMs', async () => {
    const runner = {
      listModels: jest.fn()
        .mockResolvedValueOnce(verboseFixture)
        .mockRejectedValueOnce(new Error('provider details must not escape')),
    } as unknown as OpencodeCliRunner;
    const catalog = new OpencodeModelCatalog(runner, routingConfig);
    const first = await catalog.getModels();

    jest.setSystemTime(routingConfig.modelCacheMs + 1);

    await expect(catalog.getModels()).resolves.toEqual(first);
    expect(runner.listModels).toHaveBeenCalledTimes(2);
  });

  it('rejects refresh failure once the snapshot exceeds modelStaleMs', async () => {
    const refreshError = new Error('catalog unavailable');
    const runner = {
      listModels: jest.fn()
        .mockResolvedValueOnce(verboseFixture)
        .mockRejectedValueOnce(refreshError),
    } as unknown as OpencodeCliRunner;
    const catalog = new OpencodeModelCatalog(runner, routingConfig);
    await catalog.getModels();

    jest.setSystemTime(routingConfig.modelStaleMs + 1);

    await expect(catalog.getModels()).rejects.toBe(refreshError);
    expect(runner.listModels).toHaveBeenCalledTimes(2);
  });
});
