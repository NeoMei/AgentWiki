import { Injectable } from '@nestjs/common';
import { Prisma, type PageTemplateCategory, type PageTemplateScope } from '@prisma/client';
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
import {
  queryCurrentTemplateCatalog,
  type CurrentTemplateCatalogRow,
} from './current-template-catalog-query';

type CatalogStoredVersion = {
  definition: Prisma.JsonValue | null;
  schemaVersion: number | null;
  definitionHash: string | null;
  contentI18n: Prisma.JsonValue;
};

type TemplateDefinitionOwner = {
  scope: PageTemplateScope;
  sourceLocale: string | null;
  defaultTitleI18n: Prisma.JsonValue;
};

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

export type CompositeTemplateSummary = {
  id: string;
  scope: PageTemplateScope;
  stableKey: string;
  category: PageTemplateCategory;
  kind: 'single_page' | 'page_group';
  supportsCollaboration: boolean;
  effectiveSupportsCollaboration: boolean;
  pageCount: number;
  folderCount: number;
  roleCount: number;
  name: string;
  description: string;
  defaultTitle: string;
  sourceLocale: string | null;
  currentVersion: number;
  archivedAt: string | null;
  updatedAt: string;
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

    return this.validateStoredVersion(template, stored, requestedLocale);
  }

  async list(spaceId: string, query: CompositeTemplateListQuery, principal: Principal) {
    const member = await this.prisma.$transaction((tx) =>
      this.authorization.assertLiveHumanSpaceAccess(
        tx, principal, spaceId, ['owner', 'admin', 'editor', 'viewer'],
      ));
    const canManage = !principal.agentId && ['owner', 'admin'].includes(member.role);
    if (!canManage && query.archived && query.archived !== 'active') {
      throw new BusinessException('PAGE_TEMPLATE_PERMISSION_DENIED');
    }
    const result = await queryCurrentTemplateCatalog(this.prisma, {
      ...query,
      mode: 'composite',
      spaceId,
    });
    const summaries = await this.validateCatalogPage(result.rows, query.locale);
    const rows = result.rows.map((template, index): CompositeTemplateSummary => {
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
        effectiveSupportsCollaboration: summaries[index]!.effectiveSupportsCollaboration,
        pageCount: summaries[index]!.pageCount,
        folderCount: summaries[index]!.folderCount,
        roleCount: summaries[index]!.roleCount,
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

  async detail(
    spaceId: string,
    templateId: string,
    version: number,
    locale: PageTemplateLocale,
    principal: Principal,
  ) {
    const resolved = await this.prisma.$transaction(async (tx) => {
      await this.authorization.assertLiveHumanSpaceAccess(
        tx, principal, spaceId, ['owner', 'admin', 'editor', 'viewer'],
      );
      return this.resolve(tx, spaceId, templateId, version, locale);
    });
    return {
      templateId,
      version,
      locale: resolved.locale,
      definitionHash: resolved.definitionHash,
      definition: resolved.definition,
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

  private async validateCatalogPage(
    rows: CurrentTemplateCatalogRow[],
    locale: PageTemplateLocale,
  ): Promise<Array<{
    pageCount: number;
    folderCount: number;
    roleCount: number;
    effectiveSupportsCollaboration: boolean;
  }>> {
    const summaries = [];
    for (const row of rows) {
      const stored = await this.prisma.pageTemplateVersion.findUnique({
        where: { templateId_version: { templateId: row.id, version: row.currentVersion } },
        select: { definition: true, schemaVersion: true, definitionHash: true, contentI18n: true },
      });
      if (!stored) throw new BusinessException('PAGE_TEMPLATE_INVALID');
      const validated = this.validateStoredVersion(row, stored, locale);
      const effectiveSupportsCollaboration = validated.definition.kind === 'single_page'
        || validated.definition.collaboration !== null;
      if (validated.definition.kind !== row.kind
        || effectiveSupportsCollaboration !== row.supportsCollaboration) {
        throw new BusinessException('PAGE_TEMPLATE_INVALID');
      }
      summaries.push({
        pageCount: validated.definition.nodes.filter((node) => node.kind === 'page').length,
        folderCount: validated.definition.nodes.filter((node) => node.kind === 'folder').length,
        roleCount: validated.definition.collaboration?.workflow.roleSlots.length ?? 0,
        effectiveSupportsCollaboration,
      });
    }
    return summaries;
  }

  private validateStoredVersion(
    template: TemplateDefinitionOwner,
    stored: CatalogStoredVersion,
    requestedLocale: PageTemplateLocale,
  ): {
      definition: CompositeTemplateDefinition;
      definitionHash: string;
      locale: PageTemplateLocale;
    } {
    try {
      const locale = template.scope === 'system'
        ? requestedLocale
        : PageTemplateLocaleSchema.parse(template.sourceLocale);
      if (stored.definition !== null && stored.definition !== undefined) {
        const definition = CompositeTemplateDefinitionSchema.parse(structuredClone(stored.definition));
        if (stored.schemaVersion !== definition.schemaVersion
          || validateCompositeDefinition(definition).length > 0
          || !stored.definitionHash
          || hashCompositeDefinition(definition) !== stored.definitionHash) {
          throw new BusinessException('PAGE_TEMPLATE_INVALID');
        }
        const resolvedLocale = this.definitionLocale(definition, template.scope, locale);
        return { definition, definitionHash: stored.definitionHash, locale: resolvedLocale };
      }

      if (stored.schemaVersion !== null && stored.schemaVersion !== undefined) {
        throw new BusinessException('PAGE_TEMPLATE_INVALID');
      }
      if (stored.definitionHash !== null && stored.definitionHash !== undefined) {
        throw new BusinessException('PAGE_TEMPLATE_INVALID');
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
