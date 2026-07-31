import { z } from 'zod';

/**
 * Sync primitives: snapshots, deltas, change sets, and conflict bundles.
 */

export const KnowledgeItemSchema = z.object({
  itemId: z.string().min(1),
  itemType: z.enum(['page', 'memory', 'relation']),
  contentHash: z.string().min(1),
  updatedAt: z.string().datetime(),
  body: z.record(z.unknown()),
});

export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>;

export const SnapshotSchema = z.object({
  revision: z.string().min(1),
  spaceId: z.string().min(1),
  createdAt: z.string().datetime(),
  items: z.array(KnowledgeItemSchema),
});

export type Snapshot = z.infer<typeof SnapshotSchema>;

export const DeltaItemSchema = z.object({
  itemId: z.string().min(1),
  itemType: z.enum(['page', 'memory', 'relation']),
  operation: z.enum(['add', 'update', 'delete']),
  contentHash: z.string().min(1).optional(),
  previousHash: z.string().min(1).optional(),
  body: z.record(z.unknown()).optional(),
});

export type DeltaItem = z.infer<typeof DeltaItemSchema>;

export const DeltaSchema = z.object({
  fromRevision: z.string().min(1),
  toRevision: z.string().min(1),
  spaceId: z.string().min(1),
  createdAt: z.string().datetime(),
  items: z.array(DeltaItemSchema),
});

export type Delta = z.infer<typeof DeltaSchema>;

export const ChangeSetItemSchema = z.object({
  itemId: z.string().min(1),
  itemType: z.enum(['page', 'memory', 'relation']),
  operation: z.enum(['add', 'update', 'delete']),
  body: z.record(z.unknown()).optional(),
  previousHash: z.string().min(1).optional(),
});

export type ChangeSetItem = z.infer<typeof ChangeSetItemSchema>;

export const ChangeSetSchema = z.object({
  changeSetId: z.string().min(1),
  spaceId: z.string().min(1),
  baseRevision: z.string().min(1),
  items: z.array(ChangeSetItemSchema),
  provenance: z.array(z.record(z.unknown())),
  confirmedAt: z.string().datetime(),
});

export type ChangeSet = z.infer<typeof ChangeSetSchema>;

export const ConflictBundleSchema = z.object({
  itemId: z.string().min(1),
  itemType: z.enum(['page', 'memory', 'relation']),
  base: KnowledgeItemSchema.nullable(),
  local: KnowledgeItemSchema.nullable(),
  remote: KnowledgeItemSchema.nullable(),
  provenance: z.array(z.record(z.unknown())),
  conflictingFields: z.array(z.string().min(1)),
  proposedBody: z.record(z.unknown()).optional(),
});

export type ConflictBundle = z.infer<typeof ConflictBundleSchema>;

export function assertKnowledgeItem(value: unknown): KnowledgeItem {
  return KnowledgeItemSchema.parse(value);
}

export function assertSnapshot(value: unknown): Snapshot {
  return SnapshotSchema.parse(value);
}

export function assertDeltaItem(value: unknown): DeltaItem {
  return DeltaItemSchema.parse(value);
}

export function assertDelta(value: unknown): Delta {
  return DeltaSchema.parse(value);
}

export function assertChangeSetItem(value: unknown): ChangeSetItem {
  return ChangeSetItemSchema.parse(value);
}

export function assertChangeSet(value: unknown): ChangeSet {
  return ChangeSetSchema.parse(value);
}

export function assertConflictBundle(value: unknown): ConflictBundle {
  return ConflictBundleSchema.parse(value);
}
