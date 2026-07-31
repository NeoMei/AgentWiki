import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { KnowledgeRevisionService } from './knowledge-revision.service';

@Module({
  imports: [DatabaseModule],
  providers: [KnowledgeRevisionService],
  exports: [KnowledgeRevisionService],
})
export class KnowledgeRevisionModule {}
