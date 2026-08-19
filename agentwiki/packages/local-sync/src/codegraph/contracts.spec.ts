import { describe, expect, it } from 'vitest';
import {
  AnalysisModeSchema,
  CodeGraphCapabilitiesSchema,
  CodeGraphSourcePlanSchema,
  LocalScanPlanSchema,
  PublicCodeGraphSourcePlanSchema,
  PublicLocalScanPlanSchema,
  StandardCodeFileSchema,
  publicLocalScanPlan,
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

  it('rejects duplicate source identities in a local scan plan', () => {
    expect(() => LocalScanPlanSchema.parse({
      ...localScanPlan,
      sources: [source, { ...source, displayPath: 'duplicate' }],
    })).toThrow(/Duplicate sourceKey/u);
  });

  it('re-exports scan contracts from the public protocol index', () => {
    expect(ExportedLocalScanPlanSchema).toBe(LocalScanPlanSchema);
  });

  it('creates a strict public local scan plan with no private scanner fields', () => {
    const publicPlan = publicLocalScanPlan(localScanPlan);

    expect(PublicLocalScanPlanSchema.parse(publicPlan)).toEqual({
      schemaVersion: localScanPlan.schemaVersion,
      provider: localScanPlan.provider,
      detectedVersion: localScanPlan.detectedVersion,
      capabilities: localScanPlan.capabilities,
      analysisMode: localScanPlan.analysisMode,
      limits: localScanPlan.limits,
      localScanPlanHash: localScanPlan.localScanPlanHash,
      sources: [{
        sourceKey: source.sourceKey,
        displayPath: source.displayPath,
        action: source.action,
        indexState: source.indexState,
        estimatedFiles: source.estimatedFiles,
      }],
    });
    expect(JSON.stringify(publicPlan)).not.toContain('/private/agentwiki');
    expect(JSON.stringify(publicPlan)).not.toContain('/usr/local/bin/codegraph');
    expect(() => PublicLocalScanPlanSchema.parse({ ...publicPlan, executableIdentity: '/private/bin/codegraph' })).toThrow();
  });

  it.each(['/private/repository', 'C:/private/repository', '../repository', './repository', 'repository/../private', 'repository\\private', 'repository//private', 'repository\0private', 'repository\nprivate', 'repository\u001bprivate', 'repository\u009bprivate'])('rejects unsafe public display paths: %j', (displayPath) => {
    expect(() => PublicCodeGraphSourcePlanSchema.parse({
      sourceKey: source.sourceKey,
      displayPath,
      action: source.action,
      indexState: source.indexState,
      estimatedFiles: source.estimatedFiles,
    })).toThrow();
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
