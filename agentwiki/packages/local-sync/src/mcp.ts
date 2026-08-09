import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { type AgentWikiClient, redactSecrets, type KnowledgeSyncResult } from './agentwiki-client.js';
import {
  claimPreview,
  completePreview,
  releasePreview,
  savePreview,
  type LocalSyncConnection,
} from './config.js';
import {
  buildPreview,
  inspectLocalSource,
  prepareKnowledgeSync,
  type SourceInspection,
} from './local-knowledge.js';


const PACKAGE_VERSION = (() => {
  try {
    const require = createRequire(import.meta.url);
    return (require('../package.json') as { version: string }).version;
  } catch {
    return '0.2.6';
  }
})();
const PREVIEW_TTL_MS = 30 * 60 * 1_000;

export interface SyncPreview {
  previewId: string;
  displayName: string;
  spaceId: string;
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
  processedFiles: number;
  skippedFiles: Array<{ path: string; reason: string }>;
  uploadBytes: number;
  expiresAt: string;
}

export interface LocalSyncCommands {
  status(): Promise<Record<string, unknown>>;
  inspect(input: { path: string }): Promise<SourceInspection>;
  prepare(input: {
    path: string;
    spaceId: string;
    allowRemoteModel: boolean;
    codebaseMemorySummary?: string;
  }): Promise<SyncPreview>;
  sync(input: { previewId: string; confirmed: true }): Promise<KnowledgeSyncResult>;
}

export interface CommandDependencies {
  home: string;
  connection: LocalSyncConnection;
  readApiKey: () => Promise<string>;
  client: AgentWikiClient;
  inspectLocalSource: typeof inspectLocalSource;
  prepareKnowledgeSync: typeof prepareKnowledgeSync;
  savePreview: typeof savePreview;
  claimPreview: typeof claimPreview;
  releasePreview: typeof releasePreview;
  completePreview: typeof completePreview;
  now: () => Date;
}

interface StoredPreview {
  id: string;
  expiresAt: string;
  envelopePath: string;
  envelopeHash: string;
  spaceId?: string;
}

function previewDirectory(home: string): string {
  return join(home, '.agentwiki', 'prepared');
}

function previewEnvelopePath(home: string, previewId: string): string {
  return join(previewDirectory(home), `${previewId}.okf.json`);
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function formatMcpOutput(result: unknown): string {
  return redactSecrets(JSON.stringify(result, null, 2));
}

function text(result: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: formatMcpOutput(result) }] };
}

/**
 * Creates the confirmation-gated local sync operations shared by the CLI and MCP server.
 */
export function createLocalSyncCommands(deps: CommandDependencies): LocalSyncCommands {
  return {
    async status(): Promise<Record<string, unknown>> {
      return {
        connectionId: deps.connection.id,
        serverUrl: deps.connection.serverUrl,
        agentId: deps.connection.agentId,
        client: deps.connection.client,
        pluginVersion: deps.connection.pluginVersion,
        mcpName: deps.connection.mcpName,
      };
    },

    inspect(input) {
      return deps.inspectLocalSource(input.path);
    },

    async prepare(input): Promise<SyncPreview> {
      const prepared = await deps.prepareKnowledgeSync({
        path: input.path,
        allowRemoteModel: input.allowRemoteModel,
        ...(input.codebaseMemorySummary ? { codebaseMemorySummary: input.codebaseMemorySummary } : {}),
      });
      const apiKey = await deps.readApiKey();
      const state = await deps.client.getSyncState(deps.connection, apiKey, input.spaceId, prepared.sourceKey);
      const diff = buildPreview(prepared.envelope, state);
      const previewId = randomUUID();
      const expiresAt = new Date(deps.now().getTime() + PREVIEW_TTL_MS).toISOString();
      const envelopePath = previewEnvelopePath(deps.home, previewId);
      await mkdir(previewDirectory(deps.home), { recursive: true, mode: 0o700 });
      await writeFile(envelopePath, prepared.envelopeBytes, { mode: 0o600 });

      try {
        await deps.savePreview(deps.home, {
          id: previewId,
          expiresAt,
          envelopePath,
          envelopeHash: hash(prepared.envelopeBytes),
          spaceId: input.spaceId,
        } as Parameters<typeof deps.savePreview>[1]);
      } catch (error) {
        await rm(envelopePath, { force: true });
        throw error;
      }

      return {
        previewId,
        displayName: prepared.envelope.name,
        spaceId: input.spaceId,
        ...diff,
        processedFiles: prepared.processedFiles,
        skippedFiles: prepared.skippedFiles,
        uploadBytes: prepared.envelopeBytes.byteLength,
        expiresAt,
      };
    },

    async sync(input): Promise<KnowledgeSyncResult> {
      if (input.confirmed !== true) throw new Error('Explicit user confirmation is required');

      const preview = await deps.claimPreview(deps.home, input.previewId) as StoredPreview;
      let bytes: Uint8Array;
      try {
        bytes = await readFile(preview.envelopePath);
      } catch (error) {
        await deps.releasePreview(deps.home, input.previewId);
        throw new Error('Prepared knowledge changed; generate a new preview', { cause: error });
      }
      if (hash(bytes) !== preview.envelopeHash || !preview.spaceId) {
        await rm(preview.envelopePath, { force: true });
        await deps.releasePreview(deps.home, input.previewId);
        throw new Error('Prepared knowledge changed; generate a new preview');
      }

      try {
        const result = await deps.client.upload(
          deps.connection,
          await deps.readApiKey(),
          preview.spaceId,
          bytes,
          input.previewId,
        );
        await rm(preview.envelopePath, { force: true });
        await deps.completePreview(deps.home, input.previewId);
        return result;
      } catch (error) {
        await deps.releasePreview(deps.home, input.previewId);
        throw error;
      }
    },
  };
}

