import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import type { Principal } from '../core/authorization/authorization.service';
import {
  CreateRunDraftDto,
  ReassignTaskDto,
  RunActionDto,
  StartRunDto,
  UpdateRunDraftDto,
  ValidateRunDraftDto,
} from './run.dto';
import { RunService } from './run.service';
import { ReviewDecisionDto } from './review.dto';
import { ReviewService } from './review.service';

@Controller('spaces/:spaceId/collaboration/runs')
@UseGuards(CombinedAuthGuard, HumanOnlyGuard)
export class RunController {
  constructor(private readonly runs: RunService, private readonly reviews: ReviewService) {}

  @Post('drafts')
  create(@Req() req: Request, @Param('spaceId') spaceId: string, @Body() body: CreateRunDraftDto) {
    return this.runs.createDraft(spaceId, body, req.user as Principal);
  }

  @Put(':runId/draft')
  update(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('runId') runId: string, @Body() body: UpdateRunDraftDto) {
    return this.runs.updateDraft(spaceId, runId, body, req.user as Principal);
  }

  @Post(':runId/validate')
  validate(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('runId') runId: string, @Body() body: ValidateRunDraftDto) {
    return this.runs.validateDraft(spaceId, runId, body, req.user as Principal);
  }

  @Post(':runId/start')
  start(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('runId') runId: string, @Body() body: StartRunDto) {
    return this.runs.startRun(spaceId, runId, body, req.user as Principal);
  }

  @Get()
  list(@Req() req: Request, @Param('spaceId') spaceId: string) {
    return this.runs.listRuns(spaceId, req.user as Principal);
  }

  @Get(':runId')
  get(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('runId') runId: string) {
    return this.runs.getHumanRun(spaceId, runId, req.user as Principal);
  }

  @Post(':runId/actions/pause')
  pause(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('runId') runId: string, @Body() body: RunActionDto) {
    return this.runs.pauseRun(runId, body, req.user as Principal, spaceId);
  }

  @Post(':runId/actions/resume')
  resume(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('runId') runId: string, @Body() body: RunActionDto) {
    return this.runs.resumeRun(runId, body, req.user as Principal, spaceId);
  }

  @Post(':runId/actions/fail')
  fail(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('runId') runId: string, @Body() body: RunActionDto) {
    return this.runs.failRun(runId, body, req.user as Principal, spaceId);
  }

  @Post(':runId/actions/cancel')
  cancel(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('runId') runId: string, @Body() body: RunActionDto) {
    return this.runs.cancelRun(runId, body, req.user as Principal, spaceId);
  }

  @Post(':runId/tasks/:taskId/retry')
  retry(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('runId') runId: string, @Param('taskId') taskId: string, @Body() body: RunActionDto) {
    return this.runs.retryTask(runId, taskId, body, req.user as Principal, spaceId);
  }

  @Post(':runId/tasks/:taskId/reassign')
  reassign(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('runId') runId: string, @Param('taskId') taskId: string, @Body() body: ReassignTaskDto) {
    return this.runs.reassignTask(runId, taskId, body, req.user as Principal, spaceId);
  }

  @Post(':runId/tasks/:taskId/skip')
  skip(@Req() req: Request, @Param('spaceId') spaceId: string, @Param('runId') runId: string, @Param('taskId') taskId: string, @Body() body: RunActionDto) {
    return this.runs.skipTask(runId, taskId, body, req.user as Principal, spaceId);
  }

  @Post(':runId/reviews/:reviewId/decision')
  decideReview(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('runId') runId: string,
    @Param('reviewId') reviewId: string,
    @Body() body: ReviewDecisionDto,
  ) {
    return this.reviews.decide(spaceId, runId, reviewId, body, req.user as Principal);
  }
}
