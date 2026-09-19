import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../core/auth/auth.module';
import { ProjectTaskboardController } from './project-taskboard.controller';
import { ProjectTaskboardService } from './project-taskboard.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ProjectTaskboardController],
  providers: [ProjectTaskboardService],
  exports: [ProjectTaskboardService],
})
export class ProjectTaskboardModule {}
