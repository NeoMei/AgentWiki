import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validatePortableDirectoryPath } from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../database/prisma.service';
import { ReadableSyncPathService } from '../core/sync/readable-sync-path.service';
import {
  SpaceRevisionWriterService,
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
  type ListChildrenInput,
  type PlacePageInput,
  type PlacedPageResult,
} from './content-tree.types';

const DEFAULT_TAKE = 100;
const MAX_TAKE = 200;
const MAX_FOLDER_DEPTH = 32;
const MAX_ACTIVE_FOLDERS = 10_000n;

interface TreeCursor {
  v: 1;
  spaceId: string;
  parentFolderId: string | null;
  kind: 'folder' | 'page';
  sortOrder: number;
  createdAt: string;
  id: string;
}

interface AncestorRow {
  id: string;
  parentId: string | null;
  path: string;
  depth: number;
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
      if (parentFolderId) {
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
}
