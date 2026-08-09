import { parseKnowledgeBundle } from './knowledge-bundle';

describe('parseKnowledgeBundle', () => {
  const validBundle = {
    schemaVersion: 'knowledge-bundle@1',
    recipeVersion: 'code-wiki@1',
    spaceId: 'space-1',
    baseRevision: '0',
    pages: [
      {
        pageId: 'page-1',
        spaceId: 'space-1',
        path: '/',
        title: 'Home',
        body: '# Home',
        order: 0,
        artifactIds: ['a1'],
        contentHash: 'h1',
        updatedAt: '2026-07-31T00:00:00.000Z',
      },
    ],
    memories: [],
    relations: [],
    provenance: [
      {
        itemId: 'page-1',
        artifactIds: ['a1'],
        sensitivity: 'shareable',
      },
    ],
    deletions: [],
  };

  it('parses a valid bundle and computes a content hash', () => {
    const bundle = parseKnowledgeBundle(Buffer.from(JSON.stringify(validBundle)));
    expect(bundle.spaceId).toBe('space-1');
    expect(bundle.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects oversized payloads', () => {
    const huge = Buffer.from('x'.repeat(10 * 1024 * 1024 + 1));
    expect(() => parseKnowledgeBundle(huge)).toThrow(expect.objectContaining({ businessCode: 'SOURCE_TOO_LARGE' }));
  });

  it('rejects invalid JSON', () => {
    expect(() => parseKnowledgeBundle(Buffer.from('not json'))).toThrow(expect.objectContaining({ businessCode: 'KNOWLEDGE_BUNDLE_INVALID' }));
  });

  it('rejects unknown top-level keys', () => {
    const bad = { ...validBundle, extra: true };
    expect(() => parseKnowledgeBundle(Buffer.from(JSON.stringify(bad)))).toThrow(expect.objectContaining({ businessCode: 'KNOWLEDGE_BUNDLE_INVALID' }));
  });

  it('rejects a bundle with local-only provenance semantics via missing required fields', () => {
    const bad = {
      ...validBundle,
      pages: [{ ...validBundle.pages[0], title: '' }],
    };
    expect(() => parseKnowledgeBundle(Buffer.from(JSON.stringify(bad)))).toThrow(expect.objectContaining({ businessCode: 'KNOWLEDGE_BUNDLE_INVALID' }));
  });

  it('accepts the local orchestrator provenance contract', () => {
    const bundle = parseKnowledgeBundle(Buffer.from(JSON.stringify(validBundle)));
    expect(bundle.provenance).toEqual([{ itemId: 'page-1', artifactIds: ['a1'], sensitivity: 'shareable' }]);
  });

  it.each(['../outside', '/absolute', 'nested/page'])('rejects unsafe knowledge identifier %p', (pageId) => {
    const bad = { ...validBundle, pages: [{ ...validBundle.pages[0], pageId }] };
    expect(() => parseKnowledgeBundle(Buffer.from(JSON.stringify(bad))))
      .toThrow(expect.objectContaining({ businessCode: 'KNOWLEDGE_BUNDLE_INVALID' }));
  });

  it('rejects excessive item counts before compilation', () => {
    const bad = {
      ...validBundle,
      pages: Array.from({ length: 501 }, (_, index) => ({
        ...validBundle.pages[0], pageId: `page-${index}`, path: `/page-${index}`,
      })),
    };
    expect(() => parseKnowledgeBundle(Buffer.from(JSON.stringify(bad))))
      .toThrow(expect.objectContaining({ businessCode: 'KNOWLEDGE_BUNDLE_INVALID' }));
  });

  it('normalizes ordering and produces deterministic hash', () => {
    const b1 = parseKnowledgeBundle(Buffer.from(JSON.stringify(validBundle)));
    const reversed = { ...validBundle, pages: [...validBundle.pages].reverse() };
    const b2 = parseKnowledgeBundle(Buffer.from(JSON.stringify(reversed)));
    expect(b1.contentHash).toBe(b2.contentHash);
  });
});