export function createLocalSyncMcpServer(commands: LocalSyncCommands): McpServer {
  const server = new McpServer({ name: 'agentwiki-local-sync', version: PACKAGE_VERSION });
  server.registerTool('local_sync_status', {
    description: 'Show the active local AgentWiki sync connection without credentials.',
    inputSchema: {},
  }, async () => text(await commands.status()));
  server.registerTool('inspect_local_source', {
    description: 'Inspect a local source directory without uploading data or invoking remote model providers.',
    inputSchema: { path: z.string().min(1) },
  }, async (input) => text(await commands.inspect(input)));
  server.registerTool('prepare_knowledge_sync', {
    description: 'Generate a local knowledge preview and diff. This never uploads data.',
    inputSchema: {
      path: z.string().min(1),
      spaceId: z.string().min(1),
      allowRemoteModel: z.boolean().default(false),
      codebaseMemorySummary: z.string().max(50_000).optional(),
    },
  }, async (input) => text(await commands.prepare(input)));
  server.registerTool('sync_prepared_knowledge', {
    description: 'Upload a fresh prepared preview after explicit user confirmation.',
    inputSchema: { previewId: z.string().uuid(), confirmed: z.literal(true) },
  }, async (input) => text(await commands.sync(input)));
  return server;
}

export async function serveLocalSyncMcp(commands: LocalSyncCommands): Promise<void> {
  const server = createLocalSyncMcpServer(commands);
  await server.connect(new StdioServerTransport());
}


export function createOrchestratorMcpServer(commands: import('./orchestrator-commands.js').OrchestratorCommands): McpServer {
  const server = new McpServer({ name: 'agentwiki-local-orchestrator', version: PACKAGE_VERSION });
  server.registerTool('start_knowledge_job', {
    description: 'Start a deterministic local knowledge job for a Space and recipe.',
    inputSchema: { spaceId: z.string().min(1), recipeId: z.string().min(1), sourcePaths: z.array(z.string().min(1)).default([]) },
  }, async (input) => text(await commands.start(input as { spaceId: string; recipeId: string; sourcePaths: string[] })));
  server.registerTool('get_next_work_item', {
    description: 'Get the next pending work item for a job, or null if the phase is complete.',
    inputSchema: { jobId: z.string().uuid() },
  }, async (input) => text(await commands.next(input as { jobId: string })));
  server.registerTool('read_artifacts', {
    description: 'Read artifact summaries for a work item.',
    inputSchema: { jobId: z.string().uuid(), workItemId: z.string().min(1) },
  }, async (input) => text(await commands.readArtifacts(input as { jobId: string; workItemId: string })));
  server.registerTool('submit_organized_item', {
    description: 'Submit an organized knowledge item for a work item and advance the job.',
    inputSchema: { jobId: z.string().uuid(), workItemId: z.string().min(1), item: z.record(z.unknown()) },
  }, async (input) => text(await commands.submitOrganizedItem(input as { jobId: string; workItemId: string; item: Record<string, unknown> })));
  server.registerTool('validate_knowledge_job', {
    description: 'Transition a job to validation phase.',
    inputSchema: { jobId: z.string().uuid() },
  }, async (input) => text(await commands.validate(input as { jobId: string })));
  server.registerTool('preview_knowledge_job', {
    description: 'Build a preview bundle for a job without uploading.',
    inputSchema: { jobId: z.string().uuid() },
  }, async (input) => text(await commands.preview(input as { jobId: string })));
  server.registerTool('confirm_and_push', {
    description: 'Upload a confirmed preview bundle to AgentWiki.',
    inputSchema: { jobId: z.string().uuid(), confirmed: z.literal(true) },
  }, async (input) => text(await commands.confirmAndPush(input as { jobId: string; confirmed: true })));
  server.registerTool('pull_space', {
    description: 'Pull the authoritative Space revision into the local workspace.',
    inputSchema: { spaceId: z.string().min(1) },
  }, async (input) => text(await commands.pull(input as { spaceId: string })));
  server.registerTool('resolve_conflict', {
    description: 'Resolve a conflict in a merge job.',
    inputSchema: { jobId: z.string().uuid(), conflictId: z.string().min(1), resolved: z.record(z.unknown()) },
  }, async (input) => text(await commands.resolveConflict(input as { jobId: string; conflictId: string; resolved: Record<string, unknown> })));
  return server;
}


export async function serveOrchestratorMcp(commands: import('./orchestrator-commands.js').OrchestratorCommands): Promise<void> {
  const server = createOrchestratorMcpServer(commands);
  await server.connect(new StdioServerTransport());
}
