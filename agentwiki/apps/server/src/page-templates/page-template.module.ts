import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../core/auth/auth.module';
import { AuthorizationModule } from '../core/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { PageTemplateController } from './page-template.controller';
import { PageTemplateService } from './page-template.service';
import { CompositeTemplateCatalogService } from './composite-template-catalog.service';
import { LegacyWorkflowUpgradeService } from './legacy-workflow-upgrade.service';
import { ContentTreeModule } from '../content-tree/content-tree.module';
import { TemplateInstantiationService } from './template-instantiation.service';

@Module({
  imports: [DatabaseModule, AuthorizationModule, AuthModule, ConfigModule, ContentTreeModule],
  controllers: [PageTemplateController],
  providers: [PageTemplateService, CompositeTemplateCatalogService, LegacyWorkflowUpgradeService, TemplateInstantiationService],
  exports: [PageTemplateService, CompositeTemplateCatalogService, LegacyWorkflowUpgradeService, TemplateInstantiationService],
})
export class PageTemplateModule {}
