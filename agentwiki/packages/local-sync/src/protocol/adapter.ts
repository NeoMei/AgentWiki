import { z } from 'zod';

/**
 * Source Adapter protocol for the Local Knowledge Orchestrator.
 *
 * Each adapter is a deterministic, read-only collector that translates one
 * local source (codebase, document folder, agent memory) into structured
 * SourceArtifact batches. Adapters never write to the workspace wiki or
 * upload to AgentWiki.
 */

export const LocalPermissionSchema = z.enum([
  'read-source-path',
  'read-git-metadata',
  'run-managed-runtime',
  'read-environment-name-only',
]);

export type LocalPermission = z.infer<typeof LocalPermissionSchema>;

export const ManagedRuntimeDescriptorSchema = z.object({
  kind: z.enum(['node-module', 'python-venv', 'native-binary', 'future']),
  packageName: z.string().min(1).optional(),
  packageVersion: z.string().min(1).optional(),
  installCommand: z.array(z.string()).optional(),
  checksum: z.string().optional(),
});

export type ManagedRuntimeDescriptor = z.infer<typeof ManagedRuntimeDescriptorSchema>;

export const AdapterManifestSchema = z.object({
  adapterId: z.string().min(1),
  version: z.string().min(1),
  protocolVersion: z.string().min(1),
  inputKinds: z.array(z.string().min(1)),
  artifactKinds: z.array(z.enum(['code', 'document', 'memory', 'relation'])),
  supportsIncremental: z.boolean(),
  permissions: z.array(LocalPermissionSchema),
  runtime: ManagedRuntimeDescriptorSchema,
});

export type AdapterManifest = z.infer<typeof AdapterManifestSchema>;

export const AdapterInputSchema = z.object({
  sourcePath: z.string().min(1),
  spaceId: z.string().min(1),
  jobId: z.string().min(1),
  cursor: z.string().optional(),
  limits: z.object({
    maxFiles: z.number().int().nonnegative().optional(),
    maxBytes: z.number().int().nonnegative().optional(),
    maxFileBytes: z.number().int().nonnegative().optional(),
  }).optional(),
  previousSourceHash: z.string().optional(),
});

export type AdapterInput = z.infer<typeof AdapterInputSchema>;

export const SourceDescriptorSchema = z.object({
  adapterId: z.string().min(1),
  sourcePath: z.string().min(1),
  displayName: z.string().min(1),
  kind: z.enum(['code', 'documents', 'mixed', 'memory', 'unknown']),
  estimatedArtifacts: z.number().int().nonnegative(),
  sourceHash: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export type SourceDescriptor = z.infer<typeof SourceDescriptorSchema>;

export const ArtifactBatchSchema = z.object({
  artifacts: z.array(z.any()), // SourceArtifact from artifact.ts, avoid import cycle
  cursor: z.string().optional(),
  hasMore: z.boolean(),
});

export type ArtifactBatch = z.infer<typeof ArtifactBatchSchema>;

/** Abstract adapter shape that concrete implementations must satisfy. */
export interface SourceAdapter {
  manifest(): AdapterManifest;
  inspect(input: AdapterInput): Promise<SourceDescriptor>;
  collect(input: AdapterInput): Promise<ArtifactBatch>;
}

export const SourceAdapterContract = {
  manifest: (a: SourceAdapter): AdapterManifest => AdapterManifestSchema.parse(a.manifest()),
  inspect: async (a: SourceAdapter, input: AdapterInput): Promise<SourceDescriptor> =>
    SourceDescriptorSchema.parse(await a.inspect(input)),
  collect: async (a: SourceAdapter, input: AdapterInput): Promise<ArtifactBatch> =>
    ArtifactBatchSchema.parse(await a.collect(input)),
};

export function assertAdapterManifest(value: unknown): AdapterManifest {
  return AdapterManifestSchema.parse(value);
}

export function assertAdapterInput(value: unknown): AdapterInput {
  return AdapterInputSchema.parse(value);
}

export function assertSourceDescriptor(value: unknown): SourceDescriptor {
  return SourceDescriptorSchema.parse(value);
}

export function assertArtifactBatch(value: unknown): ArtifactBatch {
  return ArtifactBatchSchema.parse(value);
}
