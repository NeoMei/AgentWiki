import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../core/auth/auth.module';
import { AuthorizationModule } from '../core/authorization/authorization.module';
import { NotificationModule } from '../notifications/notification.module';
import { PageNoteController } from './page-note.controller';
import { PageNoteService } from './page-note.service';
import { PageNoteDiscoveryController } from './page-note-discovery.controller';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, NotificationModule],
  providers: [PageNoteService],
  controllers: [PageNoteController, PageNoteDiscoveryController],
  exports: [PageNoteService],
})
export class PageNoteModule {}
