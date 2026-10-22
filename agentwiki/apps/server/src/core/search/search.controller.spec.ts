import { SearchController } from './search.controller';

describe('SearchController result window', () => {
  function setup(count: number) {
    const rows = Array.from({ length: count }, (_, index) => ({ page: { id: `p${index}`, spaceId: 'allowed', path: `pages/Folder/P${index}.md` }, similarity: 0, matchType: 'text' }));
    const search = { searchPages: jest.fn(async (_query, _space, limit) => rows.slice(0, limit)) };
    const freshness = { projectPages: jest.fn(async (pages) => pages) };
    const authorization = { getAccessibleSpaceIds: jest.fn(async () => ['allowed']), assertSpaceAccess: jest.fn() };
    return { controller: new SearchController(freshness as any, search as any, authorization as any), search, freshness };
  }

  it('reports more results without misreporting the window size as an exact total', async () => {
    const { controller, search, freshness } = setup(12);
    const response = await controller.search({ user: { id: 'user' } } as any, 'term');
    expect(response.results).toHaveLength(10);
    expect(response).toMatchObject({ returnedCount: 10, limit: 10, maxLimit: 100, hasMore: true });
    expect(search.searchPages).toHaveBeenCalledWith('term', undefined, 11, ['allowed']);
    expect(freshness.projectPages.mock.calls[0][0]).toHaveLength(10);
  });

  it('distinguishes the end of a search from a full window', async () => {
    const { controller } = setup(10);
    await expect(controller.search({ user: {} } as any, 'term')).resolves.toMatchObject({ returnedCount: 10, hasMore: false });
  });

  it('keeps the public cap at 100 while checking whether further matches exist', async () => {
    const { controller } = setup(130);
    const response = await controller.search({ user: {} } as any, 'term', undefined, '1000');
    expect(response.results).toHaveLength(100);
    expect(response).toMatchObject({ returnedCount: 100, limit: 100, maxLimit: 100, hasMore: true });
  });
});
