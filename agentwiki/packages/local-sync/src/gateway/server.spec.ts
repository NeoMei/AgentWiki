import { describe, expect, it, vi } from 'vitest';
import { createGatewayServer, gatewayToolInputSchemas, type GatewayHandlers } from './server.js';
import { RemoteMcpBridge } from './remote-mcp-bridge.js';
import { isLegacyToolName } from './manifest.js';
import { PublicLocalScanPlanSchema, type PublicLocalScanPlan } from '../codegraph/contracts.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

function mockHandlers(): GatewayHandlers {
  return {
    status: vi.fn(async () => ({ ok: true })),
    scanSources: vi.fn(async () => ({ plan: null, localScanPlanHash: null })),
    readArtifacts: vi.fn(async () => []),
    prepare: vi.fn(async () => ({ jobId: 'j1', previewHash: 'h1' })),
    confirmAndSync: vi.fn(async () => ({ synced: true })),
    pull: vi.fn(async () => ({ revision: 'r1' })),
  };
}

/** A minimal bridge stub that returns a fixed remote tool list without network. */
function offlineBridge(): RemoteMcpBridge {
  return {
    listTools: async () => [],
    listGatewayToolNames: async () => [],
    callTool: async () => ({ content: [], isError: false }),
    callGatewayTool: async () => ({ content: [], isError: false }),
    isOnline: () => false,
  } as unknown as RemoteMcpBridge;
}

function onlineBridge(tools: string[]): RemoteMcpBridge {
  return {
    listTools: async () => tools.map((name) => ({ name })),
    listGatewayToolNames: async () => tools.map((name) => `wiki_${name}`),
    callTool: async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false }),
    callGatewayTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false })),
    isOnline: () => true,
  } as unknown as RemoteMcpBridge;
}

async function withReadGateway(run: (client: Client, bridge: RemoteMcpBridge) => Promise<void>) {
  const bridge = onlineBridge(['list_spaces', 'list_pages', 'search_pages', 'get_page', 'list_graph', 'list_sources', 'propose_page']);
  vi.mocked(bridge.callGatewayTool).mockImplementation(async (_name, args) => ({
    content: [{ type: 'text', text: JSON.stringify(args) }], isError: false,
  }));
  const { server } = await createGatewayServer({ handlers: mockHandlers(), bridge });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'read-contract-test', version: '1' }, { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { await run(client, bridge); }
  finally { await client.close(); await server.close(); }
}

