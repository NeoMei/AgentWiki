import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { ConsolidateMemoryDto, CreateMemoryDto, RecallMemoryDto } from '../core/dto/memory.dto';
import { MemoryService } from './memory.service';
import { AuditService } from '../core/security/audit.service';

@Controller()
@UseGuards(CombinedAuthGuard)
export class MemoryController {
  constructor(private memories: MemoryService, private authorization: AuthorizationService, private audit: AuditService) {}

  @Post('agents/:agentId/memories')
  async create(@Param('agentId') agentId: string, @Req() req: Request, @Body() dto: CreateMemoryDto) {
    await this.authorization.assertAgentMemoryAccess(req.user as any, agentId, dto.spaceId, 'memory:write');
    const result = await this.memories.create(agentId, dto, req.user as any);
    await this.record(req, agentId, 'memory.create', dto.spaceId, result.id);
    return result;
  }

  @Get('agents/:agentId/memories')
  async list(@Param('agentId') agentId: string, @Req() req: Request, @Query('spaceId') spaceId: string) {
    await this.authorization.assertAgentMemoryAccess(req.user as any, agentId, spaceId, 'memory:read');
    return this.memories.list(agentId, spaceId);
  }

  @Post('agents/:agentId/memories/recall')
  async recall(@Param('agentId') agentId: string, @Req() req: Request, @Body() dto: RecallMemoryDto) {
    await this.authorization.assertAgentMemoryAccess(req.user as any, agentId, dto.spaceId, 'memory:read');
    const result = await this.memories.recall(agentId, dto.spaceId, dto.query, dto.limit, req.user as any);
    await this.record(req, agentId, 'memory.recall', dto.spaceId);
    return result;
  }

  @Post('agents/:agentId/memories/consolidate')
  async consolidate(@Param('agentId') agentId: string, @Req() req: Request, @Body() dto: ConsolidateMemoryDto) {
    await this.authorization.assertAgentMemoryAccess(req.user as any, agentId, dto.spaceId, 'memory:write');
    const result = await this.memories.consolidate(agentId, dto, req.user as any);
    await this.record(req, agentId, 'memory.consolidate', dto.spaceId, result.id);
    return result;
  }

  @Post('agents/:agentId/memories/:id/archive')
  async archive(@Param('agentId') agentId: string, @Param('id') id: string, @Req() req: Request, @Body('spaceId') spaceId: string) {
    await this.authorization.assertAgentMemoryAccess(req.user as any, agentId, spaceId, 'memory:write');
    const result = await this.memories.archive(agentId, spaceId, id, req.user as any);
    await this.record(req, agentId, 'memory.archive', spaceId, id);
    return result;
  }

  @Delete('agents/:agentId/memories/:id')
  async remove(@Param('agentId') agentId: string, @Param('id') id: string, @Req() req: Request, @Query('spaceId') spaceId: string) {
    await this.authorization.assertAgentMemoryAccess(req.user as any, agentId, spaceId, 'memory:write');
    const result = await this.memories.remove(agentId, spaceId, id, req.user as any);
    await this.record(req, agentId, 'memory.delete', spaceId, id);
    return result;
  }

  private record(req: Request, agentId: string, action: string, spaceId: string, memoryId?: string) {
    const principal = req.user as any;
    return this.audit.record({
      action, outcome: 'success', actorUserId: principal.agentId ? undefined : principal.userId,
      actorAgentId: principal.agentId, ipAddress: req.ip, userAgent: req.headers['user-agent'],
      metadata: { targetAgentId: agentId, spaceId, memoryId },
    });
  }
}
