import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import { AssistSessionService } from './assist-session.service';
import { AssistQueue } from './assist.queue';
import { AgentTurnMode, AgentTurnRequest } from './assist-session.types';

export class CreateAgentSessionDto {
  @IsString() @MinLength(1) @MaxLength(128) spaceId!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) title?: string;
}
export class AgentTurnDto implements AgentTurnRequest {
  @IsString() @MinLength(1) @MaxLength(128) clientRequestId!: string;
  @IsString() @MinLength(1) @MaxLength(10_000) intent!: string;
  @IsIn(['question', 'proposal']) mode!: AgentTurnMode;
  @IsString() @MinLength(1) @MaxLength(128) pageId!: string;
  @IsOptional() @IsObject() snapshot?: AgentTurnRequest['snapshot'];
  @IsOptional() @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsString({ each: true }) @MaxLength(128, { each: true }) referencePageIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MaxLength(128, { each: true }) noteIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) annotations?: AgentTurnRequest['annotations'];
}

@Controller('assist')
@UseGuards(CombinedAuthGuard, HumanOnlyGuard)
export class AssistSessionController {
  constructor(private readonly sessions: AssistSessionService, private readonly queue: AssistQueue) {}
  @Post('sessions')
  create(@Body() body: CreateAgentSessionDto, @Req() req: Request) { return this.sessions.create(body.spaceId, this.requester(req), body.title); }
  @Get('sessions')
  list(@Query('spaceId') spaceId: string, @Req() req: Request) { return this.sessions.list(spaceId, this.requester(req)); }
  @Get('sessions/:id')
  get(@Param('id') id: string, @Req() req: Request) { return this.sessions.get(id, this.requester(req)); }
  @Post('sessions/:id/turns')
  async send(@Param('id') id: string, @Body() body: AgentTurnDto, @Req() req: Request) {
    const turn = await this.sessions.send(id, this.requester(req), body);
    this.queue.enqueue();
    return turn;
  }
  @Post('tasks/:id/cancel')
  cancel(@Param('id') id: string, @Req() req: Request) { return this.sessions.cancel(id, this.requester(req)); }
  private requester(req: Request): string {
    const id = (req.user as { userId?: unknown })?.userId;
    if (typeof id !== 'string' || !id) throw new BadRequestException('Assist requester is required');
    return id;
  }
}
