import { Controller, Get, Post, Param, Query, Logger, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { SearchService } from './search.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { parseLimit } from '../utils/pagination';

@Controller('search')
@UseGuards(CombinedAuthGuard)
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(
    private searchService: SearchService,
    private authorization: AuthorizationService,
  ) {}

  @Get()
  async search(
    @Req() req: Request,
    @Query('q') query: string,
    @Query('spaceId') spaceId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!query) {
      return { results: [], total: 0 };
    }
    this.logger.log('Search requested');
    const principal = req.user as any;
    if (spaceId) {
      await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read');
    }
    const accessibleSpaceIds = await this.authorization.getAccessibleSpaceIds(principal, 'pages:read');
    const results = await this.searchService.searchPages(
      query,
      spaceId,
      parseLimit(limit, 10),
      accessibleSpaceIds,
    );
    return { results, total: results.length };
  }

  @Post('index/:pageId')
  async indexPage(@Param('pageId') pageId: string, @Req() req: Request) {
    await this.authorization.assertPageAccess(req.user as any, pageId, ['owner', 'editor'], 'pages:write');
    await this.searchService.indexPage(pageId);
    return { message: 'Page indexed successfully' };
  }
}
