import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { AppModule } from '../app.module';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { MarkdownResourceController } from './markdown-resource.controller';
import { MarkdownResourceModule } from './markdown-resource.module';

describe('MarkdownResourceController', () => {
  const service = { resolve: jest.fn() } as any;
  const controller = new MarkdownResourceController(service);
  const request = { user: { userId: 'user-1' } } as any;

  beforeEach(() => jest.clearAllMocks());

  it('declares the exact guarded POST route and AppModule registration', () => {
    expect(Reflect.getMetadata(PATH_METADATA, MarkdownResourceController))
      .toBe('spaces/:spaceId/markdown');
    expect(Reflect.getMetadata(GUARDS_METADATA, MarkdownResourceController))
      .toEqual([CombinedAuthGuard]);
    expect(Reflect.getMetadata(PATH_METADATA, MarkdownResourceController.prototype.resolve))
      .toBe('resolve');
    expect(Reflect.getMetadata(METHOD_METADATA, MarkdownResourceController.prototype.resolve))
      .toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule))
      .toContain(MarkdownResourceModule);
  });

  it('binds request, spaceId, and validated body exactly', () => {
    const metadata = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      MarkdownResourceController,
      'resolve',
    );
    expect(metadata).toEqual({
      [`${RouteParamtypes.REQUEST}:0`]: expect.objectContaining({ index: 0 }),
      [`${RouteParamtypes.PARAM}:1`]: expect.objectContaining({ index: 1, data: 'spaceId' }),
      [`${RouteParamtypes.BODY}:2`]: expect.objectContaining({ index: 2 }),
    });
  });

  it('delegates ordered references with the authenticated principal', async () => {
    const body = { references: [
      { key: 'first', kind: 'page' as const, target: 'Page' },
      { key: 'second', kind: 'attachment' as const, target: 'image.png' },
    ] };
    service.resolve.mockResolvedValue([
      { key: 'first', status: 'unresolved' },
      { key: 'second', status: 'unresolved' },
    ]);

    await expect(controller.resolve(request, 'space-1', body)).resolves.toEqual([
      { key: 'first', status: 'unresolved' },
      { key: 'second', status: 'unresolved' },
    ]);
    expect(service.resolve).toHaveBeenCalledWith(
      'space-1', body.references, request.user,
    );
  });
});
