import type { Plugin } from 'vite';

export interface BundleChunk {
  fileName: string;
  code: string;
  isEntry: boolean;
  imports: string[];
  modules: Record<string, unknown>;
}

const INITIAL_BUDGET = 550_000;
const CHUNK_BUDGET = 500_000;
const PARSER_BUDGET = 720_000;
const parserModule = /\/node_modules\/@mermaid-js\/parser\/dist\/(?:chunks\/mermaid-parser\.core\/[^/]+|mermaid-parser\.core)\.mjs$/u;
const lazyRuntime = /\/node_modules\/(?:katex|mermaid|@mermaid-js\/parser|@codemirror\/[^/]+)\//u;

export function auditClientBundle(chunks: BundleChunk[]) {
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const initial = new Set<string>();
  function visit(file: string) {
    if (initial.has(file)) return;
    const chunk = byFile.get(file);
    if (!chunk) return;
    initial.add(file);
    chunk.imports.forEach(visit);
  }
  chunks.filter((chunk) => chunk.isEntry).forEach((chunk) => visit(chunk.fileName));
  let initialBytes = 0;
  const exceptions: string[] = [];
  for (const chunk of chunks) {
    const bytes = Buffer.byteLength(chunk.code, 'utf8');
    const modules = Object.keys(chunk.modules);
    if (initial.has(chunk.fileName)) {
      initialBytes += bytes;
      if (modules.some((id) => lazyRuntime.test(id))) {
        throw new Error(`Client lazy runtime loaded at startup: ${chunk.fileName}`);
      }
    }
    if (bytes > CHUNK_BUDGET) {
      // The upstream complete parser is a single generated module. Keep full
      // diagram support, a bounded exception and Vite's visible size warning.
      if (!initial.has(chunk.fileName) && modules.length > 0 && modules.every((id) => parserModule.test(id)) && bytes <= PARSER_BUDGET) {
        exceptions.push(chunk.fileName);
      } else {
        throw new Error(`Client chunk exceeds ${CHUNK_BUDGET} bytes: ${chunk.fileName} (${bytes})`);
      }
    }
  }
  if (initialBytes > INITIAL_BUDGET) {
    throw new Error(`Client initial JavaScript exceeds ${INITIAL_BUDGET} bytes: ${initialBytes}`);
  }
  return { initialBytes, exceptions };
}

export function clientBundleBudget(): Plugin {
  return {
    name: 'agentwiki-client-bundle-budget',
    generateBundle: {
      // Vite adds dynamic-import preload tables during generateBundle. Audit
      // after that rewrite so the budget measures the emitted files.
      order: 'post',
      handler(_options, bundle) {
        const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
        const report = auditClientBundle(chunks);
        this.info(`Initial JavaScript: ${report.initialBytes}/${INITIAL_BUDGET} bytes; lazy parser exceptions: ${report.exceptions.length}`);
      },
    },
  };
}
