import { All, Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { McpService } from './mcp.service';
import { AgentService } from '../core/agent/agent.service';

@Controller()
@UseGuards(CombinedAuthGuard)
export class McpController {
  constructor(private mcp: McpService, private agents: AgentService) {}

  @All('mcp')
  handle(@Req() request: Request, @Res() response: Response) {
    return this.mcp.handle(request, response, request.user as any);
  }

  @Get('integrations/mcp')
  async info(@Req() request: Request) {
    const principal = request.user as any;
    const toolScopes = {
      list_spaces: 'spaces:read',
      list_pages: 'pages:read', get_page: 'pages:read', search_pages: 'pages:read',
      list_graph: 'graph:read', propose_page: 'pages:write', propose_relation: 'graph:write',
      list_sources: 'sources:read', get_knowledge_sync_state: 'sources:read',
      start_source_run: 'runs:write', recall_memory: 'memory:read',
      list_reviews: 'review:read', approve_change_set: 'review:decide (human only)',
    };
    return {
      transport: 'Streamable HTTP',
      endpoint: '/api/mcp',
      authentication: 'Bearer Agent credential or x-api-key',
      tools: Object.entries(toolScopes).map(([name, requiredScope]) => ({ name, requiredScope })),
      resources: ['agentwiki://spaces', 'agentwiki://pages/{pageId}'],
      note: 'Agent proposals always use ChangeSets. Editor proposals remain pending review. Publisher proposals auto-publish only when the Credential and Space Grant are publisher and both Agent mode and Space policy allow it.',
      access: await this.agents.integrationAccess(principal.userId, principal.agentId),
      recentCalls: await this.agents.recentMcpCalls(principal.userId, principal.agentId),
    };
  }
}
