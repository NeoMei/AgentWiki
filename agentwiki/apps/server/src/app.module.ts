import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './core/auth/auth.module';
import { UserModule } from './core/user/user.module';
import { WorkspaceModule } from './core/workspace/workspace.module';
import { SpaceModule } from './core/space/space.module';
import { PageModule } from './core/page/page.module';
import { SearchModule } from './core/search/search.module';
import { KnowledgeModule } from './core/knowledge/knowledge.module';
import { CollaborationModule } from './core/collaboration/collaboration.module';
import { AuthorizationModule } from './core/authorization/authorization.module';
import { KnowledgeGraphModule } from './knowledge-graph/knowledge-graph.module';
import { AssistModule } from './assist/assist.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { OnboardModule } from './onboard/onboard.module';
import { ObsidianModule } from './integrations/obsidian/obsidian.module';
import { SyncModule } from './core/sync/sync.module';
import { SecurityModule } from './core/security/security.module';
import { AgentModule } from './core/agent/agent.module';
import { KnowledgePipelineModule } from './knowledge-pipeline/knowledge-pipeline.module';
import { ReviewModule } from './review/review.module';
import { MemoryModule } from './memory/memory.module';
import { McpModule } from './mcp/mcp.module';
import { HealthController } from './health.controller';
import { CollaborationWorkflowsModule } from './collaboration-workflows/collaboration-workflows.module';
import { PageTemplateModule } from './page-templates/page-template.module';
import { AttachmentModule } from './attachments/attachment.module';
import { MarkdownResourceModule } from './markdown-resources/markdown-resource.module';
import { ContentTreeModule } from './content-tree/content-tree.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    SyncModule,
    AuthorizationModule,
    KnowledgeGraphModule,
    SecurityModule,
    AgentModule,
    KnowledgePipelineModule,
    ReviewModule,
    MemoryModule,
    McpModule,
    AuthModule,
    UserModule,
    WorkspaceModule,
    SpaceModule,
    PageModule,
    PageTemplateModule,
    SearchModule,
    KnowledgeModule,
    CollaborationModule,
    AssistModule,
    PlatformAdminModule,
    OnboardModule,
    ObsidianModule,
    CollaborationWorkflowsModule,
    AttachmentModule,
    MarkdownResourceModule,
    ContentTreeModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
