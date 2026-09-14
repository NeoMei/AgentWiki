import { ReviewService } from './review.service';

function fixture(items: any[]) {
  const prisma = {
    changeSet: { findUnique: jest.fn().mockResolvedValue({ id: 'cs', spaceId: 'space', status: 'pending_review', items }) },
    page: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  } as any;
  const service = new ReviewService(prisma, {} as any, {} as any, {} as any);
  return { prisma, service };
}

describe('Review detail existing-content advisory', () => {
  it('groups repeated raw bodies, bounds examples and excludes each update target', async () => {
    const { prisma, service } = fixture([
      { id: 'create', type: 'create_page', payload: { content: 'Exact body' } },
      { id: 'update', type: 'update_page', payload: { pageId: 'p0', changes: { content: 'Exact body' } } },
      { id: 'update-other', type: 'update_page', payload: { pageId: 'p1', changes: { content: 'Exact body' } } },
    ]);
    const pages = Array.from({ length: 6 }, (_, index) => ({ id: `p${index}`, title: `Existing ${index}` }));
    prisma.$queryRaw.mockResolvedValue(pages.map(page => ({ ...page, groupIndex: 0 })));
    expect((await service.get('cs') as any).duplicateContentWarnings).toEqual([
      { itemId: 'create', pages: pages.slice(0, 5) },
      { itemId: 'update', pages: pages.slice(1) },
      { itemId: 'update-other', pages: pages.filter(page => page.id !== 'p1').slice(0, 5) },
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw.mock.calls[0][0].values).toEqual(['["Exact body"]', 'space']);

  });

  it('does not normalize candidate bodies or query empty/non-body items', async () => {
    const { prisma, service } = fixture([
      { id: 'empty', type: 'create_page', payload: { content: '' } },
      { id: 'rename', type: 'update_page', payload: { pageId: 'target', changes: { title: 'Rename' } } },
      { id: 'archive', type: 'archive_page', payload: { content: 'Body' } },
      { id: 'one', type: 'create_page', payload: { content: 'Body\n' } },
      { id: 'two', type: 'create_page', payload: { content: 'Body\r\n' } },
    ]);
    expect((await service.get('cs') as any).duplicateContentWarnings).toEqual([]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(JSON.parse(prisma.$queryRaw.mock.calls[0][0].values[0])).toEqual(['Body\n', 'Body\r\n']);
  });

  it('omits warnings if the only existing match is the updated Page', async () => {
    const { prisma, service } = fixture([
      { id: 'update', type: 'update_page', payload: { pageId: 'target', changes: { content: 'Body' } } },
    ]);
    prisma.$queryRaw.mockResolvedValue([{ groupIndex: 0, id: 'target', title: 'Current page' }]);
    expect((await service.get('cs') as any).duplicateContentWarnings).toEqual([]);
  });
  it('uses one set lookup for 500 distinct candidate bodies', async () => {
    const { prisma, service } = fixture(Array.from({ length: 500 }, (_, index) => ({
      id: `item-${index}`, type: 'create_page', payload: { content: `Body ${index}` },
    })));
    prisma.$queryRaw = jest.fn().mockResolvedValue([]);
    expect((await service.get('cs') as any).duplicateContentWarnings).toEqual([]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.page.findMany).not.toHaveBeenCalled();
  });

});
