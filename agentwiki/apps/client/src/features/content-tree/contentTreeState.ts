import type { ContentTreeNode } from './contentTreeTypes';

export type MovePosition = 'into' | 'before' | 'after';

export interface ContentMoveRequest {
  kind: 'folder' | 'page';
  id: string;
  targetFolderId: string | null;
  beforeId?: string;
  position: MovePosition;
}

export interface DragInfo {
  kind: 'folder' | 'page';
  id: string;
}

export interface Crumb {
  id: string | null;
  name: string;
}

export interface FolderIndexEntry {
  id: string;
  parentId: string | null;
  name: string;
}

export type FolderIndex = ReadonlyMap<string, FolderIndexEntry>;

export const createFolderIndex = (): Map<string, FolderIndexEntry> => new Map();

export const registerFolders = (
  index: Map<string, FolderIndexEntry>,
  nodes: readonly ContentTreeNode[],
  inheritedParentId: string | null,
): void => {
  for (const node of nodes) {
    if (node.kind === 'folder') {
      index.set(node.id, { id: node.id, parentId: inheritedParentId, name: node.name });
    }
  }
};

/** Build breadcrumbs for a folder by walking the registered parent chain. */
export const crumbsForFolder = (
  index: FolderIndex,
  folderId: string | null,
  rootLabel: string,
): Crumb[] => {
  const chain: Crumb[] = [];
  let cursor = folderId;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const entry = index.get(cursor);
    if (!entry) break;
    chain.unshift({ id: entry.id, name: entry.name });
    cursor = entry.parentId;
  }
  return [{ id: null, name: rootLabel }, ...chain];
};

export const sortNodes = (nodes: ContentTreeNode[]): ContentTreeNode[] => {
  const rank = (node: ContentTreeNode) => (node.kind === 'folder' ? 0 : 1);
  return [...nodes].sort((left, right) => {
    if (rank(left) !== rank(right)) return rank(left) - rank(right);
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.id.localeCompare(right.id);
  });
};

/** True when candidateId is the dragged node itself or one of its descendants. */
export const isSelfOrDescendantFolder = (
  index: FolderIndex,
  draggedId: string,
  candidateId: string | null,
): boolean => {
  if (candidateId === null) return false;
  if (candidateId === draggedId) return true;
  let cursor: string | null = candidateId;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    if (cursor === draggedId) return true;
    const entry = index.get(cursor);
    if (!entry) return false;
    cursor = entry.parentId;
  }
  return false;
};

/**
 * Build a move request for a drag onto a visible sibling row.
 * "into" targets the row itself (folders only); "before"/"after" reorder
 * within the currently listed level, so the move parent must be that level's
 * parent folder — the server requires beforeId to be a sibling of it.
 */
export const buildMoveRequest = (
  drag: DragInfo | null,
  target: ContentTreeNode,
  position: MovePosition,
  levelParentFolderId: string | null,
): ContentMoveRequest | null => {
  if (!drag || drag.id === target.id) return null;
  if (position !== 'into' && drag.kind !== target.kind) return null;
  if (position === 'into') {
    if (target.kind !== 'folder') return null;
    return { kind: drag.kind, id: drag.id, targetFolderId: target.id, position };
  }
  const targetParent = target.kind === 'page' ? target.folderId : levelParentFolderId;
  return {
    kind: drag.kind,
    id: drag.id,
    targetFolderId: targetParent,
    beforeId: target.id,
    position,
  };
};
