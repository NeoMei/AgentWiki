import { describe, expect, it } from 'vitest';
import { auditClientBundle, type BundleChunk } from './bundleBudget';

const chunk = (fileName: string, bytes: number, overrides: Partial<BundleChunk> = {}): BundleChunk => ({
  fileName, code: 'x'.repeat(bytes), isEntry: false, imports: [], modules: {}, ...overrides,
});

describe('production bundle budgets', () => {
  it('counts shared static imports once and excludes dynamic features from startup', () => {
    const report = auditClientBundle([
      chunk('index.js', 250_000, { isEntry: true, imports: ['react.js', 'shared.js'] }),
      chunk('react.js', 230_000, { imports: ['shared.js'] }),
      chunk('shared.js', 100), chunk('editor.js', 400_000),
    ]);
    expect(report.initialBytes).toBe(480_100);
  });

  it('rejects a startup graph that exceeds the budget across individually small files', () => {
    expect(() => auditClientBundle([
      chunk('index.js', 300_000, { isEntry: true, imports: ['vendor.js'] }),
      chunk('vendor.js', 300_000),
    ])).toThrow(/initial JavaScript/u);
  });

  it('rejects an oversized application chunk', () => {
    expect(() => auditClientBundle([chunk('page.js', 500_001)])).toThrow(/page.js/u);
  });

  it('permits only the bounded, lazy upstream Mermaid parser exception', () => {
    const parser = chunk('parser.js', 690_000, {
      modules: { '/node_modules/@mermaid-js/parser/dist/chunks/mermaid-parser.core/chunk-example.mjs': {} },
    });
    expect(auditClientBundle([parser]).exceptions).toEqual(['parser.js']);
    expect(() => auditClientBundle([{ ...parser, code: 'x'.repeat(720_001) }])).toThrow(/parser.js/u);
    expect(() => auditClientBundle([parser, chunk('index.js', 1, { isEntry: true, imports: ['parser.js'] })])).toThrow();
  });

  it('rejects an editor, formula or diagram runtime in the initial graph', () => {
    for (const id of ['/node_modules/katex/dist/katex.mjs', '/node_modules/@codemirror/view/dist/index.js', '/node_modules/mermaid/dist/mermaid.core.mjs']) {
      expect(() => auditClientBundle([chunk('index.js', 1, { isEntry: true, modules: { [id]: {} } })])).toThrow(/lazy runtime/u);
    }
  });

  it('does not grant the parser exception to application code bundled with a parser module', () => {
    expect(() => auditClientBundle([chunk('mixed.js', 710_000, {
      modules: {
        '/node_modules/@mermaid-js/parser/dist/chunks/mermaid-parser.core/chunk-example.mjs': {},
        '/src/features/large-page.tsx': {},
      },
    })])).toThrow(/mixed.js/u);
  });
});
