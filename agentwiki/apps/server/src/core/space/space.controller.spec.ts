import { ForbiddenException } from '@nestjs/common';
import { SpaceController } from './space.controller';

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
