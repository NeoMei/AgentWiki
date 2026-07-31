import type { WikiPage, SharedMemory, KnowledgeRelation, KnowledgeBundle } from '../protocol/bundle.js';

export interface MergeItem<T> {
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
}

function pickFields(obj: Record<string, unknown> | null): string[] {
  if (!obj) return [];
  return Object.keys(obj);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function mergePage(base: WikiPage | null, local: WikiPage | null, remote: WikiPage | null): MergeItem<WikiPage> {
  const itemId = (local ?? remote ?? base)?.pageId ?? '';
  const ignoredKeys = new Set(["contentHash", "updatedAt"]);
  const keys = new Set<string>([
    ...pickFields(base as Record<string, unknown> | null).filter((k) => !ignoredKeys.has(k)),
    ...pickFields(local as Record<string, unknown> | null).filter((k) => !ignoredKeys.has(k)),
    ...pickFields(remote as Record<string, unknown> | null).filter((k) => !ignoredKeys.has(k)),
  ]);

  const conflictingFields: string[] = [];
  let proposed: WikiPage | null = null;

  if (local && remote) {
    const merged = { ...(base as Record<string, unknown>) } as Record<string, unknown>;
    for (const key of keys) {
      const baseValue = base ? (base as Record<string, unknown>)[key] : undefined;
      const localValue = local ? (local as Record<string, unknown>)[key] : undefined;
      const remoteValue = remote ? (remote as Record<string, unknown>)[key] : undefined;

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
    proposed = merged as WikiPage;
  } else if (local) {
    proposed = local;
  } else if (remote) {
    proposed = remote;
  }

  return { itemId, base, local, remote, conflictingFields, proposed };
}

function mergeMemory(base: SharedMemory | null, local: SharedMemory | null, remote: SharedMemory | null): MergeItem<SharedMemory> {
  const itemId = (local ?? remote ?? base)?.memoryId ?? '';
  return { itemId, base, local, remote, conflictingFields: [], proposed: local ?? remote ?? base };
}

function mergeRelation(base: KnowledgeRelation | null, local: KnowledgeRelation | null, remote: KnowledgeRelation | null): MergeItem<KnowledgeRelation> {
  const itemId = (local ?? remote ?? base)?.relationId ?? '';
  return { itemId, base, local, remote, conflictingFields: [], proposed: local ?? remote ?? base };
}

export function mergeBundles(
  base: KnowledgeBundle,
  local: KnowledgeBundle,
  remote: KnowledgeBundle,
): MergeResult {
  const pageIds = new Set([
    ...base.pages.map((p) => p.pageId),
    ...local.pages.map((p) => p.pageId),
    ...remote.pages.map((p) => p.pageId),
  ]);

  const pages: MergeItem<WikiPage>[] = [];
  for (const id of pageIds) {
    pages.push(mergePage(
      base.pages.find((p) => p.pageId === id) ?? null,
      local.pages.find((p) => p.pageId === id) ?? null,
      remote.pages.find((p) => p.pageId === id) ?? null,
    ));
  }

  const memoryIds = new Set([
    ...base.memories.map((m) => m.memoryId),
    ...local.memories.map((m) => m.memoryId),
    ...remote.memories.map((m) => m.memoryId),
  ]);
  const memories: MergeItem<SharedMemory>[] = [];
  for (const id of memoryIds) {
    memories.push(mergeMemory(
      base.memories.find((m) => m.memoryId === id) ?? null,
      local.memories.find((m) => m.memoryId === id) ?? null,
      remote.memories.find((m) => m.memoryId === id) ?? null,
    ));
  }

  const relationIds = new Set([
    ...base.relations.map((r) => r.relationId),
    ...local.relations.map((r) => r.relationId),
    ...remote.relations.map((r) => r.relationId),
  ]);
  const relations: MergeItem<KnowledgeRelation>[] = [];
  for (const id of relationIds) {
    relations.push(mergeRelation(
      base.relations.find((r) => r.relationId === id) ?? null,
      local.relations.find((r) => r.relationId === id) ?? null,
      remote.relations.find((r) => r.relationId === id) ?? null,
    ));
  }

  return { pages, memories, relations };
}
