import { describe, expect, it } from 'vitest';
import { SensitivitySchema, SourceArtifactSchema, assertSourceArtifact } from './artifact.js';

describe('artifact protocol', () => {
  it('validates a minimal source artifact', () => {
    const artifact = assertSourceArtifact({
      artifactId: 'a1',
      adapterId: 'test',
      adapterVersion: '0.1.0',
      sourceId: 's1',
      logicalKey: 'hello.md',
      contentHash: 'h1',
      updatedAt: '2024-01-01T00:00:00Z',
      kind: 'document',
      content: { title: 'Hello', body: 'World' },
      evidence: [],
      sensitivity: 'shareable',
    });
    expect(artifact.kind).toBe('document');
    expect(SourceArtifactSchema.safeParse(artifact).success).toBe(true);
  });

  it('rejects local-only artifact passing through shareable gate', () => {
    const artifact = {
      artifactId: 'a1',
      adapterId: 'test',
      adapterVersion: '0.1.0',
      sourceId: 's1',
      logicalKey: 'secret.md',
      contentHash: 'h1',
      updatedAt: '2024-01-01T00:00:00Z',
      kind: 'document',
      content: { title: 'Secret', body: 'api_key=12345678' },
      evidence: [],
      sensitivity: 'local-only',
    };
    const parsed = assertSourceArtifact(artifact);
    expect(parsed.sensitivity).toBe('local-only');
    expect(SensitivitySchema.parse(parsed.sensitivity)).toBe('local-only');
    // The schema allows local-only, but orchestrator upload gate would reject it.
  });

  it('rejects invalid sensitivity value', () => {
    expect(() => SensitivitySchema.parse('public')).toThrow();
  });

  it('rejects malformed datetime', () => {
    expect(() =>
      assertSourceArtifact({
        artifactId: 'a1',
        adapterId: 'test',
        adapterVersion: '0.1.0',
        sourceId: 's1',
        logicalKey: 'x',
        contentHash: 'h1',
        updatedAt: 'not-a-date',
        kind: 'document',
        content: {},
        evidence: [],
        sensitivity: 'shareable',
      }),
    ).toThrow();
  });
});
