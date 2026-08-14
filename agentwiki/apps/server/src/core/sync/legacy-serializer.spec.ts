import { createHash } from 'crypto';
import { LegacyBundleHashStream, legacyBundleHash } from './legacy-serializer';

function referenceSnapshot(bundle: any) {
  return {
    schemaVersion: bundle.schemaVersion,
    recipeVersion: bundle.recipeVersion,
    spaceId: bundle.spaceId,
    baseRevision: bundle.baseRevision,
    pages: bundle.pages.map((p: any) => ({
      pageId: p.pageId,
      spaceId: p.spaceId,
      path: p.path,
      title: p.title,
      body: p.body,
      order: p.order ?? 0,
      ...(p.metadata ? { metadata: p.metadata } : {}),
      artifactIds: p.artifactIds ?? [],
      contentHash: createHash('sha256').update(p.body).digest('hex'),
      updatedAt: p.updatedAt,
    })),
    memories: bundle.memories ?? [],
    relations: bundle.relations ?? [],
    provenance: bundle.provenance ?? [],
    deletions: bundle.deletions ?? [],
  };
}

describe('legacyBundleHash', () => {
  it('matches JSON.stringify(snapshot) hash byte for byte', () => {
    const bundle = {
      schemaVersion: 'knowledge-bundle@1',
      recipeVersion: 'none',
      spaceId: 'space-1',
      baseRevision: 'rev-1',
      pages: [
        {
          pageId: 'page-1', spaceId: 'space-1', path: 'a.md', title: 'A', body: 'Hello\n',
          order: 0, metadata: null, artifactIds: [], contentHash: createHash('sha256').update('Hello\n').digest('hex'), updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          pageId: 'page-2', spaceId: 'space-1', path: 'b.md', title: 'B', body: 'World',
          order: 1, metadata: { parentId: 'page-1' }, artifactIds: ['a1'], contentHash: createHash('sha256').update('World').digest('hex'), updatedAt: '2026-01-01T00:00:01.000Z',
        },
      ],
      memories: [],
      relations: [],
      provenance: [],
      deletions: [],
    };
    const reference = referenceSnapshot(bundle);
    const expected = createHash('sha256').update(JSON.stringify(reference)).digest('hex');
    expect(legacyBundleHash(bundle)).toBe(expected);
  });

  it('streams the same hash as the one-shot serializer', () => {
    const bundle = {
      schemaVersion: 'knowledge-bundle@1',
      recipeVersion: 'none',
      spaceId: 'space-1',
      baseRevision: 'rev-1',
      pages: [
        { pageId: 'p1', spaceId: 'space-1', path: 'a.md', title: 'A', body: 'x', order: 0, metadata: null, artifactIds: [], contentHash: 'h1', updatedAt: '2026-01-01T00:00:00.000Z' },
        { pageId: 'p2', spaceId: 'space-1', path: 'b.md', title: 'B', body: 'y', order: 1, metadata: { parentId: 'p1' }, artifactIds: ['a'], contentHash: 'h2', updatedAt: '2026-01-01T00:00:01.000Z' },
      ],
      memories: [], relations: [], provenance: [], deletions: [],
    };
    const stream = new LegacyBundleHashStream(bundle.schemaVersion, bundle.recipeVersion, bundle.spaceId, bundle.baseRevision);
    for (const page of bundle.pages) stream.appendPage(page);
    const streamed = stream.digest(bundle.memories, bundle.relations, bundle.provenance, bundle.deletions);
    expect(streamed).toBe(legacyBundleHash(bundle));
  });
});
