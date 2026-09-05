import { Injectable } from '@nestjs/common';
import { Prisma, type PageTemplate, type PageTemplateCategory, type PageTemplateVersion } from '@prisma/client';
import {
  CompositeTemplateDefinitionSchema,
  type CompositeTemplateDefinition,
} from '@neomei/agentwiki-sync-protocol';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';
import {
  type CreateCompositeSpaceTemplateInput,
  type CreateCompositeTemplateVersionInput,
  PageTemplateService,
} from './page-template.service';
import {
  hashCompositeDefinition,
  normalizeLegacyVersion,
  validateCompositeDefinition,
} from './composite-template-validator';
import {
  localizedValue,
  PageTemplateLocaleSchema,
  resolveLocalizedValue,
  type PageTemplateLocale,
} from './page-template.types';

export type CompositeTemplateListQuery = {
  locale: PageTemplateLocale;
  scope?: 'all' | 'system' | 'space';
  archived?: 'active' | 'archived' | 'all';
  category?: PageTemplateCategory;
  kind?: 'single_page' | 'page_group';
  supportsCollaboration?: boolean;
  q?: string;
  skip: number;
  take: number;
};

@Injectable()
export class CompositeTemplateCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly pageTemplates: PageTemplateService,
  ) {}

  async resolve(
    tx: Prisma.TransactionClient,
    spaceId: string,
    templateId: string,
    version: number,
    requestedLocale: PageTemplateLocale,
  ): Promise<{
    definition: CompositeTemplateDefinition;
    definitionHash: string;
    locale: PageTemplateLocale;
  }> {
    const template = await tx.pageTemplate.findFirst({
      where: {
        id: templateId,
        OR: [{ scope: 'system' }, { scope: 'space', spaceId }],
      },
      include: { versions: { where: { version }, take: 1 } },
    });
    if (!template) throw new BusinessException('PAGE_TEMPLATE_NOT_FOUND');
    if (template.archivedAt) throw new BusinessException('PAGE_TEMPLATE_ARCHIVED');
    const stored = template.versions[0];
    if (!stored) throw new BusinessException('PAGE_TEMPLATE_VERSION_NOT_FOUND');

    try {
      const locale = template.scope === 'system'
        ? requestedLocale
        : PageTemplateLocaleSchema.parse(template.sourceLocale);
      if (stored.definition) {
        const definition = CompositeTemplateDefinitionSchema.parse(structuredClone(stored.definition));
        if (validateCompositeDefinition(definition).length > 0 || !stored.definitionHash
          || hashCompositeDefinition(definition) !== stored.definitionHash) {
          throw new BusinessException('PAGE_TEMPLATE_INVALID');
        }
        const resolvedLocale = this.definitionLocale(definition, template.scope, locale);
        return { definition, definitionHash: stored.definitionHash, locale: resolvedLocale };
      }

      const definition = normalizeLegacyVersion(stored.contentI18n);
      const page = definition.nodes[0];
      if (page.kind !== 'page') throw new BusinessException('PAGE_TEMPLATE_INVALID');
      page.titleI18n = structuredClone(template.defaultTitleI18n) as typeof page.titleI18n;
      const resolved = template.scope === 'system'
        ? resolveLocalizedValue(stored.contentI18n, { scope: 'system', requested: locale })
        : resolveLocalizedValue(stored.contentI18n, { scope: 'space', sourceLocale: locale });
      return { definition, definitionHash: hashCompositeDefinition(definition), locale: resolved.locale };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw new BusinessException('PAGE_TEMPLATE_INVALID');
    }
  }

  async list(spaceId: string, query: CompositeTemplateListQuery, principal: Principal) {
    const member = await this.authorization.assertSpaceAccess(
      principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
    );
    const canManage = !principal.agentId && ['owner', 'admin'].includes(member.role);
    if (!canManage && query.archived && query.archived !== 'active') {
      throw new BusinessException('PAGE_TEMPLATE_PERMISSION_DENIED');
    }
    const spaceArchive = query.archived === 'archived' ? { archivedAt: { not: null } }
      : query.archived === 'all' ? {} : { archivedAt: null };
    const where: Prisma.PageTemplateWhereInput = {
      OR: [
        ...(query.scope === 'space' ? [] : [{ scope: 'system' as const, archivedAt: null }]),
        ...(query.scope === 'system' ? [] : [{ scope: 'space' as const, spaceId, ...spaceArchive }]),
      ],
      ...(query.category ? { category: query.category } : {}),
    };
    const records = await this.prisma.pageTemplate.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { updatedAt: 'desc' }, { id: 'asc' }],
    });
    const currentVersions = records.length === 0 ? [] : await this.prisma.pageTemplateVersion.findMany({
      where: {
        OR: records.map((template) => ({
          templateId: template.id,
          version: template.currentVersion,
        })),
      },
    });
    const versionByTemplateId = new Map(
      (currentVersions as PageTemplateVersion[]).map((version) => [version.templateId, version]),
    );
    // Semantic filters are applied to exact current versions before pagination.
    const rows = (records as PageTemplate[]).flatMap((template) => {
      const version = versionByTemplateId.get(template.id);
      if (!version) throw new BusinessException('PAGE_TEMPLATE_VERSION_NOT_FOUND');
      const parsed = version.definition
        ? CompositeTemplateDefinitionSchema.safeParse(version.definition)
        : null;
      const definition = parsed
        ? parsed.success ? parsed.data : null
        : normalizeLegacyVersion(version.contentI18n);
      if (!definition || validateCompositeDefinition(definition).length > 0) {
        throw new BusinessException('PAGE_TEMPLATE_INVALID');
      }
      if (version.definition && (!version.definitionHash
        || hashCompositeDefinition(definition) !== version.definitionHash)) {
        throw new BusinessException('PAGE_TEMPLATE_INVALID');
      }
      const supportsCollaboration = definition.collaboration !== null;
      if (query.kind && definition.kind !== query.kind) return [];
      if (query.supportsCollaboration !== undefined
        && supportsCollaboration !== query.supportsCollaboration) return [];
      const fallback = template.scope === 'system'
        ? 'en'
        : PageTemplateLocaleSchema.parse(template.sourceLocale);
      const name = localizedValue(template.nameI18n, query.locale, fallback);
      const normalizedQuery = query.q?.trim().toLocaleLowerCase(query.locale);
      if (normalizedQuery && !name.toLocaleLowerCase(query.locale).includes(normalizedQuery)) return [];
      return [{
        id: template.id,
        scope: template.scope,
        stableKey: template.stableKey,
        category: template.category,
        kind: definition.kind,
        supportsCollaboration,
        name,
        description: localizedValue(template.descriptionI18n, query.locale, fallback),
        defaultTitle: localizedValue(template.defaultTitleI18n, query.locale, fallback),
        sourceLocale: template.sourceLocale,
        currentVersion: template.currentVersion,
        archivedAt: template.archivedAt?.toISOString() ?? null,
        updatedAt: template.updatedAt.toISOString(),
      }];
    });
    return {
      data: rows.slice(query.skip, query.skip + query.take),
      total: rows.length,
      skip: query.skip,
      take: query.take,
      capabilities: { canManage },
    };
  }

  createSpaceTemplate(spaceId: string, body: CreateCompositeSpaceTemplateInput, principal: Principal) {
    return this.pageTemplates.createCompositeSpaceTemplate(spaceId, body, principal);
  }

  createVersion(
    spaceId: string,
    templateId: string,
    body: CreateCompositeTemplateVersionInput,
    principal: Principal,
  ) {
    return this.pageTemplates.createCompositeVersion(spaceId, templateId, body, principal);
  }

  updateMetadata(...args: Parameters<PageTemplateService['updateMetadata']>) {
    return this.pageTemplates.updateMetadata(...args);
  }

  archive(...args: Parameters<PageTemplateService['archive']>) {
    return this.pageTemplates.archive(...args);
  }

  restore(...args: Parameters<PageTemplateService['restore']>) {
    return this.pageTemplates.restore(...args);
  }

  private definitionLocale(
    definition: CompositeTemplateDefinition,
    scope: 'system' | 'space',
    preferred: PageTemplateLocale,
  ): PageTemplateLocale {
    const localized = definition.nodes.flatMap((node) => node.kind === 'folder'
      ? [node.nameI18n]
      : [node.titleI18n, node.contentI18n]);
    if (scope === 'space') {
      if (localized.some((value) => value[preferred] === undefined)) {
        throw new BusinessException('PAGE_TEMPLATE_INVALID');
      }
      return preferred;
    }
    if (localized.every((value) => value[preferred] !== undefined)) return preferred;
    if (localized.every((value) => value.en !== undefined)) return 'en';
    throw new BusinessException('PAGE_TEMPLATE_INVALID');
  }
}
