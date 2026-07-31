import { z } from 'zod';

/**
 * A SourceArtifact is a single, self-contained piece of structured knowledge
 * produced by a Source Adapter. It carries provenance, sensitivity, and
 * evidence so the Orchestrator can decide whether and how to include it in a
 * KnowledgeBundle.
 */

export const SensitivitySchema = z.enum(['shareable', 'review-required', 'local-only']);

export type Sensitivity = z.infer<typeof SensitivitySchema>;

export const EvidenceReferenceSchema = z.object({
  evidenceId: z.string().min(1),
  sourceUri: z.string().min(1),
  sourceHash: z.string().min(1),
  quote: z.string().optional(),
  lineRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
  byteRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
});

export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const StructuredKnowledgeSchema = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().optional(),
  body: z.string().optional(),
  fields: z.record(z.string(), z.string()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type StructuredKnowledge = z.infer<typeof StructuredKnowledgeSchema>;

export const SourceArtifactSchema = z.object({
  artifactId: z.string().min(1),
  adapterId: z.string().min(1),
  adapterVersion: z.string().min(1),
  sourceId: z.string().min(1),
  logicalKey: z.string().min(1),
  contentHash: z.string().min(1),
  updatedAt: z.string().datetime(),
  kind: z.enum(['code', 'document', 'memory', 'relation']),
  content: StructuredKnowledgeSchema,
  evidence: z.array(EvidenceReferenceSchema),
  sensitivity: SensitivitySchema,
});

export type SourceArtifact = z.infer<typeof SourceArtifactSchema>;

export function assertSourceArtifact(value: unknown): SourceArtifact {
  return SourceArtifactSchema.parse(value);
}

export function assertStructuredKnowledge(value: unknown): StructuredKnowledge {
  return StructuredKnowledgeSchema.parse(value);
}

export function assertEvidenceReference(value: unknown): EvidenceReference {
  return EvidenceReferenceSchema.parse(value);
}

export function assertSensitivity(value: unknown): Sensitivity {
  return SensitivitySchema.parse(value);
}