describe('knowledge read contracts over the SDK', () => {
  it('advertises named fields and upstream bounds in actual tools/list', async () => {
    await withReadGateway(async (client) => {
      const { tools } = await client.listTools();
      const schema = (name: string) => tools.find((tool) => tool.name === name)!.inputSchema.properties!;
      expect(schema('wiki_search_pages')).toMatchObject({
        query: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 50 },
      });
      expect(schema('wiki_get_page')).toMatchObject({ pageId: { type: 'string', minLength: 1 } });
      expect(schema('wiki_list_pages')).toMatchObject({
        skip: { type: 'integer', minimum: 0 }, take: { type: 'integer', minimum: 1, maximum: 100 },
      });
      for (const name of ['list_spaces', 'list_pages', 'search_pages', 'get_page', 'list_graph', 'list_sources']) {
        expect(schema(`wiki_${name}`)).toHaveProperty('__args');
        expect(schema(`wiki_${name}`)).toHaveProperty('spaceId');
      }
    });
  });

  it.each([
    ['list_spaces', { spaceId: 'space-a' }],
    ['list_pages', { spaceId: 'space-a', skip: 0, take: 100 }],
    ['search_pages', { spaceId: 'space-a', query: '保存', limit: 50 }],
    ['get_page', { spaceId: 'space-a', pageId: 'page-1' }],
    ['list_graph', { spaceId: 'space-a' }],
    ['list_sources', { spaceId: 'space-a' }],
  ] as const)('forwards direct and legacy %s inputs identically', async (name, args) => {
    await withReadGateway(async (client) => {
      for (const arguments_ of [args, { __args: args }, { ...args, __args: args }]) {
        const result = await client.callTool({ name: `wiki_${name}`, arguments: arguments_ });
        expect(result.isError).toBe(false);
        expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toEqual(args);
      }
    });
  });

  it.each([
    ['search_pages', {}], ['search_pages', { query: '' }],
    ['search_pages', { query: 'q', limit: 0 }], ['search_pages', { query: 'q', limit: 51 }],
    ['search_pages', { query: 'q', limit: 1.5 }], ['search_pages', { query: 'q', limit: '5' }],
    ['get_page', {}], ['get_page', { pageId: '' }],
    ['list_pages', { skip: -1 }], ['list_pages', { skip: 0.5 }],
    ['list_pages', { take: 0 }], ['list_pages', { take: 101 }], ['list_pages', { take: 1.5 }],
    ['list_graph', { spaceId: '' }], ['list_sources', { spaceId: '../other' }],
  ])('rejects invalid %s arguments in both forms before forwarding: %j', async (name, fields) => {
    await withReadGateway(async (client, bridge) => {
      const args = { spaceId: 'space-a', ...fields as Record<string, unknown> };
      for (const arguments_ of [args, { __args: args }]) {
        expect((await client.callTool({ name: `wiki_${name}`, arguments: arguments_ })).isError).toBe(true);
      }
      expect(bridge.callGatewayTool).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['search_pages', { query: 'a', limit: 5 }, { query: 'b', limit: 5 }],
    ['search_pages', { query: 'a', limit: 5 }, { query: 'a', limit: 6 }],
    ['get_page', { pageId: 'page-a' }, { pageId: 'page-b' }],
    ['list_pages', { skip: 0, take: 5 }, { skip: 1, take: 5 }],
    ['list_pages', { skip: 0, take: 5 }, { skip: 0, take: 6 }],
    ['list_sources', { spaceId: 'space-a' }, { spaceId: 'space-b' }],
  ])('rejects conflicting %s fields instead of choosing a form', async (name, direct, legacy) => {
    await withReadGateway(async (client, bridge) => {
      const result = await client.callTool({ name: `wiki_${name}`, arguments: {
        spaceId: 'space-a', ...direct, __args: legacy,
      } });
      expect(result.isError).toBe(true);
      expect(bridge.callGatewayTool).not.toHaveBeenCalled();
    });
  });

  it('preserves generic write wrapping and remote error content', async () => {
    await withReadGateway(async (client, bridge) => {
      const result = await client.callTool({ name: 'wiki_propose_page', arguments: {
        spaceId: 'space-a', __args: { title: 'T', content: 'C' },
      } });
      expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text))
        .toEqual({ spaceId: 'space-a', title: 'T', content: 'C' });
      vi.mocked(bridge.callGatewayTool).mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"code":"SPACE_ACCESS_DENIED"}' }], isError: true,
      });
      const denied = await client.callTool({ name: 'wiki_get_page', arguments: { spaceId: 'space-a', pageId: 'page-1' } });
      expect(denied).toMatchObject({ content: [{ type: 'text', text: '{"code":"SPACE_ACCESS_DENIED"}' }], isError: true });
    });
  });
});

