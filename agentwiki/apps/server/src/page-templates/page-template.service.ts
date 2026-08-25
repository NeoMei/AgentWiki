import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PageTemplate, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ZodError } from 'zod';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';
import {
  type CreatePageTemplateDto,
  type CreatePageTemplateVersionDto,
  type PageTemplateListQueryDto,
  type PageTemplateSourceListQueryDto,
  type PageTemplateStateDto,
  type UpdatePageTemplateDto,
} from './page-template.dto';
import { BUILT_IN_PAGE_TEMPLATES, type BuiltInPageTemplate } from './page-template-definitions';
import {
  localizedValue,
  normalizeTemplateName,
  PageTemplateContentSchema,
  type PageTemplateLocale,
  PageTemplateLocaleSchema,
  resolveLocalizedValue,
  templateContentHash,
} from './page-template.types';

const SEED_TRANSACTION_MAX_ATTEMPTS = 3;
const SPACE_MUTATION_MAX_ATTEMPTS = 3;
const PAGE_TEMPLATE_NAME_CONSTRAINT = 'PageTemplate_spaceId_nameKey_key';
const PAGE_TEMPLATE_STABLE_KEY_CONSTRAINT = 'PageTemplate_scopeKey_stableKey_key';
const PAGE_TEMPLATE_VERSION_CONSTRAINT = 'PageTemplateVersion_templateId_version_key';

function isRetryableSeedTransactionError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034' || error.code === 'P2002') return true;
  if (error.code !== 'P2010') return false;
  const meta = error.meta;
  if (meta?.code === '40001') return true;
  return typeof meta?.message === 'string'
    && /\bserialization(?:_| )failure\b|\bcould not serialize access\b/iu.test(meta.message);
}

function isRetryableSpaceMutationError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010') return false;
  const meta = error.meta;
  if (meta?.code === '40001') return true;
  return typeof meta?.message === 'string'
    && /\bserialization(?:_| )failure\b|\bcould not serialize access\b/iu.test(meta.message);
}

type PageTemplateUniqueConflict = 'name' | 'stableKey' | 'version';

function pageTemplateUniqueConflict(error: unknown): PageTemplateUniqueConflict | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return undefined;
  }
  const candidates = [error.meta?.target, error.meta?.constraint, error.meta?.constraint_name];
  if (candidates.some((candidate) => uniqueTargetMatches(
    candidate, ['spaceId', 'nameKey'], PAGE_TEMPLATE_NAME_CONSTRAINT,
  ))) return 'name';
  if (candidates.some((candidate) => uniqueTargetMatches(
    candidate, ['scopeKey', 'stableKey'], PAGE_TEMPLATE_STABLE_KEY_CONSTRAINT,
  ))) return 'stableKey';
  if (candidates.some((candidate) => uniqueTargetMatches(
    candidate, ['templateId', 'version'], PAGE_TEMPLATE_VERSION_CONSTRAINT,
  ))) return 'version';
  return undefined;
}

function uniqueTargetMatches(
  candidate: unknown,
  fields: string[],
  constraint: string,
): boolean {
  if (candidate === constraint) return true;
  return Array.isArray(candidate)
    && candidate.length === fields.length
    && candidate.every((field) => typeof field === 'string' && fields.includes(field));
}

function truncateCodePoints(value: string, length: number): string {
  return Array.from(value).slice(0, length).join('');
}

