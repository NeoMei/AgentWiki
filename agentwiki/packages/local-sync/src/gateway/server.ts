/**
 * The single gateway MCP server.
 *
 * Registers one exact tool set: control, local, hybrid (static) and remote
 * (wiki_* discovered via the bridge). Every tool is bound to its declared
 * execution plane at registration time — the Agent never chooses an MCP server.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { SAFE_SPACE_ID_PATTERN } from '../workspace/layout.js';
import { formatMcpOutput } from './output.js';
import { STATIC_TOOLS, staticToolNames, toRemoteGatewayName, isLegacyToolName } from './manifest.js';
import type { BridgeCallResult, RemoteMcpBridge } from './remote-mcp-bridge.js';
import { PublicLocalScanResultSchema, type PublicLocalScanResult } from '../codegraph/contracts.js';
import { exactRemoteToolSchema } from './collaboration-tools.js';

/** Wrap a result as an MCP text content response. */
function text(result: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: formatMcpOutput(result) }] };
}

function remoteResult(result: BridgeCallResult): CallToolResult {
  const sanitized = CallToolResultSchema.parse(JSON.parse(formatMcpOutput(result)));
  return { content: sanitized.content, isError: Boolean(sanitized.isError) };
}

export interface GatewayHandlers {
  status(input: { sessionId?: string }): Promise<unknown>;
  scanSources(input: { sourcePaths: string[]; sourceType?: 'auto' | 'code' | 'documents'; analysisMode?: 'standard' | 'deep' }): Promise<PublicLocalScanResult>;
  readArtifacts(input: { jobId: string; workItemId: string }): Promise<unknown>;
  prepare(input: { spaceId: string; sourcePaths: string[]; sourceType?: 'auto' | 'code' | 'documents'; analysisMode?: 'standard' | 'deep'; localScanPlanHash?: string; confirmedLocalScan?: boolean }): Promise<unknown>;
  confirmAndSync(input: { jobId: string; previewHash: string; confirmed: boolean }): Promise<unknown>;
  pull(input: { spaceId: string }): Promise<unknown>;
}

export interface GatewayContext {
  handlers: GatewayHandlers;
  bridge?: RemoteMcpBridge;
  version?: string;
}

export interface GatewayServer {
  server: McpServer;
  toolNames: string[];
}

export const gatewayToolInputSchemas = {
  localScanSources: z.object({
    sourcePaths: z.array(z.string().min(1)),
    sourceType: z.enum(['auto', 'code', 'documents']).optional(),
    analysisMode: z.enum(['standard', 'deep']).default('standard'),
  }).strict(),
  knowledgePrepare: z.object({
    spaceId: z.string().regex(SAFE_SPACE_ID_PATTERN),
    sourcePaths: z.array(z.string().min(1)),
    sourceType: z.enum(['auto', 'code', 'documents']).optional(),
    analysisMode: z.enum(['standard', 'deep']).default('standard'),
    localScanPlanHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
    confirmedLocalScan: z.boolean().optional(),
  }).strict(),
};

/**
 * Create the unified gateway. Remote tools are discovered eagerly so the
 * returned toolNames list is complete; if the bridge is offline, only static
 * tools are registered and remote calls return REMOTE_UNAVAILABLE.
 */
export async function createGatewayServer(context: GatewayContext): Promise<GatewayServer> {
  const version = context.version ?? '0.6.1';
  const server = new McpServer({ name: 'agentwiki', version });
  const toolNames: string[] = [];

  /* ---- control ---- */
  toolNames.push('onboard_status');
  server.registerTool(
    'onboard_status',
    { description: toolDescription('onboard_status'), inputSchema: { sessionId: z.string().optional() } },
    async (input) => text(formatMcpOutput(await context.handlers.status(input as { sessionId?: string }))),
  );

  /* ---- local ---- */
  toolNames.push('local_scan_sources');
  server.registerTool(
    'local_scan_sources',
    {
      description: toolDescription('local_scan_sources'),
      inputSchema: gatewayToolInputSchemas.localScanSources,
    },
    async (input) => {
      const result = PublicLocalScanResultSchema.parse(
        await context.handlers.scanSources(input as { sourcePaths: string[]; sourceType?: 'auto' | 'code' | 'documents'; analysisMode?: 'standard' | 'deep' }),
      );
      return text(formatMcpOutput(result));
    },
  );

  toolNames.push('local_read_artifacts');
  server.registerTool(
    'local_read_artifacts',
    {
      description: toolDescription('local_read_artifacts'),
      inputSchema: { jobId: z.string().min(1), workItemId: z.string().min(1) },
    },
    async (input) =>
      text(
        formatMcpOutput(
          await context.handlers.readArtifacts(input as { jobId: string; workItemId: string }),
        ),
      ),
  );

  /* ---- hybrid ---- */
  toolNames.push('knowledge_prepare');
  server.registerTool(
    'knowledge_prepare',
    {
      description: toolDescription('knowledge_prepare'),
      inputSchema: gatewayToolInputSchemas.knowledgePrepare,
    },
    async (input) =>
      text(
        formatMcpOutput(
          await context.handlers.prepare(input as { spaceId: string; sourcePaths: string[]; sourceType?: 'auto' | 'code' | 'documents'; analysisMode?: 'standard' | 'deep'; localScanPlanHash?: string; confirmedLocalScan?: boolean }),
        ),
      ),
  );

  toolNames.push('knowledge_confirm_and_sync');
  server.registerTool(
    'knowledge_confirm_and_sync',
    {
      description: toolDescription('knowledge_confirm_and_sync'),
      inputSchema: {
        jobId: z.string().min(1),
        previewHash: z.string().min(1),
        confirmed: z.boolean(),
      },
    },
    async (input) =>
      text(
        formatMcpOutput(
          await context.handlers.confirmAndSync(
            input as { jobId: string; previewHash: string; confirmed: boolean },
          ),
        ),
      ),
  );

  toolNames.push('knowledge_pull');
  server.registerTool(
    'knowledge_pull',
    {
      description: toolDescription('knowledge_pull'),
      inputSchema: { spaceId: z.string().regex(SAFE_SPACE_ID_PATTERN) },
    },
    async (input) =>
      text(formatMcpOutput(await context.handlers.pull(input as { spaceId: string }))),
  );

  /* ---- remote (wiki_*) ---- */
  if (context.bridge) {
    const remoteTools = await context.bridge.listTools();
    for (const remote of remoteTools) {
      const gatewayName = toRemoteGatewayName(remote.name);
      // Never expose a legacy name even if the remote somehow offers one.
      if (isLegacyToolName(remote.name) || STATIC_TOOLS.some((t) => t.name === gatewayName)) continue;
      const exactSchema = exactRemoteToolSchema(remote.name);
      toolNames.push(gatewayName);
      server.registerTool(
        gatewayName,
        {
          description: remote.description ?? `Remote AgentWiki tool: ${remote.name}`,
          inputSchema: exactSchema ?? { __args: z.record(z.unknown()).optional() },
        },
        async (input) => {
          const result = await context.bridge!.callGatewayTool(
            gatewayName,
            exactSchema
              ? input as Record<string, unknown>
              : (input as { __args?: Record<string, unknown> })?.__args ?? {},
          );
          return remoteResult(result);
        },
      );
    }
  }

  return { server, toolNames };
}

function toolDescription(name: string): string {
  const tool = STATIC_TOOLS.find((t) => t.name === name);
  return tool?.description ?? name;
}

/** Re-export for consumers that need the static name list. */
export { staticToolNames };
