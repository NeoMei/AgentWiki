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
      estimatedOutputTokens: 2000,
    });
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

  it('rejects invalid model IDs', () => {
    expect(() => readRoutingConfig(config({ ASSIST_OPENCODE_FREE_MODELS: '../bad' }))).toThrow('model ID');
  });
});
