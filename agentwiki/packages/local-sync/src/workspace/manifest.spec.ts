import { describe, expect, it } from 'vitest';
import { LocalManifestSchema, assertLocalManifest, assertSourceMapping } from './manifest.js';

describe('local manifest', () => {
  it('validates a minimal manifest', () => {
    const manifest = assertLocalManifest({
      schemaVersion: '1.0',
      spaceId: 'space-1',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      baseRevision: null,
      pendingRevision: null,
      sources: [],
      checkpoints: [],
    });
    expect(manifest.spaceId).toBe('space-1');
    expect(LocalManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('validates source mapping', () => {
    const mapping = assertSourceMapping({
      adapterId: 'markitdown',
      sourcePath: '/tmp/docs',
      sourceId: 's1',
      sourceHash: 'sh1',
      lastCollectedAt: '2024-01-01T00:00:00Z',
      artifactCount: 3,
    });
    expect(mapping.artifactCount).toBe(3);
  });

  it('rejects malformed datetime', () => {
    expect(() =>
      assertLocalManifest({
        schemaVersion: '1.0',
        spaceId: 'space-1',
        createdAt: 'now',
        updatedAt: '2024-01-01T00:00:00Z',
        baseRevision: null,
        pendingRevision: null,
        sources: [],
        checkpoints: [],
      }),
    ).toThrow();
  });
});
