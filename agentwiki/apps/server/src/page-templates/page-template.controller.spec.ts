import { PageTemplateCategory } from '@prisma/client';
import { PageTemplateController } from './page-template.controller';

describe('PageTemplateController', () => {
  const service = {
    list: jest.fn(),
    get: jest.fn(),
    createSpaceTemplate: jest.fn(),
    updateMetadata: jest.fn(),
    createVersion: jest.fn(),
    archive: jest.fn(),
    restore: jest.fn(),
  } as any;
  const controller = new PageTemplateController(service);
  const request = { user: { userId: 'user-1' } } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes locale and filters to the list service', async () => {
    const query = { locale: 'zh-CN', scope: 'all', skip: 0, take: 100 } as const;

    await controller.list(request, 'space-1', query);

    expect(service.list).toHaveBeenCalledWith('space-1', query, request.user);
  });

  it('passes the requested locale to the detail service', async () => {
    await controller.get(request, 'space-1', 'template-1', { locale: 'en' });

    expect(service.get).toHaveBeenCalledWith('space-1', 'template-1', 'en', request.user);
  });

  it('delegates every mutation with the request principal', async () => {
    const createBody = {
      name: 'Template',
      category: PageTemplateCategory.other,
      defaultTitle: 'New page',
      locale: 'en',
      sourcePageId: 'page-1',
      expectedSourceUpdatedAt: '2026-08-25T00:00:00.000Z',
    } as const;
    const updateBody = {
      name: 'Updated template',
      category: PageTemplateCategory.other,
      defaultTitle: 'Updated page',
      expectedUpdatedAt: '2026-08-25T00:00:00.000Z',
    } as const;
    const versionBody = {
      sourcePageId: 'page-2',
      expectedSourceUpdatedAt: '2026-08-25T00:00:00.000Z',
      expectedCurrentVersion: 1,
    };
    const stateBody = { expectedUpdatedAt: '2026-08-25T00:00:00.000Z' };

    await controller.create(request, 'space-1', createBody);
    await controller.update(request, 'space-1', 'template-1', updateBody);
    await controller.createVersion(request, 'space-1', 'template-1', versionBody);
    await controller.archive(request, 'space-1', 'template-1', stateBody);
    await controller.restore(request, 'space-1', 'template-1', stateBody);

    expect(service.createSpaceTemplate).toHaveBeenCalledWith('space-1', createBody, request.user);
    expect(service.updateMetadata).toHaveBeenCalledWith('space-1', 'template-1', updateBody, request.user);
    expect(service.createVersion).toHaveBeenCalledWith('space-1', 'template-1', versionBody, request.user);
    expect(service.archive).toHaveBeenCalledWith('space-1', 'template-1', stateBody, request.user);
    expect(service.restore).toHaveBeenCalledWith('space-1', 'template-1', stateBody, request.user);
  });
});
