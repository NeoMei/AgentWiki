import { ReviewController } from './review.controller';

describe('review query authorization and compatibility', () => {
  const principal = { userId: 'owner' };
  const review = { list: jest.fn().mockResolvedValue([]), listPage: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
  const authorization = { getAccessibleSpaceIds: jest.fn().mockResolvedValue(['allowed']) };
  const controller = new ReviewController(review as any, authorization as any);
  beforeEach(() => jest.clearAllMocks());

  it('keeps unpaginated legacy reads as arrays', async () => {
    expect(await controller.list({ user: principal } as any, { spaceId: 'allowed' })).toEqual([]);
    expect(review.list).toHaveBeenCalledWith(['allowed'], principal);
    expect(review.listPage).not.toHaveBeenCalled();
  });
  it('derives the paginated scope from authorization, never query input', async () => {
    await controller.list({ user: principal } as any, { page: '2', q: 'candidate', spaceId: 'allowed' });
    expect(review.listPage).toHaveBeenCalledWith(['allowed'], principal, expect.objectContaining({ page: 2, q: 'candidate' }), 'allowed');
    expect(authorization.getAccessibleSpaceIds).toHaveBeenCalledWith(principal, 'review:read');
  });
  it('rejects an inaccessible requested space before executing search', async () => {
    await expect(controller.list({ user: principal } as any, { page: '1', spaceId: 'private' })).rejects.toMatchObject({ status: 403 });
    expect(review.listPage).not.toHaveBeenCalled();
    expect(review.list).not.toHaveBeenCalled();
  });
});
