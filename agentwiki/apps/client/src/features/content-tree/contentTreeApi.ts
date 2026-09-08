import api from '../../api/client';
import { getContentTreeRevision } from '../../api/content-tree';
import type {
  ContentTreeListResponse,
  DeletedFolderResponse,
  DeleteImpactResponse,
  FolderListResponse,
  FolderMutationResponse,
  MoveNodePayload,
  RestoreFolderPayload,
  RestoreFolderResponse,
} from './contentTreeTypes';

export { getContentTreeRevision };

/** The server caps content-tree page size at 200. */
const TREE_PAGE_SIZE = 200;
const COHERENT_READ_ATTEMPTS = 2;

export class TreeRevisionChangedError extends Error {
  constructor() {
    super('The directory changed while it was loading. Please retry.');
  }
}

async function listCoherentPages<T extends { treeRevision: string; data: unknown[]; nextCursor: string | null }>(
  readPage: (cursor?: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < COHERENT_READ_ATTEMPTS; attempt += 1) {
    let cursor: string | undefined;
    let first: T | undefined;
    let last: T | undefined;
    const data: unknown[] = [];
    try {
      do {
        const page = await readPage(cursor);
        first ??= page;
        if (page.treeRevision !== first.treeRevision) throw new TreeRevisionChangedError();
        last = page;
        data.push(...page.data);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return { ...last!, treeRevision: first.treeRevision, data } as T;
    } catch (error) {
      if (!(error instanceof TreeRevisionChangedError) || attempt + 1 === COHERENT_READ_ATTEMPTS) throw error;
    }
  }
  throw new TreeRevisionChangedError();
}

export async function listTreeChildren(
  spaceId: string,
  parentFolderId: string | null,
  signal?: AbortSignal,
): Promise<ContentTreeListResponse> {
  const encodedSpaceId = encodeURIComponent(spaceId);
  return listCoherentPages(async (cursor) => {
    const response = await api.get<ContentTreeListResponse>(
      `/spaces/${encodedSpaceId}/content-tree`,
      {
        params: {
          parentFolderId: parentFolderId ?? undefined,
          take: TREE_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        },
        signal,
      },
    );
    return response.data;
  });
}

export interface FolderAncestryResult {
  folders: ReadonlyMap<string, FolderListResponse['data'][number]>;
  ancestorIds: string[];
  treeRevision: string;
}

const ancestryFrom = (
  folders: ReadonlyMap<string, FolderListResponse['data'][number]>,
  targetFolderId: string,
): string[] | null => {
  const result: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = targetFolderId;
  while (cursor) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    const folder = folders.get(cursor);
    if (!folder) return null;
    result.unshift(folder.id);
    cursor = folder.parentId;
  }
  return result;
};

export async function listFolderAncestry(
  spaceId: string,
  targetFolderId: string,
  signal?: AbortSignal,
): Promise<FolderAncestryResult> {
  const encodedSpaceId = encodeURIComponent(spaceId);
  for (let attempt = 0; attempt < COHERENT_READ_ATTEMPTS; attempt += 1) {
    let cursor: string | undefined;
    let revision: string | null = null;
    const folders = new Map<string, FolderListResponse['data'][number]>();
    try {
      do {
        const response = await api.get<FolderListResponse>(`/spaces/${encodedSpaceId}/folders`, {
          params: { take: TREE_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
          signal,
        });
        revision ??= response.data.treeRevision;
        if (response.data.treeRevision !== revision) throw new TreeRevisionChangedError();
        for (const folder of response.data.data) folders.set(folder.id, folder);
        const ancestorIds = ancestryFrom(folders, targetFolderId);
        if (ancestorIds) return { folders, ancestorIds, treeRevision: revision };
        cursor = response.data.nextCursor ?? undefined;
      } while (cursor);
      return { folders, ancestorIds: [], treeRevision: revision ?? '', };
    } catch (error) {
      if (!(error instanceof TreeRevisionChangedError) || attempt + 1 === COHERENT_READ_ATTEMPTS) throw error;
    }
  }
  throw new TreeRevisionChangedError();
}

export async function createFolder(
  spaceId: string,
  name: string,
  parentId: string | null,
  expectedTreeRevision: string,
  signal?: AbortSignal,
): Promise<FolderMutationResponse> {
  const response = await api.post<FolderMutationResponse>(
    `/spaces/${encodeURIComponent(spaceId)}/folders`,
    { name, parentId, expectedTreeRevision },
    { signal },
  );
  return response.data;
}

export async function renameFolder(
  spaceId: string,
  folderId: string,
  name: string,
  expectedTreeRevision: string,
  expectedUpdatedAt: string,
  signal?: AbortSignal,
): Promise<FolderMutationResponse> {
  const response = await api.patch<FolderMutationResponse>(
    `/spaces/${encodeURIComponent(spaceId)}/folders/${encodeURIComponent(folderId)}`,
    { name, expectedTreeRevision, expectedUpdatedAt },
    { signal },
  );
  return response.data;
}

export async function moveTreeNode(
  spaceId: string,
  payload: MoveNodePayload,
  signal?: AbortSignal,
): Promise<ContentTreeListResponse> {
  const response = await api.patch<ContentTreeListResponse>(
    `/spaces/${encodeURIComponent(spaceId)}/content-tree/move`,
    {
      kind: payload.kind,
      id: payload.id,
      targetParentFolderId: payload.targetParentFolderId,
      ...(payload.beforeId ? { beforeId: payload.beforeId } : {}),
      expectedTreeRevision: payload.expectedTreeRevision,
      expectedUpdatedAt: payload.expectedUpdatedAt,
    },
    { signal },
  );
  return response.data;
}

export async function getDeleteImpact(
  spaceId: string,
  folderId: string,
  signal?: AbortSignal,
): Promise<DeleteImpactResponse> {
  const response = await api.get<DeleteImpactResponse>(
    `/spaces/${encodeURIComponent(spaceId)}/folders/${encodeURIComponent(folderId)}/delete-impact`,
    { signal },
  );
  return response.data;
}

export async function deleteFolder(
  spaceId: string,
  folderId: string,
  body: { expectedTreeRevision: string; expectedUpdatedAt: string; expectedImpactHash: string },
  signal?: AbortSignal,
): Promise<DeletedFolderResponse> {
  const response = await api.delete<DeletedFolderResponse>(
    `/spaces/${encodeURIComponent(spaceId)}/folders/${encodeURIComponent(folderId)}`,
    { data: body, signal },
  );
  return response.data;
}

export async function restoreFolder(
  spaceId: string,
  folderId: string,
  payload: RestoreFolderPayload,
  signal?: AbortSignal,
): Promise<RestoreFolderResponse> {
  const response = await api.post<RestoreFolderResponse>(
    `/spaces/${encodeURIComponent(spaceId)}/folders/${encodeURIComponent(folderId)}/restore`,
    payload,
    { signal },
  );
  return response.data;
}
