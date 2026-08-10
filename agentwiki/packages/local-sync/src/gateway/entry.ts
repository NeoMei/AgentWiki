/**
 * Gateway entry point: reads the connection config, builds handlers from the
 * existing local-sync infrastructure, discovers remote tools, and starts the
 * single stdio MCP server.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGatewayServer, type GatewayHandlers } from './server.js';
import { RemoteMcpBridge } from './remote-mcp-bridge.js';
import { KnowledgeWorkflows, createInMemoryPreviewStore, type PrepareFn, type RemoteSync } from './knowledge-workflows.js';
import { loadConfig, loadCredentials } from '../config.js';
import { AgentWikiClient } from '../agentwiki-client.js';
import { SyncEngine } from '../sync/sync-engine.js';
import { inspectLocalSource, prepareKnowledgeSync, type LocalKnowledgeDeps } from '../local-knowledge.js';

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
  const syncEngine = new SyncEngine({
    connection,
    apiKey: credential.apiKey,
    client,
    home: deps.home,
  });

  const prepareFn: PrepareFn = async (input) => {
    const path = input.sourcePaths[0] ?? '.';
    const prepared = await prepareKnowledgeSync(
      { path, allowRemoteModel: false },
      deps.knowledgeDeps ?? { home: deps.home, run: () => ({ status: 0, stdout: '', stderr: '' }), now: () => new Date() },
    );
    return {
      envelope: { documents: prepared.envelope.documents.map((d) => ({ path: d.path, contentHash: d.contentHash })) },
      sourceKey: prepared.sourceKey,
      processedFiles: prepared.processedFiles,
      skippedFiles: prepared.skippedFiles,
    };
  };

  const remoteSync: RemoteSync = {
    pull: async () => {
      const result = await syncEngine.pull();
      return { revisionId: result.revisionId };
    },
    push: async (bundle) => {
      try {
        const result = await syncEngine.push(bundle as never);
        return { conflict: false, revisionId: result.currentRevision };
      } catch (error) {
        if (error instanceof Error && error.message.includes('conflict')) {
          return { conflict: true, revisionId: '' };
        }
        throw error;
      }
    },
  };

  const workflows = new KnowledgeWorkflows({
    prepare: prepareFn,
    previews: createInMemoryPreviewStore(),
    remote: remoteSync,
  });

  const handlers: GatewayHandlers = {
    status: async () => ({ connection: deps.connectionId, serverUrl: connection.serverUrl }),
    scanSources: async (input) => {
      const inspection = await inspectLocalSource(input.sourcePaths[0] ?? '.', deps.knowledgeDeps);
      return inspection;
    },
    readArtifacts: async () => [],
    prepare: async (input) => workflows.prepare({ ...input, sourceType: input.sourceType as 'auto' | 'code' | 'documents' | undefined }),
    confirmAndSync: async (input) => workflows.confirmAndSync(input),
    pull: async (input) => workflows.pull(input),
  };

  const bridge = new RemoteMcpBridge({
    serverUrl: `${connection.serverUrl}/mcp`,
    readCredential: async () => credential.apiKey,
  });

  const { server } = await createGatewayServer({ handlers, bridge, version: '0.3.0' });
  await server.connect(new StdioServerTransport());
}
