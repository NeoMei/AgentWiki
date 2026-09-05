import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../core/auth/auth.module';
import { AuthorizationModule } from '../core/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { PageTemplateController } from './page-template.controller';
import { PageTemplateService } from './page-template.service';
import { CompositeTemplateCatalogService } from './composite-template-catalog.service';

@Module({
  imports: [DatabaseModule, AuthorizationModule, AuthModule, ConfigModule],
  controllers: [PageTemplateController],
  providers: [PageTemplateService, CompositeTemplateCatalogService],
  exports: [PageTemplateService, CompositeTemplateCatalogService],
})
export class PageTemplateModule {}
