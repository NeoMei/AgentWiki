import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SpaceRevisionWriterService } from './space-revision-writer.service';
import { RevisionRetentionService } from './revision-retention.service';
import { SyncMaintenance } from './sync-maintenance';
import { ReadableSyncPathService } from './readable-sync-path.service';
import { MarkdownResourceCoreModule } from '../../markdown-resources/markdown-resource-core.module';
import { SyncV3RevisionWriterService } from './sync-v3-revision-writer.service';
import { AttachmentStorageModule } from '../../attachments/attachment-storage.module';

@Global()
@Module({
  imports: [DatabaseModule, MarkdownResourceCoreModule, AttachmentStorageModule],
  providers: [
    SpaceRevisionWriterService,
    RevisionRetentionService,
    SyncMaintenance,
    ReadableSyncPathService,
    SyncV3RevisionWriterService,
  ],
  exports: [
    SpaceRevisionWriterService,
    RevisionRetentionService,
    SyncMaintenance,
    ReadableSyncPathService,
    SyncV3RevisionWriterService,
  ],
})
export class SyncModule {}
