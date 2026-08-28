import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  canonicalBytes,
  contentHash,
  foldCase,
  normalizeMarkdown,
  pathKey,
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
  type PrepareExactPageMutationInput,
  type PublishSyncV2BatchInput,
  type PublishSyncV2BatchResult,
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
      const syncRevision = await this.revisionWriter.advanceLocked(lockedTx, input.spaceId, [], {
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

  async lockSyncMutationSpace(
    tx: Prisma.TransactionClient,
    spaceId: string,
    expectedTreeRevision?: bigint,
  ): Promise<SpaceTreeLockedTransaction> {
    const lockedTx = await this.revisionWriter.lockSyncSpace(tx, spaceId);
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

  async prepareExactPageMutation(
    lockedTx: SpaceTreeLockedTransaction,
    input: PrepareExactPageMutationInput,
  ): Promise<PlacedPageResult> {
    const requested = portablePagePath(input.syncPath);
    const separator = requested.path.lastIndexOf('/');
    const directory = separator < 0 ? '' : requested.path.slice(0, separator);
    let resolvedFolder: { id: string; path: string; pathKey: string } | null = null;
    if (directory !== '' && directory !== 'pages') {
      const normalizedDirectory = portableDirectoryPath(directory);
      const candidates = await lockedTx.folder.findMany({
        where: {
          spaceId: input.spaceId,
          deletedAt: null,
          pathKey: normalizedDirectory.key,
        },
        select: { id: true, path: true, pathKey: true },
        take: 2,
      });
      if (candidates.length !== 1) {
        throw new ContentTreeError(
          'FOLDER_NOT_FOUND',
          'Page path does not identify one active Folder in this Space',
        );
      }
      [resolvedFolder] = candidates;
    }
    if (
      input.folderId !== undefined
      && input.folderId !== (resolvedFolder?.id ?? null)
    ) {
      throw new ContentTreeError(
        'FOLDER_NOT_FOUND',
        'Page path does not match the requested active Folder',
      );
    }
    const conflict = await lockedTx.page.findFirst({
      where: {
        spaceId: input.spaceId,
        syncPathKey: requested.key,
        id: { not: input.pageId },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ContentTreeError(
        'CONTENT_TREE_CONFLICT',
        'Page path is already used by another Page',
      );
    }
    const folderId = resolvedFolder?.id ?? null;
    if (input.current && (
      input.current.folderId !== folderId
      || input.current.syncPath !== requested.path
      || input.current.syncPathKey !== requested.key
    )) {
      const currentRow: AffectedTreeRow = {
        kind: 'page', id: input.pageId, parentId: null,
        folderId: input.current.folderId, name: null, title: input.current.title,
        path: input.current.syncPath, pathKey: input.current.syncPathKey,
        sortOrder: input.current.sortOrder, createdAt: input.current.createdAt,
        updatedAt: input.current.updatedAt, depth: 0,
        knowledgeKey: input.current.knowledgeKey, content: input.current.content,
      };
      const plan: PageMutationPlan = {
        id: input.pageId,
        folderId,
        path: requested.path,
        pathKey: requested.key,
        sortOrder: input.current.sortOrder,
        deletedAt: null,
        deletionBatchId: null,
      };
      const changedAt = new Date();
      await this.insertPageAliases(lockedTx, input.spaceId, [currentRow], [plan], changedAt);
      await this.trimPageAliases(lockedTx, input.spaceId, [input.pageId]);
    }
    return {
      folderId,
      syncPath: requested.path,
      syncPathKey: requested.key,
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
      await this.revisionWriter.finalizeExistingTreeV2Locked(
        lockedTx,
        input.spaceId,
        input.existingSyncRevisionId,
      );
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
    const syncRevision = await this.revisionWriter.advanceLocked(
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

  async publishSyncV2Batch(
    tx: Prisma.TransactionClient,
    input: PublishSyncV2BatchInput,
  ): Promise<PublishSyncV2BatchResult> {
    const lockedTx = await this.revisionWriter.lockContentTreeSpace(tx, input.spaceId);
    if (!lockedTx) throw new ContentTreeError('SPACE_NOT_FOUND', 'Space not found');
    if (input.principal.platformRole !== 'super_admin') {
      const membership = await lockedTx.spaceMember.findUnique({
        where: { userId_spaceId: { userId: input.principal.userId, spaceId: input.spaceId } },
        select: { role: true },
      });
      if (!membership) throw new ContentTreeError('CONTENT_TREE_SPACE_FORBIDDEN', 'Space is not accessible');
      if (!['editor', 'owner'].includes(membership.role)) {
        throw new ContentTreeError('CONTENT_TREE_SPACE_READ_ONLY', 'Live Space role does not permit publishing');
      }
    }
    return this.publishSyncV2BatchLocked(lockedTx, input);
  }

  async publishSyncV2BatchLocked(
    lockedTx: SpaceTreeLockedTransaction,
    input: PublishSyncV2BatchInput,
  ): Promise<PublishSyncV2BatchResult> {
    assertActor(input.actor);
    if (input.changes.length > 100) {
      throw new ContentTreeError('FOLDER_MUTATION_LIMIT', 'A Sync v2 publish may contain at most 100 changes');
    }
    const head = await lockedTx.spaceKnowledgeRevision.findFirst({
      where: { spaceId: input.spaceId }, orderBy: { sequence: 'desc' },
    });
    if ((head?.id ?? '0') !== input.baseRevision) {
      throw new ContentTreeConflict(lockedTx.contentTreeRevision, lockedTx.contentTreeRevision);
    }
    const folderCountAtHead = head ? await lockedTx.syncRevisionFolderRow.count({ where: { revisionId: head.id } }) : 0;
    if (input.changes.length === 0) {
      return {
        protocolVersion: '2', status: 'noop', revision: head?.id ?? '0', sequence: head?.sequence ?? 0,
        publishedAt: head?.createdAt.toISOString() ?? null,
        revisionContentHash: head?.revisionContentHash ?? 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        folderCount: String(folderCountAtHead), pageCount: String(head?.pageCount ?? 0n),
        revisionManifestByteLength: String(head?.revisionManifestByteLength ?? 0n),
        revisionBodyBytes: String(head?.revisionBodyBytes ?? 0n), changeSetId: null,
      };
    }

    const entityKeys = input.changes.map((change) => change.operation === 'upsert_folder'
      ? `folder:${change.folder.folderId}`
      : change.operation === 'archive_folder'
        ? `folder:${change.folderId}`
        : change.operation === 'upsert_page'
          ? `page:${change.page.pageId}`
          : `page:${change.pageId}`);
    if (new Set(entityKeys).size !== entityKeys.length) {
      throw new ContentTreeError('CONTENT_TREE_PAYLOAD_INVALID', 'A Sync v2 batch may mutate each entity only once');
    }
    const [allFolders, allPages] = await Promise.all([
      lockedTx.folder.findMany({ where: { spaceId: input.spaceId } }),
      lockedTx.page.findMany({ where: { spaceId: input.spaceId } }),
    ]);
    const folderById = new Map(allFolders.map((folder) => [folder.id, folder]));
    const pageByKey = new Map(allPages.map((page) => [page.knowledgeKey, page]));
    const folderUpserts = input.changes.filter((change) => change.operation === 'upsert_folder');
    const folderArchives = input.changes.filter((change) => change.operation === 'archive_folder');
    const pageUpserts = input.changes.filter((change) => change.operation === 'upsert_page');
    const pageArchives = input.changes.filter((change) => change.operation === 'archive_page');

    const foreignFolderIds = folderUpserts.map((change) => change.folder.folderId)
      .filter((id) => !folderById.has(id));
    if (foreignFolderIds.length > 0 && await lockedTx.folder.count({
      where: { id: { in: foreignFolderIds }, spaceId: { not: input.spaceId } },
    }) > 0) throw new ContentTreeError('CONTENT_TREE_ID_CONFLICT', 'Folder ID belongs to another Space');
    const foreignPageIds = pageUpserts.map((change) => change.page.pageId)
      .filter((id) => !pageByKey.has(id));
    if (foreignPageIds.length > 0 && await lockedTx.page.count({
      where: { knowledgeKey: { in: foreignPageIds }, spaceId: { not: input.spaceId } },
    }) > 0) throw new ContentTreeError('CONTENT_TREE_ID_CONFLICT', 'Page ID belongs to another Space');

    const archivedFolderIds = new Set<string>();
    for (const change of folderArchives) {
      const root = folderById.get(change.folderId);
      if (!root || root.deletedAt) throw new ContentTreeError('FOLDER_NOT_FOUND', 'Archive target Folder is not active');
      if (root.path !== change.previousPath) throw new ContentTreeError('CONTENT_TREE_CONFLICT', 'Archive Folder path is stale');
      const queue = [root.id];
      for (let index = 0; index < queue.length; index += 1) {
        const id = queue[index]!;
        if (archivedFolderIds.has(id)) throw new ContentTreeError('CONTENT_TREE_PAYLOAD_INVALID', 'Folder archive subtrees overlap');
        archivedFolderIds.add(id);
        for (const child of allFolders) {
          if (!child.deletedAt && child.parentId === id) queue.push(child.id);
        }
      }
    }
    if (folderUpserts.some((change) => archivedFolderIds.has(change.folder.folderId))) {
      throw new ContentTreeError('CONTENT_TREE_PAYLOAD_INVALID', 'A Folder cannot be archived and upserted together');
    }
    const folderArchivedPageKeys = new Set(allPages
      .filter((page) => !page.deletedAt && page.folderId && archivedFolderIds.has(page.folderId))
      .map((page) => page.knowledgeKey));
    if (pageUpserts.some((change) => folderArchivedPageKeys.has(change.page.pageId))
      || pageArchives.some((change) => folderArchivedPageKeys.has(change.pageId))) {
      throw new ContentTreeError('CONTENT_TREE_PAYLOAD_INVALID', 'Folder archives own all descendant Page archives');
    }

    const restoredBatchIds = new Set<string>();
    for (const change of [...folderUpserts, ...pageUpserts]) {
      const batchId = change.operation === 'upsert_folder'
        ? folderById.get(change.folder.folderId)?.deletionBatchId
        : pageByKey.get(change.page.pageId)?.deletionBatchId;
      if (batchId) restoredBatchIds.add(batchId);
    }
    for (const batchId of restoredBatchIds) {
      const batchFolders = allFolders.filter((folder) => folder.deletionBatchId === batchId);
      const batchPages = allPages.filter((page) => page.deletionBatchId === batchId);
      const folderChanges = new Map(folderUpserts.map((change) => [change.folder.folderId, change.folder]));
      const pageChanges = new Map(pageUpserts.map((change) => [change.page.pageId, change.page]));
      if (batchFolders.some((folder) => !folderChanges.has(folder.id))
        || batchPages.some((page) => !pageChanges.has(page.knowledgeKey))) {
        throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'A Folder deletion batch may only be restored as one complete batch');
      }
      for (const folder of batchFolders) {
        const proposed = folderChanges.get(folder.id)!;
        if (proposed.parentFolderId !== folder.parentId || proposed.name !== folder.name
          || proposed.path !== folder.path || proposed.sortOrder !== folder.sortOrder
          || proposed.updatedAt !== folder.updatedAt.toISOString()) {
          throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Deletion-batch Folder restore must preserve the archived snapshot');
        }
      }
      for (const page of batchPages) {
        const proposed = pageChanges.get(page.knowledgeKey)!;
        if (proposed.folderId !== page.folderId || proposed.title !== page.title
          || proposed.path !== page.syncPath || proposed.body !== page.content
          || proposed.updatedAt !== page.updatedAt.toISOString()) {
          throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Deletion-batch Page restore must preserve the archived snapshot');
        }
      }
    }
    if (folderUpserts.some((change) => {
      const current = folderById.get(change.folder.folderId);
      return !!current?.deletedAt && !current.deletionBatchId;
    })) throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Deleted Folders require deletion-batch restore');

    const desiredFolders = new Map(allFolders
      .filter((folder) => !folder.deletedAt || (folder.deletionBatchId && restoredBatchIds.has(folder.deletionBatchId)))
      .filter((folder) => !archivedFolderIds.has(folder.id))
      .map((folder) => [folder.id, {
        folderId: folder.id, parentFolderId: folder.parentId, name: folder.name,
        path: folder.path, sortOrder: folder.sortOrder, updatedAt: folder.updatedAt.toISOString(),
      }]));
    for (const change of folderUpserts) {
      const current = folderById.get(change.folder.folderId);
      if (current && !current.deletedAt && change.folder.updatedAt !== current.updatedAt.toISOString()) {
        throw new ContentTreeError('CONTENT_TREE_CONFLICT', 'Folder updatedAt is stale');
      }
      const normalized = normalizeFolderName(change.folder.name);
      const portable = portableDirectoryPath(change.folder.path);
      if (normalized.name !== change.folder.name || portable.path !== change.folder.path) {
        throw new ContentTreeError('FOLDER_INVALID_NAME', 'Folder name or path is not canonical');
      }
      desiredFolders.set(change.folder.folderId, change.folder);
    }
    if (desiredFolders.size > Number(MAX_ACTIVE_FOLDERS)) {
      throw new ContentTreeError('FOLDER_COUNT_LIMIT', 'A Space may contain at most 10,000 active Folders');
    }
    const folderDepths = new Map<string, number>();
    const resolveDepth = (folderId: string, trail = new Set<string>()): number => {
      const known = folderDepths.get(folderId);
      if (known !== undefined) return known;
      if (trail.has(folderId)) throw new ContentTreeError('FOLDER_CYCLE', 'The Folder tree contains a cycle');
      const folder = desiredFolders.get(folderId);
      if (!folder) throw new ContentTreeError('FOLDER_NOT_FOUND', 'Folder parent is not active');
      trail.add(folderId);
      const depth = folder.parentFolderId === null ? 1 : resolveDepth(folder.parentFolderId, trail) + 1;
      if (depth > MAX_FOLDER_DEPTH) throw new ContentTreeError('FOLDER_DEPTH_LIMIT', 'Folder depth exceeds 32 levels');
      folderDepths.set(folderId, depth);
      return depth;
    };
    const siblingKeys = new Set<string>();
    const folderPaths = new Set<string>();
    for (const folder of desiredFolders.values()) {
      const parentPath = folder.parentFolderId === null ? 'pages' : desiredFolders.get(folder.parentFolderId)?.path;
      if (!parentPath) throw new ContentTreeError('FOLDER_NOT_FOUND', 'Folder parent is not active');
      const normalized = normalizeFolderName(folder.name);
      const expected = portableDirectoryPath(`${parentPath}/${normalized.name}`);
      if (folder.path !== expected.path) throw new ContentTreeError('CONTENT_TREE_PAYLOAD_INVALID', 'Folder path does not match its parent and name');
      resolveDepth(folder.folderId);
      const siblingKey = `${folder.parentFolderId ?? ''}\0${normalized.nameKey}`;
      if (siblingKeys.has(siblingKey) || folderPaths.has(expected.key)) {
        throw new ContentTreeError('FOLDER_NAME_CONFLICT', 'Folder paths or sibling names collide');
      }
      siblingKeys.add(siblingKey);
      folderPaths.add(expected.key);
    }

    const explicitlyArchivedPageKeys = new Set<string>();
    for (const change of pageArchives) {
      const current = pageByKey.get(change.pageId);
      if (!current || current.deletedAt) throw new ContentTreeError('CONTENT_TREE_PAGE_NOT_FOUND', 'Archive target Page is not active');
      if (current.syncPath !== change.previousPath) throw new ContentTreeError('CONTENT_TREE_CONFLICT', 'Archive Page path is stale');
      explicitlyArchivedPageKeys.add(change.pageId);
    }
    const desiredPages = new Map(allPages
      .filter((page) => !page.deletedAt || (page.deletionBatchId && restoredBatchIds.has(page.deletionBatchId)))
      .filter((page) => !explicitlyArchivedPageKeys.has(page.knowledgeKey) && !folderArchivedPageKeys.has(page.knowledgeKey))
      .map((page) => [page.knowledgeKey, {
        pageId: page.knowledgeKey, folderId: page.folderId, path: page.syncPath,
        title: page.title, body: page.content, updatedAt: page.updatedAt.toISOString(),
      }]));
    for (const change of pageUpserts) {
      const current = pageByKey.get(change.page.pageId);
      if (current && !current.deletedAt && change.page.updatedAt !== current.updatedAt.toISOString()) {
        throw new ContentTreeError('CONTENT_TREE_CONFLICT', 'Page updatedAt is stale');
      }
      const body = normalizeMarkdown(change.page.body);
      if (await contentHash(body) !== change.page.contentHash) {
        throw new ContentTreeError('CONTENT_TREE_PAYLOAD_INVALID', 'Page content hash is invalid');
      }
      if (change.page.folderId !== null && !desiredFolders.has(change.page.folderId)) {
        throw new ContentTreeError('FOLDER_NOT_FOUND', 'Page references a Folder that is not active');
      }
      const portable = portablePagePath(change.page.path);
      const directory = portable.path.slice(0, portable.path.lastIndexOf('/'));
      const expectedDirectory = change.page.folderId === null ? 'pages' : desiredFolders.get(change.page.folderId)!.path;
      if (directory !== expectedDirectory) throw new ContentTreeError('FOLDER_NOT_FOUND', 'Page path does not match its Folder reference');
      desiredPages.set(change.page.pageId, { ...change.page, body });
    }
    const pagePaths = new Map<string, string>();
    for (const page of desiredPages.values()) {
      if (page.folderId !== null && !desiredFolders.has(page.folderId)) {
        throw new ContentTreeError('FOLDER_NOT_FOUND', 'Active Page references a missing Folder');
      }
      const portable = portablePagePath(page.path);
      const directory = portable.path.slice(0, portable.path.lastIndexOf('/'));
      const expectedDirectory = page.folderId === null ? 'pages' : desiredFolders.get(page.folderId)!.path;
      if (directory !== expectedDirectory) throw new ContentTreeError('FOLDER_NOT_FOUND', 'Page path does not match its Folder reference');
      const owner = pagePaths.get(portable.key);
      if (owner && owner !== page.pageId) throw new ContentTreeError('CONTENT_TREE_PATH_COLLISION', 'Page paths collide');
      pagePaths.set(portable.key, page.pageId);
      const physicalOwner = allPages.find((candidate) => candidate.syncPathKey === portable.key);
      if (physicalOwner && physicalOwner.knowledgeKey !== page.pageId && !desiredPages.has(physicalOwner.knowledgeKey)) {
        throw new ContentTreeError('CONTENT_TREE_PATH_COLLISION', 'Page path is retained by an archived Page');
      }
    }

    const isNoop = folderArchives.length === 0 && pageArchives.length === 0 && restoredBatchIds.size === 0
      && folderUpserts.every((change) => {
        const current = folderById.get(change.folder.folderId);
        return current && !current.deletedAt && current.parentId === change.folder.parentFolderId
          && current.name === change.folder.name && current.path === change.folder.path
          && current.sortOrder === change.folder.sortOrder;
      })
      && pageUpserts.every((change) => {
        const current = pageByKey.get(change.page.pageId);
        return current && !current.deletedAt && current.folderId === change.page.folderId
          && current.title === change.page.title && current.syncPath === change.page.path
          && current.content === normalizeMarkdown(change.page.body);
      });
    if (isNoop) {
      return {
        protocolVersion: '2', status: 'noop', revision: head?.id ?? '0', sequence: head?.sequence ?? 0,
        publishedAt: head?.createdAt.toISOString() ?? null,
        revisionContentHash: head?.revisionContentHash ?? 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        folderCount: String(folderCountAtHead), pageCount: String(head?.pageCount ?? 0n),
        revisionManifestByteLength: String(head?.revisionManifestByteLength ?? 0n),
        revisionBodyBytes: String(head?.revisionBodyBytes ?? 0n), changeSetId: null,
      };
    }

    const changeSet = await lockedTx.changeSet.create({ data: {
      title: 'Obsidian sync v2', status: 'publishing', spaceId: input.spaceId,
      createdByUserId: input.actor.userId ?? null, createdByAgentId: input.actor.agentId ?? null,
      origin: 'obsidian_sync', humanDeviceCredentialId: input.revisionOrigin.humanDeviceCredentialId ?? null,
      confirmationHash: input.confirmationHash ?? null, baseRevisionId: input.baseRevision,
    } });
    const changedAt = new Date();
    for (const batchId of restoredBatchIds) {
      const batch = await lockedTx.contentDeletionBatch.findFirst({
        where: { id: batchId, spaceId: input.spaceId, restoredAt: null },
      });
      if (!batch) throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Deletion batch is not restorable');
      const batchFolders = allFolders.filter((folder) => folder.deletionBatchId === batchId);
      const batchPages = allPages.filter((page) => page.deletionBatchId === batchId);
      const impactRows: AffectedTreeRow[] = [
        ...batchFolders.map((folder) => ({
          kind: 'folder' as const, id: folder.id, parentId: folder.parentId, folderId: null,
          name: folder.name, title: null, path: folder.path, pathKey: folder.pathKey,
          sortOrder: folder.sortOrder, createdAt: folder.createdAt, updatedAt: folder.updatedAt,
          depth: 0, knowledgeKey: null, content: null,
        })),
        ...batchPages.map((page) => ({
          kind: 'page' as const, id: page.id, parentId: null, folderId: page.folderId,
          name: null, title: page.title, path: page.syncPath, pathKey: page.syncPathKey,
          sortOrder: page.sortOrder, createdAt: page.createdAt, updatedAt: page.updatedAt,
          depth: 0, knowledgeKey: page.knowledgeKey, content: page.content,
        })),
      ];
      const impact = affectedImpact(impactRows);
      if (impact.folderCount !== batch.folderCount || impact.pageCount !== batch.pageCount
        || impact.impactHash !== batch.impactHash
        || [...batchFolders, ...batchPages].some((entry) => entry.deletedAt?.getTime() !== batch.createdAt.getTime())) {
        throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Deletion batch evidence is inconsistent', {
          expectedFolderCount: batch.folderCount, actualFolderCount: impact.folderCount,
          expectedPageCount: batch.pageCount, actualPageCount: impact.pageCount,
          expectedImpactHash: batch.impactHash, actualImpactHash: impact.impactHash,
          timestampMismatch: [...batchFolders, ...batchPages]
            .some((entry) => entry.deletedAt?.getTime() !== batch.createdAt.getTime()),
        });
      }
      await lockedTx.folder.updateMany({
        where: { spaceId: input.spaceId, deletionBatchId: batchId, deletedAt: batch.createdAt },
        data: { deletedAt: null, deletionBatchId: null, lastModifiedByUserId: input.actor.userId ?? null,
          lastModifiedByAgentId: input.actor.agentId ?? null, lastModifiedAt: changedAt },
      });
      await lockedTx.page.updateMany({
        where: { spaceId: input.spaceId, deletionBatchId: batchId, deletedAt: batch.createdAt },
        data: { deletedAt: null, deletionBatchId: null, lastChangeSetId: changeSet.id,
          lastModifiedByUserId: input.actor.userId ?? null, lastModifiedByAgentId: input.actor.agentId ?? null,
          lastModifiedAt: changedAt },
      });
      const marked = await lockedTx.contentDeletionBatch.updateMany({
        where: { id: batchId, spaceId: input.spaceId, restoredAt: null }, data: { restoredAt: changedAt },
      });
      if (marked.count !== 1) throw new ContentTreeError('FOLDER_RESTORE_CONFLICT', 'Deletion batch was already restored');
    }

    const revisionChanges: StructuralPageChange[] = [];
    for (const change of pageArchives) {
      const page = pageByKey.get(change.pageId)!;
      await lockedTx.pageVersion.create({ data: {
        pageId: page.id, title: page.title, content: page.content, authorId: page.authorId,
        slug: page.slug, format: page.format, parentId: page.parentId, folderId: page.folderId,
        syncPath: page.syncPath, syncPathKey: page.syncPathKey,
      } });
      const updated = await lockedTx.page.updateMany({
        where: { id: page.id, spaceId: input.spaceId, deletedAt: null, updatedAt: page.updatedAt },
        data: { deletedAt: changedAt, deletionBatchId: null, lastChangeSetId: changeSet.id,
          lastModifiedByUserId: input.actor.userId ?? null, lastModifiedByAgentId: input.actor.agentId ?? null,
          lastModifiedAt: changedAt },
      });
      if (updated.count !== 1) throw new ContentTreeError('CONTENT_TREE_CONFLICT', 'Page changed during archive');
      await lockedTx.pageSearchDocument.deleteMany({ where: { pageId: page.id } });
      revisionChanges.push({ operation: 'archive', pageId: page.knowledgeKey, previousPath: page.syncPath });
    }

    for (const change of folderArchives) {
      const rows = await this.loadActiveSubtree(lockedTx, input.spaceId, change.folderId);
      const root = this.requireAffectedFolder(rows, change.folderId);
      assertMutationLimit(rows);
      const impact = affectedImpact(rows);
      const batchId = randomUUID();
      const batch = await lockedTx.contentDeletionBatch.create({ data: {
        id: batchId, spaceId: input.spaceId, rootFolderId: root.id,
        deletedByUserId: input.actor.userId ?? null, deletedByAgentId: input.actor.agentId ?? null,
        deletedTreeRevision: lockedTx.contentTreeRevision, folderCount: impact.folderCount,
        pageCount: impact.pageCount, impactHash: impact.impactHash, createdAt: changedAt,
      } });
      const pages = rows.filter((row) => row.kind === 'page');
      const pageById = new Map(allPages.map((page) => [page.id, page]));
      if (pages.length > 0) {
        await lockedTx.pageVersion.createMany({ data: pages.map((row) => {
          const page = pageById.get(row.id)!;
          return {
          pageId: page.id, title: page.title, content: page.content, authorId: page.authorId,
          slug: page.slug, format: page.format, parentId: page.parentId, folderId: page.folderId,
          syncPath: page.syncPath, syncPathKey: page.syncPathKey,
          };
        }) });
      }
      const pageIds = pages.map((row) => row.id);
      const folderIds = rows.filter((row) => row.kind === 'folder').map((row) => row.id);
      const pageUpdateCount = pageIds.length === 0 ? 0 : await lockedTx.$executeRaw(Prisma.sql`
        UPDATE "Page" target
        SET "deletedAt" = batch."createdAt",
            "deletionBatchId" = batch."id",
            "lastChangeSetId" = ${changeSet.id},
            "lastModifiedByUserId" = ${input.actor.userId ?? null},
            "lastModifiedByAgentId" = ${input.actor.agentId ?? null},
            "lastModifiedAt" = batch."createdAt"
        FROM "ContentDeletionBatch" batch
        WHERE batch."id" = ${batch.id}
          AND batch."spaceId" = ${input.spaceId}
          AND target."spaceId" = batch."spaceId"
          AND target."deletedAt" IS NULL
          AND target."id" IN (
            SELECT value FROM jsonb_array_elements_text(${JSON.stringify(pageIds)}::jsonb)
          )
      `);
      const folderUpdateCount = await lockedTx.$executeRaw(Prisma.sql`
        UPDATE "Folder" target
        SET "deletedAt" = batch."createdAt",
            "deletionBatchId" = batch."id",
            "lastModifiedByUserId" = ${input.actor.userId ?? null},
            "lastModifiedByAgentId" = ${input.actor.agentId ?? null},
            "lastModifiedAt" = batch."createdAt"
        FROM "ContentDeletionBatch" batch
        WHERE batch."id" = ${batch.id}
          AND batch."spaceId" = ${input.spaceId}
          AND target."spaceId" = batch."spaceId"
          AND target."deletedAt" IS NULL
          AND target."id" IN (
            SELECT value FROM jsonb_array_elements_text(${JSON.stringify(folderIds)}::jsonb)
          )
      `);
      if (pageUpdateCount !== pageIds.length || folderUpdateCount !== folderIds.length) {
        throw new ContentTreeError('CONTENT_TREE_CONFLICT', 'Folder subtree changed during archive');
      }
      revisionChanges.push(...pages.map((row) => ({
        operation: 'archive' as const, pageId: row.knowledgeKey!, previousPath: row.path,
      })));
    }

    const orderedFolderUpserts = [...folderUpserts].sort((left, right) =>
      resolveDepth(left.folder.folderId) - resolveDepth(right.folder.folderId)
      || Buffer.from(left.folder.path).compare(Buffer.from(right.folder.path)));
    for (const change of orderedFolderUpserts) {
      const current = folderById.get(change.folder.folderId);
      const normalized = normalizeFolderName(change.folder.name);
      if (current) {
        await lockedTx.folder.update({ where: { id: current.id }, data: {
          parentId: change.folder.parentFolderId, name: normalized.name, nameKey: normalized.nameKey,
          path: change.folder.path, pathKey: pathKey(change.folder.path), sortOrder: change.folder.sortOrder,
          deletedAt: null, deletionBatchId: null, lastModifiedByUserId: input.actor.userId ?? null,
          lastModifiedByAgentId: input.actor.agentId ?? null, lastModifiedAt: changedAt,
        } });
      } else {
        await lockedTx.folder.create({ data: {
          id: change.folder.folderId, spaceId: input.spaceId, parentId: change.folder.parentFolderId,
          name: normalized.name, nameKey: normalized.nameKey, path: change.folder.path,
          pathKey: pathKey(change.folder.path), sortOrder: change.folder.sortOrder,
          createdByUserId: input.actor.userId ?? null, createdByAgentId: input.actor.agentId ?? null,
          sourceChangeSetId: changeSet.id, lastModifiedByUserId: input.actor.userId ?? null,
          lastModifiedByAgentId: input.actor.agentId ?? null, lastModifiedAt: changedAt,
        } });
      }
    }

    const aliasRows: AffectedTreeRow[] = [];
    const aliasPlans: PageMutationPlan[] = [];
    for (const change of pageUpserts) {
      const current = pageByKey.get(change.page.pageId);
      const body = normalizeMarkdown(change.page.body);
      if (current && current.syncPath !== change.page.path) {
        aliasRows.push({
          kind: 'page', id: current.id, parentId: null, folderId: current.folderId,
          name: null, title: current.title, path: current.syncPath, pathKey: current.syncPathKey,
          sortOrder: current.sortOrder, createdAt: current.createdAt, updatedAt: current.updatedAt,
          depth: 0, knowledgeKey: current.knowledgeKey, content: current.content,
        });
        aliasPlans.push({
          id: current.id, folderId: change.page.folderId, path: change.page.path,
          pathKey: pathKey(change.page.path), sortOrder: current.sortOrder,
          deletedAt: null, deletionBatchId: null,
        });
      }
      if (current) {
        await lockedTx.pageVersion.create({ data: {
          pageId: current.id, title: current.title, content: current.content, authorId: current.authorId,
          slug: current.slug, format: current.format, parentId: current.parentId, folderId: current.folderId,
          syncPath: current.syncPath, syncPathKey: current.syncPathKey,
        } });
        await lockedTx.page.update({ where: { id: current.id }, data: {
          title: change.page.title, content: body, format: 'markdown', parentId: null,
          folderId: change.page.folderId, syncPath: change.page.path, syncPathKey: pathKey(change.page.path),
          deletedAt: null, deletionBatchId: null, lastChangeSetId: changeSet.id,
          lastModifiedByUserId: input.actor.userId ?? null, lastModifiedByAgentId: input.actor.agentId ?? null,
          lastModifiedAt: changedAt,
        } });
      } else {
        const pageId = randomUUID();
        await lockedTx.page.create({ data: {
          id: pageId, knowledgeKey: change.page.pageId, title: change.page.title,
          slug: `${safeMarkdownBasename(change.page.title || 'untitled').toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-') || 'untitled'}-${change.page.pageId}`,
          content: body, format: 'markdown', spaceId: input.spaceId,
          authorId: input.actor.userId!, parentId: null, folderId: change.page.folderId,
          syncPath: change.page.path, syncPathKey: pathKey(change.page.path),
          sourceChangeSetId: changeSet.id, lastChangeSetId: changeSet.id,
          lastModifiedByUserId: input.actor.userId ?? null, lastModifiedByAgentId: input.actor.agentId ?? null,
          lastModifiedAt: changedAt,
        } });
      }
      revisionChanges.push({
        operation: 'upsert', pageId: change.page.pageId, folderId: change.page.folderId,
        path: change.page.path, title: change.page.title, body,
      });
    }
    await this.insertPageAliases(lockedTx, input.spaceId, aliasRows, aliasPlans, changedAt);
    await this.trimPageAliases(lockedTx, input.spaceId, aliasPlans.map((plan) => plan.id));

    for (const change of input.changes) {
      const entityId = change.operation === 'upsert_folder' ? change.folder.folderId
        : change.operation === 'archive_folder' ? change.folderId
          : change.operation === 'upsert_page' ? change.page.pageId : change.pageId;
      const publishedResourceId = change.operation.includes('folder')
        ? entityId : pageByKey.get(entityId)?.id
          ?? (await lockedTx.page.findUnique({ where: { knowledgeKey: entityId }, select: { id: true } }))?.id
          ?? entityId;
      await lockedTx.changeItem.create({ data: {
        id: randomUUID(), type: change.operation.replace('upsert_', folderById.has(entityId) || pageByKey.has(entityId) ? 'update_' : 'create_'),
        payload: change as Prisma.InputJsonValue, status: 'published', publishedResourceId, changeSetId: changeSet.id,
      } });
    }
    const advanced = await this.advanceMutationRevisions(
      lockedTx, input.spaceId, lockedTx.contentTreeRevision, revisionChanges,
      input.actor, { ...input.revisionOrigin, sourceChangeSetId: changeSet.id },
    );
    const revision = await lockedTx.spaceKnowledgeRevision.findUnique({ where: { id: advanced.syncRevisionId } });
    if (!revision) throw new ContentTreeError('CONTENT_TREE_CONFLICT', 'Published revision could not be read back');
    const folderCount = await lockedTx.syncRevisionFolderRow.count({ where: { revisionId: revision.id } });
    if (revision.revisionBodyBytes > 2_097_152n) {
      throw new ContentTreeError('FOLDER_MUTATION_LIMIT', 'Resulting v2 document tree exceeds 2 MiB');
    }
    const publishedAt = new Date();
    await lockedTx.changeSet.update({
      where: { id: changeSet.id }, data: { status: 'published', publishedAt },
    });
    return {
      protocolVersion: '2', status: 'published', revision: revision.id, sequence: revision.sequence,
      publishedAt: publishedAt.toISOString(), revisionContentHash: revision.revisionContentHash,
      folderCount: String(folderCount), pageCount: String(revision.pageCount),
      revisionManifestByteLength: String(revision.revisionManifestByteLength),
      revisionBodyBytes: String(revision.revisionBodyBytes), changeSetId: changeSet.id,
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
    const syncRevision = await this.revisionWriter.advanceStructuralPagesLocked(
      tx, spaceId, pageChanges, { ...mutationOrigin(actor), ...revisionOrigin },
    );
    return { treeRevision, syncRevisionId: syncRevision.revisionId };
  }
}
