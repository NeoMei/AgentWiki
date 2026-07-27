import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreatePageDto, UpdatePageDto } from '../dto/page.dto';
import { SearchService } from '../search/search.service';

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
  ) {}

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async create(data: CreatePageDto, userId: string) {
    const space = await this.prisma.space.findUnique({
      where: { id: data.spaceId, deletedAt: null },
    });
    if (!space) throw new NotFoundException('Space not found');
    await this.assertValidParent(data.spaceId, data.parentId);

    const slug = data.slug || (this.slugify(data.title) + '-' + Date.now().toString(36));
    const page = await this.prisma.page.create({
      data: {
        title: data.title,
        slug,
        content: data.content ?? '',
        format: data.format ?? 'markdown',
        spaceId: data.spaceId,
        authorId: userId,
        parentId: data.parentId,
        lastModifiedByUserId: userId,
        lastModifiedAt: new Date(),
      },
      select: {
        ...PAGE_PUBLIC_FIELDS,
        author: { select: AUTHOR_SELECT },
      },
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

  async update(id: string, data: UpdatePageDto, userId?: string) {
    const page = await this.findOne(id);
    if (data.parentId !== undefined) await this.assertValidParent(page.spaceId, data.parentId, id);

    await this.prisma.pageVersion.create({
      data: {
        pageId: page.id,
        title: page.title,
        content: page.content ?? '',
        authorId: userId ?? page.authorId,
        slug: page.slug,
        format: page.format,
        parentId: page.parentId,
      },
    });

    const updated = await this.prisma.page.update({
      where: { id },
      data: {
        ...data,
        lastChangeSetId: null,
        lastModifiedByUserId: userId ?? page.authorId,
        lastModifiedByAgentId: null,
        lastModifiedAt: new Date(),
      },
      select: {
        ...PAGE_PUBLIC_FIELDS,
        author: { select: AUTHOR_SELECT },
      },
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
    await this.findOne(pageId);

    const version = await this.prisma.pageVersion.findFirst({
      where: { id: versionId, pageId },
    });
    if (!version) throw new NotFoundException('Version not found');

    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
    });
    if (!page) throw new NotFoundException('Page not found');

    await this.prisma.pageVersion.create({
      data: {
        pageId: page.id,
        title: page.title,
        content: page.content ?? '',
        authorId: page.authorId,
        slug: page.slug,
        format: page.format,
        parentId: page.parentId,
      },
    });

    const restored = await this.prisma.page.update({
      where: { id: pageId },
      data: {
        title: version.title,
        content: version.content,
        slug: version.slug ?? page.slug,
        format: version.format ?? page.format,
        parentId: version.parentId,
        lastChangeSetId: null,
        lastModifiedByUserId: page.authorId,
        lastModifiedByAgentId: null,
        lastModifiedAt: new Date(),
      },
      select: {
        ...PAGE_PUBLIC_FIELDS,
        author: { select: AUTHOR_SELECT },
      },
    });

    await this.searchService.indexPage(pageId);
    return restored;
  }

  async remove(id: string) {
    await this.findOne(id);
    const page = await this.prisma.page.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: PAGE_PUBLIC_FIELDS,
    });

    await this.searchService.deletePageIndex(id);
    return page;
  }

  private async assertValidParent(spaceId: string, parentId?: string, currentPageId?: string) {
    if (!parentId) return;
    if (parentId === currentPageId) throw new BadRequestException('A page cannot be its own parent');
    let cursor: string | null = parentId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === currentPageId) throw new BadRequestException('Page hierarchy cannot contain a cycle');
      if (visited.has(cursor)) throw new BadRequestException('Existing page hierarchy contains a cycle');
      visited.add(cursor);
      const parent: { spaceId: string; parentId: string | null } | null = await this.prisma.page.findUnique({
        where: { id: cursor, deletedAt: null },
        select: { spaceId: true, parentId: true },
      });
      if (!parent || parent.spaceId !== spaceId) throw new BadRequestException('Parent page must belong to the same space');
      cursor = parent.parentId;
    }
  }
}
