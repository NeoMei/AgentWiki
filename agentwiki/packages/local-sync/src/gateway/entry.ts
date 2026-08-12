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
import { inspectLocalSource, type LocalKnowledgeDeps } from '../local-knowledge.js';
import { AdapterManager } from '../adapter/manager.js';
import { join } from 'node:path';
import { readOnboardingStatus, readPreviewArtifactSummaries } from './status.js';

export interface GatewayEntryDeps {
  home: string;
  connectionId: string;
  knowledgeDeps?: LocalKnowledgeDeps;
}

export async function runGateway(deps: GatewayEntryDeps): Promise<void> {
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

  const workflows = createKnowledgeWorkflowRuntime({
    home: deps.home,
    adapters: new AdapterManager({ runtimeHome: join(deps.home, '.agentwiki', 'adapters') }),
    sync: remoteSync,
  });

  const handlers: GatewayHandlers = {
    status: async (input) => readOnboardingStatus(deps.home, input.sessionId),
    scanSources: async (input) => {
      const inspection = await inspectLocalSource(input.sourcePaths[0] ?? '.', deps.knowledgeDeps);
      return inspection;
    },
    readArtifacts: async (input) => readPreviewArtifactSummaries(deps.home, input.jobId),
    prepare: async (input) => workflows.prepare({ ...input, sourceType: input.sourceType as 'auto' | 'code' | 'documents' | undefined }),
    confirmAndSync: async (input) => workflows.confirmAndSync(input),
    pull: async (input) => workflows.pull(input),
  };

  const bridge = new RemoteMcpBridge({
    serverUrl: `${connection.serverUrl}/mcp`,
    readCredential: async () => credential.apiKey,
  });

  const { server } = await createGatewayServer({ handlers, bridge, version: '0.3.3' });
  await server.connect(new StdioServerTransport());
}
