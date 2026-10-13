import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../core/auth/auth.module';
import { AuthorizationModule } from '../core/authorization/authorization.module';
import { PageNoteController } from './page-note.controller';
import { PageNoteService } from './page-note.service';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule],
  providers: [PageNoteService],
  controllers: [PageNoteController],
  exports: [PageNoteService],
})
export class PageNoteModule {}
