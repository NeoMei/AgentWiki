import type { CompositeTemplateDefinition } from '@neomei/agentwiki-sync-protocol';
import { Prisma } from '@prisma/client';
import type { Principal } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { CompositeTemplateCatalogService } from './composite-template-catalog.service';
import { hashCompositeDefinition } from './composite-template-validator';
import { TemplateFeaturePolicy } from './template-feature-policy';

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

const semanticallyInvalidDefinition: CompositeTemplateDefinition = {
  ...definition,
  nodes: [{
    nodeId: 'page', parentNodeId: null, kind: 'page', order: 0,
    titleI18n: { en: 'Page' }, contentI18n: { en: '# Page' }, roleSlotKey: 'writer',
  }],
  kind: 'single_page',
  collaboration: {
    workflow: {
      schemaVersion: 1,
      inputs: [],
      roleSlots: [{ id: 'writer', name: 'Writer', required: true, description: 'Writes' }],
      nodes: [{
        kind: 'agent_task', id: 'draft', name: 'Draft', roleSlotId: 'writer', objective: 'Draft',
        inputKeys: [], upstreamArtifacts: [], output: { key: 'draft', kind: 'markdown' },
        evidenceRequired: [], humanAcceptance: true, leaseSeconds: 300, maxExecutionSeconds: 3600,
        retryBudget: 1, repairBudget: 1, skippable: false,
        todos: [{ id: 'write', name: 'Write', required: true, evidenceKinds: [] }],
      }],
      dependencies: [],
      terminalNodeIds: ['draft'],
    },
    taskTargets: [{ taskNodeId: 'draft', pageNodeId: 'page' }],
  },
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
  const pageTemplateVersion = { findUnique: jest.fn() };
  const tx = { pageTemplate } as any;
  const prisma = { pageTemplate, pageTemplateVersion, $queryRaw: jest.fn(), $transaction: jest.fn() } as any;
  const authorization = { assertSpaceAccess: jest.fn(), assertLiveHumanSpaceAccess: jest.fn() } as any;
  const pageTemplates = {
    createCompositeSpaceTemplate: jest.fn(), createCompositeVersion: jest.fn(),
    updateCompositeMetadata: jest.fn(), archiveComposite: jest.fn(), restoreComposite: jest.fn(),
    updateMetadata: jest.fn(), archive: jest.fn(), restore: jest.fn(),
  } as any;
  const policy = { canCreate: jest.fn().mockReturnValue(true) } as unknown as TemplateFeaturePolicy;
  let service: CompositeTemplateCatalogService;

  beforeEach(() => {
    jest.resetAllMocks();
    (policy.canCreate as jest.Mock).mockReturnValue(true);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$transaction.mockImplementation((operation: any) => operation(tx));
    pageTemplateVersion.findUnique.mockResolvedValue({
      definition,
      schemaVersion: 1,
      definitionHash: hashCompositeDefinition(definition),
      contentI18n: {},
    });
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'owner' });
    authorization.assertLiveHumanSpaceAccess.mockResolvedValue({ role: 'owner' });
    service = new CompositeTemplateCatalogService(prisma, authorization, pageTemplates, policy);
  });

  it('returns rollout capability from the authoritative Space policy', async () => {
    (policy.canCreate as jest.Mock).mockReturnValue(false);
    pageTemplate.findMany.mockResolvedValue([]);
    pageTemplate.count.mockResolvedValue(0);

    const result = await service.list('space-1', {
      locale: 'en', scope: 'all', archived: 'active', skip: 0, take: 50,
    }, principal);

    expect(result.capabilities).toEqual({ canManage: true, canCreate: false });
  });

  it('resolves the exact requested new version as the definition authority', async () => {
    pageTemplate.findFirst.mockResolvedValue(template({
      versions: [{
        version: 1, definition, schemaVersion: 1,
        definitionHash: hashCompositeDefinition(definition), contentI18n: { en: 'ignored' },
      }],
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

  it('summarizes implicit single-Page collaboration without treating it as stored corruption', async () => {
    const single = {
      schemaVersion: 1 as const,
      kind: 'single_page' as const,
      nodes: [{
        nodeId: 'page', parentNodeId: null, kind: 'page' as const, order: 0,
        titleI18n: { en: 'Page' }, contentI18n: { en: '# Page' }, roleSlotKey: null,
      }],
      collaboration: null,
    };
    prisma.$queryRaw
      .mockResolvedValueOnce([{ ...template(), kind: 'single_page', supportsCollaboration: true }])
      .mockResolvedValueOnce([{ total: 1n }]);
    pageTemplateVersion.findUnique.mockResolvedValueOnce({
      definition: single, schemaVersion: 1,
      definitionHash: hashCompositeDefinition(single), contentI18n: {},
    });

    await expect(service.list('space-1', {
      locale: 'en', supportsCollaboration: true, skip: 0, take: 1,
    }, principal)).resolves.toEqual(expect.objectContaining({
      data: [expect.objectContaining({
        kind: 'single_page', supportsCollaboration: true,
        storageKind: 'definition',
        effectiveSupportsCollaboration: true, pageCount: 1, folderCount: 0, roleCount: 0,
      })],
    }));
  });

  it('distinguishes wrapped legacy content storage in the enabled unified catalog', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ ...template(), kind: 'single_page', supportsCollaboration: true }])
      .mockResolvedValueOnce([{ total: 1n }]);
    pageTemplateVersion.findUnique.mockResolvedValue({ definition: null, schemaVersion: null, definitionHash: null, contentI18n: { en: '# Legacy' } });
    const result = await service.list('space-1', { locale: 'en', skip: 0, take: 1 }, principal);
    expect(result.data[0]).toMatchObject({ kind: 'single_page', storageKind: 'legacy_content', pageCount: 1 });
  });

  it('rejects a selected catalog page when a current composite definition has corrupt schema or hash', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ ...template({ id: 'group' }), kind: 'page_group', supportsCollaboration: false }])
      .mockResolvedValueOnce([{ total: 1n }]);
    pageTemplateVersion.findUnique.mockResolvedValueOnce({
      definition: { ...definition, schemaVersion: 2 },
      schemaVersion: 2,
      definitionHash: hashCompositeDefinition(definition),
      contentI18n: {},
    });

    await expect(service.list('space-1', {
      locale: 'en', kind: 'page_group', skip: 0, take: 1,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });

    prisma.$queryRaw
      .mockResolvedValueOnce([{ ...template({ id: 'group' }), kind: 'page_group', supportsCollaboration: false }])
      .mockResolvedValueOnce([{ total: 1n }]);
    pageTemplateVersion.findUnique.mockResolvedValueOnce({
      definition,
      schemaVersion: 1,
      definitionHash: '0'.repeat(64),
      contentI18n: {},
    });

    await expect(service.list('space-1', {
      locale: 'en', kind: 'page_group', skip: 0, take: 1,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });
  });

  it('rejects selected composite semantics and legacy content after bounded candidate paging', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ ...template({ id: 'group' }), kind: 'single_page', supportsCollaboration: true }])
      .mockResolvedValueOnce([{ total: 1n }]);
    pageTemplateVersion.findUnique.mockResolvedValueOnce({
      definition: semanticallyInvalidDefinition,
      schemaVersion: 1,
      definitionHash: hashCompositeDefinition(semanticallyInvalidDefinition),
      contentI18n: {},
    });

    await expect(service.list('space-1', {
      locale: 'en', skip: 0, take: 1,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });

    prisma.$queryRaw
      .mockResolvedValueOnce([{ ...template({ id: 'legacy' }), kind: 'single_page', supportsCollaboration: false }])
      .mockResolvedValueOnce([{ total: 1n }]);
    pageTemplateVersion.findUnique.mockResolvedValueOnce({
      definition: null,
      schemaVersion: null,
      definitionHash: null,
      contentI18n: {},
    });

    await expect(service.list('space-1', {
      locale: 'en', skip: 0, take: 1,
    }, principal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });
  });

  it('validates only selected exact versions sequentially before returning summaries', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { ...template({ id: 'first', currentVersion: 3 }), kind: 'page_group', supportsCollaboration: false },
        { ...template({ id: 'second', currentVersion: 7 }), kind: 'page_group', supportsCollaboration: false },
      ])
      .mockResolvedValueOnce([{ total: 500n }]);
    let active = 0;
    let maximumActive = 0;
    pageTemplateVersion.findUnique.mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return {
        definition,
        schemaVersion: 1,
        definitionHash: hashCompositeDefinition(definition),
        contentI18n: {},
      };
    });

    const result = await service.list('space-1', {
      locale: 'en', skip: 40, take: 2,
    }, principal);

    expect(result.total).toBe(500);
    expect(result.data.map((row) => row.id)).toEqual(['first', 'second']);
    expect(maximumActive).toBe(1);
    expect(pageTemplateVersion.findUnique.mock.calls.map(([argument]) => argument)).toEqual([
      {
        where: { templateId_version: { templateId: 'first', version: 3 } },
        select: { definition: true, schemaVersion: true, definitionHash: true, contentI18n: true },
      },
      {
        where: { templateId_version: { templateId: 'second', version: 7 } },
        select: { definition: true, schemaVersion: true, definitionHash: true, contentI18n: true },
      },
    ]);
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
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledWith(
      tx, principal, 'space-1', ['owner', 'admin', 'editor', 'viewer'],
    );
  });

  it('returns composite managed records from metadata, archive, and restore wrappers', async () => {
    const definitionHash = hashCompositeDefinition(definition);
    pageTemplates.updateCompositeMetadata.mockResolvedValue({
      id: 'template-1', currentVersion: 2, archivedAt: null, definition, definitionHash,
    });
    pageTemplates.archiveComposite.mockResolvedValue({
      id: 'template-1', currentVersion: 2,
      archivedAt: new Date('2026-09-05T03:00:00.000Z'), definition, definitionHash,
    });
    pageTemplates.restoreComposite.mockResolvedValue({
      id: 'template-1', currentVersion: 2, archivedAt: null, definition, definitionHash,
    });
    pageTemplates.updateMetadata.mockResolvedValue({ id: 'template-1', content: '# legacy' });
    pageTemplates.archive.mockResolvedValue({ id: 'template-1', content: '# legacy' });
    pageTemplates.restore.mockResolvedValue({ id: 'template-1', content: '# legacy' });
    const metadata = {
      name: 'Workspace', category: 'planning' as const, defaultTitle: 'Workspace',
      expectedUpdatedAt: '2026-09-05T00:00:00.000Z',
    };
    const state = { expectedUpdatedAt: '2026-09-05T00:00:00.000Z' };

    await expect(service.updateMetadata('space-1', 'template-1', metadata, principal))
      .resolves.toMatchObject({ definition, definitionHash });
    await expect(service.archive('space-1', 'template-1', state, principal))
      .resolves.toMatchObject({ definition, definitionHash, archivedAt: expect.any(Date) });
    await expect(service.restore('space-1', 'template-1', state, principal))
      .resolves.toMatchObject({ definition, definitionHash, archivedAt: null });
    expect(pageTemplates.updateMetadata).not.toHaveBeenCalled();
    expect(pageTemplates.archive).not.toHaveBeenCalled();
    expect(pageTemplates.restore).not.toHaveBeenCalled();
  });

  it('returns an archived immutable version only through live Owner/Admin management detail', async () => {
    pageTemplate.findFirst.mockResolvedValue(template({
      scope: 'space', spaceId: 'space-1', sourceLocale: 'en', archivedAt: new Date('2026-09-05T02:00:00Z'),
      versions: [{ definition, schemaVersion: 1, definitionHash: hashCompositeDefinition(definition), contentI18n: {} }],
    }));
    const result = await (service as any).managementDetail(
      'space-1', 'template-1', 2, 'en', principal,
    );
    expect(result).toEqual(expect.objectContaining({
      templateId: 'template-1', version: 2, archivedAt: '2026-09-05T02:00:00.000Z',
      definition, definitionHash: hashCompositeDefinition(definition),
    }));
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledWith(
      tx, principal, 'space-1', ['owner', 'admin'],
    );
  });

  it('refuses non-manager management detail before reading templates', async () => {
    authorization.assertLiveHumanSpaceAccess.mockRejectedValueOnce(
      new BusinessException('SPACE_ACCESS_DENIED'),
    );
    await expect(service.managementDetail('space-1', 'template-1', 1, 'en', principal))
      .rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_PERMISSION_DENIED' });
    expect(pageTemplate.findFirst).not.toHaveBeenCalled();
  });
});
