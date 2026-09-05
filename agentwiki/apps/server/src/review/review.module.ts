import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../core/auth/auth.module';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { SearchModule } from '../core/search/search.module';
import { KnowledgeGraphModule } from '../knowledge-graph/knowledge-graph.module';
import { ContentTreeModule } from '../content-tree/content-tree.module';
import { PagePublicationService } from './page-publication.service';

@Module({
  imports: [DatabaseModule, AuthModule, SearchModule, KnowledgeGraphModule, ContentTreeModule],
  providers: [ReviewService, PagePublicationService],
  controllers: [ReviewController],
  exports: [ReviewService, PagePublicationService],
})
export class ReviewModule {}
