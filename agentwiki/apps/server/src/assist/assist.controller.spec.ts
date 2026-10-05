import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import { AssistController } from './assist.controller';

describe('AssistController authorization boundary', () => {
  it('keeps the privileged editing assistant human-only', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AssistController)).toEqual([
      CombinedAuthGuard,
      HumanOnlyGuard,
    ]);
  });
  const assist = { createTask: jest.fn(), listForPage: jest.fn(), get: jest.fn() } as any;
  const queue = { enqueue: jest.fn() } as any;
  const authorization = { assertPageAccess: jest.fn(), assertSpaceAccess: jest.fn() } as any;
  const controller = new AssistController(assist, queue, authorization);
  beforeEach(() => {
    jest.clearAllMocks();
    authorization.assertPageAccess.mockResolvedValue({ id: 'page-1', spaceId: 'space-1' });
    authorization.assertSpaceAccess.mockReset().mockResolvedValue({ role: 'editor' });
  });

  it('limits listing to current page Space and requesting human', async () => {
    await controller.listTasks('page-1', { user: { userId: 'user-1' } } as any);
    expect(assist.listForPage).toHaveBeenCalledWith('page-1', 'user-1', 'space-1');
  });

  it('loads task through the requester filter before returning its snapshot', async () => {
    assist.get.mockResolvedValue(null);
    await expect(controller.getTask('task-1', { user: { userId: 'user-2' } } as any)).resolves.toBeNull();
    expect(assist.get).toHaveBeenCalledWith('task-1', 'user-2');
  });

  it('refuses task snapshot if its page has moved to a different Space', async () => {
    assist.get.mockResolvedValue({ id: 'task-1', pageId: 'page-1', spaceId: 'space-1', requestedByUserId: 'user-1' });
    authorization.assertPageAccess.mockResolvedValue({ id: 'page-1', spaceId: 'space-2' });
    await expect(controller.getTask('task-1', { user: { userId: 'user-1' } } as any)).rejects.toThrow();
  });

  it('refuses missing requester at the HTTP create boundary', async () => {
    await expect(controller.createTask({ spaceId: 'space-1', intent: 'edit' }, { user: {} } as any)).rejects.toThrow();
    expect(assist.createTask).not.toHaveBeenCalled();
  });

  it('returns no task data after read access is revoked', async () => {
    assist.get.mockResolvedValue({ id: 'task-1', pageId: 'page-1', spaceId: 'space-1', requestedByUserId: 'user-1' });
    authorization.assertSpaceAccess.mockRejectedValue(new Error('revoked'));
    await expect(controller.getTask('task-1', { user: { userId: 'user-1' } } as any)).rejects.toThrow('revoked');
  });

});
