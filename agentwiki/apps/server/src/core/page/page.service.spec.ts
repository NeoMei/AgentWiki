import { Test, TestingModule } from '@nestjs/testing';
import { PageService } from './page.service';
import { PrismaService } from '../../database/prisma.service';
import { SearchService } from '../search/search.service';

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

describe('PageService', () => {
  let service: PageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(mockPrisma));
    mockPrisma.evidence.findMany.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PageService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SearchService, useValue: mockSearch },
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
  });
});
