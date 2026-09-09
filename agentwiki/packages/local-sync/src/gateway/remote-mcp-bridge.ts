/**
 * RemoteMcpBridge: proxies the AgentWiki /api/mcp server.
 *
 * It does not reimplement remote business semantics with REST. Instead it
 * forwards tools/list and tools/call over the MCP Streamable HTTP transport,
 * caching the last-known-good non-sensitive tool manifest so that local tools
 * keep working when the server is unreachable.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPError, StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamablehttp.js';
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toRemoteGatewayName, fromRemoteGatewayName } from './manifest.js';

export const REMOTE_HANDSHAKE_DEADLINE_MS = 30_000;

export interface RemoteToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface BridgeCallResult {
  content: CallToolResult['content'];
  isError: boolean;
}

export interface RemoteBridgeOptions {
  serverUrl: string;
  /** Returns the current Agent API key for authorization. */
  readCredential: () => Promise<string>;
  fetchImpl?: typeof fetch;
  deadlineMs?: number;
  /** Receives only fixed, public diagnostics when the connection outcome changes. */
  onDiagnostic?: (diagnostic: RemoteDiagnostic) => void;
}

export interface RemoteDiagnostic {
  status: 'not_checked' | 'connected' | 'authorization_required' | 'access_denied' | 'unavailable';
  code: 'REMOTE_NOT_CHECKED' | 'REMOTE_CONNECTED' | 'REMOTE_AUTH_REQUIRED' | 'REMOTE_ACCESS_DENIED' | 'REMOTE_UNAVAILABLE' | 'REMOTE_TIMEOUT';
  checkedAt: string | null;
  cachedToolCount: number;
  recovery: string;
}

class DiscoveryTimeout extends Error {}

export class RemoteMcpBridge {
  private cache: RemoteToolDescriptor[] | null = null;
  private currentDiagnostic: RemoteDiagnostic = { status: 'not_checked', code: 'REMOTE_NOT_CHECKED', checkedAt: null, cachedToolCount: 0, recovery: 'Run onboard_status to check the remote connection.' };
  private discovery: Promise<RemoteToolDescriptor[]> | null = null;
  private readonly deadlineMs: number;

  constructor(private readonly options: RemoteBridgeOptions) {
    this.deadlineMs = options.deadlineMs ?? REMOTE_HANDSHAKE_DEADLINE_MS;
  }

  diagnostic(): RemoteDiagnostic {
    return { ...this.currentDiagnostic };
  }

  /** Concurrent status requests share one bounded discovery; offline tools stay available. */
  async listTools(): Promise<RemoteToolDescriptor[]> {
    if (this.discovery) return this.discovery;
    const discovery = this.discover();
    this.discovery = discovery;
    try { return await discovery; }
    finally { if (this.discovery === discovery) this.discovery = null; }
  }

  private async discover(): Promise<RemoteToolDescriptor[]> {
    try {
      const tools = await this.withClient(async (client, signal) => {
        const list = await client.listTools(undefined, { signal, timeout: this.deadlineMs });
        return list.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Record<string, unknown> }));
      });
      this.cache = tools;
      this.record();
      return tools;
    } catch (error) {
      this.record(error);
      return this.cache ?? [];
    }
  }

  private record(error?: unknown): void {
    const auth = error instanceof UnauthorizedError || (error instanceof StreamableHTTPError && error.code === 401);
    const denied = error instanceof StreamableHTTPError && error.code === 403;
    const timeout = error instanceof DiscoveryTimeout;
    const code: RemoteDiagnostic['code'] = error === undefined ? 'REMOTE_CONNECTED' : auth ? 'REMOTE_AUTH_REQUIRED' : denied ? 'REMOTE_ACCESS_DENIED' : timeout ? 'REMOTE_TIMEOUT' : 'REMOTE_UNAVAILABLE';
    const next: RemoteDiagnostic = {
      status: error === undefined ? 'connected' : auth ? 'authorization_required' : denied ? 'access_denied' : 'unavailable',
      code, checkedAt: new Date().toISOString(), cachedToolCount: this.cache?.length ?? 0,
      recovery: error === undefined ? 'Remote MCP is reachable. Use an actual wiki tool to verify the requested operation.'
        : auth ? 'Reauthorize the AgentWiki connection, then reload this client MCP gateway. Local tools remain available.'
        : denied ? 'Check AgentWiki permissions for this connection, then retry onboard_status. Local tools remain available.'
        : 'Remote MCP is unavailable. Retry onboard_status later; check server availability if it persists. Local tools remain available.',
    };
    const changed = code !== this.currentDiagnostic.code;
    this.currentDiagnostic = next;
    if (changed) this.options.onDiagnostic?.({ ...next });
  }

  /** Gateway-facing tool names (with wiki_ prefix). */
  async listGatewayToolNames(): Promise<string[]> {
    const tools = await this.listTools();
    return tools.map((tool) => toRemoteGatewayName(tool.name));
  }

  /** Call a remote tool by its original (un-prefixed) name. */
  async callTool(remoteName: string, args: Record<string, unknown>): Promise<BridgeCallResult> {
    try {
      const result = await this.withClient(async (client) => CallToolResultSchema.parse(await client.callTool({ name: remoteName, arguments: args })), false);
      this.record();
      return { content: result.content, isError: Boolean(result.isError) };
    } catch (error) {
      this.record(error);
      return { content: [{ type: 'text', text: JSON.stringify(this.diagnostic()) }], isError: true };
    }
  }

  /** Call a gateway-prefixed tool name, stripping the wiki_ prefix. */
  async callGatewayTool(gatewayName: string, args: Record<string, unknown>): Promise<BridgeCallResult> {
    const remote = fromRemoteGatewayName(gatewayName);
    if (remote === null) throw new Error(`not a remote tool: ${gatewayName}`);
    return this.callTool(remote, args);
  }

  /** A cached manifest alone does not establish a current connection. */
  isOnline(): boolean {
    return this.currentDiagnostic.status === 'connected';
  }

  private async withClient<T>(operation: (client: Client, signal: AbortSignal) => Promise<T>, boundOperation = true): Promise<T> {
    const client = new Client({ name: 'agentwiki-gateway', version: '0.10.0' }, { capabilities: {} });
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new DiscoveryTimeout()); abort.abort(); }, this.deadlineMs);
    });
    const work = (async () => {
      const credential = await this.options.readCredential();
      abort.signal.throwIfAborted();
      const transport = new StreamableHTTPClientTransport(new URL(this.options.serverUrl), {
        requestInit: { headers: { authorization: `Bearer ${credential}` } },
        fetch: async (url, init) => (this.options.fetchImpl ?? fetch)(url, {
          ...init, signal: AbortSignal.any([abort.signal, ...(init?.signal ? [init.signal] : [])]),
        }),
      });
      await client.connect(transport, { signal: abort.signal, timeout: this.deadlineMs });
      abort.signal.throwIfAborted();
      // Discovery has one total deadline; business tools keep their existing SDK call timeout.
      if (!boundOperation) clearTimeout(timer!);
      return operation(client, abort.signal);
    })();
    try { return await Promise.race([work, deadline]); }
    finally {
      clearTimeout(timer!);
      abort.abort();
      // A broken transport must not hold the local gateway/status response open.
      void client.close().catch(() => undefined);
    }
  }
}
