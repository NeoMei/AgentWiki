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
import { PageAgentBindingService } from './page-agent-binding.service';
import { MarkdownResourceCoreModule } from '../markdown-resources/markdown-resource-core.module';
import { FolderTemplateSnapshotService } from './folder-template-snapshot.service';
import { CollaborationWorkflowsModule } from '../collaboration-workflows/collaboration-workflows.module';
import { CompositeTemplateController } from './composite-template.controller';
import { CompositeTemplatePreviewService } from './composite-template-preview.service';
import { ExistingRunOrchestrationService } from './existing-run-orchestration.service';

@Module({
  imports: [
    DatabaseModule,
    AuthorizationModule,
    AuthModule,
    ConfigModule,
    ContentTreeModule,
    MarkdownResourceCoreModule,
    CollaborationWorkflowsModule,
  ],
  controllers: [PageTemplateController, CompositeTemplateController],
  providers: [
    PageTemplateService,
    CompositeTemplateCatalogService,
    LegacyWorkflowUpgradeService,
    TemplateInstantiationService,
    PageAgentBindingService,
    FolderTemplateSnapshotService,
    CompositeTemplatePreviewService,
    ExistingRunOrchestrationService,
  ],
  exports: [
    PageTemplateService,
    CompositeTemplateCatalogService,
    LegacyWorkflowUpgradeService,
    TemplateInstantiationService,
    PageAgentBindingService,
    FolderTemplateSnapshotService,
    CompositeTemplatePreviewService,
    ExistingRunOrchestrationService,
  ],
})
export class PageTemplateModule {}
