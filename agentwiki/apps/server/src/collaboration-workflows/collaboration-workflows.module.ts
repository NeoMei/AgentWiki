import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../core/auth/auth.module';
import { AuthorizationModule } from '../core/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';

@Module({
  imports: [DatabaseModule, AuthorizationModule, AuthModule, ConfigModule],
  controllers: [TemplateController],
  providers: [TemplateService],
  exports: [TemplateService],
})
export class CollaborationWorkflowsModule {}
