import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../core/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { MarkdownResourceService } from './markdown-resource.service';

@Module({
  imports: [DatabaseModule, AuthorizationModule],
  providers: [MarkdownResourceService],
  exports: [MarkdownResourceService],
})
export class MarkdownResourceCoreModule {}
