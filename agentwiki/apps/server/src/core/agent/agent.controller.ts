import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HumanOnlyGuard } from '../auth/human-only.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { CreateAgentCredentialDto, CreateAgentDto, UpdateAgentDto, UpsertAgentGrantDto } from '../dto/agent.dto';
import { AgentService } from './agent.service';
import { parseLimit, parseOffset } from '../utils/pagination';

@Controller('agents')
@UseGuards(JwtAuthGuard, HumanOnlyGuard)
export class AgentController {
  constructor(
    private readonly agents: AgentService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Post()
  create(@Req() req: Request, @Body() dto: CreateAgentDto) {
    return this.agents.create((req.user as any).userId, dto);
  }

  @Get()
  list(@Req() req: Request) {
    return this.agents.list((req.user as any).userId);
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id') id: string) {
    return this.agents.getOwned((req.user as any).userId, id);
  }

  @Patch(':id')
  update(@Req() req: Request, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agents.update((req.user as any).userId, id, dto);
  }

  @Delete(':id')
  revoke(@Req() req: Request, @Param('id') id: string) {
    return this.agents.revoke((req.user as any).userId, id);
  }

  @Post(':id/credentials')
  createCredential(@Req() req: Request, @Param('id') id: string, @Body() dto: CreateAgentCredentialDto) {
    return this.agents.createCredential((req.user as any).userId, id, dto);
  }

  @Get(':id/credentials')
  listCredentials(@Req() req: Request, @Param('id') id: string) {
    return this.agents.listCredentials((req.user as any).userId, id);
  }

  @Delete(':id/credentials/:credentialId')
  revokeCredential(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('credentialId') credentialId: string,
  ) {
    return this.agents.revokeCredential((req.user as any).userId, id, credentialId);
  }

  @Put(':id/grants/:spaceId')
  async upsertGrant(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('spaceId') spaceId: string,
    @Body() dto: UpsertAgentGrantDto,
  ) {
    const ownerId = (req.user as any).userId;
    await this.authorization.assertSpaceAccess(ownerId, spaceId, ['owner']);
    return this.agents.upsertGrant(ownerId, id, spaceId, dto.role);
  }

  @Delete(':id/grants/:spaceId')
  async removeGrant(@Req() req: Request, @Param('id') id: string, @Param('spaceId') spaceId: string) {
    const ownerId = (req.user as any).userId;
    await this.authorization.assertSpaceAccess(ownerId, spaceId, ['owner']);
    return this.agents.removeGrant(ownerId, id, spaceId);
  }

  @Get(':id/activity')
  activity(
    @Req() req: Request,
    @Param('id') id: string,
    @Query('skip') skip = '0',
    @Query('take') take = '50',
  ) {
    return this.agents.activity(
      (req.user as any).userId,
      id,
      parseOffset(skip),
      parseLimit(take, 50),
    );
  }
}
