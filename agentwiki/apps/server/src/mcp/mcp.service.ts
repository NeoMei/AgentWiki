import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthorizationService, Principal } from '../core/authorization/authorization.service';
import { PageService } from '../core/page/page.service';
import { SearchService } from '../core/search/search.service';
import { SpaceService } from '../core/space/space.service';
import { SourceService } from '../knowledge-pipeline/source.service';
import { KnowledgeSyncService } from '../knowledge-pipeline/knowledge-sync.service';
import { ReviewService } from '../review/review.service';
import { MemoryService } from '../memory/memory.service';
import { IngestQueue } from '../knowledge-pipeline/ingest.queue';
import { KnowledgeService } from '../core/knowledge/knowledge.service';
import { AuditService } from '../core/security/audit.service';
import { PrismaService } from '../database/prisma.service';
import {
  CollaborationGetRunInputSchema,
  CollaborationGetRunOutputSchema,
  CollaborationHeartbeatInputSchema,
  CollaborationHeartbeatOutputSchema,
  CollaborationJoinRunInputSchema,
  CollaborationJoinRunOutputSchema,
  CollaborationNextActionInputSchema,
  CollaborationNextActionOutputSchema,
  CollaborationSubmitResultInputSchema,
  CollaborationSubmitResultOutputSchema,
  CollaborationUpdateTodoInputSchema,
  CollaborationUpdateTodoOutputSchema,
  agentRoleAllowsScope,
} from '@neomei/agentwiki-sync-protocol';
import { BusinessException } from '../core/filters/business-error';
import { ExecutionService } from '../collaboration-workflows/execution.service';

// Keep the protocol SDK behind this adapter boundary. Its deeply recursive
// schema types otherwise make the application's declaration build prohibitively slow.
const { McpServer, ResourceTemplate } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

@Injectable()
export class McpService {
  constructor(
    private config: ConfigService,
    private authorization: AuthorizationService,
    private spaces: SpaceService,
    private pages: PageService,
    private knowledge: KnowledgeService,
    private search: SearchService,
    private sources: SourceService,
    private review: ReviewService,
    private memories: MemoryService,
    private ingestQueue: IngestQueue,
    private audit: AuditService,
    private prisma: PrismaService,
    private syncs: KnowledgeSyncService,
    private collaborationExecution: ExecutionService,
  ) {}

  async handle(request: Request, response: Response, principal: Principal): Promise<void> {
    this.validateHost(request);
    const server = this.createServer(principal, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      await transport.handleRequest(request, response, request.body);
    } finally {
      await server.close();
    }
  }