describe('gateway server tool registration', () => {
  it('rejects unknown scan modes, non-booleans, malformed hashes, and unknown fields before handlers run', () => {
    expect(() => gatewayToolInputSchemas.localScanSources.parse({ sourcePaths: ['.'], analysisMode: 'unknown' })).toThrow();
    expect(() => gatewayToolInputSchemas.knowledgePrepare.parse({ spaceId: 's', sourcePaths: ['.'], sourceType: 'code', confirmedLocalScan: 'true', localScanPlanHash: 'a'.repeat(64) })).toThrow();
    expect(() => gatewayToolInputSchemas.knowledgePrepare.parse({ spaceId: 's', sourcePaths: ['.'], sourceType: 'code', confirmedLocalScan: true, localScanPlanHash: 'wrong' })).toThrow();
    expect(() => gatewayToolInputSchemas.localScanSources.parse({ sourcePaths: ['.'], unexpected: true })).toThrow();
    expect(() => gatewayToolInputSchemas.knowledgePrepare.parse({ spaceId: 's', sourcePaths: ['.'], unexpected: true })).toThrow();
  });

  it('registers all static public tools', async () => {
    const { toolNames } = await createGatewayServer({ handlers: mockHandlers() });
    expect(toolNames).toContain('onboard_status');
    expect(toolNames).toContain('local_scan_sources');
    expect(toolNames).toContain('local_read_artifacts');
    expect(toolNames).toContain('knowledge_prepare');
    expect(toolNames).toContain('knowledge_confirm_and_sync');
    expect(toolNames).toContain('knowledge_pull');
  });

  it('registers remote tools with wiki_ prefix', async () => {
    const { toolNames } = await createGatewayServer({
      handlers: mockHandlers(),
      bridge: onlineBridge(['list_pages', 'list_graph']),
    });
    expect(toolNames).toContain('wiki_list_pages');
    expect(toolNames).toContain('wiki_list_graph');
  });

  it('forwards collaboration aliases with direct named inputs', async () => {
    const bridge = onlineBridge(['collaboration_next_action']);
    const { server } = await createGatewayServer({ handlers: mockHandlers(), bridge });
    const registered = (server as unknown as {
      _registeredTools: Record<string, {
        inputSchema: { parse(input: unknown): unknown };
        handler(input: unknown): Promise<unknown>;
      }>;
    })._registeredTools.wiki_collaboration_next_action;
    const input = registered.inputSchema.parse({ runId: 'run-1', idempotencyKey: 'next-0001' });
    await registered.handler(input);
    expect(bridge.callGatewayTool).toHaveBeenCalledWith('wiki_collaboration_next_action', {
      runId: 'run-1', idempotencyKey: 'next-0001',
    });
  });

  it('preserves remote MCP error semantics without double encoding the content', async () => {
    const bridge = onlineBridge(['collaboration_next_action']);
    vi.mocked(bridge.callGatewayTool).mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"code":"COLLABORATION_LEASE_EXPIRED"}' }],
      isError: true,
    });
    const { server } = await createGatewayServer({ handlers: mockHandlers(), bridge });
    const registered = (server as unknown as {
      _registeredTools: Record<string, { inputSchema: { parse(input: unknown): unknown }; handler(input: unknown): Promise<unknown> }>;
    })._registeredTools.wiki_collaboration_next_action;

    const result = await registered.handler(registered.inputSchema.parse({ runId: 'run-1', idempotencyKey: 'next-0001' }));

    expect(result).toEqual({
      content: [{ type: 'text', text: '{"code":"COLLABORATION_LEASE_EXPIRED"}' }],
      isError: true,
    });
  });

  it('does not register any legacy tool name', async () => {
    const { toolNames } = await createGatewayServer({
      handlers: mockHandlers(),
      bridge: onlineBridge(['start_knowledge_job', 'list_pages']),
    });
    for (const name of toolNames) {
      expect(isLegacyToolName(name)).toBe(false);
    }
    expect(toolNames).not.toContain('wiki_start_knowledge_job');
  });

  it('produces unique tool names', async () => {
    const { toolNames } = await createGatewayServer({
      handlers: mockHandlers(),
      bridge: onlineBridge(['list_pages', 'propose_page']),
    });
    expect(new Set(toolNames).size).toBe(toolNames.length);
  });

  it('works fully offline (no bridge) with local tools only', async () => {
    const { toolNames } = await createGatewayServer({ handlers: mockHandlers() });
    expect(toolNames.some((n) => n.startsWith('wiki_'))).toBe(false);
    expect(toolNames).toContain('knowledge_prepare');
  });

  it('works with an offline bridge (cached/empty) without disabling local tools', async () => {
    const { toolNames } = await createGatewayServer({
      handlers: mockHandlers(),
      bridge: offlineBridge(),
    });
    expect(toolNames).toContain('local_scan_sources');
    expect(toolNames).toContain('knowledge_prepare');
  });

  it('routes a local tool call to the scanSources handler', async () => {
    const handlers = mockHandlers();
    const { server } = await createGatewayServer({ handlers });
    const registered = (server as unknown as {
      _registeredTools: Record<string, {
        inputSchema: { parse(input: unknown): unknown };
        handler(input: unknown): Promise<unknown>;
      }>;
    })._registeredTools.local_scan_sources!;
    const result = await registered.handler(registered.inputSchema.parse({ sourcePaths: ['.'], sourceType: 'auto' }));
    expect(result).toMatchObject({ content: expect.any(Array) });
    expect(handlers.scanSources).toHaveBeenCalledTimes(1);
    expect(handlers.scanSources).toHaveBeenCalledWith({ sourcePaths: ['.'], sourceType: 'auto', analysisMode: 'standard' });
  });

  it('serializes only the public scan-plan DTO from local_scan_sources', async () => {
    const plan: PublicLocalScanPlan = {
      schemaVersion: 'agentwiki-local-scan-plan@1', provider: 'codegraph', detectedVersion: '1.2.3',
      capabilities: { required: { 'index.status': true, 'index.sync': true, 'files.list': true }, optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false } },
      analysisMode: 'standard', limits: { maxFiles: 1, maxGeneratedBytes: 1 }, localScanPlanHash: 'a'.repeat(64),
      sources: [{ sourceKey: 'b'.repeat(64), displayPath: 'repo', action: 'sync', indexState: 'stale', estimatedFiles: 1 }],
    };
    const handlers = mockHandlers();
    handlers.scanSources = vi.fn(async () => ({ plan, localScanPlanHash: plan.localScanPlanHash }));
    const { server } = await createGatewayServer({ handlers });
    const registered = (server as unknown as { _registeredTools: Record<string, { inputSchema: { parse(input: unknown): unknown }; handler(input: unknown): Promise<{ content: Array<{ text: string }> }> }> })._registeredTools.local_scan_sources!;
    const result = await registered.handler(registered.inputSchema.parse({ sourcePaths: ['.'] }));
    const parsed = JSON.parse(JSON.parse(result.content[0]!.text) as string) as { plan: unknown; localScanPlanHash: string };
    expect(PublicLocalScanPlanSchema.parse(parsed.plan)).toMatchObject({ localScanPlanHash: plan.localScanPlanHash });
    expect(parsed.localScanPlanHash).toBe(plan.localScanPlanHash);
  });

  it('fails closed before MCP serialization when scanSources returns a private or unsafe plan', async () => {
    const sentinel = '/private/sentinel-codegraph';
    const handlers = mockHandlers();
    handlers.scanSources = vi.fn(async () => ({
      plan: {
        schemaVersion: 'agentwiki-local-scan-plan@1', provider: 'codegraph', executableIdentity: `${sentinel}/bin`, detectedVersion: '1.2.3',
        capabilities: { required: { 'index.status': true, 'index.sync': true, 'files.list': true }, optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false } },
        analysisMode: 'standard', limits: { maxFiles: 1, maxGeneratedBytes: 1 }, localScanPlanHash: 'a'.repeat(64),
        sources: [{ sourceKey: 'b'.repeat(64), displayPath: sentinel, canonicalSourcePath: sentinel, indexPath: `${sentinel}/.codegraph`, action: 'sync', indexState: 'stale', estimatedFiles: 1 }],
      },
      localScanPlanHash: 'a'.repeat(64),
    } as never));
    const { server } = await createGatewayServer({ handlers });
    const registered = (server as unknown as { _registeredTools: Record<string, { inputSchema: { parse(input: unknown): unknown }; handler(input: unknown): Promise<unknown> }> })._registeredTools.local_scan_sources!;

    let failure: unknown;
    try {
      await registered.handler(registered.inputSchema.parse({ sourcePaths: ['.'] }));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeDefined();
    expect(JSON.stringify(failure)).not.toContain(sentinel);
  });
});

