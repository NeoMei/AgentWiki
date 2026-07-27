import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Logger, Req, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { UserService } from './user.service';
import { CreateUserDto, UpdateUserDto } from '../dto/user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditService } from '../security/audit.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  create(@Body() _dto: CreateUserDto) {
    throw new ForbiddenException('Users must register through the public registration endpoint');
  }

  @Get('me')
  getMe(@Req() req: Request) {
    const user = req.user as any;
    this.logger.log('Getting current user: ' + user.userId);
    return this.userService.findOne(user.userId);
  }

  @Get()
  findAll(
    @Query('skip') _skip?: string,
    @Query('take') _take?: string,
  ) {
    this.logger.log('Listing users');
    throw new ForbiddenException('User directory listing is not available');
  }

  @Post('me/api-key')
  async generateApiKey(@Req() req: Request) {
    const user = req.user as any;
    this.logger.log('Generating API key for user: ' + user.userId);
    const apiKey = await this.userService.regenerateApiKey(user.userId);
    await this.audit.record({
      action: 'personal_token.rotate',
      outcome: 'success',
      actorUserId: user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { apiKey };
  }

  @Delete('me/api-key')
  async revokeApiKey(@Req() req: Request) {
    const user = req.user as any;
    this.logger.log('Revoking API key for user: ' + user.userId);
    await this.userService.revokeApiKey(user.userId);
    await this.audit.record({
      action: 'personal_token.revoke',
      outcome: 'success',
      actorUserId: user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { message: 'Personal access token revoked' };
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: Request) {
    if ((req.user as any).userId !== id) {
      throw new ForbiddenException('You can only view your own profile');
    }
    this.logger.log('Finding user: ' + id);
    return this.userService.findOne(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: Request) {
    const user = req.user as any;
    // Users can only update their own profile
    if (user.userId !== id) {
      throw new ForbiddenException('You can only update your own profile');
    }
    this.logger.log('Updating user: ' + id);
    return this.userService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as any;
    // Users can only delete their own account
    if (user.userId !== id) {
      throw new ForbiddenException('You can only delete your own account');
    }
    this.logger.log('Removing user: ' + id);
    return this.userService.remove(id);
  }
}
