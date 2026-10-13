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
import { loadCredentials } from '../config.js';
import { loadAgentConnection, authorizedAgentCredential } from '../space-connections.js';
import { AgentWikiClient } from '../agentwiki-client.js';
import { SyncEngine } from '../sync/sync-engine.js';
import { AdapterManager } from '../adapter/manager.js';
import { join } from 'node:path';
import { readOnboardingStatus, readPreviewArtifactSummaries } from './status.js';
import { createCodeGraphProvider } from '../codegraph/provider.js';
import { CodeGraphPipeline } from '../codegraph/pipeline.js';
import { publicLocalScanPlan } from '../codegraph/contracts.js';
import { agentKnowledgeWorkspace, LEGACY_TREE_WORKSPACE_WARNING } from './agent-knowledge-workspace.js';
import { workspacePaths } from '../workspace/layout.js';
import { readManifest } from '../workspace/state.js';

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
  const { connection } = await loadAgentConnection(deps.home, deps.connectionId);
  const client = new AgentWikiClient();
  const keyForSpace = (spaceId: string) => authorizedAgentCredential(deps.home, connection, spaceId, client);
  const syncEngine = async (spaceId: string) => {
    const key = await keyForSpace(spaceId);
    const workspace = await agentKnowledgeWorkspace(deps.home, spaceId);
    return { engine: new SyncEngine({ connection, apiKey: key.apiKey, client, home: workspace.home, spaceId }), workspace };
  };
  const remoteSync: RemoteSync = {
    pull: async (spaceId) => {
      const { engine, workspace } = await syncEngine(spaceId);
      const result = await engine.pull();
      return { revisionId: result.revisionId, ...(workspace.isolated ? { workspaceMode: 'isolated_agent_knowledge', legacyWorkspacePreserved: true, warnings: [LEGACY_TREE_WORKSPACE_WARNING] } : {}) };
    },
    push: async (spaceId, bundle) => {
      try {
        const { engine } = await syncEngine(spaceId);
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
    workspaceHome: async (spaceId) => (await agentKnowledgeWorkspace(deps.home, spaceId)).home,
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
    prepare: async (input) => {
      await keyForSpace(input.spaceId);
      const workspace = await agentKnowledgeWorkspace(deps.home, input.spaceId);
      if (workspace.isolated && !(await readManifest(workspacePaths(workspace.home, input.spaceId)))?.baseRevision) {
        await remoteSync.pull(input.spaceId);
      }
      const result = await workflows.prepare(input);
      return workspace.isolated ? { ...result, warnings: [...result.warnings, LEGACY_TREE_WORKSPACE_WARNING] } : result;
    },
    confirmAndSync: async (input) => workflows.confirmAndSync(input),
    pull: async (input) => workflows.pull(input),
  };

  const bridge = new SpaceMcpBridge({
    serverUrl: `${connection.serverUrl.replace(/\/+$/, '')}/mcp`,
    readCredential: async () => {
      const current = await loadCredentials(deps.home);
      const key = current.credentials[connection.credentialId]?.apiKey;
      if (!key) throw new Error('Agent credential is missing');
      return key;
    },
    onDiagnostic: (diagnostic) => {
      if (diagnostic.status !== 'connected') deps.reportRemoteDiagnostic?.(`[agentwiki] ${diagnostic.code}: ${diagnostic.recovery}`);
    },
  }, connection.spaceId);

  return { handlers, bridge };
}

export async function runGateway(deps: GatewayEntryDeps): Promise<void> {
  const { handlers, bridge } = await createGatewayEntry({ ...deps, reportRemoteDiagnostic: deps.reportRemoteDiagnostic ?? ((message) => { process.stderr.write(`${message}\n`); }) });
  const { server } = await createGatewayServer({ handlers, bridge, version: '0.11.0' });
  await server.connect(new StdioServerTransport());
}
