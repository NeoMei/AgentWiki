import { describe, expect, it } from 'vitest';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { normalizeServerPlan, hashServerPlan } from './plan-hash.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ServerPlan } from './plan-hash.js';

const planHashGolden = JSON.parse(readFileSync(fileURLToPath(new URL(
  '../../../sync-protocol/test-vectors/onboarding-plan-hash-v1.json',
  import.meta.url,
)), 'utf8')) as { plan: ServerPlan; sha256: string };

describe('server plan normalization', () => {
  it.each(['reader', 'editor', 'publisher'] as const)('derives %s scopes from the shared contract', (role) => {
    const plan = {
      space: { mode: 'existing' as const, id: 'space-1' },
      agentName: 'OpenCode',
      role,
      packageVersion: '0.6.1' as const,
    };
    expect(normalizeServerPlan(plan)).toEqual({
      ...plan,
      scopes: scopesForAgentAccessRole(role),
    });
  });
});

describe('server plan hashing', () => {
  it('matches the shared raw-plan golden vector', () => {
    expect(hashServerPlan(planHashGolden.plan)).toBe(planHashGolden.sha256);
  });

  it('produces a stable 64-char hex digest', () => {
    const plan = {
      space: { mode: 'create' as const, name: '研发知识库' },
      agentName: 'Codex',
      role: 'editor' as const,
      packageVersion: '0.6.1' as const,
    };
    const a = hashServerPlan(plan);
    const b = hashServerPlan(plan);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different roles produce different hashes', () => {
    const base = {
      space: { mode: 'create' as const, name: 'S' },
      agentName: 'A',
      packageVersion: '0.6.1' as const,
    };
    expect(hashServerPlan({ ...base, role: 'editor' })).not.toBe(
      hashServerPlan({ ...base, role: 'publisher' }),
    );
  });

  it('key order in the input does not affect the hash', () => {
    const a = hashServerPlan({
      agentName: 'Codex',
      space: { mode: 'create', name: 'S' },
      role: 'editor',
      packageVersion: '0.6.1',
    });
    const b = hashServerPlan({
      packageVersion: '0.6.1',
      role: 'editor',
      agentName: 'Codex',
      space: { mode: 'create', name: 'S' },
    });
    expect(a).toBe(b);
  });
});
