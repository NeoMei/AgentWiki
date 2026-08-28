import { Test, TestingModule } from '@nestjs/testing';
import { PageService } from './page.service';
import { PrismaService } from '../../database/prisma.service';
import { SearchService } from '../search/search.service';
import { SpaceRevisionWriterService } from '../sync/space-revision-writer.service';
import {
  ReadableSyncPathService,
  safeMarkdownBasename,
  syncPathDirectory,
} from '../sync/readable-sync-path.service';
import { ContentTreeService } from '../../content-tree/content-tree.service';
import { GraphMaintenance } from '../../knowledge-graph/graph-maintenance';
import { PageTemplateService } from '../../page-templates/page-template.service';
import { AuthorizationService, type Principal } from '../authorization/authorization.service';
import { PageTemplateCategory } from '@prisma/client';

const mockPrisma = {
  space: {
    findUnique: jest.fn(),
  },
  page: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  pageSearchDocument: {
    upsert: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({}),
  },
  pageVersion: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  changeSet: { findUnique: jest.fn() },
  evidence: { findMany: jest.fn() },
  user: { findUnique: jest.fn() },
  agent: { findUnique: jest.fn() },
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
};

const mockSearch = {
  indexPage: jest.fn().mockResolvedValue(undefined),
  deletePageIndex: jest.fn().mockResolvedValue(undefined),
};

const mockRevisionWriter = {
  advance: jest.fn().mockResolvedValue({}),
  lockSpace: jest.fn().mockImplementation(async (tx: unknown) => tx),
};

const mockSyncPaths = {
  allocate: jest.fn(),
};

const mockGraphMaintenance = {
  enqueue: jest.fn(),
};

const mockTemplates = {
  resolveVersion: jest.fn(),
};

const mockAuthorization = {
  assertLiveHumanSpaceAccess: jest.fn(),
};

const mockContentTree = {
  lockPageMutationSpace: jest.fn(),
  placePage: jest.fn(),
  preparePageMutation: jest.fn(),
  advancePageMutation: jest.fn(),
  mapLegacyPageParent: jest.fn(),
};

const humanPrincipal: Principal = { userId: 'user-1', platformRole: 'user' };

