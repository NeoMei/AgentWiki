import { describe, expect, it } from 'vitest';
import { hashServerPlan } from './plan-hash.js';
import { hashOnboardingPlan } from './local-plan-hash.js';

const serverPlan = {
  space: { mode: 'create' as const, name: 'R&D' }, agentName: 'Codex',
  permissionPreset: 'editor' as const, approvalMode: 'always-review' as const, packageVersion: '0.4.0',
};

describe('onboarding plan hashing', () => {
  it('does not change the server authorization hash when a local plan is bound', () => {
    const serverPlanHash = hashServerPlan(serverPlan);
    expect(hashServerPlan(serverPlan)).toBe(serverPlanHash);
    expect(hashOnboardingPlan({ serverPlanHash, localScanPlanHash: 'a'.repeat(64) })).not.toBe(serverPlanHash);
  });

  it('changes when either child hash changes', () => {
    const serverPlanHash = hashServerPlan(serverPlan);
    const baseline = hashOnboardingPlan({ serverPlanHash, localScanPlanHash: 'a'.repeat(64) });
    expect(hashOnboardingPlan({ serverPlanHash: 'b'.repeat(64), localScanPlanHash: 'a'.repeat(64) })).not.toBe(baseline);
    expect(hashOnboardingPlan({ serverPlanHash, localScanPlanHash: 'c'.repeat(64) })).not.toBe(baseline);
  });

  it('canonically omits the local child for document-only onboarding', () => {
    const serverPlanHash = hashServerPlan(serverPlan);
    expect(hashOnboardingPlan({ serverPlanHash })).toBe(hashOnboardingPlan({ serverPlanHash }));
    expect(hashOnboardingPlan({ serverPlanHash })).not.toBe(hashOnboardingPlan({ serverPlanHash, localScanPlanHash: 'a'.repeat(64) }));
  });

  it('accepts only SHA-256 child hashes', () => {
    expect(() => hashOnboardingPlan({ serverPlanHash: 'not-a-digest' })).toThrow(/SHA-256/);
  });

  it('uses a versioned domain-separated public vector and ignores object ordering', () => {
    expect(hashOnboardingPlan({ serverPlanHash: '1'.repeat(64) })).toBe('02db24fb00659b0f5cfae4465a7d3c4bfc7e5079bfa81b6aaac0aecbd5c79d55');
    expect(hashOnboardingPlan({ serverPlanHash: '1'.repeat(64), localScanPlanHash: '2'.repeat(64) })).toBe('3b2f356375a75cd9d51e04d3882db5246114c558cd0a3d55a71fec20d5af8a9d');
    expect(hashOnboardingPlan({ localScanPlanHash: '2'.repeat(64), serverPlanHash: '1'.repeat(64) })).toBe(hashOnboardingPlan({ serverPlanHash: '1'.repeat(64), localScanPlanHash: '2'.repeat(64) }));
  });
});
