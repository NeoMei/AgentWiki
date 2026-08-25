import { PageController } from './page.controller';

describe('PageController.create', () => {
  it('passes the complete human principal to the locked PageService create path', async () => {
    const pageService = { create: jest.fn().mockResolvedValue({ id: 'page-1' }) } as any;
    const authorization = { assertSpaceAccess: jest.fn().mockResolvedValue({ role: 'owner' }) } as any;
    const review = { propose: jest.fn() } as any;
    const controller = new PageController(pageService, authorization, review);
    const principal = {
      userId: 'admin-1', platformRole: 'super_admin' as const, mustChangePassword: false,
    };

    await controller.create(
      { title: 'Human page', spaceId: 'space-1' },
      { user: principal } as any,
    );

    expect(pageService.create).toHaveBeenCalledWith(
      { title: 'Human page', spaceId: 'space-1' }, principal,
    );
    expect(review.propose).not.toHaveBeenCalled();
  });
});
