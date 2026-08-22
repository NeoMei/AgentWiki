import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { saveConfig, saveCredentials } from '../config.js';
import type { LocalScanPlan } from '../codegraph/contracts.js';
import { PublicLocalScanPlanSchema } from '../codegraph/contracts.js';
import type { CodeGraphProvider } from '../codegraph/provider.js';
import type { KnowledgeWorkflows } from './knowledge-workflows.js';
import { createGatewayServer } from './server.js';

const construction = vi.hoisted(() => ({
  provider: undefined as unknown as CodeGraphProvider,
  pipeline: undefined as unknown as { plan: ReturnType<typeof vi.fn>; collect: ReturnType<typeof vi.fn> },
  workflows: undefined as unknown as KnowledgeWorkflows,
  pipelineInput: undefined as unknown as { home: string; provider: CodeGraphProvider },
  runtimeInput: undefined as unknown as { scanSources?: unknown },
  createProvider: vi.fn(() => construction.provider),
  createPipeline: vi.fn(function (input: { home: string; provider: CodeGraphProvider }) { construction.pipelineInput = input; return construction.pipeline; }),
  createRuntime: vi.fn((input: { scanSources?: unknown }) => { construction.runtimeInput = input; return construction.workflows; }),
}));

vi.mock('../codegraph/provider.js', () => ({ createCodeGraphProvider: construction.createProvider }));
vi.mock('../codegraph/pipeline.js', () => ({ CodeGraphPipeline: construction.createPipeline }));
vi.mock('./workflow-runtime.js', () => ({ createKnowledgeWorkflowRuntime: construction.createRuntime }));

const { createGatewayEntry } = await import('./entry.js');

const homes: string[] = [];

async function temporaryHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'agentwiki-entry-'));
  homes.push(home);
  return home;
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('gateway entry', () => {
  it('creates one provider and one pipeline shared by the real scan and prepare handlers', async () => {
    const home = await temporaryHome();
    await saveConfig(home, {
      version: 1,
      connections: {
        primary: { id: 'primary', serverUrl: 'https://example.test', agentId: 'agent-1', credentialId: 'credential-1', pluginVersion: '0.5.0', client: 'codex', mcpName: 'agentwiki' },
      },
    });
    await saveCredentials(home, { version: 1, credentials: { 'credential-1': { apiKey: 'test-key' } } });
    const scanHash = 'a'.repeat(64);
    const plan: LocalScanPlan = {
      schemaVersion: 'agentwiki-local-scan-plan@1', provider: 'codegraph', executableIdentity: '/codegraph', detectedVersion: '1.0.0', analysisMode: 'standard',
      capabilities: { required: { 'index.status': true, 'index.sync': true, 'files.list': true }, optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false } },
      sources: [{ sourceKey: 'b'.repeat(64), displayPath: 'repository', canonicalSourcePath: '/private/sentinel-source', indexPath: '/private/sentinel-index/.codegraph', action: 'sync', indexState: 'stale', estimatedFiles: 1 }], limits: { maxFiles: 10, maxGeneratedBytes: 10_000 }, localScanPlanHash: scanHash,
    };
    const provider = { identity: 'provider-instance' } as unknown as CodeGraphProvider;
    const pipeline = {
      plan: vi.fn(async () => plan),
      collect: vi.fn(async () => ({ artifacts: [], sourceKeys: [], processedFiles: 0, warnings: [] })),
    };
    const workflows = {
      prepare: vi.fn(async () => ({ jobId: 'job-1', previewHash: 'preview-1' })),
      confirmAndSync: vi.fn(async () => ({ synced: true })),
      pull: vi.fn(async () => ({ revisionId: '0' })),
    } as unknown as KnowledgeWorkflows;
    construction.provider = provider;
    construction.pipeline = pipeline;
    construction.workflows = workflows;
    construction.pipelineInput = undefined as never;
    construction.runtimeInput = undefined as never;
    vi.clearAllMocks();

    const { handlers } = await createGatewayEntry({
      home,
      connectionId: 'primary',
    });
    const scanned = await handlers.scanSources({ sourcePaths: ['/private/repository'], sourceType: 'code', analysisMode: 'standard' });
    await handlers.prepare({ spaceId: 'space-1', sourcePaths: ['/private/repository'], sourceType: 'code', analysisMode: 'standard', localScanPlanHash: scanHash, confirmedLocalScan: true });

    expect(scanned).toMatchObject({ localScanPlanHash: scanHash });
    const response = scanned as { plan: unknown; localScanPlanHash: string | null };
    expect(response.localScanPlanHash).toBe(scanHash);
    expect(PublicLocalScanPlanSchema.parse(response.plan)).toMatchObject({ localScanPlanHash: scanHash });
    expect(JSON.stringify(scanned)).not.toContain('/private/sentinel-source');
    expect(JSON.stringify(scanned)).not.toContain('/private/sentinel-index');
    expect(JSON.stringify(scanned)).not.toContain('/codegraph');
    const { server } = await createGatewayServer({ handlers });
    const registered = (server as unknown as { _registeredTools: Record<string, { inputSchema: { parse(input: unknown): unknown }; handler(input: unknown): Promise<{ content: Array<{ text: string }> }> }> })._registeredTools.local_scan_sources!;
    const mcpResult = await registered.handler(registered.inputSchema.parse({ sourcePaths: ['/private/repository'], sourceType: 'code' }));
    const mcpResponse = JSON.parse(JSON.parse(mcpResult.content[0]!.text) as string) as { plan: unknown; localScanPlanHash: string | null };
    expect(mcpResponse.localScanPlanHash).toBe(scanHash);
    expect(PublicLocalScanPlanSchema.parse(mcpResponse.plan)).toMatchObject({ localScanPlanHash: scanHash });
    expect(JSON.stringify(mcpResponse)).not.toContain('/private/sentinel-source');
    expect(JSON.stringify(mcpResponse)).not.toContain('/private/sentinel-index');
    expect(JSON.stringify(mcpResponse)).not.toContain('/codegraph');
    expect(construction.createProvider).toHaveBeenCalledTimes(1);
    expect(construction.createPipeline).toHaveBeenCalledTimes(1);
    expect(construction.createRuntime).toHaveBeenCalledTimes(1);
    expect(pipeline.plan).toHaveBeenCalledTimes(2);
    expect(workflows.prepare).toHaveBeenCalledTimes(1);
    expect(construction.pipelineInput.home).toBe(home);
    expect(construction.pipelineInput.provider).toBe(provider);
    expect(construction.runtimeInput.scanSources).toBe(pipeline);
  });
});
