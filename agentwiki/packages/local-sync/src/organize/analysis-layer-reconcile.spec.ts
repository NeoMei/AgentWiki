import { describe, expect, it } from 'vitest';
import type { KnowledgeBundle, WikiPage } from '../protocol/bundle.js';
import { reconcileAnalysisLayers } from './analysis-layer-reconcile.js';

const SOURCE_A = 'a'.repeat(64);
const SOURCE_B = 'b'.repeat(64);

function page(pageId: string, overrides: Partial<WikiPage> = {}): WikiPage {
  const rawMetadata = overrides.metadata;
  const generatedMetadata = rawMetadata
    && typeof rawMetadata.sourceKey === 'string'
    && (rawMetadata.analysisLayer === 'base' || rawMetadata.analysisLayer === 'deep')
    && typeof rawMetadata.snapshotHash === 'string'
    && rawMetadata.producer === undefined
    ? { ownership: { producer: 'agentwiki-codegraph-generated', ...rawMetadata, snapshotHash: rawMetadata.snapshotHash.length === 64 ? rawMetadata.snapshotHash : (rawMetadata.snapshotHash === 'new' ? 'd' : 'c').repeat(64), logicalKey: typeof rawMetadata.logicalKey === 'string' ? rawMetadata.logicalKey : `modules/${pageId}` } }
    : rawMetadata;
  return {
    pageId,
    spaceId: 'space-1',
    path: `code/${pageId}.md`,
    title: pageId,
    body: `body:${pageId}`,
    artifactIds: [`artifact:${pageId}`],
    contentHash: `hash:${pageId}`,
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
    ...(generatedMetadata ? { metadata: generatedMetadata } : {}),
  };
}

function bundle(overrides: Partial<KnowledgeBundle> = {}): KnowledgeBundle {
  return {
    schemaVersion: 'knowledge-bundle@1',
    recipeVersion: 'unified-knowledge@1',
    spaceId: 'space-1',
    baseRevision: 'revision-1',
    pages: [],
    memories: [],
    relations: [],
    provenance: [],
    deletions: [],
    ...overrides,
  };
}

const standardScope = {
  sourceKeys: new Set([SOURCE_A]),
  ownedLayers: new Set(['base'] as const),
};

