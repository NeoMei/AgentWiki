import { SourceFreshnessService } from '../source-freshness/source-freshness.service';
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
    private readonly freshness: SourceFreshnessService,
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
    const resultLimit = parseLimit(limit, 10);
    const maxLimit = 100;
    if (!query) {
      return { results: [], total: 0, returnedCount: 0, limit: resultLimit, maxLimit, hasMore: false };
    }
    this.logger.log('Search requested');
    const principal = req.user as any;
    if (spaceId) {
      await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read');
    }
    const accessibleSpaceIds = await this.authorization.getAccessibleSpaceIds(principal, 'pages:read');
    // One extra authorized match tells the client whether it can expand the
    // ranked window. This endpoint has no offset/cursor or full-result count.
    const candidates = await this.searchService.searchPages(
      query,
      spaceId,
      resultLimit + 1,
      accessibleSpaceIds,
    );
    const results = candidates.slice(0, resultLimit);
    const pages = await this.freshness.projectPages(results.map(result => result.page), principal);
    return {
      results: results.map((result, index) => ({ ...result, page: pages[index] })),
      // Legacy compatibility: total has always meant this window's count.
      total: results.length,
      returnedCount: results.length,
      limit: resultLimit,
      maxLimit,
      hasMore: candidates.length > resultLimit,
    };
  }

  @Post('index/:pageId')
  async indexPage(@Param('pageId') pageId: string, @Req() req: Request) {
    await this.authorization.assertPageAccess(req.user as any, pageId, ['owner', 'editor'], 'pages:write');
    await this.searchService.indexPage(pageId);
    return { message: 'Page indexed successfully' };
  }
}
