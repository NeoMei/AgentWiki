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
import { GraphMaintenance } from '../../knowledge-graph/graph-maintenance';
import { PageTemplateService } from '../../page-templates/page-template.service';

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
  sourceTemplateId: true,
  sourceTemplateVersion: true,
  sourceTemplateLocale: true,
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
    private readonly graphMaintenance: GraphMaintenance,
    private readonly pageTemplates: PageTemplateService,
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
      const lockedTx = await this.revisionWriter.lockSpace(tx, data.spaceId);
      const hasTemplateFields = data.templateId !== undefined
        || data.templateVersion !== undefined
        || data.templateLocale !== undefined;
      let template = null;
      if (hasTemplateFields) {
        const validTemplateShape = typeof data.templateId === 'string'
          && data.templateId.trim().length > 0
          && data.templateId.length <= 100
          && Number.isInteger(data.templateVersion)
          && data.templateVersion! >= 1
          && data.templateVersion! <= 2_147_483_647
          && (data.templateLocale === 'zh-CN' || data.templateLocale === 'en')
          && data.content === undefined
          && (data.format === undefined || data.format === 'markdown');
        if (!validTemplateShape) throw new BusinessException('PAGE_TEMPLATE_INVALID');
        template = await this.pageTemplates.resolveVersion(lockedTx, {
          spaceId: data.spaceId,
          templateId: data.templateId!,
          version: data.templateVersion!,
          locale: data.templateLocale!,
        });
      }
      const initialContent = template?.content ?? data.content ?? '';
      const knowledgeKey = randomUUID();
      const allocatedPath = await this.syncPaths.allocate(lockedTx, {
        spaceId: data.spaceId,
        directory: 'pages',
        title: data.title,
      });
      const created = await tx.page.create({
        data: {
          knowledgeKey,
          title: data.title,
          slug,
          content: initialContent,
          format: template ? 'markdown' : (data.format ?? 'markdown'),
          sourceTemplateId: template?.templateId,
          sourceTemplateVersion: template?.version,
          sourceTemplateLocale: template?.locale,
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
        body: initialContent,
      }], { origin: 'web_editor', createdByUserId: userId });
      // Lexical and vector indexing are owned by SearchService.indexPage,
      // called after the transaction commits. Writing the search document here
      // would refresh its contentHash before indexPage runs and defeat the
      // hash short-circuit.
      return { ...created, syncPath: allocatedPath.path };
    });

    try {
      await this.searchService.indexPage(page.id);
    } finally {
      this.graphMaintenance.enqueue(data.spaceId);
    }
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
    if (items.length === 0) return this.findHierarchy(spaceId);

    await this.prisma.$transaction(async (tx) => {
      const lockedTx = await this.revisionWriter.lockSpace(tx, spaceId);
      const ids = items.map((item) => item.id);
      const existing = await lockedTx.page.findMany({
        where: { id: { in: ids }, spaceId, deletedAt: null },
        select: { id: true },
      });
      if (existing.length !== ids.length) {
        throw new BadRequestException('Some pages do not belong to this space');
      }

      const spacePages = await lockedTx.page.findMany({
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

      const updatedCount = await lockedTx.$executeRaw`
        UPDATE "Page" AS page
        SET "parentId" = item."parentId",
            "sortOrder" = item."sortOrder",
            "updatedAt" = statement_timestamp()
        FROM jsonb_to_recordset(${JSON.stringify(items)}::jsonb)
          AS item("id" text, "parentId" text, "sortOrder" integer)
        WHERE page."id" = item."id"
          AND page."spaceId" = ${spaceId}
          AND page."deletedAt" IS NULL
      `;
      if (updatedCount !== items.length) {
        throw new BusinessException(
          'RESOURCE_CONFLICT',
          'Page hierarchy changed while it was being reordered',
        );
      }
    });
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
      const lockedTx = await this.revisionWriter.lockSpace(tx, page.spaceId);
      if (changes.parentId !== undefined) await this.assertValidParent(page.spaceId, changes.parentId, id, tx);

      const allocatedPath = changes.title !== undefined
        && safeMarkdownBasename(changes.title) !== safeMarkdownBasename(page.title)
        ? await this.syncPaths.allocate(lockedTx, {
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
      }
      return result;
    });

    try {
      await this.searchService.indexPage(id);
    } finally {
      this.graphMaintenance.enqueue(updated.spaceId);
    }
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
      const lockedTx = await this.revisionWriter.lockSpace(tx, visiblePage.spaceId);
      const version = await tx.pageVersion.findFirst({
        where: { id: versionId, pageId },
      });
      if (!version) throw new NotFoundException('Version not found');
      const page = await tx.page.findUnique({
        where: { id: pageId, deletedAt: null },
      });
      if (!page) throw new NotFoundException('Page not found');
      const restoredPath = safeMarkdownBasename(version.title) !== safeMarkdownBasename(page.title)
        ? await this.syncPaths.allocate(lockedTx, {
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
      const mutation = await tx.page.updateMany({
        where: {
          id: page.id,
          spaceId: page.spaceId,
          deletedAt: null,
          updatedAt: page.updatedAt,
        },
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
      });
      if (mutation.count !== 1) {
        throw new BusinessException('RESOURCE_CONFLICT', 'Page changed while it was being restored');
      }
      const updated = await tx.page.findUnique({
        where: { id: page.id, spaceId: page.spaceId, deletedAt: null },
        select: {
          ...PAGE_PUBLIC_FIELDS,
          author: { select: AUTHOR_SELECT },
          knowledgeKey: true,
          syncPath: true,
          syncPathKey: true,
        },
      });
      if (!updated) {
        throw new BusinessException('RESOURCE_CONFLICT', 'Page changed while it was being restored');
      }
      await this.advanceRevision(tx, page.spaceId, [{
        operation: 'upsert',
        pageId: updated.knowledgeKey,
        path: updated.syncPath,
        title: updated.title,
        body: updated.content,
      }], { origin: 'web_editor', createdByUserId: page.authorId });
      return updated;
    });

    try {
      await this.searchService.indexPage(pageId);
    } finally {
      this.graphMaintenance.enqueue(visiblePage.spaceId);
    }
    return restored;
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    const page = await this.prisma.$transaction(async (tx) => {
      await this.revisionWriter.lockSpace(tx, existing.spaceId);
      const current = await tx.page.findUnique({
        where: { id, spaceId: existing.spaceId, deletedAt: null },
        select: {
          id: true,
          title: true,
          content: true,
          authorId: true,
          slug: true,
          format: true,
          parentId: true,
          spaceId: true,
          syncPath: true,
          syncPathKey: true,
          updatedAt: true,
        },
      });
      if (!current) throw new NotFoundException('Page not found');
      await tx.pageVersion.create({
        data: {
          pageId: current.id,
          title: current.title,
          content: current.content ?? '',
          authorId: current.authorId,
          slug: current.slug,
          format: current.format,
          parentId: current.parentId,
          syncPath: current.syncPath,
          syncPathKey: current.syncPathKey,
        },
      });
      const mutation = await tx.page.updateMany({
        where: {
          id: current.id,
          spaceId: current.spaceId,
          deletedAt: null,
          updatedAt: current.updatedAt,
        },
        data: { deletedAt: new Date() },
      });
      if (mutation.count !== 1) {
        throw new BusinessException('RESOURCE_CONFLICT', 'Page changed while it was being archived');
      }
      const archived = await tx.page.findUnique({
        where: { id: current.id, spaceId: current.spaceId, deletedAt: { not: null } },
        select: { ...PAGE_PUBLIC_FIELDS, knowledgeKey: true, syncPath: true },
      });
      if (!archived) {
        throw new BusinessException('RESOURCE_CONFLICT', 'Page changed while it was being archived');
      }
      await this.advanceRevision(tx, current.spaceId, [{
        operation: 'archive',
        pageId: archived.knowledgeKey,
        previousPath: archived.syncPath ?? undefined,
      }], { origin: 'web_editor', createdByUserId: archived.authorId });
      await tx.pageSearchDocument.deleteMany({ where: { pageId: archived.id } });
      return archived;
    });

    try {
      await this.searchService.deletePageIndex(id);
    } finally {
      this.graphMaintenance.enqueue(existing.spaceId);
    }
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
