import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../core/auth/auth.module';
import { AuthorizationModule } from '../core/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';
import { RunController } from './run.controller';
import { RunEventStore } from './run-event.store';
import { RunService } from './run.service';
import { ArtifactValidator } from './artifact-validator';
import { ExecutionService } from './execution.service';

@Module({
  imports: [DatabaseModule, AuthorizationModule, AuthModule, ConfigModule],
  controllers: [TemplateController, RunController],
  providers: [TemplateService, RunEventStore, RunService, ArtifactValidator, ExecutionService],
  exports: [TemplateService, RunEventStore, RunService, ArtifactValidator, ExecutionService],
})
export class CollaborationWorkflowsModule {}
