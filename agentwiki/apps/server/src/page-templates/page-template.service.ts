import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PageTemplate, Prisma } from '@prisma/client';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';
import { type PageTemplateListQueryDto } from './page-template.dto';
import { BUILT_IN_PAGE_TEMPLATES, type BuiltInPageTemplate } from './page-template-definitions';
import {
  localizedValue,
  normalizeTemplateName,
  type PageTemplateLocale,
  PageTemplateLocaleSchema,
  templateContentHash,
} from './page-template.types';

@Injectable()
export class PageTemplateService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (['api', 'all'].includes(this.config.get<string>('PROCESS_ROLE', 'api'))) {
      await this.seedBuiltIns();
    }
  }

  async seedBuiltIns(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('agentwiki:page-template-seeds'))`;
      for (const seed of BUILT_IN_PAGE_TEMPLATES) await this.seedOne(seed, tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async seedOne(seed: BuiltInPageTemplate, transaction?: Prisma.TransactionClient): Promise<void> {
    const tx = transaction ?? this.prisma;
    const current = await tx.pageTemplate.findUnique({
      where: { scopeKey_stableKey: { scopeKey: 'system', stableKey: seed.stableKey } },
    });
    const contentHash = templateContentHash(JSON.stringify(seed.content));
    if (!current) {
      const created = await tx.pageTemplate.create({ data: {
        scope: 'system', scopeKey: 'system', stableKey: seed.stableKey,
        category: seed.category, displayOrder: seed.displayOrder,
        nameI18n: seed.name as Prisma.InputJsonValue,
        descriptionI18n: seed.description as Prisma.InputJsonValue,
        defaultTitleI18n: seed.defaultTitle as Prisma.InputJsonValue,
        currentVersion: seed.seedVersion,
      } });
      await tx.pageTemplateVersion.create({ data: {
        templateId: created.id, version: seed.seedVersion,
        contentI18n: seed.content as Prisma.InputJsonValue, contentHash, sourcePageId: null,
      } });
      return;
    }
    if (current.scope !== 'system' || current.currentVersion >= seed.seedVersion) return;
    await tx.pageTemplateVersion.create({ data: {
      templateId: current.id, version: seed.seedVersion,
      contentI18n: seed.content as Prisma.InputJsonValue, contentHash, sourcePageId: null,
    } });
    const updated = await tx.pageTemplate.updateMany({
      where: { id: current.id, scope: 'system', currentVersion: current.currentVersion },
      data: {
        category: seed.category, displayOrder: seed.displayOrder,
        nameI18n: seed.name as Prisma.InputJsonValue,
        descriptionI18n: seed.description as Prisma.InputJsonValue,
        defaultTitleI18n: seed.defaultTitle as Prisma.InputJsonValue,
        currentVersion: seed.seedVersion, archivedAt: null,
      },
    });
    if (updated.count !== 1) throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
  }

  async list(spaceId: string, query: PageTemplateListQueryDto, principal: Principal) {
    const member = await this.authorization.assertSpaceAccess(
      principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
    );
    const canManage = !principal.agentId && ['owner', 'admin'].includes(member.role);
    const system = query.scope === 'space' ? [] : await this.prisma.pageTemplate.findMany({
      where: { scope: 'system', archivedAt: null, ...(query.category ? { category: query.category } : {}) },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    });
    const spaceWhere: Prisma.PageTemplateWhereInput = {
      scope: 'space', spaceId,
      ...(query.archived === 'archived' ? { archivedAt: { not: null } }
        : query.archived === 'all' ? {} : { archivedAt: null }),
      ...(query.category ? { category: query.category } : {}),
      ...(query.q?.trim() ? { nameKey: { contains: normalizeTemplateName(query.q) } } : {}),
    };
    const [space, totalSpace] = query.scope === 'system' ? [[], 0] : await Promise.all([
      this.prisma.pageTemplate.findMany({
        where: spaceWhere, skip: query.skip, take: query.take,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.pageTemplate.count({ where: spaceWhere }),
    ]);
    const systemSummaries = system.map((row) => this.summary(row, query.locale));
    const normalizedQuery = query.q?.trim().toLocaleLowerCase(query.locale);
    return {
      system: normalizedQuery
        ? systemSummaries.filter((row) => row.name.toLocaleLowerCase(query.locale).includes(normalizedQuery))
        : systemSummaries,
      space: space.map((row) => this.summary(row, query.locale)),
      totalSpace, skip: query.skip, take: query.take,
      capabilities: { canManage },
    };
  }

  async resolveVersion(tx: Prisma.TransactionClient, input: {
    spaceId: string; templateId: string; version: number; locale: PageTemplateLocale;
  }): Promise<{ content: string; templateId: string; version: number; locale: PageTemplateLocale }> {
    const template = await tx.pageTemplate.findFirst({
      where: {
        id: input.templateId,
        OR: [{ scope: 'system' }, { scope: 'space', spaceId: input.spaceId }],
      },
      include: { versions: { where: { version: input.version }, take: 1 } },
    });
    if (!template) throw new BusinessException('PAGE_TEMPLATE_NOT_FOUND');
    if (template.archivedAt) throw new BusinessException('PAGE_TEMPLATE_ARCHIVED');
    const version = template.versions[0];
    if (!version) throw new BusinessException('PAGE_TEMPLATE_VERSION_NOT_FOUND');
    const fallback = template.scope === 'system' ? 'en' : PageTemplateLocaleSchema.parse(template.sourceLocale);
    const locale = template.scope === 'system' ? input.locale : fallback;
    return {
      content: localizedValue(version.contentI18n, input.locale, fallback),
      templateId: template.id,
      version: version.version,
      locale,
    };
  }

  async get(spaceId: string, templateId: string, locale: PageTemplateLocale, principal: Principal) {
    await this.authorization.assertSpaceAccess(
      principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
    );
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.pageTemplate.findFirst({
        where: { id: templateId, OR: [{ scope: 'system' }, { scope: 'space', spaceId }] },
      });
      if (!template) throw new BusinessException('PAGE_TEMPLATE_NOT_FOUND');
      if (template.archivedAt) throw new BusinessException('PAGE_TEMPLATE_ARCHIVED');
      const version = await tx.pageTemplateVersion.findUnique({
        where: { templateId_version: { templateId: template.id, version: template.currentVersion } },
      });
      if (!version) throw new BusinessException('PAGE_TEMPLATE_VERSION_NOT_FOUND');
      const fallback = template.scope === 'system' ? 'en' : PageTemplateLocaleSchema.parse(template.sourceLocale);
      const contentLocale = template.scope === 'system' ? locale : fallback;
      return {
        ...this.summary(template, locale),
        content: localizedValue(version.contentI18n, locale, fallback),
        contentLocale,
        sourcePageId: version.sourcePageId,
      };
    });
  }

  private summary(template: PageTemplate, locale: PageTemplateLocale) {
    const fallback = template.scope === 'system' ? 'en' : PageTemplateLocaleSchema.parse(template.sourceLocale);
    return {
      id: template.id, scope: template.scope, stableKey: template.stableKey, category: template.category,
      name: localizedValue(template.nameI18n, locale, fallback),
      description: localizedValue(template.descriptionI18n, locale, fallback),
      defaultTitle: localizedValue(template.defaultTitleI18n, locale, fallback),
      sourceLocale: template.sourceLocale ? PageTemplateLocaleSchema.parse(template.sourceLocale) : null,
      currentVersion: template.currentVersion,
      archivedAt: template.archivedAt?.toISOString() ?? null,
      updatedAt: template.updatedAt.toISOString(),
    };
  }
}
