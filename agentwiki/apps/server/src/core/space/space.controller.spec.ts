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
  const createConcurrentHarness = (pauseAt: 'space-read' | 'member-read') => {
    const principal = { userId: 'owner-1', type: 'human' };
    const roles: Record<string, string> = { 'owner-1': 'owner', 'owner-2': 'admin' };
    let deleted = false;
    let reportPaused!: () => void;
    let resumePaused!: () => void;
    const mutationPaused = new Promise<void>((resolve) => { reportPaused = resolve; });
    const mutationMayProceed = new Promise<void>((resolve) => { resumePaused = resolve; });
    let pauseConsumed = false;
    const pauseMutation = async (location: typeof pauseAt) => {
      if (pauseConsumed || location !== pauseAt) return;
      pauseConsumed = true;
      reportPaused();
      await mutationMayProceed;
    };
    const authorization = {
      assertSpaceAccess: jest.fn(async (actor: typeof principal, _spaceId: string, allowed: string[]) => {
        const role = roles[actor.userId];
        if (deleted || !allowed.includes(role)) throw new BusinessException('SPACE_ACCESS_DENIED');
        return { role };
      }),
      assertLiveHumanSpaceAccess: jest.fn(async (
        _tx: unknown, actor: typeof principal, _spaceId: string, allowed: string[],
      ) => {
        const role = roles[actor.userId];
        if (deleted || !allowed.includes(role)) throw new BusinessException('SPACE_ACCESS_DENIED');
        return { role, userId: actor.userId, spaceId: 'space-1' };
      }),
    } as any;
    const makeTx = () => ({
      assistTask: { updateMany: jest.fn() },
      pageSearchDocument: { deleteMany: jest.fn() },
      page: { updateMany: jest.fn() },
      space: {
        findUnique: jest.fn(async () => {
          await pauseMutation('space-read');
          return deleted ? null : { id: 'space-1' };
        }),
        update: jest.fn(async () => {
          if (deleted) throw new Error('Space already deleted');
          deleted = true;
          return { id: 'space-1', deletedAt: new Date() };
        }),
      },
      spaceMember: {
        findUnique: jest.fn(async ({ where }: any) => {
          await pauseMutation('member-read');
          const userId = where.userId_spaceId.userId as string;
          const role = roles[userId];
          return role ? { id: `member-${userId}`, userId, spaceId: 'space-1', role } : null;
        }),
        count: jest.fn(async () => Object.values(roles).filter((role) => role === 'owner').length),
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
        delete: jest.fn(async ({ where }: any) => {
          const userId = where.userId_spaceId.userId as string;
          const role = roles[userId];
          delete roles[userId];
          return { id: `member-${userId}`, userId, spaceId: 'space-1', role };
        }),
      },
    });
    const unlockByTransaction = new Map<object, () => void>();
    let lockTail = Promise.resolve();
    const revisionWriter = {
      lockSpace: jest.fn(async (transaction: object) => {
        const previous = lockTail;
        let unlock!: () => void;
        lockTail = new Promise<void>((resolve) => { unlock = resolve; });
        await previous;
        unlockByTransaction.set(transaction, unlock);
        return transaction;
      }),
    } as any;
    const prisma = {
      space: { findUnique: jest.fn(async () => deleted ? null : { id: 'space-1', deletedAt: null }) },
      $transaction: jest.fn(async (operation: (transaction: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        const transaction = makeTx();
        try {
          return await operation(transaction);
        } finally {
          unlockByTransaction.get(transaction)?.();
        }
      }),
    } as any;
    const spaces = new (SpaceService as any)(prisma, revisionWriter, authorization) as SpaceService;
    const controller = new SpaceController(spaces, authorization);
    return {
      authorization,
      controller,
      mutationPaused,
      principal,
      resumeMutation: resumePaused,
      revisionWriter,
      roles,
      spaceDeleted: () => deleted,
    };
  };

  it('serializes owner transfer behind DELETE and rejects the transfer after deletion commits', async () => {
    const harness = createConcurrentHarness('space-read');
    const deletion = harness.controller.remove('space-1', { user: harness.principal } as any);
    await harness.mutationPaused;
    expect(harness.authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledTimes(1);

    let transferSettled = false;
    const transfer = harness.controller.updateMemberRole(
      'space-1', 'owner-2', { role: 'owner' } as any, { user: harness.principal } as any,
    ).finally(() => { transferSettled = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const lockCallsBeforeRelease = harness.revisionWriter.lockSpace.mock.calls.length;
    const settledBeforeRelease = transferSettled;
    harness.resumeMutation();

    const [deletionResult, transferResult] = await Promise.allSettled([deletion, transfer]);

    expect(lockCallsBeforeRelease).toBe(2);
    expect(settledBeforeRelease).toBe(false);
    expect(deletionResult.status).toBe('fulfilled');
    expect(transferResult).toMatchObject({
      status: 'rejected', reason: { businessCode: 'SPACE_ACCESS_DENIED' },
    });
    expect(harness.spaceDeleted()).toBe(true);
    expect(harness.roles).toEqual({ 'owner-1': 'owner', 'owner-2': 'admin' });
  });

  it('lets an owner transfer commit first and rejects the queued DELETE on live reauthorization', async () => {
    const harness = createConcurrentHarness('member-read');
    let transferSettled = false;
    const transfer = harness.controller.updateMemberRole(
      'space-1', 'owner-2', { role: 'owner' } as any, { user: harness.principal } as any,
    ).finally(() => { transferSettled = true; });
    await harness.mutationPaused;
    expect(harness.authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledTimes(1);

    const deletion = harness.controller.remove('space-1', { user: harness.principal } as any);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const lockCallsBeforeRelease = harness.revisionWriter.lockSpace.mock.calls.length;
    const transferSettledBeforeRelease = transferSettled;
    harness.resumeMutation();
    const [transferResult, deletionResult] = await Promise.allSettled([transfer, deletion]);

    expect(lockCallsBeforeRelease).toBe(2);
    expect(transferSettledBeforeRelease).toBe(false);
    expect(transferResult.status).toBe('fulfilled');
    expect(deletionResult).toMatchObject({
      status: 'rejected', reason: { businessCode: 'SPACE_ACCESS_DENIED' },
    });
    expect(harness.spaceDeleted()).toBe(false);
    expect(harness.roles).toEqual({ 'owner-1': 'admin', 'owner-2': 'owner' });
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

describe('SpaceController.addMember', () => {
  const spaces = { addMember: jest.fn().mockResolvedValue({ id: 'member-2' }) } as any;
  const authorization = { assertSpaceAccess: jest.fn().mockResolvedValue({ role: 'owner' }) } as any;
  const controller = new SpaceController(spaces, authorization);

  beforeEach(() => jest.clearAllMocks());

  it('passes the authenticated principal into the locked live-authorization write path', async () => {
    const principal = { userId: 'owner-1', type: 'human' };

    await controller.addMember(
      'space-1',
      { email: 'member@example.com', role: 'editor' } as any,
      { user: principal } as any,
    );

    expect(spaces.addMember).toHaveBeenCalledWith(
      'space-1', 'member@example.com', 'editor', principal,
    );
  });
});