describe('reconcileAnalysisLayers', () => {
  it('replaces only current-source base items and carries every other item type deterministically', () => {
    const owned = page('page-owned', { metadata: { sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'old' } });
    const removed = page('page-removed', { metadata: { sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'old' } });
    const deep = page('page-deep', { body: 'deep bytes must remain exactly unchanged', metadata: { sourceKey: SOURCE_A, analysisLayer: 'deep', snapshotHash: 'old', logicalKey: 'modules/auth' } });
    const foreign = page('page-foreign', { metadata: { sourceKey: SOURCE_B, analysisLayer: 'base', snapshotHash: 'old' } });
    const document = page('page-document', { path: 'docs/guide.md' });
    const manual = page('page-manual', { title: 'Codebase architecture', path: 'docs/manual-overview.md' });
    const base = bundle({
      pages: [manual, document, foreign, deep, removed, owned],
      memories: [{ memoryId: 'memory-manual', spaceId: 'space-1', key: 'manual', value: 'keep', scope: 'space', artifactIds: ['manual-memory'], contentHash: 'memory-hash', updatedAt: '2026-08-19T00:00:00.000Z' }],
      relations: [
        { relationId: 'relation-owned', spaceId: 'space-1', sourceId: 'page-owned', targetId: 'page-document', relationType: 'uses', artifactIds: ['relation-old'], metadata: { ownership: { producer: 'agentwiki-codegraph-generated', sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'c'.repeat(64), logicalKey: 'relations/owned' } } },
        { relationId: 'relation-manual', spaceId: 'space-1', sourceId: 'page-manual', targetId: 'page-document', relationType: 'links', artifactIds: ['relation-manual'] },
      ],
      provenance: [
        { itemId: 'page-owned', artifactIds: ['old-owned'], sensitivity: 'shareable' },
        { itemId: 'page-removed', artifactIds: ['old-removed'], sensitivity: 'shareable' },
        { itemId: 'page-deep', artifactIds: ['old-deep'], sensitivity: 'shareable' },
        { itemId: 'page-foreign', artifactIds: ['old-foreign'], sensitivity: 'shareable' },
        { itemId: 'page-document', artifactIds: ['old-document'], sensitivity: 'shareable' },
        { itemId: 'page-manual', artifactIds: ['old-manual'], sensitivity: 'shareable' },
        { itemId: 'memory-manual', artifactIds: ['manual-memory'], sensitivity: 'shareable' },
        { itemId: 'relation-owned', artifactIds: ['relation-old'], sensitivity: 'shareable' },
        { itemId: 'relation-manual', artifactIds: ['relation-manual'], sensitivity: 'shareable' },
      ],
    });
    const generated = bundle({
      baseRevision: 'not-authoritative',
      pages: [page('page-owned', { body: 'new base content', contentHash: 'new-owned', metadata: { sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'new' } })],
      relations: [{ relationId: 'relation-owned', spaceId: 'space-1', sourceId: 'page-owned', targetId: 'page-document', relationType: 'uses', artifactIds: ['relation-new'], metadata: { ownership: { producer: 'agentwiki-codegraph-generated', sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'd'.repeat(64), logicalKey: 'relations/owned' } } }],
      provenance: [
        { itemId: 'page-owned', artifactIds: ['new-owned'], sensitivity: 'shareable' },
        { itemId: 'relation-owned', artifactIds: ['relation-new'], sensitivity: 'shareable' },
      ],
    });

    const result = reconcileAnalysisLayers(base, generated, standardScope);

    expect(result.bundle.baseRevision).toBe('revision-1');
    expect(result.bundle.pages.map((item) => item.pageId)).toEqual(['page-deep', 'page-document', 'page-foreign', 'page-manual', 'page-owned']);
    expect(result.bundle.pages.find((item) => item.pageId === 'page-deep')).toEqual(deep);
    expect(result.bundle.memories.map((item) => item.memoryId)).toEqual(['memory-manual']);
    expect(result.bundle.relations.map((item) => item.relationId)).toEqual(['relation-manual', 'relation-owned']);
    expect(result.bundle.provenance.map((item) => item.itemId)).toEqual(['memory-manual', 'page-deep', 'page-document', 'page-foreign', 'page-manual', 'page-owned', 'relation-manual', 'relation-owned']);
    expect(result.bundle.deletions).toEqual([{ deletionId: 'del-page-removed', itemType: 'page', itemId: 'page-removed', reason: 'CodeGraph base analysis is no longer generated for this source' }]);
    expect(result).toMatchObject({ added: 0, modified: 2, deleted: 1, carried: 6 });
  });

  it('retains an unowned retired-looking tuple and emits only an opaque migration-candidate warning', () => {
    const legacy = page('legacy-overview', { path: 'code/architecture/overview.md', title: 'Codebase architecture' });
    const nodeLegacy = page('legacy-node', { metadata: { node: { qualified_name: 'core.auth.login', label: 'function', file_path: 'src/auth.ts' } } });
    const similarManual = page('manual-lookalike', { path: 'docs/architecture-overview.md', title: 'Codebase architecture' });
    const base = bundle({
      pages: [similarManual, nodeLegacy, legacy],
      provenance: [
        { itemId: 'legacy-overview', artifactIds: ['legacy'], sensitivity: 'shareable' },
        { itemId: 'legacy-node', artifactIds: ['legacy-node'], sensitivity: 'shareable' },
        { itemId: 'manual-lookalike', artifactIds: ['manual'], sensitivity: 'shareable' },
      ],
    });
    const generated = bundle({
      pages: [page('codegraph-overview', { path: 'code/codegraph/architecture/overview.md', title: 'Repository overview', metadata: { sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'new' } })],
      provenance: [{ itemId: 'codegraph-overview', artifactIds: ['codegraph'], sensitivity: 'shareable' }],
    });

    const result = reconcileAnalysisLayers(base, generated, standardScope);

    expect(result.bundle.pages.map((item) => item.pageId)).toEqual(['codegraph-overview', 'legacy-node', 'legacy-overview', 'manual-lookalike']);
    expect(result.bundle.deletions).toHaveLength(0);
    expect(result.warnings).toEqual(['Legacy migration candidate retained: legacy-211c317b3972']);
    expect(result.warnings.join('\n')).not.toContain('Codebase architecture');
    expect(result.warnings.join('\n')).not.toContain('code/architecture/overview.md');
    expect(result).toMatchObject({ added: 1, modified: 0, deleted: 0, carried: 3 });
  });

  it('never treats the retired-looking tuple as ownership for CodeGraph, manual, deep, or foreign pages', () => {
    const legacy = (pageId: string, metadata?: WikiPage['metadata']) => page(pageId, {
      path: 'code/architecture/overview.md', title: 'Codebase architecture', metadata,
    });
    const codegraph = legacy('legacy-codegraph', { sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'old' });
    const manual = legacy('legacy-manual');
    const deep = legacy('legacy-deep', { sourceKey: SOURCE_A, analysisLayer: 'deep', snapshotHash: 'old' });
    const foreign = legacy('legacy-foreign', { sourceKey: SOURCE_B, analysisLayer: 'base', snapshotHash: 'old' });
    const result = reconcileAnalysisLayers(
      bundle({
        pages: [codegraph, manual, deep, foreign],
        provenance: [codegraph, manual, deep, foreign].map((item) => ({ itemId: item.pageId, artifactIds: [item.pageId], sensitivity: 'shareable' as const })),
      }),
      bundle(),
      standardScope,
    );

    expect(result.bundle.pages.map((item) => item.pageId)).toEqual(['legacy-codegraph', 'legacy-deep', 'legacy-foreign', 'legacy-manual']);
    expect(result.bundle.deletions).toEqual([]);
    expect(result.warnings).toHaveLength(4);
    expect(result.warnings.every((warning) => /^Legacy migration candidate retained: legacy-[a-f0-9]{12}$/u.test(warning))).toBe(true);
  });

  it('retains stale deep content byte-for-byte with a logical-module warning and never deletes it', () => {
    const deep = page('deep-page', {
      body: 'exact\n\nold deep bytes\n',
      metadata: { sourceKey: SOURCE_A, analysisLayer: 'deep', snapshotHash: 'old', logicalKey: 'modules/auth' },
    });
    const result = reconcileAnalysisLayers(
      bundle({ pages: [deep], provenance: [{ itemId: 'deep-page', artifactIds: ['deep'], sensitivity: 'shareable' }] }),
      bundle({
        pages: [page('new-base', { metadata: { sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'new' } })],
        provenance: [{ itemId: 'new-base', artifactIds: ['new-base'], sensitivity: 'shareable' }],
      }),
      standardScope,
    );

    expect(result.bundle.pages.find((item) => item.pageId === 'deep-page')).toEqual(deep);
    expect(result.bundle.deletions).toEqual([]);
    expect(result.warnings).toEqual([expect.stringMatching(/^Stale deep CodeGraph analysis retained for deep-[a-f0-9]{12}$/u)]);
    expect(result.warnings.join('\n')).not.toContain('/private/');
  });

  it('updates current documents but carries unrelated documents while replacing current CodeGraph base output', () => {
    const owned = page('code-owned', { body: 'old code', metadata: { sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'old' } });
    const document = page('document-current', { path: 'docs/current.md', body: 'old document' });
    const unrelated = page('document-unrelated', { path: 'docs/unrelated.md', body: 'keep document' });
    const base = bundle({ pages: [owned, document, unrelated], provenance: ['code-owned', 'document-current', 'document-unrelated'].map((itemId) => ({ itemId, artifactIds: [`old:${itemId}`], sensitivity: 'shareable' as const })) });
    const generated = bundle({
      pages: [
        page('code-owned', { body: 'new code', contentHash: 'new-code', metadata: { sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'new' } }),
        page('document-current', { path: 'docs/current.md', body: 'new document', contentHash: 'new-document' }),
        page('document-new', { path: 'docs/new.md', body: 'new document' }),
      ],
      provenance: ['code-owned', 'document-current', 'document-new'].map((itemId) => ({ itemId, artifactIds: [`new:${itemId}`], sensitivity: 'shareable' as const })),
    });
    const result = reconcileAnalysisLayers(base, generated, standardScope);
    expect(result.bundle.pages.find((item) => item.pageId === 'document-current')?.body).toBe('new document');
    expect(result.bundle.pages.find((item) => item.pageId === 'document-unrelated')?.body).toBe('keep document');
    expect(result.bundle.pages.find((item) => item.pageId === 'code-owned')?.body).toBe('new code');
  });

  it('owns base memories only through strict generated ownership and keeps deep or manual memories', () => {
    const base = bundle({
      memories: [
        { memoryId: 'memory-base', spaceId: 'space-1', key: 'base', value: 'old', scope: 'space', artifactIds: ['old-base'], contentHash: 'old-base', updatedAt: '2026-08-19T00:00:00.000Z', ownership: { producer: 'agentwiki-codegraph-generated', sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'c'.repeat(64), logicalKey: 'memories/base' } },
        { memoryId: 'memory-deep', spaceId: 'space-1', key: 'deep', value: 'deep bytes', scope: 'space', artifactIds: ['old-deep'], contentHash: 'old-deep', updatedAt: '2026-08-19T00:00:00.000Z', ownership: { producer: 'agentwiki-codegraph-generated', sourceKey: SOURCE_A, analysisLayer: 'deep', snapshotHash: 'c'.repeat(64), logicalKey: 'memories/deep' } },
        { memoryId: 'memory-manual', spaceId: 'space-1', key: 'manual', value: 'manual', scope: 'space', artifactIds: ['manual'], contentHash: 'manual', updatedAt: '2026-08-19T00:00:00.000Z' },
      ],
      provenance: ['memory-base', 'memory-deep', 'memory-manual'].map((itemId) => ({ itemId, artifactIds: [itemId], sensitivity: 'shareable' as const })),
    } as KnowledgeBundle);
    const generated = bundle({
      memories: [{ memoryId: 'memory-base', spaceId: 'space-1', key: 'base', value: 'new', scope: 'space', artifactIds: ['new-base'], contentHash: 'new-base', updatedAt: '2026-08-19T00:00:00.000Z', ownership: { producer: 'agentwiki-codegraph-generated', sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'd'.repeat(64), logicalKey: 'memories/base' } }],
      provenance: [{ itemId: 'memory-base', artifactIds: ['new-base'], sensitivity: 'shareable' }],
    } as KnowledgeBundle);
    const result = reconcileAnalysisLayers(base, generated, standardScope);
    expect(result.bundle.memories.map((item) => [item.memoryId, item.value])).toEqual([['memory-base', 'new'], ['memory-deep', 'deep bytes'], ['memory-manual', 'manual']]);
  });

  it.each(['module:/private/repo', 'file:///private/repo', 'C:\\repo\\module', 'module-/private/repo'])('redacts unsafe deep logical key %s from warnings', (logicalKey) => {
    const deep = page('deep-warning', { metadata: { sourceKey: SOURCE_A, analysisLayer: 'deep', snapshotHash: 'old', logicalKey } });
    const result = reconcileAnalysisLayers(bundle({ pages: [deep], provenance: [{ itemId: 'deep-warning', artifactIds: ['deep'], sensitivity: 'shareable' }] }), bundle({ pages: [page('fresh', { metadata: { sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'new' } })] }), standardScope);
    expect(result.warnings.join('\n')).not.toContain(logicalKey);
    expect(result.warnings.join('\n')).not.toMatch(/private|C:\\|file:/i);
  });

  it('is permutation-stable for identical duplicates and fails closed for conflicting canonical IDs', () => {
    const duplicate = page('duplicate', { metadata: { sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'old' } });
    const first = reconcileAnalysisLayers(bundle({ pages: [duplicate, { ...duplicate }] }), bundle(), standardScope);
    const second = reconcileAnalysisLayers(bundle({ pages: [{ ...duplicate }, duplicate] }), bundle(), standardScope);
    expect(second.bundle).toEqual(first.bundle);
    expect(() => reconcileAnalysisLayers(bundle({ pages: [duplicate, { ...duplicate, body: 'conflict' }] }), bundle(), standardScope)).toThrow('Conflicting knowledge item ID duplicate');
  });

  it('treats incomplete or wrong-producer page and relation metadata as manual knowledge', () => {
    const incomplete = page('manual-looking-code', { metadata: { sourceKey: SOURCE_A, analysisLayer: 'base' } });
    const relation = { relationId: 'manual-relation', spaceId: 'space-1', sourceId: 'manual-looking-code', targetId: 'other', relationType: 'links', artifactIds: ['manual-relation'], metadata: { sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'a'.repeat(64), logicalKey: 'modules/x', producer: 'manual' } };
    const other = page('other');
    const result = reconcileAnalysisLayers(bundle({ pages: [incomplete, other], relations: [relation], provenance: [{ itemId: incomplete.pageId, artifactIds: ['manual'], sensitivity: 'shareable' }, { itemId: other.pageId, artifactIds: ['other'], sensitivity: 'shareable' }, { itemId: relation.relationId, artifactIds: ['manual-relation'], sensitivity: 'shareable' }] }), bundle(), standardScope);
    expect(result.bundle.pages.map((item) => item.pageId)).toContain('manual-looking-code');
    expect(result.bundle.relations.map((item) => item.relationId)).toContain('manual-relation');
    expect(result.bundle.deletions).toEqual([]);
  });

  it('fails closed for empty or malformed ownership scope source keys', () => {
    expect(() => reconcileAnalysisLayers(bundle(), bundle(), { ...standardScope, sourceKeys: new Set() })).toThrow('CodeGraph source scope is required');
    expect(() => reconcileAnalysisLayers(bundle(), bundle(), { ...standardScope, sourceKeys: new Set(['not-a-hash']) })).toThrow('Invalid CodeGraph source key');
    expect(() => reconcileAnalysisLayers(bundle(), bundle(), { ...standardScope, sourceKeys: new Set([SOURCE_A, '']) })).toThrow('Invalid CodeGraph source key');
    expect(() => reconcileAnalysisLayers(bundle(), bundle(), { ...standardScope, sourceKeys: new Set([SOURCE_A, 'not-a-hash']) })).toThrow('Invalid CodeGraph source key');
  });

  it.each(['module-/Users/alice/repo', 'file:///var/tmp/x', '/opt/workspace', 'C:\\workspace\\x'])('never echoes path-like deep labels: %s', (logicalKey) => {
    const deep = page('deep-opaque', { metadata: { sourceKey: SOURCE_A, analysisLayer: 'deep', snapshotHash: 'old', logicalKey } });
    const result = reconcileAnalysisLayers(bundle({ pages: [deep], provenance: [{ itemId: deep.pageId, artifactIds: ['deep'], sensitivity: 'shareable' }] }), bundle({ pages: [page('new-base-opaque', { metadata: { sourceKey: SOURCE_A, analysisLayer: 'base', snapshotHash: 'new' } })] }), standardScope);
    expect(result.warnings.join('\n')).not.toContain(logicalKey);
    expect(result.warnings.join('\n')).not.toMatch(/Users|var|opt|workspace|file:|C:/i);
  });
});
