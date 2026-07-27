import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { ChangeItemDecisionDto, ReviewDecisionDto } from '../core/dto/review.dto';
import { ReviewService } from './review.service';

@Controller()
@UseGuards(CombinedAuthGuard)
export class ReviewController {
  constructor(private review: ReviewService, private authorization: AuthorizationService) {}

  @Get('review')
  async list(@Req() req: Request, @Query('spaceId') spaceId?: string) {
    const spaceIds = await this.authorization.getAccessibleSpaceIds(req.user as any, 'review:read');
    if (spaceId && !spaceIds.includes(spaceId)) throw new ForbiddenException('Space is not accessible');
    return this.review.list(spaceId ? [spaceId] : spaceIds);
  }

  @Get('change-sets/:id')
  async get(@Param('id') id: string, @Req() req: Request) {
    await this.authorization.assertChangeSetAccess(req.user as any, id);
    return this.review.get(id);
  }

  @Patch('change-sets/:id/items/:itemId')
  async decideItem(@Param('id') id: string, @Param('itemId') itemId: string, @Req() req: Request, @Body() dto: ChangeItemDecisionDto) {
    this.assertHuman(req);
    await this.authorization.assertChangeSetAccess(req.user as any, id, ['owner'], 'review:decide');
    return this.review.decideItem(id, itemId, dto.status);
  }

  @Post('change-sets/:id/submit')
  async submit(@Param('id') id: string, @Req() req: Request) {
    await this.authorization.assertChangeSetAccess(req.user as any, id, ['owner', 'editor'], 'review:decide');
    return this.review.submitForReview(id);
  }

  @Post('change-sets/:id/approve')
  async approve(@Param('id') id: string, @Req() req: Request, @Body() dto: ReviewDecisionDto) {
    this.assertHuman(req);
    await this.authorization.assertChangeSetAccess(req.user as any, id, ['owner'], 'review:decide');
    return this.review.approve(id, (req.user as any).userId, dto.comment);
  }

  @Post('change-sets/:id/reject')
  async reject(@Param('id') id: string, @Req() req: Request, @Body() dto: ReviewDecisionDto) {
    this.assertHuman(req);
    await this.authorization.assertChangeSetAccess(req.user as any, id, ['owner'], 'review:decide');
    return this.review.reject(id, (req.user as any).userId, dto.comment);
  }

  @Post('change-sets/:id/publish')
  async publish(@Param('id') id: string, @Req() req: Request) {
    this.assertHuman(req);
    await this.authorization.assertChangeSetAccess(req.user as any, id, ['owner'], 'review:decide');
    return this.review.publish(id);
  }

  @Post('change-sets/:id/review-publish')
  async reviewPublish(@Param('id') id: string, @Req() req: Request, @Body() dto: ReviewDecisionDto) {
    this.assertHuman(req);
    await this.authorization.assertChangeSetAccess(req.user as any, id, ['owner'], 'review:decide');
    return this.review.reviewPublish(id, (req.user as any).userId, dto.comment);
  }

  @Post('change-sets/:id/revert')
  async revert(@Param('id') id: string, @Req() req: Request) {
    this.assertHuman(req);
    await this.authorization.assertChangeSetAccess(req.user as any, id, ['owner'], 'review:decide');
    return this.review.revert(id);
  }

  private assertHuman(req: Request) {
    if ((req.user as any).agentId) throw new ForbiddenException('Agents cannot approve or publish change sets');
  }
}
