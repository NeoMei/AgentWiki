import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import {
  AttachmentContentController,
  SpaceAttachmentController,
} from './attachment.controller';

type RouteArgument = { type: RouteParamtypes; index: number; data?: string };

function routeArguments(
  controller: object,
  methodName: string,
  expected: RouteArgument[],
) {
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, methodName);
  expect(metadata).toEqual(Object.fromEntries(expected.map(({ type, index, data }) => [
    `${type}:${index}`,
    expect.objectContaining({ index, data }),
  ])));
}

describe('attachment controllers', () => {
  const service = {
    list: jest.fn(),
    upload: jest.fn(),
    archive: jest.fn(),
    restore: jest.fn(),
    content: jest.fn(),
  } as any;
  const spaces = new SpaceAttachmentController(service);
  const content = new AttachmentContentController(service);
  const request = { user: { userId: 'user-1', type: 'human' } } as any;

  beforeEach(() => jest.clearAllMocks());

  it('declares exact controller paths and read guards', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SpaceAttachmentController))
      .toBe('spaces/:spaceId/attachments');
    expect(Reflect.getMetadata(GUARDS_METADATA, SpaceAttachmentController))
      .toEqual([CombinedAuthGuard]);
    expect(Reflect.getMetadata(PATH_METADATA, AttachmentContentController))
      .toBe('attachments');
    expect(Reflect.getMetadata(GUARDS_METADATA, AttachmentContentController))
      .toEqual([CombinedAuthGuard]);
  });

  it('declares exact paths, verbs, and method-level human mutation guards', () => {
    const routes = [
      [SpaceAttachmentController, 'list', '/', RequestMethod.GET, undefined],
      [SpaceAttachmentController, 'upload', '/', RequestMethod.POST, [HumanOnlyGuard]],
      [SpaceAttachmentController, 'archive', ':attachmentId/archive', RequestMethod.POST, [HumanOnlyGuard]],
      [SpaceAttachmentController, 'restore', ':attachmentId/restore', RequestMethod.POST, [HumanOnlyGuard]],
      [AttachmentContentController, 'getContent', ':attachmentId/content', RequestMethod.GET, undefined],
    ] as const;

    for (const [controller, methodName, path, verb, guards] of routes) {
      const method = (
        controller.prototype as unknown as Record<string, (...args: never[]) => unknown>
      )[methodName];
      expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(verb);
      expect(Reflect.getMetadata(GUARDS_METADATA, method)).toEqual(guards);
    }
    expect(Reflect.getMetadata(
      INTERCEPTORS_METADATA,
      SpaceAttachmentController.prototype.upload,
    )).toHaveLength(1);
  });

  it('binds request, path, query, file, body, and response parameters exactly', () => {
    const req = { type: RouteParamtypes.REQUEST, index: 0 };
    const spaceId = { type: RouteParamtypes.PARAM, index: 1, data: 'spaceId' };
    const attachmentIdAt2 = { type: RouteParamtypes.PARAM, index: 2, data: 'attachmentId' };
    routeArguments(SpaceAttachmentController, 'list', [
      req, spaceId, { type: RouteParamtypes.QUERY, index: 2 },
    ]);
    routeArguments(SpaceAttachmentController, 'upload', [
      req, spaceId, { type: RouteParamtypes.FILE, index: 2 },
    ]);
    for (const methodName of ['archive', 'restore']) {
      routeArguments(SpaceAttachmentController, methodName, [
        req, spaceId, attachmentIdAt2, { type: RouteParamtypes.BODY, index: 3 },
      ]);
    }
    routeArguments(AttachmentContentController, 'getContent', [
      req,
      { type: RouteParamtypes.PARAM, index: 1, data: 'attachmentId' },
      { type: RouteParamtypes.RESPONSE, index: 2 },
    ]);
  });

  it('delegates list and every mutation with the authenticated principal', async () => {
    const query = { q: '图', status: 'active' as const, skip: 0, take: 100 };
    const file = { originalname: 'photo.png' } as Express.Multer.File;
    const state = { expectedUpdatedAt: '2026-08-27T01:02:03.000Z' };

    await spaces.list(request, 'space-1', query);
    await spaces.upload(request, 'space-1', file);
    await spaces.archive(request, 'space-1', 'attachment-1', state);
    await spaces.restore(request, 'space-1', 'attachment-1', state);

    expect(service.list).toHaveBeenCalledWith('space-1', query, request.user);
    expect(service.upload).toHaveBeenCalledWith('space-1', file, request.user);
    expect(service.archive).toHaveBeenCalledWith('space-1', 'attachment-1', state, request.user);
    expect(service.restore).toHaveBeenCalledWith('space-1', 'attachment-1', state, request.user);
  });

  it('rejects a missing multipart file before calling the upload service', () => {
    expect(() => spaces.upload(request, 'space-1', undefined as any)).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('writes protected content headers without exposing storageKey', async () => {
    const stream = { pipe: jest.fn(), on: jest.fn(), once: jest.fn() } as any;
    service.content.mockResolvedValue({
      stream,
      mimeType: 'image/png',
      sizeBytes: 42n,
      displayName: 'photo.png',
      contentHash: 'a'.repeat(64),
    });
    const response = { setHeader: jest.fn() } as any;

    const result = await content.getContent(request, 'attachment-1', response);

    expect(service.content).toHaveBeenCalledWith('attachment-1', request.user);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Length', '42');
    expect(response.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('private'));
    expect(response.setHeader).toHaveBeenCalledWith('ETag', `"${'a'.repeat(64)}"`);
    expect(response.setHeader).not.toHaveBeenCalledWith(
      expect.anything(), expect.stringContaining('storageKey'),
    );
    expect(result).toBeDefined();
  });
});
