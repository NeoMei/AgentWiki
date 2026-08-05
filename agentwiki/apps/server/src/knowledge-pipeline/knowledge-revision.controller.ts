import { Controller, Get, Post, Param, Query, Body, Headers, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { IsString } from 'class-validator';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { CurrentPrincipal } from '../core/auth/current-principal.decorator';
import { AuthorizationService, Principal } from '../core/authorization/authorization.service';
import { KnowledgeRevisionService } from '../knowledge-revision/knowledge-revision.service';
import { KnowledgeSubmissionService, SubmitPrincipal } from './knowledge-submission.service';

export class KnowledgeBundleSubmitDto {
  @IsString()
  body: string;

  @IsString()
  idempotencyKey: string;
}

@Controller('spaces/:spaceId')
@UseGuards(CombinedAuthGuard)
export class KnowledgeRevisionController {
  constructor(
    private readonly revisionService: KnowledgeRevisionService,
    private readonly submissionService: KnowledgeSubmissionService,
    private readonly auth: AuthorizationService,
  ) {}

  @Get('knowledge-revisions/current')
  async current(@Param('spaceId') spaceId: string, @CurrentPrincipal() principal: Principal) {
    await this.auth.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read');
    return this.revisionService.current(spaceId);
  }

  @Get('knowledge-revisions/:revisionId/snapshot')
  async snapshot(@Param('spaceId') spaceId: string, @Param('revisionId') revisionId: string, @CurrentPrincipal() principal: Principal) {
    await this.auth.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read');
    return this.revisionService.snapshot(spaceId, revisionId === 'current' ? undefined : revisionId);
  }

  @Get('knowledge-revisions/delta')
  async delta(@Param('spaceId') spaceId: string, @Query('from') from: string, @CurrentPrincipal() principal: Principal) {
    await this.auth.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read');
    if (!from) throw new Error('Missing from query parameter');
    return this.revisionService.delta(spaceId, from);
  }

  @Post('knowledge-submissions')
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(
    @Param('spaceId') spaceId: string,
    @Body() dto: KnowledgeBundleSubmitDto,
    @Headers('x-agentwiki-user-confirmed') confirmed: string | undefined,
    @CurrentPrincipal() principal: SubmitPrincipal,
  ) {
    const result = await this.submissionService.submit(
      spaceId,
      principal,
      Buffer.from(dto.body, 'base64'),
      dto.idempotencyKey,
      confirmed === 'true',
    );
    return result;
  }

  @Get('knowledge-submissions/:submissionId')
  async getSubmission(
    @Param('spaceId') spaceId: string,
    @Param('submissionId') submissionId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    await this.auth.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read');
    return this.submissionService.getSubmission(spaceId, submissionId);
  }
}
