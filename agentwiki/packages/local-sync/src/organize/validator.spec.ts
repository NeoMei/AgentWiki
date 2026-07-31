import { describe, expect, it } from 'vitest';
import type { SourceArtifact } from '../protocol/artifact.js';
import type { KnowledgeBundle } from '../protocol/bundle.js';
import type { Recipe } from '../protocol/recipe.js';
import { validateKnowledgeBundle } from './validator.js';

function recipe(): Recipe {
  return {
    recipeId: 'code-wiki@1',
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
    requiredArtifactKinds: ['code'],
    identityFields: ['pageId'],
    mergeStrategy: 'by-field',
  };
}

function artifact(overrides: Partial<SourceArtifact> = {}): SourceArtifact {
  return {
    artifactId: 'artifact-1',
    adapterId: 'test',
    adapterVersion: '1.0.0',
    sourceId: 'source-1',
    logicalKey: 'core',
    contentHash: 'a'.repeat(64),
    updatedAt: '2026-07-30T00:00:00.000Z',
    kind: 'code',
    content: { title: 'Core', body: 'Body' },
    evidence: [{ evidenceId: 'e1', sourceUri: 'src/core.ts', sourceHash: 'a'.repeat(64) }],
    sensitivity: 'shareable',
    ...overrides,
  } as SourceArtifact;
}

function bundle(overrides: Partial<KnowledgeBundle> = {}, pagePath = 'code/core.md'): KnowledgeBundle {
  return {
    schemaVersion: 'knowledge-bundle@1',
    recipeVersion: 'code-wiki@1',
    spaceId: 'space-1',
    baseRevision: '0',
    pages: [{
      pageId: 'page-core',
      spaceId: 'space-1',
      path: pagePath,
      title: 'Core',
      body: 'Body',
      order: 0,
      artifactIds: ['artifact-1'],
      contentHash: 'a'.repeat(64),
      updatedAt: '2026-07-30T00:00:00.000Z',
    }],
    memories: [],
    relations: [],
    provenance: [{ itemId: 'page-core', artifactIds: ['artifact-1'], sensitivity: 'shareable' }],
    deletions: [],
    ...overrides,
  } as KnowledgeBundle;
}

function context(expectedBaseRevision = '0') {
  return {
    expectedBaseRevision,
    acknowledgedReviewArtifactIds: new Set<string>(),
    trustedRevisionProvenanceIds: new Set<string>(),
  };
}

