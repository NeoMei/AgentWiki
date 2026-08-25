import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Logger, Req, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { SpaceService } from './space.service';
import { CreateSpaceDto, UpdateSpaceDto, AddMemberDto, UpdateMemberRoleDto, SpaceListQueryDto } from '../dto/space.dto';
import { CombinedAuthGuard } from '../auth/combined-auth.guard';
import { AuthorizationService } from '../authorization/authorization.service';
import { parseLimit, parseOffset } from '../utils/pagination';

@Controller('spaces')
@UseGuards(CombinedAuthGuard)
export class SpaceController {
  private readonly logger = new Logger(SpaceController.name);

  constructor(
    private readonly spaceService: SpaceService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Post()
  create(@Body() dto: CreateSpaceDto, @Req() req: Request) {
    const user = req.user as any;
    if (user.agentId) throw new ForbiddenException('Agents cannot create spaces');
    this.logger.log('Creating space: ' + dto.name + ' by user ' + user.userId);
    return this.spaceService.create(dto, user.userId);
  }

  @Get()
  async findAll(
    @Req() req: Request,
    @Query() query: SpaceListQueryDto,
  ) {
    const user = req.user as any;
    const accessibleSpaceIds = await this.authorization.getAccessibleSpaceIds(user, 'spaces:read');
    this.logger.log('Listing spaces for user: ' + user.userId);
    return this.spaceService.findAll(
      accessibleSpaceIds,
      {
        skip: parseOffset(query.skip),
        take: parseLimit(query.take),
        cursor: query.cursor,
      },
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: Request) {
    await this.authorization.assertSpaceAccess(req.user as any, id, ['owner', 'admin', 'editor', 'viewer'], 'spaces:read');
    this.logger.log('Finding space: ' + id);
    return this.spaceService.findOne(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSpaceDto, @Req() req: Request) {
    await this.authorization.assertSpaceAccess(req.user as any, id, ['owner']);
    this.logger.log('Updating space: ' + id);
    return this.spaceService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const principal = req.user as any;
    await this.authorization.assertSpaceAccess(principal, id, ['owner']);
    this.logger.log('Removing space: ' + id);
    return this.spaceService.remove(id, principal);
  }
  // ---- Member management ----

  @Get(':id/members')
  async listMembers(@Param('id') id: string, @Req() req: Request) {
    const principal = req.user as any;
    const member = await this.authorization.assertSpaceAccess(principal, id, ['owner', 'admin', 'editor', 'viewer'], 'spaces:read');
    return this.spaceService.listMembers(
      id,
      principal.userId,
      member.role === 'owner' || member.role === 'admin',
    );
  }

  @Post(':id/members')
  async addMember(@Param('id') id: string, @Body() dto: AddMemberDto, @Req() req: Request) {
    const member = await this.authorization.assertSpaceAccess(req.user as any, id, ['owner', 'admin']);
    // Only an owner can grant the owner role; admins manage non-owner members.
    if (dto.role === 'owner' && member.role !== 'owner') throw new ForbiddenException('Only an owner can grant the owner role');
    this.logger.log('Adding member to space: ' + id);
    return this.spaceService.addMember(id, dto.email, dto.role || 'viewer');
  }

  @Patch(':id/members/:userId')
  async updateMemberRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
    @Req() req: Request,
  ) {
    const member = await this.authorization.assertSpaceAccess(req.user as any, id, ['owner', 'admin']);
    if (dto.role === 'owner' && member.role !== 'owner') throw new ForbiddenException('Only an owner can grant the owner role');
    this.logger.log('Updating member role: ' + userId + ' in space: ' + id);
    return this.spaceService.updateMemberRoleAs(
      id,
      userId,
      dto.role,
      member.role,
      (req.user as any).userId,
    );
  }

  @Delete(':id/members/:userId')
  async removeMember(@Param('id') id: string, @Param('userId') userId: string, @Req() req: Request) {
    const member = await this.authorization.assertSpaceAccess(req.user as any, id, ['owner', 'admin']);
    this.logger.log('Removing member: ' + userId + ' from space: ' + id);
    return this.spaceService.removeMemberAs(id, userId, member.role);
  }

}
