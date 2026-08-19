import { createHash } from 'node:crypto';

export interface OnboardingPlanHashInput {
  serverPlanHash: string;
  localScanPlanHash?: string;
}

const HASH = /^[a-f0-9]{64}$/u;

/**
 * Binds the independently-authorized server bootstrap plan to an optional
 * read-only local scan plan. This deliberately never changes server-plan
 * canonicalization: the server receives only `serverPlanHash`.
 */
export function hashOnboardingPlan(input: OnboardingPlanHashInput): string {
  if (!HASH.test(input.serverPlanHash) || (input.localScanPlanHash !== undefined && !HASH.test(input.localScanPlanHash))) {
    throw new TypeError('onboarding plan hashes must be SHA-256 hex digests');
  }
  const canonical = input.localScanPlanHash === undefined
    ? JSON.stringify({ serverPlanHash: input.serverPlanHash })
    : JSON.stringify({ localScanPlanHash: input.localScanPlanHash, serverPlanHash: input.serverPlanHash });
  return createHash('sha256').update('agentwiki-onboarding-plan@1\0', 'utf8').update(canonical, 'utf8').digest('hex');
}
