import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SpaceRevisionWriterService } from './space-revision-writer.service';
import { RevisionRetentionService } from './revision-retention.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [SpaceRevisionWriterService, RevisionRetentionService],
  exports: [SpaceRevisionWriterService, RevisionRetentionService],
})
export class SyncModule {}
