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

describe('PageController.findOne', () => {
  it.each([
    ['owner', false, 'user', true],
    ['editor', false, 'user', true],
    ['admin', false, 'user', false],
    ['viewer', false, 'user', false],
    ['owner', true, 'user', false],
    ['viewer', false, 'super_admin', true],
  ] as const)(
    'maps role %s, agent=%s, platformRole=%s to canEdit=%s',
    async (role, agent, platformRole, canEdit) => {
      const pageService = {
        findOne: jest.fn().mockResolvedValue({
          id: 'page-1',
          spaceId: 'space-1',
          title: 'Page 1',
        }),
      } as any;
      const authorization = {
        assertPageAccess: jest.fn().mockResolvedValue({ id: 'page-1', spaceId: 'space-1' }),
        assertSpaceAccess: jest.fn().mockResolvedValue({ role }),
      } as any;
      const controller = new PageController(pageService, authorization, { propose: jest.fn() } as any);
      const principal = {
        userId: 'user-1',
        platformRole,
        ...(agent ? { agentId: 'agent-1' } : {}),
      };

      const result = await controller.findOne('page-1', { user: principal } as any);

      expect(result.capabilities).toEqual({ canEdit });
      expect(authorization.assertPageAccess).toHaveBeenCalledWith(
        principal,
        'page-1',
        ['owner', 'admin', 'editor', 'viewer'],
        'pages:read',
      );
      expect(authorization.assertSpaceAccess).toHaveBeenCalledWith(
        principal,
        'space-1',
        ['owner', 'admin', 'editor', 'viewer'],
        'pages:read',
      );
    },
  );
});

describe('PageController.update', () => {
  it('keeps direct PATCH authorization limited to owner and editor roles', async () => {
    const pageService = { update: jest.fn().mockResolvedValue({ id: 'page-1' }) } as any;
    const authorization = {
      assertPageAccess: jest.fn().mockResolvedValue({ id: 'page-1', spaceId: 'space-1' }),
    } as any;
    const controller = new PageController(pageService, authorization, { propose: jest.fn() } as any);
    const principal = { userId: 'user-1', platformRole: 'user' as const };
    const dto = { title: 'Updated', expectedUpdatedAt: '2026-08-26T00:00:00.000Z' };

    await controller.update('page-1', dto, { user: principal } as any);

    expect(authorization.assertPageAccess).toHaveBeenCalledWith(
      principal,
      'page-1',
      ['owner', 'editor'],
      'pages:write',
    );
  });
});