  private createServer(
    principal: Principal,
    requestContext: { ipAddress?: string; userAgent?: string } = {},
  ): any {
    const server = new McpServer({ name: 'agentwiki', version: '1.0.0' });
    const registerTool = (name: string, definition: any, handler: (args: any) => Promise<unknown>) =>
      server.registerTool(name, definition, (args: any) =>
        this.executeMcpCall(`tool.${name}`, principal, requestContext, args, () => handler(args)));
    const SPACE_ID = 'The space\'s internal id (CUID), not its display name. Call list_spaces first to discover the spaces you can access and their ids.';
    registerTool('list_spaces', {
      description: 'List the spaces you can access, with each space\'s internal id, display name and your role. Use this to resolve a space name to the spaceId other tools require.',
      inputSchema: {},
    }, async () => {
      const spaces = await this.authorization.listAccessibleSpaces(principal, 'spaces:read');
      return this.text(spaces);
    });
    registerTool('list_pages', {
      description: 'List pages in an authorized AgentWiki space.',
      inputSchema: { spaceId: z.string().describe(SPACE_ID), skip: z.number().int().min(0).optional(), take: z.number().int().min(1).max(100).optional() },
    }, async ({ spaceId, skip, take }: any) => {
      await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read');
      return this.text(await this.pages.findAll([spaceId], spaceId, skip || 0, take || 20));
    });
    registerTool('get_page', {
      description: 'Read a page and its provenance.',
      inputSchema: { pageId: z.string() },
    }, async ({ pageId }: any) => {
      await this.authorization.assertPageAccess(principal, pageId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read');
      return this.text(await this.pages.findOne(pageId));
    });
    registerTool('search_pages', {
      description: 'Search pages in authorized spaces.',
      inputSchema: { query: z.string().min(1), spaceId: z.string().optional().describe(SPACE_ID), limit: z.number().int().min(1).max(50).optional() },
    }, async ({ query, spaceId, limit }: any) => {
      if (spaceId) await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read');
      const ids = await this.authorization.getAccessibleSpaceIds(principal, 'pages:read');
      return this.text(await this.search.searchPages(query, spaceId, limit || 10, ids));
    });
    registerTool('list_graph', {
      description: 'Read the authorized knowledge graph for a space.',
      inputSchema: { spaceId: z.string().describe(SPACE_ID) },
    }, async ({ spaceId }: any) => {
      await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'graph:read');
      return this.text(await this.knowledge.getGraph(spaceId));
    });
    registerTool('propose_page', {
      description: 'Propose a page ChangeSet. Editor proposals remain pending review. Publisher proposals auto-publish only when the bound Space Grant is publisher and both Agent mode and Space policy allow it.',
      inputSchema: {
        spaceId: z.string().describe(SPACE_ID),
        title: z.string().min(1),
        content: z.string(),
        expectedTreeRevision: z.string().regex(/^(?:0|[1-9]\d*)$/u),
      },
    }, async ({ spaceId, title, content, expectedTreeRevision }: any) => {
      await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'editor'], 'pages:write');
      return this.text(await this.review.propose(principal, spaceId, `Proposed page: ${title}`, {
        type: 'create_page', payload: { title, content, expectedTreeRevision },
      }));
    });
    registerTool('propose_relation', {
      description: 'Propose a knowledge relation change set.',
      inputSchema: { spaceId: z.string().describe(SPACE_ID), sourcePageId: z.string(), targetPageId: z.string(), relation: z.string(), confidence: z.number().min(0).max(1).optional() },
    }, async ({ spaceId, sourcePageId, targetPageId, relation, confidence }: any) => {
      await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'editor'], 'graph:write');
      const source = await this.authorization.assertPageAccess(principal, sourcePageId, ['owner', 'editor'], 'graph:write');
      const target = await this.authorization.assertPageAccess(principal, targetPageId, ['owner', 'editor'], 'graph:write');
      if (source.spaceId !== spaceId || target.spaceId !== spaceId) throw new BadRequestException('Pages must belong to the requested space');
      return this.text(await this.review.propose(principal, spaceId, 'Proposed relation', { type: 'create_relation', payload: { sourcePageId, targetPageId, relation, confidence: confidence ?? 1 } }));
    });
    registerTool('list_sources', {
      description: 'List knowledge sources in a space.',
      inputSchema: { spaceId: z.string().describe(SPACE_ID) },
    }, async ({ spaceId }: any) => {
      await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'sources:read');
      return this.text(await this.sources.list(spaceId));
    });
    registerTool('get_knowledge_sync_state', {
      description: 'Return path and content hashes from the last confirmed local knowledge sync. No page content is returned.',
      inputSchema: {
        spaceId: z.string().describe(SPACE_ID),
        sourceKey: z.string().min(1).max(128),
      },
    }, async ({ spaceId, sourceKey }: { spaceId: string; sourceKey: string }) => {
      await this.authorization.assertSpaceAccess(principal, spaceId,
        ['owner', 'admin', 'editor', 'viewer'], 'sources:read');
      return this.text(await this.syncs.getState(spaceId, sourceKey));
    });
    registerTool('start_source_run', {
      description: 'Start ingestion for an existing source.',
      inputSchema: { sourceId: z.string() },
    }, async ({ sourceId }: any) => {
      await this.authorization.assertSourceAccess(principal, sourceId, ['owner', 'editor'], 'runs:write');
      const run = await this.sources.createRun(sourceId, principal);
      this.ingestQueue.enqueue();
      return this.text(run);
    });
    registerTool('recall_memory', {
      description: 'Recall explainable Agent memory for the authenticated Agent.',
      inputSchema: { agentId: z.string(), spaceId: z.string().describe(SPACE_ID), query: z.string(), limit: z.number().int().min(1).max(20).optional() },
    }, async ({ agentId, spaceId, query, limit }: any) => {
      await this.authorization.assertAgentMemoryAccess(principal, agentId, spaceId, 'memory:read');
      return this.text(await this.memories.recall(agentId, spaceId, query, limit, principal));
    });
    registerTool('list_reviews', {
      description: 'List change sets visible to the authenticated principal.',
      inputSchema: { spaceId: z.string().optional().describe(SPACE_ID) },
    }, async ({ spaceId }: any) => {
      if (spaceId) await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor', 'viewer'], 'review:read');
      const ids = spaceId ? [spaceId] : await this.authorization.getAccessibleSpaceIds(principal, 'review:read');
      return this.text(await this.review.list(ids));
    });
    registerTool('approve_change_set', {
      description: 'Approve a change set. Agent identities are never allowed to use this tool.',
      inputSchema: { changeSetId: z.string(), comment: z.string().optional() },
    }, async ({ changeSetId, comment }: any) => {
      if (principal.agentId) throw new BadRequestException('Agents cannot approve change sets');
      await this.authorization.assertChangeSetAccess(principal, changeSetId, ['owner'], 'review:decide');
      return this.text(await this.review.approve(changeSetId, principal.userId, comment));
    });
    registerTool('collaboration_join_run', {
      description: 'Join a bound collaboration run as the authenticated Agent and receive the safe execution loop.',
      inputSchema: CollaborationJoinRunInputSchema.shape,
    }, async (args: unknown) => {
      this.assertCollaborationScope(principal, 'collaboration:execute');
      const input = CollaborationJoinRunInputSchema.parse(args);
      return this.text(CollaborationJoinRunOutputSchema.parse(
        await this.collaborationExecution.joinRun(input.runId, principal),
      ));
    });
    registerTool('collaboration_next_action', {
      description: 'Claim one assigned ready task or receive a bounded wait, human-wait, paused, or terminal action.',
      inputSchema: CollaborationNextActionInputSchema.shape,
    }, async (args: unknown) => {
      this.assertCollaborationScope(principal, 'collaboration:execute');
      const input = CollaborationNextActionInputSchema.parse(args);
      return this.text(CollaborationNextActionOutputSchema.parse(
        await this.collaborationExecution.nextAction(input, principal),
      ));
    });
    registerTool('collaboration_heartbeat', {
      description: 'Extend an active collaboration task lease without exceeding its maximum execution deadline.',
      inputSchema: CollaborationHeartbeatInputSchema.shape,
    }, async (args: unknown) => {
      this.assertCollaborationScope(principal, 'collaboration:execute');
      const input = CollaborationHeartbeatInputSchema.parse(args);
      return this.text(CollaborationHeartbeatOutputSchema.parse(
        await this.collaborationExecution.heartbeat(input, principal),
      ));
    });
    registerTool('collaboration_update_todo', {
      description: 'Advance one ordered Todo item in the currently leased collaboration task.',
      inputSchema: CollaborationUpdateTodoInputSchema.shape,
    }, async (args: unknown) => {
      this.assertCollaborationScope(principal, 'collaboration:execute');
      const input = CollaborationUpdateTodoInputSchema.parse(args);
      return this.text(CollaborationUpdateTodoOutputSchema.parse(
        await this.collaborationExecution.updateTodo(input, principal),
      ));
    });
    registerTool('collaboration_submit_result', {
      description: 'Submit one schema-checked, evidence-backed Artifact for the currently leased task.',
      inputSchema: CollaborationSubmitResultInputSchema.shape,
    }, async (args: unknown) => {
      this.assertCollaborationScope(principal, 'collaboration:execute');
      const input = CollaborationSubmitResultInputSchema.parse(args);
      return this.text(CollaborationSubmitResultOutputSchema.parse(
        await this.collaborationExecution.submitResult(input, principal),
      ));
    });
    registerTool('collaboration_get_run', {
      description: 'Read the authenticated Agent\'s safe collaboration run state without lease secrets.',
      inputSchema: CollaborationGetRunInputSchema.shape,
    }, async (args: unknown) => {
      this.assertCollaborationScope(principal, 'collaboration:read');
      const input = CollaborationGetRunInputSchema.parse(args);
      return this.text(CollaborationGetRunOutputSchema.parse(
        await this.collaborationExecution.getAgentRun(input, principal),
      ));
    });
    server.registerResource('spaces', 'agentwiki://spaces', {
      title: 'Authorized AgentWiki spaces',
      description: 'Spaces available to the authenticated principal.',
      mimeType: 'application/json',
    }, async (uri: URL) => {
      const ids = await this.authorization.getAccessibleSpaceIds(principal, 'spaces:read');
      const data = await this.spaces.findAll(ids, 0, 100);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data) }] };
    });
    server.registerResource('page', new ResourceTemplate('agentwiki://pages/{pageId}', { list: undefined }), {
      title: 'AgentWiki page',
      description: 'A page with source provenance.',
      mimeType: 'application/json',
    }, async (uri: URL, variables: Record<string, string | string[]>) => {
      const pageId = String(variables.pageId);
      await this.authorization.assertPageAccess(principal, pageId, ['owner', 'admin', 'editor', 'viewer'], 'pages:read');
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await this.pages.findOne(pageId)) }] };
    });
    return server;
  }

  private text(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
  }

  private assertCollaborationScope(
    principal: Principal,
    required: 'collaboration:read' | 'collaboration:execute',
  ): void {
    if (!principal.agentId || !principal.agentRole || !agentRoleAllowsScope(principal.agentRole, required)) {
      throw new BusinessException('AUTH_SCOPE_REQUIRED', `Required scope is missing: ${required}`);
    }
  }

  private async executeMcpCall<T>(
    action: string,
    principal: Principal,
    context: { ipAddress?: string; userAgent?: string },
    args: Record<string, unknown>,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await operation();
      await this.recordMcpCall(action, 'success', principal, context, args);
      return result;
    } catch (error: any) {
      const outcome = error?.status === 401 || error?.status === 403 ? 'denied' : 'failure';
      await this.recordMcpCall(action, outcome, principal, context, args);
      throw error;
    }
  }

  private async recordMcpCall(
    action: string,
    outcome: 'success' | 'failure' | 'denied',
    principal: Principal,
    context: { ipAddress?: string; userAgent?: string },
    args: Record<string, unknown>,
  ): Promise<void> {
    const metadata = {
      argumentNames: Object.keys(args).sort(),
      credentialId: principal.credentialId,
    };
    await this.audit.record({
      action: `mcp.${action}`,
      outcome,
      actorUserId: principal.userId,
      actorAgentId: principal.agentId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata,
    });
    if (principal.agentId) {
      try {
        await this.prisma.agentAuditEvent.create({
          data: {
            agentId: principal.agentId,
            action: `mcp.${action}`,
            outcome,
            resourceType: 'McpCapability',
            resourceId: action,
            metadata,
          },
        });
      } catch {
        // The audit service already records a durable security event; do not mask the MCP result.
      }
    }
  }

  private validateHost(request: Request): void {
    const publicUrl = this.config.get<string>('PUBLIC_API_URL') || '';
    let publicHost = '';
    try { publicHost = new URL(publicUrl).hostname; } catch { /* keep empty */ }
    const configured = (this.config.get<string>('MCP_ALLOWED_HOSTS') || 'localhost,127.0.0.1').split(',').map((value) => value.trim().toLowerCase());
    const allowed = publicHost ? [...new Set([...configured, publicHost.toLowerCase()])] : configured;
    const host = String(request.headers.host || '').split(':')[0].toLowerCase();
    if (!allowed.includes(host)) throw new BadRequestException('MCP Host header is not allowed');
  }
}