describe('validator', () => {
  it('passes a valid bundle', () => {
    const issues = validateKnowledgeBundle(bundle(), [artifact()], recipe(), context());
    expect(issues).toHaveLength(0);
  });

  it('flags missing provenance', () => {
    const b = bundle({ provenance: [] });
    const issues = validateKnowledgeBundle(b, [artifact()], recipe(), context());
    expect(issues).toContainEqual(expect.objectContaining({ itemId: 'page-core', rule: 'provenance.required', repairable: true }));
  });

  it('flags wrong base revision', () => {
    const issues = validateKnowledgeBundle(bundle(), [artifact()], recipe(), context('1'));
    expect(issues).toContainEqual(expect.objectContaining({ itemId: 'bundle', rule: 'base.revision', repairable: false }));
  });

  it('schema fails closed for local-only provenance', () => {
    const b = bundle({ provenance: [{ itemId: 'page-core', artifactIds: ['artifact-1'], sensitivity: 'local-only' as const }] });
    const issues = validateKnowledgeBundle(b, [artifact()], recipe(), context());
    expect(issues).toContainEqual(expect.objectContaining({ rule: 'schema.valid', message: expect.stringMatching(/local-only/) }));
  });

  it('flags unacknowledged review-required', () => {
    const b = bundle({
      pages: [{ ...bundle().pages[0], artifactIds: ['artifact-review'] }],
      provenance: [{ itemId: 'page-core', artifactIds: ['artifact-review'], sensitivity: 'review-required' }],
    });
    const art = artifact({ artifactId: 'artifact-review', sensitivity: 'review-required' });
    const issues = validateKnowledgeBundle(b, [art], recipe(), context());
    expect(issues).toContainEqual(expect.objectContaining({ itemId: 'page-core', rule: 'sensitivity.review-required', repairable: true }));
  });

  it('allows acknowledged review-required', () => {
    const b = bundle({
      pages: [{ ...bundle().pages[0], artifactIds: ['artifact-review'] }],
      provenance: [{ itemId: 'page-core', artifactIds: ['artifact-review'], sensitivity: 'review-required' }],
    });
    const art = artifact({ artifactId: 'artifact-review', sensitivity: 'review-required' });
    const ctx = { ...context(), acknowledgedReviewArtifactIds: new Set(['artifact-review']) };
    const issues = validateKnowledgeBundle(b, [art], recipe(), ctx);
    expect(issues).not.toContainEqual(expect.objectContaining({ rule: 'sensitivity.review-required' }));
  });

  it('flags duplicate page ids', () => {
    const page = bundle().pages[0];
    const b = bundle({ pages: [page, { ...page, path: 'code/other.md' }] });
    const issues = validateKnowledgeBundle(b, [artifact()], recipe(), context());
    expect(issues).toContainEqual(expect.objectContaining({ rule: 'id.duplicate' }));
  });

  it('flags duplicate normalized paths', () => {
    const page = bundle().pages[0];
    const b = bundle({ pages: [page, { ...page, pageId: 'page-other', path: 'CODE/CORE.md' }] });
    const issues = validateKnowledgeBundle(b, [artifact(), artifact({ artifactId: 'artifact-2' })], recipe(), context());
    expect(issues).toContainEqual(expect.objectContaining({ rule: 'path.duplicate' }));
  });

  it('flags dangling relation', () => {
    const b = bundle({
      relations: [{
        relationId: 'rel-1',
        spaceId: 'space-1',
        sourceId: 'missing',
        targetId: 'page-core',
        relationType: 'uses',
        artifactIds: ['artifact-1'],
      }],
      provenance: [
        { itemId: 'page-core', artifactIds: ['artifact-1'], sensitivity: 'shareable' },
        { itemId: 'rel-1', artifactIds: ['artifact-1'], sensitivity: 'shareable' },
      ],
    });
    const issues = validateKnowledgeBundle(b, [artifact()], recipe(), context());
    expect(issues).toContainEqual(expect.objectContaining({ rule: 'relation.dangling.source' }));
  });

  it('flags self-relation', () => {
    const b = bundle({
      relations: [{
        relationId: 'rel-1',
        spaceId: 'space-1',
        sourceId: 'page-core',
        targetId: 'page-core',
        relationType: 'uses',
        artifactIds: ['artifact-1'],
      }],
      provenance: [
        { itemId: 'page-core', artifactIds: ['artifact-1'], sensitivity: 'shareable' },
        { itemId: 'rel-1', artifactIds: ['artifact-1'], sensitivity: 'shareable' },
      ],
    });
    const issues = validateKnowledgeBundle(b, [artifact()], recipe(), context());
    expect(issues).toContainEqual(expect.objectContaining({ rule: 'relation.self-loop' }));
  });

  it('flags page parent cycle', () => {
    const b = bundle({
      pages: [
        { ...bundle().pages[0], pageId: 'a', metadata: { parentId: 'b' }, path: 'code/a.md' },
        { ...bundle().pages[0], pageId: 'b', metadata: { parentId: 'a' }, path: 'code/b.md' },
      ],
      provenance: [
        { itemId: 'a', artifactIds: ['artifact-1'], sensitivity: 'shareable' },
        { itemId: 'b', artifactIds: ['artifact-1'], sensitivity: 'shareable' },
      ],
    });
    const issues = validateKnowledgeBundle(b, [artifact()], recipe(), context());
    expect(issues).toContainEqual(expect.objectContaining({ rule: 'page.cycle' }));
  });

  it('flags secrets in page body', () => {
    const b = bundle({ pages: [{ ...bundle().pages[0], body: 'api_key=12345678' }] });
    const issues = validateKnowledgeBundle(b, [artifact()], recipe(), context());
    expect(issues).toContainEqual(expect.objectContaining({ rule: 'sensitive.secret' }));
  });
});
