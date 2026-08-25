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
  const page = { findFirst: jest.fn() };
  const prisma = {
    pageTemplate,
    pageTemplateVersion,
    page,
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
  } as any;
  const authorization = {
    assertSpaceAccess: jest.fn(),
    assertLiveHumanSpaceAccess: jest.fn(),
  } as any;
  const config = { get: jest.fn().mockReturnValue('api') } as any;
  let service: PageTemplateService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(prisma));
    prisma.$queryRaw.mockResolvedValue([]);
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
    authorization.assertLiveHumanSpaceAccess.mockResolvedValue({ role: 'owner' });
    service = new PageTemplateService(prisma, authorization, config);
  });

  it('seeds a new system template and version atomically', async () => {
    pageTemplate.findUnique.mockResolvedValue(null);

    await service.seedBuiltIns();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function), { isolationLevel: 'Serializable' },
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
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

  it.each(['P2034', 'P2002'])('retries seed transactions after Prisma %s', async (code) => {
    const retryable = Object.assign(new Error(`Prisma ${code}`), { code });
    pageTemplate.findUnique.mockResolvedValue({ id: 'system-1', scope: 'system', currentVersion: 1 });
    prisma.$transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => {
      await callback(prisma);
      throw retryable;
    });

    await service.seedBuiltIns();

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('retries seed transactions after an identifiable SQLSTATE 40001', async () => {
    const retryable = new Error('transaction aborted with SQLSTATE 40001 serialization_failure');
    pageTemplate.findUnique.mockResolvedValue({ id: 'system-1', scope: 'system', currentVersion: 1 });
    prisma.$transaction.mockRejectedValueOnce(retryable);

    await service.seedBuiltIns();

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('stops after the bounded seed transaction retry budget is exhausted', async () => {
    const retryable = Object.assign(new Error('serialization conflict'), { code: 'P2034' });
    prisma.$transaction.mockRejectedValue(retryable);

    await expect(service.seedBuiltIns()).rejects.toBe(retryable);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable seed transaction failures', async () => {
    const failure = new Error('configuration failure');
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
      'Unique constraint failed', { code: 'P2002', clientVersion: 'test' },
    ));

    await expect(service.createSpaceTemplate('space-1', validCreateBody, principal))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_NAME_CONFLICT' });
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
        id: 'template-1', spaceId: 'space-1', scope: 'space',
        updatedAt: new Date(templateTimestamp),
      },
      data: {
        nameI18n: { en: 'Weekly Report' }, nameKey: 'weekly report',
        descriptionI18n: { en: 'Updated' }, defaultTitleI18n: { en: 'Weekly report' },
        category: 'reporting', updatedById: 'user-1',
      },
    });
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
      'Unique constraint failed', { code: 'P2002', clientVersion: 'test' },
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
    expect(pageTemplate.create).not.toHaveBeenCalled();
    expect(pageTemplate.updateMany).not.toHaveBeenCalled();
  });
});
