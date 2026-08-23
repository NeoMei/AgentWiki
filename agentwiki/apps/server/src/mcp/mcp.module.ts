import { Module } from '@nestjs/common';
import { AuthModule } from '../core/auth/auth.module';
import { PageModule } from '../core/page/page.module';
import { SearchModule } from '../core/search/search.module';
import { SpaceModule } from '../core/space/space.module';
import { KnowledgePipelineModule } from '../knowledge-pipeline/knowledge-pipeline.module';
import { ReviewModule } from '../review/review.module';
import { MemoryModule } from '../memory/memory.module';
import { KnowledgeModule } from '../core/knowledge/knowledge.module';
import { AgentModule } from '../core/agent/agent.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { DatabaseModule } from '../database/database.module';
import { CollaborationWorkflowsModule } from '../collaboration-workflows/collaboration-workflows.module';

@Module({
  imports: [
    DatabaseModule, AuthModule, AgentModule, PageModule, SearchModule, SpaceModule, KnowledgeModule,
    KnowledgePipelineModule, ReviewModule, MemoryModule, CollaborationWorkflowsModule,
  ],
  providers: [McpService],
  controllers: [McpController],
})
export class McpModule {}
