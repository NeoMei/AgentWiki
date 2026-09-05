import type { CompositeTemplateDefinition } from '@neomei/agentwiki-sync-protocol';
import { Prisma } from '@prisma/client';
import type { Principal } from '../core/authorization/authorization.service';
import { CompositeTemplateCatalogService } from './composite-template-catalog.service';
import { hashCompositeDefinition } from './composite-template-validator';

const principal: Principal = { userId: 'user-1' };
const definition: CompositeTemplateDefinition = {
  schemaVersion: 1,
  kind: 'page_group',
  nodes: [
    { nodeId: 'root', parentNodeId: null, kind: 'folder', order: 0, nameI18n: { en: 'Root' } },
    {
      nodeId: 'page', parentNodeId: 'root', kind: 'page', order: 0,
      titleI18n: { en: 'Page' }, contentI18n: { en: '# Page' }, roleSlotKey: null,
    },
  ],
  collaboration: null,
};

const template = (overrides: Record<string, unknown> = {}) => ({
  id: 'template-1', scope: 'system', spaceId: null, stableKey: 'workspace', category: 'planning',
  displayOrder: 0, nameI18n: { 'zh-CN': '工作区', en: 'Workspace' },
  descriptionI18n: { 'zh-CN': '说明', en: 'Description' },
  defaultTitleI18n: { 'zh-CN': '页面', en: 'Page' }, sourceLocale: null,
  currentVersion: 2, archivedAt: null, updatedAt: new Date('2026-09-05T00:00:00Z'),
  versions: [],
  ...overrides,
});

describe('CompositeTemplateCatalogService', () => {
  const pageTemplate = { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() };
  const pageTemplateVersion = { findMany: jest.fn() };
  const tx = { pageTemplate } as any;
  const prisma = { pageTemplate, pageTemplateVersion, $queryRaw: jest.fn(), $transaction: jest.fn() } as any;
  const authorization = { assertSpaceAccess: jest.fn() } as any;
  const pageTemplates = {
    createCompositeSpaceTemplate: jest.fn(), createCompositeVersion: jest.fn(),
    updateMetadata: jest.fn(), archive: jest.fn(), restore: jest.fn(),
  } as any;
  let service: CompositeTemplateCatalogService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'owner' });
    service = new CompositeTemplateCatalogService(prisma, authorization, pageTemplates);
  });

  it('resolves the exact requested new version as the definition authority', async () => {
    pageTemplate.findFirst.mockResolvedValue(template({
      versions: [{ version: 1, definition, definitionHash: hashCompositeDefinition(definition), contentI18n: { en: 'ignored' } }],
    }));

    await expect(service.resolve(tx, 'space-1', 'template-1', 1, 'en')).resolves.toEqual({
      definition, definitionHash: hashCompositeDefinition(definition), locale: 'en',
    });
    expect(pageTemplate.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'template-1' }),
      include: { versions: { where: { version: 1 }, take: 1 } },
    }));
  });

  it('rejects cross-Space, archived, and missing exact versions', async () => {
    pageTemplate.findFirst.mockResolvedValueOnce(null);
    await expect(service.resolve(tx, 'space-1', 'other-space', 1, 'en'))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_NOT_FOUND' });
    pageTemplate.findFirst.mockResolvedValueOnce(template({ archivedAt: new Date(), versions: [{}] }));
    await expect(service.resolve(tx, 'space-1', 'template-1', 1, 'en'))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_ARCHIVED' });
    pageTemplate.findFirst.mockResolvedValueOnce(template({ versions: [] }));
    await expect(service.resolve(tx, 'space-1', 'template-1', 1, 'en'))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_VERSION_NOT_FOUND' });
  });

  it('adapts legacy versions immutably with system and Space locale policy', async () => {
    const old = { version: 1, definition: null, definitionHash: null, contentI18n: { 'zh-CN': '# 中文', en: '# English' } };
    const before = structuredClone(old);
    pageTemplate.findFirst.mockResolvedValueOnce(template({ versions: [old] }));
    const system = await service.resolve(tx, 'space-1', 'template-1', 1, 'zh-CN');
    expect(system.locale).toBe('zh-CN');
    expect(system.definition.nodes[0]).toEqual(expect.objectContaining({
      titleI18n: { 'zh-CN': '页面', en: 'Page' }, contentI18n: old.contentI18n,
    }));
    expect(old).toEqual(before);

    pageTemplate.findFirst.mockResolvedValueOnce(template({
      scope: 'space', spaceId: 'space-1', sourceLocale: 'zh-CN', versions: [old],
    }));
    await expect(service.resolve(tx, 'space-1', 'template-1', 1, 'en'))
      .resolves.toEqual(expect.objectContaining({ locale: 'zh-CN' }));
  });

  it('filters kind and collaboration before paginating and includes matching totals', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ ...template({ id: 'group' }), kind: 'page_group', supportsCollaboration: false }])
      .mockResolvedValueOnce([{ total: 1n }]);

    const result = await service.list('space-1', {
      locale: 'en', kind: 'page_group', supportsCollaboration: false, skip: 0, take: 1,
    }, principal);

    expect(result.total).toBe(1);
    expect(result.data.map((row) => row.id)).toEqual(['group']);
    const listQuery = prisma.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql;
    expect(listQuery.sql).toContain('LIMIT ?');
    expect(listQuery.sql).toContain('OFFSET ?');
    expect(listQuery.sql).not.toContain('version."definition" AS');
  });

  it('enforces read access and delegates all custom writes to the legacy policy owner', async () => {
    pageTemplates.createCompositeSpaceTemplate.mockResolvedValue({ id: 'created' });
    pageTemplates.createCompositeVersion.mockResolvedValue({ version: 2 });
    await expect(service.createSpaceTemplate('space-1', { definition } as any, principal))
      .resolves.toEqual({ id: 'created' });
    await expect(service.createVersion('space-1', 'template-1', { definition } as any, principal))
      .resolves.toEqual({ version: 2 });
    expect(pageTemplates.createCompositeSpaceTemplate).toHaveBeenCalledWith('space-1', { definition }, principal);
    expect(pageTemplates.createCompositeVersion).toHaveBeenCalledWith('space-1', 'template-1', { definition }, principal);

    prisma.$queryRaw.mockResolvedValue([]);
    await service.list('space-1', { locale: 'en', skip: 0, take: 100 }, principal);
    expect(authorization.assertSpaceAccess).toHaveBeenCalledWith(
      principal, 'space-1', ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
    );
  });
});