it('onboard_status distinguishes historical completed state from a fresh remote failure and recovery', async () => {
  let httpStatus = 401;
  const bridge = new RemoteMcpBridge({ serverUrl: 'https://wiki.test/api/mcp', readCredential: async () => 'agk_private', fetchImpl: (async (_url, init) => {
    if (httpStatus !== 200) return new Response('private-upstream agk_secret', { status: httpStatus });
    if (init?.method === 'GET') return new Response('', { status: 405 });
    const request = JSON.parse(String(init?.body));
    if (request.id === undefined) return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: '2.0', id: request.id, result: request.method === 'initialize'
      ? { protocolVersion: '2025-03-26', serverInfo: { name: 'fixture', version: '1' }, capabilities: { tools: {} } }
      : { tools: [{ name: 'list_pages', inputSchema: { type: 'object' } }] } });
  }) as typeof fetch });
  const handlers = mockHandlers();
  handlers.status = vi.fn(async () => ({ state: 'completed', connectionId: 'old-connection' }));
  const { server, toolNames } = await createGatewayServer({ handlers, bridge });
  expect(toolNames).toHaveLength(6);
  const registered = (server as unknown as { _registeredTools: Record<string, { handler(input: unknown): Promise<{ content: Array<{ text: string }> }> }> })._registeredTools.onboard_status!;
  const read = async () => JSON.parse(JSON.parse((await registered.handler({})).content[0]!.text));
  const failed = await read();
  expect(failed).toMatchObject({ state: 'completed', onboardingStateMeaning: 'historical', gateway: { status: 'authorization_required', localToolsAvailable: true, registeredRemoteToolCount: 0 } });
  expect(JSON.stringify(failed)).not.toMatch(/private-upstream|agk_secret|agk_private/);
  httpStatus = 200;
  expect(await read()).toMatchObject({ gateway: { status: 'connected', clientReloadRequired: true, registeredRemoteToolCount: 0 } });
  expect(handlers.scanSources).not.toHaveBeenCalled();
  await server.close();
});

