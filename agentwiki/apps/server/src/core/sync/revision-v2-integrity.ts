export interface RevisionV2MarkerEvidence {
  schemaVersion: string | null | undefined;
  recipeVersion: string | null | undefined;
  sidecar: unknown;
  folderRowCount: number;
  hasPlacedPage: boolean;
  treeDeltaRowCount: number;
  migrationBatchId: string | null | undefined;
  parentShouldBeV2?: boolean;
}

export interface RevisionChainNode {
  id: string;
  spaceId: string;
  sequence: number;
  parentRevisionId: string | null;
}

/** Prevent immutable readers/writers from hydrating legacy snapshot/delta JSON. */
export const REVISION_V2_SCALAR_SELECT = {
  id: true,
  spaceId: true,
  sequence: true,
  parentRevisionId: true,
  schemaVersion: true,
  recipeVersion: true,
  revisionContentHash: true,
  pageCount: true,
  revisionManifestByteLength: true,
  revisionBodyBytes: true,
  migrationBatchId: true,
  createdAt: true,
} as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function hasRevisionV2SidecarMarker(sidecar: unknown): boolean {
  const migration = record(record(sidecar)?.spaceFolderMigration);
  return !!migration && Object.prototype.hasOwnProperty.call(migration, 'v2Revision');
}

/**
 * Every persisted signal that identifies a Folder-aware revision belongs here.
 * Reader and writer must use this predicate so a partial marker cannot silently
 * downgrade either the current revision or its exact predecessor to legacy.
 */
export function revisionShouldBeV2(evidence: RevisionV2MarkerEvidence): boolean {
  return evidence.schemaVersion === 'content-tree@2'
    || evidence.recipeVersion === 'space-folders-v1'
    || hasRevisionV2SidecarMarker(evidence.sidecar)
    || evidence.folderRowCount > 0
    || evidence.hasPlacedPage
    || evidence.treeDeltaRowCount > 0
    || (typeof evidence.migrationBatchId === 'string'
      && evidence.migrationBatchId.startsWith('space-folders-v1:'))
    || evidence.parentShouldBeV2 === true;
}

/**
 * The authoritative revision writer contract is a strict singly-linked chain:
 * sequence one has no parent, and every later revision points at sequence - 1
 * in the same Space. Strict descent also makes cycles impossible without a
 * recursive walk.
 */
export function hasExactRevisionPredecessor(
  current: RevisionChainNode,
  parent: RevisionChainNode | null,
): boolean {
  if (!Number.isSafeInteger(current.sequence) || current.sequence < 1) return false;
  if (current.sequence === 1) return current.parentRevisionId === null && parent === null;
  if (!current.parentRevisionId || !parent) return false;
  return parent.id === current.parentRevisionId
    && parent.id !== current.id
    && parent.spaceId === current.spaceId
    && Number.isSafeInteger(parent.sequence)
    && parent.sequence === current.sequence - 1;
}

/** Validate an entire chain already loaded by one set-based Space query. */
export function hasCompleteRevisionChain(
  current: RevisionChainNode,
  ancestors: readonly RevisionChainNode[],
): boolean {
  if (!Number.isSafeInteger(current.sequence) || current.sequence < 1) return false;
  if (ancestors.length !== current.sequence - 1) return false;
  const bySequence = new Map<number, RevisionChainNode>();
  for (const ancestor of ancestors) {
    if (
      ancestor.spaceId !== current.spaceId
      || !Number.isSafeInteger(ancestor.sequence)
      || ancestor.sequence < 1
      || ancestor.sequence >= current.sequence
      || bySequence.has(ancestor.sequence)
    ) return false;
    bySequence.set(ancestor.sequence, ancestor);
  }
  let child = current;
  for (let sequence = current.sequence - 1; sequence >= 1; sequence -= 1) {
    const parent = bySequence.get(sequence) ?? null;
    if (!hasExactRevisionPredecessor(child, parent)) return false;
    child = parent!;
  }
  return hasExactRevisionPredecessor(child, null);
}
