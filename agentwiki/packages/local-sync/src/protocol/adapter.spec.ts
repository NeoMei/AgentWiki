import { describe, expect, it } from 'vitest';
import {
  AdapterManifestSchema,
  AdapterInputSchema,
  SourceDescriptorSchema,
  ArtifactBatchSchema,
  SourceAdapterContract,
  assertAdapterManifest,
  assertAdapterInput,
  assertArtifactBatch,
  type SourceAdapter,
} from './adapter.js';
import { SourceArtifactSchema, type SourceArtifact } from './artifact.js';

const dummyArtifact: SourceArtifact = SourceArtifactSchema.parse({
  artifactId: 'a1',
  adapterId: 'test',
  adapterVersion: '0.1.0',
  sourceId: 's1',
  logicalKey: 'hello.md',
  contentHash: 'h1',
  updatedAt: '2024-01-01T00:00:00Z',
  kind: 'document',
  content: { title: 'Hello', body: 'World' },
  evidence: [],
  sensitivity: 'shareable',
});

const dummyAdapter: SourceAdapter = {
  manifest: () => ({
    adapterId: 'test',
    version: '0.1.0',
    protocolVersion: '1.0',
    inputKinds: ['directory'],
    artifactKinds: ['document'],
    supportsIncremental: false,
    permissions: ['read-source-path'],
    runtime: { kind: 'node-module' },
  }),
  inspect: async () => ({
    adapterId: 'test',
    sourcePath: '/tmp/docs',
    displayName: 'docs',
    kind: 'documents',
    estimatedArtifacts: 1,
    sourceHash: 'sh1',
  }),
  collect: async () => ({
    artifacts: [dummyArtifact],
    hasMore: false,
  }),
};

describe('adapter protocol', () => {
  it('validates a manifest', () => {
    const manifest = assertAdapterManifest(dummyAdapter.manifest());
    expect(manifest.adapterId).toBe('test');
    expect(AdapterManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it('validates adapter input', () => {
    const input = assertAdapterInput({
      sourcePath: '/tmp/docs',
      spaceId: 'space-1',
      jobId: 'job-1',
    });
    expect(input.spaceId).toBe('space-1');
    expect(AdapterInputSchema.safeParse(input).success).toBe(true);
  });

  it('validates source descriptor through contract', async () => {
    const descriptor = await SourceAdapterContract.inspect(dummyAdapter, {
      sourcePath: '/tmp/docs',
      spaceId: 'space-1',
      jobId: 'job-1',
    });
    expect(descriptor.kind).toBe('documents');
    expect(SourceDescriptorSchema.safeParse(descriptor).success).toBe(true);
  });

  it('validates artifact batch through contract', async () => {
    const batch = await SourceAdapterContract.collect(dummyAdapter, {
      sourcePath: '/tmp/docs',
      spaceId: 'space-1',
      jobId: 'job-1',
    });
    expect(batch.artifacts).toHaveLength(1);
    expect(ArtifactBatchSchema.safeParse(batch).success).toBe(true);
    expect(assertArtifactBatch(batch).hasMore).toBe(false);
  });

  it('rejects manifest with empty adapterId', () => {
    expect(() =>
      assertAdapterManifest({
        adapterId: '',
        version: '0.1.0',
        protocolVersion: '1.0',
        inputKinds: ['x'],
        artifactKinds: ['document'],
        supportsIncremental: false,
        permissions: ['read-source-path'],
        runtime: { kind: 'node-module' },
      }),
    ).toThrow();
  });
});
