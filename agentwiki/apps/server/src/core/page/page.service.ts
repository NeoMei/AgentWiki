import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreatePageDto, UpdatePageDto } from '../dto/page.dto';
import { BusinessException } from '../filters/business-error';
import { SearchService } from '../search/search.service';
import { SpaceRevisionWriterService } from '../sync/space-revision-writer.service';
import {
  ReadableSyncPathService,
  safeMarkdownBasename,
  syncPathDirectory,
} from '../sync/readable-sync-path.service';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// Page fields without embedding (which is large and internal-only)
const PAGE_PUBLIC_FIELDS = {
  id: true,
  title: true,
  slug: true,
  content: true,
  format: true,
  parentId: true,
  spaceId: true,
  authorId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  sourceChangeSetId: true,
  createdByAgentId: true,
  lastChangeSetId: true,
  lastModifiedByUserId: true,
  lastModifiedByAgentId: true,
  lastModifiedAt: true,
  sourceId: true,
  sourceVersionId: true,
  sourcePath: true,
};

const AUTHOR_SELECT = {
  id: true,
  email: true,
  name: true,
  type: true,
};

@Injectable()
export class PageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly searchService: SearchService,
    private readonly revisionWriter: SpaceRevisionWriterService,
    private readonly syncPaths: ReadableSyncPathService,
  ) {}

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async advanceRevision(
    tx: any,
    spaceId: string,
    changes: Array<{ operation: 'upsert' | 'archive'; pageId: string; path?: string; title?: string; body?: string; previousPath?: string }>,
    origin: { origin: 'web_editor' | 'change_set' | 'obsidian_sync' | 'migration'; createdByUserId?: string | null },
  ) {
    await this.revisionWriter.advance(tx, spaceId, changes, origin);
  }

  async create(data: CreatePageDto, userId: string) {
    const space = await this.prisma.space.findUnique({
      where: { id: data.spaceId, deletedAt: null },
    });
    if (!space) throw new NotFoundException('Space not found');
    await this.assertValidParent(data.spaceId, data.parentId);

    const slug = data.slug || (this.slugify(data.title) + '-' + Date.now().toString(36));
    const page = await this.prisma.$transaction(async (tx) => {
      await this.revisionWriter.lockSpace(tx, data.spaceId);
      const knowledgeKey = randomUUID();
      const allocatedPath = await this.syncPaths.allocate(tx, {
        spaceId: data.spaceId,
        directory: 'pages',
        title: data.title,
      });
      const created = await tx.page.create({
        data: {
          knowledgeKey,
          title: data.title,
          slug,
          content: data.content ?? '',
          format: data.format ?? 'markdown',
          spaceId: data.spaceId,
          authorId: userId,
          parentId: data.parentId,
          syncPath: allocatedPath.path,
          syncPathKey: allocatedPath.pathKey,
          lastModifiedByUserId: userId,
          lastModifiedAt: new Date(),
        },
        select: {
          ...PAGE_PUBLIC_FIELDS,
          author: { select: AUTHOR_SELECT },
          knowledgeKey: true,
        },
      });
      await this.advanceRevision(tx, data.spaceId, [{
        operation: 'upsert',
        pageId: created.knowledgeKey,
        path: allocatedPath.path,
        title: data.title,
        body: data.content ?? '',
      }], { origin: 'web_editor', createdByUserId: userId });
      const text = `${created.title}\n${created.content ?? ''}`;
      await tx.pageSearchDocument.upsert({
        where: { pageId: created.id },
        create: { pageId: created.id, text, contentHash: createHash('sha256').update(text).digest('hex') },
        update: { text, contentHash: createHash('sha256').update(text).digest('hex'), indexedAt: new Date() },
      });
      return { ...created, syncPath: allocatedPath.path };
    });

    await this.searchService.indexPage(page.id);
    const provenance = page.sourceChangeSetId
      ? await this.prisma.changeSet.findUnique({
          where: { id: page.sourceChangeSetId },
          select: {
            id: true,
            title: true,
            status: true,
            reviewedAt: true,
            publishedAt: true,
            createdByAgent: { select: { id: true, name: true } },
            approvals: { orderBy: { createdAt: 'desc' }, take: 1, select: { decision: true, comment: true, createdAt: true, reviewer: { select: { id: true, name: true, email: true } } } },
            run: { select: { id: true, status: true, stage: true, completedAt: true, source: { select: { id: true, name: true, type: true, uri: true } } } },
          },
        })
      : null;
    const evidence = page.sourceChangeSetId
      ? await this.prisma.evidence.findMany({
          where: { targetPageId: page.id },
          include: { sourceVersion: { include: { files: true, source: { select: { id: true, name: true, type: true, uri: true } } } } },
        })
      : [];
    const [lastChange, lastModifiedByUser, lastModifiedByAgent] = await Promise.all([
      page.lastChangeSetId && page.lastChangeSetId !== page.sourceChangeSetId
        ? this.prisma.changeSet.findUnique({
            where: { id: page.lastChangeSetId },
            select: { id: true, title: true, status: true, reviewedAt: true, publishedAt: true },
          })
        : Promise.resolve(null),
      page.lastModifiedByUserId
        ? this.prisma.user.findUnique({ where: { id: page.lastModifiedByUserId }, select: { id: true, name: true, email: true } })
        : Promise.resolve(null),
      page.lastModifiedByAgentId
        ? this.prisma.agent.findUnique({ where: { id: page.lastModifiedByAgentId }, select: { id: true, name: true } })
        : Promise.resolve(null),
    ]);
    return { ...page, provenance, lastChange, lastModifiedByUser, lastModifiedByAgent, evidence };
  }

  async findAll(accessibleSpaceIds: string[], spaceId?: string, skip = 0, take = 20): Promise<PaginatedResult<any>> {
    const where = {
      deletedAt: null,
      spaceId: spaceId ?? { in: accessibleSpaceIds },
    };
    const [data, total] = await Promise.all([
      this.prisma.page.findMany({
        where,
        skip,
        take,
        select: {
          ...PAGE_PUBLIC_FIELDS,
          author: { select: AUTHOR_SELECT },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.page.count({ where }),
    ]);
    return { data, total, page: Math.floor(skip / take) + 1, limit: take };
  }

  async findOne(id: string) {
    const page = await this.prisma.page.findUnique({
      where: { id, deletedAt: null },
      select: {
        ...PAGE_PUBLIC_FIELDS,
        author: { select: AUTHOR_SELECT },
        space: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!page) throw new NotFoundException('Page not found');
    const provenance = page.sourceChangeSetId
      ? await this.prisma.changeSet.findUnique({
          where: { id: page.sourceChangeSetId },
          select: {
            id: true,
            title: true,
            status: true,
            reviewedAt: true,
            publishedAt: true,
            createdByAgent: { select: { id: true, name: true } },
            approvals: { orderBy: { createdAt: 'desc' }, take: 1, select: { decision: true, comment: true, createdAt: true, reviewer: { select: { id: true, name: true, email: true } } } },
            run: { select: { id: true, status: true, stage: true, completedAt: true, source: { select: { id: true, name: true, type: true, uri: true } } } },
          },
        })
      : null;
    const evidence = page.sourceChangeSetId
      ? await this.prisma.evidence.findMany({
          where: { targetPageId: page.id },
          include: { sourceVersion: { include: { files: true, source: { select: { id: true, name: true, type: true, uri: true } } } } },
        })
      : [];
    const [lastChange, lastModifiedByUser, lastModifiedByAgent] = await Promise.all([
      page.lastChangeSetId && page.lastChangeSetId !== page.sourceChangeSetId
        ? this.prisma.changeSet.findUnique({
            where: { id: page.lastChangeSetId },
            select: { id: true, title: true, status: true, reviewedAt: true, publishedAt: true },
          })
        : Promise.resolve(null),
      page.lastModifiedByUserId
        ? this.prisma.user.findUnique({ where: { id: page.lastModifiedByUserId }, select: { id: true, name: true, email: true } })
        : Promise.resolve(null),
      page.lastModifiedByAgentId
        ? this.prisma.agent.findUnique({ where: { id: page.lastModifiedByAgentId }, select: { id: true, name: true } })
        : Promise.resolve(null),
    ]);
    return { ...page, provenance, lastChange, lastModifiedByUser, lastModifiedByAgent, evidence };
  }

  async findBySlug(slug: string, spaceId: string) {
    const page = await this.prisma.page.findFirst({
      where: { slug, spaceId, deletedAt: null },
      select: {
        ...PAGE_PUBLIC_FIELDS,
        author: { select: AUTHOR_SELECT },
      },
    });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  async findHierarchy(spaceId: string) {
    const pages = await this.prisma.page.findMany({
      where: { spaceId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        ...PAGE_PUBLIC_FIELDS,
        author: { select: AUTHOR_SELECT },
      },
    });
    const map = new Map<string, any>();
    const roots: any[] = [];
    for (const page of pages) {
      map.set(page.id, { ...page, children: [] });
    }
    for (const page of pages) {
      const node = map.get(page.id);
      if (page.parentId && map.has(page.parentId)) {
        map.get(page.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  /**
   * Apply a drag-reordered page tree: set each page's parent and its position
   * among siblings. Validates that every page belongs to the space and that no
   * parent assignment creates a cycle.
   */
  async reorder(
    spaceId: string,
    items: Array<{ id: string; parentId: string | null; sortOrder: number }>,
  ) {
    const ids = items.map((item) => item.id);
    const existing = await this.prisma.page.findMany({
      where: { id: { in: ids }, spaceId, deletedAt: null },
      select: { id: true },
    });
    if (existing.length !== ids.length) {
      throw new BadRequestException('Some pages do not belong to this space');
    }

    const spacePages = await this.prisma.page.findMany({
      where: { spaceId, deletedAt: null },
      select: { id: true, parentId: true },
    });
    const parentOf = new Map(spacePages.map((page) => [page.id, page.parentId]));
    for (const item of items) parentOf.set(item.id, item.parentId);

    for (const parentId of parentOf.values()) {
      if (parentId !== null && !parentOf.has(parentId)) {
        throw new BadRequestException('Parent pages must belong to this space');
      }
    }

    // Cycle check uses the complete persisted hierarchy plus this batch.
    for (const [pageId, parentId] of parentOf) {
      let cursor: string | null = parentId;
      const seen = new Set<string>([pageId]);
      while (cursor) {
        if (seen.has(cursor)) throw new BadRequestException('Page hierarchy cannot contain a cycle');
        seen.add(cursor);
        cursor = parentOf.get(cursor) ?? null;
      }
    }
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.page.updateMany({
          where: { id: item.id, spaceId },
          data: { parentId: item.parentId, sortOrder: item.sortOrder },
        }),
      ),
    );
    return this.findHierarchy(spaceId);
  }

  async update(id: string, data: UpdatePageDto, userId?: string) {
    const { expectedUpdatedAt, ...changes } = data;
    const expectedVersion = new Date(expectedUpdatedAt);
    const updated = await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id, deletedAt: null },
        select: {
          id: true,
          title: true,
          content: true,
          slug: true,
          format: true,
          parentId: true,
          spaceId: true,
          authorId: true,
          knowledgeKey: true,
          syncPath: true,
          syncPathKey: true,
        },
      });
      if (!page) throw new NotFoundException('Page not found');
      await this.revisionWriter.lockSpace(tx, page.spaceId);
      if (changes.parentId !== undefined) await this.assertValidParent(page.spaceId, changes.parentId, id, tx);

      const allocatedPath = changes.title !== undefined
        && safeMarkdownBasename(changes.title) !== safeMarkdownBasename(page.title)
        ? await this.syncPaths.allocate(tx, {
            spaceId: page.spaceId,
            directory: syncPathDirectory(page.syncPath),
            title: changes.title,
            excludePageId: page.id,
          })
        : null;

      await tx.pageVersion.create({
        data: {
          pageId: page.id,
          title: page.title,
          content: page.content ?? '',
          authorId: userId ?? page.authorId,
          slug: page.slug,
          format: page.format,
          parentId: page.parentId,
          syncPath: page.syncPath,
          syncPathKey: page.syncPathKey,
        },
      });

      const mutation = await tx.page.updateMany({
        where: { id, deletedAt: null, updatedAt: expectedVersion },
        data: {
          ...changes,
          ...(allocatedPath
            ? { syncPath: allocatedPath.path, syncPathKey: allocatedPath.pathKey }
            : {}),
          lastChangeSetId: null,
          lastModifiedByUserId: userId ?? page.authorId,
          lastModifiedByAgentId: null,
          lastModifiedAt: new Date(),
        },
      });
      if (mutation.count !== 1) {
        throw new BusinessException('RESOURCE_CONFLICT', 'Page changed after this editor loaded it');
      }

      const result = await tx.page.findUnique({
        where: { id, deletedAt: null },
        select: {
          ...PAGE_PUBLIC_FIELDS,
          author: { select: AUTHOR_SELECT },
          knowledgeKey: true,
          syncPath: true,
          syncPathKey: true,
        },
      });
      if (!result) throw new NotFoundException('Page not found');
      if (changes.title !== undefined || changes.content !== undefined) {
        await this.advanceRevision(tx, page.spaceId, [{
          operation: 'upsert',
          pageId: result.knowledgeKey,
          path: result.syncPath,
          title: result.title,
          body: result.content,
        }], { origin: 'web_editor', createdByUserId: userId ?? page.authorId });
        const text = `${result.title}\n${result.content ?? ''}`;
        await tx.pageSearchDocument.upsert({
          where: { pageId: result.id },
          create: { pageId: result.id, text, contentHash: createHash('sha256').update(text).digest('hex') },
          update: { text, contentHash: createHash('sha256').update(text).digest('hex'), indexedAt: new Date() },
        });
      }
      return result;
    });

    await this.searchService.indexPage(id);
    return updated;
  }

  async getVersionHistory(pageId: string) {
    await this.findOne(pageId);
    return this.prisma.pageVersion.findMany({
      where: { pageId },
      include: { author: { select: AUTHOR_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async restoreVersion(pageId: string, versionId: string) {
    const visiblePage = await this.findOne(pageId);

    const restored = await this.prisma.$transaction(async (tx) => {
      await this.revisionWriter.lockSpace(tx, visiblePage.spaceId);
      const version = await tx.pageVersion.findFirst({
        where: { id: versionId, pageId },
      });
      if (!version) throw new NotFoundException('Version not found');
      const page = await tx.page.findUnique({
        where: { id: pageId, deletedAt: null },
      });
      if (!page) throw new NotFoundException('Page not found');
      const restoredPath = safeMarkdownBasename(version.title) !== safeMarkdownBasename(page.title)
        ? await this.syncPaths.allocate(tx, {
            spaceId: page.spaceId,
            directory: syncPathDirectory(page.syncPath),
            title: version.title,
            excludePageId: page.id,
          })
        : { path: page.syncPath, pathKey: page.syncPathKey };
      await tx.pageVersion.create({
        data: {
          pageId: page.id,
          title: page.title,
          content: page.content ?? '',
          authorId: page.authorId,
          slug: page.slug,
          format: page.format,
          parentId: page.parentId,
          syncPath: page.syncPath,
          syncPathKey: page.syncPathKey,
        },
      });
      const updated = await tx.page.update({
        where: { id: pageId },
        data: {
          title: version.title,
          content: version.content,
          slug: version.slug ?? page.slug,
          format: version.format ?? page.format,
          parentId: version.parentId,
          syncPath: restoredPath.path,
          syncPathKey: restoredPath.pathKey,
          lastChangeSetId: null,
          lastModifiedByUserId: page.authorId,
          lastModifiedByAgentId: null,
          lastModifiedAt: new Date(),
        },
        select: {
          ...PAGE_PUBLIC_FIELDS,
          author: { select: AUTHOR_SELECT },
          knowledgeKey: true,
          syncPath: true,
          syncPathKey: true,
        },
      });
      await this.advanceRevision(tx, page.spaceId, [{
        operation: 'upsert',
        pageId: updated.knowledgeKey,
        path: updated.syncPath,
        title: updated.title,
        body: updated.content,
      }], { origin: 'web_editor', createdByUserId: page.authorId });
      const text = `${updated.title}\n${updated.content ?? ''}`;
      await tx.pageSearchDocument.upsert({
        where: { pageId: updated.id },
        create: { pageId: updated.id, text, contentHash: createHash('sha256').update(text).digest('hex') },
        update: { text, contentHash: createHash('sha256').update(text).digest('hex'), indexedAt: new Date() },
      });
      return updated;
    });

    await this.searchService.indexPage(pageId);
    return restored;
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    const page = await this.prisma.$transaction(async (tx) => {
      const archived = await tx.page.update({
        where: { id },
        data: { deletedAt: new Date() },
        select: { ...PAGE_PUBLIC_FIELDS, knowledgeKey: true, syncPath: true },
      });
      await this.advanceRevision(tx, existing.spaceId, [{
        operation: 'archive',
        pageId: archived.knowledgeKey,
        previousPath: archived.syncPath ?? undefined,
      }], { origin: 'web_editor', createdByUserId: archived.authorId });
      await tx.pageSearchDocument.deleteMany({ where: { pageId: archived.id } });
      return archived;
    });

    await this.searchService.deletePageIndex(id);
    return page;
  }

  private async assertValidParent(
    spaceId: string,
    parentId?: string,
    currentPageId?: string,
    database: Pick<PrismaService, 'page'> = this.prisma,
  ) {
    if (!parentId) return;
    if (parentId === currentPageId) throw new BadRequestException('A page cannot be its own parent');
    let cursor: string | null = parentId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === currentPageId) throw new BadRequestException('Page hierarchy cannot contain a cycle');
      if (visited.has(cursor)) throw new BadRequestException('Existing page hierarchy contains a cycle');
      visited.add(cursor);
      const parent: { spaceId: string; parentId: string | null } | null = await database.page.findUnique({
        where: { id: cursor, deletedAt: null },
        select: { spaceId: true, parentId: true },
      });
      if (!parent || parent.spaceId !== spaceId) throw new BadRequestException('Parent page must belong to the same space');
      cursor = parent.parentId;
    }
  }
}
