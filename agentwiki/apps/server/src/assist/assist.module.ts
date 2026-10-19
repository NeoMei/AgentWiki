import { Module } from '@nestjs/common';
import { AssistDocumentWriter } from './assist-document-writer';
import { ContentTreeModule } from '../content-tree/content-tree.module';
import { SearchCoreModule } from '../core/search/search-core.module';
import { KnowledgeGraphModule } from '../knowledge-graph/knowledge-graph.module';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { AuthorizationModule } from '../core/authorization/authorization.module';
import { SyncModule } from '../core/sync/sync.module';
import { AuthModule } from '../core/auth/auth.module';
import { SecurityModule } from '../core/security/security.module';
import { CollaborationModule } from '../core/collaboration/collaboration.module';
import { AssistSessionService } from './assist-session.service';
import { AssistSessionController } from './assist-session.controller';
import { AssistService } from './assist.service';
import { AssistQueue } from './assist.queue';
import { AssistController } from './assist.controller';
import { RedisModelHealthStore } from './model-health.store';
import { OpencodeModelCatalog } from './opencode.catalog';
import { readRoutingConfig } from './opencode.config';
import { OpencodeCliRunner } from './opencode.runner';
import { OpencodeModelRouter } from './opencode.router';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, SyncModule, SecurityModule, CollaborationModule, ContentTreeModule, SearchCoreModule, KnowledgeGraphModule],
  controllers: [AssistController, AssistSessionController],
  providers: [
    AssistService,
    AssistDocumentWriter,
    AssistSessionService,
    AssistQueue,
    OpencodeCliRunner,
    {
      provide: OpencodeModelCatalog,
      useFactory: (runner: OpencodeCliRunner, config: ConfigService) => (
        new OpencodeModelCatalog(runner, readRoutingConfig(config))
      ),
      inject: [OpencodeCliRunner, ConfigService],
    },
    RedisModelHealthStore,
    { provide: 'MODEL_HEALTH_STORE', useExisting: RedisModelHealthStore },
    OpencodeModelRouter,
    { provide: 'OPENCODE_RUNNER', useExisting: OpencodeModelRouter },
  ],
  exports: [AssistService],
})
export class AssistModule {}
