import { SourceFreshnessModule } from '../source-freshness/source-freshness.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SearchController } from './search.controller';
import { SearchCoreModule } from './search-core.module';

@Module({
  imports: [SourceFreshnessModule, SearchCoreModule, AuthModule],
  controllers: [SearchController],
  exports: [SearchCoreModule],
})
export class SearchModule {}
