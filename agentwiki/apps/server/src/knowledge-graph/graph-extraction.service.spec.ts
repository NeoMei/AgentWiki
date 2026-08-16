import { GraphExtractionService } from './graph-extraction.service';

describe('GraphExtractionService', () => {
  const service = new GraphExtractionService();

  describe('extractWikiLinks', () => {
    it('extracts plain and alias targets without duplicates', () => {
      const content = 'See [[Alpha]] and [[Beta|the beta page]] plus [[Alpha]] again.';
      expect(service.extractWikiLinks(content)).toEqual(['Alpha', 'Beta']);
    });

    it('returns empty for content without links', () => {
      expect(service.extractWikiLinks('no links here')).toEqual([]);
      expect(service.extractWikiLinks('[[  ]]')).toEqual([]);
    });
  });

  describe('resolveWikiLinks', () => {
    const pages = [
      { id: 'p1', title: 'Alpha', slug: 'alpha' },
      { id: 'p2', title: 'Beta Notes', slug: 'beta-notes' },
      { id: 'p3', title: 'gamma', slug: 'gamma' },
    ];

    it('resolves exact, case-insensitive, and slug matches', () => {
      const links = [
        { sourcePageId: 'p1', target: 'Beta Notes' },
        { sourcePageId: 'p1', target: 'beta notes' },
        { sourcePageId: 'p2', target: 'Gamma' },
      ];
      const result = service.resolveWikiLinks(pages, links);
      expect(result.resolved).toEqual([
        { sourcePageId: 'p1', targetPageId: 'p2' },
        { sourcePageId: 'p1', targetPageId: 'p2' },
        { sourcePageId: 'p2', targetPageId: 'p3' },
      ]);
      expect(result.dangling).toBe(0);
    });

    it('counts dangling, ambiguous, and self targets without edges', () => {
      const ambiguousPages = [
        { id: 'a1', title: 'Same', slug: 'same-1' },
        { id: 'a2', title: 'same', slug: 'same-2' },
      ];
      const links = [
        { sourcePageId: 'x', target: 'Missing' },
        { sourcePageId: 'x', target: 'Same' },
        { sourcePageId: 'a1', target: 'same' },
      ];
      const result = service.resolveWikiLinks(ambiguousPages, links);
      expect(result.resolved).toEqual([]);
      expect(result.dangling).toBe(3);
    });
  });

  describe('computeSimilarPairs', () => {
    it('emits canonical pairs above threshold with score confidence', () => {
      const pages = [
        { id: 'b', embedding: [1, 0] },
        { id: 'a', embedding: [0.99, 0.141] },
        { id: 'c', embedding: [0, 1] },
      ];
      const pairs = service.computeSimilarPairs(pages, 0.95);
      expect(pairs).toEqual([
        { sourcePageId: 'a', targetPageId: 'b', score: expect.any(Number) },
      ]);
      expect(pairs[0].score).toBeGreaterThan(0.95);
    });

    it('skips pages without embeddings', () => {
      const pages = [
        { id: 'a', embedding: [1, 0] },
        { id: 'b', embedding: null },
      ];
      expect(service.computeSimilarPairs(pages, 0.5)).toEqual([]);
    });
  });
});
