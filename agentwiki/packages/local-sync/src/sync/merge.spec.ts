import { describe, expect, it } from 'vitest';
import { mergeBundles, applyConflictResolution } from './merge.js';
import type { KnowledgeBundle, WikiPage, SharedMemory, KnowledgeRelation, DeletionProposal } from '../protocol/bundle.js';

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    pageId: 'p1',
    spaceId: 'space-1',
    path: 'p1.md',
    title: 'Page',
    body: 'base',
    artifactIds: ['a1'],
    contentHash: 'h1',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

function makeMemory(overrides: Partial<SharedMemory> = {}): SharedMemory {
  return {
    memoryId: 'm1',
    spaceId: 'space-1',
    key: 'k1',
    value: 'base',
    scope: 'space',
    artifactIds: ['a1'],
    contentHash: 'h1',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

function makeRelation(overrides: Partial<KnowledgeRelation> = {}): KnowledgeRelation {
  return {
    relationId: 'r1',
    spaceId: 'space-1',
    sourceId: 'p1',
    targetId: 'p2',
    relationType: 'relates',
    artifactIds: ['a1'],
    ...overrides,
  };
}

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

function makeDeletion(overrides: Partial<DeletionProposal> = {}): DeletionProposal {
  return {
    deletionId: 'd1',
    itemType: 'page',
    itemId: 'p1',
    reason: 'obsolete',
    artifactIds: ['a1'],
    ...overrides,
  };
}

describe('mergeBundles', () => {
  it('merges independent local and remote changes', () => {
    const base = makeBundle({ pages: [makePage({ body: 'base' })] });
    const local = makeBundle({ pages: [makePage({ body: 'local' })] });
    const remote = makeBundle({ pages: [makePage({ title: 'Page Remote' })] });

    const result = mergeBundles(base, local, remote);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].conflictingFields).toHaveLength(0);
    expect(result.pages[0].proposed?.body).toBe('local');
    expect(result.pages[0].proposed?.title).toBe('Page Remote');
    expect(result.conflicts).toHaveLength(0);
  });

  it('flags conflicting fields when local and remote change the same field', () => {
    const base = makeBundle({ pages: [makePage({ body: 'base' })] });
    const local = makeBundle({ pages: [makePage({ body: 'local' })] });
    const remote = makeBundle({ pages: [makePage({ body: 'remote' })] });

    const result = mergeBundles(base, local, remote);
    expect(result.pages[0].conflictingFields).toContain('body');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictKind).toBe('field');
    expect(result.conflicts[0].itemKind).toBe('page');
  });

  it('merges memory field changes independently', () => {
    const base = makeBundle({ memories: [makeMemory({ value: 'base' })] });
    const local = makeBundle({ memories: [makeMemory({ value: 'local' })] });
    const remote = makeBundle({ memories: [makeMemory({ key: 'updated-key' })] });

    const result = mergeBundles(base, local, remote);
    expect(result.memories[0].conflictingFields).toHaveLength(0);
    expect(result.memories[0].proposed?.value).toBe('local');
    expect(result.memories[0].proposed?.key).toBe('updated-key');
  });

  it('flags relation field conflicts', () => {
    const base = makeBundle({ relations: [makeRelation({ relationType: 'relates' })] });
    const local = makeBundle({ relations: [makeRelation({ relationType: 'local-type' })] });
    const remote = makeBundle({ relations: [makeRelation({ relationType: 'remote-type' })] });

    const result = mergeBundles(base, local, remote);
    expect(result.relations[0].conflictingFields).toContain('relationType');
  });

  it('applies conflict resolution by replacing proposed value', () => {
    const base = makeBundle({ pages: [makePage({ body: 'base' })] });
    const local = makeBundle({ pages: [makePage({ body: 'local' })] });
    const remote = makeBundle({ pages: [makePage({ body: 'remote' })] });

    const result = mergeBundles(base, local, remote);
    const conflictId = result.conflicts[0].id;
    const resolved = makePage({ body: 'resolved' });
    const resolvedResult = applyConflictResolution(result, conflictId, resolved);
    expect(resolvedResult.conflicts).toHaveLength(0);
    expect(resolvedResult.pages[0].proposed?.body).toBe('resolved');
  });

  it('detects delete-modify conflict when base item is deleted on one side', () => {
    const base = makeBundle({ pages: [makePage()] });
    const local = makeBundle({ deletions: [makeDeletion()] });
    const remote = makeBundle({ pages: [makePage({ body: 'remote-edit' })] });

    const result = mergeBundles(base, local, remote);
    const del = result.deletions.find((d) => d.itemId === 'p1');
    expect(del).toBeDefined();
    expect(del?.conflict?.conflictKind).toBe('delete-modify');
  });

  it('detects delete-delete conflict when both sides delete differently', () => {
    const local = makeBundle({ deletions: [makeDeletion({ reason: 'local-reason' })] });
    const remote = makeBundle({ deletions: [makeDeletion({ reason: 'remote-reason' })] });

    const result = mergeBundles(makeBundle(), local, remote);
    const del = result.deletions.find((d) => d.itemId === 'p1');
    expect(del?.conflict?.conflictKind).toBe('delete-delete');
  });

  it('adds local-only page as proposed', () => {
    const local = makeBundle({ pages: [makePage()] });
    const result = mergeBundles(makeBundle(), local, makeBundle());
    expect(result.pages[0].proposed?.pageId).toBe('p1');
  });
});
