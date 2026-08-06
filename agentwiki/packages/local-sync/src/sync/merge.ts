import type { WikiPage, SharedMemory, KnowledgeRelation, KnowledgeBundle, DeletionProposal } from '../protocol/bundle.js';
import { createHash } from 'node:crypto';

function canonicalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, Object.keys(value as object).sort())).digest('hex').slice(0, 32);
}

export type ConflictKind = 'add-add' | 'field' | 'delete-modify' | 'delete-delete';
export type ItemKind = 'page' | 'memory' | 'relation';

export interface ConflictBundle {
  id: string;
  itemId: string;
  itemKind: ItemKind;
  conflictKind: ConflictKind;
  base: KnowledgeItem | null;
  local: KnowledgeItem | null;
  remote: KnowledgeItem | null;
  provenance: unknown[];
  conflictingFields: string[];
}

export type KnowledgeItem = WikiPage | SharedMemory | KnowledgeRelation;

export interface MergeItem<T extends KnowledgeItem> {
  itemId: string;
  base: T | null;
  local: T | null;
  remote: T | null;
  conflictingFields: string[];
  proposed: T | null;
}

export interface MergeResult {
  pages: MergeItem<WikiPage>[];
  memories: MergeItem<SharedMemory>[];
  relations: MergeItem<KnowledgeRelation>[];
  conflicts: ConflictBundle[];
  deletions: DeletionResult[];
}

export interface DeletionResult {
  itemId: string;
  itemKind: ItemKind;
  base: KnowledgeItem | null;
  local: DeletionProposal | null;
  remote: DeletionProposal | null;
  conflict: ConflictBundle | null;
}

const IGNORED_FIELDS = new Set(['contentHash', 'updatedAt', 'path']);

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function objectFields(obj: Record<string, unknown> | null): string[] {
  if (!obj) return [];
  return Object.keys(obj).filter((k) => !IGNORED_FIELDS.has(k));
}

function mergeFields<T extends KnowledgeItem>(
  base: T | null,
  local: T | null,
  remote: T | null,
): { merged: Record<string, unknown> | null; conflictingFields: string[] } {
  if (!local && !remote) return { merged: null, conflictingFields: [] };
  if (local && !remote) return { merged: { ...local as Record<string, unknown> }, conflictingFields: [] };
  if (remote && !local) return { merged: { ...remote as Record<string, unknown> }, conflictingFields: [] };

  const localRec = local as Record<string, unknown>;
  const remoteRec = remote as Record<string, unknown>;
  const baseRec = base as Record<string, unknown> | null;

  const keys = new Set<string>([
    ...objectFields(baseRec),
    ...objectFields(localRec),
    ...objectFields(remoteRec),
  ]);

  const merged: Record<string, unknown> = baseRec ? { ...baseRec } : {};
  const conflictingFields: string[] = [];

  for (const key of keys) {
    const baseValue = baseRec?.[key];
    const localValue = localRec[key];
    const remoteValue = remoteRec[key];

    if (valuesEqual(localValue, remoteValue)) {
      merged[key] = localValue;
    } else if (valuesEqual(baseValue, localValue)) {
      merged[key] = remoteValue;
    } else if (valuesEqual(baseValue, remoteValue)) {
      merged[key] = localValue;
    } else {
      conflictingFields.push(key);
      merged[key] = localValue;
    }
  }

  return { merged, conflictingFields };
}

function conflictId(itemId: string, itemKind: ItemKind, base: unknown, local: unknown, remote: unknown): string {
  return canonicalHash({ itemId, itemKind, base, local, remote }).slice(0, 16);
}

