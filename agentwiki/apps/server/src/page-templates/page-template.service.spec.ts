import { Prisma } from '@prisma/client';
import type { Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { BUILT_IN_PAGE_TEMPLATES } from './page-template-definitions';
import { PageTemplateService } from './page-template.service';
import { templateContentHash } from './page-template.types';

const principal: Principal = { userId: 'user-1' };

const systemRecord = {
  id: 'system-1',
  scope: 'system',
  stableKey: 'task-list',
  category: 'planning',
  nameI18n: { 'zh-CN': '任务清单', en: 'Task list' },
  descriptionI18n: { 'zh-CN': '组织待办', en: 'Organize tasks' },
  defaultTitleI18n: { 'zh-CN': '任务清单', en: 'Task list' },
  sourceLocale: null,
  currentVersion: 1,
  archivedAt: null,
  updatedAt: new Date('2026-08-25T00:00:00.000Z'),
};

const spaceRecord = {
  id: 'space-template',
  scope: 'space',
  stableKey: 'team-weekly-report',
  category: 'reporting',
  nameI18n: { 'zh-CN': '团队周报' },
  descriptionI18n: { 'zh-CN': '团队每周进展' },
  defaultTitleI18n: { 'zh-CN': '团队周报' },
  sourceLocale: 'zh-CN',
  currentVersion: 2,
  archivedAt: null,
  updatedAt: new Date('2026-08-25T01:00:00.000Z'),
};

const sourceTimestamp = '2026-08-25T10:00:00.000Z';
const templateTimestamp = '2026-08-25T01:00:00.000Z';

const validCreateBody = {
  name: ' Team Weekly ',
  description: 'Shared format',
  category: 'reporting' as const,
  defaultTitle: 'Team weekly',
  locale: 'en' as const,
  sourcePageId: 'page-1',
  expectedSourceUpdatedAt: sourceTimestamp,
};

function markdownPage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'page-1',
    spaceId: 'space-1',
    format: 'markdown',
    content: '# Team weekly',
    deletedAt: null,
    updatedAt: new Date(sourceTimestamp),
    ...overrides,
  };
}

function spaceTemplate(overrides: Record<string, unknown> = {}) {
  return {
    ...spaceRecord,
    id: 'template-1',
    stableKey: 'team-weekly',
    nameI18n: { en: 'Team Weekly' },
    descriptionI18n: { en: 'Shared format' },
    defaultTitleI18n: { en: 'Team weekly' },
    sourceLocale: 'en',
    currentVersion: 3,
    ...overrides,
  };
}

