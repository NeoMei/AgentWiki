import { z } from 'zod';

const KnowledgeIdSchema = z.string().min(1).max(128).regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  'must use only letters, numbers, dot, underscore, and hyphen',
);

/**
 * KnowledgeBundle is the canonical, versioned container of shareable knowledge
 * produced by the Orchestrator and uploaded to AgentWiki after user confirmation.
 */

export const WikiPageSchema = z.object({
  pageId: KnowledgeIdSchema,
  spaceId: z.string().min(1).max(128),
  path: z.string().min(1).max(1024),
  title: z.string().min(1).max(500),
  body: z.string().max(1024 * 1024),
  order: z.number().int().optional(),
  metadata: z.record(z.unknown()).optional(),
  artifactIds: z.array(z.string().min(1)),
  contentHash: z.string().min(1),
  updatedAt: z.string().datetime(),
});

export type WikiPage = z.infer<typeof WikiPageSchema>;

export const SharedMemorySchema = z.object({
  memoryId: KnowledgeIdSchema,
  spaceId: z.string().min(1).max(128),
  key: z.string().min(1).max(500),
  value: z.string().min(1).max(1024 * 1024),
  scope: z.enum(['space', 'agent', 'page']),
  pageIds: z.array(KnowledgeIdSchema).max(500).optional(),
  artifactIds: z.array(z.string().min(1)),
  contentHash: z.string().min(1),
  updatedAt: z.string().datetime(),
});

export type SharedMemory = z.infer<typeof SharedMemorySchema>;

export const KnowledgeRelationSchema = z.object({
  relationId: KnowledgeIdSchema,
  spaceId: z.string().min(1).max(128),
  sourceId: KnowledgeIdSchema,
  targetId: KnowledgeIdSchema,
  relationType: z.string().min(1).max(200),
  artifactIds: z.array(z.string().min(1)),
  metadata: z.record(z.unknown()).optional(),
});

export type KnowledgeRelation = z.infer<typeof KnowledgeRelationSchema>;

export const BundleProvenanceSchema = z.object({
  itemId: KnowledgeIdSchema,
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
  deletionId: KnowledgeIdSchema,
  itemType: z.enum(['page', 'memory', 'relation']),
  itemId: KnowledgeIdSchema,
  reason: z.string().min(1).max(1000),
  artifactIds: z.array(z.string().min(1)).optional(),
});

export type DeletionProposal = z.infer<typeof DeletionProposalSchema>;

export const KnowledgeBundleSchema = z.object({
  schemaVersion: z.string().min(1),
  recipeVersion: z.string().min(1),
  spaceId: z.string().min(1),
  baseRevision: z.string().min(1),
  pages: z.array(WikiPageSchema).max(500),
  memories: z.array(SharedMemorySchema).max(1000),
  relations: z.array(KnowledgeRelationSchema).max(2000),
  provenance: z.array(BundleProvenanceSchema).max(5000),
  deletions: z.array(DeletionProposalSchema).max(2000),
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
