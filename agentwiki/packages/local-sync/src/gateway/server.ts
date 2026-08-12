/**
 * The single gateway MCP server.
 *
 * Registers one exact tool set: control, local, hybrid (static) and remote
 * (wiki_* discovered via the bridge). Every tool is bound to its declared
 * execution plane at registration time — the Agent never chooses an MCP server.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { formatMcpOutput } from './output.js';
import { STATIC_TOOLS, staticToolNames, toRemoteGatewayName, isLegacyToolName } from './manifest.js';
import type { RemoteMcpBridge } from './remote-mcp-bridge.js';

/** Wrap a result as an MCP text content response. */
function text(result: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: formatMcpOutput(result) }] };
}

export interface GatewayHandlers {
  status(input: { sessionId?: string }): Promise<unknown>;
  scanSources(input: { sourcePaths: string[]; sourceType?: string }): Promise<unknown>;
  readArtifacts(input: { jobId: string; workItemId: string }): Promise<unknown>;
  prepare(input: { spaceId: string; sourcePaths: string[]; sourceType?: string }): Promise<unknown>;
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

/**
 * Create the unified gateway. Remote tools are discovered eagerly so the
 * returned toolNames list is complete; if the bridge is offline, only static
 * tools are registered and remote calls return REMOTE_UNAVAILABLE.
 */
export async function createGatewayServer(context: GatewayContext): Promise<GatewayServer> {
  const version = context.version ?? '0.3.2';
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
      inputSchema: {
        sourcePaths: z.array(z.string().min(1)),
        sourceType: z.string().optional(),
      },
    },
    async (input) =>
      text(
        formatMcpOutput(
          await context.handlers.scanSources(input as { sourcePaths: string[]; sourceType?: string }),
        ),
      ),
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
      inputSchema: {
        spaceId: z.string().min(1),
        sourcePaths: z.array(z.string().min(1)),
        sourceType: z.string().optional(),
      },
    },
    async (input) =>
      text(
        formatMcpOutput(
          await context.handlers.prepare(input as { spaceId: string; sourcePaths: string[]; sourceType?: string }),
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
      inputSchema: { spaceId: z.string().min(1) },
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
      toolNames.push(gatewayName);
      server.registerTool(
        gatewayName,
        {
          description: remote.description ?? `Remote AgentWiki tool: ${remote.name}`,
          inputSchema: { __args: z.record(z.unknown()).optional() },
        },
        async (input) => {
          const result = await context.bridge!.callGatewayTool(gatewayName, (input as { __args?: Record<string, unknown> })?.__args ?? {});
          return text(formatMcpOutput(result));
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
