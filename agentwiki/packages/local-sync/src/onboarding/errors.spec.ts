import { describe, expect, it } from 'vitest';
import { ONBOARDING_FAILURE_CODES, OnboardingError } from './errors.js';

const codeGraphFailureCodes = [
  'CODEGRAPH_NOT_FOUND',
  'CODEGRAPH_CAPABILITY_UNSUPPORTED',
  'CODEGRAPH_SCAN_PLAN_CHANGED',
  'CODEGRAPH_INDEX_INCOMPLETE',
  'CODEGRAPH_SCAN_FAILED',
  'CODE_SNAPSHOT_INVALID',
  'CODE_ANALYSIS_FAILED',
  'CODE_ENRICHMENT_SKIPPED',
] as const;

describe('CodeGraph public failure codes', () => {
  it.each(codeGraphFailureCodes)('exposes %s as a stable onboarding failure code', (code) => {
    expect(ONBOARDING_FAILURE_CODES).toContain(code);
    expect(new OnboardingError({ code, message: 'failed', retryable: false }).toFailure().code).toBe(code);
  });
});