describe('PageTemplateService', () => {
  const pageTemplate = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  };
  const pageTemplateVersion = {
    findUnique: jest.fn(),
    create: jest.fn(),
  };
  const page = { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() };
  const prisma = {
    pageTemplate,
    pageTemplateVersion,
    page,
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
  } as any;
  const authorization = {
    assertSpaceAccess: jest.fn(),
    assertLiveHumanSpaceAccess: jest.fn(),
  } as any;
  const config = { get: jest.fn().mockReturnValue('api') } as any;
  const revisionWriter = {
    lockSpace: jest.fn(async (tx: unknown) => tx),
  } as any;
  let service: PageTemplateService;

  beforeEach(() => {
    jest.resetAllMocks();
    revisionWriter.lockSpace.mockImplementation(async (tx: unknown) => tx);
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$executeRaw.mockResolvedValue(1);
    config.get.mockReturnValue('api');
    pageTemplate.create.mockImplementation(async ({ data }: any) => ({ id: `created-${data.stableKey}`, ...data }));
    pageTemplate.updateMany.mockResolvedValue({ count: 1 });
    pageTemplateVersion.create.mockResolvedValue({ id: 'version-1' });
    pageTemplate.findMany.mockResolvedValue([]);
    pageTemplate.count.mockResolvedValue(0);
    pageTemplate.findUnique.mockResolvedValue(null);
    pageTemplate.findFirst.mockResolvedValue(null);
    pageTemplateVersion.findUnique.mockResolvedValue(null);
    page.findFirst.mockResolvedValue(markdownPage());
    page.findMany.mockResolvedValue([]);
    page.count.mockResolvedValue(0);
    authorization.assertLiveHumanSpaceAccess.mockResolvedValue({ role: 'owner' });
    service = new PageTemplateService(prisma, authorization, config, revisionWriter);
  });

  it('seeds a new system template and version atomically', async () => {
    pageTemplate.findUnique.mockResolvedValue(null);

    await service.seedBuiltIns();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function), { isolationLevel: 'Serializable' },
    );
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(pageTemplate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ scope: 'system', scopeKey: 'system', currentVersion: 1 }),
    }));
    expect(pageTemplateVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ version: 1, sourcePageId: null }),
    }));
  });

  it('creates only the next immutable version for a newer seed', async () => {
    pageTemplate.findUnique.mockResolvedValue({ id: 'system-1', scope: 'system', currentVersion: 1 });
    pageTemplateVersion.findUnique.mockResolvedValue(null);

    await service.seedOne({ ...BUILT_IN_PAGE_TEMPLATES[0], seedVersion: 2 } as any);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(pageTemplateVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ templateId: 'system-1', version: 2 }),
    }));
    expect(pageTemplate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'system-1', scope: 'system', currentVersion: 1 },
      data: expect.objectContaining({ currentVersion: 2 }),
    }));
  });

  it('runs standalone seedOne writes on one transaction client', async () => {
    const transactionFailure = new Error('version insert failed');
    const tx = {
      pageTemplate: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'created-in-transaction' }),
      },
      pageTemplateVersion: {
        create: jest.fn().mockRejectedValue(transactionFailure),
      },
    };
    prisma.$transaction.mockImplementationOnce(async (callback: (client: unknown) => unknown) => callback(tx));

    await expect(service.seedOne(BUILT_IN_PAGE_TEMPLATES[0])).rejects.toBe(transactionFailure);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.pageTemplate.create).toHaveBeenCalledTimes(1);
    expect(tx.pageTemplateVersion.create).toHaveBeenCalledTimes(1);
    expect(pageTemplate.create).not.toHaveBeenCalled();
    expect(pageTemplateVersion.create).not.toHaveBeenCalled();
  });

  it.each([
    ['P2034', new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict', { code: 'P2034', clientVersion: 'test' },
    )],
    ['P2002', new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed', { code: 'P2002', clientVersion: 'test' },
    )],
    ['P2010 SQLSTATE 40001', new Prisma.PrismaClientKnownRequestError(
      'Raw query failed', { code: 'P2010', clientVersion: 'test', meta: { code: '40001' } },
    )],
    ['P2010 serialization failure metadata', new Prisma.PrismaClientKnownRequestError(
      'Raw query failed', {
        code: 'P2010', clientVersion: 'test',
        meta: { message: 'ERROR: serialization failure while committing transaction' },
      },
    )],
  ])('retries seed transactions after confirmed Prisma %s', async (_case, retryable) => {
    pageTemplate.findUnique.mockResolvedValue({ id: 'system-1', scope: 'system', currentVersion: 1 });
    prisma.$transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => {
      await callback(prisma);
      throw retryable;
    });

    await service.seedBuiltIns();

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('stops after the bounded seed transaction retry budget is exhausted', async () => {
    const retryable = new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict', { code: 'P2034', clientVersion: 'test' },
    );
    prisma.$transaction.mockRejectedValue(retryable);

    await expect(service.seedBuiltIns()).rejects.toBe(retryable);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['an ordinary error', new Error('configuration failure')],
    ['an ordinary SQLSTATE message', new Error('transaction aborted with SQLSTATE 40001 serialization_failure')],
    ['a non-Prisma P2034-shaped object', { code: 'P2034', message: 'not a Prisma error' }],
    ['a non-Prisma P2002-shaped object', { code: 'P2002', message: 'not a Prisma error' }],
    ['a non-Prisma SQLSTATE-shaped object', { sqlState: '40001', message: 'not a Prisma error' }],
  ])('does not retry %s during seeding', async (_case, failure) => {
    prisma.$transaction.mockRejectedValue(failure);

    await expect(service.seedBuiltIns()).rejects.toBe(failure);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('seeds only in API and all process roles', async () => {
    const seed = jest.spyOn(service, 'seedBuiltIns').mockResolvedValue(undefined);
    config.get.mockReturnValueOnce('worker');
    await service.onModuleInit();
    expect(seed).not.toHaveBeenCalled();

    config.get.mockReturnValueOnce('all');
    await service.onModuleInit();
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it('returns localized system summaries plus the current Space page', async () => {
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'editor' });
    pageTemplate.findMany.mockResolvedValueOnce([systemRecord]).mockResolvedValueOnce([spaceRecord]);
    pageTemplate.count.mockResolvedValue(1);

    await expect(service.list('space-1', { locale: 'zh-CN', skip: 0, take: 100 }, principal))
      .resolves.toMatchObject({
        system: [expect.objectContaining({ name: '任务清单' })],
        space: [expect.objectContaining({ name: '团队周报' })],
        totalSpace: 1,
        capabilities: { canManage: false },
      });
    expect(authorization.assertSpaceAccess).toHaveBeenCalledWith(
      principal, 'space-1', ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
    );
  });

  it.each([
    ['editor', 'archived'],
    ['viewer', 'all'],
  ] as const)('denies %s archived=%s catalog enumeration before template queries', async (role, archived) => {
    authorization.assertSpaceAccess.mockResolvedValue({ role });

    await expect(service.list('space-1', {
      locale: 'en', scope: 'all', archived, skip: 0, take: 100,
    }, principal)).rejects.toMatchObject({
      businessCode: 'PAGE_TEMPLATE_PERMISSION_DENIED',
      statusCode: 403,
    });

    expect(pageTemplate.findMany).not.toHaveBeenCalled();
    expect(pageTemplate.count).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin'] as const)('allows %s to list archived templates', async (role) => {
    authorization.assertSpaceAccess.mockResolvedValue({ role });
    pageTemplate.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(service.list('space-1', {
      locale: 'en', scope: 'all', archived: 'archived', skip: 0, take: 100,
    }, principal)).resolves.toMatchObject({ capabilities: { canManage: true } });

    expect(pageTemplate.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ archivedAt: { not: null } }),
    }));
  });

  it('lists only lightweight Markdown source summaries with bounded stable pagination', async () => {
    const firstUpdatedAt = new Date('2026-08-25T12:00:00.000Z');
    const secondUpdatedAt = new Date('2026-08-25T11:00:00.000Z');
    page.findMany.mockResolvedValue([
      {
        id: 'page-2', title: 'Second', format: 'markdown', updatedAt: firstUpdatedAt,
        content: '# must not leak', slug: 'must-not-leak',
      },
      { id: 'page-1', title: 'First', format: 'markdown', updatedAt: secondUpdatedAt },
    ]);
    page.count.mockResolvedValue(42);

    await expect(service.listSourcePages(
      'space-1', { skip: 10, take: 25 }, principal,
    )).resolves.toEqual({
      data: [
        { id: 'page-2', title: 'Second', format: 'markdown', updatedAt: firstUpdatedAt.toISOString() },
        { id: 'page-1', title: 'First', format: 'markdown', updatedAt: secondUpdatedAt.toISOString() },
      ],
      total: 42,
      skip: 10,
      take: 25,
    });

    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledWith(
      prisma, principal, 'space-1', ['owner', 'admin'],
    );
    expect(page.findMany).toHaveBeenCalledWith({
      where: { spaceId: 'space-1', deletedAt: null, format: 'markdown' },
      select: { id: true, title: true, format: true, updatedAt: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 25,
    });
    expect(page.count).toHaveBeenCalledWith({
      where: { spaceId: 'space-1', deletedAt: null, format: 'markdown' },
    });
    expect(page.findMany.mock.calls[0]?.[0]?.select).not.toHaveProperty('content');
  });

  it('maps non-live or non-manager source-page access to the template permission error before reads', async () => {
    authorization.assertLiveHumanSpaceAccess.mockRejectedValue(
      new BusinessException('SPACE_ACCESS_DENIED'),
    );

    await expect(service.listSourcePages(
      'space-1', { skip: 0, take: 100 }, principal,
    )).rejects.toMatchObject({
      businessCode: 'PAGE_TEMPLATE_PERMISSION_DENIED',
      statusCode: 403,
    });

    expect(page.findMany).not.toHaveBeenCalled();
    expect(page.count).not.toHaveBeenCalled();
  });

  it('get returns existing requested system content with its requested locale', async () => {
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'owner' });
    pageTemplate.findFirst.mockResolvedValue(systemRecord);
    pageTemplateVersion.findUnique.mockResolvedValue({
      templateId: 'system-1', version: 1,
      contentI18n: { 'zh-CN': '# 任务清单', en: '# Task list' },
      sourcePageId: null,
    });

    await expect(service.get('space-1', 'system-1', 'zh-CN', principal)).resolves.toMatchObject({
      id: 'system-1', name: '任务清单', content: '# 任务清单', contentLocale: 'zh-CN', sourcePageId: null,
    });
  });

  it('denies Viewer detail content with HTTP 403 before a soft-deleted source can be disclosed', async () => {
    authorization.assertSpaceAccess.mockRejectedValue(new BusinessException('SPACE_ACCESS_DENIED'));
    pageTemplate.findFirst.mockResolvedValue(spaceRecord);
    pageTemplateVersion.findUnique.mockResolvedValue({
      templateId: 'space-template', version: 2,
      contentI18n: { 'zh-CN': '# private snapshot' },
      sourcePageId: 'soft-deleted-page',
    });

    await expect(service.get('space-1', 'space-template', 'zh-CN', principal)).rejects.toMatchObject({
      businessCode: 'SPACE_ACCESS_DENIED',
      statusCode: 403,
    });
    expect(authorization.assertSpaceAccess).toHaveBeenCalledWith(
      principal, 'space-1', ['owner', 'admin', 'editor'], 'pages:read',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(pageTemplate.findFirst).not.toHaveBeenCalled();
    expect(pageTemplateVersion.findUnique).not.toHaveBeenCalled();
  });

  it('get falls back missing requested system content to English with locale en', async () => {
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'owner' });
    pageTemplate.findFirst.mockResolvedValue(systemRecord);
    pageTemplateVersion.findUnique.mockResolvedValue({
      templateId: 'system-1', version: 1,
      contentI18n: { en: '# English only' },
      sourcePageId: null,
    });

    await expect(service.get('space-1', 'system-1', 'zh-CN', principal)).resolves.toMatchObject({
      content: '# English only', contentLocale: 'en',
    });
  });

  it('get returns Space content strictly from sourceLocale', async () => {
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'owner' });
    pageTemplate.findFirst.mockResolvedValue(spaceRecord);
    pageTemplateVersion.findUnique.mockResolvedValue({
      templateId: 'space-template', version: 2,
      contentI18n: { 'zh-CN': '# 源语言', en: '# Other language' },
      sourcePageId: 'page-1',
    });

    await expect(service.get('space-1', 'space-template', 'en', principal)).resolves.toMatchObject({
      content: '# 源语言', contentLocale: 'zh-CN',
    });
  });

  it('get rejects Space content missing sourceLocale with a stable code', async () => {
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'owner' });
    pageTemplate.findFirst.mockResolvedValue(spaceRecord);
    pageTemplateVersion.findUnique.mockResolvedValue({
      templateId: 'space-template', version: 2,
      contentI18n: { en: '# Wrong fallback' },
      sourcePageId: 'page-1',
    });

    await expect(service.get('space-1', 'space-template', 'en', principal))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });
  });

  it('resolves the exact requested old version without silently advancing', async () => {
    pageTemplate.findFirst.mockResolvedValue({
      id: 'space-template', scope: 'space', spaceId: 'space-1', sourceLocale: 'zh-CN', archivedAt: null,
      versions: [{ version: 2, contentI18n: { 'zh-CN': '# Version 2' } }],
    });

    await expect(service.resolveVersion(prisma, {
      spaceId: 'space-1', templateId: 'space-template', version: 2, locale: 'en',
    })).resolves.toEqual({
      content: '# Version 2', templateId: 'space-template', version: 2, locale: 'zh-CN',
    });
    expect(pageTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: { versions: { where: { version: 2 }, take: 1 } },
    }));
  });

  it('resolveVersion returns existing requested system content with its requested locale', async () => {
    pageTemplate.findFirst.mockResolvedValue({
      id: 'system-1', scope: 'system', sourceLocale: null, archivedAt: null,
      versions: [{ version: 1, contentI18n: { 'zh-CN': '# 中文', en: '# English' } }],
    });

    await expect(service.resolveVersion(prisma, {
      spaceId: 'space-1', templateId: 'system-1', version: 1, locale: 'zh-CN',
    })).resolves.toEqual({
      content: '# 中文', templateId: 'system-1', version: 1, locale: 'zh-CN',
    });
  });

  it('resolveVersion falls back missing requested system content to English with locale en', async () => {
    pageTemplate.findFirst.mockResolvedValue({
      id: 'system-1', scope: 'system', sourceLocale: null, archivedAt: null,
      versions: [{ version: 1, contentI18n: { en: '# English only' } }],
    });

    await expect(service.resolveVersion(prisma, {
      spaceId: 'space-1', templateId: 'system-1', version: 1, locale: 'zh-CN',
    })).resolves.toEqual({
      content: '# English only', templateId: 'system-1', version: 1, locale: 'en',
    });
  });

  it('resolveVersion rejects Space content missing sourceLocale with a stable code', async () => {
    pageTemplate.findFirst.mockResolvedValue({
      id: 'space-template', scope: 'space', spaceId: 'space-1', sourceLocale: 'zh-CN', archivedAt: null,
      versions: [{ version: 2, contentI18n: { en: '# Wrong fallback' } }],
    });

    await expect(service.resolveVersion(prisma, {
      spaceId: 'space-1', templateId: 'space-template', version: 2, locale: 'en',
    })).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });
  });

  it('rejects cross-Space, archived, and missing versions with stable codes', async () => {
    pageTemplate.findFirst.mockResolvedValueOnce(null);
    await expect(service.resolveVersion(prisma, {
      spaceId: 'space-2', templateId: 'space-template', version: 1, locale: 'en',
    })).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_NOT_FOUND' });

    pageTemplate.findFirst.mockResolvedValueOnce({
      id: 'space-template', scope: 'space', spaceId: 'space-1', sourceLocale: 'zh-CN',
      archivedAt: new Date(), versions: [{ version: 1, contentI18n: { 'zh-CN': '# Archived' } }],
    });
    await expect(service.resolveVersion(prisma, {
      spaceId: 'space-1', templateId: 'space-template', version: 1, locale: 'en',
    })).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_ARCHIVED' });

    pageTemplate.findFirst.mockResolvedValueOnce({
      id: 'space-template', scope: 'space', spaceId: 'space-1', sourceLocale: 'zh-CN',
      archivedAt: null, versions: [],
    });
    await expect(service.resolveVersion(prisma, {
      spaceId: 'space-1', templateId: 'space-template', version: 1, locale: 'en',
    })).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_VERSION_NOT_FOUND' });
  });

  it('rejects malformed localized JSON before returning it', async () => {
    pageTemplate.findFirst.mockResolvedValue({
      id: 'system-1', scope: 'system', archivedAt: null,
      versions: [{ version: 1, contentI18n: { fr: '# Invalide' } }],
    });

    await expect(service.resolveVersion(prisma, {
      spaceId: 'space-1', templateId: 'system-1', version: 1, locale: 'en',
    })).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });
  });

  it('creates a Space template only from the exact persisted Markdown page', async () => {
    const created = spaceTemplate({
      currentVersion: 1,
      updatedAt: new Date(templateTimestamp),
    });
    pageTemplate.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(created);
    pageTemplate.create.mockResolvedValue(created);
    pageTemplateVersion.findUnique.mockResolvedValue({
      templateId: 'template-1', version: 1,
      contentI18n: { en: '# Team weekly' }, sourcePageId: 'page-1',
    });

    await service.createSpaceTemplate('space-1', validCreateBody, principal);

    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledWith(
      prisma, principal, 'space-1', ['owner', 'admin'],
    );
    expect(page.findFirst).toHaveBeenCalledWith({
      where: { id: 'page-1', spaceId: 'space-1', deletedAt: null },
      select: { id: true, content: true, format: true, updatedAt: true, deletedAt: true },
    });
    expect(pageTemplate.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      scope: 'space', scopeKey: 'space-1', nameKey: 'team weekly', sourceLocale: 'en',
    }) }));
    expect(pageTemplateVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      version: 1, contentI18n: { en: '# Team weekly' }, sourcePageId: 'page-1',
    }) }));
  });

  it('accepts source content at the page DTO validator.js astral-character limit', async () => {
    const content = '😀'.repeat(200_000);
    const created = spaceTemplate({
      currentVersion: 1,
      updatedAt: new Date(templateTimestamp),
    });
    page.findFirst.mockResolvedValue(markdownPage({ content }));
    pageTemplate.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(created);
    pageTemplate.create.mockResolvedValue(created);
    pageTemplateVersion.findUnique.mockResolvedValue({
      templateId: 'template-1', version: 1,
      contentI18n: { en: content }, sourcePageId: 'page-1',
    });

    await expect(service.createSpaceTemplate('space-1', validCreateBody, principal))
      .resolves.toMatchObject({ content });
    expect(pageTemplateVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ contentI18n: { en: content } }),
    }));
  });

  it.each([
    [{ format: 'html' }, 'PAGE_TEMPLATE_SOURCE_INVALID'],
    [{ deletedAt: new Date() }, 'PAGE_TEMPLATE_SOURCE_INVALID'],
    [{ content: 'x'.repeat(200_001) }, 'PAGE_TEMPLATE_SOURCE_INVALID'],
    [{ updatedAt: new Date('2026-08-25T11:00:00.000Z') }, 'PAGE_TEMPLATE_SOURCE_STALE'],
  ])('rejects invalid or stale source pages %#', async (override, code) => {
    page.findFirst.mockResolvedValue(markdownPage(override));

    await expect(service.createSpaceTemplate('space-1', validCreateBody, principal))
      .rejects.toMatchObject({ businessCode: code });
    expect(pageTemplate.create).not.toHaveBeenCalled();
  });

  it('rejects missing source pages as invalid', async () => {
    page.findFirst.mockResolvedValue(null);

    await expect(service.createSpaceTemplate('space-1', validCreateBody, principal))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_SOURCE_INVALID' });
  });

  it('enforces the active Space-template quota on create', async () => {
    pageTemplate.count.mockResolvedValue(100);

    await expect(service.createSpaceTemplate('space-1', validCreateBody, principal))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_QUOTA_EXCEEDED' });
    expect(page.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an existing normalized Space-template name', async () => {
    pageTemplate.findUnique.mockResolvedValue({ id: 'existing-template' });

    await expect(service.createSpaceTemplate('space-1', validCreateBody, principal))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_NAME_CONFLICT' });
    expect(pageTemplate.create).not.toHaveBeenCalled();
  });

  it('maps a concurrent create name constraint P2002 to a stable conflict', async () => {
    pageTemplate.findUnique.mockResolvedValue(null);
    pageTemplate.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed', {
        code: 'P2002', clientVersion: 'test', meta: { target: ['spaceId', 'nameKey'] },
      },
    ));

    await expect(service.createSpaceTemplate('space-1', validCreateBody, principal))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_NAME_CONFLICT' });
  });

  it('uses one bounded candidate read and a fallback after all 100 compatible keys are occupied', async () => {
    const compatibleStableKeys = [
      'team-weekly',
      ...Array.from({ length: 99 }, (_, index) => `team-weekly-${index + 2}`),
    ];
    let createdRecord: any;
    pageTemplate.findMany.mockResolvedValue(compatibleStableKeys.map((stableKey) => ({ stableKey })));
    pageTemplate.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.spaceId_nameKey) return null;
      if (where.id === createdRecord?.id) return createdRecord;
      return null;
    });
    pageTemplate.create.mockImplementation(async ({ data }: any) => {
      createdRecord = {
        id: `created-${data.stableKey}`,
        ...data,
        archivedAt: null,
        updatedAt: new Date(templateTimestamp),
      };
      return createdRecord;
    });
    pageTemplateVersion.findUnique.mockResolvedValue({
      templateId: 'created-fallback', version: 1,
      contentI18n: { en: '# Team weekly' }, sourcePageId: 'page-1',
    });

    await service.createSpaceTemplate('space-1', validCreateBody, principal);

    expect(pageTemplate.findMany).toHaveBeenCalledWith({
      where: {
        scopeKey: 'space-1',
        stableKey: { in: compatibleStableKeys },
      },
      select: { stableKey: true },
      take: 100,
    });
    const stableKey = pageTemplate.create.mock.calls[0][0].data.stableKey;
    expect(stableKey).toMatch(/^team-weekly-[0-9a-f]{32}$/u);
    expect(stableKey.length).toBeLessThanOrEqual(64);
  });

  it('keeps a 64-character base bounded and changes its high-entropy fallback on P2002 retry', async () => {
    const stableKeyConflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed', {
        code: 'P2002', clientVersion: 'test',
        meta: { target: 'PageTemplate_scopeKey_stableKey_key' },
      },
    );
    const base = 'a'.repeat(64);
    const compatibleStableKeys = [
      base,
      ...Array.from({ length: 99 }, (_, index) => {
        const suffix = `-${index + 2}`;
        return `${base.slice(0, 64 - suffix.length)}${suffix}`;
      }),
    ];
    let createdRecord: any;
    pageTemplate.findMany.mockResolvedValue(compatibleStableKeys.map((stableKey) => ({ stableKey })));
    pageTemplate.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.spaceId_nameKey) return null;
      if (where.id === createdRecord?.id) return createdRecord;
      return null;
    });
    pageTemplate.create
      .mockRejectedValueOnce(stableKeyConflict)
      .mockImplementationOnce(async ({ data }: any) => {
        createdRecord = {
          id: 'created-fallback', ...data, archivedAt: null,
          updatedAt: new Date(templateTimestamp),
        };
        return createdRecord;
      });
    pageTemplateVersion.findUnique.mockResolvedValue({
      templateId: 'created-fallback', version: 1,
      contentI18n: { en: '# Team weekly' }, sourcePageId: 'page-1',
    });

    await service.createSpaceTemplate('space-1', {
      ...validCreateBody, name: base,
    }, principal);

    const attemptedKeys = pageTemplate.create.mock.calls.map(([input]) => input.data.stableKey);
    expect(attemptedKeys).toHaveLength(2);
    expect(attemptedKeys[0]).not.toBe(attemptedKeys[1]);
    for (const stableKey of attemptedKeys) {
      expect(stableKey).toHaveLength(64);
      expect(stableKey).toMatch(/-[0-9a-f]{32}$/u);
    }
    expect(pageTemplate.findMany).toHaveBeenCalledTimes(2);
    expect(pageTemplate.findMany).toHaveBeenNthCalledWith(1, {
      where: { scopeKey: 'space-1', stableKey: { in: compatibleStableKeys } },
      select: { stableKey: true },
      take: 100,
    });
  });

  it('allocates base, numeric suffix, and entropy fallback by Unicode code points', async () => {
    const supplementaryLetter = '\u{20000}';
    const truncateCodePoints = (value: string, length: number) => (
      Array.from(value).slice(0, length).join('')
    );
    const baseName = `${'a'.repeat(63)}${supplementaryLetter}`;
    const numericName = `${'b'.repeat(61)}${supplementaryLetter}`;
    const entropyName = `${'c'.repeat(30)}${supplementaryLetter}${'d'.repeat(20)}`;
    const entropyCompatibleKeys = [
      entropyName,
      ...Array.from({ length: 99 }, (_, index) => {
        const suffix = `-${index + 2}`;
        return `${truncateCodePoints(entropyName, 64 - suffix.length)}${suffix}`;
      }),
    ];
    let createdRecord: any;
    pageTemplate.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.spaceId_nameKey) return null;
      if (where.id === createdRecord?.id) return createdRecord;
      return null;
    });
    pageTemplate.create.mockImplementation(async ({ data }: any) => {
      createdRecord = {
        id: `created-${pageTemplate.create.mock.calls.length}`,
        ...data,
        archivedAt: null,
        updatedAt: new Date(templateTimestamp),
      };
      return createdRecord;
    });
    pageTemplateVersion.findUnique.mockImplementation(async ({ where }: any) => ({
      templateId: where.templateId_version.templateId,
      version: 1,
      contentI18n: { en: '# Team weekly' },
      sourcePageId: 'page-1',
    }));
    pageTemplate.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ stableKey: numericName }])
      .mockResolvedValueOnce(entropyCompatibleKeys.map((stableKey) => ({ stableKey })));

    for (const name of [baseName, numericName, entropyName]) {
      await service.createSpaceTemplate('space-1', { ...validCreateBody, name }, principal);
    }

    const stableKeys = pageTemplate.create.mock.calls.map(([input]) => input.data.stableKey as string);
    expect(stableKeys[0]).toBe(baseName);
    expect(stableKeys[1]).toBe(`${numericName}-2`);
    expect(stableKeys[2]).toMatch(
      new RegExp(`^${'c'.repeat(30)}${supplementaryLetter}-[0-9a-f]{32}$`, 'u'),
    );
    for (const stableKey of stableKeys) {
      expect(Array.from(stableKey)).toHaveLength(64);
      expect(Array.from(stableKey).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint >= 0xd800 && codePoint <= 0xdfff;
      })).toBe(false);
    }
  });

  it('updates metadata only at the exact expected timestamp and source locale', async () => {
    const current = spaceTemplate();
    pageTemplate.findFirst.mockResolvedValueOnce(current).mockResolvedValueOnce(null);
    pageTemplate.findUnique.mockResolvedValue(current);
    pageTemplateVersion.findUnique.mockResolvedValue({
      templateId: 'template-1', version: 3,
      contentI18n: { en: '# Current' }, sourcePageId: 'page-1',
    });

    await service.updateMetadata('space-1', 'template-1', {
      name: ' Weekly Report ', description: ' Updated ', category: 'reporting',
      defaultTitle: ' Weekly report ', expectedUpdatedAt: templateTimestamp,
    }, principal);

    expect(pageTemplate.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'template-1', spaceId: 'space-1', scope: 'space', archivedAt: null,
        updatedAt: new Date(templateTimestamp),
      },
      data: {
        nameI18n: { en: 'Weekly Report' }, nameKey: 'weekly report',
        descriptionI18n: { en: 'Updated' }, defaultTitleI18n: { en: 'Weekly report' },
        category: 'reporting', updatedById: 'user-1',
      },
    });
  });

  it('rejects archived templates before duplicate-name lookup or metadata writes', async () => {
    pageTemplate.findFirst.mockResolvedValue(spaceTemplate({
      archivedAt: new Date('2026-08-25T12:00:00.000Z'),
    }));

    await expect(service.updateMetadata('space-1', 'template-1', {
      name: 'Weekly Report', category: 'reporting', defaultTitle: 'Weekly report',
      expectedUpdatedAt: templateTimestamp,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_ARCHIVED' });
    expect(pageTemplate.findFirst).toHaveBeenCalledTimes(1);
    expect(pageTemplate.updateMany).not.toHaveBeenCalled();
  });

  it('maps an update timestamp miss to a version conflict', async () => {
    pageTemplate.findFirst.mockResolvedValueOnce(spaceTemplate()).mockResolvedValueOnce(null);
    pageTemplate.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.updateMetadata('space-1', 'template-1', {
      name: 'Weekly Report', category: 'reporting', defaultTitle: 'Weekly report',
      expectedUpdatedAt: templateTimestamp,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_VERSION_CONFLICT' });
  });

  it('maps a concurrent metadata name constraint P2002 to a stable conflict', async () => {
    pageTemplate.findFirst.mockResolvedValueOnce(spaceTemplate()).mockResolvedValueOnce(null);
    pageTemplate.updateMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed', {
        code: 'P2002', clientVersion: 'test',
        meta: { target: 'PageTemplate_spaceId_nameKey_key' },
      },
    ));

    await expect(service.updateMetadata('space-1', 'template-1', {
      name: 'Weekly Report', category: 'reporting', defaultTitle: 'Weekly report',
      expectedUpdatedAt: templateTimestamp,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_NAME_CONFLICT' });
  });

  it('returns the current version without writing when source content is unchanged', async () => {
    const current = spaceTemplate({ currentVersion: 3, sourceLocale: 'en' });
    pageTemplate.findFirst.mockResolvedValue(current);
    pageTemplate.findUnique.mockResolvedValue(current);
    pageTemplateVersion.findUnique
      .mockResolvedValueOnce({ version: 3, contentHash: templateContentHash('# Same') })
      .mockResolvedValueOnce({
        version: 3, contentHash: templateContentHash('# Same'),
        contentI18n: { en: '# Same' }, sourcePageId: 'page-1',
      });
    page.findFirst.mockResolvedValue(markdownPage({ content: '# Same' }));

    await expect(service.createVersion('space-1', 'template-1', {
      sourcePageId: 'page-1', expectedSourceUpdatedAt: sourceTimestamp, expectedCurrentVersion: 3,
    }, principal)).resolves.toMatchObject({ currentVersion: 3, noChange: true, content: '# Same' });
    expect(pageTemplateVersion.create).not.toHaveBeenCalled();
    expect(pageTemplate.updateMany).not.toHaveBeenCalled();
  });

  it('keeps managed Space content strict to sourceLocale', async () => {
    const current = spaceTemplate({ currentVersion: 3, sourceLocale: 'zh-CN' });
    pageTemplate.findFirst.mockResolvedValue(current);
    pageTemplate.findUnique.mockResolvedValue(current);
    pageTemplateVersion.findUnique
      .mockResolvedValueOnce({ version: 3, contentHash: templateContentHash('# 相同') })
      .mockResolvedValueOnce({ version: 3, contentI18n: { en: '# Wrong fallback' }, sourcePageId: 'page-1' });
    page.findFirst.mockResolvedValue(markdownPage({ content: '# 相同' }));

    await expect(service.createVersion('space-1', 'template-1', {
      sourcePageId: 'page-1', expectedSourceUpdatedAt: sourceTimestamp, expectedCurrentVersion: 3,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });
  });

  it.each([
    ['the same hash', '# Same', templateContentHash('# Same')],
    ['a different hash', '# New', templateContentHash('# Old')],
  ])('rejects archived templates before source/hash work for %s', async (_case, content, previousHash) => {
    pageTemplate.findFirst.mockResolvedValue(spaceTemplate({
      currentVersion: 3,
      archivedAt: new Date('2026-08-25T12:00:00.000Z'),
    }));
    page.findFirst.mockResolvedValue(markdownPage({ content }));
    pageTemplateVersion.findUnique.mockResolvedValue({ version: 3, contentHash: previousHash });

    await expect(service.createVersion('space-1', 'template-1', {
      sourcePageId: 'page-1', expectedSourceUpdatedAt: sourceTimestamp, expectedCurrentVersion: 3,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_ARCHIVED' });
    expect(page.findFirst).not.toHaveBeenCalled();
    expect(pageTemplateVersion.findUnique).not.toHaveBeenCalled();
    expect(pageTemplateVersion.create).not.toHaveBeenCalled();
    expect(pageTemplate.updateMany).not.toHaveBeenCalled();
  });

  it('creates version N+1 and advances the pointer only from expected N', async () => {
    const current = spaceTemplate({ currentVersion: 3 });
    pageTemplate.findFirst.mockResolvedValue(current);
    pageTemplate.findUnique.mockResolvedValue({ ...current, currentVersion: 4 });
    pageTemplateVersion.findUnique
      .mockResolvedValueOnce({ version: 3, contentHash: 'old' })
      .mockResolvedValueOnce({ version: 4, contentI18n: { en: '# New' }, sourcePageId: 'page-1' });
    page.findFirst.mockResolvedValue(markdownPage({ content: '# New' }));

    await service.createVersion('space-1', 'template-1', {
      sourcePageId: 'page-1', expectedSourceUpdatedAt: sourceTimestamp, expectedCurrentVersion: 3,
    }, principal);

    expect(pageTemplateVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ version: 4, contentI18n: { en: '# New' } }),
    }));
    expect(pageTemplate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'template-1', currentVersion: 3, archivedAt: null }),
      data: expect.objectContaining({ currentVersion: 4 }),
    }));
  });

  it('rejects a stale expected current version before loading the source page', async () => {
    pageTemplate.findFirst.mockResolvedValue(spaceTemplate({ currentVersion: 4 }));

    await expect(service.createVersion('space-1', 'template-1', {
      sourcePageId: 'page-1', expectedSourceUpdatedAt: sourceTimestamp, expectedCurrentVersion: 3,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_VERSION_CONFLICT' });
    expect(page.findFirst).not.toHaveBeenCalled();
  });

  it('maps a failed version pointer compare-and-swap to a version conflict', async () => {
    pageTemplate.findFirst.mockResolvedValue(spaceTemplate({ currentVersion: 3 }));
    pageTemplateVersion.findUnique.mockResolvedValue({ version: 3, contentHash: 'old' });
    page.findFirst.mockResolvedValue(markdownPage({ content: '# New' }));
    pageTemplate.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.createVersion('space-1', 'template-1', {
      sourcePageId: 'page-1', expectedSourceUpdatedAt: sourceTimestamp, expectedCurrentVersion: 3,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_VERSION_CONFLICT' });
  });

  it('archives only an active template at the exact expected timestamp', async () => {
    const current = spaceTemplate();
    pageTemplate.findFirst.mockResolvedValue(current);
    pageTemplate.findUnique.mockResolvedValue({ ...current, archivedAt: new Date('2026-08-25T12:00:00.000Z') });
    pageTemplateVersion.findUnique.mockResolvedValue({ version: 3, contentI18n: { en: '# Current' }, sourcePageId: 'page-1' });

    await service.archive('space-1', 'template-1', { expectedUpdatedAt: templateTimestamp }, principal);

    expect(pageTemplate.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'template-1', spaceId: 'space-1', scope: 'space', archivedAt: null,
        updatedAt: new Date(templateTimestamp),
      },
      data: { archivedAt: expect.any(Date), updatedById: 'user-1' },
    });
  });

  it('restores an archived template only below quota and at the expected timestamp', async () => {
    const archived = spaceTemplate({ archivedAt: new Date('2026-08-25T12:00:00.000Z') });
    pageTemplate.findFirst.mockResolvedValue(archived);
    pageTemplate.findUnique.mockResolvedValue({ ...archived, archivedAt: null });
    pageTemplateVersion.findUnique.mockResolvedValue({ version: 3, contentI18n: { en: '# Current' }, sourcePageId: 'page-1' });

    await service.restore('space-1', 'template-1', { expectedUpdatedAt: templateTimestamp }, principal);

    expect(pageTemplate.count).toHaveBeenCalledWith({
      where: { spaceId: 'space-1', scope: 'space', archivedAt: null },
    });
    expect(pageTemplate.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'template-1', spaceId: 'space-1', scope: 'space', archivedAt: { not: null },
        updatedAt: new Date(templateTimestamp),
      },
      data: { archivedAt: null, updatedById: 'user-1' },
    });
  });

  it('rejects restore when the active Space-template quota is full', async () => {
    pageTemplate.findFirst.mockResolvedValue(spaceTemplate({ archivedAt: new Date() }));
    pageTemplate.count.mockResolvedValue(100);

    await expect(service.restore('space-1', 'template-1', {
      expectedUpdatedAt: templateTimestamp,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_QUOTA_EXCEEDED' });
    expect(pageTemplate.updateMany).not.toHaveBeenCalled();
  });

  it.each(['updateMetadata', 'createVersion', 'archive', 'restore'] as const)(
    'rejects system template mutation through %s', async (method) => {
      pageTemplate.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'system-1' });
      const bodies = {
        updateMetadata: {
          name: 'System', category: 'planning' as const, defaultTitle: 'System',
          expectedUpdatedAt: templateTimestamp,
        },
        createVersion: {
          sourcePageId: 'page-1', expectedSourceUpdatedAt: sourceTimestamp, expectedCurrentVersion: 1,
        },
        archive: { expectedUpdatedAt: templateTimestamp },
        restore: { expectedUpdatedAt: templateTimestamp },
      };

      await expect((service[method] as any)('space-1', 'system-1', bodies[method], principal))
        .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_SYSTEM_IMMUTABLE' });
    },
  );

  it('requires live Owner/Admin authorization for every mutation', async () => {
    authorization.assertLiveHumanSpaceAccess.mockRejectedValue(
      new BusinessException('SPACE_ACCESS_DENIED'),
    );
    const mutations = [
      () => service.createSpaceTemplate('space-1', validCreateBody, principal),
      () => service.updateMetadata('space-1', 'template-1', {
        name: 'Weekly', category: 'reporting', defaultTitle: 'Weekly', expectedUpdatedAt: templateTimestamp,
      }, principal),
      () => service.createVersion('space-1', 'template-1', {
        sourcePageId: 'page-1', expectedSourceUpdatedAt: sourceTimestamp, expectedCurrentVersion: 3,
      }, principal),
      () => service.archive('space-1', 'template-1', { expectedUpdatedAt: templateTimestamp }, principal),
      () => service.restore('space-1', 'template-1', { expectedUpdatedAt: templateTimestamp }, principal),
    ];

    for (const mutate of mutations) {
      await expect(mutate()).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_PERMISSION_DENIED' });
    }
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledTimes(5);
    expect(revisionWriter.lockSpace).toHaveBeenCalledTimes(5);
    expect(prisma.$transaction).toHaveBeenCalledTimes(5);
    for (const call of prisma.$transaction.mock.calls as any[][]) {
      expect(call[1]).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    }
    revisionWriter.lockSpace.mock.invocationCallOrder.forEach((lockOrder: number, index: number) => {
      expect(lockOrder).toBeLessThan(
        authorization.assertLiveHumanSpaceAccess.mock.invocationCallOrder[index],
      );
    });
    expect(pageTemplate.create).not.toHaveBeenCalled();
    expect(pageTemplate.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      'Prisma P2034',
      new Prisma.PrismaClientKnownRequestError(
        'Transaction failed due to a write conflict', { code: 'P2034', clientVersion: 'test' },
      ),
    ],
    [
      'Prisma P2010 SQLSTATE 40001',
      new Prisma.PrismaClientKnownRequestError(
        'Raw query failed', { code: 'P2010', clientVersion: 'test', meta: { code: '40001' } },
      ),
    ],
    [
      'Prisma P2010 serialization failure metadata',
      new Prisma.PrismaClientKnownRequestError(
        'Raw query failed', {
          code: 'P2010', clientVersion: 'test',
          meta: { message: 'ERROR: serialization failure while committing transaction' },
        },
      ),
    ],
  ])('retries the complete mutation after %s', async (_case, retryable) => {
    const current = spaceTemplate();
    pageTemplate.findFirst.mockResolvedValue(current);
    pageTemplate.findUnique.mockResolvedValue({ ...current, archivedAt: new Date() });
    pageTemplateVersion.findUnique.mockResolvedValue({
      version: 3, contentI18n: { en: '# Current' }, sourcePageId: 'page-1',
    });
    prisma.$transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => {
      await callback(prisma);
      throw retryable;
    });

    await service.archive(
      'space-1', 'template-1', { expectedUpdatedAt: templateTimestamp }, principal,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledTimes(2);
    expect(pageTemplate.findFirst).toHaveBeenCalledTimes(2);
    expect(pageTemplate.updateMany).toHaveBeenCalledTimes(2);
  });

  it('maps exhausted transaction retries to a stable version conflict and reauthorizes each time', async () => {
    const retryable = new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict', { code: 'P2034', clientVersion: 'test' },
    );
    const current = spaceTemplate();
    pageTemplate.findFirst.mockResolvedValue(current);
    pageTemplate.findUnique.mockResolvedValue({ ...current, archivedAt: new Date() });
    pageTemplateVersion.findUnique.mockResolvedValue({
      version: 3, contentI18n: { en: '# Current' }, sourcePageId: 'page-1',
    });
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
      await callback(prisma);
      throw retryable;
    });

    await expect(service.archive(
      'space-1', 'template-1', { expectedUpdatedAt: templateTimestamp }, principal,
    )).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_VERSION_CONFLICT' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledTimes(3);
    expect(pageTemplate.updateMany).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['an ordinary error', new Error('database unavailable')],
    ['a non-Prisma P2034-shaped object', { code: 'P2034', message: 'not a Prisma error' }],
  ])('does not retry %s', async (_case, failure) => {
    const current = spaceTemplate();
    pageTemplate.findFirst.mockResolvedValue(current);
    pageTemplate.findUnique.mockResolvedValue({ ...current, archivedAt: new Date() });
    pageTemplateVersion.findUnique.mockResolvedValue({
      version: 3, contentI18n: { en: '# Current' }, sourcePageId: 'page-1',
    });
    prisma.$transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => {
      await callback(prisma);
      throw failure;
    });

    await expect(service.archive(
      'space-1', 'template-1', { expectedUpdatedAt: templateTimestamp }, principal,
    )).rejects.toBe(failure);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledTimes(1);
  });

  it('reruns create quota after a retryable conflict', async () => {
    const retryable = new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict', { code: 'P2034', clientVersion: 'test' },
    );
    pageTemplate.count.mockResolvedValueOnce(0).mockResolvedValueOnce(100);
    pageTemplate.findUnique.mockResolvedValue(null);
    pageTemplate.create.mockRejectedValueOnce(retryable);

    await expect(service.createSpaceTemplate('space-1', validCreateBody, principal))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_QUOTA_EXCEEDED' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledTimes(2);
    expect(pageTemplate.count).toHaveBeenCalledTimes(2);
    expect(pageTemplate.findUnique).toHaveBeenCalledTimes(1);
    expect(pageTemplate.create).toHaveBeenCalledTimes(1);
  });

  it('reruns restore quota reads after a retryable commit conflict', async () => {
    const retryable = new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict', { code: 'P2034', clientVersion: 'test' },
    );
    const archived = spaceTemplate({ archivedAt: new Date('2026-08-25T12:00:00.000Z') });
    pageTemplate.findFirst.mockResolvedValue(archived);
    pageTemplate.findUnique.mockResolvedValue({ ...archived, archivedAt: null });
    pageTemplateVersion.findUnique.mockResolvedValue({
      version: 3, contentI18n: { en: '# Current' }, sourcePageId: 'page-1',
    });
    pageTemplate.count.mockResolvedValueOnce(0).mockResolvedValueOnce(100);
    prisma.$transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => {
      await callback(prisma);
      throw retryable;
    });

    await expect(service.restore(
      'space-1', 'template-1', { expectedUpdatedAt: templateTimestamp }, principal,
    )).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_QUOTA_EXCEEDED' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledTimes(2);
    expect(pageTemplate.count).toHaveBeenCalledTimes(2);
    expect(pageTemplate.updateMany).toHaveBeenCalledTimes(1);
  });

  it('retries a stable-key P2002 and allocates -2 for a different colliding nameKey', async () => {
    const stableKeyConflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed', {
        code: 'P2002', clientVersion: 'test',
        meta: { target: 'PageTemplate_scopeKey_stableKey_key' },
      },
    );
    const created = spaceTemplate({
      currentVersion: 1,
      stableKey: 'team-weekly-2',
      nameI18n: { en: 'Team---Weekly' },
      updatedAt: new Date(templateTimestamp),
    });
    let nameLookups = 0;
    pageTemplate.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.spaceId_nameKey) {
        nameLookups += 1;
        return null;
      }
      if (where.id === 'template-1') return created;
      return null;
    });
    pageTemplate.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ stableKey: 'team-weekly' }]);
    pageTemplate.create
      .mockRejectedValueOnce(stableKeyConflict)
      .mockResolvedValueOnce(created);
    pageTemplateVersion.findUnique.mockResolvedValue({
      templateId: 'template-1', version: 1,
      contentI18n: { en: '# Team weekly' }, sourcePageId: 'page-1',
    });

    await service.createSpaceTemplate('space-1', {
      ...validCreateBody,
      name: 'Team---Weekly',
    }, principal);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledTimes(2);
    expect(nameLookups).toBe(2);
    expect(pageTemplate.create).toHaveBeenCalledTimes(2);
    expect(pageTemplate.create).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ nameKey: 'team---weekly', stableKey: 'team-weekly-2' }),
    }));
  });

  it('maps exhausted stable-key P2002 retries to a version conflict', async () => {
    const stableKeyConflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed', {
        code: 'P2002', clientVersion: 'test',
        meta: { target: ['scopeKey', 'stableKey'] },
      },
    );
    pageTemplate.findUnique.mockResolvedValue(null);
    pageTemplate.create.mockRejectedValue(stableKeyConflict);

    await expect(service.createSpaceTemplate('space-1', validCreateBody, principal))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_VERSION_CONFLICT' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledTimes(3);
    expect(pageTemplate.create).toHaveBeenCalledTimes(3);
  });

  it('maps template-version P2002 to a version conflict', async () => {
    const versionConflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed', {
        code: 'P2002', clientVersion: 'test',
        meta: { constraint: 'PageTemplateVersion_templateId_version_key' },
      },
    );
    pageTemplate.findFirst.mockResolvedValue(spaceTemplate({ currentVersion: 3 }));
    pageTemplateVersion.findUnique.mockResolvedValue({ version: 3, contentHash: 'old' });
    page.findFirst.mockResolvedValue(markdownPage({ content: '# New' }));
    pageTemplateVersion.create.mockRejectedValue(versionConflict);

    await expect(service.createVersion('space-1', 'template-1', {
      sourcePageId: 'page-1', expectedSourceUpdatedAt: sourceTimestamp, expectedCurrentVersion: 3,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_VERSION_CONFLICT' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(pageTemplate.updateMany).not.toHaveBeenCalled();
  });

  it('rethrows an unknown P2002 target without reclassification or retry', async () => {
    const unknownConflict = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed', {
        code: 'P2002', clientVersion: 'test', meta: { target: ['otherField'] },
      },
    );
    pageTemplate.findUnique.mockResolvedValue(null);
    pageTemplate.create.mockRejectedValue(unknownConflict);

    await expect(service.createSpaceTemplate('space-1', validCreateBody, principal))
      .rejects.toBe(unknownConflict);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledTimes(1);
  });

  it.each(['name', 'defaultTitle'] as const)(
    'rejects whitespace-only create %s after normalization', async (field) => {
      await expect(service.createSpaceTemplate('space-1', {
        ...validCreateBody,
        [field]: ' \t\n ',
      }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });
      expect(page.findFirst).not.toHaveBeenCalled();
      expect(pageTemplate.create).not.toHaveBeenCalled();
      expect(pageTemplateVersion.create).not.toHaveBeenCalled();
    },
  );

  it.each(['name', 'defaultTitle'] as const)(
    'rejects whitespace-only metadata %s after normalization', async (field) => {
      pageTemplate.findFirst.mockResolvedValue(spaceTemplate());

      await expect(service.updateMetadata('space-1', 'template-1', {
        name: 'Weekly', category: 'reporting', defaultTitle: 'Weekly',
        expectedUpdatedAt: templateTimestamp, [field]: ' \t\n ',
      }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });
      expect(pageTemplate.updateMany).not.toHaveBeenCalled();
    },
  );
});
