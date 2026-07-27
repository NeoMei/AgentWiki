import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { LlmModule } from '../../integrations/llm/llm.module';
import { SearchService } from './search.service';

@Module({
  imports: [DatabaseModule, LlmModule],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchCoreModule {}
