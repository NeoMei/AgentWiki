import api from '../../api/client';
import { getContentTreeRevision } from '../../api/content-tree';
import type {
  ContentTreeListResponse,
  DeletedFolderResponse,
  DeleteImpactResponse,
  FolderMutationResponse,
  MoveNodePayload,
  RestoreFolderPayload,
  RestoreFolderResponse,
} from './contentTreeTypes';

export { getContentTreeRevision };

/** The server caps content-tree page size at 200. */
const TREE_PAGE_SIZE = 200;

export async function listTreeChildren(
  spaceId: string,
  parentFolderId: string | null,
  signal?: AbortSignal,
): Promise<ContentTreeListResponse> {
  const encodedSpaceId = encodeURIComponent(spaceId);
  let cursor: string | undefined;
  let merged: ContentTreeListResponse | undefined;
  const nodes: ContentTreeListResponse['data'] = [];
  do {
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
    merged = response.data;
    nodes.push(...merged.data);
    cursor = merged.nextCursor ?? undefined;
  } while (cursor);
  return { ...merged!, data: nodes };
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
