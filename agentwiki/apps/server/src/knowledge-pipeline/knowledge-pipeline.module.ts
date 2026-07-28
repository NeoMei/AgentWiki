import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../core/auth/auth.module';
import { IngestQueue } from './ingest.queue';
import { SourceController } from './source.controller';
import { SourceService } from './source.service';
import { ReviewModule } from '../review/review.module';
import { SecurityModule } from '../core/security/security.module';
import { KnowledgeSyncController } from './knowledge-sync.controller';
import { KnowledgeSyncService } from './knowledge-sync.service';

@Module({
  imports: [DatabaseModule, AuthModule, ReviewModule, SecurityModule],
  providers: [SourceService, IngestQueue, KnowledgeSyncService],
  controllers: [SourceController, KnowledgeSyncController],
  exports: [SourceService, IngestQueue, KnowledgeSyncService],
})
export class KnowledgePipelineModule {}
