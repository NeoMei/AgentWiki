import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { IngestQueue } from './knowledge-pipeline/ingest.queue';
import { AssistQueue } from './assist/assist.queue';
import { RedisModelHealthStore } from './assist/model-health.store';
import { OpencodeModelCatalog } from './assist/opencode.catalog';
import { readRoutingConfig } from './assist/opencode.config';
import { OpencodeCliRunner } from './assist/opencode.runner';
import { OpencodeModelRouter } from './assist/opencode.router';
import { SourceService } from './knowledge-pipeline/source.service';
import { ReviewService } from './review/review.service';
import { SearchCoreModule } from './core/search/search-core.module';
import { CollaborationModule } from './core/collaboration/collaboration.module';
import { SyncModule } from './core/sync/sync.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, SearchCoreModule, CollaborationModule, SyncModule],
  providers: [
    ReviewService,
    SourceService,
    IngestQueue,
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
})
export class WorkerModule {}
