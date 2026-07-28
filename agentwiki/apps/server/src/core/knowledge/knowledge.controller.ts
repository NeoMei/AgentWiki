import { Controller, Get, Post, Delete, Patch, Body, Param, Logger, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { KnowledgeService } from './knowledge.service';
import { CreateKnowledgeRelationDto, UpdateKnowledgeRelationStrengthDto } from '../dto/knowledge-relation.dto';
import { AuthorizationService } from '../authorization/authorization.service';
import { ReviewService } from '../../review/review.service';

@Controller('knowledge')
@UseGuards(CombinedAuthGuard)
export class KnowledgeController {
  private readonly logger = new Logger(KnowledgeController.name);

  constructor(
    private knowledgeService: KnowledgeService,
    private authorization: AuthorizationService,
    private review: ReviewService,
  ) {}

  @Post('relations')
  async createRelation(@Body() dto: CreateKnowledgeRelationDto, @Req() req: Request) {
    const principal = req.user as any;
    const source = await this.authorization.assertPageAccess(principal, dto.sourcePageId, ['owner', 'editor'], 'graph:write');
    const target = await this.authorization.assertPageAccess(principal, dto.targetPageId, ['owner', 'editor'], 'graph:write');
    if (source.spaceId !== target.spaceId) throw new ForbiddenException('Knowledge relations cannot cross space boundaries');
    if (principal.agentId) {
      return this.review.propose(principal, source.spaceId, `Proposed relation: ${dto.relation}`, {
        type: 'create_relation', payload: dto as any,
      });
    }
    return this.knowledgeService.createRelation(dto, principal.userId);
  }

  @Get('relations/:pageId')
  async getRelations(@Param('pageId') pageId: string, @Req() req: Request) {
    await this.authorization.assertPageAccess(req.user as any, pageId, ['owner', 'admin', 'editor', 'viewer'], 'graph:read');
    return this.knowledgeService.getRelations(pageId);
  }

  @Get('related/:pageId')
  async getRelatedPages(@Param('pageId') pageId: string, @Req() req: Request) {
    await this.authorization.assertPageAccess(req.user as any, pageId, ['owner', 'admin', 'editor', 'viewer'], 'graph:read');
    return this.knowledgeService.getRelatedPages(pageId);
  }

  @Delete('relations/:id')
  async deleteRelation(@Param('id') id: string, @Req() req: Request) {
    await this.authorization.assertRelationAccess(req.user as any, id, ['owner', 'editor'], 'graph:write');
    if ((req.user as any).agentId) throw new ForbiddenException('Agent relation deletion proposals are not enabled');
    return this.knowledgeService.deleteRelation(id);
  }

  @Patch('relations/:id/strength')
  async updateStrength(@Param('id') id: string, @Body() dto: UpdateKnowledgeRelationStrengthDto, @Req() req: Request) {
    await this.authorization.assertRelationAccess(req.user as any, id, ['owner', 'editor'], 'graph:write');
    if ((req.user as any).agentId) throw new ForbiddenException('Agents must propose relationship changes through review');
    return this.knowledgeService.updateRelationStrength(id, dto.strength, (req.user as any).userId);
  }

  @Get('graph/:spaceId')
  async getGraph(@Param('spaceId') spaceId: string, @Req() req: Request) {
    await this.authorization.assertSpaceAccess(req.user as any, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'graph:read');
    return this.knowledgeService.getGraph(spaceId);
  }
}
