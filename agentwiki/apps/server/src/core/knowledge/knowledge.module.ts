import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { AuthModule } from '../auth/auth.module';
import { ReviewModule } from '../../review/review.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule, ReviewModule, SyncModule],
  providers: [KnowledgeService],
  controllers: [KnowledgeController],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
