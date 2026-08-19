import type {
  BundleProvenance,
  DeletionProposal,
  KnowledgeBundle,
  KnowledgeRelation,
  SharedMemory,
  WikiPage,
} from '../protocol/bundle.js';
import { GeneratedOwnershipSchema } from '../protocol/bundle.js';
import { stableId } from '../utils/id.js';

export interface ReconcileScope {
  sourceKeys: Set<string>;
  ownedLayers: Set<'base' | 'deep'>;
}

export interface AnalysisLayerReconciliation {
  bundle: KnowledgeBundle;
  added: number;
  modified: number;
  deleted: number;
  carried: number;
  warnings: string[];
  retainedProvenanceIds: Set<string>;
}

type ItemType = 'page' | 'memory' | 'relation';
type Item = WikiPage | SharedMemory | KnowledgeRelation;
type Origin = 'base' | 'generated';

interface SelectedItem {
  type: ItemType;
  item: Item;
  origin: Origin;
}

interface AnalysisIdentity {
  sourceKey: string;
  layer: 'base' | 'deep';
  snapshotHash?: string;
  logicalKey?: string;
}

/**
 * Replaces only the explicitly owned CodeGraph analysis layer. Everything
 * outside that source/layer boundary remains in the preview bundle, so a
 * standard scan can never erase unrelated knowledge or uninstalled deep work.
 */
export function reconcileAnalysisLayers(
  base: KnowledgeBundle,
  generated: KnowledgeBundle,
  scope: ReconcileScope,
): AnalysisLayerReconciliation {
  const normalizedScope = normalizeScope(scope);
  const baseItems = collectItems(base, 'base');
  const generatedItems = collectItems(generated, 'generated');
  const selected = new Map<string, SelectedItem>();
  const proposals: DeletionProposal[] = [];
  const warnings = new Set<string>();
  let carried = 0;

  const generatedSnapshotHashes = snapshotsBySource(generatedItems);
  for (const [key, candidate] of baseItems) {
    // Historical projections carry no durable producer marker. A matching
    // title/path tuple is only a migration candidate, never deletion proof.
    if (candidate.type === 'page' && isWikiPage(candidate.item) && isRetiredOverviewCandidate(candidate.item)) {
      selected.set(key, candidate);
      carried += 1;
      warnings.add(`Legacy migration candidate retained: legacy-${stableId('agentwiki:legacy-migration-candidate', itemId(candidate.item)).slice(0, 12)}`);
      continue;
    }

    if (isOwned(candidate, normalizedScope)) {
      const replacement = generatedItems.get(key);
      if (replacement && isOwned(replacement, normalizedScope)) {
        selected.set(key, replacement);
      } else {
        proposals.push(deletion(candidate.type, candidate.item, 'CodeGraph base analysis is no longer generated for this source'));
      }
      continue;
    }

    const replacement = generatedItems.get(key);
    if (replacement && !isCodeGraphItem(replacement)) {
      selected.set(key, replacement);
    } else {
      selected.set(key, candidate);
      carried += 1;
    }
    const identity = analysisIdentity(candidate.item);
    if (identity?.layer === 'deep' && normalizedScope.sourceKeys.has(identity.sourceKey)) {
      const currentHashes = generatedSnapshotHashes.get(identity.sourceKey);
      if (identity.snapshotHash && currentHashes?.size && !currentHashes.has(identity.snapshotHash)) {
        warnings.add(`Stale deep CodeGraph analysis retained for ${safeLogicalIdentity(identity, candidate.item)}`);
      }
    }
  }

  for (const [key, candidate] of generatedItems) {
    if (baseItems.has(key)) continue;
    selected.set(key, candidate);
  }

  const finalItems = removeDanglingRelations(selected, proposals);
  const finalIds = new Set(Array.from(finalItems.values()).map(({ item }) => itemId(item)));
  const provenance = reconcileProvenance(base, generated, finalItems, finalIds);
  const deletions = reconcileDeletions(base, generated, proposals, finalIds);
  const ordered = Array.from(finalItems.values()).sort((a, b) => codeUnitCompare(itemKey(a.type, a.item), itemKey(b.type, b.item)));
  const bundle: KnowledgeBundle = {
    ...generated,
    baseRevision: base.baseRevision,
    pages: ordered.filter((candidate): candidate is SelectedItem & { item: WikiPage } => candidate.type === 'page').map((candidate) => candidate.item),
    memories: ordered.filter((candidate): candidate is SelectedItem & { item: SharedMemory } => candidate.type === 'memory').map((candidate) => candidate.item),
    relations: ordered.filter((candidate): candidate is SelectedItem & { item: KnowledgeRelation } => candidate.type === 'relation').map((candidate) => candidate.item),
    provenance,
    deletions,
  };

  const before = collectItems(base, 'base');
  let added = 0;
  let modified = 0;
  for (const [key, candidate] of finalItems) {
    const previous = before.get(key);
    if (!previous) added += 1;
    else if (!sameItem(previous.item, candidate.item)) modified += 1;
  }
  const baseDeletionIds = new Set(base.deletions.map((proposal) => proposal.deletionId));
  const retainedProvenanceIds = new Set(Array.from(finalItems.values())
    .filter((candidate) => candidate.origin === 'base')
    .map((candidate) => itemId(candidate.item))
    .filter((id) => provenance.some((record) => record.itemId === id)));
  return {
    bundle,
    added,
    modified,
    deleted: deletions.filter((proposal) => !baseDeletionIds.has(proposal.deletionId)).length,
    carried,
    warnings: Array.from(warnings).sort(codeUnitCompare),
    retainedProvenanceIds,
  };
}