@Injectable()
export class PageTemplateService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly config: ConfigService,
    private readonly revisionWriter: SpaceRevisionWriterService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (['api', 'all'].includes(this.config.get<string>('PROCESS_ROLE', 'api'))) {
      await this.seedBuiltIns();
    }
  }

  async seedBuiltIns(): Promise<void> {
    for (let attempt = 1; attempt <= SEED_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('agentwiki:page-template-seeds'))`;
          for (const seed of BUILT_IN_PAGE_TEMPLATES) await this.seedOne(seed, tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return;
      } catch (error) {
        if (attempt === SEED_TRANSACTION_MAX_ATTEMPTS || !isRetryableSeedTransactionError(error)) throw error;
      }
    }
  }

  async seedOne(seed: BuiltInPageTemplate, transaction?: Prisma.TransactionClient): Promise<void> {
    if (!transaction) {
      await this.prisma.$transaction((tx) => this.seedOne(seed, tx));
      return;
    }
    const tx = transaction;
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
    if (!canManage && query.archived && query.archived !== 'active') {
      throw new BusinessException('PAGE_TEMPLATE_PERMISSION_DENIED');
    }
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
    try {
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
    } catch (error) {
      this.rethrowInvalidTemplateJson(error);
    }
  }

  async listSourcePages(
    spaceId: string,
    query: PageTemplateSourceListQueryDto,
    principal: Principal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCanManage(tx, principal, spaceId);
      const where = { spaceId, deletedAt: null, format: 'markdown' } as const;
      const [pages, total] = await Promise.all([
        tx.page.findMany({
          where,
          select: { id: true, title: true, format: true, updatedAt: true },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          skip: query.skip,
          take: query.take,
        }),
        tx.page.count({ where }),
      ]);
      return {
        data: pages.map((page) => ({
          id: page.id,
          title: page.title,
          format: page.format,
          updatedAt: page.updatedAt.toISOString(),
        })),
        total,
        skip: query.skip,
        take: query.take,
      };
    });
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
    try {
      const resolved = template.scope === 'system'
        ? resolveLocalizedValue(version.contentI18n, { scope: 'system', requested: input.locale })
        : resolveLocalizedValue(version.contentI18n, {
          scope: 'space', sourceLocale: PageTemplateLocaleSchema.parse(template.sourceLocale),
        });
      return {
        content: resolved.value,
        templateId: template.id,
        version: version.version,
        locale: resolved.locale,
      };
    } catch (error) {
      this.rethrowInvalidTemplateJson(error);
    }
  }

  async get(spaceId: string, templateId: string, locale: PageTemplateLocale, principal: Principal) {
    await this.authorization.assertSpaceAccess(
      principal, spaceId, ['owner', 'admin', 'editor'], 'pages:read',
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
      try {
        const resolved = template.scope === 'system'
          ? resolveLocalizedValue(version.contentI18n, { scope: 'system', requested: locale })
          : resolveLocalizedValue(version.contentI18n, {
            scope: 'space', sourceLocale: PageTemplateLocaleSchema.parse(template.sourceLocale),
          });
        return {
          ...this.summary(template, locale),
          content: resolved.value,
          contentLocale: resolved.locale,
          sourcePageId: version.sourcePageId,
        };
      } catch (error) {
        this.rethrowInvalidTemplateJson(error);
      }
    });
  }

  async createSpaceTemplate(
    spaceId: string,
    body: CreatePageTemplateDto,
    principal: Principal,
  ) {
    return this.runSpaceMutation(spaceId, async (tx) => {
      await this.assertCanManage(tx, principal, spaceId);
      const { name, defaultTitle } = this.normalizedMetadata(body);
      const activeCount = await tx.pageTemplate.count({
        where: { spaceId, scope: 'space', archivedAt: null },
      });
      if (activeCount >= 100) throw new BusinessException('PAGE_TEMPLATE_QUOTA_EXCEEDED');
      const source = await this.sourceMarkdown(
        tx, spaceId, body.sourcePageId, body.expectedSourceUpdatedAt,
      );
      const nameKey = normalizeTemplateName(name);
      const existing = await tx.pageTemplate.findUnique({
        where: { spaceId_nameKey: { spaceId, nameKey } },
      });
      if (existing) throw new BusinessException('PAGE_TEMPLATE_NAME_CONFLICT');
      const stableKey = await this.allocateStableKey(tx, spaceId, name);
      const localized = <T extends string>(value: T): Prisma.InputJsonValue => ({ [body.locale]: value });
      const created = await tx.pageTemplate.create({ data: {
        scope: 'space', scopeKey: spaceId, spaceId, stableKey,
        category: body.category, nameI18n: localized(name), nameKey,
        descriptionI18n: localized(body.description?.trim() ?? ''),
        defaultTitleI18n: localized(defaultTitle),
        sourceLocale: body.locale, currentVersion: 1,
        createdById: principal.userId, updatedById: principal.userId,
      } });
      await tx.pageTemplateVersion.create({ data: {
        templateId: created.id, version: 1,
        contentI18n: localized(source.content),
        contentHash: templateContentHash(source.content),
        sourcePageId: source.id, createdById: principal.userId,
      } });
      return this.getManagedRecord(tx, created.id, body.locale);
    }, { retryStableKeyConflict: true });
  }

  async updateMetadata(
    spaceId: string,
    templateId: string,
    body: UpdatePageTemplateDto,
    principal: Principal,
  ) {
    return this.runSpaceMutation(spaceId, async (tx) => {
      await this.assertCanManage(tx, principal, spaceId);
      const current = await this.requireSpaceTemplate(tx, spaceId, templateId);
      if (current.archivedAt) throw new BusinessException('PAGE_TEMPLATE_ARCHIVED');
      const { name, defaultTitle } = this.normalizedMetadata(body);
      const nameKey = normalizeTemplateName(name);
      const duplicate = await tx.pageTemplate.findFirst({
        where: { spaceId, nameKey, id: { not: templateId } },
        select: { id: true },
      });
      if (duplicate) throw new BusinessException('PAGE_TEMPLATE_NAME_CONFLICT');
      const locale = PageTemplateLocaleSchema.parse(current.sourceLocale);
      const changed = await tx.pageTemplate.updateMany({
        where: {
          id: templateId, spaceId, scope: 'space', archivedAt: null,
          updatedAt: new Date(body.expectedUpdatedAt),
        },
        data: {
          nameI18n: { [locale]: name }, nameKey,
          descriptionI18n: { [locale]: body.description?.trim() ?? '' },
          defaultTitleI18n: { [locale]: defaultTitle },
          category: body.category, updatedById: principal.userId,
        },
      });
      if (changed.count !== 1) throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
      return this.getManagedRecord(tx, templateId, locale);
    });
  }

  async createVersion(
    spaceId: string,
    templateId: string,
    body: CreatePageTemplateVersionDto,
    principal: Principal,
  ) {
    return this.runSpaceMutation(spaceId, async (tx) => {
      await this.assertCanManage(tx, principal, spaceId);
      const current = await this.requireSpaceTemplate(tx, spaceId, templateId);
      if (current.archivedAt) throw new BusinessException('PAGE_TEMPLATE_ARCHIVED');
      if (current.currentVersion !== body.expectedCurrentVersion) {
        throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
      }
      const source = await this.sourceMarkdown(
        tx, spaceId, body.sourcePageId, body.expectedSourceUpdatedAt,
      );
      const hash = templateContentHash(source.content);
      const previous = await tx.pageTemplateVersion.findUnique({
        where: {
          templateId_version: { templateId, version: current.currentVersion },
        },
      });
      const locale = PageTemplateLocaleSchema.parse(current.sourceLocale);
      if (previous?.contentHash === hash) {
        return {
          ...(await this.getManagedRecord(tx, templateId, locale)),
          noChange: true,
        };
      }
      const nextVersion = current.currentVersion + 1;
      await tx.pageTemplateVersion.create({ data: {
        templateId, version: nextVersion,
        contentI18n: { [locale]: source.content },
        contentHash: hash, sourcePageId: source.id,
        createdById: principal.userId,
      } });
      const changed = await tx.pageTemplate.updateMany({
        where: {
          id: templateId, spaceId, scope: 'space',
          currentVersion: current.currentVersion, archivedAt: null,
        },
        data: { currentVersion: nextVersion, updatedById: principal.userId },
      });
      if (changed.count !== 1) throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
      return this.getManagedRecord(tx, templateId, locale);
    });
  }

  async archive(
    spaceId: string,
    templateId: string,
    body: PageTemplateStateDto,
    principal: Principal,
  ) {
    return this.runSpaceMutation(spaceId, async (tx) => {
      await this.assertCanManage(tx, principal, spaceId);
      const current = await this.requireSpaceTemplate(tx, spaceId, templateId);
      const locale = PageTemplateLocaleSchema.parse(current.sourceLocale);
      const changed = await tx.pageTemplate.updateMany({
        where: {
          id: templateId, spaceId, scope: 'space', archivedAt: null,
          updatedAt: new Date(body.expectedUpdatedAt),
        },
        data: { archivedAt: new Date(), updatedById: principal.userId },
      });
      if (changed.count !== 1) throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
      return this.getManagedRecord(tx, templateId, locale);
    });
  }

  async restore(
    spaceId: string,
    templateId: string,
    body: PageTemplateStateDto,
    principal: Principal,
  ) {
    return this.runSpaceMutation(spaceId, async (tx) => {
      await this.assertCanManage(tx, principal, spaceId);
      const current = await this.requireSpaceTemplate(tx, spaceId, templateId);
      if (!current.archivedAt) throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
      const activeCount = await tx.pageTemplate.count({
        where: { spaceId, scope: 'space', archivedAt: null },
      });
      if (activeCount >= 100) throw new BusinessException('PAGE_TEMPLATE_QUOTA_EXCEEDED');
      const locale = PageTemplateLocaleSchema.parse(current.sourceLocale);
      const changed = await tx.pageTemplate.updateMany({
        where: {
          id: templateId, spaceId, scope: 'space', archivedAt: { not: null },
          updatedAt: new Date(body.expectedUpdatedAt),
        },
        data: { archivedAt: null, updatedById: principal.userId },
      });
      if (changed.count !== 1) throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
      return this.getManagedRecord(tx, templateId, locale);
    });
  }

  private async runSpaceMutation<T>(
    spaceId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    options: { retryStableKeyConflict?: boolean } = {},
  ): Promise<T> {
    for (let attempt = 1; attempt <= SPACE_MUTATION_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // Every Space-scoped template mutation shares the same first lock as
          // Page and Space writes. Authorization and active-Space validation
          // therefore run against state observed only after serialization.
          const lockedTx = await this.revisionWriter.lockSpace(tx, spaceId);
          return operation(lockedTx);
        }, {
          // The Space advisory lock serializes these mutations. ReadCommitted
          // ensures authorization and state reads after a wait see the writer
          // that just released the lock instead of a pre-wait MVCC snapshot.
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        });
      } catch (error) {
        const uniqueConflict = pageTemplateUniqueConflict(error);
        if (uniqueConflict === 'name') {
          throw new BusinessException('PAGE_TEMPLATE_NAME_CONFLICT');
        }
        if (uniqueConflict === 'version') {
          throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
        }
        if (uniqueConflict === 'stableKey' && options.retryStableKeyConflict) {
          if (attempt === SPACE_MUTATION_MAX_ATTEMPTS) {
            throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
          }
          continue;
        }
        if (!isRetryableSpaceMutationError(error)) throw error;
        if (attempt === SPACE_MUTATION_MAX_ATTEMPTS) {
          throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
        }
      }
    }
    throw new BusinessException('PAGE_TEMPLATE_VERSION_CONFLICT');
  }

  private async assertCanManage(
    tx: Prisma.TransactionClient,
    principal: Principal,
    spaceId: string,
  ): Promise<void> {
    try {
      await this.authorization.assertLiveHumanSpaceAccess(
        tx, principal, spaceId, ['owner', 'admin'],
      );
    } catch (error) {
      if (error instanceof BusinessException && error.businessCode === 'SPACE_ACCESS_DENIED') {
        throw new BusinessException('PAGE_TEMPLATE_PERMISSION_DENIED');
      }
      throw error;
    }
  }

  private normalizedMetadata(input: { name: string; defaultTitle: string }) {
    const name = input.name.trim().replace(/\s+/gu, ' ');
    const defaultTitle = input.defaultTitle.trim();
    if (!name || !defaultTitle) throw new BusinessException('PAGE_TEMPLATE_INVALID');
    return { name, defaultTitle };
  }

  private async sourceMarkdown(
    tx: Prisma.TransactionClient,
    spaceId: string,
    pageId: string,
    expectedUpdatedAt: string,
  ) {
    const source = await tx.page.findFirst({
      where: { id: pageId, spaceId, deletedAt: null },
      select: {
        id: true, content: true, format: true, updatedAt: true, deletedAt: true,
      },
    });
    if (!source || source.deletedAt || source.format !== 'markdown'
      || !PageTemplateContentSchema.safeParse(source.content).success) {
      throw new BusinessException('PAGE_TEMPLATE_SOURCE_INVALID');
    }
    if (source.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
      throw new BusinessException('PAGE_TEMPLATE_SOURCE_STALE');
    }
    return source;
  }

  private async requireSpaceTemplate(
    tx: Prisma.TransactionClient,
    spaceId: string,
    templateId: string,
  ) {
    const template = await tx.pageTemplate.findFirst({
      where: { id: templateId, spaceId, scope: 'space' },
    });
    if (!template) {
      const system = await tx.pageTemplate.findFirst({
        where: { id: templateId, scope: 'system' },
        select: { id: true },
      });
      throw new BusinessException(
        system ? 'PAGE_TEMPLATE_SYSTEM_IMMUTABLE' : 'PAGE_TEMPLATE_NOT_FOUND',
      );
    }
    return template;
  }

  private async allocateStableKey(
    tx: Prisma.TransactionClient,
    spaceId: string,
    name: string,
  ): Promise<string> {
    const base = truncateCodePoints(
      name.normalize('NFKC').toLocaleLowerCase()
        .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
        .replace(/^-+|-+$/gu, ''),
      64,
    ) || 'template';
    const compatibleStableKeys = [
      base,
      ...Array.from({ length: 99 }, (_, index) => {
        const suffix = `-${index + 2}`;
        return `${truncateCodePoints(base, 64 - suffix.length)}${suffix}`;
      }),
    ];
    const occupied = new Set((await tx.pageTemplate.findMany({
      where: { scopeKey: spaceId, stableKey: { in: compatibleStableKeys } },
      select: { stableKey: true },
      take: compatibleStableKeys.length,
    })).map(({ stableKey }) => stableKey));
    const compatible = compatibleStableKeys.find((stableKey) => !occupied.has(stableKey));
    if (compatible) return compatible;
    const entropy = randomUUID().replaceAll('-', '');
    return `${truncateCodePoints(base, 64 - entropy.length - 1)}-${entropy}`;
  }

  private async getManagedRecord(
    tx: Prisma.TransactionClient,
    templateId: string,
    locale: PageTemplateLocale,
  ) {
    const template = await tx.pageTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new BusinessException('PAGE_TEMPLATE_NOT_FOUND');
    const version = await tx.pageTemplateVersion.findUnique({
      where: {
        templateId_version: { templateId, version: template.currentVersion },
      },
    });
    if (!version) throw new BusinessException('PAGE_TEMPLATE_VERSION_NOT_FOUND');
    try {
      const resolved = resolveLocalizedValue(version.contentI18n, {
        scope: 'space', sourceLocale: locale,
      });
      return {
        ...this.summary(template, locale),
        content: resolved.value,
        contentLocale: resolved.locale,
        sourcePageId: version.sourcePageId,
      };
    } catch (error) {
      this.rethrowInvalidTemplateJson(error);
    }
  }

  private rethrowInvalidTemplateJson(error: unknown): never {
    if (error instanceof ZodError) throw new BusinessException('PAGE_TEMPLATE_INVALID');
    throw error;
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
