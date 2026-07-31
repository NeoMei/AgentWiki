import { z } from 'zod';

/**
 * KnowledgeBundle is the canonical, versioned container of shareable knowledge
 * produced by the Orchestrator and uploaded to AgentWiki after user confirmation.
 */

export const WikiPageSchema = z.object({
  pageId: z.string().min(1),
  spaceId: z.string().min(1),
  path: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  order: z.number().int().optional(),
  metadata: z.record(z.unknown()).optional(),
  artifactIds: z.array(z.string().min(1)),
  contentHash: z.string().min(1),
  updatedAt: z.string().datetime(),
});

export type WikiPage = z.infer<typeof WikiPageSchema>;

export const SharedMemorySchema = z.object({
  memoryId: z.string().min(1),
  spaceId: z.string().min(1),
  key: z.string().min(1),
  value: z.string().min(1),
  scope: z.enum(['space', 'agent', 'page']),
  pageIds: z.array(z.string().min(1)).optional(),
  artifactIds: z.array(z.string().min(1)),
  contentHash: z.string().min(1),
  updatedAt: z.string().datetime(),
});

export type SharedMemory = z.infer<typeof SharedMemorySchema>;

export const KnowledgeRelationSchema = z.object({
  relationId: z.string().min(1),
  spaceId: z.string().min(1),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  relationType: z.string().min(1),
  artifactIds: z.array(z.string().min(1)),
  metadata: z.record(z.unknown()).optional(),
});

export type KnowledgeRelation = z.infer<typeof KnowledgeRelationSchema>;

export const BundleProvenanceSchema = z.object({
  itemId: z.string().min(1),
  artifactIds: z.array(z.string().min(1)).min(1),
  sensitivity: z.enum(['shareable', 'review-required', 'local-only']),
}).strict();

export type BundleProvenance = z.infer<typeof BundleProvenanceSchema>;

export const ProvenanceRecordSchema = z.object({
  provenanceId: z.string().min(1),
  artifactId: z.string().min(1),
  adapterId: z.string().min(1),
  adapterVersion: z.string().min(1),
  sourceId: z.string().min(1),
  logicalKey: z.string().min(1),
  sourceHash: z.string().min(1),
  collectedAt: z.string().datetime(),
  inputSnapshot: z.record(z.unknown()).optional(),
});

export type ProvenanceRecord = z.infer<typeof ProvenanceRecordSchema>;

export const DeletionProposalSchema = z.object({
  deletionId: z.string().min(1),
  itemType: z.enum(['page', 'memory', 'relation']),
  itemId: z.string().min(1),
  reason: z.string().min(1),
  artifactIds: z.array(z.string().min(1)).optional(),
});

export type DeletionProposal = z.infer<typeof DeletionProposalSchema>;

export const KnowledgeBundleSchema = z.object({
  schemaVersion: z.string().min(1),
  recipeVersion: z.string().min(1),
  spaceId: z.string().min(1),
  baseRevision: z.string().min(1),
  pages: z.array(WikiPageSchema),
  memories: z.array(SharedMemorySchema),
  relations: z.array(KnowledgeRelationSchema),
  provenance: z.array(BundleProvenanceSchema),
  deletions: z.array(DeletionProposalSchema),
}).strict().superRefine((bundle, context) => {
  for (const record of bundle.provenance) {
    if (record.sensitivity === 'local-only') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'local-only provenance cannot enter a KnowledgeBundle',
        path: ['provenance'],
      });
    }
  }
});

export type KnowledgeBundle = z.infer<typeof KnowledgeBundleSchema>;

export function assertWikiPage(value: unknown): WikiPage {
  return WikiPageSchema.parse(value);
}

export function assertSharedMemory(value: unknown): SharedMemory {
  return SharedMemorySchema.parse(value);
}

export function assertKnowledgeRelation(value: unknown): KnowledgeRelation {
  return KnowledgeRelationSchema.parse(value);
}

export function assertBundleProvenance(value: unknown): BundleProvenance {
  return BundleProvenanceSchema.parse(value);
}

export function assertProvenanceRecord(value: unknown): ProvenanceRecord {
  return ProvenanceRecordSchema.parse(value);
}

export function assertDeletionProposal(value: unknown): DeletionProposal {
  return DeletionProposalSchema.parse(value);
}

export function assertKnowledgeBundle(value: unknown): KnowledgeBundle {
  return KnowledgeBundleSchema.parse(value);
}
