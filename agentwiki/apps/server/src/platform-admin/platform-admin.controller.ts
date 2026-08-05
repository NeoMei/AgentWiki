import { Controller, Get, Post, Delete, Param, Query, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { PlatformSuperAdminGuard } from './platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';

@Controller('platform-admin')
@UseGuards(CombinedAuthGuard, PlatformSuperAdminGuard)
export class PlatformAdminController {
  constructor(private readonly service: PlatformAdminService) {}

  @Get('stats')
  async stats() {
    return this.service.stats();
  }

  @Get('users')
  async listUsers(
    @Query('query') query?: string,
    @Query('status') status?: string,
    @Query('platformRole') platformRole?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listUsers({
      query,
      status: status || 'all',
      platformRole: platformRole || 'all',
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Post('users/:id/reset-password')
  async resetPassword(@Req() req: any, @Param('id') targetId: string) {
    const pwd = await this.service.resetPassword(req.user.userId, targetId);
    return { password: pwd };
  }

  @Post('users/:id/lock')
  @HttpCode(HttpStatus.OK)
  async lockUser(@Req() req: any, @Param('id') targetId: string) {
    return this.service.lockUser(req.user.userId, targetId);
  }

  @Post('users/:id/unlock')
  @HttpCode(HttpStatus.OK)
  async unlockUser(@Req() req: any, @Param('id') targetId: string) {
    return this.service.unlockUser(req.user.userId, targetId);
  }

  @Delete('users/:id')
  async deleteUser(@Req() req: any, @Param('id') targetId: string) {
    return this.service.deleteUser(req.user.userId, targetId);
  }
}
