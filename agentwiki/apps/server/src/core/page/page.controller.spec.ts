import { PageController } from './page.controller';
import { AuthorizationService } from '../authorization/authorization.service';

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
      { title: 'Human page', spaceId: 'space-1', expectedTreeRevision: '0' },
      { user: principal } as any,
    );

    expect(pageService.create).toHaveBeenCalledWith(
      { title: 'Human page', spaceId: 'space-1', expectedTreeRevision: '0' }, principal,
    );
    expect(review.propose).not.toHaveBeenCalled();
  });

  it('carries Folder placement and tree revision into the established Agent review proposal', async () => {
    const pageService = { create: jest.fn() } as any;
    const authorization = { assertSpaceAccess: jest.fn().mockResolvedValue({ role: 'editor' }) } as any;
    const review = { propose: jest.fn().mockResolvedValue({ id: 'change-set-1' }) } as any;
    const controller = new PageController(pageService, authorization, review);
    const principal = { agentId: 'agent-1', platformRole: 'user' as const };

    await controller.create({
      title: 'Agent page', spaceId: 'space-1', folderId: 'folder-1', expectedTreeRevision: '9',
    }, { user: principal } as any);

    expect(review.propose).toHaveBeenCalledWith(
      principal,
      'space-1',
      'Proposed page: Agent page',
      expect.objectContaining({ payload: expect.objectContaining({
        folderId: 'folder-1', expectedTreeRevision: '9',
      }) }),
    );
    expect(review.propose.mock.calls[0][3].payload).not.toHaveProperty('parentId');
  });

  it('does not let the Agent review path bypass the legacy parent migration flag', async () => {
    const pageService = { create: jest.fn() } as any;
    const authorization = { assertSpaceAccess: jest.fn().mockResolvedValue({ role: 'editor' }) } as any;
    const review = { propose: jest.fn() } as any;
    const controller = new PageController(pageService, authorization, review);
    const previous = process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
    delete process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
    try {
      await expect(controller.create({
        title: 'Legacy', spaceId: 'space-1', parentId: 'page-parent', expectedTreeRevision: '0',
      }, { user: { agentId: 'agent-1', platformRole: 'user' } } as any))
        .rejects.toMatchObject({ businessCode: 'PAGE_PARENT_DEPRECATED' });
      expect(review.propose).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
      else process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = previous;
    }
  });

  it('keeps the migration-only Agent parent proposal unambiguous when the flag is enabled', async () => {
    const pageService = { create: jest.fn() } as any;
    const authorization = { assertSpaceAccess: jest.fn().mockResolvedValue({ role: 'editor' }) } as any;
    const review = { propose: jest.fn().mockResolvedValue({ id: 'change-set-1' }) } as any;
    const controller = new PageController(pageService, authorization, review);
    const previous = process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
    process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = 'true';
    try {
      await controller.create({
        title: 'Legacy', spaceId: 'space-1', parentId: 'page-parent', expectedTreeRevision: '3',
      }, { user: { agentId: 'agent-1', platformRole: 'user' } } as any);
      expect(review.propose).toHaveBeenCalledWith(
        expect.anything(), 'space-1', expect.any(String),
        expect.objectContaining({ payload: expect.objectContaining({
          parentId: 'page-parent', expectedTreeRevision: '3',
        }) }),
      );
      expect(review.propose.mock.calls[0][3].payload).not.toHaveProperty('folderId');
    } finally {
      if (previous === undefined) delete process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE;
      else process.env.ALLOW_LEGACY_PAGE_PARENT_WRITE = previous;
    }
  });
});

describe('PageController.restoreVersion', () => {
  it('passes the required caller tree revision to the structural restore path', async () => {
    const pageService = { restoreVersion: jest.fn().mockResolvedValue({ id: 'page-1' }) } as any;
    const authorization = {
      assertPageAccess: jest.fn().mockResolvedValue({ id: 'page-1', spaceId: 'space-1' }),
    } as any;
    const controller = new PageController(pageService, authorization, { propose: jest.fn() } as any);
    const request = { user: { userId: 'user-1', platformRole: 'user' } } as any;

    await controller.restoreVersion('page-1', 'version-1', { expectedTreeRevision: '15' }, request);

    expect(pageService.restoreVersion).toHaveBeenNthCalledWith(1, 'page-1', 'version-1', '15', request.user);
  });
});