function createConflict<T extends KnowledgeItem>(
  itemKind: ItemKind,
  base: T | null,
  local: T | null,
  remote: T | null,
  conflictKind: ConflictKind,
  conflictingFields: string[],
  provenance: unknown[],
): ConflictBundle {
  const itemId =
    itemKind === 'page'
      ? ((local ?? remote ?? base) as WikiPage | null)?.pageId ?? ''
      : itemKind === 'memory'
        ? ((local ?? remote ?? base) as SharedMemory | null)?.memoryId ?? ''
        : ((local ?? remote ?? base) as KnowledgeRelation | null)?.relationId ?? '';
  return {
    id: conflictId(itemId, itemKind, base, local, remote),
    itemId,
    itemKind,
    conflictKind,
    base,
    local,
    remote,
    provenance,
    conflictingFields,
  };
}

function mergePage(base: WikiPage | null, local: WikiPage | null, remote: WikiPage | null): MergeItem<WikiPage> & { conflict: ConflictBundle | null } {
  const itemId = (local ?? remote ?? base)?.pageId ?? '';
  const { merged, conflictingFields } = mergeFields(base, local, remote);
  const conflict = conflictingFields.length > 0
    ? createConflict('page', base, local, remote, 'field', conflictingFields, [])
    : null;
  return { itemId, base, local, remote, conflictingFields, proposed: merged as WikiPage | null, conflict };
}

function mergeMemory(base: SharedMemory | null, local: SharedMemory | null, remote: SharedMemory | null): MergeItem<SharedMemory> & { conflict: ConflictBundle | null } {
  const itemId = (local ?? remote ?? base)?.memoryId ?? '';
  const { merged, conflictingFields } = mergeFields(base, local, remote);
  const conflict = conflictingFields.length > 0
    ? createConflict('memory', base, local, remote, 'field', conflictingFields, [])
    : null;
  return { itemId, base, local, remote, conflictingFields, proposed: merged as SharedMemory | null, conflict };
}

function mergeRelation(base: KnowledgeRelation | null, local: KnowledgeRelation | null, remote: KnowledgeRelation | null): MergeItem<KnowledgeRelation> & { conflict: ConflictBundle | null } {
  const itemId = (local ?? remote ?? base)?.relationId ?? '';
  const { merged, conflictingFields } = mergeFields(base, local, remote);
  const conflict = conflictingFields.length > 0
    ? createConflict('relation', base, local, remote, 'field', conflictingFields, [])
    : null;
  return { itemId, base, local, remote, conflictingFields, proposed: merged as KnowledgeRelation | null, conflict };
}

function indexById<T extends KnowledgeItem>(
  items: T[],
  idKey: keyof T & string,
): Map<string, T> {
  return new Map(items.map((item) => [String(item[idKey]), item]));
}

function buildDeletionMap(deletions: DeletionProposal[]): Map<string, DeletionProposal> {
  return new Map(deletions.map((d) => [d.itemId, d]));
}

