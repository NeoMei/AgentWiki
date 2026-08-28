import 'reflect-metadata';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import { BusinessException } from '../core/filters/business-error';
import { AllExceptionsFilter } from '../core/filters/all-exceptions.filter';
import { ContentTreeController } from './content-tree.controller';
import {
  ContentTreeListQueryDto,
  CreateFolderDto,
  DeleteFolderDto,
  FolderListQueryDto,
  MoveContentTreeNodeDto,
  RenameFolderDto,
  RestoreFolderDto,
} from './content-tree.dto';
import { ContentTreeError } from './content-tree.types';

const productionPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

async function transform(metatype: new () => object, input: object): Promise<object> {
  return productionPipe.transform(input, { type: 'body', metatype });
}

describe('ContentTree DTO contract', () => {
  it.each([
    [ContentTreeListQueryDto, { take: '1' }],
    [ContentTreeListQueryDto, { take: '200', parentFolderId: 'folder-1', cursor: 'opaque' }],
    [FolderListQueryDto, { take: '100', query: '周报' }],
    [CreateFolderDto, { name: '项目', parentId: null, expectedTreeRevision: '0' }],
    [RenameFolderDto, { name: '新项目', expectedUpdatedAt: '2026-08-28T00:00:00.000Z', expectedTreeRevision: '42' }],
    [MoveContentTreeNodeDto, { kind: 'page', id: 'page-1', targetParentFolderId: null, expectedUpdatedAt: '2026-08-28T00:00:00.000Z', expectedTreeRevision: '42' }],
    [DeleteFolderDto, { expectedUpdatedAt: '2026-08-28T00:00:00.000Z', expectedTreeRevision: '42', expectedImpactHash: 'a'.repeat(64) }],
    [RestoreFolderDto, { deletionBatchId: 'batch-1', expectedTreeRevision: '42', mode: 'rename-root', name: '恢复项目' }],
  ] as const)('accepts the exact valid shape for %p', async (metatype, input) => {
    await expect(transform(metatype, input)).resolves.toBeDefined();
  });

  it.each([
    [ContentTreeListQueryDto, { take: '0' }],
    [ContentTreeListQueryDto, { take: '201' }],
    [FolderListQueryDto, { take: '3.5' }],
    [CreateFolderDto, { name: '项目', parentId: null, expectedTreeRevision: '01' }],
    [CreateFolderDto, { name: '项目', parentId: null, expectedTreeRevision: '-1' }],
    [CreateFolderDto, { name: '项目', parentId: null, expectedTreeRevision: 1 }],
    [MoveContentTreeNodeDto, { kind: 'page', id: 'page-1', targetParentFolderId: null, expectedUpdatedAt: 'bad', expectedTreeRevision: '1' }],
    [RestoreFolderDto, { deletionBatchId: 'batch-1', expectedTreeRevision: '1', mode: 'rename-root' }],
    [RestoreFolderDto, { deletionBatchId: 'batch-1', expectedTreeRevision: '1', mode: 'original', name: '不允许' }],
  ] as const)('rejects an invalid boundary for %p', async (metatype, input) => {
    await expect(transform(metatype, input)).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    [CreateFolderDto, { name: '项目', parentId: null, expectedTreeRevision: '1', extra: true }],
    [RenameFolderDto, { name: '项目', expectedUpdatedAt: '2026-08-28T00:00:00.000Z', expectedTreeRevision: '1', folderId: 'forged' }],
    [MoveContentTreeNodeDto, { kind: 'page', id: 'page-1', targetParentFolderId: null, expectedUpdatedAt: '2026-08-28T00:00:00.000Z', expectedTreeRevision: '1', sortOrder: 4 }],
    [DeleteFolderDto, { expectedUpdatedAt: '2026-08-28T00:00:00.000Z', expectedTreeRevision: '1', expectedImpactHash: 'b'.repeat(64), recursive: true }],
    [RestoreFolderDto, { deletionBatchId: 'batch-1', expectedTreeRevision: '1', mode: 'root', strategy: {} }],
  ] as const)('rejects unknown write fields for %p', async (metatype, input) => {
    await expect(transform(metatype, input)).rejects.toMatchObject({ status: 400 });
  });
});

