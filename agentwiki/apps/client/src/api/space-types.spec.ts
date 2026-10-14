import { describe, expect, it } from 'vitest';
import { normalizeSpaceApprovalPolicy } from './space-types';

describe('space approval policy compatibility', () => {
  it.each([
    ['always-review', 'always-review'],
    ['no-review', 'no-review'],
    ['scoped-auto-publish', 'no-review'],
  ])('normalizes %s to the canonical %s policy', (value, expected) => {
    expect(normalizeSpaceApprovalPolicy(value)).toBe(expected);
  });
});
