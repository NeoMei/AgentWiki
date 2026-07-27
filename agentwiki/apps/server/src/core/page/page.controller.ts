import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Logger, Req, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { PageService } from './page.service';
import { CreatePageDto, UpdatePageDto } from '../dto/page.dto';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { ReviewService } from '../../review/review.service';
import { parseLimit, parseOffset } from '../utils/pagination';

@Controller('pages')
@UseGuards(CombinedAuthGuard)
export class PageController {
  private readonly logger = new Logger(PageController.name);

  constructor(
    private readonly pageService: PageService,
    private readonly authorization: AuthorizationService,
    private readonly review: ReviewService,
  ) {}

  @Post()
  async create(@Body() dto: CreatePageDto, @Req() req: Request) {
    const user = req.user as any;
    await this.authorization.assertSpaceAccess(user, dto.spaceId, ['owner', 'editor'], 'pages:write');
    if (user.agentId) {
      return this.review.propose(user, dto.spaceId, `Proposed page: ${dto.title}`, {
        type: 'create_page', payload: {
          title: dto.title,
          content: dto.content || '',
          slug: dto.slug,
          parentId: dto.parentId,
          format: dto.format,
        },
      });
    }
    this.logger.log('Creating page: ' + dto.title + ' by user ' + user.userId);
    return this.pageService.create(dto, user.userId);
  }

  @Get()
  async findAll(
    @Req() req: Request,
    @Query('spaceId') spaceId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    this.logger.log('Listing pages');
    const principal = req.user as any;
    if (spaceId) {
      await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'editor', 'viewer'], 'pages:read');
    }
    const accessibleSpaceIds = await this.authorization.getAccessibleSpaceIds(principal, 'pages:read');
    return this.pageService.findAll(
      accessibleSpaceIds,
      spaceId,
      parseOffset(skip),
      parseLimit(take),
    );
  }

  @Get('hierarchy/:spaceId')
  async findHierarchy(@Param('spaceId') spaceId: string, @Req() req: Request) {
    await this.authorization.assertSpaceAccess(req.user as any, spaceId, ['owner', 'editor', 'viewer'], 'pages:read');
    this.logger.log('Finding page hierarchy for space: ' + spaceId);
    return this.pageService.findHierarchy(spaceId);
  }

  @Patch('reorder/:spaceId')
  async reorderPages(
    @Param('spaceId') spaceId: string,
    @Body() body: { items: Array<{ id: string; parentId: string | null; sortOrder: number }> },
    @Req() req: Request,
  ) {
    await this.authorization.assertSpaceAccess(req.user as any, spaceId, ['owner', 'editor'], 'pages:write');
    return this.pageService.reorder(spaceId, body.items || []);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: Request) {
    await this.authorization.assertPageAccess(req.user as any, id, ['owner', 'editor', 'viewer'], 'pages:read');
    this.logger.log('Finding page: ' + id);
    return this.pageService.findOne(id);
  }

  @Get(':id/versions')
  async getVersionHistory(@Param('id') id: string, @Req() req: Request) {
    await this.authorization.assertPageAccess(req.user as any, id, ['owner', 'editor', 'viewer'], 'pages:read');
    this.logger.log('Getting version history for page: ' + id);
    return this.pageService.getVersionHistory(id);
  }

  @Post(':id/versions/:versionId/restore')
  async restoreVersion(@Param('id') id: string, @Param('versionId') versionId: string, @Req() req: Request) {
    await this.authorization.assertPageAccess(req.user as any, id, ['owner', 'editor'], 'pages:write');
    if ((req.user as any).agentId) throw new ForbiddenException('Agents must propose content changes through review');
    this.logger.log('Restoring version ' + versionId + ' for page: ' + id);
    return this.pageService.restoreVersion(id, versionId);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdatePageDto, @Req() req: Request) {
    this.logger.log('Updating page: ' + id);
    const user = req.user as any;
    const page = await this.authorization.assertPageAccess(user, id, ['owner', 'editor'], 'pages:write');
    if (user.agentId) {
      const current = await this.pageService.findOne(id);
      const { expectedUpdatedAt, ...changes } = dto;
      return this.review.propose(user, page.spaceId, `Proposed update: ${id}`, {
        type: 'update_page', payload: {
          pageId: id,
          expectedUpdatedAt: expectedUpdatedAt || current.updatedAt.toISOString(),
          changes,
        },
      });
    }
    return this.pageService.update(id, dto, user?.userId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    await this.authorization.assertPageAccess(req.user as any, id, ['owner', 'editor'], 'pages:write');
    if ((req.user as any).agentId) throw new ForbiddenException('Agent page deletion proposals are not enabled');
    this.logger.log('Removing page: ' + id);
    return this.pageService.remove(id);
  }
}