describe('PageController.remove', () => {
  const dto = {
    expectedUpdatedAt: '2026-08-28T00:00:00.000Z', expectedTreeRevision: '21',
  };

  it('delegates the caller Page/tree CAS values for a human archive', async () => {
    const pageService = { remove: jest.fn().mockResolvedValue({ id: 'page-1' }) } as any;
    const authorization = {
      assertPageAccess: jest.fn().mockResolvedValue({ id: 'page-1', spaceId: 'space-1' }),
    } as any;
    const controller = new PageController(pageService, authorization, { propose: jest.fn() } as any);

    await (controller.remove as any)('page-1', dto, {
      user: { userId: 'user-1', platformRole: 'user' },
    });

    expect(pageService.remove).toHaveBeenCalledWith(
      'page-1', dto.expectedUpdatedAt, dto.expectedTreeRevision, expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('stores the caller Page/tree CAS values in an Agent archive proposal without reading current state', async () => {
    const pageService = { findOne: jest.fn() } as any;
    const authorization = {
      assertPageAccess: jest.fn().mockResolvedValue({ id: 'page-1', spaceId: 'space-1' }),
    } as any;
    const review = { propose: jest.fn().mockResolvedValue({ id: 'change-set-1' }) } as any;
    const controller = new PageController(pageService, authorization, review);
    const principal = { agentId: 'agent-1', userId: 'user-1', platformRole: 'user' as const };

    await (controller.remove as any)('page-1', dto, { user: principal });

    expect(review.propose).toHaveBeenCalledWith(
      principal, 'space-1', 'Proposed delete: page-1', {
        type: 'archive_page',
        payload: { pageId: 'page-1', ...dto },
      },
    );
    expect(pageService.findOne).not.toHaveBeenCalled();
  });
});

describe('PageController.findOne', () => {
  it.each([
    ['owner', false, 'user', true, true],
    ['editor', false, 'user', true, true],
    ['admin', false, 'user', true, false],
    ['viewer', false, 'user', false, false],
    ['owner', true, 'user', false, false],
    ['owner', true, 'super_admin', false, false],
    ['viewer', false, 'super_admin', true, true],
  ] as const)(
    'maps role %s, agent=%s, platformRole=%s to canEdit=%s and canManageAttachments=%s',
    async (role, agent, platformRole, canEdit, canManageAttachments) => {
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

      expect(result.capabilities).toEqual({ canEdit, canManageAttachments });
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
  it('uses the established content-write authorization gate for direct PATCH', async () => {
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

  it('allows human admin PATCH and reports a matching direct-edit capability through live authorization', async () => {
    const prisma = {
      page: { findUnique: jest.fn().mockResolvedValue({ id: 'page-1', spaceId: 'space-1' }) },
      space: { findUnique: jest.fn().mockResolvedValue({ id: 'space-1', deletedAt: null }) },
      spaceMember: {
        findUnique: jest.fn().mockResolvedValue({
          role: 'admin',
          space: { deletedAt: null },
        }),
      },
    };
    const authorization = new AuthorizationService(prisma as any);
    const pageService = {
      update: jest.fn().mockResolvedValue({ id: 'page-1', title: 'Updated' }),
      findOne: jest.fn().mockResolvedValue({ id: 'page-1', spaceId: 'space-1', title: 'Updated' }),
    } as any;
    const controller = new PageController(pageService, authorization, { propose: jest.fn() } as any);
    const principal = { userId: 'admin-1', platformRole: 'user' as const };
    const dto = { title: 'Updated', expectedUpdatedAt: '2026-08-26T00:00:00.000Z' };

    await expect(controller.update('page-1', dto, { user: principal } as any))
      .resolves.toEqual({ id: 'page-1', title: 'Updated' });
    await expect(controller.findOne('page-1', { user: principal } as any))
      .resolves.toMatchObject({ capabilities: { canEdit: true } });
  });
});
