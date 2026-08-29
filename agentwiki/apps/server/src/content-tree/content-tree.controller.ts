import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import { BusinessException } from '../core/filters/business-error';
import {
  AuthorizationService,
  type Principal,
} from '../core/authorization/authorization.service';
import {
  ContentTreeListQueryDto,
  CreateFolderDto,
  DeleteFolderDto,
  FolderListQueryDto,
  MoveContentTreeNodeDto,
  RenameFolderDto,
  RestoreFolderDto,
  parseTreeRevision,
} from './content-tree.dto';
import { ContentTreeService } from './content-tree.service';

const READ_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
const EDIT_ROLES = ['owner', 'editor'] as const;
const DELETE_ROLES = ['owner', 'editor'] as const;

function decimalTreeRevision<T extends { treeRevision: bigint }>(result: T) {
  return { ...result, treeRevision: result.treeRevision.toString() };
}

@Controller('spaces/:spaceId')
@UseGuards(CombinedAuthGuard, HumanOnlyGuard)
export class ContentTreeController {
  constructor(
    private readonly tree: ContentTreeService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get('content-tree')
  async listTree(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Query() query: ContentTreeListQueryDto,
  ) {
    await this.authorize(request, spaceId, [...READ_ROLES], 'pages:read');
    return decimalTreeRevision(await this.tree.listChildren({
      spaceId,
      parentFolderId: query.parentFolderId ?? null,
      cursor: query.cursor,
      take: query.take,
    }));
  }

  @Get('folders')
  async listFolders(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Query() query: FolderListQueryDto,
  ) {
    await this.authorize(request, spaceId, [...READ_ROLES], 'pages:read');
    return decimalTreeRevision(await this.tree.listFolders({
      spaceId,
      query: query.query,
      cursor: query.cursor,
      take: query.take,
    }));
  }

  @Post('folders')
  async createFolder(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Body() body: CreateFolderDto,
  ) {
    const principal = await this.authorize(request, spaceId, [...EDIT_ROLES], 'pages:write');
    return decimalTreeRevision(await this.tree.createFolder({
      spaceId,
      name: body.name,
      parentId: body.parentId,
      expectedTreeRevision: parseTreeRevision(body.expectedTreeRevision),
      actor: { userId: principal.userId },
    }));
  }

  @Patch('folders/:folderId')
  async renameFolder(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Param('folderId') folderId: string,
    @Body() body: RenameFolderDto,
  ) {
    const principal = await this.authorize(request, spaceId, [...EDIT_ROLES], 'pages:write');
    return decimalTreeRevision(await this.tree.renameFolder({
      spaceId,
      folderId,
      name: body.name,
      expectedUpdatedAt: new Date(body.expectedUpdatedAt),
      expectedTreeRevision: parseTreeRevision(body.expectedTreeRevision),
      actor: { userId: principal.userId },
    }));
  }

  @Patch('content-tree/move')
  async moveNode(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Body() body: MoveContentTreeNodeDto,
  ) {
    const principal = await this.authorize(request, spaceId, [...EDIT_ROLES], 'pages:write');
    return decimalTreeRevision(await this.tree.moveNode({
      spaceId,
      kind: body.kind,
      nodeId: body.id,
      targetFolderId: body.targetParentFolderId,
      beforeId: body.beforeId,
      expectedUpdatedAt: new Date(body.expectedUpdatedAt),
      expectedTreeRevision: parseTreeRevision(body.expectedTreeRevision),
      actor: { userId: principal.userId },
    }));
  }

  @Get('folders/:folderId/delete-impact')
  async deleteImpact(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Param('folderId') folderId: string,
  ) {
    await this.authorize(request, spaceId, [...READ_ROLES], 'pages:read');
    return decimalTreeRevision(await this.tree.deleteImpact({ spaceId, folderId }));
  }

  @Delete('folders/:folderId')
  async deleteFolder(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Param('folderId') folderId: string,
    @Body() body: DeleteFolderDto,
  ) {
    const principal = await this.authorize(request, spaceId, [...DELETE_ROLES], 'pages:write');
    return decimalTreeRevision(await this.tree.deleteFolder({
      spaceId,
      folderId,
      expectedUpdatedAt: new Date(body.expectedUpdatedAt),
      expectedTreeRevision: parseTreeRevision(body.expectedTreeRevision),
      expectedImpactHash: body.expectedImpactHash,
      actor: { userId: principal.userId },
    }));
  }

  @Post('folders/:folderId/restore')
  async restoreFolder(
    @Req() request: Request,
    @Param('spaceId') spaceId: string,
    @Param('folderId') folderId: string,
    @Body() body: RestoreFolderDto,
  ) {
    const principal = await this.authorize(request, spaceId, [...DELETE_ROLES], 'pages:write');
    const strategy = body.mode === 'rename-root'
      ? { kind: body.mode, name: body.name! } as const
      : { kind: body.mode } as const;
    return decimalTreeRevision(await this.tree.restoreDeletionBatch({
      spaceId,
      rootFolderId: folderId,
      deletionBatchId: body.deletionBatchId,
      strategy,
      expectedUpdatedAt: new Date(body.expectedUpdatedAt),
      expectedTreeRevision: parseTreeRevision(body.expectedTreeRevision),
      actor: { userId: principal.userId },
    }));
  }

  private async authorize(
    request: Request,
    spaceId: string,
    roles: Array<'owner' | 'admin' | 'editor' | 'viewer'>,
    scope: string,
  ): Promise<Principal> {
    const principal = request.user as Principal;
    const access = await this.authorization.assertSpaceAccess(principal, spaceId, roles, scope);
    const accessRole = String(access.role) as 'owner' | 'admin' | 'editor' | 'viewer';
    const isSuperAdmin = 'isSuperAdmin' in access && access.isSuperAdmin === true;
    if (!roles.includes(accessRole) && !isSuperAdmin) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'You do not have permission to modify Folders in this space');
    }
    return principal;
  }
}
