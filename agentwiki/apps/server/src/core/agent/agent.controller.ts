import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HumanOnlyGuard } from '../auth/human-only.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { CreateAgentDto, UpdateAgentDto, UpsertAgentGrantDto } from '../dto/agent.dto';
import { AgentService } from './agent.service';
import { LocalSyncInstallationService } from './local-sync-installation.service';
import { parseLimit, parseOffset } from '../utils/pagination';

@Controller('agents')
@UseGuards(JwtAuthGuard, HumanOnlyGuard)
export class AgentController {
  constructor(
    private readonly agents: AgentService,
    private readonly authorization: AuthorizationService,
    private readonly localSyncInstallations: LocalSyncInstallationService,
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
    return this.localSyncInstallations.revokeCredentialAndReceipts(
      (req.user as any).userId,
      id,
      credentialId,
    );
  }

  @Put(':id/grants/:spaceId')
  async upsertGrant(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('spaceId') spaceId: string,
    @Body() dto: UpsertAgentGrantDto,
  ) {
    const principal = req.user as any;
    const ownerId = principal.userId;
    await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'admin']);
    return this.agents.upsertGrantForSpace(
      ownerId,
      id,
      spaceId,
      dto.role,
      principal.platformRole === 'super_admin',
    );
  }

  @Delete(':id/grants/:spaceId')
  async removeGrant(@Req() req: Request, @Param('id') id: string, @Param('spaceId') spaceId: string) {
    const principal = req.user as any;
    await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'admin']);
    return this.agents.removeGrant(
      principal.userId,
      id,
      spaceId,
      principal.platformRole === 'super_admin',
    );
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
