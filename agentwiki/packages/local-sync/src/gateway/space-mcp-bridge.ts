import { RemoteMcpBridge, type RemoteBridgeOptions, type BridgeCallResult } from './remote-mcp-bridge.js';
import { SAFE_SPACE_ID_PATTERN } from '../workspace/layout.js';

/**
 * One immutable Agent identity, with per-request Space context. The server owns
 * live grants; local configuration never acts as a Space authorization list.
 */
export class SpaceMcpBridge extends RemoteMcpBridge {
  constructor(options: RemoteBridgeOptions, private readonly defaultSpaceId?: string) {
    super(options);
  }

  override diagnostic() {
    return { ...super.diagnostic(), credentialScope: 'agent' as const, authorizationSource: 'live_agent_grants' as const };
  }

  override async callTool(name: string, args: Record<string, unknown>): Promise<BridgeCallResult> {
    if (name === 'list_spaces' && args.spaceId === undefined) return super.callTool(name, args);
    const spaceId = args.spaceId ?? this.defaultSpaceId;
    if (typeof spaceId !== 'string' || !SAFE_SPACE_ID_PATTERN.test(spaceId)) {
      return { content: [{ type: 'text', text: JSON.stringify({ code: 'SPACE_ID_REQUIRED', message: 'Supply a Space ID from wiki_list_spaces. Access is checked by AgentWiki for each request.' }) }], isError: true };
    }
    // Keep the selector even for resource-only tools: the server validates that
    // the page/run belongs to this Space before applying its current grants.
    return super.callTool(name, { ...args, spaceId });
  }
}
