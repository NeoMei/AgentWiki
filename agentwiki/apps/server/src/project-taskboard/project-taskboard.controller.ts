import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Query,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import type { Principal } from '../core/authorization/authorization.service';
import {
  TaskboardImportPlanDto,
  TaskboardStatusDto,
  TaskboardTaskDto,
} from './project-taskboard.dto';
import { ProjectTaskboardService } from './project-taskboard.service';

/**
 * Native port of the project-taskboard local REST API. Agents that previously
 * reported to the standalone Python server keep the same wire shapes; only the
 * base URL changes (AgentWiki adds the space scope and standard auth).
 */
@Controller('spaces/:spaceId/taskboard')
@UseGuards(CombinedAuthGuard)
export class ProjectTaskboardController {
  constructor(private readonly taskboard: ProjectTaskboardService) {}

  @Get()
  board(@Req() req: Request, @Param('spaceId') spaceId: string) {
    return this.taskboard.getBoard(req.user as Principal, spaceId);
  }

  @Get('health')
  health(@Req() req: Request, @Param('spaceId') spaceId: string) {
    return this.taskboard.getHealth(req.user as Principal, spaceId);
  }

  @Get('tasks')
  tasks(@Req() req: Request, @Param('spaceId') spaceId: string) {
    return this.taskboard.listTasks(req.user as Principal, spaceId);
  }

  @Get('events')
  events(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Query('limit') limit?: string,
  ) {
    return this.taskboard.listEvents(req.user as Principal, spaceId, limit);
  }

  @Post('tasks')
  create(@Req() req: Request, @Param('spaceId') spaceId: string, @Body() body: TaskboardTaskDto) {
    return this.taskboard.createTask(req.user as Principal, spaceId, body);
  }

  @Post('tasks/:taskId/children')
  createChild(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('taskId') taskId: string,
    @Body() body: TaskboardTaskDto,
  ) {
    return this.taskboard.createChild(req.user as Principal, spaceId, taskId, body);
  }

  @HttpCode(200)
  @Post('tasks/:taskId/status')
  updateStatus(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('taskId') taskId: string,
    @Body() body: TaskboardStatusDto,
  ) {
    return this.taskboard.updateStatus(req.user as Principal, spaceId, taskId, body);
  }

  @Put('tasks/:taskId')
  async upsert(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param('spaceId') spaceId: string,
    @Param('taskId') taskId: string,
    @Body() body: TaskboardTaskDto,
  ) {
    const result = await this.taskboard.upsertTask(req.user as Principal, spaceId, taskId, body);
    res.status(result.created ? 201 : 200);
    return result;
  }

  @Patch('tasks/:taskId')
  patch(
    @Req() req: Request,
    @Param('spaceId') spaceId: string,
    @Param('taskId') taskId: string,
    @Body() body: TaskboardTaskDto,
  ) {
    return this.taskboard.patchTask(req.user as Principal, spaceId, taskId, body);
  }

  @Post('import-plan')
  importPlan(@Req() req: Request, @Param('spaceId') spaceId: string, @Body() body: TaskboardImportPlanDto) {
    return this.taskboard.importPlan(req.user as Principal, spaceId, body);
  }
}
