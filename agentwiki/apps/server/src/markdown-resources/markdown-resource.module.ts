import { Module } from '@nestjs/common';
import { AuthModule } from '../core/auth/auth.module';
import { AuthorizationModule } from '../core/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { MarkdownResourceController } from './markdown-resource.controller';
import { MarkdownResourceService } from './markdown-resource.service';

@Module({
  imports: [DatabaseModule, AuthModule, AuthorizationModule],
  controllers: [MarkdownResourceController],
  providers: [MarkdownResourceService],
  exports: [MarkdownResourceService],
})
export class MarkdownResourceModule {}
