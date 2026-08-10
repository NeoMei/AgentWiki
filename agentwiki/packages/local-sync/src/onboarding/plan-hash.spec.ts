import { describe, expect, it } from 'vitest';
import { normalizeServerPlan, hashServerPlan } from './plan-hash.js';

describe('server plan normalization', () => {
  it('editor always-review has 10 scopes without review:auto-publish', () => {
    const normalized = normalizeServerPlan({
      space: { mode: 'create', name: 'R&D' },
      agentName: 'Codex',
      permissionPreset: 'editor',
      approvalMode: 'always-review',
      packageVersion: '0.3.0',
    });
    expect(normalized.scopes).not.toContain('review:auto-publish');
    expect(normalized.scopes).toHaveLength(10);
    expect(normalized.spaceRole).toBe('editor');
  });

  it('editor scoped-auto-publish adds review:auto-publish', () => {
    const normalized = normalizeServerPlan({
      space: { mode: 'create', name: 'R&D' },
      agentName: 'Codex',
      permissionPreset: 'editor',
      approvalMode: 'scoped-auto-publish',
      packageVersion: '0.3.0',
    });
    expect(normalized.scopes).toContain('review:auto-publish');
    expect(normalized.scopes).toHaveLength(11);
  });

  it('full preset always includes review:auto-publish', () => {
    const normalized = normalizeServerPlan({
      space: { mode: 'create', name: 'R&D' },
      agentName: 'Codex',
      permissionPreset: 'full',
      approvalMode: 'always-review',
      packageVersion: '0.3.0',
    });
    expect(normalized.scopes).toContain('review:auto-publish');
    expect(normalized.scopes).toContain('memory:read');
    expect(normalized.scopes).toContain('memory:write');
  });

  it('scopes are sorted', () => {
    const normalized = normalizeServerPlan({
      space: { mode: 'create', name: 'R&D' },
      agentName: 'Codex',
      permissionPreset: 'full',
      approvalMode: 'scoped-auto-publish',
      packageVersion: '0.3.0',
    });
    const sorted = [...normalized.scopes].sort();
    expect(normalized.scopes).toEqual(sorted);
  });
});

describe('server plan hashing', () => {
  it('produces a stable 64-char hex digest', () => {
    const plan = {
      space: { mode: 'create' as const, name: '研发知识库' },
      agentName: 'Codex',
      permissionPreset: 'editor' as const,
      approvalMode: 'always-review' as const,
      packageVersion: '0.3.0',
    };
    const a = hashServerPlan(plan);
    const b = hashServerPlan(plan);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different presets produce different hashes', () => {
    const base = {
      space: { mode: 'create' as const, name: 'S' },
      agentName: 'A',
      approvalMode: 'always-review' as const,
      packageVersion: '0.3.0',
    };
    expect(hashServerPlan({ ...base, permissionPreset: 'editor' })).not.toBe(
      hashServerPlan({ ...base, permissionPreset: 'full' }),
    );
  });

  it('key order in the input does not affect the hash', () => {
    const a = hashServerPlan({
      agentName: 'Codex',
      space: { mode: 'create', name: 'S' },
      permissionPreset: 'editor',
      approvalMode: 'always-review',
      packageVersion: '0.3.0',
    });
    const b = hashServerPlan({
      packageVersion: '0.3.0',
      approvalMode: 'always-review',
      permissionPreset: 'editor',
      agentName: 'Codex',
      space: { mode: 'create', name: 'S' },
    });
    expect(a).toBe(b);
  });
});
