import { Module } from '@nestjs/common';
import { KnowledgeRevisionModule } from '../knowledge-revision/knowledge-revision.module';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../core/auth/auth.module';
import { IngestQueue } from './ingest.queue';
import { SourceController } from './source.controller';
import { SourceService } from './source.service';
import { ReviewModule } from '../review/review.module';
import { SecurityModule } from '../core/security/security.module';
import { KnowledgeSyncController } from './knowledge-sync.controller';
import { KnowledgeSyncService } from './knowledge-sync.service';
import { KnowledgeRevisionController } from './knowledge-revision.controller';
import { KnowledgeSubmissionService } from './knowledge-submission.service';

@Module({
  imports: [DatabaseModule, AuthModule, ReviewModule, SecurityModule, KnowledgeRevisionModule],
  providers: [SourceService, IngestQueue, KnowledgeSyncService, KnowledgeSubmissionService],
  controllers: [SourceController, KnowledgeSyncController, KnowledgeRevisionController],
  exports: [SourceService, IngestQueue, KnowledgeSyncService, KnowledgeSubmissionService],
})
export class KnowledgePipelineModule {}
