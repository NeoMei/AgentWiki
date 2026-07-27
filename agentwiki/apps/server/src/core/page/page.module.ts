import { Module } from '@nestjs/common';
import { PageService } from './page.service';
import { PageController } from './page.controller';
import { DatabaseModule } from '../../database/database.module';
import { SearchModule } from '../search/search.module';
import { AuthModule } from '../auth/auth.module';
import { ReviewModule } from '../../review/review.module';

@Module({
  imports: [DatabaseModule, SearchModule, AuthModule, ReviewModule],
  controllers: [PageController],
  providers: [PageService],
  exports: [PageService],
})
export class PageModule {}
