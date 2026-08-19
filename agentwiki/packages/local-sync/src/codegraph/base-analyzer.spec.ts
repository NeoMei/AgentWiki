import { describe, expect, it } from 'vitest';
import { analyzeBaseKnowledge } from './base-analyzer.js';
import { normalizeCodeGraphFiles } from './normalizer.js';

const sourceKey = 'a'.repeat(64);
const scanner = {
  provider: 'codegraph' as const,
  detectedVersion: '1.5.0',
  capabilities: {
    required: { 'index.status': true, 'index.sync': true, 'files.list': true },
    optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false },
  },
};

function snapshot(files: unknown[], indexedAt = '2026-08-18T00:00:00.000Z') {
  return normalizeCodeGraphFiles(files, {
    sourceKey,
    sourceRoot: '/private/raw-source-root',
    scanner,
    indexedAt,
    maxFiles: 20,
    maxGeneratedBytes: 100_000,
  });
}

describe('deterministic base analysis', () => {
  it('generates byte-identical, filename-only Markdown regardless of input order or clock', () => {
    const first = analyzeBaseKnowledge(snapshot([
      { path: 'src/main.ts', language: 'typescript', nodeCount: 2, sizeBytes: 20, id: 'scanner-internal' },
      { path: 'package.json', language: 'json', nodeCount: 1, sizeBytes: 10, body: 'const secret = "raw source body"' },
      { path: 'vite.config.ts', language: 'typescript', nodeCount: 1, sizeBytes: 10 },
      { path: 'README.md', language: 'markdown', nodeCount: 1, sizeBytes: 10 },
    ]), { now: () => new Date('2000-01-01T00:00:00.000Z'), maxGeneratedBytes: 20_000 });
    const second = analyzeBaseKnowledge(snapshot([
      { path: 'README.md', language: 'markdown', nodeCount: 1, sizeBytes: 10 },
      { path: 'vite.config.ts', language: 'typescript', nodeCount: 1, sizeBytes: 10 },
      { path: 'package.json', language: 'json', nodeCount: 1, sizeBytes: 10 },
      { path: 'src/main.ts', language: 'typescript', nodeCount: 2, sizeBytes: 20 },
    ], '2026-08-19T12:34:56.000Z'), { now: () => new Date('2040-01-01T00:00:00.000Z'), maxGeneratedBytes: 20_000 });

    expect(first.documents).toEqual(second.documents);
    const overview = first.documents.find((document) => document.record.relativePath === 'architecture/overview.md')!;
    expect(overview.content).toContain('# Repository overview');
    expect(overview.content).toContain('TypeScript: 2 file(s)');
    expect(overview.content).toContain('package.json');
    expect(overview.content).toContain('vite.config.ts');
    expect(overview.content).not.toContain('/private/raw-source-root');
    expect(overview.content).not.toContain('raw source body');
    expect(overview.content).not.toContain('scanner-internal');
    expect(first.records.map((record) => record.logicalKey)).toEqual([
      'codegraph/architecture/entry-points',
      'codegraph/architecture/overview',
    ]);
  });

  it('always creates an overview but creates entry points only from known filename evidence', () => {
    const empty = analyzeBaseKnowledge(snapshot([]), { maxGeneratedBytes: 20_000 });
    expect(empty.records.map((record) => record.relativePath)).toEqual(['architecture/overview.md']);
    expect(empty.documents[0]?.content).toContain('No normalized files were available.');

    const entryPoints = analyzeBaseKnowledge(snapshot([
      { path: 'cmd/server/main.go', language: 'go', nodeCount: 0, sizeBytes: 1 },
      { path: 'src/not-an-entry.ts', language: 'typescript', nodeCount: 0, sizeBytes: 1 },
    ]), { maxGeneratedBytes: 20_000 });
    expect(entryPoints.documents.find((document) => document.record.relativePath === 'architecture/entry-points.md')?.content)
      .toContain('cmd/server/main.go');
  });

  it('fails closed with an explicit warning when generated output exceeds its confirmed cap', () => {
    expect(() => analyzeBaseKnowledge(snapshot([{ path: 'src/main.ts', language: 'typescript', nodeCount: 0, sizeBytes: 1 }]), {
      maxGeneratedBytes: 1,
    })).toThrow(/CODE_ANALYSIS_FAILED/u);
  });

  it('derives display languages from static extensions and safely encodes untrusted normalized filename segments', () => {
    const result = analyzeBaseKnowledge(snapshot([
      { path: 'src/name with space#?%.ts', language: 'language\n## injected section', nodeCount: 0, sizeBytes: 1 },
      { path: 'src/main.ts', language: '```\n# injected', nodeCount: 0, sizeBytes: 1 },
    ]), { maxGeneratedBytes: 20_000 });
    const overview = result.documents.find((document) => document.record.relativePath === 'architecture/overview.md')!;
    const entryPoints = result.documents.find((document) => document.record.relativePath === 'architecture/entry-points.md')!;
    expect(overview.content).toContain('TypeScript: 2 file(s)');
    expect(overview.content).not.toContain('language\n## injected');
    expect(entryPoints.content).toContain('src/main.ts');
    expect(entryPoints.content).not.toContain('```');
    expect(() => analyzeBaseKnowledge(snapshot([{ path: 'src/bidi\u202E.ts', language: 'typescript', nodeCount: 0, sizeBytes: 1 }]), { maxGeneratedBytes: 20_000 })).toThrow(/CODE_ANALYSIS_FAILED/u);
  });
});
