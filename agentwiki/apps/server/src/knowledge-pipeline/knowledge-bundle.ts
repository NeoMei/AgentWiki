import { z } from 'zod';
import { BusinessException } from '../core/filters/business-error';
import { createHash } from 'crypto';

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
  provenance: z.array(ProvenanceRecordSchema),
  deletions: z.array(DeletionProposalSchema),
}).strict();

export type KnowledgeBundle = z.infer<typeof KnowledgeBundleSchema>;

export interface NormalizedKnowledgeBundle extends KnowledgeBundle {
  contentHash: string;
}

const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;

export function parseKnowledgeBundle(input: Buffer): NormalizedKnowledgeBundle {
  if (input.length > MAX_BUNDLE_BYTES) {
    throw new BusinessException('SOURCE_TOO_LARGE', 'Knowledge bundle exceeds 10 MiB');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.toString('utf8'));
  } catch {
    throw new BusinessException('KNOWLEDGE_BUNDLE_INVALID', 'Invalid JSON');
  }
  const result = KnowledgeBundleSchema.safeParse(parsed);
  if (!result.success) {
    throw new BusinessException('KNOWLEDGE_BUNDLE_INVALID', result.error.message);
  }
  const bundle = result.data;
  const canonical = canonicalizeBundle(bundle);
  const contentHash = computeBundleHash(canonical);
  return { ...bundle, contentHash };
}

function canonicalizeBundle(bundle: KnowledgeBundle): KnowledgeBundle {
  return {
    ...bundle,
    pages: sortBy([...bundle.pages], (p) => [p.pageId]),
    memories: sortBy([...bundle.memories], (m) => [m.memoryId]),
    relations: sortBy([...bundle.relations], (r) => [r.relationId]),
    provenance: sortBy([...bundle.provenance], (p) => [p.provenanceId]),
    deletions: sortBy([...bundle.deletions], (d) => [d.itemType, d.itemId]),
  };
}

function sortBy<T>(items: T[], keyFn: (item: T) => (string | number)[]): T[] {
  return items.slice().sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
      const ai = String(ka[i]);
      const bi = String(kb[i]);
      if (ai < bi) return -1;
      if (ai > bi) return 1;
    }
    return ka.length - kb.length;
  });
}

export function computeBundleHash(bundle: KnowledgeBundle): string {
  const canonical = JSON.stringify(bundle, Object.keys(bundle).sort());
  return createHash('sha256').update(canonical).digest('hex');
}
