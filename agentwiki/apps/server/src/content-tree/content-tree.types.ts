export type ContentTreeErrorCode =
  | 'SPACE_NOT_FOUND'
  | 'FOLDER_NOT_FOUND'
  | 'FOLDER_NAME_CONFLICT'
  | 'FOLDER_INVALID_NAME'
  | 'FOLDER_DEPTH_LIMIT'
  | 'FOLDER_COUNT_LIMIT'
  | 'FOLDER_PATH_TOO_LONG'
  | 'CONTENT_TREE_CONFLICT'
  | 'CONTENT_TREE_CURSOR_INVALID'
  | 'CONTENT_TREE_PAGE_NOT_FOUND'
  | 'CONTENT_TREE_INVALID_ACTOR'
  | 'CONTENT_TREE_TAKE_INVALID';

export class ContentTreeError extends Error {
  constructor(
    readonly code: ContentTreeErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ContentTreeError';
  }
}

export class ContentTreeConflict extends ContentTreeError {
  constructor(expected: bigint | Date, actual: bigint | Date) {
    super('CONTENT_TREE_CONFLICT', 'The content tree changed; reload before retrying', {
      expected: expected instanceof Date ? expected.toISOString() : expected.toString(),
      actual: actual instanceof Date ? actual.toISOString() : actual.toString(),
    });
    this.name = 'ContentTreeConflict';
  }
}

export interface ContentTreeActor {
  userId?: string;
  agentId?: string;
}

export interface CreateFolderInput {
  spaceId: string;
  name: string;
  parentId: string | null;
  expectedTreeRevision: bigint;
  actor: ContentTreeActor;
}

export interface MoveTreeNodeInput {
  spaceId: string;
  kind: 'folder' | 'page';
  nodeId: string;
  targetFolderId: string | null;
  beforeId?: string;
  expectedTreeRevision: bigint;
  expectedUpdatedAt: Date;
}

export interface PlacePageInput {
  spaceId: string;
  pageId: string;
  folderId: string | null;
  expectedTreeRevision: bigint;
  expectedUpdatedAt: Date;
  actor: ContentTreeActor;
}

export interface ListChildrenInput {
  spaceId: string;
  parentFolderId?: string | null;
  cursor?: string;
  take?: number;
}

export interface ContentTreeFolderNode {
  kind: 'folder';
  id: string;
  name: string;
  path: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  hasChildren: boolean;
}

export interface ContentTreePageNode {
  kind: 'page';
  id: string;
  folderId: string | null;
  title: string;
  path: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ContentTreeNode = ContentTreeFolderNode | ContentTreePageNode;

export interface ContentTreeListResult {
  spaceId: string;
  treeRevision: bigint;
  parentFolderId: string | null;
  data: ContentTreeNode[];
  nextCursor: string | null;
}

export interface CreatedFolderResult {
  folder: {
    id: string;
    spaceId: string;
    parentId: string | null;
    name: string;
    nameKey: string;
    path: string;
    pathKey: string;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  };
  treeRevision: bigint;
  syncRevisionId: string;
}

export interface PlacedPageResult {
  page: {
    id: string;
    folderId: string | null;
    syncPath: string;
    updatedAt: Date;
  };
  treeRevision: bigint;
  syncRevisionId: string;
}
