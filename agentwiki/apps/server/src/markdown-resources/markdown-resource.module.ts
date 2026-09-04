import { Module } from '@nestjs/common';
import { AuthModule } from '../core/auth/auth.module';
import { MarkdownResourceController } from './markdown-resource.controller';
import { MarkdownResourceCoreModule } from './markdown-resource-core.module';

@Module({
  imports: [AuthModule, MarkdownResourceCoreModule],
  controllers: [MarkdownResourceController],
  exports: [MarkdownResourceCoreModule],
})
export class MarkdownResourceModule {}
