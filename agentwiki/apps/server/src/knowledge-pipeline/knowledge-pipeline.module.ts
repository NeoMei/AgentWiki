import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../core/auth/auth.module';
import { IngestQueue } from './ingest.queue';
import { SourceController } from './source.controller';
import { SourceService } from './source.service';
import { ReviewModule } from '../review/review.module';

@Module({
  imports: [DatabaseModule, AuthModule, ReviewModule],
  providers: [SourceService, IngestQueue],
  controllers: [SourceController],
  exports: [SourceService, IngestQueue],
})
export class KnowledgePipelineModule {}
