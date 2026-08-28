import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  canonicalBytes,
  foldCase,
  validatePortableDirectoryPath,
  validatePortablePath,
} from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../database/prisma.service';
import {
  ReadableSyncPathService,
  safeMarkdownBasename,
} from '../core/sync/readable-sync-path.service';
import {
  SpaceRevisionWriterService,
  type StructuralPageChange,
  type SpaceTreeLockedTransaction,
} from '../core/sync/space-revision-writer.service';
import { normalizeFolderName } from './folder-name';
import {
  ContentTreeConflict,
  ContentTreeError,
  type ContentTreeActor,
  type ContentTreeFolderNode,
  type ContentTreeListResult,
  type ContentTreeNode,
  type ContentTreePageNode,
  type CreateFolderInput,
  type CreatedFolderResult,
  type DeleteFolderInput,
  type DeleteImpactInput,
  type DeleteImpactResult,
  type DeletedFolderResult,
  type FolderListResult,
  type ListChildrenInput,
  type ListFoldersInput,
  type MovedTreeNodeResult,
  type MoveTreeNodeInput,
  type PlacePageInput,
  type PlacedPageResult,
  type PreparePageMutationInput,
  type AdvancePageMutationInput,
  type RenamedFolderResult,
  type RenameFolderInput,
  type RestoreDeletionBatchInput,
  type RestoredDeletionBatchResult,
  type RestoreStrategy,
} from './content-tree.types';

const DEFAULT_TAKE = 100;
const MAX_TAKE = 200;
const MAX_FOLDER_DEPTH = 32;
const MAX_ACTIVE_FOLDERS = 10_000n;
const MAX_MUTATION_NODES = 10_000;
const MAX_PAGE_ALIASES = 20;
const MUTATION_TRANSACTION_TIMEOUT_MS = 120_000;

interface TreeCursor {
  v: 1;
  spaceId: string;
  parentFolderId: string | null;
  kind: 'folder' | 'page';
  sortOrder: number;
  createdAt: string;
  id: string;
}

interface FolderListCursor {
  v: 1;
  spaceId: string;
  query: string;
  pathKey: string;
  id: string;
}

interface AncestorRow {
  id: string;
  parentId: string | null;
  path: string;
  depth: number;
}

interface CycleAwareAncestorRow extends AncestorRow {
  cycle: boolean;
}

interface AffectedTreeRow {
  kind: 'folder' | 'page';
  id: string;
  parentId: string | null;
  folderId: string | null;
  name: string | null;
  title: string | null;
  path: string;
  pathKey: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  depth: number;
  knowledgeKey: string | null;
  content: string | null;
}

interface FolderMutationPlan {
  id: string;
  parentId: string | null;
  name: string;
  nameKey: string;
  path: string;
  pathKey: string;
  sortOrder: number;
  depth: number;
  deletedAt: Date | null;
  deletionBatchId: string | null;
}

interface PageMutationPlan {
  id: string;
  folderId: string | null;
  path: string;
  pathKey: string;
  sortOrder: number;
  deletedAt: Date | null;
  deletionBatchId: string | null;
}

interface OrderedSibling {
  id: string;
  sortOrder: number;
  createdAt: Date;
}

function sameInstant(expected: Date, actual: Date): boolean {
  return expected instanceof Date
    && actual instanceof Date
    && !Number.isNaN(expected.getTime())
    && expected.getTime() === actual.getTime();
}

function assertExpectedUpdatedAt(expected: Date, actual: Date): void {
  if (!sameInstant(expected, actual)) throw new ContentTreeConflict(expected, actual);
}

function portableDirectoryPath(value: string): { path: string; key: string } {
  try {
    return validatePortableDirectoryPath(value);
  } catch (error) {
    throw new ContentTreeError(
      error instanceof RangeError ? 'FOLDER_PATH_TOO_LONG' : 'FOLDER_INVALID_NAME',
      error instanceof Error ? error.message : 'Invalid Folder path',
    );
  }
}

function portablePagePath(value: string): { path: string; key: string } {
  try {
    return validatePortablePath(value);
  } catch (error) {
    throw new ContentTreeError(
      'FOLDER_PATH_TOO_LONG',
      error instanceof Error ? error.message : 'Invalid Page path',
    );
  }
}

function affectedImpact(rows: readonly AffectedTreeRow[]): {
  folderCount: number;
  pageCount: number;
  impactHash: string;
} {
  const objects = rows
    .map((row) => ({
      kind: row.kind,
      id: row.id,
      version: row.updatedAt.toISOString(),
    }))
    .sort((left, right) => {
      const kind = Buffer.from(left.kind).compare(Buffer.from(right.kind));
      return kind || Buffer.from(left.id).compare(Buffer.from(right.id));
    });
  return {
    folderCount: rows.filter((row) => row.kind === 'folder').length,
    pageCount: rows.filter((row) => row.kind === 'page').length,
    impactHash: createHash('sha256').update(canonicalBytes({ objects })).digest('hex'),
  };
}

function assertMutationLimit(rows: readonly unknown[]): void {
  if (rows.length > MAX_MUTATION_NODES) {
    throw new ContentTreeError(
      'FOLDER_MUTATION_LIMIT',
      'A recursive content-tree mutation may affect at most 10,000 objects',
    );
  }
}

function parseRestoreStrategy(value: unknown): RestoreStrategy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Restore strategy is invalid');
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (
    (candidate.kind === 'original' || candidate.kind === 'root')
    && keys.length === 1
    && keys[0] === 'kind'
  ) return { kind: candidate.kind };
  if (
    candidate.kind === 'rename-root'
    && typeof candidate.name === 'string'
    && keys.length === 2
    && keys[0] === 'kind'
    && keys[1] === 'name'
  ) return { kind: 'rename-root', name: candidate.name };
  throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Restore strategy is invalid');
}

function mutationOrigin(actor: ContentTreeActor) {
  return {
    origin: actor.agentId ? 'change_set' as const : 'web_editor' as const,
    createdByUserId: actor.userId ?? null,
  };
}

function basename(path: string): string {
  const offset = path.lastIndexOf('/');
  const value = offset >= 0 ? path.slice(offset + 1) : path;
  if (!value) throw new ContentTreeError('FOLDER_PATH_TOO_LONG', 'Page path has no basename');
  return value;
}

function assertActor(actor: ContentTreeActor): void {
  if ((!actor.userId && !actor.agentId) || (actor.userId && actor.agentId)) {
    throw new ContentTreeError('CONTENT_TREE_INVALID_ACTOR', 'Exactly one content-tree actor is required');
  }
}

function encodeCursor(node: ContentTreeNode, spaceId: string, parentFolderId: string | null): string {
  const cursor: TreeCursor = {
    v: 1,
    spaceId,
    parentFolderId,
    kind: node.kind,
    sortOrder: node.sortOrder,
    createdAt: node.createdAt.toISOString(),
    id: node.id,
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string, spaceId: string, parentFolderId: string | null): TreeCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<TreeCursor>;
    const createdAt = typeof parsed.createdAt === 'string' ? new Date(parsed.createdAt) : null;
    if (
      parsed.v !== 1 ||
      parsed.spaceId !== spaceId ||
      parsed.parentFolderId !== parentFolderId ||
      (parsed.kind !== 'folder' && parsed.kind !== 'page') ||
      !Number.isInteger(parsed.sortOrder) ||
      !createdAt || Number.isNaN(createdAt.getTime()) ||
      typeof parsed.id !== 'string' || parsed.id.length === 0
    ) throw new Error('invalid cursor');
    return parsed as TreeCursor;
  } catch {
    throw new ContentTreeError('CONTENT_TREE_CURSOR_INVALID', 'The cursor does not belong to this tree location');
  }
}

function afterCursor(cursor: TreeCursor): Prisma.FolderWhereInput[] {
  const createdAt = new Date(cursor.createdAt);
  return [
    { sortOrder: { gt: cursor.sortOrder } },
    { sortOrder: cursor.sortOrder, createdAt: { gt: createdAt } },
    { sortOrder: cursor.sortOrder, createdAt, id: { gt: cursor.id } },
  ];
}

function encodeFolderListCursor(
  folder: { pathKey: string; id: string },
  spaceId: string,
  query: string,
): string {
  return Buffer.from(JSON.stringify({
    v: 1, spaceId, query, pathKey: folder.pathKey, id: folder.id,
  } satisfies FolderListCursor), 'utf8').toString('base64url');
}

function decodeFolderListCursor(value: string, spaceId: string, query: string): FolderListCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<FolderListCursor>;
    if (
      parsed.v !== 1
      || parsed.spaceId !== spaceId
      || parsed.query !== query
      || typeof parsed.pathKey !== 'string'
      || typeof parsed.id !== 'string'
      || parsed.id.length === 0
    ) throw new Error('invalid cursor');
    return parsed as FolderListCursor;
  } catch {
    throw new ContentTreeError('CONTENT_TREE_CURSOR_INVALID', 'The cursor does not belong to this Folder query');
  }
}

