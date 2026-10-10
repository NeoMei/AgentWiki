import { readRoutingConfig } from './opencode.config';

const config = (values: Record<string, string | undefined>) => ({
  get: jest.fn((key: string) => values[key]),
}) as any;

describe('readRoutingConfig', () => {
  it('uses strict routing defaults', () => {
    expect(readRoutingConfig(config({}))).toMatchObject({
      allowPaidFallback: true,
      maxFreeAttempts: 3,
      maxPaidAttempts: 1,
      attemptTimeoutMs: 300_000,
      estimatedOutputTokens: 2000,
    });
  });

  it('parses the explicit paid fallback allowlist', () => {
    expect(readRoutingConfig(config({ ASSIST_OPENCODE_PAID_MODELS: 'bailian-coding-plan/qwen3.7-plus' })))
      .toMatchObject({ paidModels: ['bailian-coding-plan/qwen3.7-plus'] });
    expect(() => readRoutingConfig(config({ ASSIST_OPENCODE_PAID_MODELS: '../bad' }))).toThrow('model ID');
  });

  it('parses the explicit paid-model preference switch', () => {
    expect((readRoutingConfig(config({ ASSIST_OPENCODE_PREFER_PAID_MODELS: 'true' })) as any).preferPaidModels)
      .toBe(true);
  });

  it('allows a five-minute budget for long-page candidates', () => {
    expect(readRoutingConfig(config({
      ASSIST_OPENCODE_TIMEOUT_MS: '300000',
      ASSIST_OPENCODE_ATTEMPT_TIMEOUT_MS: '300000',
    }))).toMatchObject({ totalTimeoutMs: 300000, attemptTimeoutMs: 300000 });
  });

  it('parses paid fallback as false', () => {
    expect(readRoutingConfig(config({ ASSIST_OPENCODE_ALLOW_PAID_FALLBACK: 'false' })).allowPaidFallback).toBe(false);
  });

  it('deduplicates excluded paid models', () => {
    expect(readRoutingConfig(config({ ASSIST_OPENCODE_PAID_MODEL_EXCLUDES: 'x/a, x/a, y/b' })).paidModelExcludes)
      .toEqual(['x/a', 'y/b']);
  });

  it('rejects invalid boolean values', () => {
    expect(() => readRoutingConfig(config({ ASSIST_OPENCODE_ALLOW_PAID_FALLBACK: 'yes' }))).toThrow('true or false');
  });

  it('rejects paid attempt counts above the hard ceiling', () => {
    expect(() => readRoutingConfig(config({ ASSIST_OPENCODE_MAX_PAID_ATTEMPTS: '2' }))).toThrow('integer from 1 to 1');
  });

  it('rejects total timeouts above the hard ceiling', () => {
    expect(() => readRoutingConfig(config({ ASSIST_OPENCODE_TIMEOUT_MS: '300001' }))).toThrow('integer from 1 to 300000');
  });

  it('rejects invalid model IDs', () => {
    expect(() => readRoutingConfig(config({ ASSIST_OPENCODE_FREE_MODELS: '../bad' }))).toThrow('model ID');
  });
});
