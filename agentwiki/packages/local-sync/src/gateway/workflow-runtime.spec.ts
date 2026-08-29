import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SourceAdapter } from '../protocol/adapter.js';
import { assertKnowledgeBundle } from '../protocol/bundle.js';
import type { SourceArtifact } from '../protocol/artifact.js';
import { createKnowledgeWorkflowRuntime } from './workflow-runtime.js';
import { workspacePaths, ensureWorkspace, writeManifest, writeBase } from '../workspace/index.js';
import type { LocalScanPlan } from '../codegraph/contracts.js';
import { CodeGraphPipeline } from '../codegraph/pipeline.js';
import type { CodeGraphProvider, ConfirmedCodeSnapshot } from '../codegraph/provider.js';
import { normalizeCodeGraphFiles } from '../codegraph/normalizer.js';
import { analyzeBaseKnowledge, type GeneratedKnowledgeDocument } from '../codegraph/base-analyzer.js';
import { pageId } from '../utils/id.js';

const runtimeEvents = vi.hoisted(() => ({ events: null as string[] | null, organized: null as { bundle: import('../protocol/bundle.js').KnowledgeBundle; provenance: import('../protocol/bundle.js').BundleProvenance[] } | null }));

vi.mock('../organize/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../organize/index.js')>();
  return {
    ...actual,
    organizeArtifacts: (...args: Parameters<typeof actual.organizeArtifacts>) => {
      runtimeEvents.events?.push('organize');
      return runtimeEvents.organized ?? actual.organizeArtifacts(...args);
    },
    validateKnowledgeBundle: (...args: Parameters<typeof actual.validateKnowledgeBundle>) => {
      runtimeEvents.events?.push('validate bundle');
      return actual.validateKnowledgeBundle(...args);
    },
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (runtimeEvents.events !== null && String(args[0]).includes('/runtime/previews/')) runtimeEvents.events.push('save preview');
      return actual.writeFile(...args);
    },
  };
});

const homes: string[] = [];

async function temporaryHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'aw-workflow-runtime-'));
  homes.push(home);
  return home;
}

function artifact(kind: 'code' | 'document', logicalKey: string): SourceArtifact {
  return {
    artifactId: `${kind}-${logicalKey}`,
    adapterId: kind === 'code' ? 'agentwiki-codegraph-generated' : 'markitdown',
    adapterVersion: '1.0.0',
    sourceId: `source-${kind}`,
    logicalKey,
    contentHash: `hash-${logicalKey}`,
    updatedAt: '2026-08-11T00:00:00.000Z',
    kind,
    content: { title: logicalKey, body: `# ${logicalKey}` },
    evidence: [{ evidenceId: `e-${logicalKey}`, sourceUri: `test://${logicalKey}`, sourceHash: `hash-${logicalKey}` }],
    sensitivity: 'shareable',
  };
}

function adapter(kind: 'code' | 'document'): SourceAdapter {
  return {
    manifest: () => ({
      adapterId: kind === 'code' ? 'agentwiki-codegraph-generated' : 'markitdown',
      version: '1.0.0', protocolVersion: '1.0', inputKinds: ['directory'], artifactKinds: [kind],
      supportsIncremental: true, permissions: ['read-source-path'], runtime: { kind: 'future' },
    }),
    inspect: vi.fn(async (input) => ({
      adapterId: kind === 'code' ? 'agentwiki-codegraph-generated' : 'markitdown', sourcePath: input.sourcePath,
      displayName: input.sourcePath,
      kind: kind === 'code' ? ('code' as const) : ('documents' as const),
      estimatedArtifacts: 1,
      sourceHash: `hash-${kind}`,
    })),
    collect: vi.fn(async (input) => ({ artifacts: [artifact(kind, `${kind}-${input.sourcePath.split('/').pop()}`)], hasMore: false })),
  };
}

function localScanPlan(hash = 'a'.repeat(64)): LocalScanPlan {
  return {
    schemaVersion: 'agentwiki-local-scan-plan@1', provider: 'codegraph', executableIdentity: '/codegraph', detectedVersion: '1.5.0',
    capabilities: { required: { 'index.status': true, 'index.sync': true, 'files.list': true }, optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false } },
    analysisMode: 'standard', sources: [{ sourceKey: 'a'.repeat(64), displayPath: 'source', canonicalSourcePath: '/private/source', indexPath: '/private/source/.codegraph', action: 'sync', indexState: 'stale', estimatedFiles: 1 }],
    limits: { maxFiles: 10, maxGeneratedBytes: 10_000 }, localScanPlanHash: hash,
  };
}

function documentOnlyPipeline() {
  return { plan: vi.fn(async () => null), collect: vi.fn() };
}

function codePipeline(artifacts: SourceArtifact[]) {
  const plan = localScanPlan();
  return {
    plan: vi.fn(async () => plan),
    collect: vi.fn(async (input: { localScanPlanHash: string }) => {
      if (input.localScanPlanHash !== plan.localScanPlanHash) {
        throw Object.assign(new Error('stale plan'), { code: 'CODEGRAPH_SCAN_PLAN_CHANGED' });
      }
      return { artifacts, sourceKeys: [plan.sources[0]!.sourceKey], processedFiles: artifacts.length, warnings: [] };
    }),
  };
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
  runtimeEvents.events = null;
  runtimeEvents.organized = null;
});

