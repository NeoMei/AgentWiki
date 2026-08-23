import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteMcpBridge } from './remote-mcp-bridge.js';
import { createGatewayServer, type GatewayHandlers } from './server.js';

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

function handlers(): GatewayHandlers {
  return {
    status: async () => ({ ok: true }),
    scanSources: async () => ({ plan: null, localScanPlanHash: null }),
    readArtifacts: async () => [],
    prepare: async () => ({ jobId: 'job-1' }),
    confirmAndSync: async () => ({ synced: true }),
    pull: async () => ({ revisionId: 'revision-1' }),
  };
}

describe('collaboration gateway MCP integration', () => {
  it('registers and dispatches collaboration aliases across the real MCP client/server boundary', async () => {
    const callGatewayTool = vi.fn(async (name: string, input: Record<string, unknown>) => ({
      content: [{ type: 'text', text: JSON.stringify({ name, input }) }],
      isError: false,
    }));
    const bridge = {
      listTools: async () => [
        { name: 'collaboration_join_run' },
        { name: 'collaboration_next_action' },
      ],
      callGatewayTool,
    } as unknown as RemoteMcpBridge;
    const { server } = await createGatewayServer({ handlers: handlers(), bridge });
    const client = new Client({ name: 'gateway-integration-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    closeCallbacks.push(async () => {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    });

    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      'wiki_collaboration_join_run',
      'wiki_collaboration_next_action',
    ]));
    expect(names).not.toContain('collaboration_join_run');
    expect(names).not.toContain('collaboration_next_action');

    await client.callTool({
      name: 'wiki_collaboration_join_run',
      arguments: { runId: 'run-1' },
    });
    await client.callTool({
      name: 'wiki_collaboration_next_action',
      arguments: { runId: 'run-1', idempotencyKey: 'next-0001', waitSeconds: 0 },
    });

    expect(callGatewayTool).toHaveBeenNthCalledWith(1, 'wiki_collaboration_join_run', { runId: 'run-1' });
    expect(callGatewayTool).toHaveBeenNthCalledWith(2, 'wiki_collaboration_next_action', {
      runId: 'run-1',
      idempotencyKey: 'next-0001',
      waitSeconds: 0,
    });
  });
});
