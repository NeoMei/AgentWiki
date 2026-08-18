import { contentHash } from '../utils/hash.js';
import { LocalScanPlanSchema, type LocalScanPlan } from './contracts.js';

function canonicalize(value: unknown, parentKey?: string): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => canonicalize(item));
    return parentKey === 'sources'
      ? normalized.sort((left, right) => {
        const leftSourceKey = (left as { sourceKey: string }).sourceKey;
        const rightSourceKey = (right as { sourceKey: string }).sourceKey;
        return leftSourceKey.localeCompare(rightSourceKey);
      })
      : normalized;
  }
  if (value !== null && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize((value as Record<string, unknown>)[key], key);
        return result;
      }, {});
  }
  return value;
}

export function hashLocalScanPlan(plan: LocalScanPlan): string {
  const verified = LocalScanPlanSchema.parse(plan);
  const { localScanPlanHash: _localScanPlanHash, ...planWithoutHash } = verified;
  const canonicalPlan = {
    ...planWithoutHash,
    sources: verified.sources.map(({ displayPath: _displayPath, ...source }) => source),
  };
  return contentHash(JSON.stringify(canonicalize(canonicalPlan)));
}
