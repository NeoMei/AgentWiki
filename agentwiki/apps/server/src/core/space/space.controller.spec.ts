import { ForbiddenException } from '@nestjs/common';
import { BusinessException } from '../filters/business-error';
import { SpaceController } from './space.controller';
import { SpaceService } from './space.service';

describe('SpaceController.create', () => {
  const spaces = { create: jest.fn() } as any;
  const controller = new SpaceController(spaces, {} as any);

  beforeEach(() => jest.clearAllMocks());

  it('lets a human super admin create a Space as themselves', async () => {
    spaces.create.mockResolvedValue({ id: 'space-new', name: '新空间' });
    await expect(controller.create(
      { name: '新空间' } as any,
      { user: { userId: 'admin-1', platformRole: 'super_admin', type: 'human' } } as any,
    )).resolves.toMatchObject({ id: 'space-new' });
    expect(spaces.create).toHaveBeenCalledWith({ name: '新空间' }, 'admin-1');
  });

  it('continues to reject Agent principals', () => {
    expect(() => controller.create(
      { name: 'Agent 空间' } as any,
      { user: { userId: 'owner-1', agentId: 'agent-1', type: 'agent' } } as any,
    )).toThrow(ForbiddenException);
    expect(spaces.create).not.toHaveBeenCalled();
  });
});

describe('SpaceController.findAll', () => {
  const spaces = { findAll: jest.fn() } as any;
  const authorization = { getAccessibleSpaceIds: jest.fn() } as any;
  const controller = new SpaceController(spaces, authorization);

  beforeEach(() => {
    jest.clearAllMocks();
    authorization.getAccessibleSpaceIds.mockResolvedValue(['space-1']);
    spaces.findAll.mockResolvedValue({ data: [], total: 0 });
  });

  it('passes the cursor contract through while keeping skip/take compatibility and capping take', async () => {
    await (controller as any).findAll(
      { user: { userId: 'user-1', type: 'human' } },
      { skip: '4', take: '1000', cursor: 'opaque-cursor' },
    );

    expect(spaces.findAll).toHaveBeenCalledWith(['space-1'], {
      skip: 4,
      take: 100,
      cursor: 'opaque-cursor',
    });
  });

  it('forwards a cursorless offset request through the backward-compatible options contract', async () => {
    await (controller as any).findAll(
      { user: { userId: 'user-1', type: 'human' } },
      { skip: '20', take: '20' },
    );

    expect(spaces.findAll).toHaveBeenCalledWith(['space-1'], {
      skip: 20,
      take: 20,
      cursor: undefined,
    });
  });
});

describe('SpaceController.remove live ownership', () => {
  it('rejects an old owner demoted after the controller precheck while DELETE waits for the Space lock', async () => {
    const principal = { userId: 'owner-1', type: 'human' };
    const roles: Record<string, string> = { 'owner-1': 'owner', 'owner-2': 'admin' };
    let reportWaiting!: () => void;
    let releaseLock!: () => void;
    const waitingForLock = new Promise<void>((resolve) => { reportWaiting = resolve; });
    const lockMayProceed = new Promise<void>((resolve) => { releaseLock = resolve; });
    const authorization = {
      assertSpaceAccess: jest.fn().mockResolvedValue({ role: 'owner' }),
      assertLiveHumanSpaceAccess: jest.fn(async () => {
        if (roles[principal.userId] !== 'owner') throw new BusinessException('SPACE_ACCESS_DENIED');
        return { role: roles[principal.userId] };
      }),
    } as any;
    const tx = {
      assistTask: { updateMany: jest.fn() },
      pageSearchDocument: { deleteMany: jest.fn() },
      page: { updateMany: jest.fn() },
      space: {
        findUnique: jest.fn().mockResolvedValue({ id: 'space-1' }),
        update: jest.fn().mockResolvedValue({ id: 'space-1' }),
      },
      spaceMember: {
        findUnique: jest.fn(async ({ where }: any) => {
          const userId = where.userId_spaceId.userId as string;
          return { id: `member-${userId}`, userId, spaceId: 'space-1', role: roles[userId] };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const userId = where.userId_spaceId.userId as string;
          roles[userId] = data.role;
          return { id: `member-${userId}`, userId, spaceId: 'space-1', role: data.role };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (roles[where.userId] !== where.role) return { count: 0 };
          roles[where.userId] = data.role;
          return { count: 1 };
        }),
      },
    };
    const prisma = {
      space: { findUnique: jest.fn().mockResolvedValue({ id: 'space-1', deletedAt: null }) },
      $transaction: jest.fn(async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx)),
    } as any;
    const revisionWriter = {
      lockSpace: jest.fn(async (transaction: typeof tx) => {
        reportWaiting();
        await lockMayProceed;
        return transaction;
      }),
    } as any;
    const spaces = new (SpaceService as any)(prisma, revisionWriter, authorization) as SpaceService;
    const controller = new SpaceController(spaces, authorization);

    const deletion = controller.remove('space-1', { user: principal } as any);
    await waitingForLock;
    expect(authorization.assertSpaceAccess).toHaveBeenCalledWith(principal, 'space-1', ['owner']);

    await spaces.updateMemberRoleAs('space-1', 'owner-2', 'owner', 'owner', 'owner-1');
    expect(roles).toEqual({ 'owner-1': 'admin', 'owner-2': 'owner' });
    releaseLock();

    await expect(deletion).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    expect(authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledWith(
      tx, principal, 'space-1', ['owner'],
    );
    expect(tx.page.updateMany).not.toHaveBeenCalled();
    expect(tx.space.update).not.toHaveBeenCalled();
  });
});

describe('SpaceController.listMembers', () => {
  const spaces = { listMembers: jest.fn().mockResolvedValue([]) } as any;
  const authorization = { assertSpaceAccess: jest.fn() } as any;
  const controller = new SpaceController(spaces, authorization);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['owner', true],
    ['admin', true],
    ['editor', false],
    ['viewer', false],
  ] as const)('passes the acting user and %s management fact to the member response', async (role, canManageAgentRoles) => {
    authorization.assertSpaceAccess.mockResolvedValue({ role });

    await controller.listMembers('space-1', { user: { userId: 'user-1' } } as any);

    expect(spaces.listMembers).toHaveBeenCalledWith('space-1', 'user-1', canManageAgentRoles);
  });
});
