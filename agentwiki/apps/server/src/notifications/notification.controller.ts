import { Controller, Get, Patch, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { HumanOnlyGuard } from '../core/auth/human-only.guard';
import { Principal } from '../core/authorization/authorization.service';
import { parseNotificationListQuery } from './notification.schema';
import { NotificationService } from './notification.service';

@Controller('notifications')
@UseGuards(CombinedAuthGuard, HumanOnlyGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @Req() req: Request) {
    return this.notifications.list(req.user as Principal, parseNotificationListQuery(query));
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @Req() req: Request) {
    return this.notifications.markRead(req.user as Principal, id);
  }

  @Post('read-all')
  markAllRead(@Req() req: Request) {
    return this.notifications.markAllRead(req.user as Principal);
  }
}
