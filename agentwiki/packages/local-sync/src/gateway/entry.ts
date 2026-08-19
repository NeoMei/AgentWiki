/**
 * Gateway entry point: reads the connection config, builds handlers from the
 * existing local-sync infrastructure, discovers remote tools, and starts the
 * single stdio MCP server.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGatewayServer, type GatewayHandlers } from './server.js';
import { RemoteMcpBridge } from './remote-mcp-bridge.js';
import type { RemoteSync } from './knowledge-workflows.js';
import { createKnowledgeWorkflowRuntime } from './workflow-runtime.js';
import { loadConfig, loadCredentials } from '../config.js';
import { AgentWikiClient } from '../agentwiki-client.js';
import { SyncEngine } from '../sync/sync-engine.js';
import { AdapterManager } from '../adapter/manager.js';
import { join } from 'node:path';
import { readOnboardingStatus, readPreviewArtifactSummaries } from './status.js';
import { createCodeGraphProvider } from '../codegraph/provider.js';
import { CodeGraphPipeline } from '../codegraph/pipeline.js';
import { publicLocalScanPlan } from '../codegraph/contracts.js';

export interface GatewayEntryDeps {
  home: string;
  connectionId: string;
}

export interface GatewayEntry {
  handlers: GatewayHandlers;
  bridge: RemoteMcpBridge;
}

/** Builds the real handler closures once so scan and preparation share one pipeline. */
export async function createGatewayEntry(deps: GatewayEntryDeps): Promise<GatewayEntry> {
  const config = await loadConfig(deps.home);
  const connection = config.connections[deps.connectionId];
  if (!connection) throw new Error(`connection ${deps.connectionId} not found`);

  const credentials = await loadCredentials(deps.home);
  const credential = credentials.credentials[connection.credentialId];
  if (!credential) throw new Error(`credential ${connection.credentialId} not found`);

  const client = new AgentWikiClient();
  const syncEngine = (spaceId: string): SyncEngine => new SyncEngine({
    connection,
    apiKey: credential.apiKey,
    client,
    home: deps.home,
    spaceId,
  });
  const remoteSync: RemoteSync = {
    pull: async (spaceId) => {
      const result = await syncEngine(spaceId).pull();
      return { revisionId: result.revisionId };
    },
    push: async (spaceId, bundle) => {
      try {
        const result = await syncEngine(spaceId).push(bundle);
        return {
          conflict: false,
          revisionId: result.currentRevision,
          status: result.status,
          submissionId: result.submissionId,
          changeSetId: result.changeSetId,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes('conflict')) {
          return { conflict: true, revisionId: '' };
        }
        throw error;
      }
    },
  };

  const provider = createCodeGraphProvider({ home: deps.home });
  const codeGraph = new CodeGraphPipeline({ home: deps.home, provider });
  const workflows = createKnowledgeWorkflowRuntime({
    home: deps.home,
    adapters: new AdapterManager({ runtimeHome: join(deps.home, '.agentwiki', 'adapters') }),
    scanSources: codeGraph,
    sync: remoteSync,
  });

  const handlers: GatewayHandlers = {
    status: async (input) => readOnboardingStatus(deps.home, input.sessionId),
    scanSources: async (input) => {
      const plan = await codeGraph.plan({
        sourcePaths: input.sourcePaths,
        sourceType: input.sourceType ?? 'auto',
        analysisMode: input.analysisMode ?? 'standard',
      });
      return {
        plan: plan ? publicLocalScanPlan(plan) : null,
        localScanPlanHash: plan?.localScanPlanHash ?? null,
      };
    },
    readArtifacts: async (input) => readPreviewArtifactSummaries(deps.home, input.jobId),
    prepare: async (input) => workflows.prepare(input),
    confirmAndSync: async (input) => workflows.confirmAndSync(input),
    pull: async (input) => workflows.pull(input),
  };

  const bridge = new RemoteMcpBridge({
    serverUrl: `${connection.serverUrl}/mcp`,
    readCredential: async () => credential.apiKey,
  });

  return { handlers, bridge };
}

export async function runGateway(deps: GatewayEntryDeps): Promise<void> {
  const { handlers, bridge } = await createGatewayEntry(deps);
  const { server } = await createGatewayServer({ handlers, bridge, version: '0.3.7' });
  await server.connect(new StdioServerTransport());
}
