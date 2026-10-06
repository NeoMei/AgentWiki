import { SourceFreshnessModule } from '../source-freshness/source-freshness.module';
import { Module } from '@nestjs/common';
import { PageService } from './page.service';
import { PageController } from './page.controller';
import { DatabaseModule } from '../../database/database.module';
import { SearchModule } from '../search/search.module';
import { AuthModule } from '../auth/auth.module';
import { ReviewModule } from '../../review/review.module';
import { KnowledgeGraphModule } from '../../knowledge-graph/knowledge-graph.module';
import { PageTemplateModule } from '../../page-templates/page-template.module';
import { ContentTreeModule } from '../../content-tree/content-tree.module';

@Module({
  imports: [SourceFreshnessModule,
    DatabaseModule,
    SearchModule,
    AuthModule,
    ReviewModule,
    KnowledgeGraphModule,
    PageTemplateModule,
    ContentTreeModule,
  ],
  controllers: [PageController],
  providers: [PageService],
  exports: [PageService],
})
export class PageModule {}