export function mergeBundles(
  base: KnowledgeBundle,
  local: KnowledgeBundle,
  remote: KnowledgeBundle,
): MergeResult {
  const basePages = indexById(base.pages, 'pageId');
  const localPages = indexById(local.pages, 'pageId');
  const remotePages = indexById(remote.pages, 'pageId');
  const pageIds = new Set([...basePages.keys(), ...localPages.keys(), ...remotePages.keys()]);

  const baseMemories = indexById(base.memories, 'memoryId');
  const localMemories = indexById(local.memories, 'memoryId');
  const remoteMemories = indexById(remote.memories, 'memoryId');
  const memoryIds = new Set([...baseMemories.keys(), ...localMemories.keys(), ...remoteMemories.keys()]);

  const baseRelations = indexById(base.relations, 'relationId');
  const localRelations = indexById(local.relations, 'relationId');
  const remoteRelations = indexById(remote.relations, 'relationId');
  const relationIds = new Set([...baseRelations.keys(), ...localRelations.keys(), ...remoteRelations.keys()]);

  const conflicts: ConflictBundle[] = [];
  const pages: MergeItem<WikiPage>[] = [];
  for (const id of pageIds) {
    const merged = mergePage(basePages.get(id) ?? null, localPages.get(id) ?? null, remotePages.get(id) ?? null);
    if (merged.conflict) conflicts.push(merged.conflict);
    pages.push({ itemId: merged.itemId, base: merged.base, local: merged.local, remote: merged.remote, conflictingFields: merged.conflictingFields, proposed: merged.proposed });
  }

  const memories: MergeItem<SharedMemory>[] = [];
  for (const id of memoryIds) {
    const merged = mergeMemory(baseMemories.get(id) ?? null, localMemories.get(id) ?? null, remoteMemories.get(id) ?? null);
    if (merged.conflict) conflicts.push(merged.conflict);
    memories.push({ itemId: merged.itemId, base: merged.base, local: merged.local, remote: merged.remote, conflictingFields: merged.conflictingFields, proposed: merged.proposed });
  }

  const relations: MergeItem<KnowledgeRelation>[] = [];
  for (const id of relationIds) {
    const merged = mergeRelation(baseRelations.get(id) ?? null, localRelations.get(id) ?? null, remoteRelations.get(id) ?? null);
    if (merged.conflict) conflicts.push(merged.conflict);
    relations.push({ itemId: merged.itemId, base: merged.base, local: merged.local, remote: merged.remote, conflictingFields: merged.conflictingFields, proposed: merged.proposed });
  }

  const deletions: DeletionResult[] = [];
  const baseDeletions = buildDeletionMap(base.deletions);
  const localDeletions = buildDeletionMap(local.deletions);
  const remoteDeletions = buildDeletionMap(remote.deletions);
  const deletionIds = new Set([...baseDeletions.keys(), ...localDeletions.keys(), ...remoteDeletions.keys()]);

  for (const id of deletionIds) {
    const localDel = localDeletions.get(id) ?? null;
    const remoteDel = remoteDeletions.get(id) ?? null;
    const baseDel = baseDeletions.get(id) ?? null;
    let conflict: ConflictBundle | null = null;

    if (localDel && remoteDel && !valuesEqual(localDel, remoteDel)) {
      conflict = createConflict(localDel.itemType as ItemKind, null, null, null, 'delete-delete', [], []);
    } else if ((localDel || remoteDel) && (basePages.has(id) || baseMemories.has(id) || baseRelations.has(id)) && !(localDel && remoteDel)) {
      const itemKind = localDel?.itemType ?? remoteDel?.itemType ?? 'page';
      const baseItem = basePages.get(id) ?? baseMemories.get(id) ?? baseRelations.get(id) ?? null;
      conflict = createConflict(itemKind as ItemKind, baseItem, null, null, 'delete-modify', [], []);
    }

    deletions.push({ itemId: id, itemKind: (localDel?.itemType ?? remoteDel?.itemType ?? 'page') as ItemKind, base: baseDel as unknown as KnowledgeItem | null, local: localDel, remote: remoteDel, conflict });
  }

  return { pages, memories, relations, conflicts, deletions };
}

export function applyConflictResolution<T extends KnowledgeItem>(
  result: MergeResult,
  conflictId: string,
  resolved: T,
): MergeResult {
  const conflict = result.conflicts.find((c) => c.id === conflictId);
  if (!conflict) throw new Error(`Conflict ${conflictId} not found`);

  const replaceIn = <U extends KnowledgeItem>(items: MergeItem<U>[], idSelector: (item: U) => string): MergeItem<U>[] => {
    return items.map((item) => {
      if (idSelector(item.local ?? item.remote ?? item.base ?? resolved as unknown as U) !== conflict.itemId) return item;
      return { ...item, proposed: resolved as unknown as U, conflictingFields: [] };
    });
  };

  const remaining = result.conflicts.filter((c) => c.id !== conflictId);

  if (conflict.itemKind === 'page') {
    return { ...result, pages: replaceIn(result.pages, (p) => (p as WikiPage).pageId), conflicts: remaining };
  }
  if (conflict.itemKind === 'memory') {
    return { ...result, memories: replaceIn(result.memories, (m) => (m as SharedMemory).memoryId), conflicts: remaining };
  }
  return { ...result, relations: replaceIn(result.relations, (r) => (r as KnowledgeRelation).relationId), conflicts: remaining };
}
