import { RemoteMcpBridge, type RemoteBridgeOptions, type RemoteToolDescriptor, type BridgeCallResult } from './remote-mcp-bridge.js';

export interface SpaceBridgeTarget {
  spaceId: string;
  options: RemoteBridgeOptions;
}

export interface UnresolvedBridgeTarget {
  connectionId: string;
  options: RemoteBridgeOptions;
}

/** Each request chooses an immutable bridge; concurrent requests never switch global credentials. */
export class SpaceMcpBridge extends RemoteMcpBridge {
  private readonly bridges: Map<string, RemoteMcpBridge>;
  private readonly unresolved: Map<string, RemoteMcpBridge>;
  private tools: RemoteToolDescriptor[] = [];

  constructor(targets: SpaceBridgeTarget[], unresolved: UnresolvedBridgeTarget[] = []) {
    const first = targets[0] ?? unresolved[0];
    if (!first) throw new Error('At least one Space connection is required');
    super(first.options);
    this.bridges = new Map(targets.map(({ spaceId, options }) => [spaceId, new RemoteMcpBridge(options)]));
    this.unresolved = new Map(unresolved.map(({ connectionId, options }) => [connectionId, new RemoteMcpBridge(options)]));
    if (this.bridges.size !== targets.length) throw new Error('Duplicate Space connections require reauthorization');
  }

  override async listTools(): Promise<RemoteToolDescriptor[]> {
    const manifests = await Promise.all([...this.bridges.values(), ...this.unresolved.values()].map((bridge) => bridge.listTools()));
    this.tools = [...new Map(manifests.flat().map((tool) => [tool.name, tool])).values()];
    return this.tools;
  }

  override diagnostic() {
    const diagnostics = [...this.bridges.values()].map((bridge) => bridge.diagnostic());
    const current = diagnostics.find((item) => item.status === 'connected') ?? diagnostics[0] ?? [...this.unresolved.values()][0]!.diagnostic();
    return {
      ...current, cachedToolCount: this.tools.length,
      allSpacesConnected: this.unresolved.size === 0 && diagnostics.every((item) => item.status === 'connected'),
      unresolvedConnectionIds: [...this.unresolved.keys()],
      spaces: [...this.bridges.entries()].map(([spaceId, bridge]) => ({ spaceId, ...bridge.diagnostic() })),
    };
  }

  override isOnline(): boolean { return [...this.bridges.values()].some((bridge) => bridge.isOnline()); }

  override async callTool(name: string, args: Record<string, unknown>): Promise<BridgeCallResult> {
    if (name === 'list_spaces' && args.spaceId === undefined) return this.listSpaces();
    const spaceId = args.spaceId ?? (this.bridges.size === 1 && this.unresolved.size === 0 ? [...this.bridges.keys()][0] : undefined);
    if (typeof spaceId !== 'string' || !this.bridges.has(spaceId)) {
      return { content: [{ type: 'text', text: JSON.stringify({ code: 'SPACE_CONNECTION_REQUIRED', message: 'Supply an authorized spaceId. Call wiki_list_spaces to discover connected Spaces.' }) }], isError: true };
    }
    const properties = this.tools.find((tool) => tool.name === name)?.inputSchema?.properties as Record<string, unknown> | undefined;
    // Page/run-only tools need a gateway selector which their upstream schema does not accept.
    const forwarded = { ...args };
    if (properties && Object.hasOwn(properties, 'spaceId')) forwarded.spaceId = spaceId;
    else delete forwarded.spaceId;
    return this.bridges.get(spaceId)!.callTool(name, forwarded);
  }

  private async listSpaces(): Promise<BridgeCallResult> {
    const results = await Promise.all([...this.bridges.entries()].map(async ([spaceId, bridge]) => ({ spaceId, result: await bridge.callTool('list_spaces', {}) })));
    const spaces = new Map<string, unknown>();
    const failures: string[] = [];
    for (const { spaceId, result } of results) {
      if (result.isError) { failures.push(spaceId); continue; }
      try {
        const block = result.content.find((item) => item.type === 'text');
        const data: unknown = block?.type === 'text' ? JSON.parse(block.text) : null;
        if (!Array.isArray(data)) throw new Error('Invalid space list');
        for (const space of data) {
          if (space && typeof space === 'object' && space.id === spaceId) spaces.set(spaceId, space);
        }
      } catch { failures.push(spaceId); }
    }
    // Partial discovery is explicit; callers must not interpret it as complete authorization.
    if (failures.length || this.unresolved.size) return { content: [{ type: 'text', text: JSON.stringify({ spaces: [...spaces.values()], unavailableSpaceIds: failures, unresolvedConnectionIds: [...this.unresolved.keys()], code: 'SPACE_DISCOVERY_INCOMPLETE' }) }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify([...spaces.values()]) }], isError: false };
  }
}