function collectItems(bundle: KnowledgeBundle, origin: Origin): Map<string, SelectedItem> {
  const candidates: SelectedItem[] = [
    ...bundle.pages.map((item) => ({ type: 'page' as const, item, origin })),
    ...bundle.memories.map((item) => ({ type: 'memory' as const, item, origin })),
    ...bundle.relations.map((item) => ({ type: 'relation' as const, item, origin })),
  ].sort((a, b) => {
    const key = codeUnitCompare(itemKey(a.type, a.item), itemKey(b.type, b.item));
    return key || codeUnitCompare(canonicalJson(a.item), canonicalJson(b.item));
  });
  const result = new Map<string, SelectedItem>();
  for (const candidate of candidates) {
    const key = itemKey(candidate.type, candidate.item);
    const existing = result.get(key);
    if (existing && canonicalJson(existing.item) !== canonicalJson(candidate.item)) throw new Error(`Conflicting knowledge item ID ${key}`);
    if (!existing) result.set(key, candidate);
  }
  return result;
}

function snapshotsBySource(items: Map<string, SelectedItem>): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const candidate of items.values()) {
    const identity = analysisIdentity(candidate.item);
    if (!identity?.snapshotHash) continue;
    const hashes = result.get(identity.sourceKey) ?? new Set<string>();
    hashes.add(identity.snapshotHash);
    result.set(identity.sourceKey, hashes);
  }
  return result;
}

function analysisIdentity(item: Item): AnalysisIdentity | null {
  const ownership = 'ownership' in item ? item.ownership : ('metadata' in item ? item.metadata?.ownership : undefined);
  const parsed = GeneratedOwnershipSchema.safeParse(ownership);
  if (!parsed.success) return null;
  const { sourceKey, analysisLayer: layer, snapshotHash, logicalKey } = parsed.data;
  return {
    sourceKey,
    layer,
    snapshotHash,
    logicalKey,
  };
}

function isOwned(candidate: SelectedItem, scope: ReconcileScope): boolean {
  const identity = analysisIdentity(candidate.item);
  return identity !== null && scope.sourceKeys.has(identity.sourceKey) && scope.ownedLayers.has(identity.layer);
}

function isCodeGraphItem(candidate: SelectedItem): boolean {
  return analysisIdentity(candidate.item) !== null;
}

function isRetiredOverviewCandidate(page: WikiPage): boolean {
  return page.path === 'code/architecture/overview.md' && page.title === 'Codebase architecture';
}

function safeLogicalIdentity(identity: AnalysisIdentity, item: Item): string {
  void identity;
  return `deep-${stableId('agentwiki:stale-deep', itemId(item)).slice(0, 12)}`;
}

