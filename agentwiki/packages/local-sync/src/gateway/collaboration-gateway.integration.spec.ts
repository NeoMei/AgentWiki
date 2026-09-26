import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteMcpBridge } from './remote-mcp-bridge.js';
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


it('exposes safe remote failure alongside local tools through the actual MCP status call', async () => {
  const bridge = new RemoteMcpBridge({ serverUrl: 'https://wiki.test/api/mcp', readCredential: async () => 'agk_private', fetchImpl: async () => new Response('sensitive upstream detail', { status: 503 }) });
  const historical = handlers();
  historical.status = async () => ({ state: 'completed' });
  const { server } = await createGatewayServer({ handlers: historical, bridge });
  const client = new Client({ name: 'status-integration-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closeCallbacks.push(async () => { await client.close(); await server.close(); });
  expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('local_read_artifacts');
  const result = await client.callTool({ name: 'onboard_status', arguments: {} });
  const content = result.content as Array<{ text: string }>;
  expect(JSON.parse(JSON.parse(content[0]!.text))).toMatchObject({ state: 'completed', onboardingStateMeaning: 'historical', gateway: { status: 'unavailable', code: 'REMOTE_UNAVAILABLE', localToolsAvailable: true } });
  expect(JSON.stringify(result)).not.toContain('sensitive upstream detail');
});

it('existing gateway forwards taskboard __args and preserves partial import failures', async () => {
  const payload = { spaceId: 'space-1', documents: [{ sourcePath: 'a.md', content: '# Plan' }] };
  const bridge = {
    listTools: async () => [{ name: 'import_taskboard_plans' }, { name: 'get_taskboard' }, { name: 'update_taskboard_status' }],
    callGatewayTool: async (name: string, args: unknown) => {
      expect(name).toBe('wiki_import_taskboard_plans');
      expect(args).toEqual(payload);
      return { content: [{ type: 'text', text: JSON.stringify({ imported: 0, failed: 1, results: [{ sourcePath: 'a.md', status: 'failed', code: 'TASKBOARD_PLAN_NO_TASKS' }] }) }], isError: true };
    },
  } as unknown as RemoteMcpBridge;
  const { server } = await createGatewayServer({ handlers: handlers(), bridge });
  const client = new Client({ name: 'taskboard-gateway-test', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(right), client.connect(left)]);
  closeCallbacks.push(async () => { await client.close(); await server.close(); });
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['wiki_get_taskboard', 'wiki_update_taskboard_status']));
  const result = await client.callTool({ name: 'wiki_import_taskboard_plans', arguments: { __args: payload } });
  expect(result.isError).toBe(true);
  expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ failed: 1, results: [{ code: 'TASKBOARD_PLAN_NO_TASKS' }] });
});
