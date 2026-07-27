import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { AssistService } from './assist.service';
import { AssistQueue } from './assist.queue';

@Controller('assist')
@UseGuards(CombinedAuthGuard)
export class AssistController {
  constructor(
    private readonly assist: AssistService,
    private readonly queue: AssistQueue,
    private readonly authorization: AuthorizationService,
  ) {}

  @Post('tasks')
  async createTask(
    @Body() body: { spaceId: string; pageId?: string; intent: string; snapshot?: Record<string, unknown> },
    @Req() req: Request,
  ) {
    await this.authorization.assertSpaceAccess(req.user as any, body.spaceId, ['owner', 'editor'], 'pages:write');
    const task = await this.assist.createTask({
      spaceId: body.spaceId,
      pageId: body.pageId,
      intent: body.intent,
      snapshot: body.snapshot,
      userId: (req.user as any).userId,
    });
    this.queue.enqueue();
    return task;
  }

  @Get('tasks')
  async listTasks(@Query('pageId') pageId: string, @Req() req: Request) {
    if (!pageId) throw new BadRequestException('pageId is required');
    await this.authorization.assertPageAccess(req.user as any, pageId, ['owner', 'editor', 'viewer'], 'pages:read');
    return this.assist.listForPage(pageId);
  }

  @Get('tasks/:id')
  async getTask(@Param('id') id: string, @Req() req: Request) {
    const task = await this.assist.get(id);
    if (task) await this.authorization.assertSpaceAccess(req.user as any, task.spaceId, ['owner', 'editor', 'viewer'], 'pages:read');
    return task;
  }
}
