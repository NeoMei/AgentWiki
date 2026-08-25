import type { Principal } from '../core/authorization/authorization.service';
import { BUILT_IN_PAGE_TEMPLATES } from './page-template-definitions';
import { PageTemplateService } from './page-template.service';

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
  const prisma = {
    pageTemplate,
    pageTemplateVersion,
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
  } as any;
  const authorization = { assertSpaceAccess: jest.fn() } as any;
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
});