it.each([
  { initial: ['list_pages'], current: ['get_page'], reload: true },
  { initial: ['list_pages', 'list_graph'], current: ['get_page'], reload: true },
  { initial: ['list_pages', 'list_graph'], current: ['list_pages'], reload: true },
  { initial: ['list_pages', 'list_graph'], current: ['list_graph', 'list_pages'], reload: false },
  { initial: ['list_pages'], current: ['list_pages', 'start_knowledge_job'], reload: false },
])('compares actual public remote names for reload guidance ($initial -> $current)', async ({ initial, current, reload }) => {
  const bridge = onlineBridge(initial);
  bridge.diagnostic = () => ({ status: 'connected', code: 'REMOTE_CONNECTED', checkedAt: new Date().toISOString(), cachedToolCount: current.length, recovery: 'Remote available.' });
  const { server } = await createGatewayServer({ handlers: mockHandlers(), bridge });
  bridge.listTools = async () => current.map((name) => ({ name }));
  const status = (server as unknown as { _registeredTools: Record<string, { handler(input: unknown): Promise<{ content: Array<{ text: string }> }> }> })._registeredTools.onboard_status!;
  const result = JSON.parse(JSON.parse((await status.handler({})).content[0]!.text));
  expect(result.gateway).toMatchObject({ status: 'connected', clientReloadRequired: reload, registeredRemoteToolCount: initial.length });
  await server.close();
});
