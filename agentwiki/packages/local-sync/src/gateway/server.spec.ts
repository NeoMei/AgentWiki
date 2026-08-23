import { describe, expect, it, vi } from 'vitest';
import { createGatewayServer, gatewayToolInputSchemas, type GatewayHandlers } from './server.js';
import { RemoteMcpBridge } from './remote-mcp-bridge.js';
import { isLegacyToolName } from './manifest.js';
import { PublicLocalScanPlanSchema, type PublicLocalScanPlan } from '../codegraph/contracts.js';

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
    const registered = (server as any)._registeredTools.wiki_collaboration_next_action;
    const input = registered.inputSchema.parse({ runId: 'run-1', idempotencyKey: 'next-0001' });
    await registered.handler(input);
    expect(bridge.callGatewayTool).toHaveBeenCalledWith('wiki_collaboration_next_action', {
      runId: 'run-1', idempotencyKey: 'next-0001',
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
