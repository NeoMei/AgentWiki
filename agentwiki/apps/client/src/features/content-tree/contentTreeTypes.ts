export interface ContentTreeFolderNode {
  kind: 'folder';
  id: string;
  name: string;
  path: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  hasChildren: boolean;
}

export interface ContentTreePageNode {
  kind: 'page';
  id: string;
  folderId: string | null;
  title: string;
  path: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type ContentTreeNode = ContentTreeFolderNode | ContentTreePageNode;

export interface ContentTreeListResponse {
  spaceId: string;
  treeRevision: string;
  parentFolderId: string | null;
  data: ContentTreeNode[];
  nextCursor: string | null;
}

export interface FolderListItem {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface FolderMutationResponse {
  folder: FolderListItem;
  treeRevision: string;
}

export interface DeleteImpactResponse {
  treeRevision: string;
  rootUpdatedAt: string;
  folderCount: number;
  pageCount: number;
  impactHash: string;
}

export interface DeletedFolderBatch {
  id: string;
  folderCount: number;
  pageCount: number;
  impactHash: string;
  createdAt: string;
}

export interface DeletedFolderResponse {
  treeRevision: string;
  syncRevisionId: string;
  batch: DeletedFolderBatch;
}

export interface RestoreFolderPayload {
  deletionBatchId: string;
  expectedUpdatedAt: string;
  expectedTreeRevision: string;
  mode: 'original' | 'root' | 'rename-root';
  name?: string;
}

export interface RestoreFolderResponse {
  treeRevision: string;
  syncRevisionId: string;
  batchId: string;
  folder: {
    id: string;
    parentId: string | null;
    name: string;
    path: string;
    pathKey: string;
    updatedAt: string;
  };
}

export interface MoveNodePayload {
  kind: 'folder' | 'page';
  id: string;
  targetParentFolderId: string | null;
  beforeId?: string;
  expectedTreeRevision: string;
  expectedUpdatedAt: string;
}
