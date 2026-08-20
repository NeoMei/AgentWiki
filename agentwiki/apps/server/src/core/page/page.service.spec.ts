import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PageService } from './page.service';
import { PrismaService } from '../../database/prisma.service';
import { SearchService } from '../search/search.service';
import { SpaceRevisionWriterService } from '../sync/space-revision-writer.service';
import { ReadableSyncPathService } from '../sync/readable-sync-path.service';

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
  $transaction: jest.fn(),
};

const mockSearch = {
  indexPage: jest.fn().mockResolvedValue(undefined),
  deletePageIndex: jest.fn().mockResolvedValue(undefined),
};

const mockRevisionWriter = {
  advance: jest.fn().mockResolvedValue({}),
  lockSpace: jest.fn().mockResolvedValue(undefined),
};

const mockSyncPaths = {
  allocate: jest.fn(),
};

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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PageService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SearchService, useValue: mockSearch },
        { provide: SpaceRevisionWriterService, useValue: mockRevisionWriter },
        { provide: ReadableSyncPathService, useValue: mockSyncPaths },
      ],
    }).compile();

    service = module.get<PageService>(PageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a page', async () => {
      const dto = { title: 'Test', spaceId: 'space-1' };
      mockPrisma.space.findUnique.mockResolvedValue({ id: 'space-1' });
      mockPrisma.page.create.mockResolvedValue({ id: '1', ...dto });
      const result = await service.create(dto as any, 'user-1');
      expect(result.id).toBe('1');
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
      } as any, 'user-1');

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
    });
  });

  describe('update', () => {
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
      mockPrisma.page.findUnique.mockResolvedValue(current);
      mockPrisma.page.update.mockResolvedValue(restored);
      mockSyncPaths.allocate.mockResolvedValue({
        path: restored.syncPath,
        pathKey: restored.syncPathKey,
      });

      await service.restoreVersion('page-1', 'version-1');

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
      expect(mockPrisma.page.update).toHaveBeenCalledWith(expect.objectContaining({
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
  });
});

describe('page ordering', () => {
  let service: PageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
    );
    mockSyncPaths.allocate.mockResolvedValue({
      path: 'pages/Test.md',
      pathKey: 'pages/test.md',
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PageService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SearchService, useValue: mockSearch },
        { provide: SpaceRevisionWriterService, useValue: mockRevisionWriter },
        { provide: ReadableSyncPathService, useValue: mockSyncPaths },
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

  it('reorder updates parent and sortOrder for each item', async () => {
    mockPrisma.page.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    mockPrisma.page.updateMany.mockResolvedValue({ count: 1 });
    await service.reorder('space-1', [
      { id: 'a', parentId: null, sortOrder: 0 },
      { id: 'b', parentId: 'a', sortOrder: 1 },
    ]);
    expect(mockPrisma.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'b', spaceId: 'space-1' },
      data: { parentId: 'a', sortOrder: 1 },
    }));
  });

  it('reorder rejects items outside the space', async () => {
    mockPrisma.page.findMany.mockResolvedValueOnce([]);
    await expect(
      service.reorder('space-1', [{ id: 'b', parentId: null, sortOrder: 0 }]),
    ).rejects.toMatchObject({ message: expect.stringContaining('do not belong') });
  });

  it('reorder rejects a cycle in the new parent assignment', async () => {
    mockPrisma.page.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await expect(
      service.reorder('space-1', [
        { id: 'a', parentId: 'b', sortOrder: 0 },
        { id: 'b', parentId: 'a', sortOrder: 0 },
      ]),
    ).rejects.toMatchObject({ message: expect.stringContaining('cycle') });
  });

  it('reorder rejects a parent outside the space', async () => {
    mockPrisma.page.findMany
      .mockResolvedValueOnce([{ id: 'a' }])
      .mockResolvedValueOnce([{ id: 'a', parentId: null }]);

    await expect(
      service.reorder('space-1', [{ id: 'a', parentId: 'other-space-page', sortOrder: 0 }]),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockPrisma.page.updateMany).not.toHaveBeenCalled();
  });

  it('reorder rejects a cycle completed through an existing parent assignment', async () => {
    mockPrisma.page.findMany
      .mockResolvedValueOnce([{ id: 'a' }])
      .mockResolvedValueOnce([
        { id: 'a', parentId: null },
        { id: 'b', parentId: 'a' },
      ]);

    await expect(
      service.reorder('space-1', [{ id: 'a', parentId: 'b', sortOrder: 0 }]),
    ).rejects.toMatchObject({ message: expect.stringContaining('cycle') });

    expect(mockPrisma.page.updateMany).not.toHaveBeenCalled();
  });
});
