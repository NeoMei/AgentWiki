/**
 * RemoteMcpBridge: proxies the AgentWiki /api/mcp server.
 *
 * It does not reimplement remote business semantics with REST. Instead it
 * forwards tools/list and tools/call over the MCP Streamable HTTP transport,
 * caching the last-known-good non-sensitive tool manifest so that local tools
 * keep working when the server is unreachable.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamablehttp.js';
import { toRemoteGatewayName, fromRemoteGatewayName } from './manifest.js';

export const REMOTE_HANDSHAKE_DEADLINE_MS = 30_000;

export interface RemoteToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface BridgeCallResult {
  content: unknown;
  isError: boolean;
}

export interface RemoteBridgeOptions {
  serverUrl: string;
  /** Returns the current Agent API key for authorization. */
  readCredential: () => Promise<string>;
  fetchImpl?: typeof fetch;
  deadlineMs?: number;
}

interface CachedManifest {
  tools: RemoteToolDescriptor[];
  hash: string;
}

export class RemoteMcpBridge {
  private cache: CachedManifest | null = null;
  private readonly deadlineMs: number;

  constructor(private readonly options: RemoteBridgeOptions) {
    this.deadlineMs = options.deadlineMs ?? REMOTE_HANDSHAKE_DEADLINE_MS;
  }

  /** Discover remote tools and map them to wiki_<name>. Returns [] offline. */
  async listTools(): Promise<RemoteToolDescriptor[]> {
    try {
      const tools = await this.fetchRemoteTools();
      this.cache = { tools, hash: hashTools(tools) };
      return tools;
    } catch {
      // Offline or error: return last-known-good cache so local tools still work.
      return this.cache?.tools ?? [];
    }
  }

  /** Gateway-facing tool names (with wiki_ prefix). */
  async listGatewayToolNames(): Promise<string[]> {
    const tools = await this.listTools();
    return tools.map((tool) => toRemoteGatewayName(tool.name));
  }

  /** Call a remote tool by its original (un-prefixed) name. */
  async callTool(remoteName: string, args: Record<string, unknown>): Promise<BridgeCallResult> {
    const client = await this.connect();
    try {
      const result = await client.callTool({ name: remoteName, arguments: args });
      return {
        content: (result.content as unknown[]) ?? [],
        isError: Boolean(result.isError),
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  /** Call a gateway-prefixed tool name, stripping the wiki_ prefix. */
  async callGatewayTool(gatewayName: string, args: Record<string, unknown>): Promise<BridgeCallResult> {
    const remote = fromRemoteGatewayName(gatewayName);
    if (remote === null) throw new Error(`not a remote tool: ${gatewayName}`);
    return this.callTool(remote, args);
  }

  /** True when the bridge has at least one cached or live remote tool. */
  isOnline(): boolean {
    return this.cache !== null;
  }

  private async fetchRemoteTools(): Promise<RemoteToolDescriptor[]> {
    const client = await this.connect();
    try {
      const list = await client.listTools();
      return (list.tools as RemoteToolDescriptor[]).map((tool) => ({
        name: tool.name,
        ...(tool.description !== undefined ? { description: tool.description } : {}),
        ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema as Record<string, unknown> } : {}),
      }));
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private async connect(): Promise<Client> {
    const client = new Client(
      { name: 'agentwiki-gateway', version: '0.3.1' },
      { capabilities: {} },
    );
    const headers: Record<string, string> = {
      authorization: `Bearer ${await this.options.readCredential()}`,
    };
    const transport = new StreamableHTTPClientTransport(new URL(this.options.serverUrl), {
      requestInit: { headers },
      fetch: this.options.fetchImpl as never,
    });
    await client.connect(transport);
    return client;
  }
}

function hashTools(tools: RemoteToolDescriptor[]): string {
  const canonical = JSON.stringify(tools.map((t) => ({ name: t.name })));
  let hash = 0;
  for (let i = 0; i < canonical.length; i += 1) {
    hash = ((hash << 5) - hash + canonical.charCodeAt(i)) | 0;
  }
  return String(hash);
}
