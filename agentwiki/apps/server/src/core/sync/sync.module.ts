import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SpaceRevisionWriterService } from './space-revision-writer.service';
import { RevisionRetentionService } from './revision-retention.service';
import { SyncMaintenance } from './sync-maintenance';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [SpaceRevisionWriterService, RevisionRetentionService, SyncMaintenance],
  exports: [SpaceRevisionWriterService, RevisionRetentionService, SyncMaintenance],
})
export class SyncModule {}
