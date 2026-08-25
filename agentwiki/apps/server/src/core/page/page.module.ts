import { Module } from '@nestjs/common';
import { PageService } from './page.service';
import { PageController } from './page.controller';
import { DatabaseModule } from '../../database/database.module';
import { SearchModule } from '../search/search.module';
import { AuthModule } from '../auth/auth.module';
import { ReviewModule } from '../../review/review.module';
import { KnowledgeGraphModule } from '../../knowledge-graph/knowledge-graph.module';
import { PageTemplateModule } from '../../page-templates/page-template.module';

@Module({
  imports: [DatabaseModule, SearchModule, AuthModule, ReviewModule, KnowledgeGraphModule, PageTemplateModule],
  controllers: [PageController],
  providers: [PageService],
  exports: [PageService],
})
export class PageModule {}
