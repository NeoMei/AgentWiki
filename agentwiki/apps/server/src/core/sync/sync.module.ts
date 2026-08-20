import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SpaceRevisionWriterService } from './space-revision-writer.service';
import { RevisionRetentionService } from './revision-retention.service';
import { SyncMaintenance } from './sync-maintenance';
import { ReadableSyncPathService } from './readable-sync-path.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    SpaceRevisionWriterService,
    RevisionRetentionService,
    SyncMaintenance,
    ReadableSyncPathService,
  ],
  exports: [
    SpaceRevisionWriterService,
    RevisionRetentionService,
    SyncMaintenance,
    ReadableSyncPathService,
  ],
})
export class SyncModule {}
