import { Injectable } from '@nestjs/common';
import { Prisma, type PageTemplateCategory } from '@prisma/client';
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
import { queryCurrentTemplateCatalog } from './current-template-catalog-query';

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
    const result = await queryCurrentTemplateCatalog(this.prisma, {
      ...query,
      mode: 'composite',
      spaceId,
    });
    const rows = result.rows.map((template) => {
      const fallback = template.scope === 'system'
        ? 'en'
        : PageTemplateLocaleSchema.parse(template.sourceLocale);
      const name = localizedValue(template.nameI18n, query.locale, fallback);
      return {
        id: template.id,
        scope: template.scope,
        stableKey: template.stableKey,
        category: template.category,
        kind: template.kind,
        supportsCollaboration: template.supportsCollaboration,
        name,
        description: localizedValue(template.descriptionI18n, query.locale, fallback),
        defaultTitle: localizedValue(template.defaultTitleI18n, query.locale, fallback),
        sourceLocale: template.sourceLocale,
        currentVersion: template.currentVersion,
        archivedAt: template.archivedAt?.toISOString() ?? null,
        updatedAt: template.updatedAt.toISOString(),
      };
    });
    return {
      data: rows,
      total: result.total,
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
