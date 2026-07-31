import { describe, expect, it } from 'vitest';
import { mergeBundles } from './merge.js';
import type { KnowledgeBundle } from '../protocol/bundle.js';

function makeBundle(overrides: Partial<KnowledgeBundle> = {}): KnowledgeBundle {
  return {
    schemaVersion: 'knowledge-bundle@1',
    recipeVersion: 'document-library@1',
    spaceId: 'space-1',
    baseRevision: '0',
    pages: [],
    memories: [],
    relations: [],
    provenance: [],
    deletions: [],
    ...overrides,
  };
}

describe('mergeBundles', () => {
  it('merges independent local and remote changes', () => {
    const base = makeBundle({
      pages: [{
        pageId: 'p1',
        spaceId: 'space-1',
        path: 'p1.md',
        title: 'Page',
        body: 'base',
        artifactIds: ['a1'],
        contentHash: 'h1',
        updatedAt: '2026-07-30T00:00:00.000Z',
      }],
    });
    const local = makeBundle({
      pages: [{
        pageId: 'p1',
        spaceId: 'space-1',
        path: 'p1.md',
        title: 'Page',
        body: 'local',
        artifactIds: ['a1'],
        contentHash: 'h2',
        updatedAt: '2026-07-30T00:00:01.000Z',
      }],
    });
    const remote = makeBundle({
      pages: [{
        pageId: 'p1',
        spaceId: 'space-1',
        path: 'p1.md',
        title: 'Page Remote',
        body: 'base',
        artifactIds: ['a1'],
        contentHash: 'h3',
        updatedAt: '2026-07-30T00:00:02.000Z',
      }],
    });

    const result = mergeBundles(base, local, remote);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].conflictingFields).toHaveLength(0);
    expect(result.pages[0].proposed?.body).toBe('local');
    expect(result.pages[0].proposed?.title).toBe('Page Remote');
  });

  it('flags conflicting fields when local and remote change the same field', () => {
    const base = makeBundle({
      pages: [{
        pageId: 'p1',
        spaceId: 'space-1',
        path: 'p1.md',
        title: 'Page',
        body: 'base',
        artifactIds: ['a1'],
        contentHash: 'h1',
        updatedAt: '2026-07-30T00:00:00.000Z',
      }],
    });
    const local = makeBundle({
      pages: [{
        pageId: 'p1',
        spaceId: 'space-1',
        path: 'p1.md',
        title: 'Page',
        body: 'local',
        artifactIds: ['a1'],
        contentHash: 'h2',
        updatedAt: '2026-07-30T00:00:01.000Z',
      }],
    });
    const remote = makeBundle({
      pages: [{
        pageId: 'p1',
        spaceId: 'space-1',
        path: 'p1.md',
        title: 'Page',
        body: 'remote',
        artifactIds: ['a1'],
        contentHash: 'h3',
        updatedAt: '2026-07-30T00:00:02.000Z',
      }],
    });

    const result = mergeBundles(base, local, remote);
    expect(result.pages[0].conflictingFields).toContain('body');
  });
});
