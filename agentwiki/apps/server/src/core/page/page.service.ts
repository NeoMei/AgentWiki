import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreatePageDto, UpdatePageDto } from '../dto/page.dto';
import { BusinessException } from '../filters/business-error';
import { SearchService } from '../search/search.service';
import { SpaceRevisionWriterService } from '../sync/space-revision-writer.service';
import { ReadableSyncPathService } from '../sync/readable-sync-path.service';
import { randomUUID } from 'crypto';
import { GraphMaintenance } from '../../knowledge-graph/graph-maintenance';
import { PageTemplateService } from '../../page-templates/page-template.service';
import { AuthorizationService, type Principal } from '../authorization/authorization.service';
import { ContentTreeService } from '../../content-tree/content-tree.service';
import { ContentTreeError } from '../../content-tree/content-tree.types';

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
  folderId: true,
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
  syncPath: true,
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
    private readonly _syncPaths: ReadableSyncPathService,
    private readonly graphMaintenance: GraphMaintenance,
    private readonly pageTemplates: PageTemplateService,
    private readonly authorization: AuthorizationService,
    private readonly contentTree: ContentTreeService,
  ) {}

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private withCanonicalPath<T extends { syncPath?: string | null }>(page: T): T & { path: string | null } {
    return { ...page, path: page.syncPath ?? null };
  }

  async create(data: CreatePageDto, principal: Principal) {
    const space = await this.prisma.space.findUnique({
      where: { id: data.spaceId, deletedAt: null },
    });
    if (!space) throw new NotFoundException('Space not found');

    const slug = data.slug || (this.slugify(data.title) + '-' + Date.now().toString(36));
    const userId = principal.userId;
    const expectedTreeRevision = BigInt(data.expectedTreeRevision ?? '0');
    const page = await this.prisma.$transaction(async (tx) => {
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      const lockedTx = await this.contentTree.lockPageMutationSpace(
        tx,
        data.spaceId,
        expectedTreeRevision,
      );
      await this.authorization.assertLiveHumanSpaceAccess(
        lockedTx, principal, data.spaceId, ['owner', 'editor'],
      );
      let folderId = data.folderId ?? null;
      if (data.parentId !== undefined) {
        if (data.folderId !== undefined) {
          throw new ContentTreeError(
            'PAGE_PARENT_DEPRECATED',
            'Legacy parentId cannot be combined with folderId',
          );
        }
        if (process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE !== 'true') {
          throw new ContentTreeError(
            'PAGE_PARENT_DEPRECATED',
            'Legacy Page parent placement cannot be mapped safely',
          );
        }
        folderId = data.parentId === null
          ? null
          : await this.contentTree.mapLegacyPageParent(
            lockedTx,
            data.spaceId,
            data.parentId,
          );
      }
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
      const pageId = randomUUID();
      const placement = await this.contentTree.placePage(lockedTx, {
        spaceId: data.spaceId,
        pageId,
        title: data.title,
        folderId,
      });
      const created = await tx.page.create({
        data: {
          id: pageId,
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
          parentId: null,
          folderId: placement.folderId,
          syncPath: placement.syncPath,
          syncPathKey: placement.syncPathKey,
          lastModifiedByUserId: userId,
          lastModifiedAt: new Date(),
        },
        select: {
          ...PAGE_PUBLIC_FIELDS,
          author: { select: AUTHOR_SELECT },
          knowledgeKey: true,
        },
      });
      await this.contentTree.advancePageMutation(lockedTx, {
        spaceId: data.spaceId,
        expectedTreeRevision,
        structural: true,
        changes: [{
        operation: 'upsert',
        pageId: created.knowledgeKey,
        folderId: placement.folderId,
        path: placement.syncPath,
        title: data.title,
        body: initialContent,
        }],
        actor: { userId },
      });
      // Lexical and vector indexing are owned by SearchService.indexPage,
      // called after the transaction commits. Writing the search document here
      // would refresh its contentHash before indexPage runs and defeat the
      // hash short-circuit.
      return { ...created, syncPath: placement.syncPath, path: placement.syncPath };
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
    return {
      data: data.map((item) => this.withCanonicalPath(item)),
      total,
      page: Math.floor(skip / take) + 1,
      limit: take,
    };
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
    return this.withCanonicalPath({
      ...page, provenance, lastChange, lastModifiedByUser, lastModifiedByAgent, evidence,
    });
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
    return this.withCanonicalPath(page);
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
      map.set(page.id, { ...this.withCanonicalPath(page), children: [] });
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
    _spaceId: string,
    _items: Array<{ id: string; parentId: string | null; sortOrder: number }>,
  ) {
    throw new ContentTreeError(
      'PAGE_PARENT_DEPRECATED',
      'Legacy Page parent ordering is disabled; use content-tree/move',
    );
  }

  async update(id: string, data: UpdatePageDto, principal: Principal) {
    const userId = principal.userId;
    const { expectedUpdatedAt, expectedTreeRevision, ...changes } = data;
    const expectedVersion = new Date(expectedUpdatedAt);
    const structural = changes.title !== undefined || changes.folderId !== undefined;
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
          folderId: true,
          spaceId: true,
          authorId: true,
          knowledgeKey: true,
          syncPath: true,
          syncPathKey: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!page) throw new NotFoundException('Page not found');
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      const lockedTx = await this.contentTree.lockPageMutationSpace(
        tx,
        page.spaceId,
        structural && expectedTreeRevision !== undefined
          ? BigInt(expectedTreeRevision)
          : undefined,
      );
      await this.authorization.assertLiveHumanSpaceAccess(
        lockedTx, principal, page.spaceId, ['owner', 'editor'],
      );
      const treeRevision = expectedTreeRevision === undefined
        ? lockedTx.contentTreeRevision
        : BigInt(expectedTreeRevision);
      const placement = structural
        ? await this.contentTree.preparePageMutation(lockedTx, {
          spaceId: page.spaceId,
          pageId: page.id,
          title: changes.title ?? page.title,
          folderId: changes.folderId === undefined ? (page.folderId ?? null) : changes.folderId,
          current: {
            title: page.title,
            folderId: page.folderId ?? null,
            syncPath: page.syncPath,
            syncPathKey: page.syncPathKey,
            sortOrder: page.sortOrder,
            createdAt: page.createdAt,
            updatedAt: page.updatedAt,
            knowledgeKey: page.knowledgeKey,
            content: page.content,
          },
        })
        : {
          folderId: page.folderId ?? null,
          syncPath: page.syncPath,
          syncPathKey: page.syncPathKey,
        };

      await tx.pageVersion.create({
        data: {
          pageId: page.id,
          title: page.title,
          content: page.content ?? '',
          authorId: userId,
          slug: page.slug,
          format: page.format,
          parentId: page.parentId,
          folderId: page.folderId,
          syncPath: page.syncPath,
          syncPathKey: page.syncPathKey,
        },
      });

      const mutation = await tx.page.updateMany({
        where: { id, deletedAt: null, updatedAt: expectedVersion },
        data: {
          ...changes,
          ...(structural
            ? {
              parentId: null,
              folderId: placement.folderId,
              ...(placement.syncPathKey === page.syncPathKey
                ? {}
                : {
                  syncPath: placement.syncPath,
                  syncPathKey: placement.syncPathKey,
                }),
            }
            : {}),
          lastChangeSetId: null,
          lastModifiedByUserId: userId,
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
      if (
        changes.title !== undefined
        || changes.content !== undefined
        || changes.folderId !== undefined
        || changes.format !== undefined
      ) {
        await this.contentTree.advancePageMutation(lockedTx, {
          spaceId: page.spaceId,
          expectedTreeRevision: treeRevision,
          structural,
          changes: [{
          operation: 'upsert',
          pageId: result.knowledgeKey,
          folderId: result.folderId,
          path: result.syncPath,
          title: result.title,
          body: result.content,
          }],
          actor: { userId },
        });
      }
      return { ...result, path: result.syncPath };
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
    const versions = await this.prisma.pageVersion.findMany({
      where: { pageId },
      include: { author: { select: AUTHOR_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
    return versions.map((version) => ({
      ...version,
      path: version.syncPath ?? null,
    }));
  }

  async restoreVersion(
    pageId: string,
    versionId: string,
    expectedTreeRevision: string,
    principal: Principal,
  ) {
    const visiblePage = await this.findOne(pageId);

    const restored = await this.prisma.$transaction(async (tx) => {
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      const lockedTx = await this.contentTree.lockPageMutationSpace(
        tx,
        visiblePage.spaceId,
        BigInt(expectedTreeRevision),
      );
      await this.authorization.assertLiveHumanSpaceAccess(
        lockedTx, principal, visiblePage.spaceId, ['owner', 'editor'],
      );
      const treeRevision = BigInt(expectedTreeRevision);
      const version = await tx.pageVersion.findFirst({
        where: { id: versionId, pageId },
      });
      if (!version) throw new NotFoundException('Version not found');
      const page = await tx.page.findUnique({
        where: { id: pageId, deletedAt: null },
      });
      if (!page) throw new NotFoundException('Page not found');
      if (version.parentId !== null && version.parentId !== undefined && !version.folderId) {
        throw new ContentTreeError(
          'PAGE_PARENT_DEPRECATED',
          'This historical Page version must be migrated before it can be restored',
        );
      }
      const restoredFolderId = version.folderId ?? null;
      const placement = await this.contentTree.preparePageMutation(lockedTx, {
        spaceId: page.spaceId,
        pageId: page.id,
        title: version.title,
        folderId: restoredFolderId,
        current: {
          title: page.title,
          folderId: page.folderId ?? null,
          syncPath: page.syncPath,
          syncPathKey: page.syncPathKey,
          sortOrder: page.sortOrder,
          createdAt: page.createdAt,
          updatedAt: page.updatedAt,
          knowledgeKey: page.knowledgeKey,
          content: page.content,
        },
      });
      await tx.pageVersion.create({
        data: {
          pageId: page.id,
          title: page.title,
          content: page.content ?? '',
          authorId: page.authorId,
          slug: page.slug,
          format: page.format,
          parentId: page.parentId,
          folderId: page.folderId ?? null,
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
          parentId: null,
          folderId: placement.folderId,
          syncPath: placement.syncPath,
          syncPathKey: placement.syncPathKey,
          lastChangeSetId: null,
          lastModifiedByUserId: principal.userId,
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
      await this.contentTree.advancePageMutation(lockedTx, {
        spaceId: page.spaceId,
        expectedTreeRevision: treeRevision,
        structural: true,
        changes: [{
          operation: 'upsert',
          pageId: updated.knowledgeKey,
          folderId: updated.folderId,
          path: updated.syncPath,
          title: updated.title,
          body: updated.content,
        }],
        actor: { userId: principal.userId },
      });
      return { ...updated, path: updated.syncPath };
    });

    try {
      await this.searchService.indexPage(pageId);
    } finally {
      this.graphMaintenance.enqueue(visiblePage.spaceId);
    }
    return restored;
  }

  async remove(
    id: string,
    expectedUpdatedAt: string,
    expectedTreeRevision: string,
    principal: Principal,
  ) {
    const existing = await this.findOne(id);
    const expectedVersion = new Date(expectedUpdatedAt);
    const expectedTree = BigInt(expectedTreeRevision);
    const page = await this.prisma.$transaction(async (tx) => {
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      const lockedTx = await this.contentTree.lockPageMutationSpace(tx, existing.spaceId, expectedTree);
      await this.authorization.assertLiveHumanSpaceAccess(
        lockedTx, principal, existing.spaceId, ['owner', 'editor'],
      );
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
          folderId: true,
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
          folderId: current.folderId,
          syncPath: current.syncPath,
          syncPathKey: current.syncPathKey,
        },
      });
      const mutation = await tx.page.updateMany({
        where: {
          id: current.id,
          spaceId: current.spaceId,
          deletedAt: null,
          updatedAt: expectedVersion,
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
      await this.contentTree.advancePageMutation(lockedTx, {
        spaceId: current.spaceId,
        expectedTreeRevision: expectedTree,
        structural: true,
        changes: [{
          operation: 'archive',
          pageId: archived.knowledgeKey,
          previousPath: archived.syncPath ?? undefined,
        }],
        actor: { userId: principal.userId },
      });
      await tx.pageSearchDocument.deleteMany({ where: { pageId: archived.id } });
      return { ...archived, path: archived.syncPath };
    });

    try {
      await this.searchService.deletePageIndex(id);
    } finally {
      this.graphMaintenance.enqueue(existing.spaceId);
    }
    return page;
  }

}
