import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SpaceRevisionWriterService } from './space-revision-writer.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [SpaceRevisionWriterService],
  exports: [SpaceRevisionWriterService],
})
export class SyncModule {}
