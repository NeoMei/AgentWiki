import { describe, expect, it } from 'vitest';
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

describe('CodeGraph standard normalizer', () => {
  it('produces stable, private sorted datasets from either supported file envelope', () => {
    const options = { sourceKey, sourceRoot: '/private/project', scanner, indexedAt: '2026-08-18T00:00:00.000Z', maxFiles: 2, maxGeneratedBytes: 10_000 };
    const first = normalizeCodeGraphFiles({ files: [
      { path: '/private/project/src/z.ts', language: 'typescript', nodeCount: 3, sizeBytes: 30, id: 'codegraph-z', ignored: true },
      { path: 'src/a.ts', language: 'typescript', nodeCount: 1, sizeBytes: 10, nodeId: 'codegraph-a' },
    ] }, options);
    const second = normalizeCodeGraphFiles([
      { sizeBytes: 10, path: 'src/a.ts', nodeCount: 1, language: 'typescript', arbitrary: 'ignored' },
      { path: 'src/z.ts', language: 'typescript', nodeCount: 3, sizeBytes: 30 },
    ], options);

    expect(first.filesNdjson).toBe(second.filesNdjson);
    expect(first.manifest.snapshotHash).toBe(second.manifest.snapshotHash);
    expect(first.filesNdjson).toContain('src/a.ts');
    expect(first.filesNdjson).not.toContain('/private/project');
    expect(first.filesNdjson).not.toContain('codegraph-');
    expect(first.filesNdjson.split('\n').filter(Boolean).map((line) => JSON.parse(line).path)).toEqual(['src/a.ts', 'src/z.ts']);
    expect(first.modulesNdjson).toBe('');
    expect(first.symbolsNdjson).toBe('');
    expect(first.relationsNdjson).toBe('');
    expect(first.manifest).toMatchObject({ schemaVersion: 'agentwiki-code-snapshot@1', complete: true, counts: { files: 2, modules: 0, symbols: 0, relations: 0 } });
  });

  it.each([
    [{ files: [{ language: 'typescript', nodeCount: 0, sizeBytes: 0 }] }],
    [{ files: [{ path: '../escape.ts', language: 'typescript', nodeCount: 0, sizeBytes: 0 }] }],
    [{ files: [{ path: 'src/a.ts', language: 'typescript', nodeCount: -1, sizeBytes: 0 }] }],
    [{ files: [{ path: 'src/a.ts', language: 'typescript', nodeCount: 0, sizeBytes: -1 }] }],
    [{ files: [{ path: 'src/a.ts', language: 'typescript', nodeCount: 0, sizeBytes: 0 }, { path: 'src/a.ts', language: 'typescript', nodeCount: 0, sizeBytes: 0 }] }],
  ])('fails closed for invalid scanner files', (output) => {
    expect(() => normalizeCodeGraphFiles(output, { sourceKey, sourceRoot: '/private/project', scanner, indexedAt: '2026-08-18T00:00:00.000Z', maxFiles: 1, maxGeneratedBytes: 10_000 })).toThrow(/Code snapshot is invalid/u);
  });

  it('uses code-unit path ordering regardless of locale-sensitive collation', () => {
    const normalized = normalizeCodeGraphFiles([
      { path: 'src/é.ts', language: 'typescript', nodeCount: 0, sizeBytes: 0 },
      { path: 'src/a.ts', language: 'typescript', nodeCount: 0, sizeBytes: 0 },
      { path: 'src/A.ts', language: 'typescript', nodeCount: 0, sizeBytes: 0 },
      { path: 'src/z.ts', language: 'typescript', nodeCount: 0, sizeBytes: 0 },
    ], { sourceKey, sourceRoot: '/private/project', scanner, indexedAt: '2026-08-18T00:00:00.000Z', maxFiles: 10, maxGeneratedBytes: 10_000 });
    expect(normalized.files.map((file) => file.path)).toEqual(['src/A.ts', 'src/a.ts', 'src/z.ts', 'src/é.ts']);
  });

  it('accepts only an array or an envelope whose files field is an array', () => {
    expect(() => normalizeCodeGraphFiles({ files: {}, ignored: true }, { sourceKey, sourceRoot: '/private/project', scanner, indexedAt: '2026-08-18T00:00:00.000Z', maxFiles: 10, maxGeneratedBytes: 10_000 })).toThrow(/Code snapshot is invalid/u);
  });
});
