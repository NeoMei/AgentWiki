import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import { TemplateController } from './template.controller';

describe('TemplateController', () => {
  const templates = {
    list: jest.fn(), get: jest.fn(), createSpaceTemplate: jest.fn(), copySystemTemplate: jest.fn(),
    validateDefinition: jest.fn(), updateSpaceTemplate: jest.fn(), archiveSpaceTemplate: jest.fn(),
  } as any;
  const controller = new TemplateController(templates);
  const request = { user: { userId: 'user-1' } } as any;

  beforeEach(() => jest.clearAllMocks());

  it('is guarded by combined human-only authentication', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TemplateController)).toEqual([CombinedAuthGuard, HumanOnlyGuard]);
  });

  it('forwards every template route with the authenticated principal', async () => {
    await controller.list(request, 'space-1');
    await controller.create(request, 'space-1', { name: 'A', slug: 'a', definition: {} } as any);
    await controller.validate(request, 'space-1', { definition: {} });
    await controller.get(request, 'space-1', 'template-1');
    await controller.copy(request, 'space-1', 'system-1', { name: 'Copy' });
    await controller.update(request, 'space-1', 'template-1', { expectedVersion: 2, definition: {} });
    await controller.archive(request, 'space-1', 'template-1', { expectedVersion: 2 });

    expect(templates.list).toHaveBeenCalledWith('space-1', request.user);
    expect(templates.createSpaceTemplate).toHaveBeenCalledWith('space-1', expect.objectContaining({ name: 'A' }), request.user);
    expect(templates.validateDefinition).toHaveBeenCalledWith('space-1', {}, request.user);
    expect(templates.get).toHaveBeenCalledWith('space-1', 'template-1', request.user);
    expect(templates.copySystemTemplate).toHaveBeenCalledWith('space-1', 'system-1', 'Copy', request.user);
    expect(templates.updateSpaceTemplate).toHaveBeenCalledWith('space-1', 'template-1', 2, {}, request.user);
    expect(templates.archiveSpaceTemplate).toHaveBeenCalledWith('space-1', 'template-1', 2, request.user);
  });
});
