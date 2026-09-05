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
import { ProgressionService } from './progression.service';
import { ReviewService } from './review.service';
import { CollaborationEventsService } from './collaboration-events.service';
import { RecoveryWorker } from './recovery.worker';
import { HistoryCursorService } from './history-cursor.service';
import { RunExpansionService } from './run-expansion.service';
import { ContentTreeModule } from '../content-tree/content-tree.module';

@Module({
  imports: [DatabaseModule, AuthorizationModule, AuthModule, ConfigModule, ContentTreeModule],
  controllers: [TemplateController, RunController],
  providers: [
    TemplateService, RunEventStore, RunService, ArtifactValidator, ProgressionService, ExecutionService, ReviewService,
    CollaborationEventsService, HistoryCursorService, RecoveryWorker, RunExpansionService,
  ],
  exports: [
    TemplateService, RunEventStore, RunService, ArtifactValidator, ProgressionService, ExecutionService, ReviewService,
    CollaborationEventsService, RunExpansionService,
  ],
})
export class CollaborationWorkflowsModule {}
