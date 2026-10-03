/**
 * Gateway entry point: reads the connection config, builds handlers from the
 * existing local-sync infrastructure, discovers remote tools, and starts the
 * single stdio MCP server.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGatewayServer, type GatewayHandlers } from './server.js';
import { SpaceMcpBridge } from './space-mcp-bridge.js';
import { RemoteMcpBridge } from './remote-mcp-bridge.js';
import type { RemoteSync } from './knowledge-workflows.js';
import { createKnowledgeWorkflowRuntime } from './workflow-runtime.js';
import { loadCredentials, connectionForSpace, type LocalSyncConnection } from '../config.js';
import { loadSpaceConnections } from '../space-connections.js';
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
  reportRemoteDiagnostic?: (message: string) => void;
}

export interface GatewayEntry {
  handlers: GatewayHandlers;
  bridge: RemoteMcpBridge;
}

/** Builds the real handler closures once so scan and preparation share one pipeline. */
export async function createGatewayEntry(deps: GatewayEntryDeps): Promise<GatewayEntry> {
  const { group, targets, unresolved } = await loadSpaceConnections(deps.home, deps.connectionId);
  const client = new AgentWikiClient();
  const keyForSpace = async (spaceId: string) => {
    const credentials = await loadCredentials(deps.home);
    const target = connectionForSpace(group, spaceId);
    const key = credentials.credentials[target.credentialId];
    if (!key) throw new Error(`credential for spaceId ${spaceId} not found`);
    return { target, key };
  };
  const syncEngine = async (spaceId: string) => {
    const { target, key } = await keyForSpace(spaceId);
    return { engine: new SyncEngine({
      connection: target,
      apiKey: key.apiKey,
      syncDeviceCredential: key.syncDeviceCredential,
      client,
      home: deps.home,
      spaceId,
    }), treeSync: Boolean(key.syncDeviceCredential) };
  };
  const remoteSync: RemoteSync = {
    pull: async (spaceId) => {
      const { engine, treeSync } = await syncEngine(spaceId);
      const result = treeSync
        ? await engine.pullTreeV2()
        : await engine.pull();
      return { revisionId: result.revisionId };
    },
    push: async (spaceId, bundle) => {
      try {
        const { engine, treeSync } = await syncEngine(spaceId);
        if (treeSync) {
          const result = await engine.pushTreeV2(bundle);
          return {
            conflict: false,
            revisionId: result.revision,
            status: result.status,
          };
        }
        const result = await engine.push(bundle);
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
    prepare: async (input) => { await keyForSpace(input.spaceId); return workflows.prepare(input); },
    confirmAndSync: async (input) => workflows.confirmAndSync(input),
    pull: async (input) => workflows.pull(input),
  };

  const bridgeOptions = (target: LocalSyncConnection) => ({
    serverUrl: `${target.serverUrl}/mcp`,
    readCredential: async () => {
      const current = await loadCredentials(deps.home);
      const key = current.credentials[target.credentialId]?.apiKey;
      if (!key) throw new Error('Space credential is missing');
      return key;
    },
    onDiagnostic: (diagnostic: import('./remote-mcp-bridge.js').RemoteDiagnostic) => {
      if (diagnostic.status !== 'connected') deps.reportRemoteDiagnostic?.(`[agentwiki] ${diagnostic.code}: ${diagnostic.recovery}`);
    },
  });
  const bridge = new SpaceMcpBridge(
    targets.map((target) => ({ spaceId: target.spaceId!, options: bridgeOptions(target) })),
    unresolved.map((target) => ({ connectionId: target.id, options: bridgeOptions(target) })),
  );

  return { handlers, bridge };
}

export async function runGateway(deps: GatewayEntryDeps): Promise<void> {
  const { handlers, bridge } = await createGatewayEntry({ ...deps, reportRemoteDiagnostic: deps.reportRemoteDiagnostic ?? ((message) => { process.stderr.write(`${message}\n`); }) });
  const { server } = await createGatewayServer({ handlers, bridge, version: '0.11.0' });
  await server.connect(new StdioServerTransport());
}