@Injectable()
export class ContentTreeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revisionWriter: SpaceRevisionWriterService,
    private readonly syncPaths: ReadableSyncPathService,
  ) {}

  async listChildren(input: ListChildrenInput): Promise<ContentTreeListResult> {
    const parentFolderId = input.parentFolderId ?? null;
    const take = input.take ?? DEFAULT_TAKE;
    if (!Number.isInteger(take) || take < 1 || take > MAX_TAKE) {
      throw new ContentTreeError('CONTENT_TREE_TAKE_INVALID', 'take must be an integer from 1 through 200');
    }
    const cursor = input.cursor ? decodeCursor(input.cursor, input.spaceId, parentFolderId) : null;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const space = await tx.space.findUnique({
        where: { id: input.spaceId, deletedAt: null },
        select: { contentTreeRevision: true },
      });
      if (!space) throw new ContentTreeError('SPACE_NOT_FOUND', 'Space not found');
      if (parentFolderId !== null) {
        const parent = await tx.folder.findFirst({
          where: { id: parentFolderId, spaceId: input.spaceId, deletedAt: null },
          select: { id: true },
        });
        if (!parent) throw new ContentTreeError('FOLDER_NOT_FOUND', 'Folder not found');
      }

      const commonWhere = { spaceId: input.spaceId, deletedAt: null } as const;
      const folderAfter = cursor?.kind === 'folder' ? afterCursor(cursor) : undefined;
      const pageAfter = cursor?.kind === 'page' ? afterCursor(cursor) : undefined;
      const includeFolders = cursor?.kind !== 'page';
      const folderWhere: Prisma.FolderWhereInput = {
        ...commonWhere,
        parentId: parentFolderId,
        ...(!includeFolders ? { id: '__cursor-past-folders__' } : {}),
        ...(folderAfter ? { OR: folderAfter } : {}),
      };
      const [folders, pages] = await Promise.all([
        tx.folder.findMany({
          where: folderWhere,
          select: {
            id: true, name: true, path: true, sortOrder: true, createdAt: true, updatedAt: true,
            _count: {
              select: {
                children: { where: { deletedAt: null } },
                pages: { where: { deletedAt: null } },
              },
            },
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          take: take + 1,
        }),
        tx.page.findMany({
          where: {
            ...commonWhere,
            folderId: parentFolderId,
            ...(cursor?.kind === 'folder' ? {} : pageAfter ? { OR: pageAfter as Prisma.PageWhereInput[] } : {}),
          },
          select: {
            id: true, folderId: true, title: true, syncPath: true,
            sortOrder: true, createdAt: true, updatedAt: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          take: take + 1,
        }),
      ]);

      const folderNodes: ContentTreeFolderNode[] = folders.map((folder) => ({
        kind: 'folder',
        id: folder.id,
        name: folder.name,
        path: folder.path,
        sortOrder: folder.sortOrder,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        hasChildren: folder._count.children > 0 || folder._count.pages > 0,
      }));
      const pageNodes: ContentTreePageNode[] = pages.map((page) => ({
        kind: 'page',
        id: page.id,
        folderId: page.folderId,
        title: page.title,
        path: page.syncPath,
        sortOrder: page.sortOrder,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
      }));
      const candidates: ContentTreeNode[] = cursor?.kind === 'page'
        ? pageNodes
        : [...folderNodes, ...pageNodes];
      const data = candidates.slice(0, take);
      const nextCursor = candidates.length > take && data.length > 0
        ? encodeCursor(data[data.length - 1]!, input.spaceId, parentFolderId)
        : null;
      return {
        spaceId: input.spaceId,
        treeRevision: space.contentTreeRevision,
        parentFolderId,
        data,
        nextCursor,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async listFolders(input: ListFoldersInput): Promise<FolderListResult> {
    const take = input.take ?? DEFAULT_TAKE;
    if (!Number.isInteger(take) || take < 1 || take > MAX_TAKE) {
      throw new ContentTreeError('CONTENT_TREE_TAKE_INVALID', 'take must be an integer from 1 through 200');
    }
    const query = foldCase((input.query ?? '').normalize('NFC').trim());
    const cursor = input.cursor
      ? decodeFolderListCursor(input.cursor, input.spaceId, query)
      : null;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const space = await tx.space.findUnique({
        where: { id: input.spaceId, deletedAt: null },
        select: { contentTreeRevision: true },
      });
      if (!space) throw new ContentTreeError('SPACE_NOT_FOUND', 'Space not found');
      const queryFilter: Prisma.FolderWhereInput = query
        ? { OR: [{ nameKey: { contains: query } }, { pathKey: { contains: query } }] }
        : {};
      const cursorFilter: Prisma.FolderWhereInput = cursor
        ? {
            OR: [
              { pathKey: { gt: cursor.pathKey } },
              { pathKey: cursor.pathKey, id: { gt: cursor.id } },
            ],
          }
        : {};
      const where: Prisma.FolderWhereInput = {
        spaceId: input.spaceId,
        deletedAt: null,
        ...(query && cursor ? { AND: [queryFilter, cursorFilter] } : query ? queryFilter : cursorFilter),
      };
      const folders = await tx.folder.findMany({
        where,
        select: {
          id: true, parentId: true, name: true, nameKey: true,
          path: true, pathKey: true, createdAt: true, updatedAt: true,
        },
        orderBy: [{ pathKey: 'asc' }, { id: 'asc' }],
        take: take + 1,
      });
      const data = folders.slice(0, take).map((folder) => ({
        id: folder.id,
        parentId: folder.parentId,
        name: folder.name,
        path: folder.path,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
      }));
      const nextCursor = folders.length > take && data.length > 0
        ? encodeFolderListCursor(folders[take - 1]!, input.spaceId, query)
        : null;
      return {
        spaceId: input.spaceId,
        treeRevision: space.contentTreeRevision,
        data,
        nextCursor,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async createFolder(input: CreateFolderInput): Promise<CreatedFolderResult> {
    assertActor(input.actor);
    const normalized = normalizeFolderName(input.name);
    return this.prisma.$transaction(async (tx) => {
      const lockedTx = await this.revisionWriter.lockContentTreeSpace(tx, input.spaceId);
      if (!lockedTx) throw new ContentTreeError('SPACE_NOT_FOUND', 'Space not found');
      if (lockedTx.contentTreeRevision !== input.expectedTreeRevision) {
        throw new ContentTreeConflict(input.expectedTreeRevision, lockedTx.contentTreeRevision);
      }

      const ancestors = await lockedTx.$queryRaw<AncestorRow[]>(Prisma.sql`
        WITH RECURSIVE ancestors AS (
          SELECT "id", "parentId", "path", 1 AS depth
          FROM "Folder"
          WHERE "id" = ${input.parentId ?? ''}
            AND "spaceId" = ${input.spaceId}
            AND "deletedAt" IS NULL
          UNION ALL
          SELECT parent."id", parent."parentId", parent."path", ancestors.depth + 1
          FROM "Folder" parent
          JOIN ancestors ON parent."id" = ancestors."parentId"
          WHERE parent."spaceId" = ${input.spaceId}
            AND parent."deletedAt" IS NULL
            AND ancestors.depth < ${MAX_FOLDER_DEPTH}
        )
        SELECT "id", "parentId", "path", depth FROM ancestors ORDER BY depth ASC
      `);
      if (input.parentId && ancestors.length === 0) {
        throw new ContentTreeError('FOLDER_NOT_FOUND', 'Folder not found');
      }
      if (ancestors.length + 1 > MAX_FOLDER_DEPTH) {
        throw new ContentTreeError('FOLDER_DEPTH_LIMIT', 'Folder depth exceeds 32 levels');
      }
      const counts = await lockedTx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "Folder"
        WHERE "spaceId" = ${input.spaceId} AND "deletedAt" IS NULL
      `);
      if ((counts[0]?.count ?? 0n) >= MAX_ACTIVE_FOLDERS) {
        throw new ContentTreeError('FOLDER_COUNT_LIMIT', 'A Space may contain at most 10,000 active Folders');
      }

      const parentPath = input.parentId ? ancestors[0]!.path : 'pages';
      let portablePath: { path: string; key: string };
      try {
        portablePath = validatePortableDirectoryPath(`${parentPath}/${normalized.name}`);
      } catch (error) {
        throw new ContentTreeError(
          error instanceof RangeError ? 'FOLDER_PATH_TOO_LONG' : 'FOLDER_INVALID_NAME',
          error instanceof Error ? error.message : 'Invalid Folder path',
        );
      }
      const duplicate = await lockedTx.folder.findFirst({
        where: {
          spaceId: input.spaceId,
          parentId: input.parentId,
          nameKey: normalized.nameKey,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (duplicate) throw new ContentTreeError('FOLDER_NAME_CONFLICT', 'A sibling Folder already uses this portable name');
      const siblingOrder = await lockedTx.folder.aggregate({
        where: { spaceId: input.spaceId, parentId: input.parentId, deletedAt: null },
        _max: { sortOrder: true },
      });
      const created = await lockedTx.folder.create({
        data: {
          spaceId: input.spaceId,
          parentId: input.parentId,
          name: normalized.name,
          nameKey: normalized.nameKey,
          path: portablePath.path,
          pathKey: portablePath.key,
          sortOrder: (siblingOrder._max.sortOrder ?? -1) + 1,
          createdByUserId: input.actor.userId ?? null,
          createdByAgentId: input.actor.agentId ?? null,
          lastModifiedByUserId: input.actor.userId ?? null,
          lastModifiedByAgentId: input.actor.agentId ?? null,
          lastModifiedAt: new Date(),
        },
      });
      const treeRevision = await this.revisionWriter.advanceContentTreeRevision(
        lockedTx, input.spaceId, input.expectedTreeRevision,
      );
      const syncRevision = await this.revisionWriter.advance(lockedTx, input.spaceId, [], {
        origin: input.actor.agentId ? 'change_set' : 'web_editor',
        createdByUserId: input.actor.userId ?? null,
      });
      return { folder: created, treeRevision, syncRevisionId: syncRevision.revisionId };
    });
  }

  async placePage(
    lockedTx: SpaceTreeLockedTransaction,
    input: PlacePageInput,
  ): Promise<PlacedPageResult> {
    const existing = await lockedTx.page.findUnique({
      where: { id: input.pageId },
      select: { id: true, spaceId: true, deletedAt: true, syncPath: true },
    });
    if (existing) {
      throw new ContentTreeError(
        'CONTENT_TREE_CONFLICT',
        'placePage only prepares initial placement; existing Pages require the move lifecycle',
      );
    }
    const folder = input.folderId ? await lockedTx.folder.findFirst({
      where: { id: input.folderId, spaceId: input.spaceId, deletedAt: null },
      select: { id: true, path: true },
    }) : null;
    if (input.folderId && !folder) throw new ContentTreeError('FOLDER_NOT_FOUND', 'Folder not found');
    const allocated = await this.syncPaths.allocate(lockedTx, {
      spaceId: input.spaceId,
      directory: folder?.path ?? 'pages',
      title: input.title,
    });
    return {
      folderId: input.folderId,
      syncPath: allocated.path,
      syncPathKey: allocated.pathKey,
    };
  }

  async lockPageMutationSpace(
    tx: Prisma.TransactionClient,
    spaceId: string,
    expectedTreeRevision?: bigint,
  ): Promise<SpaceTreeLockedTransaction> {
    const lockedTx = await this.revisionWriter.lockContentTreeSpace(tx, spaceId);
    if (!lockedTx) throw new ContentTreeError('SPACE_NOT_FOUND', 'Space not found');
    if (
      expectedTreeRevision !== undefined
      && lockedTx.contentTreeRevision !== expectedTreeRevision
    ) {
      throw new ContentTreeConflict(expectedTreeRevision, lockedTx.contentTreeRevision);
    }
    return lockedTx;
  }

  async preparePageMutation(
    lockedTx: SpaceTreeLockedTransaction,
    input: PreparePageMutationInput,
  ): Promise<PlacedPageResult> {
    const folder = input.folderId === null ? null : await lockedTx.folder.findFirst({
      where: { id: input.folderId, spaceId: input.spaceId, deletedAt: null },
      select: { id: true, path: true },
    });
    if (input.folderId !== null && !folder) {
      throw new ContentTreeError('FOLDER_NOT_FOUND', 'Folder not found');
    }
    const pathChanged = input.folderId !== input.current.folderId
      || safeMarkdownBasename(input.title) !== safeMarkdownBasename(input.current.title);
    if (!pathChanged) {
      return {
        folderId: input.folderId,
        syncPath: input.current.syncPath,
        syncPathKey: input.current.syncPathKey,
      };
    }
    const allocated = await this.syncPaths.allocate(lockedTx, {
      spaceId: input.spaceId,
      directory: folder?.path ?? 'pages',
      title: input.title,
      excludePageId: input.pageId,
    });
    const currentRow: AffectedTreeRow = {
      kind: 'page', id: input.pageId, parentId: null, folderId: input.current.folderId,
      name: null, title: input.current.title,
      path: input.current.syncPath, pathKey: input.current.syncPathKey,
      sortOrder: input.current.sortOrder, createdAt: input.current.createdAt,
      updatedAt: input.current.updatedAt, depth: 0,
      knowledgeKey: input.current.knowledgeKey, content: input.current.content,
    };
    const plan: PageMutationPlan = {
      id: input.pageId,
      folderId: input.folderId,
      path: allocated.path,
      pathKey: allocated.pathKey,
      sortOrder: input.current.sortOrder,
      deletedAt: null,
      deletionBatchId: null,
    };
    const changedAt = new Date();
    await this.insertPageAliases(lockedTx, input.spaceId, [currentRow], [plan], changedAt);
    await this.trimPageAliases(lockedTx, input.spaceId, [input.pageId]);
    return {
      folderId: input.folderId,
      syncPath: allocated.path,
      syncPathKey: allocated.pathKey,
    };
  }

  async advancePageMutation(
    lockedTx: SpaceTreeLockedTransaction,
    input: AdvancePageMutationInput,
  ): Promise<{ treeRevision: bigint; syncRevisionId: string }> {
    assertActor(input.actor);
    if (input.existingSyncRevisionId) {
      const treeRevision = input.structural
        ? await this.revisionWriter.advanceContentTreeRevision(
          lockedTx,
          input.spaceId,
          input.expectedTreeRevision,
        )
        : lockedTx.contentTreeRevision;
      return { treeRevision, syncRevisionId: input.existingSyncRevisionId };
    }
    if (input.structural) {
      return this.advanceMutationRevisions(
        lockedTx,
        input.spaceId,
        input.expectedTreeRevision,
        input.changes,
        input.actor,
        input.revisionOrigin,
      );
    }
    const syncRevision = await this.revisionWriter.advance(
      lockedTx,
      input.spaceId,
      input.changes.map((change) => change.operation === 'archive'
        ? {
          operation: 'archive' as const,
          pageId: change.pageId,
          previousPath: change.previousPath,
        }
        : {
          operation: 'upsert' as const,
          pageId: change.pageId,
          path: change.path,
          title: change.title,
          body: change.body,
        }),
      { ...mutationOrigin(input.actor), ...input.revisionOrigin },
    );
    return {
      treeRevision: lockedTx.contentTreeRevision,
      syncRevisionId: syncRevision.revisionId,
    };
  }

  async mapLegacyPageParent(
    lockedTx: SpaceTreeLockedTransaction,
    spaceId: string,
    legacyParentId: string,
  ): Promise<string> {
    const legacyParent = await lockedTx.page.findFirst({
      where: { id: legacyParentId, spaceId, deletedAt: null },
      select: { syncPathKey: true },
    });
    const legacyPath = legacyParent?.syncPathKey;
    if (!legacyPath || !legacyPath.toLowerCase().endsWith('.md')) {
      throw new ContentTreeError(
        'PAGE_PARENT_DEPRECATED',
        'Legacy Page parent placement cannot be mapped safely',
      );
    }
    const candidates = await lockedTx.folder.findMany({
      where: { spaceId, deletedAt: null, pathKey: legacyPath.slice(0, -3) },
      select: { id: true },
      take: 2,
    });
    if (candidates.length !== 1) {
      throw new ContentTreeError(
        'PAGE_PARENT_DEPRECATED',
        'Legacy Page parent placement cannot be mapped safely',
      );
    }
    return candidates[0].id;
  }

  async renameFolder(input: RenameFolderInput): Promise<RenamedFolderResult> {
    assertActor(input.actor);
    const normalized = normalizeFolderName(input.name);
    return this.prisma.$transaction(async (tx) => {
      const lockedTx = await this.lockMutationSpace(tx, input.spaceId, input.expectedTreeRevision);
      const rows = await this.loadActiveSubtree(lockedTx, input.spaceId, input.folderId);
      const root = this.requireAffectedFolder(rows, input.folderId);
      assertExpectedUpdatedAt(input.expectedUpdatedAt, root.updatedAt);
      assertMutationLimit(rows);
      await this.loadActiveAncestors(lockedTx, input.spaceId, root.id);

      const parent = root.parentId === null
        ? null
        : await this.activeFolder(lockedTx, input.spaceId, root.parentId);
      if (root.parentId !== null && !parent) {
        throw new ContentTreeError('FOLDER_NOT_FOUND', 'Folder not found');
      }
      await this.assertSiblingNameAvailable(
        lockedTx, input.spaceId, root.parentId, normalized.nameKey, root.id,
      );
      const plans = this.planSubtreePaths(
        rows,
        root.id,
        root.parentId,
        parent?.path ?? 'pages',
        normalized.name,
        normalized.nameKey,
      );
      await this.assertPathPlansAvailable(lockedTx, input.spaceId, rows, plans.folders, plans.pages);
      const currentById = new Map(rows.map((row) => [row.id, row]));
      const changedFolders = plans.folders.filter((plan) => {
        const current = currentById.get(plan.id)!;
        return plan.id === root.id
          || current.parentId !== plan.parentId
          || current.name !== plan.name
          || current.path !== plan.path
          || current.pathKey !== plan.pathKey;
      });
      const changedPages = plans.pages.filter((plan) => {
        const current = currentById.get(plan.id)!;
        return current.folderId !== plan.folderId
          || current.path !== plan.path
          || current.pathKey !== plan.pathKey;
      });
      const changedAt = new Date();
      await this.insertPageAliases(lockedTx, input.spaceId, rows, changedPages, changedAt);
      await this.applyFolderPlans(
        lockedTx, input.spaceId, changedFolders, input.actor, changedAt, { kind: 'active' },
      );
      await this.applyPagePlans(
        lockedTx, input.spaceId, changedPages, input.actor, changedAt, { kind: 'active' },
      );
      await this.trimPageAliases(lockedTx, input.spaceId, changedPages.map((plan) => plan.id));
      const revisions = await this.advanceMutationRevisions(
        lockedTx,
        input.spaceId,
        input.expectedTreeRevision,
        this.pageUpserts(rows, changedPages),
        input.actor,
      );
      const rootPlan = plans.folders.find((plan) => plan.id === root.id)!;
      return {
        ...revisions,
        folder: {
          id: root.id,
          parentId: rootPlan.parentId,
          name: rootPlan.name,
          path: rootPlan.path,
          pathKey: rootPlan.pathKey,
          updatedAt: changedAt,
        },
      };
    }, { timeout: MUTATION_TRANSACTION_TIMEOUT_MS });
  }

  async moveNode(input: MoveTreeNodeInput): Promise<MovedTreeNodeResult> {
    assertActor(input.actor);
    return input.kind === 'folder'
      ? this.moveFolder(input)
      : this.movePage(input);
  }

  async deleteImpact(input: DeleteImpactInput): Promise<DeleteImpactResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const space = await tx.space.findUnique({
        where: { id: input.spaceId, deletedAt: null },
        select: { contentTreeRevision: true },
      });
      if (!space) throw new ContentTreeError('SPACE_NOT_FOUND', 'Space not found');
      const rows = await this.loadActiveSubtree(tx, input.spaceId, input.folderId);
      const root = this.requireAffectedFolder(rows, input.folderId);
      assertMutationLimit(rows);
      await this.loadActiveAncestors(tx, input.spaceId, root.id);
      return {
        treeRevision: space.contentTreeRevision,
        rootUpdatedAt: root.updatedAt,
        ...affectedImpact(rows),
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: MUTATION_TRANSACTION_TIMEOUT_MS,
    });
  }

  async deleteFolder(input: DeleteFolderInput): Promise<DeletedFolderResult> {
    assertActor(input.actor);
    return this.prisma.$transaction(async (tx) => {
      const lockedTx = await this.lockMutationSpace(tx, input.spaceId, input.expectedTreeRevision);
      const rows = await this.loadActiveSubtree(lockedTx, input.spaceId, input.folderId);
      const root = this.requireAffectedFolder(rows, input.folderId);
      assertExpectedUpdatedAt(input.expectedUpdatedAt, root.updatedAt);
      assertMutationLimit(rows);
      await this.loadActiveAncestors(lockedTx, input.spaceId, root.id);
      const impact = affectedImpact(rows);
      if (impact.impactHash !== input.expectedImpactHash) {
        throw new ContentTreeError(
          'FOLDER_DELETE_IMPACT_CHANGED',
          'The Folder subtree changed after the deletion preview',
          { expected: input.expectedImpactHash, actual: impact.impactHash },
        );
      }

      const deletedAt = new Date();
      const batchId = randomUUID();
      const batch = await lockedTx.contentDeletionBatch.create({
        data: {
          id: batchId,
          spaceId: input.spaceId,
          rootFolderId: root.id,
          deletedByUserId: input.actor.userId ?? null,
          deletedByAgentId: input.actor.agentId ?? null,
          deletedTreeRevision: input.expectedTreeRevision,
          folderCount: impact.folderCount,
          pageCount: impact.pageCount,
          impactHash: impact.impactHash,
          createdAt: deletedAt,
        },
      });
      const pageIds = rows.filter((row) => row.kind === 'page').map((row) => row.id);
      const folderIds = rows.filter((row) => row.kind === 'folder').map((row) => row.id);
      const pageUpdateCount = pageIds.length === 0 ? 0 : await lockedTx.$executeRaw(Prisma.sql`
        UPDATE "Page" target
        SET
          "deletedAt" = batch."createdAt",
          "deletionBatchId" = batch."id",
          "lastModifiedByUserId" = ${input.actor.userId ?? null},
          "lastModifiedByAgentId" = ${input.actor.agentId ?? null},
          "lastModifiedAt" = batch."createdAt"
        FROM "ContentDeletionBatch" batch
        WHERE batch."id" = ${batchId}
          AND batch."spaceId" = ${input.spaceId}
          AND target."spaceId" = batch."spaceId"
          AND target."deletedAt" IS NULL
          AND target."id" IN (
            SELECT value FROM jsonb_array_elements_text(${JSON.stringify(pageIds)}::jsonb)
          )
      `);
      const folderUpdateCount = await lockedTx.$executeRaw(Prisma.sql`
        UPDATE "Folder" target
        SET
          "deletedAt" = batch."createdAt",
          "deletionBatchId" = batch."id",
          "lastModifiedByUserId" = ${input.actor.userId ?? null},
          "lastModifiedByAgentId" = ${input.actor.agentId ?? null},
          "lastModifiedAt" = batch."createdAt"
        FROM "ContentDeletionBatch" batch
        WHERE batch."id" = ${batchId}
          AND batch."spaceId" = ${input.spaceId}
          AND target."spaceId" = batch."spaceId"
          AND target."deletedAt" IS NULL
          AND target."id" IN (
            SELECT value FROM jsonb_array_elements_text(${JSON.stringify(folderIds)}::jsonb)
          )
      `);
      if (pageUpdateCount !== pageIds.length || folderUpdateCount !== folderIds.length) {
        throw new ContentTreeConflict(input.expectedTreeRevision, input.expectedTreeRevision);
      }
      const revisions = await this.advanceMutationRevisions(
        lockedTx,
        input.spaceId,
        input.expectedTreeRevision,
        rows.filter((row) => row.kind === 'page').map((row) => ({
          operation: 'archive' as const,
          pageId: row.knowledgeKey!,
          previousPath: row.path,
        })),
        input.actor,
      );
      return {
        ...revisions,
        batch: {
          id: batch.id,
          folderCount: batch.folderCount,
          pageCount: batch.pageCount,
          impactHash: batch.impactHash,
          createdAt: batch.createdAt,
        },
      };
    }, { timeout: MUTATION_TRANSACTION_TIMEOUT_MS });
  }

  async restoreDeletionBatch(
    input: RestoreDeletionBatchInput,
  ): Promise<RestoredDeletionBatchResult> {
    const strategy = parseRestoreStrategy(input.strategy);
    assertActor(input.actor);
    const renamed = strategy.kind === 'rename-root'
      ? normalizeFolderName(strategy.name)
      : null;
    return this.prisma.$transaction(async (tx) => {
      const lockedTx = await this.lockMutationSpace(tx, input.spaceId, input.expectedTreeRevision);
      const batch = await lockedTx.contentDeletionBatch.findFirst({
        where: {
          id: input.deletionBatchId,
          spaceId: input.spaceId,
          ...(input.rootFolderId ? { rootFolderId: input.rootFolderId } : {}),
          restoredAt: null,
        },
        select: {
          id: true,
          rootFolderId: true,
          folderCount: true,
          pageCount: true,
          impactHash: true,
          createdAt: true,
          folders: { select: { id: true } },
          pages: { select: { id: true } },
        },
      });
      if (!batch) {
        throw new ContentTreeError('FOLDER_NOT_FOUND', 'Deletion batch not found');
      }
      if (batch.folderCount + batch.pageCount > MAX_MUTATION_NODES) {
        throw new ContentTreeError(
          'FOLDER_MUTATION_LIMIT',
          'A recursive content-tree mutation may affect at most 10,000 objects',
        );
      }
      const [folders, pages] = await Promise.all([
        lockedTx.folder.findMany({
          where: { spaceId: input.spaceId, deletionBatchId: batch.id },
          select: {
            id: true, parentId: true, name: true, nameKey: true,
            path: true, pathKey: true, sortOrder: true,
            createdAt: true, updatedAt: true, deletedAt: true, deletionBatchId: true,
          },
          take: MAX_MUTATION_NODES + 1,
        }),
        lockedTx.page.findMany({
          where: { spaceId: input.spaceId, deletionBatchId: batch.id },
          select: {
            id: true, folderId: true, title: true, syncPath: true, syncPathKey: true,
            sortOrder: true, createdAt: true, updatedAt: true,
            knowledgeKey: true, content: true, deletedAt: true, deletionBatchId: true,
          },
          take: MAX_MUTATION_NODES + 1,
        }),
      ]);
      if (
        folders.length !== batch.folderCount
        || pages.length !== batch.pageCount
        || folders.length + pages.length > MAX_MUTATION_NODES
      ) {
        throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Deletion batch membership is inconsistent');
      }
      const expectedFolderIds = batch.folders.map((folder) => folder.id).sort();
      const expectedPageIds = batch.pages.map((page) => page.id).sort();
      const actualFolderIds = folders.map((folder) => folder.id).sort();
      const actualPageIds = pages.map((page) => page.id).sort();
      if (
        JSON.stringify(expectedFolderIds) !== JSON.stringify(actualFolderIds)
        || JSON.stringify(expectedPageIds) !== JSON.stringify(actualPageIds)
        || !actualFolderIds.includes(batch.rootFolderId)
      ) {
        throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Deletion batch membership is inconsistent');
      }
      const authoritativeDeletedAt = batch.createdAt.getTime();
      if (
        [...folders, ...pages].some((record) => (
          record.deletedAt?.getTime() !== authoritativeDeletedAt
          || record.deletionBatchId !== batch.id
        ))
      ) {
        throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Deletion batch membership is inconsistent');
      }
      const root = folders.find((folder) => folder.id === batch.rootFolderId);
      if (!root) throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Deletion batch root is missing');

      const activeFolderCount = await lockedTx.folder.count({
        where: { spaceId: input.spaceId, deletedAt: null },
      });
      if (BigInt(activeFolderCount) + BigInt(folders.length) > MAX_ACTIVE_FOLDERS) {
        throw new ContentTreeError('FOLDER_COUNT_LIMIT', 'A Space may contain at most 10,000 active Folders');
      }

      const folderById = new Map(folders.map((folder) => [folder.id, folder]));
      const depths = new Map<string, number>([[root.id, 0]]);
      if (root.parentId && folderById.has(root.parentId)) {
        throw new ContentTreeError('FOLDER_CYCLE', 'The Folder tree contains a cycle');
      }
      for (const folder of folders) {
        if (depths.has(folder.id)) continue;
        const chain: typeof folders = [];
        const trail = new Set<string>();
        let current: typeof folder | undefined = folder;
        while (current && !depths.has(current.id)) {
          if (trail.has(current.id)) {
            throw new ContentTreeError('FOLDER_CYCLE', 'The Folder tree contains a cycle');
          }
          trail.add(current.id);
          chain.push(current);
          if (!current.parentId || !folderById.has(current.parentId)) {
            throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Deletion batch Folder tree is disconnected');
          }
          current = folderById.get(current.parentId);
        }
        if (!current) {
          throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Deletion batch Folder tree is disconnected');
        }
        let depth = depths.get(current.id)!;
        for (const entry of chain.reverse()) {
          depth += 1;
          depths.set(entry.id, depth);
        }
      }

      const targetParentId = strategy.kind === 'root' ? null : root.parentId;
      const targetParent = targetParentId === null
        ? null
        : await this.activeFolder(lockedTx, input.spaceId, targetParentId);
      if (targetParentId !== null && !targetParent) {
        throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Restore parent is not active');
      }
      const restoreName = renamed?.name ?? root.name;
      const restoreNameKey = renamed?.nameKey ?? root.nameKey;
      await this.assertSiblingNameAvailable(
        lockedTx, input.spaceId, targetParentId, restoreNameKey, root.id, true,
      );

      const parentDepth = targetParentId === null
        ? 0
        : (await this.loadActiveAncestors(lockedTx, input.spaceId, targetParentId)).length;
      const maximumRelativeDepth = Math.max(...depths.values());
      if (parentDepth + 1 + maximumRelativeDepth > MAX_FOLDER_DEPTH) {
        throw new ContentTreeError('FOLDER_DEPTH_LIMIT', 'Folder depth exceeds 32 levels');
      }
      const rows: AffectedTreeRow[] = [
        ...folders.map((folder) => ({
          kind: 'folder' as const,
          id: folder.id,
          parentId: folder.parentId,
          folderId: null,
          name: folder.name,
          title: null,
          path: folder.path,
          pathKey: folder.pathKey,
          sortOrder: folder.sortOrder,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
          depth: depths.get(folder.id)!,
          knowledgeKey: null,
          content: null,
        })),
        ...pages.map((page) => ({
          kind: 'page' as const,
          id: page.id,
          parentId: null,
          folderId: page.folderId,
          name: null,
          title: page.title,
          path: page.syncPath,
          pathKey: page.syncPathKey,
          sortOrder: page.sortOrder,
          createdAt: page.createdAt,
          updatedAt: page.updatedAt,
          depth: (page.folderId ? depths.get(page.folderId) ?? MAX_FOLDER_DEPTH : MAX_FOLDER_DEPTH) + 1,
          knowledgeKey: page.knowledgeKey,
          content: page.content,
        })),
      ];
      if (affectedImpact(rows).impactHash !== batch.impactHash) {
        throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Deletion batch membership is inconsistent');
      }
      const plans = this.planSubtreePaths(
        rows,
        root.id,
        targetParentId,
        targetParent?.path ?? 'pages',
        restoreName,
        restoreNameKey,
      );
      await this.assertPathPlansAvailable(lockedTx, input.spaceId, rows, plans.folders, plans.pages);
      const restoredAt = new Date();
      const currentById = new Map(rows.map((row) => [row.id, row]));
      const changedPages = plans.pages.filter((plan) => {
        const current = currentById.get(plan.id)!;
        return current.path !== plan.path || current.pathKey !== plan.pathKey;
      });
      await this.insertPageAliases(lockedTx, input.spaceId, rows, changedPages, restoredAt);
      await this.applyFolderPlans(
        lockedTx, input.spaceId, plans.folders, input.actor, restoredAt,
        { kind: 'restore', batchId: batch.id },
      );
      await this.applyPagePlans(
        lockedTx, input.spaceId, plans.pages, input.actor, restoredAt,
        { kind: 'restore', batchId: batch.id },
      );
      await this.trimPageAliases(lockedTx, input.spaceId, changedPages.map((plan) => plan.id));
      const marked = await lockedTx.contentDeletionBatch.updateMany({
        where: { id: batch.id, spaceId: input.spaceId, restoredAt: null },
        data: { restoredAt },
      });
      if (marked.count !== 1) {
        throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Deletion batch was already restored');
      }
      const revisions = await this.advanceMutationRevisions(
        lockedTx,
        input.spaceId,
        input.expectedTreeRevision,
        this.pageUpserts(rows, plans.pages),
        input.actor,
      );
      const rootPlan = plans.folders.find((plan) => plan.id === root.id)!;
      return {
        ...revisions,
        batchId: batch.id,
        folder: {
          id: root.id,
          parentId: rootPlan.parentId,
          name: rootPlan.name,
          path: rootPlan.path,
          pathKey: rootPlan.pathKey,
          updatedAt: restoredAt,
        },
      };
    }, { timeout: MUTATION_TRANSACTION_TIMEOUT_MS });
  }

  private async moveFolder(input: MoveTreeNodeInput): Promise<MovedTreeNodeResult> {
    return this.prisma.$transaction(async (tx) => {
      const lockedTx = await this.lockMutationSpace(tx, input.spaceId, input.expectedTreeRevision);
      const rows = await this.loadActiveSubtree(lockedTx, input.spaceId, input.nodeId);
      const root = this.requireAffectedFolder(rows, input.nodeId);
      assertExpectedUpdatedAt(input.expectedUpdatedAt, root.updatedAt);
      assertMutationLimit(rows);
      await this.loadActiveAncestors(lockedTx, input.spaceId, root.id);
      const target = input.targetFolderId === null
        ? null
        : await this.activeFolder(lockedTx, input.spaceId, input.targetFolderId);
      if (input.targetFolderId !== null && !target) {
        throw new ContentTreeError('FOLDER_NOT_FOUND', 'Folder not found');
      }
      const subtreeIds = new Set(rows.filter((row) => row.kind === 'folder').map((row) => row.id));
      if (input.targetFolderId !== null && subtreeIds.has(input.targetFolderId)) {
        throw new ContentTreeError('FOLDER_CYCLE', 'A Folder cannot move into itself or its descendant');
      }
      const targetAncestors = input.targetFolderId === null
        ? []
        : await this.loadActiveAncestors(lockedTx, input.spaceId, input.targetFolderId);
      const maximumRelativeDepth = Math.max(...rows
        .filter((row) => row.kind === 'folder')
        .map((row) => row.depth));
      if (targetAncestors.length + 1 + maximumRelativeDepth > MAX_FOLDER_DEPTH) {
        throw new ContentTreeError('FOLDER_DEPTH_LIMIT', 'Folder depth exceeds 32 levels');
      }
      await this.assertSiblingNameAvailable(
        lockedTx, input.spaceId, input.targetFolderId,
        normalizeFolderName(root.name!).nameKey, root.id,
      );
      const ordering = await this.planSiblingOrders(
        lockedTx, input.spaceId, 'folder', root.id, root.parentId,
        input.targetFolderId, input.beforeId,
      );
      const plans = this.planSubtreePaths(
        rows,
        root.id,
        input.targetFolderId,
        target?.path ?? 'pages',
        root.name!,
        normalizeFolderName(root.name!).nameKey,
      );
      const rootPlan = plans.folders.find((plan) => plan.id === root.id)!;
      rootPlan.sortOrder = ordering.nodeSortOrder;
      const currentById = new Map(rows.map((row) => [row.id, row]));
      const changedFolders = plans.folders.filter((plan) => {
        const current = currentById.get(plan.id)!;
        return plan.id === root.id
          || current.parentId !== plan.parentId
          || current.name !== plan.name
          || current.path !== plan.path
          || current.pathKey !== plan.pathKey
          || current.sortOrder !== plan.sortOrder;
      });
      await this.assertPathPlansAvailable(lockedTx, input.spaceId, rows, plans.folders, plans.pages);
      const changedAt = new Date();
      const changedPages = plans.pages.filter((plan) => {
        const current = currentById.get(plan.id)!;
        return current.path !== plan.path || current.pathKey !== plan.pathKey;
      });
      await this.insertPageAliases(lockedTx, input.spaceId, rows, changedPages, changedAt);
      await this.applyFolderPlans(
        lockedTx, input.spaceId, changedFolders, input.actor, changedAt, { kind: 'active' },
      );
      await this.applyPagePlans(
        lockedTx, input.spaceId, changedPages, input.actor, changedAt, { kind: 'active' },
      );
      await this.applySiblingOrders(
        lockedTx, input.spaceId, 'folder', ordering.orders.filter((order) => order.id !== root.id),
        input.actor, changedAt,
      );
      await this.trimPageAliases(lockedTx, input.spaceId, changedPages.map((plan) => plan.id));
      const revisions = await this.advanceMutationRevisions(
        lockedTx,
        input.spaceId,
        input.expectedTreeRevision,
        this.pageUpserts(rows, changedPages),
        input.actor,
      );
      return {
        ...revisions,
        node: {
          kind: 'folder', id: root.id, parentId: rootPlan.parentId,
          path: rootPlan.path, pathKey: rootPlan.pathKey,
          sortOrder: rootPlan.sortOrder, updatedAt: changedAt,
        },
      };
    }, { timeout: MUTATION_TRANSACTION_TIMEOUT_MS });
  }

  private async movePage(input: MoveTreeNodeInput): Promise<MovedTreeNodeResult> {
    return this.prisma.$transaction(async (tx) => {
      const lockedTx = await this.lockMutationSpace(tx, input.spaceId, input.expectedTreeRevision);
      const page = await lockedTx.page.findFirst({
        where: { id: input.nodeId, spaceId: input.spaceId, deletedAt: null },
        select: {
          id: true, folderId: true, title: true, syncPath: true, syncPathKey: true,
          sortOrder: true, createdAt: true, updatedAt: true, knowledgeKey: true, content: true,
        },
      });
      if (!page) throw new ContentTreeError('CONTENT_TREE_PAGE_NOT_FOUND', 'Page not found');
      assertExpectedUpdatedAt(input.expectedUpdatedAt, page.updatedAt);
      const target = input.targetFolderId === null
        ? null
        : await this.activeFolder(lockedTx, input.spaceId, input.targetFolderId);
      if (input.targetFolderId !== null && !target) {
        throw new ContentTreeError('FOLDER_NOT_FOUND', 'Folder not found');
      }
      if (page.folderId !== null) {
        await this.loadActiveAncestors(lockedTx, input.spaceId, page.folderId);
      }
      if (input.targetFolderId !== null && input.targetFolderId !== page.folderId) {
        await this.loadActiveAncestors(lockedTx, input.spaceId, input.targetFolderId);
      }
      const ordering = await this.planSiblingOrders(
        lockedTx, input.spaceId, 'page', page.id, page.folderId,
        input.targetFolderId, input.beforeId,
      );
      let nextPath = { path: page.syncPath, pathKey: page.syncPathKey };
      if (page.folderId !== input.targetFolderId) {
        const occupiedRows = await lockedTx.page.findMany({
          where: { spaceId: input.spaceId },
          select: { id: true, syncPathKey: true },
        });
        const occupied = new Set(occupiedRows
          .filter((candidate) => candidate.id !== page.id)
          .map((candidate) => candidate.syncPathKey));
        nextPath = await this.syncPaths.allocate(lockedTx, {
          spaceId: input.spaceId,
          directory: target?.path ?? 'pages',
          title: page.title,
          excludePageId: page.id,
        }, occupied);
      }
      const currentRow: AffectedTreeRow = {
        kind: 'page', id: page.id, parentId: null, folderId: page.folderId,
        name: null, title: page.title, path: page.syncPath, pathKey: page.syncPathKey,
        sortOrder: page.sortOrder, createdAt: page.createdAt, updatedAt: page.updatedAt,
        depth: 0, knowledgeKey: page.knowledgeKey, content: page.content,
      };
      const plan: PageMutationPlan = {
        id: page.id,
        folderId: input.targetFolderId,
        path: nextPath.path,
        pathKey: nextPath.pathKey,
        sortOrder: ordering.nodeSortOrder,
        deletedAt: null,
        deletionBatchId: null,
      };
      const changedAt = new Date();
      await this.insertPageAliases(lockedTx, input.spaceId, [currentRow], [plan], changedAt);
      await this.applyPagePlans(
        lockedTx, input.spaceId, [plan], input.actor, changedAt, { kind: 'active' },
      );
      await this.applySiblingOrders(
        lockedTx, input.spaceId, 'page', ordering.orders.filter((order) => order.id !== page.id),
        input.actor, changedAt,
      );
      await this.trimPageAliases(
        lockedTx,
        input.spaceId,
        page.syncPathKey === plan.pathKey ? [] : [page.id],
      );
      const revisions = await this.advanceMutationRevisions(
        lockedTx,
        input.spaceId,
        input.expectedTreeRevision,
        this.pageUpserts([currentRow], [plan]),
        input.actor,
      );
      return {
        ...revisions,
        node: {
          kind: 'page', id: page.id, folderId: plan.folderId,
          path: plan.path, pathKey: plan.pathKey,
          sortOrder: plan.sortOrder, updatedAt: changedAt,
        },
      };
    }, { timeout: MUTATION_TRANSACTION_TIMEOUT_MS });
  }

  private async lockMutationSpace(
    tx: Prisma.TransactionClient,
    spaceId: string,
    expectedTreeRevision: bigint,
  ): Promise<SpaceTreeLockedTransaction> {
    const lockedTx = await this.revisionWriter.lockContentTreeSpace(tx, spaceId);
    if (!lockedTx) throw new ContentTreeError('SPACE_NOT_FOUND', 'Space not found');
    if (lockedTx.contentTreeRevision !== expectedTreeRevision) {
      throw new ContentTreeConflict(expectedTreeRevision, lockedTx.contentTreeRevision);
    }
    return lockedTx;
  }

  private async loadActiveSubtree(
    tx: Prisma.TransactionClient,
    spaceId: string,
    rootFolderId: string,
  ): Promise<AffectedTreeRow[]> {
    const rows = await tx.$queryRaw<Array<AffectedTreeRow & { cycle: boolean }>>(Prisma.sql`
      WITH RECURSIVE folder_subtree AS (
        SELECT
          folder."id", folder."parentId", folder."name", folder."path", folder."pathKey",
          folder."sortOrder", folder."createdAt", folder."updatedAt",
          0::int AS depth, ARRAY[folder."id"]::text[] AS trail, FALSE AS cycle
        FROM "Folder" folder
        WHERE folder."id" = ${rootFolderId}
          AND folder."spaceId" = ${spaceId}
          AND folder."deletedAt" IS NULL
        UNION ALL
        SELECT
          child."id", child."parentId", child."name", child."path", child."pathKey",
          child."sortOrder", child."createdAt", child."updatedAt",
          parent.depth + 1, parent.trail || child."id",
          child."id" = ANY(parent.trail) AS cycle
        FROM "Folder" child
        JOIN folder_subtree parent ON child."parentId" = parent."id"
        WHERE child."spaceId" = ${spaceId}
          AND child."deletedAt" IS NULL
          AND cardinality(parent.trail) <= ${MAX_MUTATION_NODES}
          AND NOT parent.cycle
      ), affected AS (
        SELECT
          'folder'::text AS kind,
          subtree."id",
          subtree."parentId",
          NULL::text AS "folderId",
          subtree."name",
          NULL::text AS title,
          subtree."path" AS path,
          subtree."pathKey" AS "pathKey",
          subtree."sortOrder",
          subtree."createdAt",
          subtree."updatedAt",
          subtree.depth,
          NULL::text AS "knowledgeKey",
          NULL::text AS content,
          subtree.cycle
        FROM folder_subtree subtree
        UNION ALL
        SELECT
          'page'::text AS kind,
          page."id",
          NULL::text AS "parentId",
          page."folderId",
          NULL::text AS name,
          page."title",
          page."syncPath" AS path,
          page."syncPathKey" AS "pathKey",
          page."sortOrder",
          page."createdAt",
          page."updatedAt",
          subtree.depth + 1,
          page."knowledgeKey",
          page."content",
          FALSE AS cycle
        FROM "Page" page
        JOIN folder_subtree subtree ON page."folderId" = subtree."id"
        WHERE page."spaceId" = ${spaceId}
          AND page."deletedAt" IS NULL
          AND NOT subtree.cycle
      )
      SELECT
        kind, "id", "parentId", "folderId", name, title, path, "pathKey",
        "sortOrder", "createdAt", "updatedAt", depth, "knowledgeKey", content, cycle
      FROM affected
      ORDER BY CASE kind WHEN 'folder' THEN 0 ELSE 1 END, depth, "id"
      LIMIT ${MAX_MUTATION_NODES + 2}
    `);
    if (rows.some((row) => row.cycle)) {
      throw new ContentTreeError('FOLDER_CYCLE', 'The Folder tree contains a cycle');
    }
    return rows;
  }

  private requireAffectedFolder(
    rows: readonly AffectedTreeRow[],
    folderId: string,
  ): AffectedTreeRow & { kind: 'folder' } {
    const root = rows.find((row) => row.kind === 'folder' && row.id === folderId);
    if (!root) throw new ContentTreeError('FOLDER_NOT_FOUND', 'Folder not found');
    return root as AffectedTreeRow & { kind: 'folder' };
  }

  private async activeFolder(
    tx: Prisma.TransactionClient,
    spaceId: string,
    folderId: string,
  ) {
    return tx.folder.findFirst({
      where: { id: folderId, spaceId, deletedAt: null },
      select: {
        id: true, parentId: true, name: true, nameKey: true,
        path: true, pathKey: true, sortOrder: true, createdAt: true, updatedAt: true,
      },
    });
  }

  private async loadActiveAncestors(
    tx: Prisma.TransactionClient,
    spaceId: string,
    folderId: string,
  ): Promise<AncestorRow[]> {
    const ancestors = await tx.$queryRaw<CycleAwareAncestorRow[]>(Prisma.sql`
      WITH RECURSIVE ancestors AS (
        SELECT folder."id", folder."parentId", folder."path", 1::int AS depth,
               ARRAY[folder."id"]::text[] AS trail, FALSE AS cycle
        FROM "Folder" folder
        WHERE folder."id" = ${folderId}
          AND folder."spaceId" = ${spaceId}
          AND folder."deletedAt" IS NULL
        UNION ALL
        SELECT parent."id", parent."parentId", parent."path", child.depth + 1,
               child.trail || parent."id", parent."id" = ANY(child.trail) AS cycle
        FROM "Folder" parent
        JOIN ancestors child ON parent."id" = child."parentId"
        WHERE parent."spaceId" = ${spaceId}
          AND parent."deletedAt" IS NULL
          AND cardinality(child.trail) <= ${MAX_MUTATION_NODES}
          AND NOT child.cycle
      )
      SELECT "id", "parentId", "path", depth, cycle
      FROM ancestors
      ORDER BY depth ASC
      LIMIT ${MAX_MUTATION_NODES + 2}
    `);
    if (ancestors.some((ancestor) => ancestor.cycle)) {
      throw new ContentTreeError('FOLDER_CYCLE', 'The Folder tree contains a cycle');
    }
    if (ancestors.length > MAX_FOLDER_DEPTH) {
      throw new ContentTreeError('FOLDER_DEPTH_LIMIT', 'Folder depth exceeds 32 levels');
    }
    return ancestors;
  }

  private async assertSiblingNameAvailable(
    tx: Prisma.TransactionClient,
    spaceId: string,
    parentId: string | null,
    nameKey: string,
    excludeFolderId: string,
    restore = false,
  ): Promise<void> {
    const duplicate = await tx.folder.findFirst({
      where: {
        spaceId,
        parentId,
        nameKey,
        deletedAt: null,
        id: { not: excludeFolderId },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ContentTreeError(
        restore ? 'FOLDER_RESTORE_CONFLICT' : 'FOLDER_NAME_CONFLICT',
        'A sibling Folder already uses this portable name',
      );
    }
  }

  private planSubtreePaths(
    rows: readonly AffectedTreeRow[],
    rootFolderId: string,
    rootParentId: string | null,
    parentPath: string,
    rootName: string,
    rootNameKey: string,
  ): { folders: FolderMutationPlan[]; pages: PageMutationPlan[] } {
    const folderRows = rows
      .filter((row): row is AffectedTreeRow & { kind: 'folder' } => row.kind === 'folder')
      .sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id));
    const folderPlans: FolderMutationPlan[] = [];
    const byId = new Map<string, FolderMutationPlan>();
    for (const row of folderRows) {
      const isRoot = row.id === rootFolderId;
      const parentPlan = isRoot ? null : (row.parentId ? byId.get(row.parentId) : undefined);
      if (!isRoot && !parentPlan) {
        throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Folder subtree is disconnected');
      }
      const normalized = isRoot
        ? { name: rootName, nameKey: rootNameKey }
        : normalizeFolderName(row.name!);
      const portable = portableDirectoryPath(
        `${isRoot ? parentPath : parentPlan!.path}/${normalized.name}`,
      );
      const plan: FolderMutationPlan = {
        id: row.id,
        parentId: isRoot ? rootParentId : row.parentId,
        name: normalized.name,
        nameKey: normalized.nameKey,
        path: portable.path,
        pathKey: portable.key,
        sortOrder: row.sortOrder,
        depth: row.depth,
        deletedAt: null,
        deletionBatchId: null,
      };
      folderPlans.push(plan);
      byId.set(plan.id, plan);
    }
    const pagePlans = rows
      .filter((row): row is AffectedTreeRow & { kind: 'page' } => row.kind === 'page')
      .map((row): PageMutationPlan => {
        const folder = row.folderId ? byId.get(row.folderId) : null;
        if (!folder) {
          throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Page is outside the affected Folder subtree');
        }
        const portable = portablePagePath(`${folder.path}/${basename(row.path)}`);
        return {
          id: row.id,
          folderId: row.folderId,
          path: portable.path,
          pathKey: portable.key,
          sortOrder: row.sortOrder,
          deletedAt: null,
          deletionBatchId: null,
        };
      });
    const folderKeys = new Set(folderPlans.map((plan) => plan.pathKey));
    if (folderKeys.size !== folderPlans.length) {
      throw new ContentTreeError('FOLDER_NAME_CONFLICT', 'Folder paths collide after the mutation');
    }
    const pageKeys = new Set(pagePlans.map((plan) => plan.pathKey));
    if (pageKeys.size !== pagePlans.length) {
      throw new ContentTreeError('CONTENT_TREE_CONFLICT', 'Page paths collide after the mutation');
    }
    return { folders: folderPlans, pages: pagePlans };
  }

  private async assertPathPlansAvailable(
    tx: Prisma.TransactionClient,
    spaceId: string,
    rows: readonly AffectedTreeRow[],
    folders: readonly FolderMutationPlan[],
    pages: readonly PageMutationPlan[],
  ): Promise<void> {
    const affectedFolderIds = rows.filter((row) => row.kind === 'folder').map((row) => row.id);
    const affectedPageIds = rows.filter((row) => row.kind === 'page').map((row) => row.id);
    const [folderConflicts, pageConflicts] = await Promise.all([
      folders.length === 0 ? [] : tx.folder.findMany({
        where: {
          spaceId,
          deletedAt: null,
          id: { notIn: affectedFolderIds },
          pathKey: { in: folders.map((plan) => plan.pathKey) },
        },
        select: { id: true },
        take: 1,
      }),
      pages.length === 0 ? [] : tx.page.findMany({
        where: {
          spaceId,
          id: { notIn: affectedPageIds },
          syncPathKey: { in: pages.map((plan) => plan.pathKey) },
        },
        select: { id: true },
        take: 1,
      }),
    ]);
    if (folderConflicts.length > 0) {
      throw new ContentTreeError('FOLDER_NAME_CONFLICT', 'A Folder path is already occupied');
    }
    if (pageConflicts.length > 0) {
      throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'A Page path is already occupied');
    }
  }

  private async insertPageAliases(
    tx: Prisma.TransactionClient,
    spaceId: string,
    rows: readonly AffectedTreeRow[],
    plans: readonly PageMutationPlan[],
    createdAt: Date,
  ): Promise<void> {
    const currentById = new Map(rows.map((row) => [row.id, row]));
    const aliases = plans.flatMap((plan) => {
      const current = currentById.get(plan.id);
      if (!current || (current.path === plan.path && current.pathKey === plan.pathKey)) return [];
      return [{
        id: randomUUID(),
        spaceId,
        pageId: current.id,
        path: current.path,
        pathKey: current.pathKey,
        createdAt,
      }];
    });
    if (aliases.length > 0) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "PagePathAlias" (
          "id", "spaceId", "pageId", "path", "pathKey", "createdAt", "expiresAt"
        )
        SELECT
          alias."id", alias."spaceId", alias."pageId", alias."path", alias."pathKey",
          alias."createdAt", NULL
        FROM jsonb_to_recordset(${JSON.stringify(aliases)}::jsonb) AS alias(
          "id" text,
          "spaceId" text,
          "pageId" text,
          "path" text,
          "pathKey" text,
          "createdAt" timestamptz
        )
        ON CONFLICT ("spaceId", "pathKey", "pageId") DO UPDATE SET
          "path" = EXCLUDED."path",
          "createdAt" = EXCLUDED."createdAt",
          "expiresAt" = NULL
      `);
    }
  }

  private async trimPageAliases(
    tx: Prisma.TransactionClient,
    spaceId: string,
    pageIds: readonly string[],
  ): Promise<void> {
    const uniquePageIds = [...new Set(pageIds)].sort();
    if (uniquePageIds.length === 0) return;
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "PagePathAlias" alias
      USING (
        SELECT ranked."id"
        FROM (
          SELECT candidate."id",
                 ROW_NUMBER() OVER (
                   PARTITION BY candidate."pageId"
                   ORDER BY candidate."createdAt" DESC, candidate."id" DESC
                 ) AS ordinal
          FROM "PagePathAlias" candidate
          WHERE candidate."spaceId" = ${spaceId}
            AND candidate."pageId" IN (
              SELECT value
              FROM jsonb_array_elements_text(${JSON.stringify(uniquePageIds)}::jsonb)
            )
        ) ranked
        WHERE ranked.ordinal > ${MAX_PAGE_ALIASES}
      ) excess
      WHERE alias."id" = excess."id"
    `);
  }

  private async applyFolderPlans(
    tx: Prisma.TransactionClient,
    spaceId: string,
    plans: readonly FolderMutationPlan[],
    actor: ContentTreeActor,
    changedAt: Date,
    guard: { kind: 'active' } | { kind: 'restore'; batchId: string },
  ): Promise<void> {
    const depths = [...new Set(plans.map((plan) => plan.depth))].sort((left, right) => left - right);
    for (const depth of depths) {
      const group = plans.filter((plan) => plan.depth === depth);
      if (group.length === 0) continue;
      const predicate = guard.kind === 'active'
        ? Prisma.sql`AND target."deletedAt" IS NULL`
        : Prisma.sql`
          AND target."deletedAt" IS NOT NULL
          AND target."deletionBatchId" = ${guard.batchId}
        `;
      const updated = await tx.$executeRaw(Prisma.sql`
        UPDATE "Folder" target
        SET
          "parentId" = plan."parentId",
          "name" = plan."name",
          "nameKey" = plan."nameKey",
          "path" = plan."path",
          "pathKey" = plan."pathKey",
          "sortOrder" = plan."sortOrder",
          "deletedAt" = plan."deletedAt",
          "deletionBatchId" = plan."deletionBatchId",
          "lastModifiedByUserId" = ${actor.userId ?? null},
          "lastModifiedByAgentId" = ${actor.agentId ?? null},
          "lastModifiedAt" = ${changedAt},
          "updatedAt" = ${changedAt}
        FROM jsonb_to_recordset(${JSON.stringify(group)}::jsonb) AS plan(
          "id" text,
          "parentId" text,
          "name" text,
          "nameKey" text,
          "path" text,
          "pathKey" text,
          "sortOrder" integer,
          "deletedAt" timestamptz,
          "deletionBatchId" text
        )
        WHERE target."id" = plan."id"
          AND target."spaceId" = ${spaceId}
          ${predicate}
      `);
      if (updated < group.length) {
        throw new ContentTreeConflict(changedAt, changedAt);
      }
    }
  }

  private async applyPagePlans(
    tx: Prisma.TransactionClient,
    spaceId: string,
    plans: readonly PageMutationPlan[],
    actor: ContentTreeActor,
    changedAt: Date,
    guard: { kind: 'active' } | { kind: 'restore'; batchId: string },
  ): Promise<void> {
    if (plans.length === 0) return;
    const predicate = guard.kind === 'active'
      ? Prisma.sql`AND target."deletedAt" IS NULL`
      : Prisma.sql`
        AND target."deletedAt" IS NOT NULL
        AND target."deletionBatchId" = ${guard.batchId}
      `;
    const updated = await tx.$executeRaw(Prisma.sql`
      UPDATE "Page" target
      SET
        "folderId" = plan."folderId",
        "syncPath" = plan."path",
        "syncPathKey" = plan."pathKey",
        "sortOrder" = plan."sortOrder",
        "deletedAt" = plan."deletedAt",
        "deletionBatchId" = plan."deletionBatchId",
        "lastModifiedByUserId" = ${actor.userId ?? null},
        "lastModifiedByAgentId" = ${actor.agentId ?? null},
        "lastModifiedAt" = ${changedAt},
        "updatedAt" = ${changedAt}
      FROM jsonb_to_recordset(${JSON.stringify(plans)}::jsonb) AS plan(
        "id" text,
        "folderId" text,
        "path" text,
        "pathKey" text,
        "sortOrder" integer,
        "deletedAt" timestamptz,
        "deletionBatchId" text
      )
      WHERE target."id" = plan."id"
        AND target."spaceId" = ${spaceId}
        ${predicate}
    `);
    if (updated < plans.length) {
      throw new ContentTreeConflict(changedAt, changedAt);
    }
  }

  private async planSiblingOrders(
    tx: Prisma.TransactionClient,
    spaceId: string,
    kind: 'folder' | 'page',
    nodeId: string,
    sourceParentId: string | null,
    targetParentId: string | null,
    beforeId?: string,
  ): Promise<{ orders: Array<{ id: string; sortOrder: number }>; nodeSortOrder: number }> {
    const load = async (parentId: string | null): Promise<OrderedSibling[]> => (
      kind === 'folder'
        ? tx.folder.findMany({
          where: { spaceId, parentId, deletedAt: null },
          select: { id: true, sortOrder: true, createdAt: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        })
        : tx.page.findMany({
          where: { spaceId, folderId: parentId, deletedAt: null },
          select: { id: true, sortOrder: true, createdAt: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        })
    );
    const sameParent = sourceParentId === targetParentId;
    const source = await load(sourceParentId);
    const target = sameParent ? source : await load(targetParentId);
    const targetWithoutNode = target.filter((sibling) => sibling.id !== nodeId);
    let insertion = targetWithoutNode.length;
    if (beforeId !== undefined) {
      insertion = targetWithoutNode.findIndex((sibling) => sibling.id === beforeId);
      if (insertion < 0) {
        throw new ContentTreeError(
          kind === 'folder' ? 'FOLDER_NOT_FOUND' : 'CONTENT_TREE_PAGE_NOT_FOUND',
          `${kind === 'folder' ? 'Folder' : 'Page'} ordering target not found`,
        );
      }
    }
    const inserted = [
      ...targetWithoutNode.slice(0, insertion),
      { id: nodeId, sortOrder: 0, createdAt: new Date(0) },
      ...targetWithoutNode.slice(insertion),
    ];
    const orders = sameParent
      ? inserted.map((sibling, sortOrder) => ({ id: sibling.id, sortOrder }))
      : [
        ...source.filter((sibling) => sibling.id !== nodeId)
          .map((sibling, sortOrder) => ({ id: sibling.id, sortOrder })),
        ...inserted.map((sibling, sortOrder) => ({ id: sibling.id, sortOrder })),
      ];
    return {
      orders,
      nodeSortOrder: orders.find((order) => order.id === nodeId)!.sortOrder,
    };
  }

  private async applySiblingOrders(
    tx: Prisma.TransactionClient,
    spaceId: string,
    kind: 'folder' | 'page',
    orders: readonly { id: string; sortOrder: number }[],
    actor: ContentTreeActor,
    changedAt: Date,
  ): Promise<void> {
    if (orders.length === 0) return;
    const payload = JSON.stringify(orders);
    const updated = kind === 'folder'
      ? await tx.$executeRaw(Prisma.sql`
        UPDATE "Folder" target
        SET
          "sortOrder" = plan."sortOrder",
          "lastModifiedByUserId" = ${actor.userId ?? null},
          "lastModifiedByAgentId" = ${actor.agentId ?? null},
          "lastModifiedAt" = ${changedAt},
          "updatedAt" = ${changedAt}
        FROM jsonb_to_recordset(${payload}::jsonb) AS plan("id" text, "sortOrder" integer)
        WHERE target."id" = plan."id"
          AND target."spaceId" = ${spaceId}
          AND target."deletedAt" IS NULL
      `)
      : await tx.$executeRaw(Prisma.sql`
        UPDATE "Page" target
        SET
          "sortOrder" = plan."sortOrder",
          "lastModifiedByUserId" = ${actor.userId ?? null},
          "lastModifiedByAgentId" = ${actor.agentId ?? null},
          "lastModifiedAt" = ${changedAt},
          "updatedAt" = ${changedAt}
        FROM jsonb_to_recordset(${payload}::jsonb) AS plan("id" text, "sortOrder" integer)
        WHERE target."id" = plan."id"
          AND target."spaceId" = ${spaceId}
          AND target."deletedAt" IS NULL
      `);
    if (updated < orders.length) {
      throw new ContentTreeConflict(changedAt, changedAt);
    }
  }

  private pageUpserts(
    rows: readonly AffectedTreeRow[],
    plans: readonly PageMutationPlan[],
  ) {
    const currentById = new Map(rows.map((row) => [row.id, row]));
    return plans.map((plan) => {
      const current = currentById.get(plan.id);
      if (!current?.knowledgeKey || current.title === null || current.content === null) {
        throw new ContentTreeError('CONTENT_TREE_CONFLICT', 'Page revision identity is incomplete');
      }
      return {
        operation: 'upsert' as const,
        pageId: current.knowledgeKey,
        folderId: plan.folderId,
        path: plan.path,
        title: current.title,
        body: current.content,
      };
    });
  }

  private async advanceMutationRevisions(
    tx: SpaceTreeLockedTransaction,
    spaceId: string,
    expectedTreeRevision: bigint,
    pageChanges: StructuralPageChange[],
    actor: ContentTreeActor,
    revisionOrigin?: AdvancePageMutationInput['revisionOrigin'],
  ): Promise<{ treeRevision: bigint; syncRevisionId: string }> {
    const treeRevision = await this.revisionWriter.advanceContentTreeRevision(
      tx, spaceId, expectedTreeRevision,
    );
    const syncRevision = await this.revisionWriter.advanceStructuralPages(
      tx, spaceId, pageChanges, { ...mutationOrigin(actor), ...revisionOrigin },
    );
    return { treeRevision, syncRevisionId: syncRevision.revisionId };
  }
}