describe('ContentTreeController HTTP contract', () => {
  const tree = {
    listChildren: jest.fn(),
    listFolders: jest.fn(),
    createFolder: jest.fn(),
    renameFolder: jest.fn(),
    moveNode: jest.fn(),
    deleteImpact: jest.fn(),
    deleteFolder: jest.fn(),
    restoreDeletionBatch: jest.fn(),
  } as any;
  const authorization = { assertSpaceAccess: jest.fn() } as any;
  const controller = new ContentTreeController(tree, authorization);
  const request = { user: { userId: 'user-1', platformRole: 'user' } } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    authorization.assertSpaceAccess.mockResolvedValue({ role: 'owner' });
  });

  it('declares the exact Space base path and human-only authentication boundary', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ContentTreeController)).toBe('spaces/:spaceId');
    expect(Reflect.getMetadata(GUARDS_METADATA, ContentTreeController))
      .toEqual([CombinedAuthGuard, HumanOnlyGuard]);
  });

  it('declares all eight exact routes without shadowing static content-tree paths', () => {
    const routes = [
      ['listTree', 'content-tree', RequestMethod.GET],
      ['listFolders', 'folders', RequestMethod.GET],
      ['createFolder', 'folders', RequestMethod.POST],
      ['renameFolder', 'folders/:folderId', RequestMethod.PATCH],
      ['moveNode', 'content-tree/move', RequestMethod.PATCH],
      ['deleteImpact', 'folders/:folderId/delete-impact', RequestMethod.GET],
      ['deleteFolder', 'folders/:folderId', RequestMethod.DELETE],
      ['restoreFolder', 'folders/:folderId/restore', RequestMethod.POST],
    ] as const;
    for (const [methodName, path, method] of routes) {
      const handler = ContentTreeController.prototype[methodName];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    }
  });

  it('serializes every tree revision as a decimal string and delegates the bound cursor unchanged', async () => {
    tree.listChildren.mockResolvedValue({
      spaceId: 'space-1', treeRevision: 42n, parentFolderId: null, data: [], nextCursor: 'next',
    });

    await expect(controller.listTree(request, 'space-1', { cursor: 'cursor', take: 25 }))
      .resolves.toEqual({
        spaceId: 'space-1', treeRevision: '42', parentFolderId: null, data: [], nextCursor: 'next',
      });
    expect(tree.listChildren).toHaveBeenCalledWith({
      spaceId: 'space-1', parentFolderId: null, cursor: 'cursor', take: 25,
    });
    expect(authorization.assertSpaceAccess).toHaveBeenCalledWith(
      request.user, 'space-1', ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
    );
  });

  it('uses editor policy for create/rename/move and converts timestamps and revisions at the boundary', async () => {
    tree.createFolder.mockResolvedValue({ folder: { id: 'folder-1' }, treeRevision: 2n, syncRevisionId: 'sync-2' });
    tree.renameFolder.mockResolvedValue({ folder: { id: 'folder-1' }, treeRevision: 3n, syncRevisionId: 'sync-3' });
    tree.moveNode.mockResolvedValue({ node: { id: 'page-1', kind: 'page' }, treeRevision: 4n, syncRevisionId: 'sync-4' });

    await controller.createFolder(request, 'space-1', {
      name: '项目', parentId: null, expectedTreeRevision: '1',
    });
    await controller.renameFolder(request, 'space-1', 'folder-1', {
      name: '新项目', expectedUpdatedAt: '2026-08-28T00:00:00.000Z', expectedTreeRevision: '2',
    });
    await controller.moveNode(request, 'space-1', {
      kind: 'page', id: 'page-1', targetParentFolderId: null,
      expectedUpdatedAt: '2026-08-28T00:00:00.000Z', expectedTreeRevision: '3',
    });

    expect(authorization.assertSpaceAccess).toHaveBeenNthCalledWith(
      1, request.user, 'space-1', ['owner', 'editor'], 'pages:write',
    );
    expect(authorization.assertSpaceAccess).toHaveBeenNthCalledWith(
      2, request.user, 'space-1', ['owner', 'editor'], 'pages:write',
    );
    expect(authorization.assertSpaceAccess).toHaveBeenNthCalledWith(
      3, request.user, 'space-1', ['owner', 'editor'], 'pages:write',
    );
    expect(tree.createFolder).toHaveBeenCalledWith(expect.objectContaining({
      expectedTreeRevision: 1n, actor: { userId: 'user-1' },
    }));
    expect(tree.renameFolder).toHaveBeenCalledWith(expect.objectContaining({
      folderId: 'folder-1', expectedTreeRevision: 2n,
      expectedUpdatedAt: new Date('2026-08-28T00:00:00.000Z'),
    }));
    expect(tree.moveNode).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 'page-1', targetFolderId: null, expectedTreeRevision: 3n,
    }));
  });

  it('allows every reader to preview delete impact but reserves delete/restore for Owner and Admin', async () => {
    tree.deleteImpact.mockResolvedValue({ treeRevision: 8n, rootUpdatedAt: new Date('2026-08-28T00:00:00.000Z'), folderCount: 1, pageCount: 2, impactHash: 'c'.repeat(64) });
    tree.deleteFolder.mockResolvedValue({ treeRevision: 9n, syncRevisionId: 'sync-9', batch: { id: 'batch-1' } });
    tree.restoreDeletionBatch.mockResolvedValue({ treeRevision: 10n, syncRevisionId: 'sync-10', batchId: 'batch-1', folder: { id: 'folder-1' } });

    await controller.deleteImpact(request, 'space-1', 'folder-1');
    await controller.deleteFolder(request, 'space-1', 'folder-1', {
      expectedUpdatedAt: '2026-08-28T00:00:00.000Z', expectedTreeRevision: '8', expectedImpactHash: 'c'.repeat(64),
    });
    await controller.restoreFolder(request, 'space-1', 'folder-1', {
      deletionBatchId: 'batch-1', expectedTreeRevision: '9', mode: 'original',
    });

    expect(authorization.assertSpaceAccess).toHaveBeenNthCalledWith(
      1, request.user, 'space-1', ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
    );
    expect(authorization.assertSpaceAccess).toHaveBeenNthCalledWith(
      2, request.user, 'space-1', ['owner', 'admin'], 'pages:write',
    );
    expect(authorization.assertSpaceAccess).toHaveBeenNthCalledWith(
      3, request.user, 'space-1', ['owner', 'admin'], 'pages:write',
    );
    expect(tree.restoreDeletionBatch).toHaveBeenCalledWith(expect.objectContaining({
      spaceId: 'space-1', deletionBatchId: 'batch-1', strategy: { kind: 'original' },
      expectedTreeRevision: 9n, actor: { userId: 'user-1' },
    }));
  });

  it('fails closed before mutations when Viewer or Editor authorization is denied', async () => {
    authorization.assertSpaceAccess
      .mockRejectedValueOnce(new BusinessException('SPACE_ACCESS_DENIED'))
      .mockRejectedValueOnce(new BusinessException('SPACE_ACCESS_DENIED'));

    await expect(controller.createFolder(request, 'space-1', {
      name: 'Viewer cannot create', parentId: null, expectedTreeRevision: '0',
    })).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    await expect(controller.deleteFolder(request, 'space-1', 'folder-1', {
      expectedUpdatedAt: '2026-08-28T00:00:00.000Z',
      expectedTreeRevision: '0',
      expectedImpactHash: 'd'.repeat(64),
    })).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });

    expect(tree.createFolder).not.toHaveBeenCalled();
    expect(tree.deleteFolder).not.toHaveBeenCalled();
    expect(authorization.assertSpaceAccess).toHaveBeenNthCalledWith(
      1, request.user, 'space-1', ['owner', 'editor'], 'pages:write',
    );
    expect(authorization.assertSpaceAccess).toHaveBeenNthCalledWith(
      2, request.user, 'space-1', ['owner', 'admin'], 'pages:write',
    );
  });

  it('exposes stable ContentTree errors as business HTTP errors with safe details', () => {
    const error = new ContentTreeError(
      'FOLDER_DELETE_IMPACT_CHANGED',
      'The Folder subtree changed after preview',
      { expected: 'public-client-hash', actual: 'current-hash' },
    ) as any;

    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      code: 'FOLDER_DELETE_IMPACT_CHANGED',
      message: 'The Folder subtree changed after preview',
      error: 'Conflict',
      details: { expected: 'public-client-hash', actual: 'current-hash' },
    });
  });

  it('serializes ContentTree business codes and safe details through the global HTTP envelope', () => {
    const httpAdapter = { reply: jest.fn(), setHeader: jest.fn() };
    const response = {};
    const filter = new AllExceptionsFilter({ httpAdapter } as any);
    const error = new ContentTreeError(
      'CONTENT_TREE_CONFLICT',
      'The content tree changed; reload before retrying',
      { expected: '4', actual: '5' },
    );
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'PATCH', url: '/spaces/space-1/content-tree/move', requestId: 'request-1',
        }),
        getResponse: () => response,
      }),
    } as any;

    filter.catch(error, host);

    expect(httpAdapter.reply).toHaveBeenCalledWith(response, expect.objectContaining({
      statusCode: 409,
      code: 'CONTENT_TREE_CONFLICT',
      message: 'The content tree changed; reload before retrying',
      path: '/spaces/space-1/content-tree/move',
      requestId: 'request-1',
      details: { expected: '4', actual: '5' },
      timestamp: expect.any(String),
    }), 409);
  });
});
