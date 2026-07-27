import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { IngestQueue } from './knowledge-pipeline/ingest.queue';
import { AssistQueue } from './assist/assist.queue';
import { OpencodeCliRunner } from './assist/opencode.runner';
import { SourceService } from './knowledge-pipeline/source.service';
import { ReviewService } from './review/review.service';
import { SearchCoreModule } from './core/search/search-core.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, SearchCoreModule],
  providers: [ReviewService, SourceService, IngestQueue, AssistQueue, { provide: 'OPENCODE_RUNNER', useClass: OpencodeCliRunner }],
})
export class WorkerModule {}