describe('createKnowledgeWorkflowRuntime', () => {
  it('requires a matching explicit local scan confirmation before any code collection or remote call', async () => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    const plan = localScanPlan();
    const calls: string[] = [];
    const scanSources = {
      plan: vi.fn(async () => plan),
      collect: vi.fn(async (input: { localScanPlanHash: string }) => {
        if (input.localScanPlanHash !== plan.localScanPlanHash) throw Object.assign(new Error('stale plan'), { code: 'CODEGRAPH_SCAN_PLAN_CHANGED' });
        calls.push('init/sync');
        return { artifacts: [artifact('code', 'generated')], sourceKeys: [plan.sources[0]!.sourceKey], processedFiles: 1, warnings: [] };
      }),
    };
    const sync = { pull: vi.fn(async () => { calls.push('remote pull'); return { revisionId: '0' }; }), push: vi.fn(async () => { calls.push('remote push'); return { conflict: false, revisionId: 'rev-1', status: 'published' as const }; }) };
    const runtime = createKnowledgeWorkflowRuntime({ home, adapters: { ensure: vi.fn(async () => adapter('document')) }, scanSources, sync });

    for (const input of [
      { sourceType: 'code' as const },
      { sourceType: 'code' as const, confirmedLocalScan: false },
      { sourceType: 'code' as const, confirmedLocalScan: true },
      { sourceType: 'code' as const, confirmedLocalScan: true, localScanPlanHash: 'b'.repeat(64) },
    ]) {
      await expect(runtime.prepare({ spaceId: 'space-1', sourcePaths: [source], ...input })).rejects.toMatchObject({ code: input.localScanPlanHash ? 'CODEGRAPH_SCAN_PLAN_CHANGED' : 'CONFIRMATION_REQUIRED' });
    }
    expect(calls).toEqual([]);
  });

  it('rejects deep analysis without downgrading or touching local adapters or remote sync', async () => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    const calls: string[] = [];
    const runtime = createKnowledgeWorkflowRuntime({
      home, adapters: { ensure: vi.fn(async () => { calls.push('adapter'); return adapter('document'); }) },
      scanSources: { plan: vi.fn(async () => { calls.push('plan'); return localScanPlan(); }), collect: vi.fn(async () => { calls.push('collect'); return { artifacts: [], sourceKeys: [], processedFiles: 0, warnings: [] }; }) },
      sync: { pull: vi.fn(async () => { calls.push('remote'); return { revisionId: '0' }; }), push: vi.fn(async () => { calls.push('remote'); return { conflict: false, revisionId: '1' }; }) },
    });

    await expect(runtime.prepare({ spaceId: 'space-1', sourcePaths: [source], sourceType: 'code', analysisMode: 'deep' }))
      .rejects.toMatchObject({ code: 'CODEGRAPH_CAPABILITY_UNSUPPORTED', nextAction: 'deep analysis is not installed yet' });
    expect(calls).toEqual([]);
  });

  it('keeps document-only preparation on MarkItDown without a CodeGraph plan or confirmation', async () => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    await writeFile(join(source, 'README.md'), '# Documents only');
    const scanSources = { plan: vi.fn(async () => null), collect: vi.fn() };
    const runtime = createKnowledgeWorkflowRuntime({
      home, adapters: { ensure: vi.fn(async () => adapter('document')) }, scanSources,
      sync: { pull: vi.fn(async () => ({ revisionId: '0' })), push: vi.fn(async () => ({ conflict: false, revisionId: '1' })) },
    });

    const preview = await runtime.prepare({ spaceId: 'space-1', sourcePaths: [source], sourceType: 'documents' });
    expect(preview.summary.filesProcessed).toBe(1);
    expect(scanSources.plan).not.toHaveBeenCalled();
    expect(scanSources.collect).not.toHaveBeenCalled();
  });

  it('carries every unmatched base item during an empty documents-only preparation', async () => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    const spaceId = 'space-document-retention';
    const paths = workspacePaths(home, spaceId);
    const sourceKey = 'a'.repeat(64);
    await ensureWorkspace(paths);
    const pages = [
      { pageId: 'manual-page', spaceId, path: 'manual.md', title: 'Manual', body: 'manual', artifactIds: ['manual'], contentHash: 'manual', updatedAt: '2026-08-19T00:00:00.000Z' },
      { pageId: 'codegraph-base-page', spaceId, path: 'code/base.md', title: 'Base', body: 'base', artifactIds: ['base'], contentHash: 'base', updatedAt: '2026-08-19T00:00:00.000Z', metadata: { ownership: { producer: 'agentwiki-codegraph-generated', sourceKey, analysisLayer: 'base', snapshotHash: 'b'.repeat(64), logicalKey: 'architecture/base' } } },
      { pageId: 'codegraph-deep-page', spaceId, path: 'code/deep.md', title: 'Deep', body: 'deep', artifactIds: ['deep'], contentHash: 'deep', updatedAt: '2026-08-19T00:00:00.000Z', metadata: { ownership: { producer: 'agentwiki-codegraph-generated', sourceKey, analysisLayer: 'deep', snapshotHash: 'c'.repeat(64), logicalKey: 'architecture/deep' } } },
      { pageId: 'foreign-document-page', spaceId, path: 'foreign.md', title: 'Foreign', body: 'foreign', artifactIds: ['foreign'], contentHash: 'foreign', updatedAt: '2026-08-19T00:00:00.000Z' },
    ];
    const memory = { memoryId: 'manual-memory', spaceId, key: 'manual', value: 'retain', scope: 'space' as const, artifactIds: ['manual-memory'], contentHash: 'manual-memory', updatedAt: '2026-08-19T00:00:00.000Z' };
    const relation = { relationId: 'manual-relation', spaceId, sourceId: 'manual-page', targetId: 'foreign-document-page', relationType: 'links', artifactIds: ['manual-relation'] };
    await writeBase(paths, 'rev-1', {
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'unified-knowledge@1', spaceId, baseRevision: 'rev-1',
      pages, memories: [memory], relations: [relation],
      provenance: [...pages.map((page) => ({ itemId: page.pageId, artifactIds: page.artifactIds, sensitivity: 'shareable' as const })), { itemId: memory.memoryId, artifactIds: memory.artifactIds, sensitivity: 'shareable' as const }, { itemId: relation.relationId, artifactIds: relation.artifactIds, sensitivity: 'shareable' as const }],
      deletions: [],
    });
    await writeManifest(paths, { schemaVersion: '1.0', spaceId, createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z', baseRevision: { revision: 'rev-1', contentHash: 'h1', pulledAt: '2026-08-19T00:00:00.000Z' }, pendingRevision: null, sources: [], checkpoints: [] });
    const runtime = createKnowledgeWorkflowRuntime({ home, adapters: { ensure: vi.fn(async () => adapter('document')) }, scanSources: documentOnlyPipeline(), sync: { pull: vi.fn(), push: vi.fn() } });

    const preview = await runtime.prepare({ spaceId, sourcePaths: [source], sourceType: 'documents' });
    const stored = JSON.parse(await readFile(join(home, '.agentwiki', 'runtime', 'previews', `${preview.jobId}.json`), 'utf8')) as { data: { pages: Array<{ pageId: string }>; memories: Array<{ memoryId: string }>; relations: Array<{ relationId: string }>; provenance: Array<{ itemId: string }>; deletions: unknown[] } };

    expect(preview.diff).toMatchObject({ added: 0, modified: 0, deleted: 0 });
    expect(stored.data.pages.map((item) => item.pageId)).toEqual(pages.map((page) => page.pageId).sort());
    expect(stored.data.memories.map((item) => item.memoryId)).toEqual([memory.memoryId]);
    expect(stored.data.relations.map((item) => item.relationId)).toEqual([relation.relationId]);
    expect(stored.data.provenance.map((item) => item.itemId)).toEqual([...pages.map((page) => page.pageId), memory.memoryId, relation.relationId].sort());
    expect(stored.data.deletions).toEqual([]);
  });

  it('projects a private v2 tree base into preparation while retaining each stable Page path', async () => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    const spaceId = 'space-tree-base';
    const paths = workspacePaths(home, spaceId);
    await ensureWorkspace(paths);
    await writeBase(paths, 'rev-1', {
      protocolVersion: '2', spaceId,
      folders: [{ folderId: 'folder-1', parentFolderId: null, name: 'Folder', path: 'pages/Folder', sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z' }],
      pages: [{ pageId: 'page-1', folderId: 'folder-1', path: 'pages/Folder/Page.md', title: 'Page', body: 'retained tree body', contentHash: 'a'.repeat(64), updatedAt: '2026-08-29T00:00:00.000Z' }],
    });
    await writeManifest(paths, {
      schemaVersion: '1.0', spaceId, createdAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-29T00:00:00.000Z',
      baseRevision: { revision: 'rev-1', contentHash: 'b'.repeat(64), pulledAt: '2026-08-29T00:00:00.000Z' },
      pendingRevision: null, sources: [], checkpoints: [],
    });
    const runtime = createKnowledgeWorkflowRuntime({
      home,
      adapters: { ensure: vi.fn(async () => adapter('document')) },
      scanSources: documentOnlyPipeline(),
      sync: { pull: vi.fn(), push: vi.fn() },
    });

    const preview = await runtime.prepare({ spaceId, sourcePaths: [source], sourceType: 'documents' });
    const stored = JSON.parse(await readFile(join(home, '.agentwiki', 'runtime', 'previews', `${preview.jobId}.json`), 'utf8')) as {
      data: { pages: Array<{ pageId: string; path: string; body: string }> };
    };

    expect(stored.data.pages).toEqual([
      expect.objectContaining({ pageId: 'page-1', path: 'pages/Folder/Page.md', body: 'retained tree body' }),
    ]);
  });

  it.each(['missing', 'malformed', 'incomplete'] as const)('fails closed without a preview when the confirmed documents base is %s', async (state) => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    const spaceId = `space-documents-base-${state}`;
    const paths = workspacePaths(home, spaceId);
    await ensureWorkspace(paths);
    await writeManifest(paths, { schemaVersion: '1.0', spaceId, createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z', baseRevision: { revision: 'rev-1', contentHash: 'h1', pulledAt: '2026-08-19T00:00:00.000Z' }, pendingRevision: null, sources: [], checkpoints: [] });
    if (state === 'malformed') await writeFile(join(paths.baseDir, 'rev-1.json'), '{ malformed /private/sentinel');
    if (state === 'incomplete') await writeBase(paths, 'rev-1', { schemaVersion: 'knowledge-bundle@1', spaceId, pages: [] });
    const sync = { pull: vi.fn(), push: vi.fn() };
    const runtime = createKnowledgeWorkflowRuntime({ home, adapters: { ensure: vi.fn(async () => adapter('document')) }, scanSources: documentOnlyPipeline(), sync });

    let failure: unknown;
    try {
      await runtime.prepare({ spaceId, sourcePaths: [source], sourceType: 'documents' });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'SCAN_FAILED', message: 'confirmed base bundle is unavailable' });
    expect(JSON.stringify(failure)).not.toContain('/private/sentinel');
    await expect(readdir(join(home, '.agentwiki', 'runtime', 'previews'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(sync.pull).not.toHaveBeenCalled();
    expect(sync.push).not.toHaveBeenCalled();
  });

  it('fails closed without a preview when the confirmed code-bearing base is missing', async () => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    const spaceId = 'space-code-base-missing';
    const paths = workspacePaths(home, spaceId);
    await ensureWorkspace(paths);
    await writeManifest(paths, { schemaVersion: '1.0', spaceId, createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z', baseRevision: { revision: 'rev-1', contentHash: 'h1', pulledAt: '2026-08-19T00:00:00.000Z' }, pendingRevision: null, sources: [], checkpoints: [] });
    const sync = { pull: vi.fn(), push: vi.fn() };
    const runtime = createKnowledgeWorkflowRuntime({ home, adapters: { ensure: vi.fn(), }, scanSources: codePipeline([artifact('code', 'current')]), sync });

    await expect(runtime.prepare({ spaceId, sourcePaths: [source], sourceType: 'code', confirmedLocalScan: true, localScanPlanHash: 'a'.repeat(64) }))
      .rejects.toMatchObject({ code: 'SCAN_FAILED', message: 'confirmed base bundle is unavailable' });
    await expect(readdir(join(home, '.agentwiki', 'runtime', 'previews'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(sync.pull).not.toHaveBeenCalled();
    expect(sync.push).not.toHaveBeenCalled();
  });

  it('requires a code plan for mixed auto input before collecting generated code and MarkItDown documents', async () => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    await writeFile(join(source, 'README.md'), '# Mixed');
    await writeFile(join(source, 'main.ts'), 'export {};');
    const plan = localScanPlan();
    const scanSources = { plan: vi.fn(async () => plan), collect: vi.fn(async () => ({ artifacts: [artifact('code', 'generated')], sourceKeys: [plan.sources[0]!.sourceKey], processedFiles: 1, warnings: [] })) };
    const runtime = createKnowledgeWorkflowRuntime({
      home, adapters: { ensure: vi.fn(async () => adapter('document')) }, scanSources,
      sync: { pull: vi.fn(async () => ({ revisionId: '0' })), push: vi.fn(async () => ({ conflict: false, revisionId: '1' })) },
    });

    await expect(runtime.prepare({ spaceId: 'space-1', sourcePaths: [source], sourceType: 'auto' })).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const preview = await runtime.prepare({ spaceId: 'space-1', sourcePaths: [source], sourceType: 'auto', confirmedLocalScan: true, localScanPlanHash: plan.localScanPlanHash });
    expect(preview.summary.filesProcessed).toBe(2);
    expect(scanSources.collect).toHaveBeenCalledTimes(1);
  });

  it('collects code and documents locally, persists a valid bundle, then pulls before push', async () => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    await writeFile(join(source, 'README.md'), '# Runtime fixture');
    const adapters = {
      ensure: vi.fn(async (id: string) => adapter(id === 'agentwiki-codegraph-generated' ? 'code' : 'document')),
    };
    const calls: string[] = [];
    const sync = {
      pull: vi.fn(async (spaceId: string) => { calls.push(`pull:${spaceId}`); return { revisionId: '0' }; }),
      push: vi.fn(async (spaceId: string, value: unknown) => {
        calls.push(`push:${spaceId}`);
        assertKnowledgeBundle(value);
        return { conflict: false, revisionId: 'rev-1', status: 'published' as const, submissionId: 'sub-1' };
      }),
    };

    const first = createKnowledgeWorkflowRuntime({ home, adapters, scanSources: documentOnlyPipeline(), sync, now: () => new Date('2026-08-11T00:00:00.000Z') });
    const preview = await first.prepare({ spaceId: 'space-1', sourcePaths: [source], sourceType: 'documents' });

    expect(preview.summary.filesProcessed).toBe(1);
    expect(preview.summary).toMatchObject({ added: 1, modified: 0, deleted: 0 });
    expect(preview.summary.uploadBytes).toBeGreaterThan(0);
    expect(adapters.ensure).not.toHaveBeenCalledWith('markitdown');
    expect(calls).toEqual([]);

    const resumed = createKnowledgeWorkflowRuntime({ home, adapters, scanSources: documentOnlyPipeline(), sync, now: () => new Date('2026-08-11T00:00:00.000Z') });
    const result = await resumed.confirmAndSync({ jobId: preview.jobId, previewHash: preview.previewHash, confirmed: true });

    expect(result).toMatchObject({ revisionId: 'rev-1', status: 'published', submissionId: 'sub-1' });
    expect(calls).toEqual(['pull:space-1', 'push:space-1']);
  });

  it('runs two sources through the real pipeline, organizer, validator, and private preview in a stable local order', async () => {
    const home = await temporaryHome();
    const sourcePaths = ['/private/second', '/private/first'];
    const sourceKeys = ['a'.repeat(64), 'c'.repeat(64)];
    const events: string[] = [];
    runtimeEvents.events = events;
    const plans = new Map<string, LocalScanPlan>();
    const snapshots = new Map(sourceKeys.map((key, index) => [key, normalizeCodeGraphFiles([{ path: `src/service-${index}.ts`, language: 'typescript', nodeCount: 1, sizeBytes: 10 }], {
      sourceKey: key, sourceRoot: `/private/${index}`, scanner: { provider: 'codegraph' as const, detectedVersion: '1.5.0', capabilities: localScanPlan().capabilities }, indexedAt: '2026-08-19T00:00:00.000Z', maxFiles: 10, maxGeneratedBytes: 10_000,
    })]));
    let planCalls = 0;
    let snapshotReads = 0;
    let analysisRuns = 0;
    const provider = {
      plan: async (input: { sourcePaths: string[] }) => {
        const sources = input.sourcePaths.map((path) => ({ sourceKey: path.endsWith('first') ? sourceKeys[0]! : sourceKeys[1]!, displayPath: path.split('/').at(-1)!, canonicalSourcePath: path, indexPath: `${path}/.codegraph`, action: 'sync' as const, indexState: 'stale' as const, estimatedFiles: 1 }));
        const plan = { ...localScanPlan('d'.repeat(64)), sources };
        plans.set(input.sourcePaths.join('\n'), plan);
        if (++planCalls % 2 === 0) events.push('plan');
        return plan;
      },
      withConfirmedSnapshots: async <T>(plan: LocalScanPlan, consume: (snapshots: readonly ConfirmedCodeSnapshot[]) => Promise<T>): Promise<T> => {
        events.push('validate', 'execute');
        const confirmed = plan.sources.map((source) => {
          const snapshot = snapshots.get(source.sourceKey)!;
          if (++snapshotReads % 2 === 0) events.push('snapshot/normalize');
          return { sourceKey: source.sourceKey, snapshotHash: snapshot.manifest.snapshotHash, files: 1, snapshot };
        });
        return consume(confirmed);
      },
    } as unknown as CodeGraphProvider;
    const documents = new Map<string, GeneratedKnowledgeDocument[]>();
    const pipeline = new CodeGraphPipeline({
      home,
      provider,
      generatedStore: {
        writeBase: async (sourceKey, _snapshotHash, value) => { documents.set(sourceKey, value); },
        withPublishedBatch: async (keys, consume) => {
          events.push('batch publish');
          const artifacts = await consume([...keys].sort().map((key) => ({ manifest: {} as never, documents: documents.get(key)! })));
          events.push('adapter');
          return artifacts;
        },
      },
      analyze: (snapshot, options) => {
        const analyzed = analyzeBaseKnowledge(snapshot, options);
        if (++analysisRuns % 2 === 0) events.push('analyze all');
        return analyzed;
      },
    });
    const sync = { pull: vi.fn(async () => ({ revisionId: '0' })), push: vi.fn(async () => ({ conflict: false, revisionId: '1' })) };
    const runtime = createKnowledgeWorkflowRuntime({ home, adapters: { ensure: vi.fn(async () => adapter('document')) }, scanSources: pipeline, sync, now: () => new Date('2026-08-19T00:00:00.000Z') });
    const firstPlan = await pipeline.plan({ sourcePaths, sourceType: 'code', analysisMode: 'standard' });
    const preview = await runtime.prepare({ spaceId: 'space-1', sourcePaths, sourceType: 'code', analysisMode: 'standard', confirmedLocalScan: true, localScanPlanHash: firstPlan!.localScanPlanHash });
    expect(events).toEqual(['plan', 'validate', 'execute', 'snapshot/normalize', 'analyze all', 'batch publish', 'adapter', 'organize', 'validate bundle', 'save preview']);
    expect(sync.pull).not.toHaveBeenCalled();
    expect(sync.push).not.toHaveBeenCalled();
    const firstBundle = JSON.parse(await readFile(join(home, '.agentwiki', 'runtime', 'previews', `${preview.jobId}.json`), 'utf8')) as { data: { pages: Array<{ pageId: string; path: string }> } };
    expect(firstBundle.data.pages).toHaveLength(2);
    expect(new Set(firstBundle.data.pages.map((page) => page.pageId)).size).toBe(2);

    events.length = 0;
    const reversedPaths = [...sourcePaths].reverse();
    const secondPlan = await pipeline.plan({ sourcePaths: reversedPaths, sourceType: 'code', analysisMode: 'standard' });
    const repeated = await runtime.prepare({ spaceId: 'space-1', sourcePaths: reversedPaths, sourceType: 'code', analysisMode: 'standard', confirmedLocalScan: true, localScanPlanHash: secondPlan!.localScanPlanHash });
    const repeatedBundle = JSON.parse(await readFile(join(home, '.agentwiki', 'runtime', 'previews', `${repeated.jobId}.json`), 'utf8')) as { data: { pages: Array<{ pageId: string; path: string }> } };
    expect(repeatedBundle.data.pages).toEqual(firstBundle.data.pages);
  });

  it('skips artifacts whose content matches credential patterns and warns (DEF-005)', async () => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    const secretArtifact: SourceArtifact = {
      ...artifact('code', 'code-secret'),
      content: { title: 'code-secret', body: 'api_key=FAKE_TOKEN_3PT_DO_NOT_USE' },
    };
    const cleanArtifact = artifact('code', 'code-clean');
    const adapters = {
      ensure: vi.fn(async () => ({
        ...adapter('code'),
        collect: vi.fn(async () => ({ artifacts: [secretArtifact, cleanArtifact], hasMore: false })),
      })),
    };
    const sync = {
      pull: vi.fn(async () => ({ revisionId: '0' })),
      push: vi.fn(async () => ({ conflict: false, revisionId: 'rev-1', status: 'published' as const })),
    };

    const runtime = createKnowledgeWorkflowRuntime({ home, adapters, scanSources: codePipeline([secretArtifact, cleanArtifact]), sync });
    const preview = await runtime.prepare({ spaceId: 'space-1', sourcePaths: [source], sourceType: 'code', confirmedLocalScan: true, localScanPlanHash: 'a'.repeat(64) });

    expect(preview.summary.filesProcessed).toBe(2);
    expect(preview.warnings.some((w) => /credential/i.test(w))).toBe(true);
   expect(preview.warnings.some((w) => w.includes('code-secret'))).toBe(true);
  });

  it('keeps deep and manual knowledge while previewing CodeGraph migration deletions', async () => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    const spaceId = 'space-layered-preview';
    const paths = workspacePaths(home, spaceId);
    const sourceKey = 'a'.repeat(64);
    await ensureWorkspace(paths);
    const deepPage = {
      pageId: 'page-deep', spaceId, path: 'code/deep.md', title: 'Deep module', body: 'deep bytes\n\nremain exact\n',
      artifactIds: ['deep'], contentHash: 'deep-hash', updatedAt: '2026-08-11T00:00:00.000Z',
      metadata: { ownership: { producer: 'agentwiki-codegraph-generated', sourceKey, analysisLayer: 'deep', snapshotHash: 'c'.repeat(64), logicalKey: 'modules/auth' } },
    };
    const baseBundle = {
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'unified-knowledge@1', spaceId, baseRevision: 'rev-1',
      pages: [
        { pageId: 'legacy-overview', spaceId, path: 'code/architecture/overview.md', title: 'Codebase architecture', body: 'legacy', artifactIds: ['legacy'], contentHash: 'legacy-hash', updatedAt: '2026-08-11T00:00:00.000Z' },
        deepPage,
        { pageId: 'manual-overview', spaceId, path: 'docs/architecture.md', title: 'Codebase architecture', body: 'manual', artifactIds: ['manual'], contentHash: 'manual-hash', updatedAt: '2026-08-11T00:00:00.000Z' },
      ],
      memories: [], relations: [],
      provenance: [
        { itemId: 'legacy-overview', artifactIds: ['legacy'], sensitivity: 'shareable' as const },
        { itemId: 'page-deep', artifactIds: ['deep'], sensitivity: 'shareable' as const },
        { itemId: 'manual-overview', artifactIds: ['manual'], sensitivity: 'shareable' as const },
      ], deletions: [],
    };
    await writeBase(paths, 'rev-1', baseBundle);
    await writeManifest(paths, {
      schemaVersion: '1.0', spaceId, createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
      baseRevision: { revision: 'rev-1', contentHash: 'h1', pulledAt: '2026-08-11T00:00:00.000Z' },
      pendingRevision: null, sources: [], checkpoints: [],
    });
    const codegraphArtifact = {
      ...artifact('code', 'codegraph-overview'),
      content: {
        title: 'Repository overview', body: 'new base', metadata: {
          identityKey: `codegraph/architecture/overview@${sourceKey}`,
          ownership: { producer: 'agentwiki-codegraph-generated', sourceKey, analysisLayer: 'base', snapshotHash: 'd'.repeat(64), logicalKey: 'codegraph/architecture/overview' },
        },
      },
    };
    const sync = { pull: vi.fn(async () => ({ revisionId: 'rev-1' })), push: vi.fn(async () => ({ conflict: false, revisionId: 'rev-2', status: 'published' as const })) };
    const runtime = createKnowledgeWorkflowRuntime({ home, adapters: { ensure: vi.fn() }, scanSources: codePipeline([codegraphArtifact]), sync });

    const preview = await runtime.prepare({ spaceId, sourcePaths: [source], sourceType: 'code', confirmedLocalScan: true, localScanPlanHash: 'a'.repeat(64) });
    const stored = JSON.parse(await readFile(join(home, '.agentwiki', 'runtime', 'previews', `${preview.jobId}.json`), 'utf8')) as { data: { pages: Array<{ pageId: string; body: string }>; deletions: Array<{ itemId: string }> } };

    expect(stored.data.pages.find((item) => item.pageId === 'page-deep')?.body).toBe(deepPage.body);
    expect(stored.data.pages.map((item) => item.pageId)).toContain('manual-overview');
    expect(stored.data.pages.map((item) => item.pageId)).toContain('legacy-overview');
    expect(stored.data.deletions.map((item) => item.itemId)).not.toContain('legacy-overview');
    expect(preview.warnings).toContainEqual(expect.stringMatching(/^Stale deep CodeGraph analysis retained for deep-[a-f0-9]{12}$/u));
    expect(preview.diff).toMatchObject({ added: 1, deleted: 0 });
    expect(preview.summary.uploadBytes).toBeGreaterThan(0);
    expect(sync.pull).not.toHaveBeenCalled();
  });

  it('updates a current mixed document and CodeGraph base item while carrying an unrelated document', async () => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    const documentPath = join(source, 'README.md');
    await writeFile(documentPath, '# Current document');
    const spaceId = 'space-mixed-reconcile';
    const sourceKey = 'a'.repeat(64);
    const documentKey = 'README.md';
    const codeIdentity = `codegraph/architecture/overview@${sourceKey}`;
    const paths = workspacePaths(home, spaceId);
    await ensureWorkspace(paths);
    await writeBase(paths, 'rev-1', {
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'unified-knowledge@1', spaceId, baseRevision: 'rev-1',
      pages: [
        { pageId: pageId(spaceId, codeIdentity), spaceId, path: 'code/overview.md', title: 'Old code', body: 'old code', artifactIds: ['old-code'], contentHash: 'old-code', updatedAt: '2026-08-19T00:00:00.000Z', metadata: { ownership: { producer: 'agentwiki-codegraph-generated', sourceKey, analysisLayer: 'base', snapshotHash: 'c'.repeat(64), logicalKey: 'codegraph/architecture/overview' } } },
        { pageId: pageId(spaceId, documentKey), spaceId, path: 'docs/current.md', title: 'Current doc', body: 'old document', artifactIds: ['old-doc'], contentHash: 'old-doc', updatedAt: '2026-08-19T00:00:00.000Z' },
        { pageId: 'unrelated-doc', spaceId, path: 'docs/unrelated.md', title: 'Unrelated', body: 'carry', artifactIds: ['unrelated'], contentHash: 'unrelated', updatedAt: '2026-08-19T00:00:00.000Z' },
      ], memories: [], relations: [],
      provenance: [
        { itemId: pageId(spaceId, codeIdentity), artifactIds: ['old-code'], sensitivity: 'shareable' },
        { itemId: pageId(spaceId, documentKey), artifactIds: ['old-doc'], sensitivity: 'shareable' },
        { itemId: 'unrelated-doc', artifactIds: ['unrelated'], sensitivity: 'shareable' },
      ], deletions: [],
    });
    await writeManifest(paths, { schemaVersion: '1.0', spaceId, createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z', baseRevision: { revision: 'rev-1', contentHash: 'h1', pulledAt: '2026-08-19T00:00:00.000Z' }, pendingRevision: null, sources: [], checkpoints: [] });
    const generatedCode = { ...artifact('code', 'codegraph-overview'), content: { title: 'Repository overview', body: 'new code', metadata: { identityKey: codeIdentity, ownership: { producer: 'agentwiki-codegraph-generated', sourceKey, analysisLayer: 'base', snapshotHash: 'd'.repeat(64), logicalKey: 'codegraph/architecture/overview' } } } };
    const runtime = createKnowledgeWorkflowRuntime({ home, adapters: { ensure: vi.fn(async () => adapter('document')) }, scanSources: codePipeline([generatedCode]), sync: { pull: vi.fn(async () => ({ revisionId: 'rev-1' })), push: vi.fn(async () => ({ conflict: false, revisionId: 'rev-2' })) } });
    const preview = await runtime.prepare({ spaceId, sourcePaths: [source], sourceType: 'auto', confirmedLocalScan: true, localScanPlanHash: 'a'.repeat(64) });
    const stored = JSON.parse(await readFile(join(home, '.agentwiki', 'runtime', 'previews', `${preview.jobId}.json`), 'utf8')) as { data: { pages: Array<{ pageId: string; body: string }> } };
    expect(stored.data.pages.find((item) => item.pageId === pageId(spaceId, codeIdentity))?.body).toContain('new code');
    expect(stored.data.pages.find((item) => item.pageId === pageId(spaceId, documentKey))?.body).toContain('Current document');
    expect(stored.data.pages.find((item) => item.pageId === 'unrelated-doc')?.body).toBe('carry');
  });

  it('counts every initial page, memory, and relation in the preview diff', async () => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    const generated = artifact('code', 'initial');
    runtimeEvents.organized = {
      bundle: {
        schemaVersion: 'knowledge-bundle@1', recipeVersion: 'unified-knowledge@1', spaceId: 'space-initial', baseRevision: '0',
        pages: [{ pageId: 'initial-page', spaceId: 'space-initial', path: 'code/initial.md', title: 'Initial', body: 'page', artifactIds: [generated.artifactId], contentHash: 'page', updatedAt: '2026-08-19T00:00:00.000Z' }],
        memories: [{ memoryId: 'initial-memory', spaceId: 'space-initial', key: 'initial', value: 'memory', scope: 'space', artifactIds: [generated.artifactId], contentHash: 'memory', updatedAt: '2026-08-19T00:00:00.000Z' }],
        relations: [{ relationId: 'initial-relation', spaceId: 'space-initial', sourceId: 'initial-page', targetId: 'initial-memory', relationType: 'links', artifactIds: [generated.artifactId] }],
        provenance: ['initial-page', 'initial-memory', 'initial-relation'].map((itemId) => ({ itemId, artifactIds: [generated.artifactId], sensitivity: 'shareable' as const })), deletions: [],
      },
      provenance: [],
    };
    const runtime = createKnowledgeWorkflowRuntime({ home, adapters: { ensure: vi.fn() }, scanSources: codePipeline([generated]), sync: { pull: vi.fn(), push: vi.fn() } });
    const preview = await runtime.prepare({ spaceId: 'space-initial', sourcePaths: [source], sourceType: 'code', confirmedLocalScan: true, localScanPlanHash: 'a'.repeat(64) });
    expect(preview.diff).toEqual(expect.objectContaining({ added: 3, modified: 0, deleted: 0 }));
    expect(preview.summary.uploadBytes).toBeGreaterThan(0);
  });

  it('computes diff counts and generates deletion proposals for removed owned pages (DEF-003/004)', async () => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    const spaceId = 'space-diff';
    const paths = workspacePaths(home, spaceId);
    await ensureWorkspace(paths);
    const baseBundle = {
      schemaVersion: '1', recipeVersion: '1', spaceId, baseRevision: '0',
      pages: [{
        pageId: 'page-removed', spaceId, path: '/removed.md', title: 'Removed', body: 'gone',
        artifactIds: ['a1'], contentHash: 'h1', updatedAt: '2026-08-11T00:00:00.000Z', metadata: { ownership: { producer: 'agentwiki-codegraph-generated', sourceKey: 'a'.repeat(64), analysisLayer: 'base', snapshotHash: 'c'.repeat(64), logicalKey: 'codegraph/removed' } },
      }],
      memories: [], relations: [], provenance: [{ itemId: 'page-removed', artifactIds: ['a1'], sensitivity: 'shareable' as const }], deletions: [],
    };
    await writeBase(paths, 'rev-1', baseBundle);
    await writeManifest(paths, {
      schemaVersion: '1.0', spaceId, createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
      baseRevision: { revision: 'rev-1', contentHash: 'h1', pulledAt: '2026-08-11T00:00:00.000Z' },
      pendingRevision: null, sources: [], checkpoints: [],
    });
    const adapters = {
      ensure: vi.fn(async () => ({
        ...adapter('code'),
        collect: vi.fn(async () => ({ artifacts: [artifact('code', 'code-new')], hasMore: false })),
      })),
    };
    const sync = {
      pull: vi.fn(async () => ({ revisionId: 'rev-2' })),
      push: vi.fn(async () => ({ conflict: false, revisionId: 'rev-2', status: 'published' as const })),
    };

    const runtime = createKnowledgeWorkflowRuntime({ home, adapters, scanSources: codePipeline([artifact('code', 'code-new')]), sync });
    const preview = await runtime.prepare({ spaceId, sourcePaths: [source], sourceType: 'code', confirmedLocalScan: true, localScanPlanHash: 'a'.repeat(64) });

    expect(preview.diff).toBeDefined();
    expect(preview.diff!.deleted).toBeGreaterThanOrEqual(1);
    expect(preview.diff!.added).toBeGreaterThanOrEqual(1);
  });
});
