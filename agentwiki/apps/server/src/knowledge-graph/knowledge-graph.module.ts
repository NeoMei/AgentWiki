import { Module } from '@nestjs/common';
import { KnowledgeGraphController } from './knowledge-graph.controller';
import { GraphExtractionService } from './graph-extraction.service';
import { GraphRefreshService } from './graph-refresh.service';
import { GraphMaintenance } from './graph-maintenance';
import { AuthorizationModule } from '../core/authorization/authorization.module';
import { LlmModule } from '../integrations/llm/llm.module';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { SyncModule } from '../core/sync/sync.module';

@Module({
  imports: [DatabaseModule, AuthorizationModule, SyncModule, LlmModule, ConfigModule],
  controllers: [KnowledgeGraphController],
  providers: [GraphExtractionService, GraphRefreshService, GraphMaintenance],
  exports: [GraphRefreshService, GraphMaintenance],
})
export class KnowledgeGraphModule {}
