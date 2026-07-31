import { z } from 'zod';

/**
 * Local manifest for a Space workspace. Tracks source mappings, base revisions,
 * checkpoints, and last sync state.
 */

export const RevisionPointerSchema = z.object({
  revision: z.string().min(1),
  pulledAt: z.string().datetime(),
  contentHash: z.string().min(1),
});

export type RevisionPointer = z.infer<typeof RevisionPointerSchema>;

export const SourceMappingSchema = z.object({
  adapterId: z.string().min(1),
  sourcePath: z.string().min(1),
  sourceId: z.string().min(1),
  sourceHash: z.string().min(1),
  lastCollectedAt: z.string().datetime(),
  artifactCount: z.number().int().nonnegative(),
});

export type SourceMapping = z.infer<typeof SourceMappingSchema>;

export const LocalManifestSchema = z.object({
  schemaVersion: z.string().min(1),
  spaceId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  baseRevision: RevisionPointerSchema.nullable(),
  pendingRevision: RevisionPointerSchema.nullable(),
  sources: z.array(SourceMappingSchema),
  checkpoints: z.array(z.string().min(1)),
  metadata: z.record(z.unknown()).optional(),
});

export type LocalManifest = z.infer<typeof LocalManifestSchema>;

export function assertLocalManifest(value: unknown): LocalManifest {
  return LocalManifestSchema.parse(value);
}

export function assertRevisionPointer(value: unknown): RevisionPointer {
  return RevisionPointerSchema.parse(value);
}

export function assertSourceMapping(value: unknown): SourceMapping {
  return SourceMappingSchema.parse(value);
}
