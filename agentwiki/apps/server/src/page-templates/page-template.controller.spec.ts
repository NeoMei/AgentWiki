import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { PageTemplateCategory } from '@prisma/client';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import { PageTemplateController } from './page-template.controller';

type RouteArgument = {
  type: RouteParamtypes;
  index: number;
  data?: string;
};

function expectRouteArguments(methodName: string, expected: RouteArgument[]) {
  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    PageTemplateController,
    methodName,
  );
  expect(metadata).toEqual(Object.fromEntries(expected.map(({ type, index, data }) => [
    `${type}:${index}`,
    expect.objectContaining({ index, data }),
  ])));
}

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

  it('declares the exact base path and ordered human-only guards', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PageTemplateController))
      .toBe('spaces/:spaceId/page-templates');
    expect(Reflect.getMetadata(GUARDS_METADATA, PageTemplateController))
      .toEqual([CombinedAuthGuard, HumanOnlyGuard]);
  });

  it('declares the exact path and HTTP verb for all seven routes', () => {
    const routes = [
      ['list', '/', RequestMethod.GET],
      ['get', ':templateId', RequestMethod.GET],
      ['create', '/', RequestMethod.POST],
      ['update', ':templateId', RequestMethod.PATCH],
      ['createVersion', ':templateId/versions', RequestMethod.POST],
      ['archive', ':templateId', RequestMethod.DELETE],
      ['restore', ':templateId/restore', RequestMethod.POST],
    ] as const;

    for (const [methodName, path, verb] of routes) {
      const method = PageTemplateController.prototype[methodName];
      expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(verb);
    }
  });

  it('binds request, path, query, and body decorators to the exact parameters', () => {
    const request = { type: RouteParamtypes.REQUEST, index: 0 };
    const spaceId = { type: RouteParamtypes.PARAM, index: 1, data: 'spaceId' };
    const templateId = { type: RouteParamtypes.PARAM, index: 2, data: 'templateId' };

    expectRouteArguments('list', [
      request,
      spaceId,
      { type: RouteParamtypes.QUERY, index: 2 },
    ]);
    expectRouteArguments('get', [
      request,
      spaceId,
      templateId,
      { type: RouteParamtypes.QUERY, index: 3 },
    ]);
    expectRouteArguments('create', [
      request,
      spaceId,
      { type: RouteParamtypes.BODY, index: 2 },
    ]);
    for (const methodName of ['update', 'createVersion', 'archive', 'restore']) {
      expectRouteArguments(methodName, [
        request,
        spaceId,
        templateId,
        { type: RouteParamtypes.BODY, index: 3 },
      ]);
    }
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
