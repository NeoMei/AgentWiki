import { describe, expect, it } from 'vitest';
import {
  AnalysisModeSchema,
  CodeGraphCapabilitiesSchema,
  CodeGraphSourcePlanSchema,
  LocalScanPlanSchema,
  StandardCodeFileSchema,
} from './contracts.js';
import { LocalScanPlanSchema as ExportedLocalScanPlanSchema } from '../protocol/index.js';

const capabilities = {
  required: {
    'index.status': true,
    'index.sync': true,
    'files.list': true,
  },
  optional: {
    'symbols.list': false,
    'relations.read': false,
    'semantic.explore': false,
    'impact.read': false,
    'routes.read': false,
  },
};

const source = {
  sourceKey: 'a'.repeat(64),
  displayPath: 'agentwiki',
  canonicalSourcePath: '/private/agentwiki',
  indexPath: '/private/agentwiki/.codegraph',
  action: 'sync' as const,
  indexState: 'stale' as const,
  estimatedFiles: 42,
};

const localScanPlan = {
  schemaVersion: 'agentwiki-local-scan-plan@1' as const,
  provider: 'codegraph' as const,
  executableIdentity: '/usr/local/bin/codegraph',
  detectedVersion: '1.2.3',
  capabilities,
  analysisMode: 'standard' as const,
  sources: [source],
  limits: { maxFiles: 10_000, maxGeneratedBytes: 1_000_000 },
  localScanPlanHash: 'b'.repeat(64),
};

describe('CodeGraph public contracts', () => {
  it('accepts standard analysis mode', () => {
    expect(AnalysisModeSchema.parse('standard')).toBe('standard');
  });

  it('rejects unknown scan-plan keys', () => {
    expect(() => LocalScanPlanSchema.parse({ ...localScanPlan, unexpected: true })).toThrow();
  });

  it('re-exports scan contracts from the public protocol index', () => {
    expect(ExportedLocalScanPlanSchema).toBe(LocalScanPlanSchema);
  });

  it.each([
    '/absolute/file.ts',
    'C:/absolute/file.ts',
    'C:\\absolute\\file.ts',
    'src\\file.ts',
    './src/file.ts',
    'src/./file.ts',
    '../file.ts',
    'src/../file.ts',
    'src//file.ts',
    'src/\0file.ts',
  ])('rejects non-normalized normalized file path %j', (path) => {
    expect(() => StandardCodeFileSchema.parse({
      fileId: 'file-1',
      path,
      language: 'typescript',
      nodeCount: 0,
      sizeBytes: 0,
    })).toThrow();
  });

  it('accepts a strict normalized code-file record', () => {
    expect(StandardCodeFileSchema.parse({
      fileId: 'file-1',
      path: 'src/code/file.ts',
      language: 'typescript',
      nodeCount: 0,
      sizeBytes: 0,
    })).toEqual({
      fileId: 'file-1',
      path: 'src/code/file.ts',
      language: 'typescript',
      nodeCount: 0,
      sizeBytes: 0,
    });
  });

  it('rejects extra normalized code-file fields', () => {
    expect(() => StandardCodeFileSchema.parse({
      fileId: 'file-1',
      path: 'src/code/file.ts',
      language: 'typescript',
      nodeCount: 0,
      sizeBytes: 0,
      rawNodeId: 'private',
    })).toThrow();
  });

  it('rejects a missing required CodeGraph capability', () => {
    const missing = structuredClone(capabilities) as Record<string, Record<string, boolean>>;
    delete missing.required['files.list'];
    expect(() => CodeGraphCapabilitiesSchema.parse(missing)).toThrow();
  });

  it('requires a 64-character lowercase hexadecimal source key', () => {
    expect(() => CodeGraphSourcePlanSchema.parse({ ...source, sourceKey: 'a'.repeat(63) })).toThrow();
    expect(() => CodeGraphSourcePlanSchema.parse({ ...source, sourceKey: 'A'.repeat(64) })).toThrow();
  });
});
