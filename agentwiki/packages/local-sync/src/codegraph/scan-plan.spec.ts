import { describe, expect, it } from 'vitest';
import type { LocalScanPlan } from './contracts.js';
import { hashLocalScanPlan } from './scan-plan.js';

const capabilities = {
  required: {
    'index.status': true,
    'index.sync': true,
    'files.list': true,
  },
  optional: {
    'symbols.list': false,
    'relations.read': false,
    'semantic.explore': false,
    'impact.read': false,
    'routes.read': false,
  },
};

function makePlan(): LocalScanPlan {
  return {
    schemaVersion: 'agentwiki-local-scan-plan@1',
    provider: 'codegraph',
    executableIdentity: '/usr/local/bin/codegraph',
    detectedVersion: '1.2.3',
    capabilities,
    analysisMode: 'standard',
    sources: [
      {
        sourceKey: 'b'.repeat(64),
        displayPath: 'second',
        canonicalSourcePath: '/private/second',
        indexPath: '/private/second/.codegraph',
        action: 'none',
        indexState: 'ready',
        estimatedFiles: 2,
      },
      {
        sourceKey: 'a'.repeat(64),
        displayPath: 'first',
        canonicalSourcePath: '/private/first',
        indexPath: '/private/first/.codegraph',
        action: 'sync',
        indexState: 'stale',
        estimatedFiles: 1,
      },
    ],
    limits: { maxFiles: 10_000, maxGeneratedBytes: 1_000_000 },
    localScanPlanHash: 'c'.repeat(64),
  };
}

function clonePlan(plan: LocalScanPlan): LocalScanPlan {
  return structuredClone(plan);
}

describe('local scan plan hashing', () => {
  it('hashes uniquely identified sources invariantly across object-key and input order', () => {
    const plan = makePlan();
    const reordered = {
      localScanPlanHash: plan.localScanPlanHash,
      limits: { maxGeneratedBytes: plan.limits.maxGeneratedBytes, maxFiles: plan.limits.maxFiles },
      sources: [...plan.sources].reverse().map((source) => ({
        estimatedFiles: source.estimatedFiles,
        indexState: source.indexState,
        action: source.action,
        indexPath: source.indexPath,
        canonicalSourcePath: source.canonicalSourcePath,
        displayPath: source.displayPath,
        sourceKey: source.sourceKey,
      })),
      analysisMode: plan.analysisMode,
      capabilities: {
        optional: {
          'routes.read': false,
          'impact.read': false,
          'semantic.explore': false,
          'relations.read': false,
          'symbols.list': false,
        },
        required: {
          'files.list': true,
          'index.sync': true,
          'index.status': true,
        },
      },
      detectedVersion: plan.detectedVersion,
      executableIdentity: plan.executableIdentity,
      provider: plan.provider,
      schemaVersion: plan.schemaVersion,
    } satisfies LocalScanPlan;

    expect(hashLocalScanPlan(reordered)).toBe(hashLocalScanPlan(plan));
  });

  it.each([
    ['executable identity', (plan: LocalScanPlan) => { plan.executableIdentity = '/opt/codegraph'; }],
    ['detected version', (plan: LocalScanPlan) => { plan.detectedVersion = '1.2.4'; }],
    ['required capability', (plan: LocalScanPlan) => { plan.capabilities.required['files.list'] = false; }],
    ['index target', (plan: LocalScanPlan) => { plan.sources[0].indexPath = '/private/alternate/.codegraph'; }],
    ['analysis mode', (plan: LocalScanPlan) => { plan.analysisMode = 'deep'; }],
    ['file limit', (plan: LocalScanPlan) => { plan.limits.maxFiles += 1; }],
  ])('changes when %s changes', (_name, mutate) => {
    const baseline = makePlan();
    const changed = clonePlan(baseline);
    mutate(changed);

    expect(hashLocalScanPlan(changed)).not.toBe(hashLocalScanPlan(baseline));
  });

  it('excludes display paths and the self-referential plan hash', () => {
    const baseline = makePlan();
    const changed = clonePlan(baseline);
    changed.sources[0].displayPath = 'renamed locally';
    changed.localScanPlanHash = 'd'.repeat(64);

    expect(hashLocalScanPlan(changed)).toBe(hashLocalScanPlan(baseline));
  });
});