describe('PageService', () => {
  let service: PageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(mockPrisma));
    mockPrisma.evidence.findMany.mockResolvedValue([]);
    mockSyncPaths.allocate.mockResolvedValue({
      path: 'pages/Test.md',
      pathKey: 'pages/test.md',
    });
    mockContentTree.lockPageMutationSpace.mockImplementation(
      async (tx: any, spaceId: string, expectedTreeRevision?: bigint) => {
        const locked = await mockRevisionWriter.lockSpace(tx, spaceId);
        return Object.assign(locked, { contentTreeRevision: expectedTreeRevision ?? 0n });
      },
    );
    mockContentTree.placePage.mockImplementation(async (tx: any, input: any) => {
      const allocated = await mockSyncPaths.allocate(tx, {
        spaceId: input.spaceId, directory: 'pages', title: input.title,
      });
      return { folderId: input.folderId, syncPath: allocated.path, syncPathKey: allocated.pathKey };
    });
    mockContentTree.preparePageMutation.mockImplementation(async (tx: any, input: any) => {
      const pathChanged = input.folderId !== input.current.folderId
        || safeMarkdownBasename(input.title) !== safeMarkdownBasename(input.current.title);
      if (!pathChanged) {
        return {
          folderId: input.folderId,
          syncPath: input.current.syncPath,
          syncPathKey: input.current.syncPathKey,
        };
      }
      const allocated = await mockSyncPaths.allocate(tx, {
        spaceId: input.spaceId,
        directory: syncPathDirectory(input.current.syncPath),
        title: input.title,
        excludePageId: input.pageId,
      });
      return { folderId: input.folderId, syncPath: allocated.path, syncPathKey: allocated.pathKey };
    });
    mockContentTree.advancePageMutation.mockImplementation(async (tx: any, input: any) => {
      await mockRevisionWriter.advance(tx, input.spaceId, input.changes, expect.anything());
      return { treeRevision: input.expectedTreeRevision, syncRevisionId: 'sync-1' };
    });
    mockContentTree.mapLegacyPageParent.mockResolvedValue('folder-mapped');
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PageService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SearchService, useValue: mockSearch },
        { provide: SpaceRevisionWriterService, useValue: mockRevisionWriter },
        { provide: ReadableSyncPathService, useValue: mockSyncPaths },
        { provide: GraphMaintenance, useValue: mockGraphMaintenance },
        { provide: PageTemplateService, useValue: mockTemplates },
        { provide: AuthorizationService, useValue: mockAuthorization },
        { provide: ContentTreeService, useValue: mockContentTree },
      ],
    }).compile();

    service = module.get<PageService>(PageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('exposes folderId and canonical path in existing Page list/detail semantics', async () => {
    const row = {
      id: 'page-1', title: 'Weekly', folderId: 'folder-1',
      syncPath: 'pages/项目/Weekly.md', sourceChangeSetId: null,
      lastChangeSetId: null, lastModifiedByUserId: null, lastModifiedByAgentId: null,
    };
    mockPrisma.page.findMany.mockResolvedValue([row]);
    mockPrisma.page.count.mockResolvedValue(1);
    await expect(service.findAll(['space-1'], 'space-1')).resolves.toMatchObject({
      data: [expect.objectContaining({
        id: 'page-1', folderId: 'folder-1', path: 'pages/项目/Weekly.md',
      })],
    });

    mockPrisma.page.findUnique.mockResolvedValue(row);
    await expect(service.findOne('page-1')).resolves.toMatchObject({
      id: 'page-1', folderId: 'folder-1', path: 'pages/项目/Weekly.md',
    });

    mockPrisma.pageVersion.findMany.mockResolvedValue([{
      id: 'version-1', pageId: 'page-1', folderId: 'folder-1',
      syncPath: 'pages/项目/Weekly.md',
    }]);
    await expect(service.getVersionHistory('page-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'version-1', folderId: 'folder-1', path: 'pages/项目/Weekly.md',
      }),
    ]);
  });

  describe('create', () => {
    it('delegates initial Folder placement, locking, and structural revision advancement to ContentTreeService', async () => {
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
      mockContentTree.placePage.mockResolvedValueOnce({
        folderId: 'folder-1', syncPath: 'pages/项目/周报.md', syncPathKey: 'pages/项目/周报.md',
      });
      mockPrisma.page.create.mockResolvedValue({
        id: 'page-1', knowledgeKey: 'knowledge-1', title: '周报', content: '# 周报',
        folderId: 'folder-1', syncPath: 'pages/项目/周报.md',
      });

      await service.create({
        spaceId: 'space-1', title: '周报', content: '# 周报',
        folderId: 'folder-1', expectedTreeRevision: '7',
      }, humanPrincipal);

      expect(mockContentTree.lockPageMutationSpace).toHaveBeenCalledWith(
        mockPrisma, 'space-1', 7n,
      );
      expect(mockContentTree.placePage).toHaveBeenCalledWith(mockPrisma, expect.objectContaining({
        spaceId: 'space-1', title: '周报', folderId: 'folder-1', pageId: expect.any(String),
      }));
      expect(mockPrisma.page.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ parentId: null, folderId: 'folder-1' }),
      }));
      expect(mockContentTree.advancePageMutation).toHaveBeenCalledWith(mockPrisma, expect.objectContaining({
        spaceId: 'space-1', expectedTreeRevision: 7n, structural: true,
        changes: [expect.objectContaining({ folderId: 'folder-1', path: 'pages/项目/周报.md' })],
      }));
    });

    it('rejects legacy parentId unless the migration-only flag is explicitly enabled', async () => {
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
      const previous = process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
      delete process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
      try {
        await expect(service.create({
          spaceId: 'space-1', title: 'Legacy', parentId: 'legacy-page', expectedTreeRevision: '0',
        } as any, humanPrincipal)).rejects.toMatchObject({ businessCode: 'PAGE_PARENT_DEPRECATED' });
        expect(mockContentTree.mapLegacyPageParent).not.toHaveBeenCalled();
        expect(mockPrisma.page.create).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined) delete process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
        else process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = previous;
      }
    });

    it('maps legacy parentId once under the tree lock when the migration flag is enabled', async () => {
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
      mockPrisma.page.create.mockResolvedValue({
        id: 'page-1', knowledgeKey: 'knowledge-1', title: 'Legacy', content: '',
      });
      const previous = process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
      process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = 'true';
      try {
        await service.create({
          spaceId: 'space-1', title: 'Legacy', parentId: 'legacy-page', expectedTreeRevision: '0',
        } as any, humanPrincipal);
        expect(mockContentTree.mapLegacyPageParent).toHaveBeenCalledWith(
          mockPrisma, 'space-1', 'legacy-page',
        );
        expect(mockContentTree.placePage).toHaveBeenCalledWith(mockPrisma, expect.objectContaining({
          folderId: 'folder-mapped',
        }));
      } finally {
        if (previous === undefined) delete process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
        else process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = previous;
      }
    });

    it('maps an explicit legacy root parent to the Folder root without guessing a Folder', async () => {
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
      mockPrisma.page.create.mockResolvedValue({
        id: 'page-1', knowledgeKey: 'knowledge-1', title: 'Legacy root', content: '',
      });
      const previous = process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
      process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = 'true';
      try {
        await service.create({
          spaceId: 'space-1', title: 'Legacy root', parentId: null,
          expectedTreeRevision: '0',
        } as any, humanPrincipal);
        expect(mockContentTree.mapLegacyPageParent).not.toHaveBeenCalled();
        expect(mockContentTree.placePage).toHaveBeenCalledWith(mockPrisma, expect.objectContaining({
          folderId: null,
        }));
      } finally {
        if (previous === undefined) delete process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
        else process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = previous;
      }
    });

    it('never accepts legacy parentId together with folderId even under the migration flag', async () => {
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
      const previous = process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
      process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = 'true';
      try {
        await expect(service.create({
          spaceId: 'space-1', title: 'Ambiguous', parentId: 'legacy-page',
          folderId: 'folder-1', expectedTreeRevision: '0',
        } as any, humanPrincipal)).rejects.toMatchObject({ businessCode: 'PAGE_PARENT_DEPRECATED' });
        expect(mockContentTree.mapLegacyPageParent).not.toHaveBeenCalled();
        expect(mockContentTree.placePage).not.toHaveBeenCalled();
        expect(mockPrisma.page.create).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined) delete process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
        else process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = previous;
      }
    });

    it('rejects a template-backed create when archive commits after the template was selected', async () => {
      const selectedAt = new Date('2026-08-26T01:00:00.000Z');
      const state = {
        archivedAt: null as Date | null,
        updatedAt: selectedAt,
      };
      let reportArchiveWrite!: () => void;
      let releaseArchiveWrite!: () => void;
      let reportCreateWaiting!: () => void;
      const archiveReachedWrite = new Promise<void>((resolve) => { reportArchiveWrite = resolve; });
      const archiveMayCommit = new Promise<void>((resolve) => { releaseArchiveWrite = resolve; });
      const createWaitingForLock = new Promise<void>((resolve) => { reportCreateWaiting = resolve; });

      const pageTemplate = {
        findFirst: jest.fn(async ({ include }: any) => {
          return {
            id: 'template-1', scope: 'space', scopeKey: 'space-1', spaceId: 'space-1',
            stableKey: 'weekly', category: PageTemplateCategory.reporting,
            nameI18n: { en: 'Weekly' }, descriptionI18n: { en: '' },
            defaultTitleI18n: { en: 'Weekly' }, sourceLocale: 'en', currentVersion: 1,
            archivedAt: state.archivedAt, updatedAt: state.updatedAt,
            createdAt: selectedAt, createdById: 'user-1', updatedById: 'user-1',
            versions: include ? [{ version: 1, contentI18n: { en: '# Selected' } }] : undefined,
          };
        }),
        findUnique: jest.fn(async () => ({
          id: 'template-1', scope: 'space', scopeKey: 'space-1', spaceId: 'space-1',
          stableKey: 'weekly', category: PageTemplateCategory.reporting,
          nameI18n: { en: 'Weekly' }, descriptionI18n: { en: '' },
          defaultTitleI18n: { en: 'Weekly' }, sourceLocale: 'en', currentVersion: 1,
          archivedAt: state.archivedAt, updatedAt: state.updatedAt,
          createdAt: selectedAt, createdById: 'user-1', updatedById: 'user-1',
        })),
        updateMany: jest.fn(async () => {
          if (state.archivedAt) return { count: 0 };
          reportArchiveWrite();
          await archiveMayCommit;
          state.archivedAt = new Date('2026-08-26T01:01:00.000Z');
          state.updatedAt = new Date('2026-08-26T01:01:00.000Z');
          return { count: 1 };
        }),
      };
      const pageTemplateVersion = {
        findUnique: jest.fn().mockResolvedValue({
          templateId: 'template-1', version: 1, contentI18n: { en: '# Selected' },
          contentHash: 'hash', sourcePageId: null,
        }),
      };
      const transactionOwners: unknown[] = [];
      const waiters: Array<() => void> = [];
      const sharedWriter = {
        lockSpace: jest.fn(async (tx: unknown) => {
          if (transactionOwners.length === 0) {
            transactionOwners.push(tx);
            return tx;
          }
          reportCreateWaiting();
          await new Promise<void>((resolve) => waiters.push(resolve));
          transactionOwners.push(tx);
          return tx;
        }),
        advance: jest.fn().mockResolvedValue({}),
        release(tx: unknown) {
          const index = transactionOwners.indexOf(tx);
          if (index >= 0) transactionOwners.splice(index, 1);
          waiters.shift()?.();
        },
      };
      const makeTx = () => ({
        pageTemplate,
        pageTemplateVersion,
        user: {},
        space: {},
        spaceMember: {},
        page: {
          create: jest.fn().mockResolvedValue({
            id: 'page-created', knowledgeKey: 'knowledge-created', title: 'Weekly',
            content: '# Selected', sourceTemplateId: 'template-1',
          }),
        },
      });
      const concurrentPrisma = {
        space: { findUnique: jest.fn().mockResolvedValue({ id: 'space-1' }) },
        changeSet: { findUnique: jest.fn() }, evidence: { findMany: jest.fn().mockResolvedValue([]) },
        user: { findUnique: jest.fn() }, agent: { findUnique: jest.fn() },
        $transaction: jest.fn(async (operation: (tx: any) => Promise<unknown>) => {
          const tx = makeTx();
          try {
            return await operation(tx);
          } finally {
            sharedWriter.release(tx);
          }
        }),
      } as any;
      const liveAuthorization = {
        assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'owner' }),
      } as any;
      const templates = new (PageTemplateService as any)(
        concurrentPrisma,
        liveAuthorization,
        { get: jest.fn().mockReturnValue('api') },
        sharedWriter,
      ) as PageTemplateService;
      const pages = new PageService(
        concurrentPrisma,
        mockSearch as any,
        sharedWriter as any,
        mockSyncPaths as any,
        mockGraphMaintenance as any,
        templates,
        liveAuthorization,
        {
          lockPageMutationSpace: async (tx: any, _spaceId: string) => Object.assign(
            await sharedWriter.lockSpace(tx) as object,
            { contentTreeRevision: 0n },
          ),
        } as any,
      );

      const archive = templates.archive(
        'space-1', 'template-1', { expectedUpdatedAt: selectedAt.toISOString() }, humanPrincipal,
      );
      await archiveReachedWrite;

      const create = pages.create({
        title: 'Weekly', spaceId: 'space-1', templateId: 'template-1',
        templateVersion: 1, templateLocale: 'en',
      } as any, humanPrincipal);
      await createWaitingForLock;
      releaseArchiveWrite();
      await archive;

      await expect(create).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_ARCHIVED' });
      expect(pageTemplate.updateMany).toHaveBeenCalledTimes(1);
      expect(sharedWriter.lockSpace).toHaveBeenCalledTimes(2);
    });

    it('should create a page', async () => {
      const dto = { title: 'Test', spaceId: 'space-1' };
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
      mockPrisma.page.create.mockResolvedValue({ id: '1', ...dto });
      const result = await service.create(dto as any, humanPrincipal);
      expect(result.id).toBe('1');
      expect(mockGraphMaintenance.enqueue).toHaveBeenCalledWith('space-1');
      expect(mockSearch.indexPage.mock.invocationCallOrder[0])
        .toBeLessThan(mockGraphMaintenance.enqueue.mock.invocationCallOrder[0]);
    });

    it('creates a web page at its allocated title path', async () => {
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
      mockSyncPaths.allocate.mockResolvedValue({
        path: 'pages/吃饭睡觉.md',
        pathKey: 'pages/吃饭睡觉.md',
      });
      mockPrisma.page.create.mockResolvedValue({
        id: 'page-1',
        knowledgeKey: 'knowledge-1',
        title: '吃饭睡觉',
        content: '# 吃饭睡觉',
      });

      await service.create({
        spaceId: 'space-1',
        title: '吃饭睡觉',
        content: '# 吃饭睡觉',
      } as any, humanPrincipal);

      expect(mockRevisionWriter.lockSpace).toHaveBeenCalledWith(expect.anything(), 'space-1');
      expect(mockSyncPaths.allocate).toHaveBeenCalledWith(expect.anything(), {
        spaceId: 'space-1',
        directory: 'pages',
        title: '吃饭睡觉',
      });
      expect(mockPrisma.page.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          syncPath: 'pages/吃饭睡觉.md',
          syncPathKey: 'pages/吃饭睡觉.md',
        }),
      }));
      expect(mockRevisionWriter.advance).toHaveBeenCalledWith(
        expect.anything(),
        'space-1',
        [expect.objectContaining({ path: 'pages/吃饭睡觉.md', body: '# 吃饭睡觉' })],
        expect.anything(),
      );
      expect(mockRevisionWriter.lockSpace.mock.invocationCallOrder[0]).toBeLessThan(
        mockSyncPaths.allocate.mock.invocationCallOrder[0],
      );
      expect(mockSyncPaths.allocate.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.page.create.mock.invocationCallOrder[0],
      );
    });

    it('creates a blank Markdown page with an empty initial revision body', async () => {
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
      mockPrisma.page.create.mockResolvedValue({
        id: 'page-1', knowledgeKey: 'knowledge-1', title: 'Blank', content: '', format: 'markdown',
      });

      await service.create({
        title: 'Blank', spaceId: 'space-1', expectedTreeRevision: '0',
      }, humanPrincipal);

      expect(mockTemplates.resolveVersion).not.toHaveBeenCalled();
      expect(mockPrisma.page.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ content: '', format: 'markdown' }),
      }));
      expect(mockRevisionWriter.advance).toHaveBeenCalledWith(
        expect.anything(), 'space-1', [expect.objectContaining({ body: '' })], expect.anything(),
      );
    });

    it('preserves a direct page non-Markdown format', async () => {
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
      mockPrisma.page.create.mockResolvedValue({
        id: 'page-1', knowledgeKey: 'knowledge-1', title: 'Structured', content: '{}', format: 'json',
      });

      await service.create({
        title: 'Structured', spaceId: 'space-1', content: '{}', format: 'json',
        expectedTreeRevision: '0',
      }, humanPrincipal);

      expect(mockTemplates.resolveVersion).not.toHaveBeenCalled();
      expect(mockPrisma.page.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ content: '{}', format: 'json' }),
      }));
    });

    it.each([
      ['templateId only', { templateId: 'template-1' }],
      ['templateVersion only', { templateVersion: 2 }],
      ['templateLocale only', { templateLocale: 'en' }],
      ['empty templateId', { templateId: '', templateVersion: 2, templateLocale: 'en' }],
      ['null templateId', { templateId: null, templateVersion: 2, templateLocale: 'en' }],
      ['string templateVersion', { templateId: 'template-1', templateVersion: '2', templateLocale: 'en' }],
      ['unsupported templateLocale', { templateId: 'template-1', templateVersion: 2, templateLocale: 'fr' }],
      ['mixed direct content', { templateId: 'template-1', templateVersion: 2, templateLocale: 'en', content: '# Forged' }],
      ['non-Markdown format', { templateId: 'template-1', templateVersion: 2, templateLocale: 'en', format: 'html' }],
    ])('rejects invalid internal template input: %s', async (_case, templateFields) => {
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });

      await expect(service.create({
        title: 'Invalid', spaceId: 'space-1', ...templateFields,
      } as any, humanPrincipal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_INVALID' });

      expect(mockTemplates.resolveVersion).not.toHaveBeenCalled();
      expect(mockSyncPaths.allocate).not.toHaveBeenCalled();
      expect(mockPrisma.page.create).not.toHaveBeenCalled();
      expect(mockRevisionWriter.advance).not.toHaveBeenCalled();
    });

    it('performs no page work after template resolution fails', async () => {
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
      mockTemplates.resolveVersion.mockRejectedValueOnce({
        businessCode: 'PAGE_TEMPLATE_VERSION_NOT_FOUND',
      });

      await expect(service.create({
        title: 'Missing version', spaceId: 'space-1', templateId: 'template-1',
        templateVersion: 2, templateLocale: 'en', expectedTreeRevision: '0',
      }, humanPrincipal)).rejects.toMatchObject({ businessCode: 'PAGE_TEMPLATE_VERSION_NOT_FOUND' });

      expect(mockSyncPaths.allocate).not.toHaveBeenCalled();
      expect(mockPrisma.page.create).not.toHaveBeenCalled();
      expect(mockRevisionWriter.advance).not.toHaveBeenCalled();
    });

    it('copies the exact resolved version and stores provenance in the existing transaction', async () => {
      mockTemplates.resolveVersion.mockResolvedValue({
        content: '# Weekly v2', templateId: 'template-1', version: 2, locale: 'en',
      });
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
      mockPrisma.page.create.mockResolvedValue({
        id: 'page-1', knowledgeKey: 'knowledge-1', title: '周报', content: '# Weekly v2',
        sourceTemplateId: 'template-1', sourceTemplateVersion: 2, sourceTemplateLocale: 'en',
      });

      const result = await service.create({
        title: '周报', spaceId: 'space-1', templateId: 'template-1',
        templateVersion: 2, templateLocale: 'zh-CN',
      } as any, humanPrincipal);

      expect(mockTemplates.resolveVersion).toHaveBeenCalledWith(expect.anything(), {
        spaceId: 'space-1', templateId: 'template-1', version: 2, locale: 'zh-CN',
      });
      expect(mockPrisma.page.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          content: '# Weekly v2', format: 'markdown',
          sourceTemplateId: 'template-1', sourceTemplateVersion: 2, sourceTemplateLocale: 'en',
        }),
        select: expect.objectContaining({
          sourceTemplateId: true, sourceTemplateVersion: true, sourceTemplateLocale: true,
        }),
      }));
      expect(mockRevisionWriter.advance).toHaveBeenCalledWith(
        expect.anything(), 'space-1', [expect.objectContaining({ body: '# Weekly v2' })], expect.anything(),
      );
      expect(result).toMatchObject({
        sourceTemplateId: 'template-1', sourceTemplateVersion: 2, sourceTemplateLocale: 'en',
      });
      expect(mockTemplates.resolveVersion).toHaveBeenCalledTimes(1);
      expect(mockRevisionWriter.lockSpace.mock.invocationCallOrder[0]).toBeLessThan(
        mockTemplates.resolveVersion.mock.invocationCallOrder[0],
      );
      expect(mockTemplates.resolveVersion.mock.invocationCallOrder[0]).toBeLessThan(
        mockSyncPaths.allocate.mock.invocationCallOrder[0],
      );
    });

    it('rechecks live human authorization after taking the Space lock and before page work', async () => {
      const principal: Principal = { userId: 'admin-1', platformRole: 'super_admin' };
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
      mockPrisma.page.create.mockResolvedValue({
        id: 'page-1', knowledgeKey: 'knowledge-1', title: 'Authorized', content: '',
      });
      mockAuthorization.assertLiveHumanSpaceAccess.mockResolvedValue({ role: 'owner' });

      await service.create({
        title: 'Authorized', spaceId: 'space-1', expectedTreeRevision: '0',
      }, principal);

      expect(mockAuthorization.assertLiveHumanSpaceAccess).toHaveBeenCalledWith(
        mockPrisma, principal, 'space-1', ['owner', 'editor'],
      );
      expect(mockRevisionWriter.lockSpace.mock.invocationCallOrder[0]).toBeLessThan(
        mockAuthorization.assertLiveHumanSpaceAccess.mock.invocationCallOrder[0],
      );
      expect(mockAuthorization.assertLiveHumanSpaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
        mockSyncPaths.allocate.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.page.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ authorId: 'admin-1', lastModifiedByUserId: 'admin-1' }),
      }));
    });

    it('does no page work when live authorization is revoked inside the locked transaction', async () => {
      const revoked = new Error('authorization revoked');
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
      mockAuthorization.assertLiveHumanSpaceAccess.mockRejectedValueOnce(revoked);

      await expect(service.create(
        { title: 'Rejected', spaceId: 'space-1', expectedTreeRevision: '0' }, humanPrincipal,
      )).rejects.toBe(revoked);

      expect(mockRevisionWriter.lockSpace).toHaveBeenCalledWith(mockPrisma, 'space-1');
      expect(mockSyncPaths.allocate).not.toHaveBeenCalled();
      expect(mockPrisma.page.create).not.toHaveBeenCalled();
      expect(mockRevisionWriter.advance).not.toHaveBeenCalled();
    });
  });

  const original = {
    id: 'page-1',
    title: 'Original',
    content: 'Original content',
    slug: 'original',
    format: 'markdown',
    parentId: null,
    spaceId: 'space-1',
    authorId: 'user-1',
    sourceChangeSetId: null,
    lastChangeSetId: null,
    lastModifiedByUserId: 'user-1',
    lastModifiedByAgentId: null,
    knowledgeKey: 'knowledge-1',
    syncPath: 'guides/Original.md',
    syncPathKey: 'guides/original.md',
    updatedAt: new Date('2026-07-27T08:00:00.000Z'),
  };

  describe('update', () => {
    it('delegates title and Folder placement atomically but does not advance tree revision for body-only edits', async () => {
      const current = {
        id: 'page-1', title: 'Current', content: 'before', slug: 'current', format: 'markdown',
        parentId: null, folderId: null, spaceId: 'space-1', authorId: 'user-1',
        knowledgeKey: 'knowledge-1', syncPath: 'pages/Current.md', syncPathKey: 'pages/current.md',
        sortOrder: 0, createdAt: new Date('2026-08-27T00:00:00.000Z'),
        updatedAt: new Date('2026-08-28T00:00:00.000Z'),
      };
      mockPrisma.page.findUnique
        .mockResolvedValueOnce(current)
        .mockResolvedValueOnce({ ...current, content: 'after' });
      mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });

      await service.update('page-1', {
        content: 'after', expectedUpdatedAt: current.updatedAt.toISOString(),
      }, 'user-1');

      expect(mockContentTree.preparePageMutation).not.toHaveBeenCalled();
      expect(mockContentTree.advancePageMutation).toHaveBeenCalledWith(mockPrisma, expect.objectContaining({
        structural: false, expectedTreeRevision: 0n,
      }));
      expect(mockPrisma.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ folderId: null }),
      }));
    });
    it('rejects a stale version with a stable 409 code and no unconditional update', async () => {
      mockPrisma.page.findUnique.mockResolvedValue(original);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.update('page-1', {
        title: 'My draft',
        expectedUpdatedAt: original.updatedAt.toISOString(),
      } as any, 'user-1')).rejects.toMatchObject({
        statusCode: 409,
        businessCode: 'RESOURCE_CONFLICT',
      });

      expect(mockPrisma.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'page-1', deletedAt: null, updatedAt: original.updatedAt },
      }));
      expect(mockPrisma.page.update).not.toHaveBeenCalled();
      expect(mockSearch.indexPage).not.toHaveBeenCalled();
    });

    it('updates exactly the matching version inside a transaction and stores the prior version', async () => {
      const updated = { ...original, title: 'Updated', updatedAt: new Date('2026-07-27T08:01:00.000Z') };
      mockPrisma.page.findUnique.mockResolvedValueOnce(original).mockResolvedValueOnce(updated);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.update('page-1', {
        title: 'Updated',
        expectedUpdatedAt: original.updatedAt.toISOString(),
      } as any, 'user-1')).resolves.toMatchObject({ title: 'Updated' });

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'page-1', deletedAt: null, updatedAt: original.updatedAt },
        data: expect.objectContaining({ title: 'Updated' }),
      }));
      expect(mockPrisma.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ title: 'Original', content: 'Original content' }),
      }));
      expect(mockSearch.indexPage).toHaveBeenCalledWith('page-1');
      expect(mockGraphMaintenance.enqueue).toHaveBeenCalledWith('space-1');
      expect(mockSearch.indexPage.mock.invocationCallOrder[0])
        .toBeLessThan(mockGraphMaintenance.enqueue.mock.invocationCallOrder[0]);
    });

    it('still enqueues the committed page change when indexing fails', async () => {
      const updated = { ...original, title: 'Updated', updatedAt: new Date('2026-07-27T08:01:00.000Z') };
      mockPrisma.page.findUnique.mockResolvedValueOnce(original).mockResolvedValueOnce(updated);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });
      mockSearch.indexPage.mockRejectedValueOnce(new Error('search offline'));

      await expect(service.update('page-1', {
        title: 'Updated',
        expectedUpdatedAt: original.updatedAt.toISOString(),
      } as any, 'user-1')).rejects.toThrow('search offline');

      expect(mockGraphMaintenance.enqueue).toHaveBeenCalledWith('space-1');
    });

    it('renames a title within its current directory and stores the old path in PageVersion', async () => {
      const updated = {
        ...original,
        title: 'Renamed',
        syncPath: 'guides/Renamed.md',
        syncPathKey: 'guides/renamed.md',
        updatedAt: new Date('2026-07-27T08:01:00.000Z'),
      };
      mockPrisma.page.findUnique.mockResolvedValueOnce(original).mockResolvedValueOnce(updated);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });
      mockSyncPaths.allocate.mockResolvedValue({
        path: 'guides/Renamed.md',
        pathKey: 'guides/renamed.md',
      });

      await service.update('page-1', {
        title: 'Renamed',
        expectedUpdatedAt: original.updatedAt.toISOString(),
      } as any, 'user-1');

      expect(mockRevisionWriter.lockSpace).toHaveBeenCalledWith(expect.anything(), 'space-1');
      expect(mockSyncPaths.allocate).toHaveBeenCalledWith(expect.anything(), {
        spaceId: 'space-1',
        directory: 'guides',
        title: 'Renamed',
        excludePageId: 'page-1',
      });
      expect(mockPrisma.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          syncPath: 'guides/Original.md',
          syncPathKey: 'guides/original.md',
        }),
      }));
      expect(mockPrisma.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          title: 'Renamed',
          syncPath: 'guides/Renamed.md',
          syncPathKey: 'guides/renamed.md',
        }),
      }));
    });

    it('preserves the path for a content-only update', async () => {
      const updated = {
        ...original,
        content: 'Updated content',
        updatedAt: new Date('2026-07-27T08:01:00.000Z'),
      };
      mockPrisma.page.findUnique.mockResolvedValueOnce(original).mockResolvedValueOnce(updated);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });

      await service.update('page-1', {
        content: 'Updated content',
        expectedUpdatedAt: original.updatedAt.toISOString(),
      } as any, 'user-1');

      expect(mockSyncPaths.allocate).not.toHaveBeenCalled();
      expect(mockPrisma.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.not.objectContaining({
          syncPath: expect.anything(),
          syncPathKey: expect.anything(),
        }),
      }));
      expect(mockRevisionWriter.advance).toHaveBeenCalledWith(
        expect.anything(),
        'space-1',
        [expect.objectContaining({ path: 'guides/Original.md', body: 'Updated content' })],
        expect.anything(),
      );
    });

    it('preserves the path when the changed title has the same sanitized basename', async () => {
      const equivalent = {
        ...original,
        title: 'A / B',
        syncPath: 'guides/A B.md',
        syncPathKey: 'guides/a b.md',
      };
      const updated = {
        ...equivalent,
        title: 'A <> B',
        updatedAt: new Date('2026-07-27T08:01:00.000Z'),
      };
      mockPrisma.page.findUnique.mockResolvedValueOnce(equivalent).mockResolvedValueOnce(updated);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });
      mockSyncPaths.allocate.mockResolvedValue({
        path: 'guides/A B.md',
        pathKey: 'guides/a b.md',
      });

      await service.update('page-1', {
        title: 'A <> B',
        expectedUpdatedAt: equivalent.updatedAt.toISOString(),
      } as any, 'user-1');

      expect(mockSyncPaths.allocate).not.toHaveBeenCalled();
      expect(mockPrisma.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.not.objectContaining({
          syncPath: expect.anything(),
          syncPathKey: expect.anything(),
        }),
      }));
    });

    it('uses the allocator collision suffix for a title rename', async () => {
      const updated = {
        ...original,
        title: 'Guide',
        syncPath: 'guides/Guide (2).md',
        syncPathKey: 'guides/guide (2).md',
        updatedAt: new Date('2026-07-27T08:01:00.000Z'),
      };
      mockPrisma.page.findUnique.mockResolvedValueOnce(original).mockResolvedValueOnce(updated);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });
      mockSyncPaths.allocate.mockResolvedValue({
        path: 'guides/Guide (2).md',
        pathKey: 'guides/guide (2).md',
      });

      await service.update('page-1', {
        title: 'Guide',
        expectedUpdatedAt: original.updatedAt.toISOString(),
      } as any, 'user-1');

      expect(mockPrisma.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          syncPath: 'guides/Guide (2).md',
          syncPathKey: 'guides/guide (2).md',
        }),
      }));
    });

    it('renames a root-level page without inventing a directory and locks before writing', async () => {
      const rootPage = {
        ...original,
        syncPath: 'Original.md',
        syncPathKey: 'original.md',
      };
      const updated = {
        ...rootPage,
        title: 'Renamed',
        syncPath: 'Renamed.md',
        syncPathKey: 'renamed.md',
        updatedAt: new Date('2026-07-27T08:01:00.000Z'),
      };
      mockPrisma.page.findUnique.mockResolvedValueOnce(rootPage).mockResolvedValueOnce(updated);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });
      mockSyncPaths.allocate.mockResolvedValue({
        path: 'Renamed.md',
        pathKey: 'renamed.md',
      });

      await service.update('page-1', {
        title: 'Renamed',
        expectedUpdatedAt: rootPage.updatedAt.toISOString(),
      } as any, 'user-1');

      expect(mockSyncPaths.allocate).toHaveBeenCalledWith(expect.anything(), {
        spaceId: 'space-1',
        directory: '',
        title: 'Renamed',
        excludePageId: 'page-1',
      });
      expect(mockRevisionWriter.lockSpace.mock.invocationCallOrder[0]).toBeLessThan(
        mockSyncPaths.allocate.mock.invocationCallOrder[0],
      );
      expect(mockSyncPaths.allocate.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.page.updateMany.mock.invocationCallOrder[0],
      );
    });

    it('writes the updated Page path to the revision', async () => {
      const updated = {
        ...original,
        title: 'Renamed',
        syncPath: 'guides/Renamed.md',
        syncPathKey: 'guides/renamed.md',
        updatedAt: new Date('2026-07-27T08:01:00.000Z'),
      };
      mockPrisma.page.findUnique.mockResolvedValueOnce(original).mockResolvedValueOnce(updated);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });
      mockSyncPaths.allocate.mockResolvedValue({
        path: updated.syncPath,
        pathKey: updated.syncPathKey,
      });

      await service.update('page-1', {
        title: 'Renamed',
        expectedUpdatedAt: original.updatedAt.toISOString(),
      } as any, 'user-1');

      expect(mockRevisionWriter.advance).toHaveBeenCalledWith(
        expect.anything(),
        'space-1',
        [expect.objectContaining({ path: updated.syncPath })],
        expect.anything(),
      );
    });
  });

  describe('remove', () => {
    it('enqueues a graph refresh after archiving a page', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'page-1', spaceId: 'space-1', authorId: 'user-1',
      } as any);
      mockPrisma.page.update.mockResolvedValue({
        id: 'page-1', spaceId: 'space-1', authorId: 'user-1', knowledgeKey: 'key-1', syncPath: 'pages/p-1.md',
      });

      await service.remove('page-1', '2026-08-20T00:00:00.000Z', '0');

      expect(mockGraphMaintenance.enqueue).toHaveBeenCalledWith('space-1');
      expect(mockSearch.deletePageIndex.mock.invocationCallOrder[0])
        .toBeLessThan(mockGraphMaintenance.enqueue.mock.invocationCallOrder[0]);
    });
  });

  describe('restoreVersion', () => {
    it('restores the title basename without changing the restored body', async () => {
      const current = {
        id: 'page-1',
        knowledgeKey: 'knowledge-1',
        title: 'Current title',
        content: 'Current body',
        slug: 'current-title',
        format: 'markdown',
        parentId: null,
        spaceId: 'space-1',
        authorId: 'user-1',
        syncPath: 'pages/Current title.md',
        syncPathKey: 'pages/current title.md',
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
      };
      const version = {
        id: 'version-1',
        pageId: 'page-1',
        title: 'Restored / title',
        content: 'Body must remain / exactly * unchanged.',
        slug: 'restored-title',
        format: 'markdown',
        parentId: null,
      };
      const restored = {
        ...current,
        title: version.title,
        content: version.content,
        slug: version.slug,
        syncPath: 'pages/Restored title.md',
        syncPathKey: 'pages/restored title.md',
      };
      jest.spyOn(service, 'findOne').mockResolvedValue(current as any);
      mockPrisma.pageVersion.findFirst.mockResolvedValue(version);
      mockPrisma.page.findUnique.mockResolvedValueOnce(current).mockResolvedValueOnce(restored);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });
      mockSyncPaths.allocate.mockResolvedValue({
        path: restored.syncPath,
        pathKey: restored.syncPathKey,
      });

      await service.restoreVersion('page-1', 'version-1', '0');

      expect(mockRevisionWriter.lockSpace).toHaveBeenCalledWith(expect.anything(), 'space-1');
      expect(mockSyncPaths.allocate).toHaveBeenCalledWith(expect.anything(), {
        spaceId: 'space-1',
        directory: 'pages',
        title: version.title,
        excludePageId: 'page-1',
      });
      expect(mockPrisma.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          syncPath: current.syncPath,
          syncPathKey: current.syncPathKey,
        }),
      }));
      expect(mockPrisma.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          id: current.id,
          spaceId: current.spaceId,
          deletedAt: null,
          updatedAt: current.updatedAt,
        },
        data: expect.objectContaining({
          title: version.title,
          content: version.content,
          syncPath: restored.syncPath,
          syncPathKey: restored.syncPathKey,
        }),
      }));
      expect(mockRevisionWriter.advance).toHaveBeenCalledWith(
        expect.anything(),
        'space-1',
        [expect.objectContaining({
          path: restored.syncPath,
          title: version.title,
          body: version.content,
        })],
        expect.anything(),
      );
    });

    it('renames a restored root-level page without inventing a directory and locks before writing', async () => {
      const current = {
        id: 'page-1',
        knowledgeKey: 'knowledge-1',
        title: 'Current',
        content: 'Current body',
        slug: 'current',
        format: 'markdown',
        parentId: null,
        spaceId: 'space-1',
        authorId: 'user-1',
        syncPath: 'Current.md',
        syncPathKey: 'current.md',
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
      };
      const version = {
        id: 'version-1',
        pageId: 'page-1',
        title: 'Restored',
        content: 'Restored body',
        slug: 'restored',
        format: 'markdown',
        parentId: null,
      };
      const restored = {
        ...current,
        title: version.title,
        content: version.content,
        syncPath: 'Restored.md',
        syncPathKey: 'restored.md',
      };
      jest.spyOn(service, 'findOne').mockResolvedValue(current as any);
      mockPrisma.pageVersion.findFirst.mockResolvedValue(version);
      mockPrisma.page.findUnique.mockResolvedValueOnce(current).mockResolvedValueOnce(restored);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });
      mockSyncPaths.allocate.mockResolvedValue({
        path: restored.syncPath,
        pathKey: restored.syncPathKey,
      });

      await service.restoreVersion('page-1', 'version-1', '0');

      expect(mockSyncPaths.allocate).toHaveBeenCalledWith(expect.anything(), {
        spaceId: 'space-1',
        directory: '',
        title: 'Restored',
        excludePageId: 'page-1',
      });
      expect(mockRevisionWriter.lockSpace.mock.invocationCallOrder[0]).toBeLessThan(
        mockSyncPaths.allocate.mock.invocationCallOrder[0],
      );
      expect(mockSyncPaths.allocate.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.page.updateMany.mock.invocationCallOrder[0],
      );
    });

    it('re-reads the active Page after locking and snapshots that current state', async () => {
      const stale = {
        id: 'page-1',
        knowledgeKey: 'knowledge-1',
        title: 'Stale title',
        content: 'Stale body',
        slug: 'stale',
        format: 'markdown',
        parentId: null,
        spaceId: 'space-1',
        authorId: 'stale-author',
        syncPath: 'stale/Stale title.md',
        syncPathKey: 'stale/stale title.md',
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
      };
      const current = {
        ...stale,
        title: 'Current title',
        content: 'Current body',
        slug: 'current',
        format: 'mdx',
        authorId: 'current-author',
        syncPath: 'current/Current title.md',
        syncPathKey: 'current/current title.md',
      };
      const version = {
        id: 'version-1',
        pageId: 'page-1',
        title: 'Restored title',
        content: 'Restored body remains exact.',
        slug: null,
        format: null,
        parentId: null,
      };
      const restored = {
        ...current,
        title: version.title,
        content: version.content,
        syncPath: 'current/Restored title.md',
        syncPathKey: 'current/restored title.md',
        updatedAt: new Date('2026-08-20T00:01:00.000Z'),
      };
      jest.spyOn(service, 'findOne').mockResolvedValue(stale as any);
      mockPrisma.pageVersion.findFirst.mockResolvedValue(version);
      mockPrisma.page.findUnique
        .mockImplementationOnce(async () => {
          expect(mockRevisionWriter.lockSpace).toHaveBeenCalledWith(expect.anything(), 'space-1');
          return current;
        })
        .mockResolvedValueOnce(restored);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });
      mockSyncPaths.allocate.mockResolvedValue({
        path: restored.syncPath,
        pathKey: restored.syncPathKey,
      });

      await service.restoreVersion('page-1', 'version-1', '0');

      expect(mockPrisma.pageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          title: current.title,
          content: current.content,
          authorId: current.authorId,
          slug: current.slug,
          format: current.format,
          syncPath: current.syncPath,
          syncPathKey: current.syncPathKey,
        }),
      }));
      expect(mockSyncPaths.allocate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        directory: 'current',
      }));
      expect(mockPrisma.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          id: current.id,
          spaceId: current.spaceId,
          deletedAt: null,
          updatedAt: current.updatedAt,
        },
        data: expect.objectContaining({
          slug: current.slug,
          format: current.format,
          lastModifiedByUserId: current.authorId,
        }),
      }));
      expect(mockRevisionWriter.lockSpace.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.page.findUnique.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.pageVersion.create.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.page.updateMany.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.page.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.page.findUnique.mock.invocationCallOrder[1],
      );
    });

    it('preserves the current path when the restored title has the same sanitized basename', async () => {
      const current = {
        id: 'page-1',
        knowledgeKey: 'knowledge-1',
        title: 'A / B',
        content: 'Current body',
        slug: 'a-b',
        format: 'markdown',
        parentId: null,
        spaceId: 'space-1',
        authorId: 'user-1',
        syncPath: 'pages/A B (2).md',
        syncPathKey: 'pages/a b (2).md',
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
      };
      const version = {
        id: 'version-1',
        pageId: 'page-1',
        title: 'A <> B',
        content: 'Body / stays * byte-for-byte.',
        slug: 'a-b-restored',
        format: 'markdown',
        parentId: null,
      };
      const restored = {
        ...current,
        title: version.title,
        content: version.content,
      };
      jest.spyOn(service, 'findOne').mockResolvedValue(current as any);
      mockPrisma.pageVersion.findFirst.mockResolvedValue(version);
      mockPrisma.page.findUnique.mockResolvedValueOnce(current).mockResolvedValueOnce(restored);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });

      await service.restoreVersion('page-1', 'version-1', '0');

      expect(mockSyncPaths.allocate).not.toHaveBeenCalled();
      expect(mockPrisma.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          title: version.title,
          content: version.content,
          syncPath: current.syncPath,
          syncPathKey: current.syncPathKey,
        }),
      }));
      expect(mockRevisionWriter.advance).toHaveBeenCalledWith(
        expect.anything(),
        'space-1',
        [expect.objectContaining({
          path: current.syncPath,
          body: version.content,
        })],
        expect.anything(),
      );
    });

    it('rejects a competing reorder after the snapshot and rolls back the pending PageVersion', async () => {
      const snapshotUpdatedAt = new Date('2026-08-20T00:00:00.000Z');
      const reorderedUpdatedAt = new Date('2026-08-20T00:00:01.000Z');
      const visible = { id: 'page-1', spaceId: 'space-1' };
      const version = {
        id: 'version-1',
        pageId: 'page-1',
        title: 'Restored title',
        content: 'Restored body',
        slug: 'restored-title',
        format: 'markdown',
        parentId: null,
      };
      const committed = {
        page: {
          id: 'page-1',
          knowledgeKey: 'knowledge-1',
          title: 'Current title',
          content: 'Current body',
          slug: 'current-title',
          format: 'markdown',
          parentId: null as string | null,
          spaceId: 'space-1',
          authorId: 'user-1',
          syncPath: 'pages/Current title.md',
          syncPathKey: 'pages/current title.md',
          updatedAt: snapshotUpdatedAt,
          deletedAt: null,
        },
        versions: [] as Array<Record<string, unknown>>,
        revisions: 0,
        searchDocuments: 0,
      };
      jest.spyOn(service, 'findOne').mockResolvedValue(visible as any);
      mockPrisma.$transaction.mockImplementationOnce(async (callback: any) => {
        const pendingVersions: Array<Record<string, unknown>> = [];
        const tx = {
          ...mockPrisma,
          page: {
            ...mockPrisma.page,
            findUnique: jest.fn().mockImplementation(async () => ({ ...committed.page })),
            update: jest.fn().mockImplementation(async ({ data }: any) => {
              // The current implementation lets this committed reorder win the race,
              // then overwrites it with the stale restore snapshot.
              committed.page.parentId = 'parent-2';
              committed.page.updatedAt = reorderedUpdatedAt;
              committed.page = { ...committed.page, ...data };
              return { ...committed.page };
            }),
            updateMany: jest.fn().mockImplementation(async ({ where }: any) => {
              // A reorder commits after restore's locked snapshot but before its write.
              committed.page.parentId = 'parent-2';
              committed.page.updatedAt = reorderedUpdatedAt;
              return {
                count: where.updatedAt.getTime() === committed.page.updatedAt.getTime() ? 1 : 0,
              };
            }),
          },
          pageVersion: {
            ...mockPrisma.pageVersion,
            findFirst: jest.fn().mockResolvedValue(version),
            create: jest.fn().mockImplementation(async ({ data }: any) => {
              pendingVersions.push(data);
              return data;
            }),
          },
          pageSearchDocument: {
            ...mockPrisma.pageSearchDocument,
            upsert: jest.fn().mockImplementation(async () => {
              committed.searchDocuments += 1;
            }),
          },
        };
        const result = await callback(tx);
        // Only a committed transaction publishes its pending PageVersion.
        committed.versions.push(...pendingVersions);
        return result;
      });
      mockRevisionWriter.advance.mockImplementationOnce(async () => {
        committed.revisions += 1;
      });

      await expect(service.restoreVersion('page-1', 'version-1', '0')).rejects.toMatchObject({
        statusCode: 409,
        businessCode: 'RESOURCE_CONFLICT',
      });

      expect(committed.page.parentId).toBe('parent-2');
      expect(committed.page.updatedAt).toEqual(reorderedUpdatedAt);
      expect(committed.versions).toEqual([]);
      expect(committed.revisions).toBe(0);
      expect(committed.searchDocuments).toBe(0);
      expect(mockSearch.indexPage).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('locks and snapshots the current Page before archiving it', async () => {
      const visible = {
        id: 'page-1',
        spaceId: 'space-1',
      };
      const current = {
        id: 'page-1',
        knowledgeKey: 'knowledge-1',
        spaceId: 'space-1',
        title: 'Current title',
        content: 'Current body',
        authorId: 'user-1',
        slug: 'current-title',
        format: 'markdown',
        parentId: null,
        syncPath: 'guides/Current title.md',
        syncPathKey: 'guides/current title.md',
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
        deletedAt: null,
      };
      const archived = {
        ...current,
        updatedAt: new Date('2026-08-20T00:01:00.000Z'),
        deletedAt: new Date('2026-08-20T00:01:00.000Z'),
      };
      jest.spyOn(service, 'findOne').mockResolvedValue(visible as any);
      mockPrisma.page.findUnique.mockResolvedValueOnce(current).mockResolvedValueOnce(archived);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.remove(
        'page-1', current.updatedAt.toISOString(), '0',
      )).resolves.toEqual({
        ...archived,
        path: archived.syncPath,
      });

      expect(mockRevisionWriter.lockSpace).toHaveBeenCalledWith(mockPrisma, 'space-1');
      expect(mockRevisionWriter.lockSpace.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.page.findUnique.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.page.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.pageVersion.create.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.pageVersion.create).toHaveBeenCalledWith({
        data: {
          pageId: current.id,
          title: current.title,
          content: current.content,
          authorId: current.authorId,
          slug: current.slug,
          format: current.format,
          parentId: current.parentId,
          syncPath: current.syncPath,
          syncPathKey: current.syncPathKey,
        },
      });
      expect(mockPrisma.pageVersion.create.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.page.updateMany.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.page.updateMany).toHaveBeenCalledWith({
        where: {
          id: current.id,
          spaceId: current.spaceId,
          deletedAt: null,
          updatedAt: current.updatedAt,
        },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockPrisma.page.findUnique).toHaveBeenNthCalledWith(2, expect.objectContaining({
        where: { id: current.id, spaceId: current.spaceId, deletedAt: { not: null } },
      }));
      expect(mockPrisma.page.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.page.findUnique.mock.invocationCallOrder[1],
      );
    });

    it('rejects a concurrent Page change without advancing the revision', async () => {
      const visible = { id: 'page-1', spaceId: 'space-1' };
      const current = {
        id: 'page-1',
        knowledgeKey: 'knowledge-1',
        spaceId: 'space-1',
        title: 'Current title',
        content: 'Current body',
        authorId: 'user-1',
        slug: 'current-title',
        format: 'markdown',
        parentId: null,
        syncPath: 'guides/Current title.md',
        syncPathKey: 'guides/current title.md',
        updatedAt: new Date('2026-08-20T00:00:00.000Z'),
        deletedAt: null,
      };
      jest.spyOn(service, 'findOne').mockResolvedValue(visible as any);
      mockPrisma.page.findUnique.mockResolvedValueOnce(current);
      mockPrisma.page.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.remove(
        'page-1', current.updatedAt.toISOString(), '0',
      )).rejects.toMatchObject({
        statusCode: 409,
        businessCode: 'RESOURCE_CONFLICT',
      });

      expect(mockPrisma.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ updatedAt: current.updatedAt }),
      }));
      expect(mockRevisionWriter.advance).not.toHaveBeenCalled();
      expect(mockPrisma.page.findUnique).toHaveBeenCalledTimes(1);
      expect(mockSearch.deletePageIndex).not.toHaveBeenCalled();
    });

    it('rejects the legacy Page-parent reorder contract even when create compatibility is enabled', async () => {
      const previous = process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
      process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = 'true';
      try {
        await expect(service.reorder('space-1', [
          { id: 'page-1', parentId: null, sortOrder: 0 },
        ])).rejects.toMatchObject({ businessCode: 'PAGE_PARENT_DEPRECATED' });
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined) delete process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
        else process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = previous;
      }
    });
  });
});

describe('page hierarchy reads', () => {
  let service: PageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PageService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SearchService, useValue: mockSearch },
        { provide: SpaceRevisionWriterService, useValue: mockRevisionWriter },
        { provide: ReadableSyncPathService, useValue: mockSyncPaths },
        { provide: GraphMaintenance, useValue: mockGraphMaintenance },
        { provide: PageTemplateService, useValue: mockTemplates },
        { provide: AuthorizationService, useValue: mockAuthorization },
        { provide: ContentTreeService, useValue: mockContentTree },
      ],
    }).compile();
    service = module.get<PageService>(PageService);
  });

  it('findHierarchy queries pages ordered by sortOrder then createdAt', async () => {
    mockPrisma.page.findMany.mockResolvedValue([]);
    await service.findHierarchy('space-1');
    expect(mockPrisma.page.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }));
  });
});