const SOURCE_KEY = /^[a-f0-9]{64}$/u;

function normalizeScope(scope: ReconcileScope): ReconcileScope {
  const rawSourceKeys = [...scope.sourceKeys];
  if (rawSourceKeys.length === 0) throw new Error('CodeGraph source scope is required');
  if (rawSourceKeys.some((sourceKey) => !SOURCE_KEY.test(sourceKey))) throw new Error('Invalid CodeGraph source key');
  const sourceKeys = rawSourceKeys.sort(codeUnitCompare);
  return {
    sourceKeys: new Set(sourceKeys),
    ownedLayers: new Set([...scope.ownedLayers].sort(codeUnitCompare)),
  };
}

function removeDanglingRelations(selected: Map<string, SelectedItem>, proposals: DeletionProposal[]): Map<string, SelectedItem> {
  const ids = new Set(Array.from(selected.values()).filter(({ type }) => type !== 'relation').map(({ item }) => itemId(item)));
  const result = new Map(selected);
  for (const [key, candidate] of result) {
    if (candidate.type !== 'relation') continue;
    const relation = candidate.item as KnowledgeRelation;
    if (!ids.has(relation.sourceId) || !ids.has(relation.targetId)) {
      result.delete(key);
      proposals.push(deletion('relation', relation, 'Relation references an item removed from this preview'));
    }
  }
  return result;
}

function reconcileProvenance(
  base: KnowledgeBundle,
  generated: KnowledgeBundle,
  selected: Map<string, SelectedItem>,
  finalIds: Set<string>,
): BundleProvenance[] {
  const baseRecords = provenanceByItem(base.provenance);
  const generatedRecords = provenanceByItem(generated.provenance);
  const records: BundleProvenance[] = [];
  for (const candidate of selected.values()) {
    const id = itemId(candidate.item);
    const record = candidate.origin === 'generated' ? generatedRecords.get(id) : baseRecords.get(id);
    if (record) records.push(record);
  }
  return dedupeBy(records, (record) => record.itemId).filter((record) => finalIds.has(record.itemId)).sort((a, b) => codeUnitCompare(a.itemId, b.itemId));
}

function reconcileDeletions(
  base: KnowledgeBundle,
  generated: KnowledgeBundle,
  proposals: DeletionProposal[],
  finalIds: Set<string>,
): DeletionProposal[] {
  const all = [...base.deletions, ...generated.deletions, ...proposals]
    .filter((proposal) => !finalIds.has(proposal.itemId));
  return dedupeBy(all, (proposal) => proposal.deletionId).sort((a, b) => codeUnitCompare(a.deletionId, b.deletionId));
}

function provenanceByItem(records: BundleProvenance[]): Map<string, BundleProvenance> {
  return new Map(dedupeBy(records, (record) => record.itemId).map((record) => [record.itemId, record]));
}

function dedupeBy<T>(values: T[], key: (value: T) => string): T[] {
  const ordered = [...values].sort((a, b) => {
    const id = codeUnitCompare(key(a), key(b));
    return id || codeUnitCompare(canonicalJson(a), canonicalJson(b));
  });
  const result = new Map<string, T>();
  for (const value of ordered) {
    const id = key(value);
    const existing = result.get(id);
    if (existing && canonicalJson(existing) !== canonicalJson(value)) throw new Error(`Conflicting canonical ID ${id}`);
    if (!existing) result.set(id, value);
  }
  return Array.from(result.values());
}

function deletion(type: ItemType, item: Item, reason: string): DeletionProposal {
  const id = itemId(item);
  return { deletionId: `del-${id}`, itemType: type, itemId: id, reason };
}

function itemKey(type: ItemType, item: Item): string {
  void type;
  return itemId(item);
}

function itemId(item: Item): string {
  if ('pageId' in item) return item.pageId;
  if ('memoryId' in item) return item.memoryId;
  return item.relationId;
}

function isWikiPage(item: Item): item is WikiPage {
  return 'pageId' in item;
}

function sameItem(a: Item, b: Item): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort(codeUnitCompare).map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
