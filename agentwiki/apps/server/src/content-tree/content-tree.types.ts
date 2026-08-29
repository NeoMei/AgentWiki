import { BusinessException } from '../core/filters/business-error';
import type {
  RevisionOrigin,
  StructuralPageChange,
} from '../core/sync/space-revision-writer.service';
import type { TreePushChangeV2 } from '@neomei/agentwiki-sync-protocol';

export type ContentTreeErrorCode =
  | 'SPACE_NOT_FOUND'
  | 'FOLDER_NOT_FOUND'
  | 'FOLDER_NAME_CONFLICT'
  | 'FOLDER_INVALID_NAME'
  | 'FOLDER_CYCLE'
  | 'FOLDER_DEPTH_LIMIT'
  | 'FOLDER_COUNT_LIMIT'
  | 'FOLDER_MUTATION_LIMIT'
  | 'FOLDER_PATH_TOO_LONG'
  | 'FOLDER_DELETE_IMPACT_CHANGED'
  | 'FOLDER_RESTORE_CONFLICT'
  | 'MARKDOWN_REFERENCE_AMBIGUOUS'
  | 'CONTENT_TREE_CONFLICT'
  | 'CONTENT_TREE_REVISION_GONE'
  | 'CONTENT_TREE_CURSOR_INVALID'
  | 'CONTENT_TREE_PAGE_NOT_FOUND'
  | 'CONTENT_TREE_INVALID_ACTOR'
  | 'CONTENT_TREE_SPACE_FORBIDDEN'
  | 'CONTENT_TREE_SPACE_READ_ONLY'
  | 'CONTENT_TREE_PAYLOAD_INVALID'
  | 'CONTENT_TREE_PATH_COLLISION'
  | 'CONTENT_TREE_ID_CONFLICT'
  | 'CONTENT_TREE_TAKE_INVALID'
  | 'PAGE_PARENT_DEPRECATED';

export class ContentTreeError extends BusinessException {
  constructor(
    readonly code: ContentTreeErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(code, message, details);
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

export interface PublishSyncV2BatchInput {
  spaceId: string;
  baseRevision: string;
  confirmationHash?: string;
  changes: TreePushChangeV2[];
  actor: ContentTreeActor;
  principal: { userId: string; platformRole: string };
  revisionOrigin: RevisionOrigin;
}

export interface PublishSyncV2BatchResult {
  protocolVersion: '2';
  status: 'published' | 'noop';
  revision: string;
  sequence: number;
  publishedAt: string | null;
  revisionContentHash: string;
  folderCount: string;
  pageCount: string;
  revisionManifestByteLength: string;
  revisionBodyBytes: string;
  changeSetId: string | null;
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
  actor: ContentTreeActor;
}

export interface RenameFolderInput {
  spaceId: string;
  folderId: string;
  name: string;
  expectedTreeRevision: bigint;
  expectedUpdatedAt: Date;
  actor: ContentTreeActor;
}

export interface DeleteImpactInput {
  spaceId: string;
  folderId: string;
}

export interface DeleteImpactResult {
  treeRevision: bigint;
  rootUpdatedAt: Date;
  folderCount: number;
  pageCount: number;
  impactHash: string;
}

export interface DeleteFolderInput extends DeleteImpactInput {
  expectedTreeRevision: bigint;
  expectedUpdatedAt: Date;
  expectedImpactHash: string;
  actor: ContentTreeActor;
}

export type RestoreStrategy =
  | { kind: 'original' }
  | { kind: 'root' }
  | { kind: 'rename-root'; name: string };

export interface RestoreDeletionBatchInput {
  spaceId: string;
  rootFolderId?: string;
  deletionBatchId: string;
  strategy: RestoreStrategy;
  expectedTreeRevision: bigint;
  expectedUpdatedAt: Date;
  actor: ContentTreeActor;
}

export interface ContentTreeMutationResult {
  treeRevision: bigint;
  syncRevisionId: string;
}

export interface RenamedFolderResult extends ContentTreeMutationResult {
  folder: {
    id: string;
    parentId: string | null;
    name: string;
    path: string;
    pathKey: string;
    updatedAt: Date;
  };
}

export interface MovedTreeNodeResult extends ContentTreeMutationResult {
  node: {
    kind: 'folder' | 'page';
    id: string;
    parentId?: string | null;
    folderId?: string | null;
    path: string;
    pathKey: string;
    sortOrder: number;
    updatedAt: Date;
  };
}

export interface DeletedFolderResult extends ContentTreeMutationResult {
  batch: {
    id: string;
    folderCount: number;
    pageCount: number;
    impactHash: string;
    createdAt: Date;
  };
}

export interface RestoredDeletionBatchResult extends ContentTreeMutationResult {
  batchId: string;
  folder: {
    id: string;
    parentId: string | null;
    name: string;
    path: string;
    pathKey: string;
    updatedAt: Date;
  };
}

export interface PlacePageInput {
  spaceId: string;
  pageId: string;
  title: string;
  folderId: string | null;
}

export interface ListChildrenInput {
  spaceId: string;
  parentFolderId?: string | null;
  cursor?: string;
  take?: number;
}

export interface ListFoldersInput {
  spaceId: string;
  parentFolderId?: string | null;
  query?: string;
  cursor?: string;
  take?: number;
}

export interface FolderListItem {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FolderListResult {
  spaceId: string;
  treeRevision: bigint;
  data: FolderListItem[];
  nextCursor: string | null;
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
  folderId: string | null;
  syncPath: string;
  syncPathKey: string;
}

export interface PreparePageMutationInput extends PlacePageInput {
  current: {
    title: string;
    folderId: string | null;
    syncPath: string;
    syncPathKey: string;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    knowledgeKey: string;
    content: string | null;
  };
}

export interface PrepareExactPageMutationInput {
  spaceId: string;
  pageId: string;
  title: string;
  syncPath: string;
  /** Omit to resolve the Folder from the exact path (used by Sync v1). */
  folderId?: string | null;
  current?: PreparePageMutationInput['current'];
}

export interface AdvancePageMutationInput {
  spaceId: string;
  expectedTreeRevision: bigint;
  structural: boolean;
  changes: StructuralPageChange[];
  actor: ContentTreeActor;
  revisionOrigin?: Partial<RevisionOrigin>;
  existingSyncRevisionId?: string;
}
