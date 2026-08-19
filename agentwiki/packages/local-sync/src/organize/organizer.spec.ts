import { describe, expect, it } from 'vitest';
import type { SourceArtifact } from '../protocol/artifact.js';
import type { Recipe } from '../protocol/recipe.js';
import { organizeArtifacts } from './organizer.js';

function recipe(recipeId = 'code-wiki@1'): Recipe {
  return {
    recipeId,
    version: '1.0',
    name: 'Test Recipe',
    description: 'For tests',
    steps: [],
    constraints: {
      requireProvenance: true,
      requireEvidence: true,
      maxRepairCycles: 3,
      maxArtifactsPerWorkItem: 10,
      maxConflictFields: 20,
      sensitivityGate: 'shareable-only',
    },
    requiredArtifactKinds: ['code', 'document'],
    identityFields: ['pageId'],
    mergeStrategy: 'by-field',
  };
}

function artifact(kind: SourceArtifact['kind'], overrides: Partial<SourceArtifact> = {}): SourceArtifact {
  return {
    artifactId: `artifact-${kind}`,
    adapterId: 'test',
    adapterVersion: '1.0.0',
    sourceId: 'source-1',
    logicalKey: 'core',
    contentHash: 'a'.repeat(64),
    updatedAt: '2026-07-30T00:00:00.000Z',
    kind,
    content: { title: 'Core', body: 'Body' },
    evidence: [{ evidenceId: 'e1', sourceUri: 'src/core.ts', sourceHash: 'a'.repeat(64) }],
    sensitivity: 'shareable',
    ...overrides,
  } as SourceArtifact;
}

describe('organizer', () => {
  it('organizes code artifact into a page', () => {
    const result = organizeArtifacts([artifact('code')], {
      spaceId: 'space-1',
      baseRevision: '0',
      recipe: recipe(),
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    });
    expect(result.bundle.schemaVersion).toBe('knowledge-bundle@1');
    expect(result.bundle.pages).toHaveLength(1);
    expect(result.bundle.pages[0].path).toBe('code/core.md');
    expect(result.bundle.pages[0].title).toBe('Core');
  });

  it('organizes document artifact into a page under docs', () => {
    const result = organizeArtifacts([artifact('document', { logicalKey: 'README.md', content: { title: 'Readme', body: 'Hello' } })], {
      spaceId: 'space-1',
      baseRevision: '0',
      recipe: recipe('document-library@1'),
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    });
    expect(result.bundle.pages[0].path).toBe('docs/README-md.md');
  });

  it('drops local-only artifacts', () => {
    const result = organizeArtifacts([artifact('code', { sensitivity: 'local-only' })], {
      spaceId: 'space-1',
      baseRevision: '0',
      recipe: recipe(),
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    });
    expect(result.bundle.pages).toHaveLength(0);
    expect(result.bundle.provenance).toHaveLength(0);
  });

  it('keeps review-required sensitivity in provenance', () => {
    const result = organizeArtifacts([artifact('code', { sensitivity: 'review-required' })], {
      spaceId: 'space-1',
      baseRevision: '0',
      recipe: recipe(),
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    });
    expect(result.bundle.provenance[0].sensitivity).toBe('review-required');
  });

  it('produces stable page ids from identity key', () => {
    const a1 = artifact('code', { logicalKey: 'module', content: { title: 'Old', body: 'B' } });
    const a2 = artifact('code', { logicalKey: 'module', content: { title: 'New', body: 'B' } });
    const r1 = organizeArtifacts([a1], {
      spaceId: 'space-1',
      baseRevision: '0',
      recipe: recipe(),
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    });
    const r2 = organizeArtifacts([a2], {
      spaceId: 'space-1',
      baseRevision: '0',
      recipe: recipe(),
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    });
    expect(r1.bundle.pages[0].pageId).toBe(r2.bundle.pages[0].pageId);
    expect(r2.bundle.pages[0].title).toBe('New');
  });

  it('organizes memory artifacts', () => {
    const result = organizeArtifacts([artifact('memory', { logicalKey: 'pref', content: { title: 'Preference', body: 'Prefer dark mode' } })], {
      spaceId: 'space-1',
      baseRevision: '0',
      recipe: recipe('agent-memory@1'),
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    });
    expect(result.bundle.memories).toHaveLength(1);
    expect(result.bundle.memories[0].key).toBe('pref');
  });

  it('preserves strict CodeGraph ownership on generated memories', () => {
    const result = organizeArtifacts([artifact('memory', {
      logicalKey: 'codegraph/memory',
      content: { title: 'Generated memory', body: 'value', metadata: { ownership: { producer: 'agentwiki-codegraph-generated', sourceKey: 'a'.repeat(64), analysisLayer: 'base', snapshotHash: 'b'.repeat(64), logicalKey: 'codegraph/memory' } } },
    })], {
      spaceId: 'space-1', baseRevision: '0', recipe: recipe(), now: () => new Date('2026-08-19T00:00:00.000Z'),
    });
    expect(result.bundle.memories[0]?.ownership).toEqual({ producer: 'agentwiki-codegraph-generated', sourceKey: 'a'.repeat(64), analysisLayer: 'base', snapshotHash: 'b'.repeat(64), logicalKey: 'codegraph/memory' });
  });

  it('organizes relation artifacts when metadata contains source and target', () => {
    const result = organizeArtifacts([artifact('relation', {
      logicalKey: 'rel',
      content: { title: 'uses', body: 'A uses B', metadata: { sourceId: 'page-a', targetId: 'page-b' } },
    })], {
      spaceId: 'space-1',
      baseRevision: '0',
      recipe: recipe('space-reconcile@1'),
      now: () => new Date('2026-07-30T00:00:00.000Z'),
    });
    expect(result.bundle.relations).toHaveLength(1);
    expect(result.bundle.relations[0].relationType).toBe('uses');
  });
});
